"""The built-in strips' help cards: their example texts and parameter notes.

Reads web/explain/chains/*.json (for each strip, one chain per setting its figure walks through)
and web/explain/tips/*.json (what each parameter does), and writes

    web/explain/strips.json     the parameter notes and which strips have a figure
    web/explain/examples.json   GPT-2 small's text at each setting, in the format of vau's
                                examples.json, from the same prompt, seed and sampler, so that
                                the help shows a strip's texts beside the units' ones

The texts are made by this backend, in process, not written by hand. Run from the repo:

    .venv/bin/python tools/strip_examples.py              # both files (loads GPT-2 small)
    .venv/bin/python tools/strip_examples.py --notes-only # strips.json alone
"""
from __future__ import annotations

import datetime
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EX = ROOT / "web" / "explain"
sys.path.insert(0, str(ROOT / "backend"))

MODEL, PROMPT, SEED = "openai-community/gpt2", "What matters about the archive is", 42
METERS = ("tap", "meter", "gauge", "scope")


def merged(folder: str) -> dict:
    out = {}
    for f in sorted((EX / folder).glob("*.json")):
        for k, v in json.loads(f.read_text()).items():
            if k in out:
                raise SystemExit(f"{f.name}: {k} is already in another file")
            out[k] = v
    return out


def notes() -> None:
    tips = merged("tips")
    figures = sorted(p.name[: -len(".explain.js")] for p in EX.glob("*.explain.js"))
    (EX / "strips.json").write_text(json.dumps({"about": "The built-in strips' parameter notes, and the strips with a figure "
                                                "(web/explain/<kind>.explain.js). Made by tools/strip_examples.py.",
                                                "tips": tips, "explain": figures}, ensure_ascii=False, indent=1) + "\n")
    print(f"strips.json: notes for {len(tips)} strips, {len(figures)} figures")


def reading(kind: str, vals: list) -> list:
    """One reading per token of the original text, as the strip's figure reads it: tap, the top
    three words with their probabilities; meter, the stream's size; gauge, its projection on the
    direction; scope, the head's whole row of attention weights."""
    import math
    if kind == "tap":
        return [[[w, round(math.exp(lp), 4)] for w, lp in v["top"][:3]] for v in vals]
    if kind == "meter":
        return [round(v["norm"], 1) for v in vals]
    if kind == "gauge":
        return [round(v["proj"], 2) for v in vals]
    return [[round(x, 3) for x in v["w"]] for v in vals]


def texts() -> None:
    import torch
    import transformers
    import vau
    from abliteration import TOOL, VERSION
    from abliteration import directions as dr
    from abliteration.generate import read_probes, run_one, sampler_defaults
    from abliteration.interventions import parse_chain
    from abliteration.means import Means
    from abliteration.model import session
    from abliteration.rewrite import PATCHES

    before = set(PATCHES.glob("*.safetensors")) if PATCHES.is_dir() else set()
    chains = merged("chains")
    session.load(MODEL, "main")
    means = Means(session)
    cfg = sampler_defaults({"max_new_tokens": 30})
    base = run_one(session, PROMPT, None, cfg, SEED, dr.registry, means)
    ids = [t["id"] for t in base["tokens"]]
    vau_ex = json.loads((Path(vau.__file__).parent / "explain" / "examples.json").read_text())
    if vau_ex["original"]["text"] != base["text"]:
        raise SystemExit("The original text differs from vau's examples.json: the two sets of examples would not match.\n"
                         f"  vau:  {vau_ex['original']['text']!r}\n  here: {base['text']!r}")
    units = {}
    try:
        for kind, rows in chains.items():
            out = []
            for c in rows:
                chain = parse_chain(c)
                if kind in METERS:
                    r = read_probes(session, base["prompt_ids"], ids, chain, True, SEED, dr.registry, means)
                    vals = next(iter(r["lines"].values()))
                    out.append({"chain": c, "reading": reading(kind, vals)})
                else:
                    r = run_one(session, PROMPT, chain, cfg, SEED, dr.registry, means)
                    out.append({"chain": c, "text": r["text"]})
                print(f"{kind:10s} {c.splitlines()[-1][:60]:60s} {str(out[-1].get('text', out[-1].get('reading', ''))[:60])!r}", flush=True)
            units[kind] = out
    finally:
        for f in (set(PATCHES.glob("*.safetensors")) if PATCHES.is_dir() else set()) - before:
            f.unlink()          # a patch an example saved: made for the example only
            for side in f.parent.glob(f.stem + ".*"):
                side.unlink()
    info = session.info
    rev = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    out = {"about": "Example texts for the built-in strips' figures: GPT-2 small continuing one prompt, with the strip at each "
                    "setting the figure shows. Generated with Abliteration Lens's backend, in process (tools/strip_examples.py); "
                    "not written by hand. Meters change nothing: for them, the reading at each token of the original text.",
           "provenance": {"generator": f"{TOOL} {VERSION}", "generator_commit": rev, "vau_version": vau.__version__,
                          "model": info["model_id"], "revision": info["revision"], "revision_hash": info["revision_hash"],
                          "dtype": info["dtype"], "device": info["device"], "prompt": PROMPT, "seed": SEED, "sampler": cfg,
                          "torch": torch.__version__, "transformers": transformers.__version__,
                          "date": datetime.date.today().strftime("%-d %B %Y")},
           "original": {**vau_ex["original"], "prompt_tokens": [session.tokenizer.decode([i]) for i in base["prompt_ids"]]},
           "units": units}
    (EX / "examples.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"examples.json: {sum(len(v) for v in units.values())} rows for {len(units)} strips")


if __name__ == "__main__":
    notes()
    if "--notes-only" not in sys.argv:
        texts()
