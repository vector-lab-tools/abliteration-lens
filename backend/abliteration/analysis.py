# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
Paired runs, dose sweeps, the control band and the component map. Each yields
events (dicts) as it goes, so the server can stream them as NDJSON.
"""
from __future__ import annotations

import json
import math
import re
import statistics
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from . import ROOT, TOOL, VERSION
from . import textmetrics as tm
from .generate import baseline, make_recipe, run_one, sampler_defaults, score, probe_strips, read_probes
from .interventions import ChainError, parse_chain

RUNS = ROOT / "runs"
STOP = threading.Event()


class Stopped(Exception):
    pass


def _check_stop():
    if STOP.is_set():
        raise Stopped()


def _ids(r):
    return [t["id"] for t in r["tokens"]]


def summarise(tokens: List[Dict[str, Any]], text: str) -> Dict[str, Any]:
    s = tm.surprisal_stats([t["lp"] for t in tokens])
    ents = [t["ent"] for t in tokens]
    return dict(tm.texture(text), own_bits=s["bits"], own_ppl=s["ppl"],
                mean_entropy=(sum(ents) / len(ents)) if ents else 0.0, n_tokens=len(tokens))


# ---------------------------------------------------------------------------
# One paired run
# ---------------------------------------------------------------------------

def paired(sess, prompt: str, chain_text: str, sampler: Dict[str, Any], seed: int, directions, means,
           parent: Optional[str] = None, witness_of: Optional[str] = None, label: str = "",
           save: bool = True, emit=None) -> Dict[str, Any]:
    cfg = sampler_defaults(sampler)
    chain = parse_chain(chain_text)
    recipe = make_recipe(sess, prompt, chain_text, cfg, seed, directions)
    emit = emit or (lambda e: None)
    emit({"type": "start", "recipe": recipe})
    base = baseline(sess, prompt, cfg, seed, directions, means,
                    on_token=lambda t: emit({"type": "token", "run": "baseline", "tok": t}))
    _check_stop()
    bent = run_one(sess, prompt, chain, cfg, seed, directions, means,
                   on_token=lambda t: emit({"type": "token", "run": "bent", "tok": t}))
    _check_stop()
    emit({"type": "status", "text": "Scoring each text under the other model"})
    bent_under_base = score(sess, bent["prompt_ids"], _ids(bent), None, seed, directions, means)
    base_under_bent = score(sess, base["prompt_ids"], _ids(base), chain, seed, directions, means)
    run = assemble(recipe, base, bent, bent_under_base, base_under_bent)
    run.update({"parent": parent, "witness_of": witness_of, "label": label})
    meters = probe_strips(chain)
    movers = [s for s in chain.active if s.level not in ("probe", "sampler")]
    if meters or movers:
        emit({"type": "status", "text": "Reading the meters"})
        pb = read_probes(sess, base["prompt_ids"], _ids(base), chain, True, seed, directions, means)
        pn = read_probes(sess, bent["prompt_ids"], _ids(bent), chain, False, seed, directions, means)
        run["probes"] = {
            "effects": pn["effects"],
            "context": {"baseline": pb["context"], "bent": pn["context"]},
            "n_prompt": len(base["prompt_ids"]),
            "strips": [{"line": s.lineno, "kind": s.kind, "params": dict(s.params),
                        "baseline": pb["lines"].get(s.lineno, []), "bent": pn["lines"].get(s.lineno, [])}
                       for s in meters],
        }
    if any(s.level not in ("probe", "sampler") for s in chain.active):
        emit({"type": "status", "text": "Measuring loudness"})
        from .loudness import loudness, repairs
        run["loudness"] = loudness(sess, base, bent, _ids(base), _ids(bent), chain, seed, directions, means)
        run["repair"] = repairs(sess, base["prompt_ids"], _ids(base), chain, seed, directions, means)
    if save:
        save_run(run)
    emit({"type": "result", "run": run})
    return run


def assemble(recipe, base, bent, bent_under_base, base_under_bent) -> Dict[str, Any]:
    bi, ni = _ids(base), _ids(bent)
    dist = tm.distances(base["text"], bent["text"], bi, ni)
    k = dist["first_divergence"]
    div = None
    if k >= 0 and k < len(base["tokens"]) and k < len(bent["tokens"]):
        div = {"index": k, "baseline": base["tokens"][k], "bent": bent["tokens"][k]}
    mb = summarise(base["tokens"], base["text"])
    mn = summarise(bent["tokens"], bent["text"])
    sb = tm.surprisal_stats([t["lp"] for t in base_under_bent])
    sn = tm.surprisal_stats([t["lp"] for t in bent_under_base])
    mb.update(other_bits=sb["bits"], other_ppl=sb["ppl"])        # original text under the diverged model
    mn.update(other_bits=sn["bits"], other_ppl=sn["ppl"])        # diverged text under the original model
    return {
        "format": "divergence-bench.run.v1",
        "id": time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6],
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "recipe": recipe,
        "baseline": {"text": base["text"], "tokens": base["tokens"], "prompt_ids": base["prompt_ids"]},
        "bent": {"text": bent["text"], "tokens": bent["tokens"], "prompt_ids": bent["prompt_ids"]},
        "scores": {"bent_under_baseline": bent_under_base, "baseline_under_bent": base_under_bent},
        "metrics": {"distance": dist, "baseline": mb, "bent": mn},
        "divergence": div,
        "diff": tm.word_diff(base["text"], bent["text"]),
        "band": None,
        "annotations": [],
    }


# ---------------------------------------------------------------------------
# Storage: the variorum
# ---------------------------------------------------------------------------

def save_run(run: Dict[str, Any]):
    RUNS.mkdir(exist_ok=True)
    (RUNS / f"{run['id']}.json").write_text(json.dumps(run))


def load_run(rid: str) -> Dict[str, Any]:
    if not re.fullmatch(r"[0-9A-Za-z-]+", rid):
        raise ValueError("Bad run id.")
    p = RUNS / f"{rid}.json"
    if not p.exists():
        raise FileNotFoundError(rid)
    return json.loads(p.read_text())


def list_runs() -> List[Dict[str, Any]]:
    out = []
    for p in sorted(RUNS.glob("*.json"), reverse=True) if RUNS.exists() else []:
        try:
            r = json.loads(p.read_text())
        except Exception:
            continue
        rc = r["recipe"]
        out.append({
            "id": r["id"], "created": r["created"], "label": r.get("label", ""),
            "parent": r.get("parent"), "witness_of": r.get("witness_of"),
            "model": rc["model"]["model_id"], "revision": rc["model"].get("revision"),
            "prompt": rc["prompt"], "seed": rc["seed"], "chain": rc["chain"]["text"],
            "bent": r["bent"]["text"][:160], "distance": r["metrics"]["distance"],
            "band": bool(r.get("band")), "n_annotations": len(r.get("annotations", [])),
        })
    return out


def delete_run(rid: str):
    p = RUNS / f"{rid}.json"
    if p.exists():
        p.unlink()


# ---------------------------------------------------------------------------
# Control band
# ---------------------------------------------------------------------------

BAND_KEYS = ["edit", "bigram", "first_divergence", "distinct2", "repetition", "own_bits", "under_base_bits"]


def control_band(sess, run: Dict[str, Any], n: int, directions, means, emit=None) -> Dict[str, Any]:
    """n reseeds of the original (seed+1 … seed+n), each measured against the seed's baseline
    as the diverged text is."""
    emit = emit or (lambda e: None)
    rc = run["recipe"]
    cfg, seed, prompt = rc["sampler"], rc["seed"], rc["prompt"]
    base = baseline(sess, prompt, cfg, seed, directions, means)
    rows = []
    for i in range(1, n + 1):
        _check_stop()
        r = baseline(sess, prompt, cfg, seed + i, directions, means)
        d = tm.distances(base["text"], r["text"], _ids(base), _ids(r))
        t = summarise(r["tokens"], r["text"])
        row = {"seed": seed + i, "text": r["text"], "edit": d["edit"], "bigram": d["bigram"],
               "first_divergence": d["first_divergence"], "distinct2": t["distinct2"],
               "repetition": t["repetition"], "own_bits": t["own_bits"], "under_base_bits": t["own_bits"],
               "patterns": t["patterns"]}
        rows.append(row)
        emit({"type": "reseed", "i": i, "n": n, "row": row})
    bent_vals = {
        "edit": run["metrics"]["distance"]["edit"], "bigram": run["metrics"]["distance"]["bigram"],
        "first_divergence": run["metrics"]["distance"]["first_divergence"],
        "distinct2": run["metrics"]["bent"]["distinct2"], "repetition": run["metrics"]["bent"]["repetition"],
        "own_bits": run["metrics"]["bent"]["own_bits"], "under_base_bits": run["metrics"]["bent"]["other_bits"],
    }
    summary = {}
    for k in BAND_KEYS:
        vals = [r[k] for r in rows if not (k == "first_divergence" and r[k] < 0)]
        if not vals:
            continue
        lo, hi = min(vals), max(vals)
        v = bent_vals[k]
        summary[k] = {"min": lo, "max": hi, "mean": statistics.fmean(vals),
                      "sd": statistics.pstdev(vals) if len(vals) > 1 else 0.0,
                      "bent": v, "inside": (lo <= v <= hi) if v is not None and v >= 0 else None}
    band = {"n": n, "seeds": [r["seed"] for r in rows], "rows": rows, "summary": summary,
            "note": "Each reseeded original is measured against the original at the recipe's seed, "
                    "as the diverged text is. Under-original surprisal for a reseed is its own surprisal, "
                    "since a reseed is scored by the model that made it."}
    return band


# ---------------------------------------------------------------------------
# Dose sweep
# ---------------------------------------------------------------------------

DEFAULT_RULE = {"distinct2_ratio": 0.5, "repetition": 0.5, "surprisal_ratio": 3.0}


def _set_param(chain_text: str, lineno: int, key: str, value: str) -> str:
    chain = parse_chain(chain_text)
    for s in chain.strips:
        if s.lineno == lineno:
            s.params[key] = value
            s.on = True
            s.raw = s.text()
            return chain.text()
    raise ChainError(f"There is no strip on line {lineno}.")


def broken(m_bent: Dict[str, Any], m_base: Dict[str, Any], rule: Dict[str, float]) -> List[str]:
    why = []
    if m_base["distinct2"] and m_bent["distinct2"] < rule["distinct2_ratio"] * m_base["distinct2"]:
        why.append(f"distinct-2 below {rule['distinct2_ratio']:g} × the original's")
    if m_bent["repetition"] > rule["repetition"]:
        why.append(f"repetition above {rule['repetition']:g}")
    if m_base["own_bits"] and m_bent["other_bits"] > rule["surprisal_ratio"] * m_base["own_bits"]:
        why.append(f"surprisal under the original model above {rule['surprisal_ratio']:g} × the original text's")
    return why


def dose_sweep(sess, prompt, chain_text, sampler, seed, lineno: int, key: str, values: List[float],
               directions, means, rule=None, emit=None) -> Dict[str, Any]:
    emit = emit or (lambda e: None)
    rule = dict(DEFAULT_RULE, **(rule or {}))
    cfg = sampler_defaults(sampler)
    base = baseline(sess, prompt, cfg, seed, directions, means)
    mb = summarise(base["tokens"], base["text"])
    emit({"type": "baseline", "text": base["text"], "metrics": mb})
    rows, breakdown = [], None
    for v in values:
        _check_stop()
        text = _set_param(chain_text, lineno, key, f"{v:g}")
        chain = parse_chain(text)
        bent = run_one(sess, prompt, chain, cfg, seed, directions, means)
        under = score(sess, bent["prompt_ids"], _ids(bent), None, seed, directions, means)
        mn = summarise(bent["tokens"], bent["text"])
        s = tm.surprisal_stats([t["lp"] for t in under])
        mn.update(other_bits=s["bits"], other_ppl=s["ppl"])
        d = tm.distances(base["text"], bent["text"], _ids(base), _ids(bent))
        why = broken(mn, mb, rule)
        row = {"value": v, "chain": text, "text": bent["text"], "metrics": mn, "distance": d, "broken": why}
        if why and breakdown is None:
            breakdown = v
        rows.append(row)
        emit({"type": "dose", "row": row})
    return {"key": key, "lineno": lineno, "values": values, "rows": rows, "baseline": {"text": base["text"], "metrics": mb},
            "breakdown": breakdown, "rule": rule}


# ---------------------------------------------------------------------------
# Component map
# ---------------------------------------------------------------------------

MAP_KINDS = {
    "head-zero": ("ablate head={l}.{h} mode=zero", "head"),
    "head-mean": ("ablate head={l}.{h} mode=mean", "head"),
    "head-scale": ("scale head={l}.{h} k={k}", "head"),
    "attn-zero": ("ablate attn={l} mode=zero", "layer"),
    "mlp-zero": ("ablate mlp={l} mode=zero", "layer"),
    "mlp-mean": ("ablate mlp={l} mode=mean", "layer"),
    "block-zero": ("ablate block={l} mode=zero", "layer"),
    "block-mean": ("ablate block={l} mode=mean", "layer"),
}

DEFAULT_MAP_PROMPTS = [
    "The real purpose of education is",
    "What makes a city worth living in is",
    "Technology has changed the way we",
]


def _probe_values(text: str, tokens, under) -> Dict[str, float]:
    t = tm.texture(text)
    s = tm.surprisal_stats([x["lp"] for x in under])
    return {"antithesis": sum(v for k, v in t["patterns"].items() if k in (
                "not-x-but-y", "not-just-x-but-y", "it-is-not-x-it-is-y", "what-matters-is-not-x-but-y")),
            "not_x_but_y": t["patterns"]["not-x-but-y"] + t["patterns"]["not-just-x-but-y"],
            "hedging": t["stance"]["hedging"], "boosters": t["stance"]["confident"],
            "limiting": t["stance"]["negation"], "attitude": t["stance"]["evaluative"],
            "distinct2": t["distinct2"], "repetition": t["repetition"], "under_base_bits": s["bits"],
            "words": t["words"]}


def component_map(sess, kind: str, prompts: List[str], sampler, seed: int, k: float, directions, means,
                  extra_chain: str = "", emit=None) -> Dict[str, Any]:
    emit = emit or (lambda e: None)
    if kind not in MAP_KINDS:
        raise ValueError(f"Unknown sweep: {kind}")
    tmpl, grain = MAP_KINDS[kind]
    _, _, mp = sess.require()
    cfg = sampler_defaults(sampler)
    prompts = [p for p in prompts if p.strip()] or DEFAULT_MAP_PROMPTS
    bases = []
    for p in prompts:
        b = baseline(sess, p, cfg, seed, directions, means)
        bases.append(b)
    base_vals = []
    for p, b in zip(prompts, bases):
        base_vals.append(_probe_values(b["text"], b["tokens"], b["tokens"]))
    base_mean = {key: statistics.fmean(v[key] for v in base_vals) for key in base_vals[0]}
    cells = [(l, h) for l in range(mp.n_layers) for h in (range(mp.n_heads) if grain == "head" else [None])]
    emit({"type": "map-start", "kind": kind, "grain": grain, "n_layers": mp.n_layers,
          "n_heads": mp.n_heads if grain == "head" else 1, "cells": len(cells), "prompts": prompts,
          "baseline": base_mean, "baseline_texts": [b["text"] for b in bases]})
    out = []
    t0 = time.time()
    for idx, (l, h) in enumerate(cells):
        _check_stop()
        line = tmpl.format(l=l, h=h, k=f"{k:g}")
        chain = parse_chain((extra_chain + "\n" + line).strip())
        vals, texts = [], []
        for p, b in zip(prompts, bases):
            r = run_one(sess, p, chain, cfg, seed, directions, means)
            under = score(sess, r["prompt_ids"], _ids(r), None, seed, directions, means)
            v = _probe_values(r["text"], r["tokens"], under)
            v["edit"] = tm.distances(b["text"], r["text"], _ids(b), _ids(r))["edit"]
            vals.append(v)
            texts.append(r["text"])
        mean = {key: statistics.fmean(v[key] for v in vals) for key in vals[0]}
        cell = {"layer": l, "head": h, "line": line, "values": mean, "texts": texts}
        out.append(cell)
        emit({"type": "cell", "cell": cell, "done": idx + 1, "of": len(cells),
              "eta": (time.time() - t0) / (idx + 1) * (len(cells) - idx - 1)})
    return {"kind": kind, "grain": grain, "prompts": prompts, "seed": seed, "sampler": cfg,
            "baseline": base_mean, "baseline_texts": [b["text"] for b in bases], "cells": out,
            "model": sess.info}


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------

def export_json(run: Dict[str, Any]) -> Dict[str, Any]:
    """The run with surprisal in bits added to every token record."""
    r = json.loads(json.dumps(run))
    for part in (r["baseline"]["tokens"], r["bent"]["tokens"], r["scores"]["bent_under_baseline"],
                 r["scores"]["baseline_under_bent"]):
        for t in part:
            t["surprisal_bits"] = -t["lp"] / math.log(2)
    r["exported"] = {"tool": TOOL, "version": VERSION, "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                     "units": "lp: natural log probability; ent and surprisal_bits: bits"}
    return r


def _numbered(text: str) -> str:
    return "\n".join(f"{i:>3}  {line}" for i, line in enumerate(text.split("\n"), 1))


def export_markdown(run: Dict[str, Any]) -> str:
    rc, m = run["recipe"], run["metrics"]
    d = m["distance"]
    lines = [f"# Abliteration Lens run {run['id']}", "",
             f"- Model: {rc['model']['model_id']} @ {rc['model'].get('revision')} "
             f"({(rc['model'].get('revision_hash') or '')[:12]}), {rc['model']['dtype']}, {rc['model']['device']}",
             f"- Seed {rc['seed']}; temperature {rc['sampler']['temperature']}, top-k {rc['sampler']['top_k']}, "
             f"top-p {rc['sampler']['top_p']}, {rc['sampler']['max_new_tokens']} tokens",
             f"- Tool: {rc['tool']['name']} {rc['tool']['version']}", "",
             "## Chain", "", "```", rc["chain"]["text"] or "(empty)", "```", "",
             "## Prompt", "", rc["prompt"], "",
             "## Original", "", "```", _numbered(run["baseline"]["text"]), "```", "",
             "## Diverged", "", "```", _numbered(run["bent"]["text"]), "```", "",
             "## Measures", "",
             f"- First divergence at token {d['first_divergence']}" if d["first_divergence"] >= 0 else "- No divergence",
             f"- Word edit distance {d['edit']:.3f}; bigram distance {d['bigram']:.3f}",
             f"- Surprisal (bits per token): original text under its own model {m['baseline']['own_bits']:.3f}, "
             f"under the diverged model {m['baseline']['other_bits']:.3f}; diverged text under its own model "
             f"{m['bent']['own_bits']:.3f}, under the original model {m['bent']['other_bits']:.3f}",
             f"- Distinct-2: original {m['baseline']['distinct2']:.3f}, diverged {m['bent']['distinct2']:.3f}; "
             f"repetition: original {m['baseline']['repetition']:.3f}, diverged {m['bent']['repetition']:.3f}"]
    L = run.get("loudness")
    if L:
        o, dv = L["original"], L["diverged"]
        f = lambda v: "silent" if v is None else f"{v:.1f}"
        lines.append(f"- Loudness at the output (DUFS; full scale {L['full_scale_bits']} bits): integrated {f(o['integrated'])} "
                     f"on the original text, {f(dv['integrated'])} on the diverged text; range "
                     f"{'n/a' if o['range'] is None else format(o['range'], '.1f') + ' vB'}; peak {f(o['peak'])} at step {o['peak_step'] + 1}; "
                     f"mean KL {o['mean_bits']:.3f} bits per token")
    band = run.get("band")
    if band:
        lines += ["", f"## Control band ({band['n']} reseeds)", ""]
        for k, s in band["summary"].items():
            inside = "inside the band" if s["inside"] else ("outside the band" if s["inside"] is False else "")
            lines.append(f"- {k}: bent {s['bent']:.3f}; band {s['min']:.3f} to {s['max']:.3f} {inside}")
    if run.get("annotations"):
        lines += ["", "## Annotations", ""]
        for a in run["annotations"]:
            span = f"L{a['line']}" + (f"-{a['end_line']}" if a.get("end_line") and a["end_line"] != a["line"] else "")
            lines.append(f"- **[{a['type'].upper()}]** ({a['side']} {span}): {a['content']}")
    lines += ["", f"*Exported from {TOOL} {VERSION}*", ""]
    return "\n".join(lines)


def export_benchkit(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Witnesses in the shape bench-kit's versionlist reads: one version per text, its
    lines numbered, descent as parent (a chain derived from another run) and witness
    (a reseed or regeneration of the same recipe). See docs/bench-kit-notes.md."""
    versions, parent, witness = [], {}, {}
    for r in runs:
        for side in ("baseline", "bent"):
            vid = f"{r['id']}-{side}"
            versions.append({
                "id": vid, "label": f"{r.get('label') or r['id']} ({side})", "date": r["created"],
                "summary": r["recipe"]["chain"]["text"] if side == "bent" else "original (no chain)",
                "files": [{"name": f"{vid}.txt", "role": "text",
                           "lines": r[side]["text"].split("\n")}],
                "recipe": r["recipe"],
            })
            if side == "bent":
                parent[vid] = {"id": f"{r['id']}-baseline"}
            if r.get("parent") and side == "bent":
                parent[vid] = {"id": f"{r['parent']}-bent"}
            if r.get("witness_of"):
                witness[vid] = {"id": f"{r['witness_of']}-{side}"}
    return {"format": "abliteration-lens.benchkit-bundle.v1", "tool": {"name": TOOL, "version": VERSION},
            "versions": versions, "parent": parent, "witness": witness}
