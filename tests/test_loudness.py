# Abliteration Lens tests: loudness at the output (DUFS), after ITU-R BS.1770 and EBU R 128.
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import analysis as an
from abliteration import directions as dr
from abliteration.loudness import ABS_GATE, FLOOR, WINDOW, dufs, full_scale, measure
from abliteration.means import Means
from abliteration.model import session

V = 50257
FS = full_scale(V)


def test_full_scale_is_zero_and_a_tenth_is_minus_ten():
    assert dufs(FS, FS) == 0.0
    assert dufs(FS / 10, FS) == pytest.approx(-10.0)
    assert dufs(0.0, FS) == FLOOR


def test_constant_reading():
    kl = [0.5] * 20
    m = measure(kl, V)
    assert m["integrated"] == pytest.approx(round(dufs(0.5, FS), 2))
    assert m["range"] == pytest.approx(0.0)
    assert m["short"][-1] == m["momentary"][-1]


def test_gates_leave_out_near_silent_steps():
    loud = [1.0] * 10
    quiet = [FS * 10 ** ((ABS_GATE - 5) / 10)] * 30           # below the absolute gate
    m = measure(loud + quiet, V)
    assert m["integrated"] == pytest.approx(round(dufs(1.0, FS), 2))
    assert m["gated_steps"] == 10
    almost = [1.0 * 10 ** (-1.5)] * 10                       # 15 vB under the loud steps: under the relative gate
    m2 = measure(loud + almost, V)
    assert m2["integrated"] == pytest.approx(round(dufs(1.0, FS), 2))


def test_short_term_is_a_window_mean():
    kl = [0.0] * (WINDOW - 1) + [8.0]
    m = measure(kl, V)
    assert m["short"][-1] == pytest.approx(round(dufs(1.0, FS), 2))
    assert m["peak_step"] == WINDOW - 1


def test_silence():
    m = measure([0.0] * 5, V)
    assert m["integrated"] is None and m["peak"] == FLOOR and m["range"] is None


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    return dr.registry, Means(session)


def test_loudness_on_gpt2(gpt2):
    reg, means = gpt2
    cfg = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 16}
    P = "What matters about the archive is"
    neutral = an.paired(session, P, "compressor layer=6 thresh=1 ratio=1 makeup=1", cfg, 3, reg, means, save=False)["loudness"]
    assert neutral["original"]["integrated"] is None and max(neutral["original"]["kl"]) < 1e-4
    assert an.paired(session, P, "sample mode=ban-top k=1", cfg, 3, reg, means, save=False).get("loudness") is None
    soft = an.paired(session, P, "steer layer=6 dir=negation scale=2", cfg, 3, reg, means, save=False)["loudness"]
    hard = an.paired(session, P, "steer layer=6 dir=negation scale=8", cfg, 3, reg, means, save=False)["loudness"]
    assert soft["full_scale_bits"] == pytest.approx(math.log2(V), abs=1e-3)
    assert hard["original"]["integrated"] > soft["original"]["integrated"] > -60
    assert len(soft["original"]["momentary"]) == 16


def test_sweep_moves_one_strip_across_its_targets(gpt2):
    from abliteration.interventions import ChainError
    from abliteration.loudness import sweep
    reg, means = gpt2
    cfg = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 16}
    r = an.paired(session, "What matters about the archive is", "", cfg, 3, reg, means, save=False)
    pids, cids = r["baseline"]["prompt_ids"], [t["id"] for t in r["baseline"]["tokens"]]
    heads = sweep(session, pids, cids, "ablate head=5.1 mode=mean", 3, reg, means)
    assert heads["target"] == "head" and heads["rows"] == 12 and heads["cols"] == 12 and len(heads["cells"]) == 144
    mlps = sweep(session, pids, cids, "scale mlp=3 k=0", 3, reg, means)
    by = {c["value"]: c for c in mlps["cells"]}
    assert len(by) == 12 and by["0"]["integrated"] == max(c["integrated"] for c in mlps["cells"])   # MLP 0 is the loudest to remove
    assert by["0"]["line"] == "scale mlp=0 k=0" and 0 <= by["0"]["flips"] <= 1
    layers = sweep(session, pids, cids, "steer layer=6 dir=negation scale=0", 3, reg, means)
    assert len(layers["cells"]) == 13 and all(c["integrated"] is None for c in layers["cells"])   # scale 0: silent everywhere
    with pytest.raises(ChainError, match="no target to sweep"):
        sweep(session, pids, cids, "token word=\" not\" mode=zero", 3, reg, means)


def test_self_repair_readout(gpt2):
    from abliteration.loudness import repairs, sweep
    from abliteration.interventions import parse_chain
    reg, means = gpt2
    cfg = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 24}
    r = an.paired(session, "What matters about the archive is", "", cfg, 42, reg, means, save=False)
    pids, cids = r["baseline"]["prompt_ids"], [t["id"] for t in r["baseline"]["tokens"]]
    chain = parse_chain("ablate mlp=11 mode=zero\nsteer layer=12 dir=negation scale=4\nablate attn=11 mode=zero\nablate mlp=0 mode=zero\nmeter layer=3")
    by = {x["line"]: x for x in repairs(session, pids, cids, chain, 42, reg, means)}
    assert set(by) == {1, 2, 3, 4}                                   # the meter has no readout
    assert abs(by[1]["repair_vb"]) < 0.05 and abs(by[2]["repair_vb"]) < 0.05   # nothing after the last MLP or the top layer
    assert by[3]["repair_vb"] < 0                                    # the last MLP damps the last attention layer's removal
    assert by[4]["repair_vb"] > 10                                   # MLP 0's effect runs through the layers after it
    s = sweep(session, pids, cids, "ablate mlp=5 mode=zero", 42, reg, means)
    assert all("repair_vb" in c for c in s["cells"]) and abs(s["cells"][-1]["repair_vb"]) < 0.05
    run = an.paired(session, "What matters about the archive is", "ablate attn=11 mode=zero", cfg, 42, reg, means, save=False)
    assert run["repair"][0]["line"] == 1 and run["repair"][0]["repair_vb"] < 0
