# Abliteration Lens tests: a direction read where the model is about to write a word.
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import directions as dr
from abliteration.generate import score
from abliteration.interventions import parse_chain
from abliteration.means import Means
from abliteration.model import session


@pytest.fixture(scope="module")
def made():
    session.load("openai-community/gpt2")
    d = dr.from_decision(session, "t-decide", " not, never, no")
    return d, dr.registry.with_embedded({"t-decide": d}), Means(session)


def p_not(chain_text, reg, means, prompt="The door is"):
    tok = session.require()[1]
    ids = tok(prompt).input_ids
    rec = score(session, ids, [tok(" not").input_ids[0]], parse_chain(chain_text) if chain_text else None, 1, reg, means)
    return rec[0]["lp"]


def test_the_direction_is_read_before_the_word(made):
    d, reg, means = made
    s = d["source"]
    assert s["kind"] == "decision" and s["tokens"] == [" not", " no", " never"]
    assert s["high"] == round(0.1 * s["positions"]) and s["positions"] > 500
    assert len(d["layers"]) == 13 and 1 <= d["layer"] <= 12


def test_removing_it_makes_not_less_likely_and_steering_more(made):
    d, reg, means = made
    base = p_not("", reg, means)
    assert p_not("project layer=8 dir=t-decide mode=remove", reg, means) < base
    assert p_not("steer layer=6 dir=t-decide scale=-1", reg, means) < base < p_not("steer layer=6 dir=t-decide scale=1", reg, means)


def test_a_word_is_needed():
    with pytest.raises(ValueError, match="Give a word"):
        dr.from_decision(session, "x", " , ")


def test_project_to_the_mean_and_over_several_directions(made):
    from abliteration.analysis import paired
    from abliteration.directions import subspace
    from abliteration.interventions import ChainError, code_view, project_edit
    from abliteration.streamstats import resid_stats
    d, reg, means = made
    S = subspace(session, reg.get("t-decide"), 4)
    assert S.shape == (13, 4, 768)
    import numpy as np
    assert np.allclose(S[8] @ S[8].T, np.eye(4), atol=1e-4)
    u = reg.get("t-decide").raw(8); assert np.allclose(S[8][0], u / np.linalg.norm(u), atol=1e-5)
    h = torch.randn(1, 5, 768)
    mean = torch.tensor(resid_stats(session)["mean"][8])
    B = torch.tensor(S[8])
    out = project_edit(B, "remove", mean)(h, torch.arange(5))
    assert float(((out - mean) @ B.T).abs().max()) < 1e-3                  # the component is the mean's
    cfg = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 12}
    base = paired(session, "The door is", "", cfg, 1, reg, means, save=False)["bent"]["text"]
    one = paired(session, "The door is", "project layer=8 dir=t-decide", cfg, 1, reg, means, save=False)["bent"]["text"]
    assert paired(session, "The door is", "project layer=8 dir=t-decide k=1 to=zero", cfg, 1, reg, means, save=False)["bent"]["text"] == one
    assert paired(session, "The door is", "project layer=8 dir=t-decide k=4 to=mean", cfg, 1, reg, means, save=False)["bent"]["text"] != base
    assert "subspace('t-decide', k=4)[layer]" in code_view(parse_chain("project layer=8 dir=t-decide k=4 to=mean"), session.map)
    with pytest.raises(ChainError, match="to is zero or mean"):
        parse_chain("project layer=8 dir=t-decide to=median")
    w = dr.registry.with_embedded({"w": dr.from_word(session, "w", " not")})
    with pytest.raises(ChainError, match="made from one word"):
        paired(session, "The door is", "project layer=8 dir=w k=2", cfg, 1, w, means, save=False)
