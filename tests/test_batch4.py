# Abliteration Lens tests: Contrast and Chorus (sampler level), and the gate on every hook.
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import math
import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import analysis as an
from abliteration import directions as dr
from abliteration.generate import contrast_logits
from abliteration.interventions import ChainError, RunContext, attach, parse_chain
from abliteration.means import Means
from abliteration.model import session

CFG = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 12}
P = "The door is"


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    return dr.registry, Means(session)


def test_contrast_logits():
    lp_d = torch.log_softmax(torch.tensor([3.0, 2.0, 0.0, -5.0]), -1)
    lp_o = torch.log_softmax(torch.tensor([3.0, 0.0, 0.0, -5.0]), -1)
    out = contrast_logits(lp_d, lp_o, 1.0, 0.1)
    assert out.argmax() == 1                                    # the token the chain made likelier wins
    assert math.isinf(out[3]) and out[3] < 0                     # implausible under the diverged model: ruled out


def test_the_gate_lets_a_pass_read_the_original_model(gpt2):
    reg, means = gpt2
    model, tok, mp = session.require()
    ids = torch.tensor([tok(P).input_ids], device=next(model.parameters()).device)
    with torch.no_grad():
        clean = model(ids).logits
    ctx = RunContext(1, ids.shape[1])
    att = attach(parse_chain("steer layer=6 dir=negation scale=8\nablate head=5.1 mode=zero"), session, ctx, reg, means)
    try:
        with torch.no_grad():
            on = model(ids).logits
            ctx.off = True
            off = model(ids).logits
    finally:
        att.remove()
    assert not torch.allclose(on, clean, atol=1e-3) and torch.allclose(off, clean, atol=1e-5)


@pytest.mark.parametrize("extra", ["contrast alpha=0", "chorus layer=6 voices=0"])
def test_neutral(gpt2, extra):
    reg, means = gpt2
    base = an.paired(session, P, "steer layer=6 dir=negation scale=2", CFG, 1, reg, means, save=False)["bent"]["text"]
    assert an.paired(session, P, "steer layer=6 dir=negation scale=2\n" + extra, CFG, 1, reg, means, save=False)["bent"]["text"] == base


def test_contrast_and_chorus_act(gpt2):
    reg, means = gpt2
    base = an.paired(session, P, "steer layer=6 dir=negation scale=2", CFG, 1, reg, means, save=False)["bent"]["text"]
    for extra in ("contrast alpha=3 keep=0.05", "chorus layer=6 voices=3 sigma=0.8"):
        assert an.paired(session, P, "steer layer=6 dir=negation scale=2\n" + extra, CFG, 1, reg, means, save=False)["bent"]["text"] != base
    with pytest.raises(ChainError, match="cannot run beside"):
        an.paired(session, P, "exit layer=8\ncontrast alpha=1", CFG, 1, reg, means, save=False)
    with pytest.raises(ChainError, match="detunes one layer"):
        parse_chain("chorus layer=all voices=2")
