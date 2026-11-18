# Abliteration Lens tests: the tools after repeng (PCA methods, arithmetic, GGUF control vectors).
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from abliteration import directions as dr
from abliteration.model import session


@pytest.fixture(scope="module")
def gpt2():
    session.load("openai-community/gpt2")
    return session


def test_pca_direction_is_signed_and_scaled():
    g = np.random.default_rng(0)
    u = np.zeros(6); u[2] = 1.0
    N = g.normal(size=(30, 1, 6))
    P = N + 3 * u + g.normal(scale=0.2, size=(30, 1, 6))      # pairs that differ along u
    for m in ("pca-diff", "pca-center"):
        v = dr._pca_direction(P, N, m)[0]
        assert v @ u > 0 and abs(np.linalg.norm(v) - float((P.mean(0) - N.mean(0))[0] @ (v / np.linalg.norm(v)))) < 1e-4
        assert abs(v[2]) / np.linalg.norm(v) > 0.95


def test_pca_methods_on_gpt2(gpt2):
    pos = ["The door is not open", "The water is not cold", "The road is not long", "The house is not old"]
    neg = ["The door is open", "The water is cold", "The road is long", "The house is old"]
    m = dr.extract(gpt2, "m", pos, neg, None, {"kind": "lists"}, "mean")
    p = dr.extract(gpt2, "p", pos, neg, None, {"kind": "lists"}, "pca-diff")
    a, b = np.array(m["layers"][6]), np.array(p["layers"][6])
    assert a @ b / (np.linalg.norm(a) * np.linalg.norm(b)) > 0.9 and p["source"]["method"] == "pca-diff"
    with pytest.raises(ValueError, match="as pairs"):
        dr.extract(gpt2, "x", pos, neg[:3], None, {"kind": "lists"}, "pca-diff")


def test_combine(gpt2):
    c = dr.combine(gpt2, "c", "negation - 0.5 * not-x-but-y", dr.registry)
    A, B = dr.registry.get("negation"), dr.registry.get("not-x-but-y")
    assert np.allclose(np.array(c["layers"][7]), A.raw(7) - 0.5 * B.raw(7), atol=1e-4)
    assert c["source"]["terms"] == [[1.0, "negation"], [-0.5, "not-x-but-y"]]
    with pytest.raises(ValueError, match="a number times a direction"):
        dr.combine(gpt2, "c", "lots * negation", dr.registry)


def test_gguf_round_trip(gpt2, tmp_path):
    d = dr.registry.get("negation")
    f = tmp_path / "neg.gguf"
    assert dr.to_gguf(gpt2, d, f) == 11
    back = dr.from_gguf(gpt2, "back", f)
    L = np.array(back["layers"])
    assert np.allclose(L[2:], np.stack([d.raw(l) for l in range(2, 13)]), atol=1e-6) and not L[:2].any()
    assert back["source"]["model_hint"] == "gpt2" and back["source"]["layers_read"] == list(range(2, 13))
    bad = tmp_path / "not.gguf"
    import gguf
    w = gguf.GGUFWriter(str(bad), "llama"); w.add_tensor("x", np.zeros(4, dtype=np.float32))
    w.write_header_to_file(); w.write_kv_data_to_file(); w.write_tensors_to_file(); w.close()
    with pytest.raises(ValueError, match="not a control vector"):
        dr.from_gguf(gpt2, "x", bad)
