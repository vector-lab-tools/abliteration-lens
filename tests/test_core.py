# Abliteration Lens tests. Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import analysis as an
from abliteration import directions as dr
from abliteration import textmetrics as tm
from abliteration.generate import baselines
from abliteration.interventions import ChainError, code_view, parse_chain
from abliteration.means import Means
from abliteration.model import session

PROMPT = "The most important thing about the city is"
CFG = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 24}


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    c = dr.read_contrast(dr.CONTRAST_FOLDER / "negation.md")
    reg = dr.registry.with_embedded({"neg-test": dr.extract(session, "neg-test", c["positive"], c["negative"],
                                                            None, {"kind": "contrast"})})
    return reg, Means(session)


def test_parse_roundtrip():
    text = "ablate head=5.1 mode=mean\n# noise layer=3 sigma=0.5\n\nsteer layer=6 dir=x scale=4\n# a note"
    c = parse_chain(text)
    assert c.text() == text
    assert [s.kind for s in c.strips] == ["ablate", "noise", "steer"]
    assert [s.on for s in c.strips] == [True, False, True]
    assert parse_chain(c.strips[2].text()).strips[0].params == {"layer": "6", "dir": "x", "scale": "4"}


def test_parse_errors():
    for bad in ["frobnicate layer=3", "ablate", "steer layer=3", "ablate head=5.1 mode=half", "noise layer=3 sigma"]:
        with pytest.raises(ChainError):
            parse_chain(bad)


def test_metrics():
    assert tm.pattern_hits("It is not a tool but a way of life.")["not-x-but-y"] == 1
    assert tm.pattern_hits("not just a tool but a medium")["not-x-but-y"] == 0
    assert tm.stance("Perhaps we must not")["hedging"] == 1
    assert tm.edit_distance("a b c".split(), "a b c".split()) == 0
    assert tm.edit_distance("a b".split(), "c d".split()) == 1
    assert tm.first_divergence([1, 2, 3], [1, 2, 4]) == 2
    assert tm.first_divergence([1, 2], [1, 2]) == -1


def test_empty_chain_equals_baseline(gpt2):
    reg, means = gpt2
    r = an.paired(session, PROMPT, "# ablate head=5.1", CFG, 3, reg, means, save=False)
    assert r["baseline"]["text"] == r["bent"]["text"]
    assert r["metrics"]["distance"]["first_divergence"] == -1


def test_bend_changes_text_and_baseline_does_not(gpt2):
    reg, means = gpt2
    a = an.paired(session, PROMPT, "scale mlp=0 k=0", CFG, 3, reg, means, save=False)
    baselines.clear()
    b = an.paired(session, PROMPT, "steer layer=6 dir=neg-test scale=6", CFG, 3, reg, means, save=False)
    assert a["baseline"]["text"] == b["baseline"]["text"]
    assert a["bent"]["text"] != a["baseline"]["text"]


def test_hooks_removed(gpt2):
    reg, means = gpt2
    an.paired(session, PROMPT, "ablate head=3.* mode=mean\nreorder skip=4\ncoarsen block=2 bits=2", CFG, 4, reg,
              means, save=False)
    m = session.model
    assert all(not mod._forward_hooks and not mod._forward_pre_hooks for mod in m.modules())
    assert len(session.map.blocks) == 12 and m.config.n_layer == 12
    baselines.clear()
    from abliteration.generate import run_one, sampler_defaults
    fresh = run_one(session, PROMPT, None, sampler_defaults(CFG), 4, reg, means)
    again = an.paired(session, PROMPT, "", CFG, 4, reg, means, save=False)
    assert fresh["text"] == again["baseline"]["text"]


def test_regenerate_from_recipe(gpt2, tmp_path):
    """Export a recipe as JSON, read it back, run it, and get identical text."""
    reg, means = gpt2
    chain = "ablate head=5.1 mode=mean\nsteer layer=6 dir=neg-test scale=3\nnoise layer=4 sigma=0.2"
    r = an.paired(session, PROMPT, chain, CFG, 11, reg, means, save=False)
    f = tmp_path / "recipe.json"
    f.write_text(json.dumps(r["recipe"]))
    recipe = json.loads(f.read_text())
    baselines.clear()
    reg2 = dr.registry.with_embedded(recipe["directions"])
    r2 = an.paired(session, recipe["prompt"], recipe["chain"]["text"], recipe["sampler"], recipe["seed"],
                   reg2, means, save=False)
    assert r2["baseline"]["text"] == r["baseline"]["text"]
    assert r2["bent"]["text"] == r["bent"]["text"]
    assert recipe["model"]["revision_hash"]
    assert recipe["tool"]["version"]


def test_code_view(gpt2):
    out = code_view(parse_chain("ablate head=5.1\nproject layer=0 dir=d mode=reflect"), session.map)
    assert "model.transformer.h[5].attn.c_proj.register_forward_pre_hook" in out
    assert "register_forward_pre_hook(resid_hook(project_edit" in out
    assert "def head_hook" in out and "def project_edit" in out


def _wide(name, model, width, source):
    return {"name": name, "model": model, "layer": 6, "vector": [0.01] * width, "source": source}


def test_a_direction_from_another_model_is_refused_before_the_run(gpt2):
    _, means = gpt2
    reg = dr.registry.with_embedded({"from-qwen": _wide("from-qwen", "Qwen/Qwen3-0.6B", 1024, {"kind": "contrast"})})
    with pytest.raises(ChainError, match="made on Qwen/Qwen3-0.6B and is 1024 wide; the loaded model's stream is 768"):
        an.paired(session, PROMPT, "steer layer=6 dir=from-qwen scale=4", CFG, 3, reg, means, save=False)


def test_a_shipped_direction_made_on_another_model_is_made_again(gpt2, tmp_path, monkeypatch):
    monkeypatch.setattr(dr, "DIR_FOLDER", tmp_path)
    reg = dr.Registry()
    reg.save(_wide("negation", "Qwen/Qwen3-0.6B", 1024, {"kind": "contrast", "contrast": "negation"}))
    reg.save(_wide("mine", "Qwen/Qwen3-0.6B", 1024, {"kind": "contrast", "contrast": "something-else"}))
    d = reg.get("negation")
    assert d.data["model"] == "openai-community/gpt2" and len(d.data["vector"]) == 768
    assert json.loads((tmp_path / "negation.json").read_text())["model"] == "openai-community/gpt2"
    assert reg.get("mine").data["model"] == "Qwen/Qwen3-0.6B"            # made by hand: never remade
