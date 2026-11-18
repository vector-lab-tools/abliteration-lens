"""The abliteration page's figures (docs/abliteration.html): real runs of the Lens, written to
docs/abliteration-data.js as window.ABL.

Every text is GPT-2 small writing from the page's prompt with the run's sampler and seed, original
and bent with the same seed, by this backend in process; nothing is written by hand. Beside each
seed-42 text the page gives measures the Lens itself reports: the word edit distance from the
original, where the two texts part, and the loudness of the change (DUFS); and, for the negation
direction, negation words per 1,000 words over eight seeds, since one text is too short
to count in. Run from the repo:

    .venv/bin/python tools/abliteration_page.py
"""
from __future__ import annotations

import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

MODEL = "openai-community/gpt2"
PROMPT = "The trouble with the archive is that it"
NOT_PROMPT = "Memory is not the same as the archive, because"
SEED, SEEDS, TOKENS = 42, list(range(40, 48)), 50


NEG = re.compile(r"\b(?:not|no|never|nothing|none|nobody|neither|nor|cannot)\b ?", re.I)
CONTRACT = {"can't": "can", "won't": "will", "shan't": "shall"}


def delete_negations(text: str) -> str:
    """The nearest ordinary edit to removing negation: the negation words deleted from the text
    (can't → can, don't → do, isn't → is), nothing else changed."""
    t = re.sub(r"\b(\w+)n't\b", lambda m: CONTRACT.get(m.group(0).lower(), m.group(1)), text)
    t = re.sub(r"\b(can|won|shan)'t\b", lambda m: CONTRACT[m.group(0).lower()], t, flags=re.I)
    return re.sub(r"[ \t]{2,}", " ", NEG.sub("", t))


def main() -> None:
    only = [a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--only=")]
    only = set(only[0].split(",")) if only else None
    want = lambda k: only is None or k in only
    import torch
    import transformers
    import vau
    from abliteration import TOOL, VERSION
    from abliteration import directions as dr
    from abliteration import textmetrics as tm
    from abliteration.generate import run_one, sampler_defaults
    from abliteration.interventions import parse_chain
    from abliteration.loudness import loudness
    from abliteration.means import Means
    from abliteration.model import session

    session.load(MODEL, "main")
    means = Means(session)
    cfg = sampler_defaults({"max_new_tokens": TOKENS})
    originals = {}

    def gen(prompt, chain, seed=SEED):
        return run_one(session, prompt, parse_chain(chain) if chain else None, cfg, seed, dr.registry, means)

    def original(prompt, seed=SEED):
        if (prompt, seed) not in originals:
            originals[prompt, seed] = gen(prompt, "", seed)
        return originals[prompt, seed]

    ids = lambda r: [t["id"] for t in r["tokens"]]
    neg = lambda text: tm.texture(text)["stance"]["negation"]
    words = lambda text: max(1, tm.texture(text)["words"])

    def bent(chain, prompt=PROMPT, per_1000=False):
        """The seed-42 text with the chain, against the original, and the measures beside it."""
        a, b = original(prompt), gen(prompt, chain)
        d = tm.distances(a["text"], b["text"], ids(a), ids(b))
        out = {"chain": chain, "text": b["text"], "edit": round(d["edit"], 3), "parts": d["first_divergence"], "neg": neg(b["text"])}
        if chain:
            ld = loudness(session, a, b, ids(a), ids(b), parse_chain(chain), SEED, dr.registry, means)
            out["dufs"] = None if ld["original"]["integrated"] is None else round(ld["original"]["integrated"], 1)
        if per_1000:                      # negation words per 1,000 words, over eight seeds
            n = w = 0
            for s in SEEDS:
                t = (gen(prompt, chain, s) if chain else original(prompt, s))["text"]
                n, w = n + neg(t), w + words(t)
            out["neg_per_1000"] = round(1000 * n / w, 1)
        print(f"{chain or '(original)':64s} edit {out['edit']:.2f}  neg {out['neg']}  {out.get('neg_per_1000', '')}  {b['text'][:60]!r}", flush=True)
        return out

    out = ROOT / "docs" / "abliteration-data.js"
    data = json.loads(out.read_text().split("window.ABL = ", 1)[1].rstrip().rstrip(";")) if only else {}
    # 02: add, remove, turn along the negation direction
    if want("moves"): data["moves"] = {
        "add": [bent(f"steer layer=6 dir=negation scale={v}", per_1000=True) | {"v": v} for v in (-4, -2, 0, 2, 4)],
        "remove": [bent(f"abliterate block=all dir=negation strength={v}", per_1000=True) | {"v": v} for v in (0, 0.5, 1, 1.5)],
        "turn": [bent(f"shifter layer=6 dir=negation dir2=not-x-but-y angle={v}", per_1000=True) | {"v": v} for v in (0, 45, 90, 135, 180)],
    }
    # 03: Not. Deleting the negation words from the text, against bending the model
    o = original(NOT_PROMPT)
    if want("not"): data["not"] = {"prompt": NOT_PROMPT, "original": o["text"], "edited": delete_negations(o["text"]),
                   "model": bent("project layer=all dir=negation to=mean", NOT_PROMPT, per_1000=True),
                   "orig_neg_per_1000": bent("", NOT_PROMPT, per_1000=True)["neg_per_1000"]}
    # 03: Echo. Each four words again on the text, against vLookback on the stream
    w = original(PROMPT)["text"].split()
    echo = []
    for i in range(0, len(w), 4):
        echo += w[i:i + 4] + ([f"({' '.join(w[i:i + 4])})"] if i + 4 <= len(w) else [])
    if want("echo"): data["echo"] = {"text_echo": " " + " ".join(echo), "model": bent("delay layer=6 time=4 feedback=0.3 mix=0.5"),
                    "model_more": bent("delay layer=6 time=4 feedback=0.6 mix=0.8")}
    # 03: Depth. vSquash at every layer
    if want("depth"): data["depth"] = [bent(f"saturator layer={l} drive=2") | {"layer": l} for l in range(0, 13)]
    # 03: Movement from inside. The same steer, from token 15 on
    if want("movement"): data["movement"] = {"whole": bent("steer layer=6 dir=negation scale=4"),
                        "from15": bent("steer layer=6 dir=negation scale=4 wfrom=15")}
    # 03: The edge as material
    if want("edge"): data["edge"] = [bent(c) | {"label": lab} for c, lab in (
        ("exit layer=4", "Exit at layer 4"), ("pan block=all depth=4 pan=1", "Pan to the most recent tokens"),
        ("noise layer=6 sigma=1", "Noise, sigma 1"), ("position mode=scramble", "Positions scrambled"))]
    # 03: Takes. The original at eight seeds, and how far apart they are
    takes = [original(PROMPT, s) for s in SEEDS] if want("takes") else []
    pair = [tm.distances(a["text"], b["text"], ids(a), ids(b))["edit"] for i, a in enumerate(takes) for b in takes[i + 1:]]
    if want("takes"): data["takes"] = {"seeds": SEEDS, "texts": [t["text"] for t in takes], "seed_edit": round(sum(pair) / len(pair), 3),
                     "repeat_same": gen(PROMPT, "")["text"] == original(PROMPT)["text"]}

    info = session.info
    rev = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    data["provenance"] = {"generator": f"{TOOL} {VERSION} (tools/abliteration_page.py)", "commit": rev, "vau": vau.__version__,
                          "model": info["model_id"], "revision_hash": info["revision_hash"], "dtype": info["dtype"], "device": info["device"],
                          "prompt": PROMPT, "seed": SEED, "seeds": SEEDS, "sampler": cfg, "torch": torch.__version__,
                          "transformers": transformers.__version__, "date": datetime.date.today().strftime("%-d %B %Y")}
    data["original"] = original(PROMPT)["text"]
    data["original_neg_per_1000"] = data["moves"]["add"][2]["neg_per_1000"]
    out.write_text("// The abliteration page's figures: real runs of Abliteration Lens, made by tools/abliteration_page.py; not written by hand.\n"
                   "window.ABL = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")
    print("wrote", out)


if __name__ == "__main__":
    main()
