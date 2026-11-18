# Abliteration Lens tests: Position bend, Exit and the embedding mix.
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import analysis as an
from abliteration import directions as dr
from abliteration.interventions import ChainError, code_view, parse_chain, position_hook
from abliteration.means import Means
from abliteration.model import session

CFG = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 12}
P = "What matters about the archive is"


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    reg, means = dr.registry, Means(session)
    return reg, means, an.paired(session, P, "", CFG, 42, reg, means, save=False)["bent"]["text"]


@pytest.mark.parametrize("line", ["position mode=shift k=0", "exit layer=12", 'embed swap=" archive, museum" mix=0'])
def test_neutral(gpt2, line):
    reg, means, base = gpt2
    r = an.paired(session, P, line, CFG, 42, reg, means, save=False)
    assert r["bent"]["text"] == base


@pytest.mark.parametrize("line", ["position mode=shift k=600", "position mode=scramble seed=1", "position mode=freeze k=0",
                                  "exit layer=4", 'embed swap=" archive, museum" mix=1'])
def test_acts(gpt2, line):
    reg, means, base = gpt2
    r = an.paired(session, P, line, CFG, 42, reg, means, save=False)
    assert r["bent"]["text"] != base and r["loudness"]["original"]["integrated"] is not None


def test_position_hook_and_checks(gpt2):
    w = torch.nn.Embedding(10, 3)
    ids = torch.arange(4).view(1, 4)
    shift = position_hook("shift", 7, 0, 10)(w, (ids,), w(ids))
    assert torch.equal(shift[0, 0], w.weight[7]) and torch.equal(shift[0, 3], w.weight[9])      # held within the table
    freeze = position_hook("freeze", 2, 0, 10)(w, (ids,), w(ids))
    assert all(torch.equal(freeze[0, j], w.weight[2]) for j in range(4))
    sc1, sc2 = (position_hook("scramble", 0, 5, 10)(w, (ids,), w(ids)) for _ in range(2))
    assert torch.equal(sc1, sc2)                                                                  # the same every pass
    with pytest.raises(ChainError, match="exit names one layer"):
        parse_chain("exit layer=all")
    with pytest.raises(ChainError, match="needs swap"):
        parse_chain("embed mix=0.5")
    assert "the first 6 blocks only" in code_view(parse_chain("exit layer=6"), session.map)
