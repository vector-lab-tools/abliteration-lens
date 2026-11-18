# Abliteration Lens tests: the Neuron and Clamp units on GPT-2, and the neuron finder.
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

CFG = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 12}


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    reg, means = dr.registry, Means(session)
    return reg, means, an.paired(session, "The door is", "", CFG, 1, reg, means, save=False)["bent"]["text"]


def test_neuron_is_neutral_and_acts(gpt2):
    reg, means, base = gpt2
    assert an.paired(session, "The door is", "neuron block=11 n=611 op=scale value=1", CFG, 1, reg, means, save=False)["bent"]["text"] == base
    r = an.paired(session, "The door is", "neuron block=0,1 n=1,2,3 op=set value=20", CFG, 1, reg, means, save=False)
    assert r["bent"]["text"] != base and max(r["probes"]["effects"][0]["effect"]) > 0
    assert "register_forward_pre_hook(neuron_hook([1,2,3], 'set', 20))" in code_view(parse_chain("neuron block=0 n=1,2,3 op=set value=20"), session.map)
    with pytest.raises(ChainError, match="neurons 0 to 3071"):
        an.paired(session, "The door is", "neuron block=5 n=5000 op=zero", CFG, 1, reg, means, save=False)


def test_limiter_is_neutral_at_1_and_acts_below(gpt2):
    reg, means, base = gpt2
    assert an.paired(session, "The door is", "limiter layer=6 ceiling=1", CFG, 1, reg, means, save=False)["bent"]["text"] == base
    r = an.paired(session, "The door is", "limiter layer=all ceiling=0.9", CFG, 1, reg, means, save=False)
    assert r["bent"]["text"] != base


def test_the_finder_ranks_neurons(gpt2):
    r = dr.find_neurons(session, " not, never, no", top=10)
    assert len(r["neurons"]) == 10 and r["tokens"] == [" not", " no", " never"]
    s = [abs(n["score"]) for n in r["neurons"]]
    assert s == sorted(s, reverse=True)
    n = r["neurons"][0]
    assert n["score"] == pytest.approx((n["hi"] - n["lo"]) * n["write"], rel=1e-4) and "toward" in n
