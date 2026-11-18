# Abliteration Lens tests: the bench as a host for Vector Abliteration Units (the vau package).
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import analysis as an
from abliteration import directions as dr
from abliteration import vauhost
from abliteration.generate import make_recipe
from abliteration.interventions import SPECS, ChainError, code_view, parse_chain
from abliteration.means import Means
from abliteration.model import session

GAIN = """UNIT = dict(vau=1, id='gain', title='Gain', what='Multiplies the stream by k', category='effect',
            level='model', site='stream', targets=['layer'], example='gain layer=6 k=2',
            params=[dict(key='k', label='k', tip="h' = k h", kind='fader', min=0, max=4, default=1, neutral=1)])
def edit(u, layer):
    k = u.num('k')
    return lambda h, pos: h * k
"""
NEEDS_LOGITS = """UNIT = dict(vau=1, id='needy', title='Needy', what='Needs the logits', category='effect',
            level='model', site='stream', targets=['layer'], requires=['logits'], params=[])
def edit(u, layer):
    return lambda h, pos: h
"""


@pytest.fixture
def user_units(tmp_path, monkeypatch):
    monkeypatch.setattr(vauhost, "USER", tmp_path)
    yield tmp_path
    monkeypatch.undo()
    vauhost.rescan()


def test_the_builtin_units_are_strips():
    for k in ("compressor", "saturator", "delay", "reverb", "erosion", "shifter", "eq"):
        assert SPECS[k].get("vau") and vauhost.unit(k).source == "builtin"
    c = vauhost.catalogue()
    assert c["errors"] == [] and c["host"]["name"] == "Abliteration Lens"
    assert all(u["missing"] == [] for u in c["units"])


def test_a_unit_line_is_checked_against_its_manifest():
    with pytest.raises(ChainError, match="shifter needs dir2="):
        parse_chain("shifter layer=6 dir=negation")
    with pytest.raises(ChainError, match="should be a number"):
        parse_chain("delay layer=6 mix=lots")
    assert parse_chain("eq layer=all low=0.5").strips[0].level == "model"


def test_a_user_unit_loads_and_a_broken_one_is_named(user_units):
    (user_units / "gain.py").write_text(GAIN)
    (user_units / "broken.py").write_text("UNIT = 3\n")
    (user_units / "delay.py").write_text(GAIN.replace("id='gain'", "id='ablate'"))
    vauhost.rescan()
    assert vauhost.unit("gain").source == "user" and SPECS["gain"]["vau"]
    errs = {e["file"]: e["error"] for e in vauhost.catalogue()["errors"]}
    assert "no UNIT dict" in errs["broken.py"] and "already taken" in errs["delay.py"]
    assert not SPECS["ablate"].get("vau")                   # the bench's own strip is kept
    vauhost.rescan()                                        # rescanning twice keeps one entry each
    assert sum(1 for k in SPECS if k == "gain") == 1


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    return dr.registry, Means(session)


def test_a_user_unit_runs_and_is_neutral(gpt2, user_units):
    reg, means = gpt2
    (user_units / "gain.py").write_text(GAIN)
    vauhost.rescan()
    cfg = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 12}
    base = an.paired(session, "The archive", "", cfg, 2, reg, means, save=False)["bent"]["text"]
    assert an.paired(session, "The archive", "gain layer=6 k=1", cfg, 2, reg, means, save=False)["bent"]["text"] == base
    r = an.paired(session, "The archive", "gain layer=6 k=3", cfg, 2, reg, means, save=False)
    assert r["bent"]["text"] != base and max(r["probes"]["effects"][0]["effect"]) > 1
    rec = make_recipe(session, "The archive", "gain layer=6 k=3", cfg, 2, reg)
    assert rec["units"]["units"]["gain"]["source"] == "user" and len(rec["units"]["units"]["gain"]["sha256"]) == 64
    assert "unit gain: Gain (gain.py, VAU 1, user)" in code_view(parse_chain("gain layer=6 k=3"), session.map)


def test_a_unit_the_bench_cannot_serve_stops_the_run(gpt2, user_units, monkeypatch):
    reg, means = gpt2
    monkeypatch.setattr(vauhost, "CAPABILITIES", vauhost.CAPABILITIES - {"logits"})
    (user_units / "needy.py").write_text(NEEDS_LOGITS)
    vauhost.rescan()
    cfg = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 4}
    with pytest.raises(ChainError, match="needs logits, which the bench does not offer"):
        an.paired(session, "The archive", "needy layer=6", cfg, 2, reg, means, save=False)


def test_morph_fits_once_runs_and_is_neutral_at_amount_0(gpt2):
    reg, means = gpt2
    cfg = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 12}
    base = an.paired(session, "Democracy is", "", cfg, 7, reg, means, save=False)["bent"]["text"]
    line = "morph block=5-6 dir=not-x-but-y move=toward amount={}"
    assert an.paired(session, "Democracy is", line.format(0), cfg, 7, reg, means, save=False)["bent"]["text"] == base
    r = an.paired(session, "Democracy is", line.format(2), cfg, 7, reg, means, save=False)
    assert r["bent"]["text"] != base and max(r["probes"]["effects"][0]["effect"]) > 0.01
    code = code_view(parse_chain(line.format(1)), session.map)
    assert "model.transformer.h[6].mlp.c_proj.register_forward_hook(morph_hook" in code and "def fit_morph" in code
    from abliteration.means import CACHE
    assert list(CACHE.glob("unit-morph-*.pt"))


def test_abliterate_is_neutral_at_0_and_removes_at_1(gpt2):
    reg, means = gpt2
    cfg = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 12}
    base = an.paired(session, "The door is", "", cfg, 1, reg, means, save=False)["bent"]["text"]
    line = "abliterate block=all dir=negation shape=flat share=1 strength={}"
    assert an.paired(session, "The door is", line.format(0), cfg, 1, reg, means, save=False)["bent"]["text"] == base
    r = an.paired(session, "The door is", line.format(1.5), cfg, 1, reg, means, save=False)
    assert r["bent"]["text"] != base and r["loudness"]["original"]["integrated"] > -40
    code = code_view(parse_chain(line.format(1)), session.map)
    assert code.count("register_forward_hook(abliterate_hook") == 24 and "def kernel" in code
    with pytest.raises(ChainError, match="needs dir="):
        parse_chain("abliterate block=all")


def test_host_features_on_units_and_the_benchs_own_strips(gpt2):
    reg, means = gpt2
    cfg = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 12}
    P = "The door is"
    base = an.paired(session, P, "", cfg, 1, reg, means, save=False)["bent"]["text"]
    for line in ("steer layer=6 dir=negation scale=8 wet=0", "delay layer=6 time=3 mix=1 wet=0",
                 "steer layer=all dir=negation scale=8 env=linear epeak=0 ewidth=0.05"):
        r = an.paired(session, P, line, cfg, 1, reg, means, save=False)
        assert r["bent"]["text"] == base or "env" in line
    real = an.paired(session, P, "steer layer=6 dir=negation scale=8", cfg, 1, reg, means, save=False)
    ctl = an.paired(session, P, "steer layer=6 dir=negation scale=8 control=random", cfg, 1, reg, means, save=False)
    assert ctl["bent"]["text"] != real["bent"]["text"]
    kept = an.paired(session, P, "steer layer=6 dir=negation scale=8 keepnorm=1", cfg, 1, reg, means, save=False)
    assert kept["bent"]["text"] != real["bent"]["text"]
    code = code_view(parse_chain("steer layer=6 dir=negation scale=8 control=random cseed=4"), session.map)
    assert "random control" in code and "seed 4" in code
    with pytest.raises(ChainError, match="does not take the host features"):
        parse_chain("ablate head=5.1 wet=0.5")
    with pytest.raises(ChainError, match="env is none or linear or bell or flat"):
        parse_chain("steer layer=6 dir=negation scale=2 env=wiggly")
    with pytest.raises(ChainError, match="random control has no texts"):
        an.paired(session, P, "morph block=5 dir=not-x-but-y control=random", cfg, 1, reg, means, save=False)


def test_meter_units_read_both_texts(gpt2):
    reg, means = gpt2
    cfg = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 10}
    r = an.paired(session, "The archive", "entropy\npeakshare layer=6 k=8\nlimiter layer=6 ceiling=0.9\npeakshare layer=7 k=8", cfg, 2, reg, means, save=False)
    by = {(s["kind"], s["params"].get("layer")): s for s in r["probes"]["strips"]}
    assert len(by[("entropy", None)]["baseline"]) == 10 and all(0 <= x["value"] < 16 for x in by[("entropy", None)]["bent"])
    after = by[("peakshare", "7")]
    assert sum(x["value"] for x in after["bent"]) < sum(x["value"] for x in after["baseline"])   # the Clamp brings the peaks down
    assert "peak_share" in code_view(parse_chain("peakshare layer=6"), session.map)
    with pytest.raises(ChainError, match="reads one layer"):
        parse_chain("peakshare layer=all")
    assert all(m["missing"] == [] for m in vauhost.catalogue()["units"])


def test_a_window_starts_the_strip_at_its_step(gpt2):
    reg, means = gpt2
    cfg = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 12}
    base = an.paired(session, "The archive", "", cfg, 2, reg, means, save=False)["bent"]["tokens"]
    for line in ("steer layer=6 dir=negation scale=12 wfrom=5", "saturator layer=6 drive=10 mix=1 wfrom=5"):
        t = an.paired(session, "The archive", line, cfg, 2, reg, means, save=False)["bent"]["tokens"]
        assert [x["id"] for x in t[:4]] == [x["id"] for x in base[:4]]           # steps 1-4 untouched
        assert [x["id"] for x in t] != [x["id"] for x in base]
    assert "only from step 5" in code_view(parse_chain("steer layer=6 dir=negation scale=2 wfrom=5"), session.map)
