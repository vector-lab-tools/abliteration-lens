# Abliteration Lens tests: directions from a word and from a sentence, and the token strip.
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import analysis as an
from abliteration import directions as dr
from abliteration.interventions import ChainError, code_view, parse_chain
from abliteration.means import Means
from abliteration.model import session

PROMPT = "He said that he would"
CFG = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 30}


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    w = dr.from_word(session, "w-not", " not")
    t = dr.from_text(session, "t-sea", ["The sea was grey and the boats lay still in the harbour.",
                                        "Waves broke on the shingle below the cliffs."], None)
    return dr.registry.with_embedded({"w-not": w, "t-sea": t}), Means(session), w, t


def _count(text, word):
    return (" " + text).count(word)


def test_word_direction(gpt2):
    reg, means, w, _ = gpt2
    assert w["source"]["kind"] == "word" and w["source"]["tokens"] == [" not"]
    assert w["layer"] == session.info["n_layers"] and "layers" not in w
    assert abs(float(np.mean(w["vector"]))) < 1e-4          # centred for GPT-2's LayerNorm
    # removed at the top layer, " not" leaves the first token's five most likely (it is first in the baseline)
    r = an.paired(session, PROMPT, "project layer=12 dir=w-not mode=remove", CFG, 1, reg, means, save=False)
    assert r["baseline"]["tokens"][0]["top"][0][0] == " not"
    assert " not" not in [t for t, _ in r["bent"]["tokens"][0]["top"]]


def test_text_direction(gpt2):
    reg, means, _, t = gpt2
    assert t["source"]["kind"] == "text" and len(t["layers"]) == session.info["n_layers"] + 1
    assert 1 <= t["layer"] <= session.info["n_layers"]
    assert np.linalg.norm(t["layers"][t["layer"]]) > 0
    r = an.paired(session, "The view from the window was", "steer layer=6 dir=t-sea scale=4", CFG, 2, reg, means,
                  save=False)
    assert r["bent"]["text"] != r["baseline"]["text"]


def test_token_ban(gpt2):
    reg, means, _, _ = gpt2
    chain = 'token word=" not, never" mode=ban'
    assert parse_chain(chain).strips[0].level == "sampler"
    for seed in (1, 2, 3, 4):
        r = an.paired(session, PROMPT, chain, CFG, seed, reg, means, save=False)
        ids = [t["id"] for t in r["bent"]["tokens"]]
        assert 407 not in ids and 1239 not in ids            # " not", " never" in GPT-2's vocabulary


def test_token_zero(gpt2):
    reg, means, _, _ = gpt2
    assert parse_chain('token word=" not"').strips[0].level == "model"
    r = an.paired(session, "I do not know what", 'token word=" not" mode=zero', CFG, 3, reg, means, save=False)
    assert r["bent"]["text"] != r["baseline"]["text"]
    assert "embed_zero_hook" in code_view(parse_chain('token word=" not"'), session.require()[2])
    with pytest.raises(ChainError):
        parse_chain("token mode=zero")
    with pytest.raises(ChainError):
        an.paired(session, PROMPT, 'token word=" antidisestablishment"', CFG, 1, reg, means, save=False)
