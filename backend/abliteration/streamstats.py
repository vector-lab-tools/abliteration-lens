# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
The residual stream's statistics over the reference corpus, measured once with the model
unchanged and cached in _tmp/means/: per layer, the mean vector, each dimension's spread and
the mean size, and the principal directions. The first position of each passage, an
attention sink, is left out. The bench offers these to units as the "stats" and "pca"
capabilities (vauhost.py); the effects that use them are units in the vau package.
"""
from __future__ import annotations

from typing import Dict

import numpy as np
import torch

_stats: Dict[str, Dict[str, np.ndarray]] = {}
_pca: Dict[str, np.ndarray] = {}


def _key(sess) -> str:
    from .means import corpus_sha
    i = sess.info
    return f"{i['model_id'].replace('/', '--')}@{i.get('revision_hash')}@{i['dtype']}@{corpus_sha()[:12]}"


def _corpus_streams(sess):
    """The residual stream at every layer for each corpus passage, the first position left out."""
    from .directions import _with_bos, residuals
    from .means import corpus_passages
    model, tok, mp = sess.require()
    dev = next(model.parameters()).device
    for passage in corpus_passages():
        r = residuals(model, mp, _with_bos(tok, passage, dev))[:, 1:, :]
        if r.shape[1]:
            yield r.double()


def resid_stats(sess) -> Dict[str, np.ndarray]:
    """Per layer: the mean vector, each dimension's standard deviation, and the mean size (norm)."""
    from .means import CACHE
    k = _key(sess)
    if k in _stats:
        return _stats[k]
    f = CACHE / f"stats-{k}.npz"
    if f.exists():
        d = np.load(f)
        _stats[k] = {n: d[n] for n in d.files}
        return _stats[k]
    s = sq = nm = None
    n = 0
    for r in _corpus_streams(sess):
        a, b, c = r.sum(1), (r ** 2).sum(1), r.norm(dim=-1).sum(1)
        s, sq, nm = (a, b, c) if s is None else (s + a, sq + b, nm + c)
        n += r.shape[1]
    mean = s / n
    std = torch.sqrt((sq / n - mean ** 2).clamp_min(1e-12))
    out = {"mean": mean.float().numpy(), "std": std.float().numpy(), "norm": (nm / n).float().numpy(), "n": np.array(n)}
    CACHE.mkdir(parents=True, exist_ok=True)
    np.savez(f, **out)
    _stats[k] = out
    return out


def resid_pca(sess, layer: int) -> np.ndarray:
    """The principal directions of the stream at a layer over the corpus, by variance, as rows."""
    from .means import CACHE
    k = f"{_key(sess)}-L{layer}"
    if k in _pca:
        return _pca[k]
    f = CACHE / f"pca-{k}.npy"
    if f.exists():
        _pca[k] = np.load(f)
        return _pca[k]
    xs = torch.cat([r[layer] for r in _corpus_streams(sess)], 0)
    xs = xs - xs.mean(0, keepdim=True)
    _, _, vt = torch.linalg.svd(xs, full_matrices=True)
    v = vt.float().numpy()
    CACHE.mkdir(parents=True, exist_ok=True)
    np.save(f, v)
    _pca[k] = v
    return v


_scales: Dict[str, np.ndarray] = {}


def resid_pca_scales(sess, layer: int) -> np.ndarray:
    """The stream's spread along each of its principal directions at a layer over the corpus (the
    singular values over the square root of the number of positions), in the order of resid_pca."""
    from .means import CACHE
    k = f"{_key(sess)}-L{layer}"
    if k in _scales:
        return _scales[k]
    f = CACHE / f"pcascale-{k}.npy"
    if f.exists():
        _scales[k] = np.load(f)
        return _scales[k]
    xs = torch.cat([r[layer] for r in _corpus_streams(sess)], 0)
    xs = xs - xs.mean(0, keepdim=True)
    s = torch.linalg.svdvals(xs) / max(1, xs.shape[0]) ** 0.5
    out = np.zeros(xs.shape[1], dtype=np.float32)
    out[: s.shape[0]] = s.float().numpy()
    CACHE.mkdir(parents=True, exist_ok=True)
    np.save(f, out)
    _scales[k] = out
    return out
