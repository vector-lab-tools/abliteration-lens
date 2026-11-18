# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
Means for mean ablation: the average output of every head, attention layer, MLP and
block over every token position of the reference corpus
(backend/config/reference-corpus.md). Computed once per model and revision, kept
in memory and in _tmp/means/.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Dict, List

import torch

from . import ROOT

CORPUS = ROOT / "backend" / "config" / "reference-corpus.md"
CACHE = ROOT / "_tmp" / "means"


def corpus_passages() -> List[str]:
    text = CORPUS.read_text()
    text = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.S)
    return [m.group(1).strip() for m in re.finditer(r"^\d+\.\s+(.+)$", text, re.M)]


def corpus_sha() -> str:
    return hashlib.sha256(CORPUS.read_bytes()).hexdigest()


class Means:
    def __init__(self, sess):
        self.sess = sess
        self.key = None
        self.data: Dict[str, torch.Tensor] = {}

    def _ensure(self):
        info = self.sess.info
        key = f"{info['model_id'].replace('/', '--')}@{info.get('revision_hash')}@{info['dtype']}@{corpus_sha()[:12]}"
        if key == self.key:
            return
        CACHE.mkdir(parents=True, exist_ok=True)
        f = CACHE / (key + ".pt")
        dev = next(self.sess.model.parameters()).device
        if f.exists():
            self.data = {k: v.to(dev) for k, v in torch.load(f, weights_only=True).items()}
        else:
            self.data = self._compute()
            torch.save({k: v.cpu() for k, v in self.data.items()}, f)
            self.data = {k: v.to(dev) for k, v in self.data.items()}
        self.key = key

    def _compute(self) -> Dict[str, torch.Tensor]:
        model, tok, mp = self.sess.require()
        dev = next(model.parameters()).device
        sums: Dict[str, torch.Tensor] = {}
        count = 0
        hooks = []

        def add(key, t):
            t = t.detach().float().reshape(-1, t.shape[-1]).sum(0)
            sums[key] = sums.get(key, 0) + t

        for i in range(mp.n_layers):
            hooks.append(mp.head_proj(i).register_forward_pre_hook(
                lambda m, a, i=i: add(f"heads.{i}", a[0])))
            hooks.append(mp.attn(i).register_forward_hook(
                lambda m, a, o, i=i: add(f"attn.{i}", o[0] if isinstance(o, tuple) else o)))
            hooks.append(mp.mlp(i).register_forward_hook(
                lambda m, a, o, i=i: add(f"mlp.{i}", o[0] if isinstance(o, tuple) else o)))

            def blk(m, a, kw, o, i=i):
                x = a[0] if a else kw["hidden_states"]
                y = o[0] if isinstance(o, tuple) else o
                add(f"block.{i}", y - x)
            hooks.append(mp.block(i).register_forward_hook(blk, with_kwargs=True))
        try:
            with torch.no_grad():
                for p in corpus_passages():
                    ids = tok(p, return_tensors="pt").input_ids.to(dev)
                    model(ids, use_cache=False)
                    count += ids.shape[1]
        finally:
            for h in hooks:
                h.remove()
        out = {k: v / count for k, v in sums.items()}
        for i in range(mp.n_layers):
            out[f"heads.{i}"] = out[f"heads.{i}"].reshape(-1, mp.d_head)[: mp.n_heads]
        return out

    def heads(self, layer: int) -> torch.Tensor:
        self._ensure()
        return self.data[f"heads.{layer}"]

    def output(self, kind: str, layer: int) -> torch.Tensor:
        self._ensure()
        return self.data[f"{kind}.{layer}"]
