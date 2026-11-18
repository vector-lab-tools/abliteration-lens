# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
The model session: one model in memory at a time, and a map of its hook points.

Device detection, native-dtype detection and the block lookup are adapted from
Vectorscope (backend/models/session.py and
backend/operations/grammar_steering.py::_find_transformer_blocks), GPL-3.0-or-later.

Differences from Vectorscope:
- Models under one billion parameters load in float32 on every device, so that a
  run can be regenerated exactly. Larger models keep their native precision.
- The session records the snapshot commit (revision hash) of the weights.
- `ModelMap` names the hook points the interventions use, per architecture.
"""
from __future__ import annotations

import gc
import hashlib
import json
import os
import threading
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer

DTYPES = {"float32": torch.float32, "float16": torch.float16, "bfloat16": torch.bfloat16}


def detect_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _cfg(config, *names, default=None):
    for n in names:
        v = getattr(config, n, None)
        if v is not None:
            return v
    return default


@dataclass
class ModelMap:
    """Where the hook points are in one loaded model."""

    family: str                      # gpt2 | neox | llama
    blocks_owner: Any                # module holding the block list
    blocks_attr: str                 # its attribute name
    n_layers: int
    n_heads: int
    d_head: int
    d_model: int
    embed: Any                       # token embedding module
    pos_embed: Any = None            # learned position embedding module, if the model has one
    paths: Dict[str, str] = field(default_factory=dict)   # printable paths, for the Code view

    @property
    def blocks(self):
        return getattr(self.blocks_owner, self.blocks_attr)

    def block(self, i: int):
        return self.blocks[i]

    def attn(self, i: int):
        b = self.block(i)
        return {"gpt2": lambda: b.attn, "neox": lambda: b.attention, "llama": lambda: b.self_attn}[self.family]()

    def head_proj(self, i: int):
        """The linear map whose input is the heads' outputs side by side."""
        a = self.attn(i)
        return {"gpt2": lambda: a.c_proj, "neox": lambda: a.dense, "llama": lambda: a.o_proj}[self.family]()

    def mlp(self, i: int):
        return self.block(i).mlp

    def mlp_proj(self, i: int):
        """The linear map from the MLP's hidden units to the residual stream."""
        m = self.mlp(i)
        return {"gpt2": lambda: m.c_proj, "neox": lambda: m.dense_4h_to_h, "llama": lambda: m.down_proj}[self.family]()

    def final_norm(self):
        """The norm between the last block and the unembedding."""
        o = self.blocks_owner
        return {"gpt2": lambda: o.ln_f, "neox": lambda: o.final_layer_norm, "llama": lambda: o.norm}[self.family]()

    def path(self, kind: str, i: Optional[int] = None) -> str:
        p = self.paths[kind]
        return p.format(i=i)


# Where the hook points are, per family: the paths the Code view prints, and the deep dive
# on a model (Settings, Models) shows before it is loaded.
PATHS: Dict[str, Dict[str, str]] = {
    "gpt2": {"block": "model.transformer.h[{i}]", "attn": "model.transformer.h[{i}].attn",
             "head_proj": "model.transformer.h[{i}].attn.c_proj", "mlp": "model.transformer.h[{i}].mlp",
             "mlp_proj": "model.transformer.h[{i}].mlp.c_proj",
             "embed": "model.transformer.wte", "blocks": "model.transformer.h"},
    "neox": {"block": "model.gpt_neox.layers[{i}]", "attn": "model.gpt_neox.layers[{i}].attention",
             "head_proj": "model.gpt_neox.layers[{i}].attention.dense", "mlp": "model.gpt_neox.layers[{i}].mlp",
             "mlp_proj": "model.gpt_neox.layers[{i}].mlp.dense_4h_to_h",
             "embed": "model.gpt_neox.embed_in", "blocks": "model.gpt_neox.layers"},
    "llama": {"block": "model.model.layers[{i}]", "attn": "model.model.layers[{i}].self_attn",
              "head_proj": "model.model.layers[{i}].self_attn.o_proj", "mlp": "model.model.layers[{i}].mlp",
              "mlp_proj": "model.model.layers[{i}].mlp.down_proj",
              "embed": "model.model.embed_tokens", "blocks": "model.model.layers"},
}
# What the adapter offers in each family beyond the hook points above. A strip whose spec has
# "needs_model" runs only where the family offers each feature (interventions.SPECS).
FEATURES: Dict[str, set] = {
    "gpt2": {"learned positions"},   # the map's pos_embed: GPT-2's wpe
    "neox": set(),                   # rotary positions
    "llama": set(),                  # rotary positions
}
# The config's model_type for each architecture the adapter knows.
MODEL_TYPES = {"gpt2": "gpt2", "gpt_neox": "neox", "llama": "llama", "qwen2": "llama", "qwen3": "llama",
               "mistral": "llama", "olmo2": "llama"}


def build_map(model) -> ModelMap:
    cfg = model.config
    n_heads = int(_cfg(cfg, "num_attention_heads", "n_head"))
    d_model = int(_cfg(cfg, "hidden_size", "n_embd"))
    d_head = int(_cfg(cfg, "head_dim", default=d_model // n_heads) or d_model // n_heads)
    if hasattr(model, "transformer") and hasattr(model.transformer, "h"):
        base = model.transformer
        return ModelMap("gpt2", base, "h", len(base.h), n_heads, d_head, d_model, base.wte, base.wpe, dict(PATHS["gpt2"]))
    if hasattr(model, "gpt_neox"):
        base = model.gpt_neox
        return ModelMap("neox", base, "layers", len(base.layers), n_heads, d_head, d_model, base.embed_in, None,
                        dict(PATHS["neox"]))
    if hasattr(model, "model") and hasattr(model.model, "layers"):
        base = model.model
        return ModelMap("llama", base, "layers", len(base.layers), n_heads, d_head, d_model, base.embed_tokens, None,
                        dict(PATHS["llama"]))
    raise ValueError("This architecture is not supported: Abliteration Lens knows GPT-2, GPT-NeoX (Pythia) "
                     "and Llama-style models (Llama, Qwen, Mistral, OLMo-2).")


def load_dtype(native: str) -> str:
    """The precision a model loads in: float32 unless the weights are bf16 on disk (Qwen, Llama).
    An fp16 or fp32 model widened to float32 loses nothing, and float32 regenerates exactly."""
    return "bfloat16" if native == "bfloat16" else "float32"


def _snapshot_dir(model_id: str, revision: Optional[str]) -> Optional[str]:
    """The cached snapshot folder for a repo id and revision, without downloading."""
    if os.path.isdir(model_id):
        return os.path.abspath(model_id)
    try:
        from huggingface_hub import try_to_load_from_cache
        hit = try_to_load_from_cache(model_id, "config.json", revision=revision)
        if isinstance(hit, str):
            return os.path.dirname(hit)
    except Exception:
        pass
    return None


def _native_dtype(config, snap: Optional[str]) -> str:
    d = getattr(config, "torch_dtype", None)
    if isinstance(d, torch.dtype):
        return str(d).replace("torch.", "")
    if isinstance(d, str):
        return d
    if snap and os.path.isfile(os.path.join(snap, "model.safetensors")):
        try:
            from safetensors import safe_open
            with safe_open(os.path.join(snap, "model.safetensors"), framework="pt") as f:
                for k in f.keys():
                    return {"F32": "float32", "F16": "float16", "BF16": "bfloat16"}.get(
                        f.get_slice(k).get_dtype(), "unknown")
        except Exception:
            pass
    return "unknown"


def hub_cache() -> Path:
    """The Hugging Face cache folder (HF_HUB_CACHE or HF_HOME, else ~/.cache/huggingface/hub)."""
    try:
        from huggingface_hub import constants
        return Path(constants.HF_HUB_CACHE)
    except Exception:
        return Path.home() / ".cache" / "huggingface" / "hub"


def local_checkpoints(model_id: str) -> List[Dict[str, str]]:
    """Revisions of a repo already in the Hugging Face cache (Pythia's step checkpoints)."""
    root = hub_cache() / ("models--" + model_id.replace("/", "--"))
    out = []
    refs = root / "refs"
    if refs.is_dir():
        for r in sorted(refs.iterdir()):
            sha = r.read_text().strip()
            if (root / "snapshots" / sha / "config.json").exists():
                out.append({"revision": r.name, "sha": sha})
    def key(x):
        n = x["revision"]
        return (0, int(n[4:])) if n.startswith("step") and n[4:].isdigit() else (1, 0)
    return sorted(out, key=key)


class Session:
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.map: Optional[ModelMap] = None
        self.info: Dict[str, Any] = {}
        self.device = detect_device()
        self.lock = threading.RLock()    # one model job at a time

    def load(self, model_id: str, revision: Optional[str] = None, dtype: Optional[str] = None,
             device: Optional[str] = None) -> Dict[str, Any]:
        with self.lock:
            self.unload()
            device = device or self.device
            config = AutoConfig.from_pretrained(model_id, revision=revision, trust_remote_code=False)
            snap = _snapshot_dir(model_id, revision)
            native = _native_dtype(config, snap)
            tok = AutoTokenizer.from_pretrained(model_id, revision=revision, trust_remote_code=False)
            if dtype is None:
                dtype = load_dtype(native)
            model = AutoModelForCausalLM.from_pretrained(
                model_id, revision=revision, dtype=DTYPES[dtype], trust_remote_code=False,
                attn_implementation="eager")
            n_params = sum(p.numel() for p in model.parameters())
            model.to(device)
            model.eval()
            self.model, self.tokenizer = model, tok
            self.map = build_map(model)
            self.device = device
            sha = os.path.basename(snap) if snap and "snapshots" in snap else None
            if snap and not sha:
                sha = self._dir_hash(snap)
            self.info = {
                "model_id": model_id,
                "name": model_id.rstrip("/").split("/")[-1],
                "revision": revision or "main",
                "revision_hash": sha,
                "architecture": config.model_type,
                "family": self.map.family,
                "n_layers": self.map.n_layers,
                "n_heads": self.map.n_heads,
                "d_head": self.map.d_head,
                "d_model": self.map.d_model,
                "vocab_size": int(config.vocab_size),
                "n_params": int(n_params),
                "dtype": dtype,
                "native_dtype": native,
                "device": device,
                "weight_tied": bool(getattr(config, "tie_word_embeddings", False)),
            }
            return self.info

    @staticmethod
    def _dir_hash(path: str) -> str:
        """For a local folder: a hash of its config and weight file sizes and dates."""
        h = hashlib.sha256()
        for f in sorted(os.listdir(path)):
            if f.endswith((".json", ".safetensors", ".bin")):
                st = os.stat(os.path.join(path, f))
                h.update(f"{f}:{st.st_size}:{int(st.st_mtime)}".encode())
        return "local-" + h.hexdigest()[:16]

    def unload(self):
        self.model = None
        self.tokenizer = None
        self.map = None
        self.info = {}
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        if hasattr(torch, "mps") and torch.backends.mps.is_available():
            torch.mps.empty_cache()

    def require(self):
        if self.model is None:
            raise ValueError("No model is loaded.")
        return self.model, self.tokenizer, self.map

    def ensure(self, model_id: str, revision: Optional[str], dtype: Optional[str] = None):
        """Load the model a recipe names if a different one is in memory."""
        if (self.info.get("model_id") != model_id or self.info.get("revision") != (revision or "main")
                or (dtype and self.info.get("dtype") != dtype)):
            self.load(model_id, revision, dtype)


session = Session()
