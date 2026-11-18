# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
Directions in the residual stream: made from a contrast set or a prompt pair, from one
word (the way the model writes it), from a sentence or passage (against the reference
corpus), or imported from Vectorscope or Ablation Bench.

The extraction (last-token residual vectors, difference of means per layer,
leave-one-out nearest-centroid separability) is adapted from Vectorscope,
backend/operations/grammar_steering.py, GPL-3.0-or-later. It reads the residual
stream with hooks on the block outputs instead of `output_hidden_states`, so the
top layer is the last block's output before the final norm, the same point the
interventions edit.

File format `divergence-bench.direction.v1` (shared with Ablation Bench):
    {format, name, model, revision, layer_convention: "hidden_states",
     layer, vector, layers?, norm, sha256, source: {kind, positive[], negative[], ...}}
`sha256` covers the float32 little-endian bytes of `vector`. With `layers`
(an (n+1, d) array), a strip at layer l uses layers[l]; without it, `vector` is
used at whatever layer the strip names.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import torch

from . import ROOT
from .interventions import ChainError

DIR_FOLDER = ROOT / "data" / "directions"
CONTRAST_FOLDER = ROOT / "backend" / "config" / "contrasts"


def residuals(model, mp, ids: torch.Tensor) -> torch.Tensor:
    """One forward pass; the residual stream at every layer, (n_blocks + 1, seq, d), float32 on CPU."""
    caught: List[torch.Tensor] = [None] * (mp.n_layers + 1)
    hs = []

    def pre(m, args, kwargs):
        caught[0] = (args[0] if args else kwargs["hidden_states"])[0].detach().float().cpu()

    def post(i):
        def h(m, args, out):
            caught[i + 1] = (out[0] if isinstance(out, tuple) else out)[0].detach().float().cpu()
        return h
    hs.append(mp.block(0).register_forward_pre_hook(pre, with_kwargs=True))
    for i in range(mp.n_layers):
        hs.append(mp.block(i).register_forward_hook(post(i)))
    try:
        with torch.no_grad():
            model(ids, use_cache=False)
    finally:
        for h in hs:
            h.remove()
    return torch.stack(caught)


def _loo(pos: np.ndarray, neg: np.ndarray) -> float:
    """Leave-one-out nearest-centroid accuracy along the difference of means (Vectorscope)."""
    n = min(len(pos), len(neg))
    if n < 2:
        return float("nan")
    correct = total = 0
    for i in range(n):
        mu_p = np.delete(pos, i, axis=0).mean(0)
        mu_n = np.delete(neg, i, axis=0).mean(0)
        d = mu_p - mu_n
        if not np.linalg.norm(d):
            continue
        mid = (mu_p + mu_n) / 2
        for ex, truth in ((pos[i], 1), (neg[i], 0)):
            correct += int((1 if float((ex - mid) @ d) > 0 else 0) == truth)
            total += 1
    return correct / total if total else float("nan")


def sha_of(vec: np.ndarray) -> str:
    return hashlib.sha256(np.asarray(vec, dtype="<f4").tobytes()).hexdigest()


class Direction:
    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.name = data["name"]
        self._layers = np.asarray(data["layers"], dtype=np.float32) if data.get("layers") else None
        self._vector = np.asarray(data["vector"], dtype=np.float32)

    def raw(self, layer: int) -> np.ndarray:
        if self._layers is not None:
            if layer >= len(self._layers):
                raise ChainError(f"Direction '{self.name}' has layers 0 to {len(self._layers) - 1}.")
            return self._layers[layer]
        return self._vector

    def vector(self, layer: int, device) -> torch.Tensor:
        return torch.tensor(self.raw(layer), device=device)

    def fit(self, d_model: int, lineno: int = 0) -> "Direction":
        """This direction, if it is as wide as the loaded model's stream; otherwise a ChainError that
        says which model it was made on, rather than a size error deep in the forward pass."""
        w = int(self._vector.shape[-1])
        if w != d_model:
            made = self.data.get("model") or "another model"
            raise ChainError(f"Line {lineno}: direction '{self.name}' was made on {made} and is {w} wide; "
                             f"the loaded model's stream is {d_model} wide. Make it again on this model in Directions.")
        return self

    def unit(self, layer: int, device) -> torch.Tensor:
        v = self.raw(layer)
        n = float(np.linalg.norm(v))
        if n == 0:
            raise ChainError(f"Direction '{self.name}' is zero at layer {layer}.")
        return torch.tensor(v / n, device=device)

    def summary(self) -> Dict[str, Any]:
        d = self.data
        src = d.get("source", {})
        return {"name": self.name, "model": d.get("model"), "revision": d.get("revision"),
                "layer": d.get("layer"), "norm": d.get("norm"), "sha256": d.get("sha256"),
                "per_layer": self._layers is not None, "kind": src.get("kind"),
                "separability": d.get("separability"), "norms": d.get("norms"),
                "n_positive": len(src.get("positive", [])), "n_negative": len(src.get("negative", [])),
                "word": src.get("word"), "tokens": src.get("tokens"), "note": src.get("note"),
                "words": src.get("words"), "positions": src.get("positions"), "high": src.get("high"),
                "method": src.get("method"), "expr": src.get("expr"), "file": src.get("file"), "model_hint": src.get("model_hint"),
                "created": d.get("created")}


class Registry:
    """Directions on disk, plus any a recipe brings with it."""

    def __init__(self):
        DIR_FOLDER.mkdir(parents=True, exist_ok=True)
        self.extra: Dict[str, Direction] = {}

    def _path(self, name: str) -> Path:
        return DIR_FOLDER / (re.sub(r"[^A-Za-z0-9_.-]+", "-", name) + ".json")

    def all(self) -> List[Direction]:
        out = {}
        for f in sorted(DIR_FOLDER.glob("*.json")):
            try:
                d = Direction(json.loads(f.read_text()))
                out[d.name] = d
            except Exception:
                continue
        out.update(self.extra)
        return list(out.values())

    def get(self, name: str, lineno: int = 0) -> Direction:
        if name in self.extra:
            return self.extra[name]
        p = self._path(name)
        if p.exists():
            d = Direction(json.loads(p.read_text()))
            if not self._made_elsewhere(d):
                return d
            # a shipped contrast's direction made on another model: make it again for this one
        made = self._from_shipped_contrast(name)
        if made is not None:
            return made
        raise ChainError(f"Line {lineno}: there is no direction called '{name}'. "
                         "Make one in Directions, or import one.")

    @staticmethod
    def _made_elsewhere(d: Direction) -> bool:
        """True for a direction made automatically from a shipped contrast set on a model other
        than the one loaded now. Directions made by hand are never remade."""
        from .model import session
        src = d.data.get("source") or {}
        if session.model is None or src.get("kind") != "contrast" or src.get("contrast") != d.name:
            return False
        return bool(d.data.get("model")) and d.data.get("model") != session.info.get("model_id")

    def _from_shipped_contrast(self, name: str) -> Optional[Direction]:
        """A direction named after one of the shipped contrast sets (negation, not-x-but-y) is made
        from that set the first time it is asked for, if a model is loaded, and saved, so that a
        fresh copy of the tool has the directions its examples use."""
        from .model import session
        if session.model is None:
            return None
        c = next((x for x in contrasts() if x["id"] == name), None)
        if c is None:
            return None
        source = {"kind": "contrast", "contrast": c["id"], "contrast_sha256": c["sha256"], "title": c["title"]}
        return self.save(extract(session, name, c["positive"], c["negative"], None, source))

    def save(self, data: Dict[str, Any]) -> Direction:
        data = normalise(data)
        self._path(data["name"]).write_text(json.dumps(data))
        return Direction(data)

    def delete(self, name: str):
        p = self._path(name)
        if p.exists():
            p.unlink()

    def for_recipe(self, names: List[str]) -> Dict[str, Any]:
        return {n: self.get(n).data for n in names}

    def with_embedded(self, embedded: Dict[str, Any]) -> "Registry":
        r = Registry.__new__(Registry)
        r.extra = {n: Direction(normalise(d)) for n, d in (embedded or {}).items()}
        return r


def normalise(data: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(data)
    d.setdefault("format", "divergence-bench.direction.v1")
    d.setdefault("layer_convention", "hidden_states")
    vec = np.asarray(d["vector"], dtype=np.float32)
    d["vector"] = vec.tolist()
    d["norm"] = float(np.linalg.norm(vec))
    d["sha256"] = sha_of(vec)
    return d


# ---------------------------------------------------------------------------
# Making directions
# ---------------------------------------------------------------------------

METHODS = ("mean", "pca-diff", "pca-center")


def _pca_direction(P: np.ndarray, N: np.ndarray, method: str) -> np.ndarray:
    """At each layer, the first principal component of the pairs' differences (pca-diff) or of
    both lists centred on each pair's midpoint (pca-center), inspired by repeng (Theia Vogel), signed
    so that most positive texts project above their negatives, and scaled to the difference of
    means' length along it, so that a Steer's scale means what it means for a mean difference."""
    out = []
    for l in range(P.shape[1]):
        p, n = P[:, l].astype(np.float64), N[:, l].astype(np.float64)
        if method == "pca-diff":
            X = p - n
        else:
            mid = (p + n) / 2
            X = np.concatenate([p - mid, n - mid])
        _, _, vt = np.linalg.svd(X - (X.mean(0) if method == "pca-center" else 0), full_matrices=False)
        u = vt[0]
        if np.mean((p @ u) > (n @ u)) < 0.5:
            u = -u
        out.append(u * float((p.mean(0) - n.mean(0)) @ u))
    return np.stack(out).astype(np.float32)


def extract(sess, name: str, positive: List[str], negative: List[str], layer: Optional[int],
            source: Dict[str, Any], method: str = "mean") -> Dict[str, Any]:
    model, tok, mp = sess.require()
    positive = [p.strip() for p in positive if p.strip()]
    negative = [n.strip() for n in negative if n.strip()]
    if not positive or not negative:
        raise ValueError("A direction needs at least one positive and one negative text.")
    dev = next(model.parameters()).device

    def last(text):
        ids = tok(text, return_tensors="pt").input_ids.to(dev)
        return residuals(model, mp, ids)[:, -1, :].numpy()      # (n+1, d)
    P = np.stack([last(t) for t in positive])                   # (Np, n+1, d)
    N = np.stack([last(t) for t in negative])
    if method not in METHODS:
        raise ValueError(f"The method is {', '.join(METHODS)}.")
    if method != "mean" and len(positive) != len(negative):
        raise ValueError("The PCA methods read the lists as pairs, line by line: give as many negative texts as positive.")
    if method != "mean" and len(positive) < 2:
        raise ValueError("The PCA methods need at least two pairs.")
    layers = P.mean(0) - N.mean(0) if method == "mean" else _pca_direction(P, N, method)   # (n+1, d)
    norms = np.linalg.norm(layers, axis=1)
    stream = np.linalg.norm(np.concatenate([P, N]), axis=2).mean(0)   # mean residual norm per layer
    rel = norms / np.maximum(stream, 1e-9)
    sep = [_loo(P[:, l], N[:, l]) for l in range(layers.shape[0])]
    if layer is None:
        # the most separable layer; ties go to the layer where the direction is largest
        # relative to the residual stream there (the raw norm grows with depth); never layer 0
        cand = [(round(0 if np.isnan(sep[l]) else sep[l], 6), rel[l], l) for l in range(1, len(sep))]
        layer = max(cand)[2]
    info = sess.info
    return {
        "format": "divergence-bench.direction.v1", "name": name,
        "model": info.get("model_id"), "revision": info.get("revision"),
        "revision_hash": info.get("revision_hash"), "layer_convention": "hidden_states",
        "layer": int(layer), "vector": layers[layer].tolist(), "layers": layers.tolist(),
        "norms": [float(x) for x in norms],
        "relative_norms": [float(x) for x in rel],
        "separability": [None if np.isnan(x) else float(x) for x in sep],
        "source": dict(source, positive=positive, negative=negative, method=method),
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


# ---------------------------------------------------------------------------
# Directions added and subtracted (repeng's arithmetic on control vectors)
# ---------------------------------------------------------------------------

def combine(sess, name: str, expr: str, registry) -> Dict[str, Any]:
    """A direction from others, layer by layer: `negation - 0.5 * not-x-but-y`. Terms are a name,
    or a number, * and a name, joined by + or - with spaces around them (names may contain -)."""
    words = (expr or "").split()
    if not words:
        raise ValueError("Write the sum, for example: negation - 0.5 * not-x-but-y")
    terms, sign, i = [], 1.0, 0
    model = sess.info.get("model_id") if sess.model is not None else None
    while i < len(words):
        w = words[i]
        if w in ("+", "-"):
            sign = 1.0 if w == "+" else -1.0
            i += 1
            continue
        coef = 1.0
        if i + 2 < len(words) and words[i + 1] == "*":
            try:
                coef = float(w)
            except ValueError:
                raise ValueError(f"'{w} *' should be a number times a direction.")
            w, i = words[i + 2], i + 3
        else:
            i += 1
        terms.append((sign * coef, w))
        sign = 1.0
    dirs = [(c, registry.get(n)) for c, n in terms]
    models = {d.data.get("model") for _, d in dirs if d.data.get("model")}
    if len(models) > 1:
        raise ValueError(f"These directions belong to different models: {', '.join(sorted(models))}.")
    L = max((len(d._layers) if d._layers is not None else 0) for _, d in dirs)
    n = L or 1
    width = {d._vector.shape[-1] for _, d in dirs}
    if len(width) > 1:
        raise ValueError("These directions have different widths.")
    layers = sum(c * np.stack([d.raw(l) for l in range(n)]) for c, d in dirs) if L else None
    vec = layers[max(range(1, n), key=lambda l: np.linalg.norm(layers[l]))] if L else sum(c * d._vector for c, d in dirs)
    first = dirs[0][1].data
    out = {"format": "divergence-bench.direction.v1", "name": name, "model": next(iter(models), model),
           "revision": first.get("revision"), "revision_hash": first.get("revision_hash"), "layer_convention": "hidden_states",
           "layer": int(max(range(1, n), key=lambda l: np.linalg.norm(layers[l]))) if L else first.get("layer"),
           "vector": np.asarray(vec, dtype=np.float32).tolist(),
           "source": {"kind": "combination", "expr": " ".join(words), "terms": [[c, d.name] for c, d in dirs],
                      "positive": [], "negative": []},
           "created": time.strftime("%Y-%m-%dT%H:%M:%S")}
    if L:
        out["layers"] = layers.astype(np.float32).tolist()
        out["norms"] = [float(np.linalg.norm(x)) for x in layers]
    return out


# ---------------------------------------------------------------------------
# GGUF control vectors (llama.cpp; repeng's export_gguf and import_gguf)
# ---------------------------------------------------------------------------
# llama.cpp adds direction.N to the output of block N (blocks counted from 0, N from 1), which is
# the residual stream at this bench's layer N + 1. So layers 2 to n are written as direction.1 to
# direction.n-1; layers 0 and 1 have no place in the format.

def to_gguf(sess, d: "Direction", path: Path) -> int:
    import gguf
    model, tok, mp = sess.require()
    w = gguf.GGUFWriter(str(path), "controlvector")
    w.add_string("controlvector.model_hint", getattr(model.config, "model_type", "") or "")
    n = mp.n_layers
    count = 0
    for N in range(1, n):
        w.add_tensor(f"direction.{N}", np.asarray(d.raw(N + 1), dtype=np.float32))
        count += 1
    w.add_uint32("controlvector.layer_count", count)
    w.write_header_to_file()
    w.write_kv_data_to_file()
    w.write_tensors_to_file()
    w.close()
    return count


def from_gguf(sess, name: str, path: Path) -> Dict[str, Any]:
    import gguf
    model, tok, mp = sess.require()
    r = gguf.GGUFReader(str(path))
    arch = r.get_field("general.architecture")
    arch = bytes(arch.parts[-1]).decode("utf-8", "replace") if arch is not None and len(arch.parts) else ""
    if arch != "controlvector":
        raise ValueError(f"This GGUF file is a {arch or 'file of unknown kind'}, not a control vector.")
    hint = r.get_field("controlvector.model_hint")
    hint = bytes(hint.parts[-1]).decode("utf-8", "replace") if hint is not None and len(hint.parts) else ""
    layers = np.zeros((mp.n_layers + 1, mp.d_model), dtype=np.float32)
    got = []
    for t in r.tensors:
        if not t.name.startswith("direction."):
            continue
        N = int(t.name.split(".")[1])
        v = np.asarray(t.data, dtype=np.float32).reshape(-1)
        if v.shape[0] != mp.d_model:
            raise ValueError(f"This control vector is {v.shape[0]} wide; the loaded model's stream is {mp.d_model}.")
        if 1 <= N <= mp.n_layers - 1:
            layers[N + 1] = v
            got.append(N + 1)
    if not got:
        raise ValueError("This control vector has no directions for the loaded model's layers.")
    norms = np.linalg.norm(layers, axis=1)
    layer = int(np.argmax(norms))
    mine = getattr(model.config, "model_type", "")
    info = sess.info
    note = "" if not hint or hint == mine else f"Made for a {hint} model; the loaded model is {mine}."
    return {"format": "divergence-bench.direction.v1", "name": name, "model": info.get("model_id"),
            "revision": info.get("revision"), "revision_hash": info.get("revision_hash"), "layer_convention": "hidden_states",
            "layer": layer, "vector": layers[layer].tolist(), "layers": layers.tolist(), "norms": [float(x) for x in norms],
            "source": {"kind": "gguf", "file": path.name, "model_hint": hint, "layers_read": got, "note": note,
                       "positive": [], "negative": []},
            "created": time.strftime("%Y-%m-%dT%H:%M:%S")}


# ---------------------------------------------------------------------------
# A direction's subspace: the direction and the next principal directions of its differences
# ---------------------------------------------------------------------------

_subspaces: Dict[str, np.ndarray] = {}


def _orthonormal(first: np.ndarray, rest: np.ndarray, k: int) -> np.ndarray:
    """Gram-Schmidt from `first`, then the rows of `rest`, keeping k unit rows (fewer if the rows
    run out)."""
    out: List[np.ndarray] = []
    for v in [first] + list(rest):
        v = v.astype(np.float64).copy()
        for b in out:
            v -= (v @ b) * b
        n = np.linalg.norm(v)
        if n > 1e-6 * max(1.0, np.linalg.norm(first)):
            out.append(v / n)
        if len(out) == k:
            break
    return np.stack(out).astype(np.float32)


def _differences(sess, d: "Direction") -> np.ndarray:
    """(layers, samples, d): the differences a direction was made from. A contrast or two lists:
    each positive text's last-token stream minus the negatives' mean, and the positives' mean
    minus each negative. A passage: each of its tokens minus the corpus mean. A decision
    direction: each high position minus the low positions' mean."""
    model, tok, mp = sess.require()
    dev = next(model.parameters()).device
    src = d.data.get("source", {})
    kind = src.get("kind")
    if kind == "word":
        raise ChainError(f"Direction '{d.name}' is made from one word: it is one vector, so it has no further directions.")
    if kind == "decision":
        from .means import corpus_passages
        ids = sorted(set(src.get("token_ids") or []))
        contexts = corpus_passages() + list(src.get("texts") or [])
        Rs, Ps = [], []
        for text in contexts:
            x = _with_bos(tok, text, dev)
            if x.shape[1] < 2:
                continue
            Rs.append(residuals(model, mp, x)[:, 1:, :])
            with torch.no_grad():
                Ps.append(torch.softmax(model(x, use_cache=False).logits[0].float(), -1)[1:, ids].sum(-1).cpu())
        Rm, Pm = torch.cat(Rs, 1).numpy(), torch.cat(Ps).numpy()
        order = np.argsort(Pm)
        k = max(4, int(round(float(src.get("share", 0.1)) * len(Pm))))
        hi, lo = order[-k:], order[: len(Pm) // 2]
        return Rm[:, hi, :] - Rm[:, lo, :].mean(1, keepdims=True)
    pos = [t for t in src.get("positive", []) if str(t).strip()]
    neg = [t for t in src.get("negative", []) if str(t).strip()]
    if pos and neg:
        def last(text):
            ids = tok(text, return_tensors="pt").input_ids.to(dev)
            return residuals(model, mp, ids)[:, -1, :].numpy()
        P = np.stack([last(t) for t in pos], 1)                # (layers, Np, d)
        N = np.stack([last(t) for t in neg], 1)
        return np.concatenate([P - N.mean(1, keepdims=True), P.mean(1, keepdims=True) - N], 1)
    if pos:
        M = corpus_resid_mean(sess)                             # (layers, d)
        T = np.concatenate([residuals(model, mp, _with_bos(tok, t, dev))[:, 1:, :].numpy() for t in pos], 1)
        return T - M[:, None, :]
    raise ChainError(f"Direction '{d.name}' keeps no texts to find further directions in.")


def subspace(sess, d: "Direction", k: int) -> np.ndarray:
    """(layers, k, d): at each layer, the direction itself and then the next principal directions
    of the differences it was made from, orthonormal. Cached per model, direction and k."""
    from .means import CACHE
    from .streamstats import _key
    key = hashlib.sha256(json.dumps({"m": _key(sess), "d": d.data.get("sha256"), "src": d.data.get("source", {}),
                                     "k": k, "v": 1}, sort_keys=True, default=str).encode()).hexdigest()[:24]
    if key in _subspaces:
        return _subspaces[key]
    f = CACHE / f"subspace-{key}.npy"
    if f.exists():
        _subspaces[key] = np.load(f)
        return _subspaces[key]
    diffs = _differences(sess, d)
    out = []
    for l in range(diffs.shape[0]):
        _, _, vt = np.linalg.svd(diffs[l].astype(np.float64), full_matrices=False)
        B = _orthonormal(d.raw(l), vt, k)
        if B.shape[0] < k:
            raise ChainError(f"Direction '{d.name}' gives only {B.shape[0]} independent directions at layer {l}; use k={B.shape[0]} or fewer.")
        out.append(B)
    S = np.stack(out)
    CACHE.mkdir(parents=True, exist_ok=True)
    np.save(f, S)
    _subspaces[key] = S
    return S


# ---------------------------------------------------------------------------
# A direction from one word: the way the model writes it
# ---------------------------------------------------------------------------

def from_word(sess, name: str, word: str) -> Dict[str, Any]:
    """The word's first token as the output layer writes it: its row of the unembedding
    matrix, centred where the final norm is a LayerNorm (which removes the mean). Projected
    out of the residual stream at the top layer, it takes the token out of the model's likely
    next tokens while leaving the rest of the stream; at every layer it also changes how the
    model reads. The final norm's gain is left out: in GPT-2 a few of its entries are very
    large, and weighting by them gives a vector whose removal raises the word instead
    (tests/test_words.py checks the direction lowers it)."""
    model, tok, mp = sess.require()
    if not word.strip():
        raise ValueError("Give a word.")
    ids = tok(word, add_special_tokens=False).input_ids
    if not ids:
        raise ValueError(f"'{word}' gives no tokens.")
    W = model.get_output_embeddings().weight.detach().float().cpu()
    v = W[ids[0]].clone()
    if mp.family in ("gpt2", "neox"):
        v = v - v.mean()
    pieces = [tok.decode([i]) for i in ids]
    info = sess.info
    notes = []
    if len(ids) > 1:
        notes.append(f"'{word}' is {len(ids)} tokens for this model; the direction is for the first, {pieces[0]!r}.")
    if mp.family == "gpt2":
        notes.append("GPT-2 ties its input and output embeddings, so this is also close to the token's input embedding.")
    note = " ".join(notes)
    return {
        "format": "divergence-bench.direction.v1", "name": name,
        "model": info.get("model_id"), "revision": info.get("revision"),
        "revision_hash": info.get("revision_hash"), "layer_convention": "hidden_states",
        "layer": mp.n_layers, "vector": v.numpy().tolist(),
        "source": {"kind": "word", "word": word, "token_ids": ids, "tokens": pieces, "used": pieces[0],
                   "method": "unembedding row of the first token"
                             + (", centred" if mp.family in ("gpt2", "neox") else ""),
                   "note": note.strip(), "positive": [word], "negative": []},
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


# ---------------------------------------------------------------------------
# A direction from where the model is about to write a word: the decision point
# ---------------------------------------------------------------------------

def from_decision(sess, name: str, words: str, texts: Optional[List[str]] = None, layer: Optional[int] = None,
                  share: float = 0.1) -> Dict[str, Any]:
    """Where the model is about to write one of the words. The unchanged model reads the
    reference corpus (and any texts given); at every position it gives a probability that the
    next token is one of the words (the sum over each word's first token). The direction at
    each layer is the mean residual stream at the positions where that probability is highest
    (the top `share` of positions) minus the mean at the positions where it is lowest (the
    bottom half). The positions are those where the model decides, before any word is
    written, which is where Arditi et al. (2024) read the refusal direction: at the end of the
    instruction, before the response. A contrast set's direction is read at the end of each
    sentence, after the construction, and so marks having written it."""
    from .means import corpus_passages
    model, tok, mp = sess.require()
    ws = [w for w in (words or "").split(",") if w.strip()]
    ids = sorted({tok(w, add_special_tokens=False).input_ids[0] for w in ws if tok(w, add_special_tokens=False).input_ids})
    if not ids:
        raise ValueError("Give a word, or several separated by commas (\" not, never\").")
    dev = next(model.parameters()).device
    contexts = corpus_passages() + [x.strip() for x in (texts or []) if x.strip()]
    R, P = [], []
    head, norm = model.get_output_embeddings(), mp.final_norm()
    for text in contexts:
        x = _with_bos(tok, text, dev)
        if x.shape[1] < 2:
            continue
        r = residuals(model, mp, x)                          # (n+1, seq, d), float32 on CPU
        with torch.no_grad():
            logits = model(x, use_cache=False).logits[0].float()
        p = torch.softmax(logits, -1)[:, ids].sum(-1).cpu()  # the next token's chance of being one of the words
        R.append(r[:, 1:, :])                                # the attention sink left out
        P.append(p[1:])
    R = torch.cat(R, 1).numpy()                              # (n+1, positions, d)
    P = torch.cat(P).numpy()
    order = np.argsort(P)
    k = max(4, int(round(share * len(P))))
    hi, lo = order[-k:], order[: len(P) // 2]
    layers = R[:, hi, :].mean(1) - R[:, lo, :].mean(1)
    norms = np.linalg.norm(layers, axis=1)
    stream = np.linalg.norm(R, axis=2).mean(1)
    rel = norms / np.maximum(stream, 1e-9)
    rng = np.random.default_rng(0)
    lo_s = rng.choice(lo, size=min(len(lo), len(hi)), replace=False)
    sep = [_loo(R[l, hi], R[l, lo_s]) for l in range(R.shape[0])]
    if layer is None:
        cand = [(round(0 if np.isnan(sep[l]) else sep[l], 6), rel[l], l) for l in range(1, len(sep))]
        layer = max(cand)[2]
    info = sess.info
    from .means import corpus_sha
    return {
        "format": "divergence-bench.direction.v1", "name": name,
        "model": info.get("model_id"), "revision": info.get("revision"),
        "revision_hash": info.get("revision_hash"), "layer_convention": "hidden_states",
        "layer": int(layer), "vector": layers[layer].tolist(), "layers": layers.tolist(),
        "norms": [float(x) for x in norms], "relative_norms": [float(x) for x in rel],
        "separability": [None if np.isnan(x) else float(x) for x in sep],
        "source": {"kind": "decision", "words": ws, "token_ids": ids, "tokens": [tok.decode([i]) for i in ids],
                   "positive": [], "negative": [], "texts": [x for x in (texts or []) if x.strip()],
                   "against": "reference corpus", "corpus_sha256": corpus_sha(), "share": share,
                   "positions": int(len(P)), "high": int(len(hi)), "low": int(len(lo)),
                   "threshold": float(P[hi[0]]), "max_p": float(P.max()),
                   "method": "mean residual where the next token is most likely one of the words minus the mean where it is least likely, per layer"},
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


def find_neurons(sess, words: str, texts: Optional[List[str]] = None, share: float = 0.1, top: int = 24) -> Dict[str, Any]:
    """MLP neurons that fire differently where the model is about to write one of the words.
    The positions are chosen as for a decision direction (the top `share` by the chance that
    the next token is one of the words, against the bottom half). Each neuron's score is the
    difference of its mean activation (where the MLP's output projection reads it) between the
    two sets of positions, times the size of what it writes (its column of the projection):
    OBLITERATUS's Neuron Lab ranks candidates by the same product, between two prompts. A
    positive score fires more where the word is coming. `toward` is the difference of mean
    activation times how far what the neuron writes points to the words (their rows of the
    unembedding, averaged and centred): its direct push toward them, the final norm left out.
    The ranking describes; it does not show that a neuron causes the word."""
    from .means import corpus_passages
    model, tok, mp = sess.require()
    ws = [w for w in (words or "").split(",") if w.strip()]
    ids = sorted({tok(w, add_special_tokens=False).input_ids[0] for w in ws if tok(w, add_special_tokens=False).input_ids})
    if not ids:
        raise ValueError("Give a word, or several separated by commas (\" not, never\").")
    dev = next(model.parameters()).device
    contexts = [c for c in corpus_passages() + [x.strip() for x in (texts or []) if x.strip()]]
    acts: List[List[torch.Tensor]] = [[] for _ in range(mp.n_layers)]
    hs = []

    def grab(l):
        def h(module, args):
            acts[l].append(args[0][0, 1:].detach().float().cpu())
        return h
    for l in range(mp.n_layers):
        hs.append(mp.mlp_proj(l).register_forward_pre_hook(grab(l)))
    P = []
    try:
        for text in contexts:
            x = _with_bos(tok, text, dev)
            if x.shape[1] < 2:
                continue
            with torch.no_grad():
                logits = model(x, use_cache=False).logits[0].float()
            P.append(torch.softmax(logits, -1)[1:, ids].sum(-1).cpu())
    finally:
        for h in hs:
            h.remove()
    P = torch.cat(P).numpy()
    order = np.argsort(P)
    k = max(4, int(round(share * len(P))))
    hi, lo = order[-k:], order[: len(P) // 2]
    U = model.get_output_embeddings().weight.detach().float().cpu()[ids].mean(0)
    if mp.family in ("gpt2", "neox"):
        U = U - U.mean()                                          # as a word direction is centred
    rows = []
    for l in range(mp.n_layers):
        A = torch.cat(acts[l]).numpy()                         # (positions, neurons)
        diff = A[hi].mean(0) - A[lo].mean(0)
        w = mp.mlp_proj(l).weight.detach().float().cpu()
        C = w if type(mp.mlp_proj(l)).__name__ == "Conv1D" else w.T   # row n: what neuron n writes
        cols = C.norm(dim=1).numpy()                              # each neuron's write size
        toward = (C @ U).numpy()                                  # how far what it writes points to the words
        score = diff * cols
        for n in np.argsort(-np.abs(score))[:top]:
            rows.append({"block": l, "neuron": int(n), "score": float(score[n]), "diff": float(diff[n]),
                         "write": float(cols[n]), "toward": float(diff[n] * toward[n]),
                         "hi": float(A[hi, n].mean()), "lo": float(A[lo, n].mean())})
    rows.sort(key=lambda r: -abs(r["score"]))
    return {"words": ws, "tokens": [tok.decode([i]) for i in ids], "positions": int(len(P)), "high": int(len(hi)),
            "low": int(len(lo)), "neurons": rows[:top]}


# ---------------------------------------------------------------------------
# A direction from a sentence or passage: how it differs from the reference corpus
# ---------------------------------------------------------------------------

def _with_bos(tok, text: str, dev) -> torch.Tensor:
    """Token ids with a beginning-of-text token in front, so that every word of the text
    stands after the first position (which many models use as an attention sink)."""
    ids = tok(text, add_special_tokens=False).input_ids
    bos = tok.bos_token_id if tok.bos_token_id is not None else tok.eos_token_id
    if bos is not None:
        ids = [bos] + ids
    return torch.tensor([ids], device=dev)


def _text_mean(model, tok, mp, text: str, dev) -> np.ndarray:
    ids = _with_bos(tok, text, dev)
    r = residuals(model, mp, ids)                      # (n+1, seq, d)
    return r[:, 1:, :].mean(1).numpy() if r.shape[1] > 1 else r[:, 0, :].numpy()


def corpus_resid_mean(sess) -> np.ndarray:
    """The residual stream at every layer, averaged over every token of the reference corpus
    (after the beginning-of-text token). Cached in _tmp/means/ per model, revision and corpus."""
    from .means import CACHE, corpus_passages, corpus_sha
    model, tok, mp = sess.require()
    info = sess.info
    key = f"resid-{info['model_id'].replace('/', '--')}@{info.get('revision_hash')}@{info['dtype']}@{corpus_sha()[:12]}"
    f = CACHE / (key + ".npy")
    if f.exists():
        return np.load(f)
    dev = next(model.parameters()).device
    tot, n = None, 0
    for passage in corpus_passages():
        ids = _with_bos(tok, passage, dev)
        r = residuals(model, mp, ids)[:, 1:, :]
        s = r.sum(1).numpy()
        tot = s if tot is None else tot + s
        n += r.shape[1]
    m = (tot / max(n, 1)).astype(np.float32)
    CACHE.mkdir(parents=True, exist_ok=True)
    np.save(f, m)
    return m


def from_text(sess, name: str, texts: List[str], layer: Optional[int]) -> Dict[str, Any]:
    """The mean residual stream over the tokens of the given texts minus the same mean over
    the reference corpus, at every layer: what is particular to these texts against ordinary
    prose. Several texts (one per line) are averaged first."""
    model, tok, mp = sess.require()
    texts = [x.strip() for x in texts if x.strip()]
    if not texts:
        raise ValueError("Give a sentence or passage.")
    dev = next(model.parameters()).device
    S = np.mean([_text_mean(model, tok, mp, x, dev) for x in texts], axis=0)   # (n+1, d)
    M = corpus_resid_mean(sess)
    layers = S - M
    norms = np.linalg.norm(layers, axis=1)
    rel = norms / np.maximum(np.linalg.norm(M, axis=1), 1e-9)
    if layer is None:
        # where the texts stand furthest from the corpus, relative to the stream there; never layer 0
        layer = int(np.argmax(rel[1:]) + 1)
    info = sess.info
    from .means import corpus_sha
    return {
        "format": "divergence-bench.direction.v1", "name": name,
        "model": info.get("model_id"), "revision": info.get("revision"),
        "revision_hash": info.get("revision_hash"), "layer_convention": "hidden_states",
        "layer": int(layer), "vector": layers[layer].tolist(), "layers": layers.tolist(),
        "norms": [float(x) for x in norms], "relative_norms": [float(x) for x in rel],
        "source": {"kind": "text", "positive": texts, "negative": [],
                   "against": "reference corpus", "corpus_sha256": corpus_sha(),
                   "method": "mean residual over the texts' tokens minus the mean over the corpus's tokens, per layer"},
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


def from_import(obj: Dict[str, Any], name: Optional[str] = None) -> Dict[str, Any]:
    """Read a direction file: ours (v1, also written by Ablation Bench) or a Vectorscope
    Grammar Steering export (`layers[].steeringVector`, numbered as hidden states)."""
    if obj.get("format") == "divergence-bench.direction.v1":
        d = dict(obj)
        if name:
            d["name"] = name
        return d
    if isinstance(obj.get("layers"), list) and obj["layers"] and "steeringVector" in obj["layers"][0]:
        layers = [l["steeringVector"] for l in obj["layers"]]
        layer = int(obj.get("pcaLayer", len(layers) // 2))
        return {
            "name": name or "vectorscope-import", "model": obj.get("model") or obj.get("modelId"),
            "revision": None, "layer_convention": "hidden_states", "layer": layer,
            "vector": layers[layer], "layers": layers,
            "norms": [float(l.get("steeringNorm", 0)) for l in obj["layers"]],
            "separability": [l.get("separability") for l in obj["layers"]],
            "source": {"kind": "vectorscope", "pairs": obj.get("pairs", []),
                       "positive": [p.get("positive", "") for p in obj.get("pairs", [])],
                       "negative": [p.get("negative", "") for p in obj.get("pairs", [])],
                       "note": "Vectorscope's top layer is the normed final hidden state; "
                               "here layer n is the last block's output before the norm."},
            "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
    raise ValueError("Not a direction file this tool reads (divergence-bench.direction.v1, "
                     "or a Vectorscope Grammar Steering export).")


# ---------------------------------------------------------------------------
# Contrast sets: Markdown files, as Manifoldscope's probe lists
# ---------------------------------------------------------------------------

def read_contrast(path: Path) -> Dict[str, Any]:
    text = path.read_text()
    meta: Dict[str, str] = {}
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        text = text[m.end():]
    sections: Dict[str, List[str]] = {}
    cur = None
    notes: List[str] = []
    for line in text.splitlines():
        h = re.match(r"^##\s+(.*)", line)
        if h:
            cur = h.group(1).strip().lower()
            sections[cur] = []
            continue
        item = re.match(r"^\s*[-*]\s+(.*)", line)
        if item and cur in ("positive", "negative"):
            sections[cur].append(item.group(1).strip())
        elif cur not in ("positive", "negative") and line.strip():
            notes.append(line.strip())
    return {"id": path.stem, "title": meta.get("title", path.stem), "meta": meta,
            "positive": sections.get("positive", []), "negative": sections.get("negative", []),
            "notes": " ".join(notes), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def contrasts() -> List[Dict[str, Any]]:
    return [read_contrast(p) for p in sorted(CONTRAST_FOLDER.glob("*.md"))]


registry = Registry()
