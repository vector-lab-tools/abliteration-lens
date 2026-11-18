# Abliteration Lens tests: the meters (tap, level meter, direction meter, attention scope).
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import analysis as an
from abliteration import directions as dr
from abliteration.interventions import ChainError, code_view, parse_chain
from abliteration.means import Means
from abliteration.model import session

PROMPT = "He said that he would"
CFG = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 12}


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    w = dr.from_word(session, "w-not", " not")
    return dr.registry.with_embedded({"w-not": w}), Means(session)


def test_meters_change_nothing(gpt2):
    reg, means = gpt2
    a = an.paired(session, PROMPT, "steer layer=6 dir=w-not scale=8", CFG, 1, reg, means, save=False)
    b = an.paired(session, PROMPT, "tap layer=6\nsteer layer=6 dir=w-not scale=8\nmeter layer=6\n"
                  "gauge layer=6 dir=w-not\nscope head=5.1\ntap layer=12", CFG, 1, reg, means, save=False)
    assert a["bent"]["text"] == b["bent"]["text"]
    assert a["probes"]["strips"] == [] and [e["kind"] for e in a["probes"]["effects"]] == ["steer"]
    assert parse_chain("tap layer=6").strips[0].level == "probe"


def test_meter_readings(gpt2):
    reg, means = gpt2
    chain = "tap layer=6\nsteer layer=6 dir=w-not scale=8\ntap layer=6\nmeter layer=6\ngauge layer=6 dir=w-not\nscope head=5.1\ntap layer=12"
    r = an.paired(session, PROMPT, chain, CFG, 1, reg, means, save=False)
    P = r["probes"]
    S = {s["line"]: s for s in P["strips"]}
    assert sorted(S) == [1, 3, 4, 5, 6, 7]
    n0 = P["n_prompt"]
    assert len(P["context"]["bent"]) == n0 + len(r["bent"]["tokens"])
    for s in S.values():
        assert len(s["bent"]) == len(r["bent"]["tokens"]) and len(s["baseline"]) == len(r["baseline"]["tokens"])
    # a tap before the steer reads what the unbent model reads at step 0 (the contexts are the same there);
    # one after it does not
    assert S[1]["bent"][0]["top"] == S[1]["baseline"][0]["top"]
    assert S[3]["bent"][0]["top"] != S[3]["baseline"][0]["top"]
    # the top-layer tap is the model's own output
    for j in (0, 5):
        assert S[7]["bent"][j]["lp"] == pytest.approx(r["bent"]["tokens"][j]["lp"], abs=1e-3)
        assert S[7]["bent"][j]["top"][0][0] == r["bent"]["tokens"][j]["top"][0][0]
    # steering along the direction raises the stream's projection on it
    assert S[5]["bent"][0]["proj"] > S[5]["baseline"][0]["proj"] + 1
    assert all(m["norm"] > 0 for m in S[4]["bent"])
    # the scope's weights over the context so far sum to 1
    for j, m in enumerate(S[6]["bent"]):
        assert len(m["w"]) == n0 + j and sum(m["w"]) == pytest.approx(1, abs=1e-2)


def test_strip_activity(gpt2):
    reg, means = gpt2
    r = an.paired(session, PROMPT, "scale mlp=3 k=0.5\ntoken word=\" would\" mode=zero\ncoarsen block=4 bits=4", CFG, 1, reg, means, save=False)
    E = {e["kind"]: e["effect"] for e in r["probes"]["effects"]}
    assert set(E) == {"scale", "token"}                      # Coarsen changes weights: nothing to measure
    assert all(abs(v - 0.5) < 1e-3 for v in E["scale"])      # k=0.5 changes half of the MLP's output
    assert E["token"][0] == 1.0 and all(v == 0 for v in E["token"][1:3])   # " would" is read at step 1 only


def test_meter_lines():
    for bad in ("tap layer=all", "meter layer=3-5", "scope head=5.*", "gauge layer=3", "tap"):
        with pytest.raises(ChainError):
            parse_chain(bad)
    assert parse_chain("tap layer=emb").strips[0].kind == "tap"


def test_meter_code_view(gpt2):
    cv = code_view(parse_chain("tap layer=6\nscope head=5.1"), session.require()[2])
    assert "record_edit(probes, 1)" in cv and "output_attentions=True" in cv and "def record_edit" in cv
