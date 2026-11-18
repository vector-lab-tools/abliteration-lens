# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
The intervention chain: one strip per line, worked top to bottom.

    ablate head=5.1 mode=mean
    scale mlp=7 k=-1
    steer layer=6 dir=not-x-but-y scale=4
    project layer=all dir=negation mode=reflect
    noise layer=3 sigma=0.5
    # scale resid=4 k=2          (a line starting with # is bypassed)

Every strip is applied with plain PyTorch hooks on the Hugging Face model. The hook
factories below are the code that runs; the Code view prints their source with
`inspect.getsource`, with the registration lines filled in from the chain.

Two numberings, shared with Vectorscope and Ablation Bench:
- Components (`head=B.H`, `attn=B`, `mlp=B`, `block=B`) are numbered by block, 0 to n-1.
- Residual-stream positions (`layer=l`) are numbered as Hugging Face hidden states:
  layer 0 is the embedding output entering block 0, layer l is the output of block
  l-1, up to layer n. The hook sits on the block output, before any final norm, so
  layer n here is the last block's output and not the normed `hidden_states[n]`.
"""
from __future__ import annotations

import hashlib
import inspect
import re
import shlex
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

import torch

# ---------------------------------------------------------------------------
# What each strip takes. Used by the parser, the desk and the Help page.
# ---------------------------------------------------------------------------

SPECS: Dict[str, Dict[str, Any]] = {
    "ablate": {"title": "Ablate", "level": "model",
               "what": "Removes a component's output (zero) or replaces it with its average (mean)",
               "targets": ["head", "attn", "mlp", "block"], "knobs": {"mode": ["zero", "mean"]}},
    "scale": {"title": "Scale", "level": "model",
              "what": "Multiplies a component's output, or the residual stream, by k",
              "targets": ["head", "attn", "mlp", "block", "layer"], "knobs": {"k": [-4, 4, 1]}},
    "steer": {"title": "Steer", "level": "model",
              "what": "Adds scale times a direction to the residual stream",
              "targets": ["layer"], "knobs": {"dir": "direction", "scale": [-20, 20, 0]}},
    "project": {"title": "Project out", "level": "model",
                "what": "Removes (or reflects) the residual stream's component along a direction",
                "targets": ["layer"], "knobs": {"dir": "direction", "mode": ["remove", "reflect"], "to": ["zero", "mean"], "k": [1, 16, 1]}},
    "noise": {"title": "Noise", "level": "model",
              "what": "Adds Gaussian noise to the residual stream, scaled to its size",
              "targets": ["layer"], "knobs": {"sigma": [0, 2, 0], "abs": [0, 1, 0], "seed": "int"}},
    "coarsen": {"title": "Coarsen", "level": "weights",
                "what": "Rounds one layer's weights to fewer bits, the rest untouched",
                "targets": ["block"], "knobs": {"bits": [2, 8, 8]}},
    "reorder": {"title": "Reorder", "level": "order",
                "what": "Skips, repeats or swaps layers",
                "targets": [], "knobs": {"skip": "layers", "repeat": "layers", "swap": "pair"}},
    "transplant": {"title": "Transplant", "level": "model",
                   "what": "Puts the residual stream from a run on another prompt into this one",
                   "targets": ["layer"], "knobs": {"prompt": "text", "at": "int", "from": "int"}},
    "vocoder": {"title": "Vocoder", "level": "model",
                "what": "Imposes another prompt's band levels (in the stream's principal directions) on the stream being written",
                "targets": ["layer"], "knobs": {"prompt": "text", "bands": [2, 64, 16], "mix": [0, 1, 1]}},
    "pan": {"title": "Pan", "level": "model",
            "what": "Biases where attention looks: toward the most recent tokens, or toward the start",
            "targets": ["block"], "knobs": {"depth": [0, 20, 4], "pan": [-1, 1, 0]}},
    "rewrite": {"title": "Rewrite", "level": "model",
                "what": "A rank-one edit of one MLP that makes the model write a target after a prompt about a subject (inspired by ROME)",
                "targets": [], "knobs": {"block": [0, 47, 5], "prompt": "text", "subject": "text", "target": "text", "amount": [0, 2, 1], "save": "text"}},
    "patch": {"title": "Patch", "level": "weights",
              "what": "Adds a saved set of weight changes for the run, and puts the weights back after",
              "targets": [], "knobs": {"file": "text", "scale": [0, 2, 1]}},
    "position": {"title": "Position bend", "level": "model",
                 "what": "Shifts, scrambles or freezes the position embeddings the model reads (learned positions only)",
                 "needs_model": ["learned positions"], "targets": [], "knobs": {"mode": ["shift", "scramble", "freeze"], "k": [-512, 512, 0], "seed": "int"}},
    "exit": {"title": "Exit", "level": "order",
             "what": "Stops after a layer and writes from there through the final norm and output layer",
             "targets": ["layer"], "knobs": {}},
    "embed": {"title": "Embedding bend", "level": "model",
              "what": "Swaps two tokens' input embeddings, or adds noise to one",
              "targets": [], "knobs": {"swap": "a,b", "mix": [0, 1, 1], "token": "text", "sigma": [0, 2, 0]}},
    "token": {"title": "Token", "level": "model",
              "what": "Zeros a word's input embedding (the model reads nothing there), or bans the word (the model may not write it)",
              "targets": [], "knobs": {"word": "text", "mode": ["zero", "ban"]}},
    # Meters: they read the model and change nothing. Each is filled in after the run by a
    # teacher-forced pass over each text (generate.read_probes), not during generation.
    "tap": {"title": "Tap", "level": "probe",
            "what": "Reads the residual stream at a layer as if it were the last (the logit lens) and shows the words it points to; changes nothing",
            "targets": ["layer"], "knobs": {}},
    "meter": {"title": "Level meter", "level": "probe",
              "what": "Shows the size (L2 norm) of the residual stream at a layer, token by token; changes nothing",
              "targets": ["layer"], "knobs": {}},
    "gauge": {"title": "Direction meter", "level": "probe",
              "what": "Shows how far the residual stream at a layer points along a direction, token by token; changes nothing",
              "targets": ["layer"], "knobs": {"dir": "direction"}},
    "scope": {"title": "Attention scope", "level": "probe",
              "what": "Shows which earlier tokens one head attends to from each token; changes nothing",
              "targets": ["head"], "knobs": {}},
    "contrast": {"title": "Contrast", "level": "sampler",
                 "what": "Divides the diverged model's next-token probabilities by the original's to a power: what the chain made likelier gains",
                 "targets": [], "knobs": {"alpha": [0, 3, 1], "keep": [0.001, 1, 0.1]}},
    "chorus": {"title": "Chorus", "level": "sampler",
               "what": "Writes with several slightly detuned copies of the model, averaging their next-token probabilities",
               "targets": ["layer"], "knobs": {"voices": [0, 8, 3], "sigma": [0, 1, 0.3]}},
    "sample": {"title": "Sampler bend", "level": "sampler",
               "what": "Changes how the next token is chosen; the model itself is untouched",
               "targets": [], "knobs": {"mode": ["ban-top", "ceiling", "invert"], "k": [1, 20, 1],
                                        "p": [0.05, 1, 0.5]}},
}


class ChainError(ValueError):
    pass


@dataclass
class Strip:
    kind: str
    on: bool
    params: Dict[str, str]
    raw: str
    lineno: int

    @property
    def level(self) -> str:
        if self.kind == "token" and self.params.get("mode", "zero") == "ban":
            return "sampler"
        return SPECS[self.kind]["level"]

    def target(self) -> Tuple[str, Any]:
        for t in ("head", "attn", "mlp", "block", "layer"):
            if t in self.params:
                return t, self.params[t]
        return "", None

    def text(self) -> str:
        parts = [self.kind] + [f"{k}={_quote(v)}" for k, v in self.params.items()]
        return ("# " if not self.on else "") + " ".join(parts)


def _quote(v: str) -> str:
    return shlex.quote(v) if (not v or any(c in v for c in " \t\"'#")) else v


@dataclass
class Chain:
    lines: List[Any] = field(default_factory=list)   # Strip or raw str (notes, blanks)

    @property
    def strips(self) -> List[Strip]:
        return [l for l in self.lines if isinstance(l, Strip)]

    @property
    def active(self) -> List[Strip]:
        return [s for s in self.strips if s.on]

    def text(self) -> str:
        return "\n".join(l.raw if isinstance(l, Strip) else l for l in self.lines)

    def canonical(self) -> List[Dict[str, Any]]:
        return [{"kind": s.kind, "on": s.on, "params": dict(s.params)} for s in self.strips]

    def needs_full_recompute(self) -> bool:
        return any(s.kind in ("reorder", "exit") for s in self.active)


def parse_chain(text: str) -> Chain:
    chain = Chain()
    for i, raw in enumerate((text or "").split("\n"), start=1):
        body, on = raw.strip(), True
        if body.startswith("#"):
            on, body = False, body.lstrip("#").strip()
        if not body:
            chain.lines.append(raw)
            continue
        try:
            words = shlex.split(body)
        except ValueError as e:
            raise ChainError(f"Line {i}: {e}")
        kind = words[0].lower()
        if kind not in SPECS:
            if not on:
                chain.lines.append(raw)    # a bypassed note
                continue
            raise ChainError(f"Line {i}: '{words[0]}' is not an intervention. "
                             f"Known: {', '.join(SPECS)}.")
        params: Dict[str, str] = {}
        for w in words[1:]:
            if "=" not in w:
                raise ChainError(f"Line {i}: '{w}' should be name=value.")
            k, v = w.split("=", 1)
            params[k.strip().lower()] = v
        s = Strip(kind, on, params, raw, i)
        _validate(s)
        chain.lines.append(s)
    return chain


def _int(s: Strip, key: str, default=None) -> int:
    v = s.params.get(key)
    if v is None:
        if default is None:
            raise ChainError(f"Line {s.lineno}: {s.kind} needs {key}=.")
        return default
    try:
        return int(v)
    except ValueError:
        raise ChainError(f"Line {s.lineno}: {key}={v} should be a whole number.")


def _float(s: Strip, key: str, default=None) -> float:
    v = s.params.get(key)
    if v is None:
        if default is None:
            raise ChainError(f"Line {s.lineno}: {s.kind} needs {key}=.")
        return default
    try:
        return float(v)
    except ValueError:
        raise ChainError(f"Line {s.lineno}: {key}={v} should be a number.")


def _validate(s: Strip):
    spec = SPECS[s.kind]
    if spec.get("vau"):                  # a unit: checked against its own manifest
        from . import vauhost
        vauhost.validate(s)
        return
    from . import vauhost
    vauhost.validate_own(s)              # the host features, where the strip takes them
    if spec["targets"]:
        t, _ = s.target()
        if t not in spec["targets"]:
            raise ChainError(f"Line {s.lineno}: {s.kind} needs one of "
                             + ", ".join(f"{x}=" for x in spec["targets"]) + ".")
    if s.kind in ("tap", "meter", "gauge") and not re.fullmatch(r"\d+|emb", s.params.get("layer", "").strip().lower()):
        raise ChainError(f"Line {s.lineno}: {s.kind} reads one layer: layer=6, for example.")
    if s.kind == "scope" and not re.fullmatch(r"\d+\.\d+", s.params.get("head", "").strip()):
        raise ChainError(f"Line {s.lineno}: scope reads one head: head=5.1, for example.")
    if s.kind in ("steer", "project", "gauge") and "dir" not in s.params:
        raise ChainError(f"Line {s.lineno}: {s.kind} needs dir= (the name of a direction).")
    if s.kind == "ablate" and s.params.get("mode", "zero") not in ("zero", "mean"):
        raise ChainError(f"Line {s.lineno}: ablate mode is zero or mean.")
    if s.kind == "project" and s.params.get("mode", "remove") not in ("remove", "reflect"):
        raise ChainError(f"Line {s.lineno}: project mode is remove or reflect.")
    if s.kind == "project" and s.params.get("to", "zero") not in ("zero", "mean"):
        raise ChainError(f"Line {s.lineno}: project to is zero or mean.")
    if s.kind == "project" and not 1 <= _int(s, "k", 1) <= 16:
        raise ChainError(f"Line {s.lineno}: project k (how many directions) is 1 to 16.")
    if s.kind == "sample" and s.params.get("mode") not in ("ban-top", "ceiling", "invert"):
        raise ChainError(f"Line {s.lineno}: sample mode is ban-top, ceiling or invert.")
    if s.kind == "reorder" and not any(k in s.params for k in ("skip", "repeat", "swap")):
        raise ChainError(f"Line {s.lineno}: reorder needs skip=, repeat= or swap=.")
    if s.kind == "embed" and not ("swap" in s.params or "token" in s.params):
        raise ChainError(f"Line {s.lineno}: embed needs swap=a,b or token= with sigma=.")
    if s.kind == "token":
        if not s.params.get("word", "").strip(" ,"):
            raise ChainError(f"Line {s.lineno}: token needs word=\" not\" (several: word=\" not, never\").")
        if s.params.get("mode", "zero") not in ("zero", "ban"):
            raise ChainError(f"Line {s.lineno}: token mode is zero or ban.")
    if s.kind == "vocoder" and not s.params.get("prompt", "").strip():
        raise ChainError(f"Line {s.lineno}: vocoder needs prompt= (the modulator: the text whose band levels are imposed).")
    if s.kind == "vocoder" and not re.fullmatch(r"\d+", s.params.get("layer", "").strip()):
        raise ChainError(f"Line {s.lineno}: vocoder works at one layer: vocoder layer=6, for example.")
    if s.kind == "rewrite":
        for k in ("prompt", "subject", "target"):
            if not s.params.get(k, "").strip():
                raise ChainError(f"Line {s.lineno}: rewrite needs prompt=, subject= and target=, as in "
                                 'rewrite block=5 prompt="The Eiffel Tower is located in the city of" subject="Eiffel Tower" target=" Rome".')
        if s.params["subject"] not in s.params["prompt"]:
            raise ChainError(f"Line {s.lineno}: the subject '{s.params['subject']}' is not in the prompt.")
    if s.kind == "patch" and not s.params.get("file", "").strip():
        raise ChainError(f"Line {s.lineno}: patch needs file= (a patch's name in data/patches/).")
    if s.kind == "position" and s.params.get("mode", "shift") not in ("shift", "scramble", "freeze"):
        raise ChainError(f"Line {s.lineno}: position mode is shift, scramble or freeze.")
    if s.kind == "exit" and not re.fullmatch(r"\d+", s.params.get("layer", "").strip()):
        raise ChainError(f"Line {s.lineno}: exit names one layer: exit layer=6, for example.")
    if s.kind == "embed" and "mix" in s.params and "swap" not in s.params:
        raise ChainError(f"Line {s.lineno}: an embedding mix needs swap=a,b: the first word moves toward the second.")
    if s.kind == "chorus" and not re.fullmatch(r"\d+", s.params.get("layer", "").strip()):
        raise ChainError(f"Line {s.lineno}: chorus detunes one layer: chorus layer=6, for example.")
    if s.kind == "transplant" and "prompt" not in s.params:
        raise ChainError(f"Line {s.lineno}: transplant needs prompt=\"...\".")


# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------

def _layers(spec: str, n: int, lineno: int) -> List[int]:
    """'5', 'all', '3-7', '1,4,9' → block indices."""
    spec = str(spec).strip().lower()
    if spec == "all":
        return list(range(n))
    out: List[int] = []
    for part in spec.split(","):
        if "-" in part[1:]:
            a, b = part.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    for l in out:
        if l < 0 or l >= n:
            raise ChainError(f"Line {lineno}: layer {l} is out of range (0 to {n - 1}).")
    return out


def _heads(spec: str, mp, lineno: int) -> List[Tuple[int, List[int]]]:
    """'5.1' or '5.*' or '5.1,5.3' → [(layer, [heads])]."""
    by: Dict[int, List[int]] = {}
    for part in str(spec).split(","):
        if "." not in part:
            raise ChainError(f"Line {lineno}: a head is layer.head, for example head=5.1.")
        l, h = part.split(".", 1)
        l = int(l)
        if l < 0 or l >= mp.n_layers:
            raise ChainError(f"Line {lineno}: layer {l} is out of range (0 to {mp.n_layers - 1}).")
        hs = list(range(mp.n_heads)) if h == "*" else [int(h)]
        for x in hs:
            if x < 0 or x >= mp.n_heads:
                raise ChainError(f"Line {lineno}: head {x} is out of range (0 to {mp.n_heads - 1}).")
        by.setdefault(l, []).extend(hs)
    return sorted(by.items())


# ---------------------------------------------------------------------------
# The hook factories. These are what runs.
# ---------------------------------------------------------------------------

def _first(output):
    return output[0] if isinstance(output, tuple) else output


def _replace_first(output, new):
    return (new,) + tuple(output[1:]) if isinstance(output, tuple) else new


def head_hook(heads: List[int], d_head: int, mode: str, k: float = 1.0, means=None):
    """Forward pre-hook on the attention output projection. Its input is every head's
    output side by side, d_head wide each; edit the chosen heads' slices."""
    def hook(module, args):
        x = args[0].clone()
        for h in heads:
            sl = slice(h * d_head, (h + 1) * d_head)
            if mode == "zero":
                x[..., sl] = 0
            elif mode == "mean":
                x[..., sl] = means[h].to(x.dtype)
            elif mode == "scale":
                x[..., sl] = x[..., sl] * k
        return (x,) + tuple(args[1:])
    return hook


def output_hook(mode: str, k: float = 1.0, mean=None):
    """Forward hook on an attention or MLP module: edit what it adds to the residual stream."""
    def hook(module, args, output):
        y = _first(output)
        if mode == "zero":
            y = torch.zeros_like(y)
        elif mode == "mean":
            y = mean.to(y.dtype).expand_as(y).clone()
        elif mode == "scale":
            y = y * k
        return _replace_first(output, y)
    return hook


def block_hook(mode: str, k: float = 1.0, mean=None):
    """Forward hook on a whole block (with kwargs): the block's contribution is its
    output minus its input. Zero removes it, mean replaces it, scale multiplies it."""
    def hook(module, args, kwargs, output):
        x = args[0] if args else kwargs["hidden_states"]
        y = _first(output)
        delta = y - x
        if mode == "zero":
            new = x
        elif mode == "mean":
            new = x + mean.to(y.dtype)
        else:
            new = x + delta * k
        return _replace_first(output, new)
    return hook


def resid_hook(edit: Callable, ctx: "RunContext", pre: bool = False):
    """Hook on a block's output (or, with pre=True, its input) that hands the residual
    stream and the absolute positions of its tokens to `edit`."""
    if pre:
        def hook(module, args, kwargs):
            if args:
                x = args[0]
                pos = ctx.positions(x.shape[1], x.device)
                return (edit(x, pos),) + tuple(args[1:]), kwargs
            x = kwargs["hidden_states"]
            kwargs = dict(kwargs, hidden_states=edit(x, ctx.positions(x.shape[1], x.device)))
            return args, kwargs
        return hook

    def hook(module, args, output):
        y = _first(output)
        return _replace_first(output, edit(y, ctx.positions(y.shape[1], y.device)))
    return hook


def record_edit(store: Dict[int, torch.Tensor], key: int):
    """A meter: keeps a copy of the residual stream and hands it on unchanged."""
    def edit(h, pos):
        store[key] = h[0].detach()
        return h
    return edit


def scale_edit(k: float):
    def edit(h, pos):
        return h * k
    return edit


def steer_edit(vector: torch.Tensor, scale: float):
    """Add scale × direction at every position."""
    def edit(h, pos):
        return h + (vector * scale).to(h.dtype)
    return edit


def project_edit(unit: torch.Tensor, mode: str, mean: Optional[torch.Tensor] = None):
    """Remove the component along a unit direction (remove), or negate it (reflect). `unit` may
    be a (k, d) set of orthonormal directions, a subspace: then the component in all of them.
    With `mean` (the stream's mean at that layer), the component is measured from the mean,
    so removing it sets it to the mean's component (mean-referenced, or affine, erasure)."""
    factor = 1.0 if mode == "remove" else 2.0
    def edit(h, pos):
        if unit.dim() == 1 and mean is None:
            u = unit.to(h.dtype)
            coeff = (h * u).sum(-1, keepdim=True)
            return h - factor * coeff * u
        B = (unit if unit.dim() == 2 else unit.view(1, -1)).to(h.dtype)
        x = h - mean.to(h.dtype) if mean is not None else h
        return h - factor * (x @ B.T) @ B
    return edit


def noise_edit(sigma: float, absolute: bool, seed: int, layer: int):
    """Gaussian noise drawn per absolute position from its own seed, so a run, its
    rescoring and its regeneration draw the same noise. By default sigma is a share
    of the residual vector's root mean square at that position."""
    def edit(h, pos):
        rows = []
        for p in pos.tolist():
            g = torch.Generator(device="cpu").manual_seed(_mix(seed, layer, p))
            rows.append(torch.randn(h.shape[-1], generator=g))
        z = torch.stack(rows).to(device=h.device, dtype=h.dtype)       # (seq, d)
        if absolute:
            return h + sigma * z
        rms = h.pow(2).mean(-1, keepdim=True).sqrt()
        return h + sigma * rms * z
    return edit


def transplant_edit(source: torch.Tensor, at: int):
    """Replace the residual vector at absolute position `at` with one from another run."""
    def edit(h, pos):
        hit = (pos == at).nonzero().flatten()
        if len(hit) == 0:
            return h
        h = h.clone()
        h[:, hit[0]] = source.to(h.dtype)
        return h
    return edit


def embed_swap_hook(a: int, b: int):
    """Forward hook on the token embedding: token a is read with b's embedding and b with a's."""
    def hook(module, args, output):
        ids = args[0]
        ea, eb = module.weight[a], module.weight[b]
        out = output.clone()
        out[ids == a] = eb.to(out.dtype)
        out[ids == b] = ea.to(out.dtype)
        return out
    return hook


def embed_mix_hook(a: int, b: int, mix: float):
    """Forward hook on the token embedding: token a is read with its embedding moved toward b's by
    `mix` (0 its own, 1 b's); b is read as it is."""
    def hook(module, args, output):
        ids = args[0]
        e = (1 - mix) * module.weight[a] + mix * module.weight[b]
        out = output.clone()
        out[ids == a] = e.to(out.dtype)
        return out
    return hook


def position_hook(mode: str, k: int, seed: int, n_pos: int):
    """Forward hook on the position embedding (its input holds each token's position): shift reads
    position p + k (held within the table), scramble reads a fixed random other position (the same
    for every pass, drawn from the seed), freeze reads position k for every token."""
    perm = None
    if mode == "scramble":
        perm = torch.randperm(n_pos, generator=torch.Generator().manual_seed(int(seed)))

    def hook(module, args, output):
        p = args[0]
        if mode == "shift":
            q = (p + k).clamp(0, n_pos - 1)
        elif mode == "freeze":
            q = torch.full_like(p, max(0, min(n_pos - 1, k)))
        else:
            q = perm.to(p.device)[p]
        return module.weight[q].to(output.dtype)
    return hook


def vocoder_edit(mean: torch.Tensor, bands: List[torch.Tensor], levels: List[float], mix: float):
    """Each band of principal directions (the stream less its corpus mean) rescaled to the
    modulator's size in that band, its direction within the band kept; moved by `mix`; the first
    position (the attention sink) left alone."""
    def edit(h, pos):
        x = h.float()
        xc = x - mean
        add = torch.zeros_like(x)
        for v, e in zip(bands, levels):
            y = xc @ v.T
            n = y.norm(dim=-1, keepdim=True).clamp_min(1e-9)
            add = add + (y * (e / n - 1)) @ v
        out = x + mix * add
        out = torch.where(pos.view(1, -1, 1) == 0, x, out)
        return out.to(h.dtype)
    return edit


def vocoder_bands(d: int, n: int) -> List[Tuple[int, int]]:
    """n bands over d principal directions, spaced logarithmically (as a vocoder's bands are over
    frequency): narrow among the largest directions, wide in the tail."""
    import numpy as np
    edges = sorted(set([0] + [int(round(x)) for x in np.geomspace(1, d, n + 1)[1:]]))
    edges[-1] = d
    return [(a, b) for a, b in zip(edges[:-1], edges[1:]) if b > a]


def embed_noise_hook(token: int, sigma: float, seed: int):
    """Forward hook on the token embedding: one fixed noise vector added wherever the token occurs."""
    def hook(module, args, output):
        ids = args[0]
        g = torch.Generator(device="cpu").manual_seed(_mix(seed, token, 0))
        w = module.weight[token]
        z = torch.randn(w.shape[-1], generator=g).to(w.device, w.dtype) * sigma * w.norm() / (w.shape[-1] ** 0.5)
        out = output.clone()
        out[ids == token] = out[ids == token] + z.to(out.dtype)
        return out
    return hook


def embed_zero_hook(tokens: List[int]):
    """Forward hook on the token embedding: these tokens are read as a zero vector wherever
    they occur (a model with learned position embeddings still adds the position)."""
    def hook(module, args, output):
        ids = args[0]
        out = output.clone()
        for t in tokens:
            out[ids == t] = 0
        return out
    return hook


def fake_quant_int(tensor: torch.Tensor, bits: int) -> torch.Tensor:
    """Per-tensor symmetric integer quantisation and back (Vectorscope,
    precision_degradation._fake_quant_int)."""
    orig = tensor.dtype
    t = tensor.detach().to(torch.float32)
    max_abs = t.abs().max()
    if max_abs <= 0:
        return tensor.clone()
    levels = (1 << (bits - 1)) - 1
    scale = max_abs / levels
    return (torch.round(t / scale).clamp(-levels, levels) * scale).to(orig)


def _mix(*xs: int) -> int:
    h = hashlib.sha256(":".join(str(int(x)) for x in xs).encode()).digest()
    return int.from_bytes(h[:8], "little") & 0x7FFF_FFFF_FFFF_FFFF


# ---------------------------------------------------------------------------
# Sampler-level edits: applied to the next-token logits, not to the model.
# ---------------------------------------------------------------------------

def _words(v: str) -> List[str]:
    """word=" not, never": the words between the commas, each kept exactly as typed, so the
    space after a comma is the next word's leading space (" never")."""
    return [w for w in (v or "").split(",") if w.strip()]


def ban_ids(tok, s: "Strip") -> List[int]:
    """The tokens a ban strip forbids: the first token of each word."""
    out = []
    for w in _words(s.params.get("word", "")):
        ids = tok(w, add_special_tokens=False).input_ids
        if ids:
            out.append(ids[0])
    return out


def sampler_edits(chain: Chain, tok=None) -> List[Tuple[str, Any]]:
    out = []
    for s in chain.active:
        if s.kind == "token" and s.params.get("mode", "zero") == "ban" and tok is not None:
            out.append(("ban-ids", ban_ids(tok, s)))
        if s.kind == "sample":
            m = s.params["mode"]
            out.append((m, _float(s, "k", 1) if m == "ban-top" else _float(s, "p", 0.5)))
        if s.kind == "contrast":
            out.append(("contrast", (max(0.0, _float(s, "alpha", 1.0)), min(1.0, max(0.0, _float(s, "keep", 0.1))))))
        if s.kind == "chorus":
            out.append(("chorus", (_rlayers(s.params.get("layer", "6"), 10 ** 6, s.lineno)[0], max(0, _int(s, "voices", 3)),
                                   max(0.0, _float(s, "sigma", 0.3)))))
    return out


# ---------------------------------------------------------------------------
# Attaching a chain to the model for one run
# ---------------------------------------------------------------------------

class RunContext:
    """What the hooks need to know during one run: the absolute position of the
    first token in the current forward pass, the prompt length, and the run's seed."""

    def __init__(self, seed: int, prompt_len: int):
        self.offset = 0
        self.seed = seed
        self.prompt_len = prompt_len
        self.probes: Optional[Dict[int, torch.Tensor]] = None   # set only by the meters' own pass
        self.effects: Optional[Dict[int, List[torch.Tensor]]] = None   # likewise: how much each strip changed
        self.measures: Optional[Dict[int, List[torch.Tensor]]] = None  # likewise: gain (dB), turn (degrees) and touched (share), for a unit's summary (VAU SPEC 5e)
        self.length: Optional[int] = None                        # the length of that pass
        self.strip: Optional[int] = None                         # the line whose hooks are being attached
        self.store: Dict[Any, Any] = {}                          # earlier positions kept by Lookback, Average, Quantise
        self.deltas: Optional[List[torch.Tensor]] = None         # set only by the self-repair readout: each hook's change, in stream terms
        self.off = False                                         # every hook passes through while set (Contrast's original pass)
        self.voice: Optional[int] = None                         # which Chorus voice a pass is, if any

    def watch(self, fn: Callable, kind: str) -> Callable:
        """In the meters' pass, wrap a hook so that it also records how much it changed what it
        touched: the size of the change over the size of the tensor, at each position. At any
        other time, and for strips that change nothing, the hook is returned as it is."""
        if self.effects is None or self.strip is None:
            return self._gate(fn)
        store, n = self.effects.setdefault(self.strip, []), self.length
        mstore = self.measures.setdefault(self.strip, []) if self.measures is not None else None

        deltas = self.deltas

        def rel(old, new, module=None):
            if old.dim() == 3 and old.shape[1] == n:             # not a side pass (a Transplant's source)
                o, w = old.float(), new.float()
                d = (w - o).norm(dim=-1)
                on = o.norm(dim=-1).clamp_min(1e-9)
                store.append((d / on)[0].detach().cpu())
                if mstore is not None:                           # the measures a unit may ask its summary to read
                    gain = 20 * torch.log10(w.norm(dim=-1).clamp_min(1e-9) / on)
                    turn = torch.rad2deg(torch.arccos(torch.nn.functional.cosine_similarity(o, w, dim=-1).clamp(-1, 1)))
                    touched = ((w - o).abs() > 1e-6 * o.abs().amax(dim=-1, keepdim=True).clamp_min(1e-9)).float().mean(dim=-1)
                    mstore.append(torch.stack([gain, turn, touched], dim=-1)[0].detach().cpu())
                if deltas is not None:
                    deltas.append(_stream_delta(kind, module, old, new))

        if kind == "pre":                                         # (module, args) -> args
            def w(module, args):
                old = args[0].clone()
                r = fn(module, args)
                rel(old, r[0] if r is not None else args[0], module)
                return r
        elif kind == "pre_kw":                                    # (module, args, kwargs) -> (args, kwargs)
            def w(module, args, kwargs):
                x = args[0] if args else kwargs["hidden_states"]
                old = x.clone()
                r = fn(module, args, kwargs)
                if r is not None:
                    a, kw = r
                    x = a[0] if a else kw["hidden_states"]
                rel(old, x)
                return r
        elif kind == "fwd_kw":                                    # (module, args, kwargs, output) -> output
            def w(module, args, kwargs, output):
                old = _first(output).clone()
                r = fn(module, args, kwargs, output)
                rel(old, _first(r) if r is not None else _first(output))
                return r
        else:                                                     # (module, args, output) -> output
            def w(module, args, output):
                old = _first(output).clone()
                r = fn(module, args, output)
                rel(old, _first(r) if r is not None else _first(output))
                return r
        return self._gate(w)

    def _gate(self, fn: Callable) -> Callable:
        """A hook that does nothing while `off` is set: the generation loop sets it to read the
        original model in the same step, for Contrast."""
        def g(*a):
            if self.off:
                return None
            return fn(*a)
        return g

    def positions(self, n: int, device) -> torch.Tensor:
        return torch.arange(self.offset, self.offset + n, device=device)


def _stream_delta(kind: str, module, old: torch.Tensor, new: torch.Tensor) -> torch.Tensor:
    """A hook's change in the residual stream's terms. A forward hook changes what a module adds to
    the stream (an attention layer, an MLP, an output projection, a block, the embedding), or the
    stream itself, so its change is already in the stream's terms. A forward pre-hook on an output
    projection (a head's slice, a neuron) changes the projection's input: its change in the
    stream's terms is the projection of the change (the bias cancels)."""
    d = (new.float() - old.float()).detach()
    if kind == "pre" and module is not None and hasattr(module, "weight"):
        w = module.weight.detach().float()
        d = d @ w if type(module).__name__ == "Conv1D" else d @ w.T
    return d[0].cpu()


@dataclass
class Attached:
    handles: List[Any] = field(default_factory=list)
    restores: List[Callable] = field(default_factory=list)

    def remove(self):
        for h in self.handles:
            h.remove()
        for r in reversed(self.restores):
            r()
        self.handles.clear()
        self.restores.clear()


def attach(chain: Chain, sess, ctx: RunContext, directions, means) -> Attached:
    """Register every active model-, weight- and order-level strip. Sampler strips are
    read by the generation loop."""
    model, tok, mp = sess.require()
    att = Attached()
    from . import vauhost
    vauhost.prepare(sess, chain, directions)    # units measure or fit on the unchanged model, before any hook goes on
    try:
        for s in chain.active:
            ctx.strip = None if s.level == "probe" else s.lineno
            try:
                _attach_one(s, model, tok, mp, ctx, directions, means, att)
            finally:
                ctx.strip = None
    except Exception:
        att.remove()
        raise
    return att


def _attach_one(s: Strip, model, tok, mp, ctx, directions, means, att: Attached):
    dev = next(model.parameters()).device
    k = s.kind
    t, tv = s.target()

    if s.level == "probe":
        # Meters change nothing. During generation they register no hook at all; in the
        # meters' own pass, tap, meter and gauge keep a copy of the stream at their layer,
        # placed in chain order among the other hooks on that layer. The scope reads the
        # attention weights the model returns.
        if k == "gauge":
            directions.get(s.params["dir"], s.lineno).fit(mp.d_model, s.lineno)
        if SPECS[k].get("vau"):                     # a meter unit: a stream meter is recorded like the others
            from . import vauhost
            if vauhost.unit(k).m["site"] == "logits":
                return
        if k == "scope":
            _heads(tv, mp, s.lineno)
        elif ctx.probes is not None:
            _resid(mp, tv, s, ctx, att, lambda layer: record_edit(ctx.probes, s.lineno))
        else:
            _rlayers(tv, mp.n_layers, s.lineno)
        return

    if k in ("ablate", "scale") and t == "head":
        mode = "scale" if k == "scale" else s.params.get("mode", "zero")
        kval = _float(s, "k", 1.0) if k == "scale" else 1.0
        for layer, hs in _heads(tv, mp, s.lineno):
            m = means.heads(layer) if mode == "mean" else None
            att.handles.append(mp.head_proj(layer).register_forward_pre_hook(
                ctx.watch(head_hook(hs, mp.d_head, mode, kval, m), "pre")))
        return

    if k in ("ablate", "scale") and t in ("attn", "mlp"):
        mode = "scale" if k == "scale" else s.params.get("mode", "zero")
        kval = _float(s, "k", 1.0) if k == "scale" else 1.0
        for layer in _layers(tv, mp.n_layers, s.lineno):
            mod = mp.attn(layer) if t == "attn" else mp.mlp(layer)
            m = means.output(t, layer) if mode == "mean" else None
            att.handles.append(mod.register_forward_hook(ctx.watch(output_hook(mode, kval, m), "fwd")))
        return

    if k in ("ablate", "scale") and t == "block":
        mode = "scale" if k == "scale" else s.params.get("mode", "zero")
        kval = _float(s, "k", 1.0) if k == "scale" else 1.0
        for layer in _layers(tv, mp.n_layers, s.lineno):
            m = means.output("block", layer) if mode == "mean" else None
            att.handles.append(mp.block(layer).register_forward_hook(
                ctx.watch(block_hook(mode, kval, m), "fwd_kw"), with_kwargs=True))
        return

    from .vauhost import own_direction, own_wrap      # the host features (wet, envelope, keep size, control)

    if k == "scale" and t == "layer":
        _resid(mp, tv, s, ctx, att, own_wrap(s, mp, lambda layer: scale_edit(_float(s, "k", 1.0)), ctx))
        return

    if k == "steer":
        d = own_direction(s, directions.get(s.params["dir"], s.lineno).fit(mp.d_model, s.lineno))
        scale = _float(s, "scale", 1.0)
        _resid(mp, tv, s, ctx, att, own_wrap(s, mp, lambda layer: steer_edit(d.vector(layer, dev), scale), ctx))
        return

    if k == "project":
        real = directions.get(s.params["dir"], s.lineno).fit(mp.d_model, s.lineno)
        d = own_direction(s, real)
        mode, kk = s.params.get("mode", "remove"), _int(s, "k", 1)
        stats = None
        if s.params.get("to", "zero") == "mean":
            from .streamstats import resid_stats
            stats = resid_stats(means.sess)
        S = None
        if kk > 1:
            from .vauhost import own_settings, random_basis
            if own_settings(s)["control"] == "random":
                S = lambda layer: random_basis(s.params["dir"], own_settings(s)["cseed"], layer, kk, mp.d_model)
            else:
                from .directions import subspace
                sub = subspace(means.sess, real, kk)
                S = lambda layer: torch.tensor(sub[layer])

        def make(layer):
            unit = (S(layer) if S else d.unit(layer, dev)).to(dev)
            mean = torch.tensor(stats["mean"][layer], device=dev) if stats is not None else None
            return project_edit(unit, mode, mean)
        _resid(mp, tv, s, ctx, att, own_wrap(s, mp, make, ctx))
        return

    if k == "noise":
        sigma = _float(s, "sigma", 0.0)
        absolute = bool(_int(s, "abs", 0))
        seed = _int(s, "seed", ctx.seed)
        _resid(mp, tv, s, ctx, att,
               own_wrap(s, mp, lambda layer: noise_edit(sigma, absolute, seed, layer), ctx))
        return

    if SPECS[k].get("vau"):                # a unit (Vector Abliteration Units): the host attaches it
        from . import vauhost
        vauhost.attach(s, means.sess, ctx, directions, att)
        return

    if k == "transplant":
        layer = _rlayers(tv, mp.n_layers, s.lineno)[0]
        src_ids = tok(s.params["prompt"], return_tensors="pt").input_ids.to(dev)
        captured = {}

        def cap(module, args, output):
            captured["h"] = _first(output)[0].detach()
        hnd = (mp.block(0).register_forward_pre_hook(lambda m, a, kw: captured.__setitem__(
            "h", (a[0] if a else kw["hidden_states"])[0].detach()), with_kwargs=True)
            if layer == 0 else mp.block(layer - 1).register_forward_hook(cap))
        try:
            with torch.no_grad():
                model(src_ids, use_cache=False)
        finally:
            hnd.remove()
        frm = _int(s, "from", -1)
        at = _int(s, "at", -1)
        if at < 0:
            at = ctx.prompt_len + at
        source = captured["h"][frm]
        _resid(mp, str(layer), s, ctx, att, lambda l: transplant_edit(source, at))
        return

    if k == "vocoder":
        from .directions import _with_bos, residuals
        from .streamstats import resid_pca, resid_stats
        layer = _rlayers(tv, mp.n_layers, s.lineno)[0]
        r = residuals(model, mp, _with_bos(tok, s.params["prompt"], dev))[layer, 1:, :]
        if r.shape[0] == 0:
            raise ChainError(f"Line {s.lineno}: the vocoder's prompt gives no tokens.")
        mu = torch.tensor(resid_stats(means.sess)["mean"][layer])
        V = torch.tensor(resid_pca(means.sess, layer))
        m = r.mean(0) - mu
        cuts = vocoder_bands(V.shape[0], max(2, _int(s, "bands", 16)))
        bands = [V[a:b] for a, b in cuts]
        levels = [float((m @ v.T).norm()) for v in bands]
        mix = min(1.0, max(0.0, _float(s, "mix", 1.0)))
        if mix > 0:
            _resid(mp, str(layer), s, ctx, att, lambda l: vocoder_edit(mu.to(dev), [b.to(dev) for b in bands], levels, mix))
        return

    if k == "pan":
        depth, pan = _float(s, "depth", 4.0), max(-1.0, min(1.0, _float(s, "pan", 0.0)))
        if pan != 0 and depth != 0:
            att.restores.append(_attach_pan(model, mp, set(_layers(tv, mp.n_layers, s.lineno)), pan * depth, ctx))
        return

    if k == "rewrite":
        from . import rewrite as rw
        amount = _float(s, "amount", 1.0)
        f = rw.fit(means.sess, s)
        if s.params.get("save", "").strip():
            rw.save_patch(means.sess, s.params["save"].strip(), f, amount,
                          f"{s.params['prompt']!r} -> {s.params['target']!r} at block {int(f['block'])}")
        if amount != 0:
            att.handles.append(mp.mlp_proj(int(f["block"])).register_forward_hook(ctx.watch(
                rw.rewrite_hook(f["c"].to(dev), f["d"].to(dev), amount), "fwd")))
        return

    if k == "patch":
        from . import rewrite as rw
        scale = _float(s, "scale", 1.0)
        if scale != 0:
            rw.load_patch(means.sess, s.params["file"].strip(), scale, s.lineno, att.restores)
        return

    if k == "position":
        if mp.pos_embed is None:
            raise ChainError(f"Line {s.lineno}: this model uses rotary positions; Position bend needs learned position embeddings (GPT-2 has them).")
        n_pos = mp.pos_embed.weight.shape[0]
        att.handles.append(mp.pos_embed.register_forward_hook(ctx.watch(
            position_hook(s.params.get("mode", "shift"), _int(s, "k", 0), _int(s, "seed", ctx.seed), n_pos), "fwd")))
        return

    if k == "exit":
        layer = _int(s, "layer")
        if not 0 <= layer <= mp.n_layers:
            raise ChainError(f"Line {s.lineno}: exit layer is 0 to {mp.n_layers}.")
        if layer < mp.n_layers:
            att.restores.append(_apply_order(model, mp, list(range(layer))))
        return

    if k == "embed":
        if "swap" in s.params and "mix" in s.params:
            a, b = (_single_token(tok, w, s.lineno) for w in _pair(s.params["swap"], s.lineno))
            att.handles.append(mp.embed.register_forward_hook(ctx.watch(embed_mix_hook(a, b, _float(s, "mix", 1.0)), "fwd")))
        elif "swap" in s.params:
            a, b = (_single_token(tok, w, s.lineno) for w in _pair(s.params["swap"], s.lineno))
            att.handles.append(mp.embed.register_forward_hook(ctx.watch(embed_swap_hook(a, b), "fwd")))
        if "token" in s.params:
            t_id = _single_token(tok, s.params["token"], s.lineno)
            att.handles.append(mp.embed.register_forward_hook(ctx.watch(
                embed_noise_hook(t_id, _float(s, "sigma", 0.5), _int(s, "seed", ctx.seed)), "fwd")))
        return

    if k == "coarsen":
        bits = _int(s, "bits", 8)
        if bits not in (2, 3, 4, 8):
            raise ChainError(f"Line {s.lineno}: coarsen bits is 2, 3, 4 or 8.")
        for layer in _layers(tv, mp.n_layers, s.lineno):
            block = mp.block(layer)
            saved = {n: p.detach().clone() for n, p in block.named_parameters()}
            with torch.no_grad():
                for n, p in block.named_parameters():
                    if p.dim() >= 2:                     # weight matrices; biases and norms kept
                        p.copy_(fake_quant_int(p, bits))

            def restore(block=block, saved=saved):
                with torch.no_grad():
                    for n, p in block.named_parameters():
                        p.copy_(saved[n])
            att.restores.append(restore)
        return

    if k == "reorder":
        order = list(range(mp.n_layers))
        if "skip" in s.params:
            drop = set(_layers(s.params["skip"], mp.n_layers, s.lineno))
            order = [i for i in order if i not in drop]
        if "repeat" in s.params:
            rep = set(_layers(s.params["repeat"], mp.n_layers, s.lineno))
            order = [j for i in order for j in ([i, i] if i in rep else [i])]
        if "swap" in s.params:
            a, b = (int(x) for x in _pair(s.params["swap"], s.lineno))
            for x in (a, b):
                if x < 0 or x >= mp.n_layers:
                    raise ChainError(f"Line {s.lineno}: layer {x} is out of range.")
            ia, ib = order.index(a), order.index(b)
            order[ia], order[ib] = order[ib], order[ia]
        att.restores.append(_apply_order(model, mp, order))
        return

    if k in ("sample", "contrast", "chorus"):
        return      # read by the generation loop

    if k == "token":
        if s.params.get("mode", "zero") == "ban":
            return  # read by the generation loop
        ids = [_single_token(tok, w, s.lineno) for w in _words(s.params["word"]) if w.strip(" ")]
        att.handles.append(mp.embed.register_forward_hook(ctx.watch(embed_zero_hook(ids), "fwd")))
        return

    raise ChainError(f"Line {s.lineno}: {k} cannot target {t}.")


def _rlayers(spec: str, n_blocks: int, lineno: int) -> List[int]:
    """Residual-stream layers, 0 (embedding output) to n_blocks."""
    if str(spec).strip().lower() == "emb":
        return [0]
    return _layers(spec, n_blocks + 1, lineno)


def _resid(mp, spec, s: Strip, ctx, att: Attached, make: Callable):
    for layer in _rlayers(spec, mp.n_layers, s.lineno):
        if layer == 0:
            att.handles.append(mp.block(0).register_forward_pre_hook(
                ctx.watch(resid_hook(make(0), ctx, pre=True), "pre_kw"), with_kwargs=True))
        else:
            att.handles.append(mp.block(layer - 1).register_forward_hook(ctx.watch(resid_hook(make(layer), ctx), "fwd")))


def _attach_pan(model, mp, blocks, strength: float, ctx) -> Callable:
    """Pan: a bias by distance added to the attention scores of the chosen blocks, through an
    attention function registered for the run. For a query at position q and a key at k <= q,
    the bias is -strength * (q - k) / q: with strength above 0, distant keys lose up to
    `strength` (attention moves toward the most recent tokens); below 0, they gain (toward the
    start). The function wraps the model's own attention implementation; the run context's off
    switch turns the bias off (for Contrast's original pass)."""
    import importlib
    from transformers.modeling_utils import ALL_ATTENTION_FUNCTIONS
    cfg = model.config
    impl = cfg._attn_implementation
    # the model family's own eager attention, which returns the attention weights (for the scope)
    base = getattr(importlib.import_module(type(mp.attn(0)).__module__), "eager_attention_forward")

    def panned(module, query, key, value, attention_mask, *args, **kwargs):
        li = getattr(module, "layer_idx", None)
        if ctx.off or (li is not None and li not in blocks):
            return base(module, query, key, value, attention_mask, *args, **kwargs)
        qn, kn = query.shape[-2], key.shape[-2]
        q = torch.arange(kn - qn, kn, device=query.device).view(-1, 1)
        k = torch.arange(kn, device=query.device).view(1, -1)
        dist = (q - k).clamp_min(0).to(query.dtype)
        bias = -strength * dist / q.clamp_min(1).to(query.dtype)
        causal = torch.where(k <= q, torch.zeros((), dtype=query.dtype, device=query.device),
                             torch.tensor(torch.finfo(query.dtype).min, dtype=query.dtype, device=query.device))
        add = (bias + causal).view(1, 1, qn, kn)
        if attention_mask is None:
            mask = add
        else:
            m = attention_mask[..., :kn]
            if m.dtype == torch.bool:                  # True means attend: make it additive
                m = torch.where(m, torch.zeros((), dtype=query.dtype, device=query.device),
                                torch.tensor(torch.finfo(query.dtype).min, dtype=query.dtype, device=query.device))
            mask = m.to(query.dtype) + bias.view(1, 1, qn, kn)
        kwargs = dict(kwargs, is_causal=False)
        return base(module, query, key, value, mask, *args, **kwargs)
    name = "abliteration_pan"
    ALL_ATTENTION_FUNCTIONS[name] = panned
    cfg._attn_implementation = name
    for m in model.modules():                          # attention modules keep their own config reference
        c = getattr(m, "config", None)
        if c is not None and c is not cfg and hasattr(c, "_attn_implementation"):
            c._attn_implementation = name

    def restore():
        cfg._attn_implementation = impl
        for m in model.modules():
            c = getattr(m, "config", None)
            if c is not None and hasattr(c, "_attn_implementation") and c._attn_implementation == name:
                c._attn_implementation = impl
    return restore


def _apply_order(model, mp, order: List[int]) -> Callable:
    """Replace the block list with the blocks in a new order (skip, repeat, swap).
    The KV cache is off while this is in place, since repeated blocks would write to it
    twice; the generation loop recomputes the whole sequence at each step instead."""
    original = mp.blocks
    blocks = torch.nn.ModuleList([original[i] for i in order])
    cfg = model.config
    n_attr = "n_layer" if hasattr(cfg, "n_layer") and mp.family == "gpt2" else "num_hidden_layers"
    old_n = getattr(cfg, n_attr)
    setattr(mp.blocks_owner, mp.blocks_attr, blocks)
    setattr(cfg, n_attr, len(order))
    lt = getattr(cfg, "layer_types", None)
    if lt is not None:
        cfg.layer_types = [lt[i] for i in order]

    def restore():
        setattr(mp.blocks_owner, mp.blocks_attr, original)
        setattr(cfg, n_attr, old_n)
        if lt is not None:
            cfg.layer_types = lt
    return restore


def _pair(v: str, lineno: int) -> List[str]:
    parts = v.split(",")
    if len(parts) != 2:
        raise ChainError(f"Line {lineno}: give two values separated by a comma, as in swap=\" not, also\".")
    return parts


def _single_token(tok, word: str, lineno: int) -> int:
    ids = tok(word, add_special_tokens=False).input_ids
    if len(ids) != 1:
        raise ChainError(f"Line {lineno}: '{word}' is {len(ids)} tokens for this model; "
                         "an embedding bend needs a single token (GPT-2 tokens usually start with a space).")
    return ids[0]


# ---------------------------------------------------------------------------
# The Code view
# ---------------------------------------------------------------------------

def _resid_lines(mp, spec, s: Strip, e: str) -> List[str]:
    out = []
    for layer in _rlayers(spec, mp.n_layers, s.lineno):
        ee = e.replace("(layer)", f"({layer})").replace("layer=layer", f"layer={layer}")
        if layer == 0:
            out.append(f"{mp.path('block', 0)}.register_forward_pre_hook("
                       f"resid_hook({ee}, ctx, pre=True), with_kwargs=True)   # layer 0: the embedding output")
        else:
            out.append(f"{mp.path('block', layer - 1)}.register_forward_hook(resid_hook({ee}, ctx))"
                       f"   # layer {layer}")
    return out


def code_view(chain: Chain, mp) -> str:
    """The registration lines for this chain and the source of every hook factory they use."""
    from . import vauhost
    lines = ["# The hooks Abliteration Lens will register for the diverged run, in chain order.",
             "# The original run registers none. Sampler bends act on the logits in the loop.", ""]
    used: List[Callable] = []

    def use(*fs):
        for f in fs:
            if f not in used:
                used.append(f)

    for s in chain.active:
        t, tv = s.target()
        lines.append(f"# line {s.lineno}: {s.text()}")
        try:
            if s.kind in ("ablate", "scale") and t == "head":
                mode = "scale" if s.kind == "scale" else s.params.get("mode", "zero")
                for layer, hs in _heads(tv, mp, s.lineno):
                    extra = f", k={s.params.get('k', '1')}" if mode == "scale" else (
                        ", means=means.heads(%d)" % layer if mode == "mean" else "")
                    lines.append(f"{mp.path('head_proj', layer)}.register_forward_pre_hook("
                                 f"head_hook({hs}, d_head={mp.d_head}, mode='{mode}'{extra}))")
                use(head_hook)
            elif s.kind in ("ablate", "scale") and t in ("attn", "mlp"):
                mode = "scale" if s.kind == "scale" else s.params.get("mode", "zero")
                for layer in _layers(tv, mp.n_layers, s.lineno):
                    extra = f", k={s.params.get('k', '1')}" if mode == "scale" else (
                        f", mean=means.output('{t}', {layer})" if mode == "mean" else "")
                    lines.append(f"{mp.path(t, layer)}.register_forward_hook(output_hook('{mode}'{extra}))")
                use(output_hook, _first, _replace_first)
            elif s.kind in ("ablate", "scale") and t == "block":
                mode = "scale" if s.kind == "scale" else s.params.get("mode", "zero")
                for layer in _layers(tv, mp.n_layers, s.lineno):
                    extra = f", k={s.params.get('k', '1')}" if mode == "scale" else (
                        f", mean=means.output('block', {layer})" if mode == "mean" else "")
                    lines.append(f"{mp.path('block', layer)}.register_forward_hook("
                                 f"block_hook('{mode}'{extra}), with_kwargs=True)")
                use(block_hook, _first, _replace_first)
            elif s.kind in ("scale", "steer", "project", "noise") :
                lines.extend(vauhost.own_code(s))
                if s.kind == "scale":
                    e = f"scale_edit({s.params.get('k', '1')})"; use(scale_edit)
                elif s.kind == "steer":
                    e = f"steer_edit(directions['{s.params['dir']}'].vector(layer), {s.params.get('scale', '1')})"; use(steer_edit)
                elif s.kind == "project":
                    kk, to = s.params.get("k", "1"), s.params.get("to", "zero")
                    what = f"subspace('{s.params['dir']}', k={kk})[layer]" if kk not in ("1", "") else f"directions['{s.params['dir']}'].unit(layer)"
                    e = f"project_edit({what}, '{s.params.get('mode', 'remove')}'{', mean=corpus_mean[layer]' if to == 'mean' else ''})"; use(project_edit)
                else:
                    e = (f"noise_edit({s.params.get('sigma', '0')}, absolute={bool(int(s.params.get('abs', '0')))}, "
                         f"seed={s.params.get('seed', 'run_seed')}, layer=layer)"); use(noise_edit)
                lines.extend(_resid_lines(mp, tv, s, e))
                use(resid_hook, _first, _replace_first)
            elif s.kind == "transplant":
                layer = _rlayers(tv, mp.n_layers, s.lineno)[0]
                lines.append(f"source = residual stream at layer {layer}, position "
                             f"{s.params.get('from', '-1')}, from a run on {s.params['prompt']!r}")
                lines.extend(_resid_lines(mp, str(layer), s,
                                          f"transplant_edit(source, at={s.params.get('at', '-1')})"))
                use(transplant_edit, resid_hook)
            elif s.kind == "vocoder":
                lines.append(f"# the modulator: the stream at layer {s.params.get('layer')} over {s.params.get('prompt')!r}, unchanged model; "
                             f"its size in {s.params.get('bands', '16')} log-spaced bands of principal directions")
                lines.extend(_resid_lines(mp, s.params.get("layer", "6"), s, f"vocoder_edit(corpus_mean[layer], bands, modulator_levels, mix={s.params.get('mix', '1')})"))
                use(vocoder_edit, vocoder_bands, resid_hook)
            elif s.kind == "pan":
                lines.append(f"model.config._attn_implementation = 'abliteration_pan'   # blocks {s.params.get('block', 'all')}: "
                             f"scores += -{float(s.params.get('pan', '0')) * float(s.params.get('depth', '4')):g} * (q - k) / q; restored after the run")
                use(_attach_pan)
            elif s.kind == "rewrite":
                from . import rewrite as rw
                lines.append(f"# k*, d: the key at '{s.params.get('subject')}' and the change that writes {s.params.get('target')!r}, fitted on the unchanged model")
                lines.append(f"{mp.path('mlp_proj', int(s.params.get('block', '5')))}.register_forward_hook(rewrite_hook(c=C^-1 k* / (k* . C^-1 k*), d, amount={s.params.get('amount', '1')}))")
                use(rw.rewrite_hook, rw.fit)
            elif s.kind == "patch":
                from . import rewrite as rw
                lines.append(f"for each parameter in data/patches/{s.params.get('file')}.safetensors: p += {s.params.get('scale', '1')} * change   # restored after the run")
                use(rw.load_patch)
            elif s.kind == "position":
                lines.append(f"model.transformer.wpe.register_forward_hook(position_hook('{s.params.get('mode', 'shift')}', "
                             f"k={s.params.get('k', '0')}, seed={s.params.get('seed', 'run_seed')}, n_pos))")
                use(position_hook)
            elif s.kind == "exit":
                lines.append(f"{mp.path('blocks')} = the first {s.params.get('layer')} blocks only, then the final norm and the output layer"
                             "   # restored after the run; KV cache off")
                use(_apply_order)
            elif s.kind == "embed" and "mix" in s.params:
                a, b = s.params["swap"].split(",")[:2]
                lines.append(f"{mp.path('embed')}.register_forward_hook(embed_mix_hook(id({a!r}), id({b!r}), mix={s.params['mix']}))")
                use(embed_mix_hook)
            elif s.kind == "embed":
                if "swap" in s.params:
                    lines.append(f"{mp.path('embed')}.register_forward_hook(embed_swap_hook(id({s.params['swap'].split(',')[0]!r}), id({s.params['swap'].split(',')[1]!r})))")
                    use(embed_swap_hook)
                if "token" in s.params:
                    lines.append(f"{mp.path('embed')}.register_forward_hook(embed_noise_hook(id({s.params['token']!r}), {s.params.get('sigma', '0.5')}, seed))")
                    use(embed_noise_hook)
            elif s.kind == "coarsen":
                for layer in _layers(tv, mp.n_layers, s.lineno):
                    lines.append(f"for p in {mp.path('block', layer)}.parameters(): "
                                 f"if p.dim() >= 2: p.copy_(fake_quant_int(p, {s.params.get('bits', '8')}))"
                                 "   # restored after the run")
                use(fake_quant_int)
            elif s.kind == "reorder":
                lines.append(f"{mp.path('blocks')} = ModuleList(blocks in the order "
                             f"{s.params}) with the KV cache off   # restored after the run")
                use(_apply_order)
            elif SPECS[s.kind].get("vau"):
                c = vauhost.code(s, mp)
                lines.extend(c["lines"])
                use(*c["uses"])
                if any("register" in l for l in c["lines"]):
                    use(resid_hook)
            elif s.kind in ("tap", "meter", "gauge"):
                lines.append("# a meter: no hook while the texts are written; afterwards one teacher-forced pass")
                lines.append("# over each text keeps the stream here, and changes nothing")
                lines.extend(_resid_lines(mp, tv, s, f"record_edit(probes, {s.lineno})"))
                read = {"tap": "log_softmax(lm_head(final_norm(stream)))",
                        "meter": "stream.norm(dim=-1)",
                        "gauge": f"stream @ directions['{s.params.get('dir', '')}'].unit(layer)"}[s.kind]
                lines.append(f"# reading: {read}")
                use(record_edit, resid_hook)
            elif s.kind == "scope":
                layer, hs = _heads(tv, mp, s.lineno)[0]
                lines.append("# a meter: no hook; afterwards one teacher-forced pass over each text with")
                lines.append(f"# output_attentions=True, reading attentions[{layer}][0, {hs[0]}]")
            elif s.kind == "sample":
                lines.append(f"# sampler level: next-token logits edited in the loop ({s.params})")
            elif s.kind == "token":
                words = _words(s.params.get("word", ""))
                if s.params.get("mode", "zero") == "ban":
                    lines.append(f"# sampler level: logits[first token of each of {words!r}] = -inf at every step")
                else:
                    lines.append(f"{mp.path('embed')}.register_forward_hook(embed_zero_hook([id(w) for w in {words!r}]))")
                    use(embed_zero_hook)
        except ChainError as e:
            lines.append(f"# {e}")
        lines.append("")
    if not chain.active:
        lines.append("# The chain is empty or every line is bypassed: the bent run equals the baseline.")
    lines.append("")
    lines.append("# ---- the hook factories ----")
    for f in used:
        lines.append("")
        lines.append(inspect.getsource(f).rstrip())
    return "\n".join(lines)


# The units (Vector Abliteration Units): the built-in set from the vau package and any in
# data/units/, added to SPECS beside the bench's own strips (see vauhost.py).
from . import vauhost as _vauhost  # noqa: E402

_vauhost.rescan()
