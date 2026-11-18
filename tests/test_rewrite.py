# Abliteration Lens tests: Rewrite (a ROME-style rank-one MLP edit) and Patch.
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import analysis as an
from abliteration import directions as dr
from abliteration import rewrite as rw
from abliteration.generate import score
from abliteration.interventions import ChainError, code_view, parse_chain
from abliteration.means import Means
from abliteration.model import session

LINE = 'rewrite block=5 prompt="The Eiffel Tower is located in the city of" subject="Eiffel Tower" target=" Rome"'


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    return dr.registry, Means(session)


def p_rome(prompt, chain, reg, means):
    tok = session.require()[1]
    return float(torch.exp(torch.tensor(score(session, tok(prompt).input_ids, [tok(" Rome").input_ids[0]],
                                              parse_chain(chain) if chain else None, 1, reg, means)[0]["lp"])))


def test_rewrite_makes_the_target_likely_and_leaves_other_subjects(gpt2, tmp_path, monkeypatch):
    reg, means = gpt2
    monkeypatch.setattr(rw, "PATCHES", tmp_path)
    P = "The Eiffel Tower is located in the city of"
    assert p_rome(P, "", reg, means) < 0.05 < 0.5 < p_rome(P, LINE + " amount=1", reg, means)
    assert p_rome(P, LINE + " amount=0", reg, means) == pytest.approx(p_rome(P, "", reg, means), rel=1e-4)
    other = "The Louvre is located in the city of"
    assert p_rome(other, LINE, reg, means) < 0.05
    # saved as a patch, the edit gives the same result as the hook
    an.paired(session, "The Eiffel Tower is in", LINE + " save=t-eiffel", {"max_new_tokens": 4}, 3, reg, means, save=False)
    assert (tmp_path / "t-eiffel.safetensors").exists()
    assert p_rome(P, "patch file=t-eiffel", reg, means) == pytest.approx(p_rome(P, LINE, reg, means), rel=1e-3)
    model = session.require()[0]
    before = model.transformer.h[5].mlp.c_proj.weight.detach().clone()
    an.paired(session, "The Eiffel Tower is in", "patch file=t-eiffel scale=2", {"max_new_tokens": 4}, 3, reg, means, save=False)
    assert torch.equal(model.transformer.h[5].mlp.c_proj.weight, before)                 # put back after the run
    assert "rewrite_hook" in code_view(parse_chain(LINE), session.map)


def test_rewrite_and_patch_checks(gpt2):
    reg, means = gpt2
    with pytest.raises(ChainError, match="not in the prompt"):
        parse_chain('rewrite prompt="The tower is in" subject="Eiffel" target=" Rome"')
    with pytest.raises(ChainError, match="needs prompt="):
        parse_chain('rewrite subject="x"')
    with pytest.raises(ChainError, match="no patch called"):
        an.paired(session, "The", "patch file=nothing-here", {"max_new_tokens": 2}, 1, reg, means, save=False)
