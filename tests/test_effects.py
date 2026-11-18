# Abliteration Lens tests: the effects on the residual stream.
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

PROMPT = "What matters about the archive is"
CFG = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 16}
NEUTRAL = ["compressor layer=6 thresh=1 ratio=1 makeup=1", "saturator layer=6 drive=4 mix=0",
           "delay layer=6 time=4 feedback=0.5 mix=0", "reverb layer=6 decay=0.9 mix=0",
           "erosion layer=6 bits=16 hold=1", "shifter layer=6 dir=w-not dir2=w-also angle=0",
           "eq layer=6 low=1 mid=1 high=1", "gate layer=6 keep=1", "beatrepeat layer=6 interval=4 length=2 mix=0",
           "multiband layer=6 thresh=0.5 ratio=1"]
ACTIVE = ["compressor layer=6 thresh=0.5 ratio=8", "saturator layer=6 drive=6 mix=1",
          "delay layer=6 time=3 feedback=0.5 mix=1", "reverb layer=6 decay=0.9 mix=1",
          "erosion layer=6 bits=2", "erosion layer=6 hold=3",
          "shifter layer=12 dir=w-not dir2=w-also angle=150", "eq layer=6 low=0 mid=1 high=1.5",
          "gate layer=6 keep=0.1", "beatrepeat layer=6 interval=4 length=2 mix=1", "multiband layer=6 thresh=0.3 ratio=8"]


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    reg = dr.registry.with_embedded({"w-not": dr.from_word(session, "w-not", " not"),
                                     "w-also": dr.from_word(session, "w-also", " also")})
    means = Means(session)
    base = an.paired(session, PROMPT, "", CFG, 1, reg, means, save=False)["bent"]["text"]
    return reg, means, base


@pytest.mark.parametrize("line", NEUTRAL)
def test_neutral_setting_changes_nothing(gpt2, line):
    reg, means, base = gpt2
    r = an.paired(session, PROMPT, line, CFG, 1, reg, means, save=False)
    assert r["bent"]["text"] == base
    assert all(v < 1e-4 for v in r["probes"]["effects"][0]["effect"])


@pytest.mark.parametrize("line", ACTIVE)
def test_effect_changes_the_stream(gpt2, line):
    reg, means, base = gpt2
    r = an.paired(session, PROMPT, line, CFG, 1, reg, means, save=False)
    assert max(r["probes"]["effects"][0]["effect"]) > 0.01


@pytest.mark.parametrize("line", ["delay layer=6 time=3 feedback=0.5 mix=1", "reverb layer=6 decay=0.9 mix=1", "erosion layer=6 hold=3",
                                  "beatrepeat layer=6 interval=4 length=2 mix=1"])
def test_history_effects_agree_between_writing_and_reading(gpt2, line):
    # Lookback, Average and Quantise's hold keep earlier positions. Writing (one position per pass, with
    # the cache) and the meters' pass (every position at once) must give the same stream: the tap
    # at the top layer reads the model's own output, so it must match the run's records.
    reg, means, _ = gpt2
    r = an.paired(session, PROMPT, line + "\ntap layer=12", CFG, 1, reg, means, save=False)
    tap = r["probes"]["strips"][0]["bent"]
    for j in range(6):
        assert tap[j]["lp"] == pytest.approx(r["bent"]["tokens"][j]["lp"], abs=2e-3)


def test_effect_lines(gpt2):
    with pytest.raises(ChainError):
        parse_chain("shifter layer=6 dir=negation")
    cv = code_view(parse_chain("delay layer=6 time=3\neq layer=4 low=0"), session.require()[2])
    assert "def delay_edit" in cv and "def eq_edit" in cv and "diverged run" in cv
