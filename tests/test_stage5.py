# Interventions 6 to 10, and the other architectures. Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import analysis as an
from abliteration import directions as dr
from abliteration.generate import baselines
from abliteration.interventions import ChainError, fake_quant_int, parse_chain
from abliteration.means import Means
from abliteration.model import local_checkpoints, session

PROMPT = "The most important thing about the city is"
CFG = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 16}


def weights(m):
    return {n: p.detach().clone() for n, p in m.named_parameters()}


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    baselines.clear()
    return dr.registry, Means(session)


def test_fake_quant_levels():
    t = torch.linspace(-1, 1, 101)
    assert len(torch.unique(fake_quant_int(t, 2))) == 3          # -1, 0, 1 times the scale
    assert len(torch.unique(fake_quant_int(t, 4))) == 15


@pytest.mark.parametrize("line", [
    "coarsen block=5 bits=2", "reorder skip=6", "reorder repeat=5", "reorder swap=3,8",
    'embed swap=" is, was"', "embed token=' city' sigma=1", "sample mode=ban-top k=1",
    "sample mode=ceiling p=0.2", "sample mode=invert",
])
def test_bends_change_text_and_restore_weights(gpt2, line):
    reg, means = gpt2
    before = weights(session.model)
    r = an.paired(session, PROMPT, line, CFG, 5, reg, means, save=False)
    assert r["bent"]["text"] != r["baseline"]["text"], line
    after = weights(session.model)
    assert all(torch.equal(before[k], after[k]) for k in before)
    assert len(session.map.blocks) == session.map.n_layers


def test_transplant_moves_logits(gpt2):
    reg, means = gpt2
    r = an.paired(session, "The cat sat on the", 'transplant layer=8 prompt="I drove my car into the" at=-1 from=-1',
                  CFG, 5, reg, means, save=False)
    a, b = r["baseline"]["tokens"][0], r["bent"]["tokens"][0]
    assert abs(a["lp"] - b["lp"]) > 1e-3 or a["id"] != b["id"]


def test_sampler_bend_leaves_model_scores(gpt2):
    """A sampler bend changes the choice, not the model: the bent text scored under the
    bent model equals its score under the unbent model."""
    reg, means = gpt2
    r = an.paired(session, PROMPT, "sample mode=ban-top k=1", CFG, 5, reg, means, save=False)
    own = [t["lp"] for t in r["bent"]["tokens"]]
    other = [t["lp"] for t in r["scores"]["bent_under_baseline"]]
    assert max(abs(x - y) for x, y in zip(own, other)) < 1e-3


def test_multi_token_embed_is_refused(gpt2):
    reg, means = gpt2
    with pytest.raises(ChainError):
        an.paired(session, PROMPT, 'embed swap=" antidisestablishmentarianism, also"', CFG, 5, reg, means, save=False)


@pytest.mark.skipif(not local_checkpoints("EleutherAI/pythia-160m"), reason="Pythia 160M is not in the cache")
def test_pythia_checkpoints():
    revs = [c["revision"] for c in local_checkpoints("EleutherAI/pythia-160m")]
    assert "main" in revs
    early = next(r for r in revs if r.startswith("step"))
    texts = {}
    for rev in ("main", early):
        session.load("EleutherAI/pythia-160m", None if rev == "main" else rev)
        assert session.info["family"] == "neox" and session.info["revision"] == rev
        baselines.clear()
        r = an.paired(session, PROMPT, "ablate head=4.2 mode=mean", CFG, 5, dr.registry, Means(session), save=False)
        texts[rev] = r["baseline"]["text"]
        assert r["recipe"]["model"]["revision_hash"]
    assert texts["main"] != texts[early]


@pytest.mark.skipif(not local_checkpoints("Qwen/Qwen3-0.6B"), reason="Qwen3 0.6B is not in the cache")
def test_qwen_llama_path():
    session.load("Qwen/Qwen3-0.6B")
    assert session.info["family"] == "llama" and session.info["dtype"] == "bfloat16"
    baselines.clear()
    for line in ["ablate head=10.3 mode=mean", "scale mlp=5 k=0", "noise layer=8 sigma=0.4", "reorder skip=12",
                 "coarsen block=4 bits=2"]:
        r = an.paired(session, PROMPT, line, CFG, 5, dr.registry, Means(session), save=False)
        assert r["bent"]["text"] and r["baseline"]["text"], line
    r1 = an.paired(session, PROMPT, "", CFG, 5, dr.registry, Means(session), save=False)
    assert r1["bent"]["text"] == r1["baseline"]["text"]
