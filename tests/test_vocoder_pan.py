# Abliteration Lens tests: Vocoder and Pan.
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import sys
from pathlib import Path

import pytest
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import analysis as an
from abliteration import directions as dr
from abliteration.interventions import ChainError, code_view, parse_chain, vocoder_bands, vocoder_edit
from abliteration.means import Means
from abliteration.model import session

CFG = {"temperature": 0.8, "top_k": 40, "top_p": 0.95, "max_new_tokens": 12}
P = "What matters about the archive is"
VOC = 'vocoder layer=6 prompt="The storm broke over the sea" bands=16 mix={}'


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    reg, means = dr.registry, Means(session)
    return reg, means, an.paired(session, P, "", CFG, 42, reg, means, save=False)["bent"]["text"]


def test_vocoder_bands_and_edit():
    cuts = vocoder_bands(768, 16)
    assert cuts[0][0] == 0 and cuts[-1][1] == 768 and all(b > a for a, b in cuts)
    assert cuts[0][1] - cuts[0][0] < cuts[-1][1] - cuts[-1][0]          # narrow at the top, wide in the tail
    v = torch.eye(4)
    h = torch.tensor([[[9.0, 9.0, 9.0, 9.0], [3.0, 4.0, 0.0, 1.0]]])
    out = vocoder_edit(torch.zeros(4), [v[:2], v[2:]], [10.0, 2.0], 1.0)(h, torch.arange(2))
    assert torch.equal(out[0, 0], h[0, 0])                                # the sink left alone
    assert out[0, 1, :2].norm().item() == pytest.approx(10.0) and out[0, 1, 2:].norm().item() == pytest.approx(2.0)
    assert out[0, 1, 0] / out[0, 1, 1] == pytest.approx(0.75)              # the carrier's direction within the band kept


@pytest.mark.parametrize("line", [VOC.format(0), "pan block=all depth=4 pan=0"])
def test_neutral(gpt2, line):
    reg, means, base = gpt2
    assert an.paired(session, P, line, CFG, 42, reg, means, save=False)["bent"]["text"] == base


def test_pan_moves_attention_and_is_put_back(gpt2):
    reg, means, base = gpt2
    model = session.require()[0]
    impl = model.config._attn_implementation
    r = an.paired(session, P, "pan block=all depth=4 pan=1\nscope head=5.1", CFG, 42, reg, means, save=False)
    s = r["probes"]["strips"][0]

    def back(rows):
        return sum(float((torch.tensor(x["w"]) * (len(x["w"]) - 1 - torch.arange(len(x["w"])))).sum()) for x in rows) / len(rows)
    assert back(s["bent"]) < back(s["baseline"]) / 2
    assert model.config._attn_implementation == impl                     # restored after the run
    assert an.paired(session, P, "", CFG, 42, reg, means, save=False)["bent"]["text"] == base
    assert an.paired(session, P, VOC.format(1), CFG, 42, reg, means, save=False)["bent"]["text"] != base
    assert "abliteration_pan" in code_view(parse_chain("pan block=3 pan=0.5"), session.map)
    with pytest.raises(ChainError, match="needs prompt="):
        parse_chain("vocoder layer=6")
