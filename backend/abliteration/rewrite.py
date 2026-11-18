# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
Rewrite and Patch: changes to a model's weights for one run.

Rewrite is a rank-one edit of one block's MLP inspired by ROME (Meng, Bau, Andonian and Belinkov 2022,
"Locating and Editing Factual Associations in GPT"), written here from the paper's description:
1. the key k*: the MLP's hidden activation (where its output projection reads it) at the
   subject's last token, averaged over the prompt and a few versions of it with a corpus passage's
   opening in front;
2. the change d: a vector added to the MLP's output at that token, found by gradient descent so
   that the model writes the target after the prompt (with a penalty on its size);
3. the edit: the output projection gains d c^T, where c = C^-1 k* / (k*^T C^-1 k*) and C is the
   covariance of the MLP's keys over the reference corpus (with a ridge), so that the key k* gains
   exactly d and other keys as little as their likeness to k* allows.
It is applied as a forward hook on the output projection (output += (x . c) d), or saved as a patch.

Patch loads a safetensors file from data/patches/ whose tensors, keyed by parameter name, are
changes to add (scaled), and puts the weights back after the run.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch

from . import ROOT

PATCHES = ROOT / "data" / "patches"
_fits: Dict[str, Dict[str, torch.Tensor]] = {}


def _subject_last(tok, text: str, subject: str, lineno: int) -> int:
    from .interventions import ChainError
    at = text.find(subject)
    if at < 0:
        raise ChainError(f"Line {lineno}: the subject '{subject}' is not in the prompt.")
    end = at + len(subject)
    enc = tok(text, return_offsets_mapping=True)
    idx = [i for i, (a, b) in enumerate(enc["offset_mapping"]) if a < end and b > at]
    return idx[-1]


def _key_cov(sess, layer: int) -> torch.Tensor:
    """The covariance (second moment) of the MLP's keys at a block over the reference corpus, with a
    ridge of a hundredth of its mean diagonal, so that it can be inverted with few positions."""
    from .directions import _with_bos
    from .means import CACHE, corpus_passages
    from .streamstats import _key
    f = CACHE / f"keycov-{_key(sess)}-B{layer}.pt"
    if f.exists():
        return torch.load(f, weights_only=True)
    model, tok, mp = sess.require()
    dev = next(model.parameters()).device
    keys = []
    h = mp.mlp_proj(layer).register_forward_pre_hook(lambda m, a: keys.append(a[0][0, 1:].detach().float().cpu()))
    try:
        with torch.no_grad():
            for p in corpus_passages():
                model(_with_bos(tok, p, dev), use_cache=False)
    finally:
        h.remove()
    K = torch.cat(keys).double()
    C = K.T @ K / K.shape[0]
    C = C + 0.01 * C.diagonal().mean() * torch.eye(C.shape[0], dtype=C.dtype)
    CACHE.mkdir(parents=True, exist_ok=True)
    torch.save(C.float(), f)
    return C.float()


def fit(sess, s) -> Dict[str, torch.Tensor]:
    """The rank-one edit for a Rewrite line: {"c": (d_mlp,), "d": (d_model,), "block", "p_before", "p_after"}."""
    from .interventions import ChainError, _int
    from .means import corpus_passages
    from .streamstats import _key
    model, tok, mp = sess.require()
    dev = next(model.parameters()).device
    prompt, subject, target = s.params.get("prompt", ""), s.params.get("subject", ""), s.params.get("target", "")
    layer = _int(s, "block", 5)
    if not 0 <= layer < mp.n_layers:
        raise ChainError(f"Line {s.lineno}: rewrite block is 0 to {mp.n_layers - 1}.")
    key = hashlib.sha256(json.dumps([_key(sess), prompt, subject, target, layer, 1]).encode()).hexdigest()[:20]
    if key in _fits:
        return _fits[key]
    from .means import CACHE
    f = CACHE / f"rewrite-{key}.pt"
    if f.exists():
        _fits[key] = torch.load(f, weights_only=True)
        return _fits[key]
    tgt = tok(target, add_special_tokens=False).input_ids
    if not tgt:
        raise ChainError(f"Line {s.lineno}: the target gives no tokens.")
    prefixes = [""] + [" ".join(p.split()[:8]) + ". " for p in corpus_passages()[:5]]
    texts = [pre + prompt for pre in prefixes]
    proj = mp.mlp_proj(layer)
    # 1. the key: the MLP's hidden activation at the subject's last token
    keys = []
    for t in texts:
        i = _subject_last(tok, t, subject, s.lineno)
        got = {}
        h = proj.register_forward_pre_hook(lambda m, a: got.__setitem__("k", a[0][0, i].detach().float()))
        try:
            with torch.no_grad():
                model(torch.tensor([tok(t).input_ids], device=dev), use_cache=False)
        finally:
            h.remove()
        keys.append(got["k"])
    kstar = torch.stack(keys).mean(0)
    # 2. the change to the MLP's output at that token that makes the model write the target
    delta = torch.zeros(mp.d_model, device=dev, requires_grad=True)
    where: Dict[str, int] = {}

    def add(m, a, o):
        y = o[0] if isinstance(o, tuple) else o
        y = y.clone()
        y[0, where["i"]] = y[0, where["i"]] + delta.to(y.dtype)
        return (y,) + tuple(o[1:]) if isinstance(o, tuple) else y
    batches = []
    for t in texts:
        ids = tok(t).input_ids
        batches.append((torch.tensor([ids + tgt[:-1]], device=dev), len(ids), _subject_last(tok, t, subject, s.lineno)))

    def target_logprob():
        total = 0.0
        for ids, n, i in batches:
            where["i"] = i
            lp = torch.log_softmax(model(ids, use_cache=False).logits[0].float(), -1)
            total = total + sum(lp[n - 1 + j, tgt[j]] for j in range(len(tgt)))
        return total / len(batches)
    h = proj.register_forward_hook(add)
    opt = torch.optim.Adam([delta], lr=0.5)
    try:
        with torch.enable_grad():
            with torch.no_grad():
                p_before = float(torch.exp(target_logprob()))
            for _ in range(30):
                opt.zero_grad()
                loss = -target_logprob() + 0.02 * (delta ** 2).sum() / max(1.0, float(kstar.norm()))
                loss.backward()
                opt.step()
            with torch.no_grad():
                p_after = float(torch.exp(target_logprob()))
    finally:
        h.remove()
    # 3. the rank-one edit through the keys' covariance
    C = _key_cov(sess, layer)                                            # on the CPU, in float64
    k = kstar.detach().cpu().double()
    ck = torch.linalg.solve(C.double(), k)
    c = (ck / (k @ ck)).float()
    out = {"c": c.detach().cpu(), "d": delta.detach().float().cpu(), "block": torch.tensor(layer),
           "p_before": torch.tensor(p_before), "p_after": torch.tensor(p_after)}
    CACHE.mkdir(parents=True, exist_ok=True)
    torch.save(out, f)
    _fits[key] = out
    return out


def rewrite_hook(c: torch.Tensor, d: torch.Tensor, amount: float):
    """Forward hook on an MLP's output projection: adds amount (x . c) d, the rank-one edit."""
    def hook(module, args, output):
        y = output[0] if isinstance(output, tuple) else output
        x = args[0].float()
        new = (y.float() + amount * (x @ c).unsqueeze(-1) * d).to(y.dtype)
        return (new,) + tuple(output[1:]) if isinstance(output, tuple) else new
    return hook


def save_patch(sess, name: str, fit_: Dict[str, torch.Tensor], amount: float, note: str) -> Path:
    """The rank-one edit as a patch: the change to the output projection's weight, keyed by name."""
    from safetensors.torch import save_file
    from .interventions import ChainError
    import re
    model, tok, mp = sess.require()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,60}", name):
        raise ChainError("A patch's name is letters, numbers, dots, dashes or underscores.")
    layer = int(fit_["block"])
    proj = mp.mlp_proj(layer)
    pname = next(n for n, p in model.named_parameters() if p is proj.weight)
    dW = amount * torch.outer(fit_["c"], fit_["d"])                       # (in, out), as Conv1D keeps it
    if type(proj).__name__ != "Conv1D":
        dW = dW.T
    PATCHES.mkdir(parents=True, exist_ok=True)
    f = PATCHES / f"{name}.safetensors"
    save_file({pname: dW.contiguous()}, str(f), metadata={"kind": "delta", "made_by": "Abliteration Lens rewrite", "note": note})
    return f


def load_patch(sess, name: str, scale: float, lineno: int, restores: List) -> int:
    """Add a patch's changes to the model's weights for the run; the restores put them back."""
    from safetensors import safe_open
    from .interventions import ChainError
    model, tok, mp = sess.require()
    f = PATCHES / f"{name}.safetensors"
    if not f.exists():
        raise ChainError(f"Line {lineno}: there is no patch called '{name}' in data/patches/.")
    params = dict(model.named_parameters())
    n = 0
    with safe_open(str(f), framework="pt") as fh:
        kind = (fh.metadata() or {}).get("kind", "delta")
        for k in fh.keys():
            if k not in params:
                raise ChainError(f"Line {lineno}: the patch changes '{k}', which this model does not have.")
            p, t = params[k], fh.get_tensor(k)
            if tuple(t.shape) != tuple(p.shape):
                raise ChainError(f"Line {lineno}: the patch's '{k}' is {tuple(t.shape)}; the model's is {tuple(p.shape)}.")
            saved = p.detach().clone()
            with torch.no_grad():
                if kind == "replace":
                    p.copy_(saved + scale * (t.to(p.device, p.dtype) - saved))
                else:
                    p.add_(scale * t.to(p.device, p.dtype))

            def restore(p=p, saved=saved):
                with torch.no_grad():
                    p.copy_(saved)
            restores.append(restore)
            n += 1
    return n


def patches() -> List[str]:
    return sorted(f.stem for f in PATCHES.glob("*.safetensors")) if PATCHES.is_dir() else []
