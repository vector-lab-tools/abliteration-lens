# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
Seeded generation, paired runs and scoring.

The loop is written out instead of calling `model.generate`, so that the seed, the
sampler and the per-token record are in one place:
- each step is one forward pass (with the KV cache, unless a Reorder strip is on);
- the model's own distribution at temperature 1 is recorded for every token
  (log probability, entropy in bits, the top five);
- the next token is drawn on the CPU in float64 with a `torch.Generator` seeded from
  the recipe, after temperature, top-k, top-p and any sampler bends.
A baseline and a bent run with the same recipe differ only in the hooks.
"""
from __future__ import annotations

import math
import platform
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, Iterator, List, Optional

import torch
import transformers

from . import TOOL, VERSION
from .interventions import Chain, RunContext, _heads, _rlayers, attach, parse_chain, sampler_edits
from .means import corpus_sha

LN2 = math.log(2)
TOPN = 5


def sampler_defaults(s: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    s = dict(s or {})
    return {
        "temperature": float(s.get("temperature", 0.8)),
        "top_k": int(s.get("top_k", 40)),
        "top_p": float(s.get("top_p", 0.95)),
        "max_new_tokens": max(1, min(int(s.get("max_new_tokens", 60)), 512)),
        "stop_at_eos": bool(s.get("stop_at_eos", True)),
    }


def contrast_logits(lp_div: torch.Tensor, lp_orig: torch.Tensor, alpha: float, keep: float) -> torch.Tensor:
    """Contrastive decoding (inspired by Li et al. 2022): log p_diverged - alpha log p_original, over the
    tokens the diverged model finds plausible (p at least `keep` times its top p); the rest are
    ruled out. Alpha 0 is the diverged model as it is."""
    out = lp_div - alpha * lp_orig
    plausible = lp_div >= lp_div.max() + math.log(max(keep, 1e-12))
    return torch.where(plausible, out, torch.full_like(out, -math.inf))


def _choose(logits: torch.Tensor, cfg: Dict[str, Any], edits, gen: torch.Generator) -> (int, float):
    """logits: float64 on CPU, (vocab,). Returns the chosen id and its probability under
    the sampling distribution actually used."""
    T = cfg["temperature"]
    l = logits / (T if T > 0 else 1.0)
    for mode, val in edits:
        if mode == "ban-ids" and val:
            l = l.clone()
            l[torch.tensor(val, dtype=torch.long)] = -math.inf
        if mode == "ban-top":
            k = max(1, int(val))
            l = l.clone()
            l[torch.topk(l, k).indices] = -math.inf
    p = torch.softmax(l, -1)
    if cfg["top_k"] > 0:
        k = min(cfg["top_k"], p.numel())
        thresh = torch.topk(p, k).values[-1]
        p = torch.where(p >= thresh, p, torch.zeros_like(p))
    if 0 < cfg["top_p"] < 1:
        sp, si = torch.sort(p, descending=True)
        cum = torch.cumsum(sp, 0) / sp.sum()
        keep = cum - sp / sp.sum() < cfg["top_p"]
        keep[0] = True
        mask = torch.zeros_like(p, dtype=torch.bool)
        mask[si[keep]] = True
        p = torch.where(mask, p, torch.zeros_like(p))
    p = p / p.sum()
    for mode, val in edits:
        if mode == "ceiling":
            q = torch.where(p <= val, p, torch.zeros_like(p))
            if q.sum() > 0:
                p = q / q.sum()
            else:                         # nothing under the ceiling: take the least probable candidate
                nz = torch.nonzero(p).flatten()
                p = torch.zeros_like(p)
                p[nz[torch.argmin(logits[nz])]] = 1.0
        elif mode == "invert":
            p = torch.where(p > 0, 1.0 / p, torch.zeros_like(p))
            p = p / p.sum()
    if T <= 0:
        i = int(torch.argmax(p))
    else:
        i = int(torch.multinomial(p, 1, generator=gen))
    return i, float(p[i])


def _record(tok, logits32: torch.Tensor, chosen: int) -> Dict[str, Any]:
    lp = torch.log_softmax(logits32.double(), -1)
    p = lp.exp()
    ent = float(-(p * lp).sum() / LN2)
    top = torch.topk(lp, TOPN)
    rank = int((lp > lp[chosen]).sum()) + 1
    return {
        "id": chosen,
        "t": tok.decode([chosen]),
        "lp": float(lp[chosen]),
        "ent": ent,
        "rank": rank,
        "top": [[tok.decode([int(i)]), float(v)] for v, i in zip(top.values, top.indices)],
    }


def _chorus_hook(mp, ctx, chorus, seed: int, att) -> List[int]:
    """Chorus's detuning: on the stream at its layer, noise (scaled to the stream's size there,
    as Noise's is) from each voice's own seed, added only in that voice's passes."""
    from .interventions import _mix, noise_edit, resid_hook
    layer, n, sigma = chorus
    edits = {v: noise_edit(sigma, False, _mix(seed, 7919, v), layer) for v in range(n)}

    def edit(h, pos):
        return h if ctx.voice is None else edits[ctx.voice](h, pos)
    if layer == 0:
        att.handles.append(mp.block(0).register_forward_pre_hook(resid_hook(edit, ctx, pre=True), with_kwargs=True))
    else:
        att.handles.append(mp.block(min(layer, mp.n_layers) - 1).register_forward_hook(resid_hook(edit, ctx)))
    return list(range(n))


def run_one(sess, prompt: str, chain: Optional[Chain], cfg: Dict[str, Any], seed: int,
            directions, means, on_token: Optional[Callable[[Dict[str, Any]], None]] = None) -> Dict[str, Any]:
    model, tok, mp = sess.require()
    dev = next(model.parameters()).device
    prompt_ids = tok(prompt, return_tensors="pt").input_ids.to(dev)
    n0 = prompt_ids.shape[1]
    ctx = RunContext(seed, n0)
    edits = sampler_edits(chain, tok) if chain else []
    full = chain.needs_full_recompute() if chain else False
    contrast = next((v for m, v in edits if m == "contrast" and v[0] > 0), None)     # alpha 0: the diverged model as it is
    chorus = next((v for m, v in edits if m == "chorus"), None)
    if contrast and chain and any(s.level in ("weights", "order") for s in chain.active):
        from .interventions import ChainError
        raise ChainError("Contrast reads the original model at each step, so it cannot run beside a strip that changes the "
                         "model itself (Coarsen, Reorder, Exit).")
    att = attach(chain, sess, ctx, directions, means) if chain else None
    voices = []
    if chorus and chorus[1] > 0:
        voices = _chorus_hook(mp, ctx, chorus, seed, att)
    gen = torch.Generator(device="cpu").manual_seed(int(seed))
    eos = tok.eos_token_id
    tokens: List[Dict[str, Any]] = []
    t0 = time.time()
    try:
        with torch.no_grad():
            ids = prompt_ids
            past = None
            cur = ids
            ctx.offset = 0
            side = {"orig": None, **{f"v{v}": None for v in voices}}     # the other passes' caches

            def other(key, setup):
                """One more pass this step (the original model, or a Chorus voice), with its own cache."""
                setup(True)
                try:
                    if full:
                        ctx.offset = 0
                        o = model(ids, use_cache=False)
                    else:
                        o = model(cur, past_key_values=side[key], use_cache=True)
                        side[key] = o.past_key_values
                finally:
                    setup(False)
                return o.logits[0, -1].float().cpu()
            for step in range(cfg["max_new_tokens"]):
                off0 = ctx.offset
                if full:
                    ctx.offset = 0
                    out = model(ids, use_cache=False)
                else:
                    out = model(cur, past_key_values=past, use_cache=True)
                    past = out.past_key_values
                logits = out.logits[0, -1].float().cpu()
                pick = logits.double()
                if voices:                                  # Chorus: the dry pass and each voice, probabilities averaged
                    ps_all = [torch.softmax(pick, -1)]
                    for v in voices:
                        ctx.offset = off0
                        def setv(on, v=v):
                            ctx.voice = v if on else None
                        ps_all.append(torch.softmax(other(f"v{v}", setv).double(), -1))
                    pick = torch.log(torch.stack(ps_all).mean(0).clamp_min(1e-300))
                if contrast:                                # Contrast: against the original model, same step
                    ctx.offset = off0
                    def seto(on):
                        ctx.off = on
                    lo = other("orig", seto).double()
                    pick = contrast_logits(torch.log_softmax(pick, -1), torch.log_softmax(lo, -1), contrast[0], contrast[1])
                i, ps = _choose(pick, cfg, edits, gen)
                rec = _record(tok, logits, i)
                rec["ps"] = ps
                tokens.append(rec)
                if on_token:
                    on_token(rec)
                nxt = torch.tensor([[i]], device=dev)
                if not full:
                    ctx.offset = ids.shape[1]
                ids = torch.cat([ids, nxt], 1)
                cur = nxt
                if cfg["stop_at_eos"] and eos is not None and i == eos:
                    break
    finally:
        if att:
            att.remove()
    return {
        "prompt_ids": prompt_ids[0].tolist(),
        "tokens": tokens,
        "text": tok.decode([t["id"] for t in tokens], skip_special_tokens=True),
        "seconds": round(time.time() - t0, 3),
    }


def score(sess, prompt_ids: List[int], cont_ids: List[int], chain: Optional[Chain], seed: int,
          directions, means) -> List[Dict[str, Any]]:
    """Teacher-forced: each continuation token's log probability, entropy and top five under
    the model as the chain leaves it (or unbent, with chain=None). Sampler bends do not apply."""
    model, tok, mp = sess.require()
    dev = next(model.parameters()).device
    if not cont_ids:
        return []
    ids = torch.tensor([prompt_ids + cont_ids], device=dev)
    ctx = RunContext(seed, len(prompt_ids))
    ctx.offset = 0
    att = attach(chain, sess, ctx, directions, means) if chain else None
    try:
        with torch.no_grad():
            logits = model(ids, use_cache=False).logits[0].float().cpu()
    finally:
        if att:
            att.remove()
    out = []
    n0 = len(prompt_ids)
    for j, c in enumerate(cont_ids):
        out.append(_record(tok, logits[n0 - 1 + j], c))
    return out


def probe_strips(chain: Optional[Chain]):
    return [s for s in chain.active if s.level == "probe"] if chain else []


def read_probes(sess, prompt_ids: List[int], cont_ids: List[int], chain: Chain, probes_only: bool,
                seed: int, directions, means) -> Dict[str, Any]:
    """Fill the chain's meters for one text. One teacher-forced pass over the prompt and the
    continuation, with the whole chain (the bent text) or with the meters alone (the baseline).
    Step j is the forward position that chose continuation token j: it reads the token before
    (the last prompt token at j = 0) and writes token j."""
    model, tok, mp = sess.require()
    strips = probe_strips(chain)
    movers = [] if probes_only else [s for s in chain.active if s.level not in ("probe", "sampler")]
    if not (strips or movers) or not cont_ids:
        return {"context": [], "lines": {}, "effects": []}
    dev = next(model.parameters()).device
    n0, T = len(prompt_ids), len(cont_ids)
    ids = torch.tensor([prompt_ids + cont_ids], device=dev)
    ctx = RunContext(seed, n0)
    ctx.offset = 0
    ctx.probes = {}
    ctx.length = n0 + T
    if not probes_only:
        ctx.effects, ctx.measures = {}, {}
    use = Chain(lines=list(strips)) if probes_only else chain
    att = attach(use, sess, ctx, directions, means)
    rows = slice(n0 - 1, n0 - 1 + T)
    out: Dict[int, List[Dict[str, Any]]] = {}
    try:
        with torch.no_grad():
            res = model(ids, use_cache=False, output_attentions=any(s.kind == "scope" for s in strips))
            for s in strips:
                from . import vauhost
                u = vauhost.unit(s.kind)
                if u is not None:                       # a meter unit: read through VAU
                    data = {"tokens": list(cont_ids), "decode": lambda ids: tok.decode(ids)}
                    if u.m["site"] == "stream":
                        data["stream"] = ctx.probes[s.lineno][rows].float().cpu()
                    else:
                        data["logprobs"] = torch.log_softmax(res.logits[0, rows].float(), -1).cpu()
                    out[s.lineno] = vauhost.read(s, data)
                    continue
                if s.kind == "scope":
                    layer, heads = _heads(s.params["head"], mp, s.lineno)[0]
                    w = res.attentions[layer][0, heads[0], rows].float().cpu()
                    out[s.lineno] = [{"w": [round(float(x), 4) for x in w[j, : n0 + j]]} for j in range(T)]
                    continue
                h = ctx.probes[s.lineno][rows]
                if s.kind == "meter":
                    out[s.lineno] = [{"norm": float(x)} for x in h.float().norm(dim=-1).cpu()]
                elif s.kind == "gauge":
                    layer = _rlayers(s.params["layer"], mp.n_layers, s.lineno)[0]
                    u = directions.get(s.params["dir"], s.lineno).unit(layer, dev).float()
                    hf = h.float()
                    proj = (hf @ u).cpu()
                    share = (hf @ u) / hf.norm(dim=-1).clamp_min(1e-9)
                    out[s.lineno] = [{"proj": float(p), "cos": float(c)} for p, c in zip(proj, share.cpu())]
                else:                                   # tap: the logit lens
                    head, norm = model.get_output_embeddings(), mp.final_norm()
                    recs = []
                    for a in range(0, T, 64):
                        lp = torch.log_softmax(head(norm(h[a:a + 64])).float(), -1).cpu()
                        for j in range(lp.shape[0]):
                            c = cont_ids[a + j]
                            top = torch.topk(lp[j], TOPN)
                            recs.append({"top": [[tok.decode([int(i)]), float(v)] for v, i in zip(top.values, top.indices)],
                                         "lp": float(lp[j, c]), "rank": int((lp[j] > lp[j, c]).sum()) + 1})
                    out[s.lineno] = recs
    finally:
        att.remove()
    # each strip's change at each step, averaged over its hooks (a strip on layer=all has one per layer).
    # Strips with no hooks (Coarsen and Reorder act on weights and order) have no entry.
    effects = []
    for s in movers:
        got = (ctx.effects or {}).get(s.lineno) or []
        if got:
            e = torch.stack(got).mean(0)[rows]
            row = {"line": s.lineno, "kind": s.kind, "effect": [round(float(x), 4) for x in e]}
            ms = (ctx.measures or {}).get(s.lineno) or []
            if ms:                                                # gain (dB), turn (degrees), touched (share) at each step: a unit's summary (VAU SPEC 5e)
                mm = torch.stack(ms).mean(0)[rows]
                row["measures"] = {k: [round(float(x), 4) for x in mm[:, c]] for c, k in enumerate(("gain", "turn", "touched"))}
            effects.append(row)
    return {"context": [tok.decode([i]) for i in prompt_ids + cont_ids], "lines": out, "effects": effects}


# ---------------------------------------------------------------------------
# Baselines are cached: they do not depend on the chain.
# ---------------------------------------------------------------------------

class BaselineCache:
    def __init__(self, size: int = 64):
        self.size = size
        self.d: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()

    def key(self, sess, prompt, cfg, seed) -> str:
        i = sess.info
        return repr((i.get("model_id"), i.get("revision_hash"), i.get("dtype"), i.get("device"),
                     prompt, sorted(cfg.items()), int(seed)))

    def get(self, k):
        if k in self.d:
            self.d.move_to_end(k)
            return self.d[k]
        return None

    def put(self, k, v):
        self.d[k] = v
        self.d.move_to_end(k)
        while len(self.d) > self.size:
            self.d.popitem(last=False)

    def clear(self):
        self.d.clear()


baselines = BaselineCache()


def baseline(sess, prompt, cfg, seed, directions, means, on_token=None) -> Dict[str, Any]:
    k = baselines.key(sess, prompt, cfg, seed)
    hit = baselines.get(k)
    if hit is not None:
        if on_token:
            for t in hit["tokens"]:
                on_token(t)
        return hit
    r = run_one(sess, prompt, None, cfg, seed, directions, means, on_token)
    baselines.put(k, r)
    return r


# ---------------------------------------------------------------------------
# Recipes
# ---------------------------------------------------------------------------

def dir_names(chain: Chain) -> List[str]:
    out = []
    from .vauhost import direction_names
    for s in chain.active:
        for n in direction_names(s):                            # a unit may name several
            if n not in out:
                out.append(n)
    return out


def make_recipe(sess, prompt: str, chain_text: str, cfg: Dict[str, Any], seed: int,
                directions) -> Dict[str, Any]:
    from .vauhost import provenance
    chain = parse_chain(chain_text)
    i = sess.info
    uses_means = any(s.params.get("mode") == "mean" for s in chain.active)
    return {
        "format": "divergence-bench.recipe.v1",
        "tool": {"name": TOOL, "version": VERSION},
        "model": {k: i.get(k) for k in ("model_id", "revision", "revision_hash", "dtype", "device",
                                         "architecture", "n_layers", "n_heads", "d_model")},
        "prompt": prompt,
        "seed": int(seed),
        "sampler": cfg,
        "chain": {"text": chain_text, "strips": chain.canonical()},
        "units": provenance(chain),
        "directions": directions.for_recipe(dir_names(chain)),
        "mean_corpus_sha256": corpus_sha() if uses_means else None,
        "environment": {"torch": torch.__version__, "transformers": transformers.__version__,
                        "python": platform.python_version(), "machine": platform.machine()},
    }
