# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
Loudness: how far the chain moves the model's next-token distribution, read at the output,
after the loudness measures of broadcast audio (ITU-R BS.1770, EBU R 128).

At each step of a text, the original model and the diverged model (the chain attached, the
sampler bends left out) each give a distribution over the next token, on the same text. The
reading is the KL divergence of the diverged distribution from the original one, in bits:
KL(P_original || P_diverged), the extra bits per token the original's next token costs when
the diverged model's distribution is used to code it. For small changes the KL grows with the
square of the change in the logits, as power grows with the square of an amplitude, so it is
put in decibels with 10 log10, as LUFS puts mean square. The bench calls its decibel the
vecibel (vB), so that it is not taken for sound: 10 log10 of a ratio of two divergences.

DUFS (Divergence Units relative to Full Scale) is 10 log10(KL / FS), where full scale FS is
log2 of the vocabulary size: the bits a token could carry if every token were equally likely
(15.6 bits for GPT-2). 0 DUFS is a KL of that size; -10 DUFS a tenth of it.

- Momentary: one step.
- Short-term: the mean KL over a window of the last WINDOW steps.
- Integrated: the mean KL over the text, gated as BS.1770 gates: steps below an absolute
  gate (-70 DUFS) are left out, then steps more than 10 vB below the mean of the rest.
- Range: the spread of the short-term readings, the 10th to the 95th percentile, after an
  absolute gate and a gate 20 vB below their mean (as EBU Tech 3342 measures loudness range).
- Peak: the loudest single step.

Both texts are read: the original text (the same text whatever the chain, so the readings
of two chains on it compare directly) and the diverged text.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

import numpy as np
import torch

WINDOW = 8              # short-term window, in steps (tokens)
ABS_GATE = -70.0        # DUFS
REL_GATE = -10.0        # vB below the absolutely gated mean, for the integrated reading
RANGE_GATE = -20.0      # vB below the mean of the short-term readings, for the range
FLOOR = -99.0           # what silence reads


def full_scale(vocab: int) -> float:
    return math.log2(vocab)


def dufs(bits: float, fs: float) -> float:
    if not bits > 0:
        return FLOOR
    return max(FLOOR, 10.0 * math.log10(bits / fs))


def kl_steps(sess, prompt_ids: List[int], cont_ids: List[int], chain, seed: int, directions, means) -> List[float]:
    """KL(P_original || P_diverged) in bits at each step of a text: the distribution over
    continuation token j from the position before it, under the model as it is and under the
    chain. Sampler bends do not change these distributions and are not applied."""
    from .interventions import RunContext, attach
    model, tok, mp = sess.require()
    if not cont_ids:
        return []
    dev = next(model.parameters()).device
    n0, T = len(prompt_ids), len(cont_ids)
    ids = torch.tensor([prompt_ids + cont_ids], device=dev)
    rows = slice(n0 - 1, n0 - 1 + T)
    with torch.no_grad():
        lp = torch.log_softmax(model(ids, use_cache=False).logits[0, rows].float(), -1)
    ctx = RunContext(seed, n0)
    ctx.offset = 0
    att = attach(chain, sess, ctx, directions, means)
    try:
        with torch.no_grad():
            lq = torch.log_softmax(model(ids, use_cache=False).logits[0, rows].float(), -1)
    finally:
        att.remove()
    kl = (lp.exp() * (lp - lq)).sum(-1).clamp_min(0) / math.log(2)
    return [float(x) for x in kl.cpu()]


def measure(kl: List[float], vocab: int) -> Dict[str, Any]:
    """The readings for one text from its per-step KL (bits)."""
    fs = full_scale(vocab)
    x = np.asarray(kl, dtype=np.float64)
    mom = [round(dufs(v, fs), 2) for v in x]
    short_lin = [float(x[max(0, j - WINDOW + 1): j + 1].mean()) for j in range(len(x))]
    short = [round(dufs(v, fs), 2) for v in short_lin]
    out: Dict[str, Any] = {"kl": [round(float(v), 5) for v in x], "momentary": mom, "short": short,
                           "integrated": None, "range": None, "peak": None, "peak_step": None,
                           "mean_bits": round(float(x.mean()), 5) if len(x) else 0.0, "total_bits": round(float(x.sum()), 4),
                           "gated_steps": 0}
    if not len(x):
        return out
    p = int(x.argmax())
    out["peak"], out["peak_step"] = mom[p], p
    g1 = x[[dufs(v, fs) > ABS_GATE for v in x]]
    if len(g1):
        rel = dufs(float(g1.mean()), fs) + REL_GATE
        g2 = g1[[dufs(v, fs) > rel for v in g1]]
        out["integrated"] = round(dufs(float(g2.mean()), fs), 2)
        out["gated_steps"] = int(len(g2))
    s = np.asarray(short_lin)
    s1 = s[[dufs(v, fs) > ABS_GATE for v in s]]
    if len(s1) >= 2:
        rel = dufs(float(s1.mean()), fs) + RANGE_GATE
        db = np.asarray([dufs(v, fs) for v in s1 if dufs(v, fs) > rel])
        if len(db) >= 2:
            out["range"] = round(float(np.percentile(db, 95) - np.percentile(db, 10)), 2)
    return out


def loudness(sess, base: Dict[str, Any], bent: Dict[str, Any], base_ids: List[int], bent_ids: List[int],
             chain, seed: int, directions, means) -> Optional[Dict[str, Any]]:
    """The readings on both texts, or None when no strip changes the model."""
    movers = [s for s in chain.active if s.level not in ("probe", "sampler")]
    if not movers:
        return None
    model, tok, mp = sess.require()
    vocab = int(model.get_output_embeddings().weight.shape[0])
    return {"unit": "DUFS", "full_scale_bits": round(full_scale(vocab), 4), "vocab": vocab, "window": WINDOW,
            "gates": {"absolute": ABS_GATE, "relative": REL_GATE, "range": RANGE_GATE},
            "original": measure(kl_steps(sess, base["prompt_ids"], base_ids, chain, seed, directions, means), vocab),
            "diverged": measure(kl_steps(sess, bent["prompt_ids"], bent_ids, chain, seed, directions, means), vocab)}


# ---------------------------------------------------------------------------
# Sweep: one strip, moved across every place its target can take
# ---------------------------------------------------------------------------

def sweep_targets(s, mp) -> Dict[str, Any]:
    """The places a strip's target can take: every head (layer.head), every block, or every
    place in the stream (0 to the depth)."""
    from .interventions import ChainError
    t, _ = s.target()
    if t == "head":
        return {"kind": t, "rows": mp.n_layers, "cols": mp.n_heads,
                "values": [f"{l}.{h}" for l in range(mp.n_layers) for h in range(mp.n_heads)]}
    if t in ("attn", "mlp", "block"):
        return {"kind": t, "rows": 1, "cols": mp.n_layers, "values": [str(l) for l in range(mp.n_layers)]}
    if t == "layer":
        return {"kind": t, "rows": 1, "cols": mp.n_layers + 1, "values": [str(l) for l in range(mp.n_layers + 1)]}
    raise ChainError(f"Line {s.lineno}: {s.kind} has no target to sweep.")


def sweep(sess, prompt_ids: List[int], cont_ids: List[int], line: str, seed: int, directions, means, emit=None) -> Dict[str, Any]:
    """The strip on `line`, alone, moved across every place its target can take. At each place, one
    teacher-forced pass over the text (prompt_ids + cont_ids, normally a run's original text):
    the KL of the changed model's next-token distribution from the original's at each step, as
    loudness (integrated DUFS), the mean KL in bits, and the share of steps at which the most
    likely next token changes. Nothing is generated."""
    from .interventions import ChainError, RunContext, _quote, attach, parse_chain
    emit = emit or (lambda e: None)
    model, tok, mp = sess.require()
    chain = parse_chain(line)
    strips = [x for x in chain.active if x.level not in ("probe", "sampler")]
    if len(strips) != 1:
        raise ChainError("Sweep one strip that changes the model (not a meter or a sampler bend).")
    s = strips[0]
    tg = sweep_targets(s, mp)
    if not cont_ids:
        raise ValueError("The text to sweep over is empty.")
    vocab = int(model.get_output_embeddings().weight.shape[0])
    dev = next(model.parameters()).device
    n0, T = len(prompt_ids), len(cont_ids)
    ids = torch.tensor([prompt_ids + cont_ids], device=dev)
    rows = slice(n0 - 1, n0 - 1 + T)
    clean = _clean_pass(sess, ids, rows)
    lp = clean[0]
    top0 = lp.argmax(-1)
    emit({"type": "sweep-start", "target": tg["kind"], "rows": tg["rows"], "cols": tg["cols"], "n": len(tg["values"]),
          "line": line, "steps": T})
    cells = []
    for i, v in enumerate(tg["values"]):
        from .analysis import _check_stop
        _check_stop()
        params = dict(s.params)
        params[tg["kind"]] = v
        text = " ".join([s.kind] + [f"{k}={_quote(x)}" for k, x in params.items()])
        c = parse_chain(text)
        rp = repair(sess, ids, rows, c, seed, n0, directions, means, clean)   # one pass: the total, and the direct path beside it
        lq = rp.pop("_lq")
        kl = ((lp.exp() * (lp - lq)).sum(-1).clamp_min(0) / math.log(2)).cpu().tolist()
        m = measure(kl, vocab)
        cell = {"value": v, "line": text, "integrated": m["integrated"], "mean_bits": m["mean_bits"],
                "peak": m["peak"], "flips": round(float((lq.argmax(-1) != top0).float().mean()), 4),
                "repair_vb": rp["repair_vb"], "direct": rp["direct"]}
        cells.append(cell)
        emit({"type": "sweep-cell", "cell": cell, "done": i + 1, "of": len(tg["values"])})
    return {"line": line, "target": tg["kind"], "rows": tg["rows"], "cols": tg["cols"], "steps": T,
            "full_scale_bits": round(full_scale(vocab), 4), "cells": cells}


# ---------------------------------------------------------------------------
# Self-repair: the direct path against the total (McGrath et al. 2023, the Hydra effect)
# ---------------------------------------------------------------------------

def _clean_pass(sess, ids, rows):
    """The unchanged model's log probabilities at `rows`, and its final stream (before the final
    norm) at every position."""
    model, tok, mp = sess.require()
    got = {}
    h = mp.block(mp.n_layers - 1).register_forward_hook(lambda m, a, o: got.__setitem__("h", (o[0] if isinstance(o, tuple) else o)[0].detach()))
    try:
        with torch.no_grad():
            lp = torch.log_softmax(model(ids, use_cache=False).logits[0, rows].float(), -1)
    finally:
        h.remove()
    return lp, got["h"]


def repair(sess, ids, rows, chain, seed: int, n0: int, directions, means, clean=None) -> Dict[str, Any]:
    """For a chain (normally one strip), the loudness of its change carried straight to the output
    (the direct path: every change its hooks make, in the stream's terms, added to the unchanged
    model's final stream, then the final norm and the output layer, as if no later layer reacted)
    against the loudness of what the model does with it (the total). repair_vb = 10 log10(total /
    direct): below 0, the layers after the strip damp its change; above 0, they amplify it. With
    hooks at several places the changes are added, which is an approximation (`places`)."""
    from .interventions import RunContext, attach
    model, tok, mp = sess.require()
    lp, hN = clean if clean is not None else _clean_pass(sess, ids, rows)
    ctx = RunContext(seed, n0)
    ctx.offset = 0
    ctx.length = ids.shape[1]
    ctx.effects, ctx.deltas = {}, []
    att = attach(chain, sess, ctx, directions, means)
    try:
        with torch.no_grad():
            lq = torch.log_softmax(model(ids, use_cache=False).logits[0, rows].float(), -1)
    finally:
        att.remove()
    places = len(ctx.deltas)
    if not places:
        return {"places": 0, "direct": None, "total": None, "repair_vb": None, "_lq": lq}
    delta = torch.stack(ctx.deltas).sum(0).to(hN.device, hN.dtype)
    with torch.no_grad():
        ld = torch.log_softmax(model.get_output_embeddings()(mp.final_norm()(hN + delta))[rows].float(), -1)
    kl = lambda q: ((lp.exp() * (lp - q)).sum(-1).clamp_min(0) / math.log(2))
    kt, kd = kl(lq), kl(ld)
    vocab = int(model.get_output_embeddings().weight.shape[0])
    fs = full_scale(vocab)
    mt, md = float(kt.mean()), float(kd.mean())
    rdb = None if not (mt > 0 and md > 0) else round(10 * math.log10(mt / md), 2)
    return {"places": places, "direct": round(dufs(md, fs), 2) if md > 0 else None, "total": round(dufs(mt, fs), 2) if mt > 0 else None,
            "direct_bits": round(md, 5), "total_bits": round(mt, 5), "repair_vb": rdb,
            "steps_vb": [None if not (a > 1e-9 and b > 1e-9) else round(10 * math.log10(float(a) / float(b)), 2) for a, b in zip(kt, kd)],
            "_lq": lq}


def repairs(sess, prompt_ids: List[int], cont_ids: List[int], chain, seed: int, directions, means) -> List[Dict[str, Any]]:
    """The self-repair readout for each strip of a chain that changes the model, each on its own,
    on one text (a run's original text)."""
    from .interventions import Chain
    model, tok, mp = sess.require()
    if not cont_ids:
        return []
    dev = next(model.parameters()).device
    n0 = len(prompt_ids)
    ids = torch.tensor([prompt_ids + cont_ids], device=dev)
    rows = slice(n0 - 1, n0 - 1 + len(cont_ids))
    clean = _clean_pass(sess, ids, rows)
    out = []
    for s in chain.active:
        if s.level in ("probe", "sampler"):
            continue
        r = repair(sess, ids, rows, Chain(lines=[s]), seed, n0, directions, means, clean)
        r.pop("_lq", None)
        out.append(dict(r, line=s.lineno, kind=s.kind))
    return out
