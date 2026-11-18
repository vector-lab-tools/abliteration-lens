# Abliteration Lens
# Copyright (C) 2026 David M. Berry
# SPDX-License-Identifier: GPL-3.0-or-later
"""
The models the bench can play, and a deep dive on each (Settings, Models, and the (i) on the
Instrument).

Everything here is read from this machine: the presets in backend/config/models.md (with the
facts no file holds, added by hand), the Hugging Face cache (each model's config.json,
tokenizer files and the headers of its safetensors files), and the loaded model. Nothing is
downloaded. `fetch` is the one exception, and runs only when the page asks for it (a click on
"Fetch details from Hugging Face"): it reads the model's public page and config.json from
huggingface.co, in memory, and saves nothing.
"""
from __future__ import annotations

import json
import os
import re
import struct
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from . import ROOT
from . import model as mdl

FAMILY_NAMES = {"gpt2": "GPT-2", "neox": "GPT-NeoX (Pythia)", "llama": "Llama-style"}
REPO_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}")
# the Hub's oldest repos (gpt2, bert-base-uncased) have no organisation, and the cache keeps them so
BARE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}")
FLOATS = {"F64": 8, "F32": 4, "F16": 2, "BF16": 2, "F8_E4M3": 1, "F8_E5M2": 1}
DTYPE_NAMES = {"F32": "float32", "F16": "float16", "BF16": "bfloat16", "F64": "float64"}
BYTES = {"float32": 4, "float16": 2, "bfloat16": 2, "float64": 8}
# tensors kept in the weights files that are not parameters: GPT-2's causal masks, the
# rotary tables some exports carry
BUFFERS = re.compile(r"(\.attn\.(masked_)?bias|\.attention\.(masked_)?bias|rotary_emb\.inv_freq)$")


# ---------------------------------------------------------------- presets and the cache

def presets() -> List[Dict[str, Any]]:
    text = (ROOT / "backend" / "config" / "models.md").read_text()
    m = re.search(r"```yaml\n(.*?)```", text, re.S)
    return (yaml.safe_load(m.group(1)) or {}).get("models", []) if m else []


def repo_dir(mid: str) -> Path:
    return mdl.hub_cache() / ("models--" + mid.replace("/", "--"))


def _weight_files(snap: Path) -> List[Path]:
    idx = snap / "model.safetensors.index.json"
    if idx.is_file():
        try:
            names = sorted(set(json.loads(idx.read_text())["weight_map"].values()))
            return [snap / n for n in names]
        except Exception:
            pass
    if (snap / "model.safetensors").exists():
        return [snap / "model.safetensors"]
    st = sorted(snap.glob("*.safetensors"))
    return st or sorted(snap.glob("pytorch_model*.bin"))


def snapshot(mid: str, revision: Optional[str] = None) -> Dict[str, Any]:
    """The cached snapshot of a repo for a revision (main if none), without downloading: its
    folder, commit and the ref that names it. A repo cached with no refs (copied in by hand, or
    downloaded by commit) gives its newest snapshot, with no ref."""
    if os.path.isdir(mid) and not REPO_ID.fullmatch(mid):
        p = Path(mid).resolve()
        return {"path": p, "sha": None, "ref": None, "local": True} if (p / "config.json").is_file() else {}
    root = repo_dir(mid)
    ref = root / "refs" / (revision or "main")
    if ref.is_file():
        sha = ref.read_text().strip()
        p = root / "snapshots" / sha
        if (p / "config.json").is_file():
            return {"path": p, "sha": sha, "ref": revision or "main"}
    if revision and revision != "main":
        p = root / "snapshots" / revision
        return {"path": p, "sha": revision, "ref": None} if (p / "config.json").is_file() else {}
    snaps = [p for p in (root / "snapshots").glob("*") if (p / "config.json").is_file()] if (root / "snapshots").is_dir() else []
    if not snaps:
        return {}
    p = max(snaps, key=lambda x: x.stat().st_mtime)
    refs = {r.read_text().strip(): r.name for r in (root / "refs").glob("*") if r.is_file()} if (root / "refs").is_dir() else {}
    return {"path": p, "sha": p.name, "ref": refs.get(p.name)}


def _config(snap: Path) -> Dict[str, Any]:
    try:
        return json.loads((snap / "config.json").read_text())
    except Exception:
        return {}


def downloaded(mid: str) -> bool:
    """A snapshot with a config.json and every weights file it names, all present."""
    s = snapshot(mid)
    if not s:
        return False
    files = _weight_files(s["path"])
    return bool(files) and all(f.exists() for f in files)


def scan() -> List[Dict[str, Any]]:
    """The supported models in the Hugging Face cache, by repo id."""
    out = []
    root = mdl.hub_cache()
    if not root.is_dir():
        return out
    for d in sorted(root.glob("models--*")):
        mid = d.name[len("models--"):].replace("--", "/", 1)
        s = snapshot(mid)
        if not s:
            continue
        cfg = _config(s["path"])
        fam = mdl.MODEL_TYPES.get(cfg.get("model_type", ""))
        if fam and downloaded(mid):
            out.append({"id": mid, "model_type": cfg["model_type"], "family": fam})
    return out


def listing() -> Dict[str, Any]:
    """The presets, then any other supported model in the cache, each marked downloaded and loaded."""
    loaded = mdl.session.info.get("model_id")
    out = []
    for p in presets():
        out.append({"id": p["id"], "name": p.get("name") or p["id"], "preset": True, "cached": downloaded(p["id"]),
                    "loaded": p["id"] == loaded, "gated": bool(p.get("gated")), "year": p.get("year"),
                    "checkpoints": bool(p.get("checkpoints")),
                    "revisions": [c["revision"] for c in mdl.local_checkpoints(p["id"])]})
    seen = {m["id"] for m in out}
    for c in scan():
        if c["id"] not in seen:
            out.append({"id": c["id"], "name": c["id"].split("/")[-1], "preset": False, "cached": True,
                        "loaded": c["id"] == loaded, "family": c["family"],
                        "revisions": [x["revision"] for x in mdl.local_checkpoints(c["id"])]})
            seen.add(c["id"])
    if loaded and loaded not in seen:     # a local folder
        out.append({"id": loaded, "name": mdl.session.info.get("name") or loaded, "preset": False, "cached": True,
                    "loaded": True, "local": True, "revisions": []})
    return {"models": out, "machine": machine()}


# ---------------------------------------------------------------- what the files say

def _safetensors_header(path: Path) -> Dict[str, Any]:
    with open(path, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        if n > 100_000_000:
            raise ValueError("not a safetensors header")
        return json.loads(f.read(n))


def count_params(files: List[Path]) -> Dict[str, Any]:
    """The parameter count and the weights' precision, from the safetensors headers alone (a few
    kilobytes each): the tensors' shapes, leaving out buffers kept beside the weights."""
    total, dtypes, buffers = 0, {}, 0
    for f in files:
        if f.suffix != ".safetensors" or not f.exists():
            return {}
        for k, v in _safetensors_header(f).items():
            if k == "__metadata__":
                continue
            n = 1
            for s in v["shape"]:
                n *= int(s)
            if v["dtype"] not in FLOATS or BUFFERS.search(k):
                buffers += n
                continue
            total += n
            dtypes[v["dtype"]] = dtypes.get(v["dtype"], 0) + n
    if not total:
        return {}
    main = max(dtypes, key=dtypes.get)
    return {"params": total, "dtype": DTYPE_NAMES.get(main, main.lower()), "buffers": buffers}


def _num(cfg: Dict[str, Any], *names):
    for n in names:
        if cfg.get(n) is not None:
            return cfg[n]
    return None


def architecture(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """The architecture as a config.json gives it, with the defaults the Transformers classes
    fill in where the file says nothing (GPT-2's MLP is four times its width, its embeddings tied)."""
    mt = cfg.get("model_type", "")
    fam = mdl.MODEL_TYPES.get(mt)
    d = _num(cfg, "hidden_size", "n_embd", "d_model")
    heads = _num(cfg, "num_attention_heads", "n_head")
    kv = _num(cfg, "num_key_value_heads")
    a: Dict[str, Any] = {
        "model_type": mt, "family": fam, "family_name": FAMILY_NAMES.get(fam),
        "architectures": cfg.get("architectures") or [],
        "layers": _num(cfg, "num_hidden_layers", "n_layer"), "heads": heads,
        "kv_heads": kv if kv and kv != heads else None,
        "d_model": d, "head_dim": _num(cfg, "head_dim") or (d // heads if d and heads else None),
        "d_mlp": _num(cfg, "intermediate_size", "n_inner") or (4 * d if fam == "gpt2" and d else None),
        "vocab": _num(cfg, "vocab_size"),
        "context": _num(cfg, "max_position_embeddings", "n_positions", "n_ctx"),
        "activation": _num(cfg, "hidden_act", "activation_function"),
        "tied": cfg.get("tie_word_embeddings", True if fam == "gpt2" else None),
        "native_dtype": cfg.get("torch_dtype") or cfg.get("dtype"),
    }
    if fam == "gpt2":
        a["positions"] = "learned"
        a["positions_note"] = f"a learned position embedding (wpe) for each of {a['context']} positions"
        a["norm"] = "LayerNorm"
    elif fam == "neox":
        pct = cfg.get("rotary_pct", 1.0)
        a["positions"] = "rotary"
        a["positions_note"] = (f"rotary, on {int(round(pct * 100))}% of each head's dimensions"
                               + (f", base {cfg['rotary_emb_base']:,}" if cfg.get("rotary_emb_base") else ""))
        a["norm"] = "LayerNorm"
        if cfg.get("use_parallel_residual"):
            a["parallel"] = True
    elif fam == "llama":
        rope = cfg.get("rope_theta")
        scaling = cfg.get("rope_scaling") or {}
        a["positions"] = "rotary"
        a["positions_note"] = "rotary" + (f", base {rope:,.0f}" if isinstance(rope, (int, float)) else "") + (
            f", scaled ({scaling.get('rope_type') or scaling.get('type')})" if scaling else "")
        a["norm"] = "RMSNorm"
        if cfg.get("sliding_window") and cfg.get("use_sliding_window"):
            a["sliding_window"] = cfg["sliding_window"]
    return a


def tokenizer(snap: Path) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    try:
        tc = json.loads((snap / "tokenizer_config.json").read_text())
        out["class"] = tc.get("tokenizer_class")
    except Exception:
        pass
    tj = snap / "tokenizer.json"
    if tj.exists():
        try:
            # only the start of the file: the model's type comes before its vocabulary
            with open(tj, "rb") as f:
                head = f.read(1 << 20).decode("utf-8", "ignore")
            m = re.search(r'"model"\s*:\s*\{\s*"type"\s*:\s*"(\w+)"', head)
            if m:
                out["type"] = m.group(1)
            if re.search(r'"type"\s*:\s*"ByteLevel"', head):
                out["byte_level"] = True
        except Exception:
            pass
    if "type" not in out and (snap / "vocab.json").exists() and (snap / "merges.txt").exists():
        out["type"] = "BPE"
    return out


def machine() -> Dict[str, Any]:
    """The device the bench uses and the memory free for a model."""
    import psutil
    import torch
    vm = psutil.virtual_memory()
    out = {"device": mdl.session.device, "ram_total": int(vm.total), "ram_available": int(vm.available)}
    if out["device"] == "cuda":
        try:
            free, total = torch.cuda.mem_get_info()
            out.update(device_free=int(free), device_total=int(total), device_name=torch.cuda.get_device_name(0))
        except Exception:
            pass
    elif out["device"] == "mps":
        out["shared"] = True        # Apple silicon: the GPU uses the machine's memory
        try:
            out["mps_limit"] = int(torch.mps.recommended_max_memory())
        except Exception:
            pass
    return out


def support(family: Optional[str]) -> Dict[str, Any]:
    """Which strips and units run on a family, from the strips' specs and the adapter's features
    (model.FEATURES, interventions.SPECS "needs_model"), and the units' needs against what the
    host offers (vauhost.CAPABILITIES)."""
    from .interventions import SPECS
    from . import vauhost
    have = mdl.FEATURES.get(family or "", set())
    strips, units = [], []
    catalogue = {u["id"]: u for u in vauhost.catalogue()["units"]}
    for kind, s in SPECS.items():
        need = [n for n in s.get("needs_model", []) if n not in have]
        row = {"kind": kind, "title": s["title"], "level": s["level"], "ok": not need}
        if need:
            row["why"] = f"needs {', '.join(need)}; this model's positions are rotary" if "learned positions" in need else f"needs {', '.join(need)}"
        if s.get("vau"):
            u = catalogue.get(kind, {})
            if u.get("missing"):
                row["ok"], row["why"] = False, f"needs {', '.join(u['missing'])}, which the bench does not offer"
            units.append(row)
        else:
            strips.append(row)
    notes = []
    if family in ("gpt2", "neox"):
        notes.append("A direction made from a word is the word's output embedding with its mean taken away "
                     "(centred), as the bench does for GPT-2 and Pythia.")
    if family == "gpt2":
        notes.append("GPT-2 ties its input and output embeddings, so a word's direction is also close to its input embedding.")
    if family == "neox":
        notes.append("Each block adds its attention and its MLP to the stream side by side (parallel), "
                     "so the MLP of a block does not read that block's attention.")
    if family == "llama":
        notes.append("Ablate, Scale and Attention scope on a head act on that query head; heads that share "
                     "key and value heads are still addressed one by one.")
    return {"strips": strips, "units": units, "paths": mdl.PATHS.get(family or "", {}), "notes": notes}


# ---------------------------------------------------------------- the deep dive

def known(mid: str) -> bool:
    if any(p["id"] == mid for p in presets()):
        return True
    if mdl.session.info.get("model_id") == mid:
        return True
    if BARE_ID.fullmatch(mid):                       # only when the cache has its own folder for it
        return repo_dir(mid).is_dir() and bool(snapshot(mid))
    return bool(REPO_ID.fullmatch(mid)) and bool(snapshot(mid))


def info(mid: str, revision: Optional[str] = None) -> Dict[str, Any]:
    """Everything known about one model on this machine. Raises KeyError for a model that is
    neither a preset, nor in the cache, nor loaded."""
    if not known(mid):
        raise KeyError(mid)
    preset = next((p for p in presets() if p["id"] == mid), None)
    loaded = mdl.session.info if mdl.session.info.get("model_id") == mid else None
    if loaded and not revision:
        revision = loaded.get("revision") if loaded.get("revision") != "main" else None
    snap = snapshot(mid, revision)
    out: Dict[str, Any] = {"id": mid, "name": (preset or {}).get("name") or mid.rstrip("/").split("/")[-1],
                           "preset": preset, "loaded": loaded, "cached": downloaded(mid),
                           "revision": revision or "main",
                           "checkpoints": mdl.local_checkpoints(mid) if REPO_ID.fullmatch(mid) else [],
                           "host": "a local folder" if snap.get("local") else "Hugging Face (huggingface.co)",
                           "machine": machine()}
    if REPO_ID.fullmatch(mid):
        out["org_id"] = mid.split("/")[0]
    size: Dict[str, Any] = {}
    if snap:
        p = snap["path"]
        out["snapshot"] = {"sha": snap.get("sha"), "ref": snap.get("ref")}
        cfg = _config(p)
        out["architecture"] = architecture(cfg)
        out["tokenizer"] = tokenizer(p)
        files = _weight_files(p)
        present = [f for f in files if f.exists()]
        size["files"] = [f.name for f in files]
        size["complete"] = bool(files) and len(present) == len(files)
        size["disk"] = sum(f.stat().st_size for f in present)
        try:
            counted = count_params(present) if size["complete"] else {}
        except Exception:
            counted = {}
        if counted:
            size.update(params=counted["params"], params_from="the weights' headers", file_dtype=counted["dtype"])
        native = out["architecture"].get("native_dtype") or counted.get("dtype")
        size["native_dtype"] = native
    if loaded:
        size["params"] = loaded.get("n_params")
        size["params_from"] = "the loaded model"
        size["native_dtype"] = loaded.get("native_dtype") or size.get("native_dtype")
        size["load_dtype"] = loaded.get("dtype")
        out.setdefault("architecture", {}).update(
            {k: v for k, v in {"layers": loaded.get("n_layers"), "heads": loaded.get("n_heads"),
                               "d_model": loaded.get("d_model"), "head_dim": loaded.get("d_head"),
                               "vocab": loaded.get("vocab_size")}.items() if v is not None})
        fam = loaded.get("family")
        out["architecture"]["family"] = fam
        out["architecture"]["family_name"] = FAMILY_NAMES.get(fam)
        out["architecture"].setdefault("model_type", loaded.get("architecture"))
        out["architecture"]["tied"] = loaded.get("weight_tied")
    if size.get("native_dtype") and "load_dtype" not in size:
        size["load_dtype"] = mdl.load_dtype(size["native_dtype"])
    if size.get("params") and size.get("load_dtype") in BYTES:
        size["memory"] = int(size["params"] * BYTES[size["load_dtype"]])
    out["size"] = size
    fam = (out.get("architecture") or {}).get("family")
    out["support"] = support(fam) if fam else None      # unknown until its config.json is read
    return out


# ---------------------------------------------------------------- huggingface.co, on request only

def _get(url: str, timeout: float = 10.0) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "abliteration-lens"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(2_000_000))


def fetch(mid: str) -> Dict[str, Any]:
    """The model's public page and config.json from huggingface.co, read into memory. Nothing is
    written to the cache. A gated model's config.json needs an account, so only its page is read."""
    if not REPO_ID.fullmatch(mid):
        raise ValueError("A Hugging Face id is organisation/name.")
    out: Dict[str, Any] = {"id": mid, "contacted": "huggingface.co"}
    try:
        page = _get(f"https://huggingface.co/api/models/{mid}")
    except urllib.error.HTTPError as e:
        raise ValueError(f"Hugging Face answered {e.code} for {mid}.")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ValueError(f"Could not reach huggingface.co ({getattr(e, 'reason', e)}).")
    card = page.get("cardData") or {}
    st = page.get("safetensors") or {}
    out["page"] = {"author": page.get("author"), "created": page.get("createdAt"), "modified": page.get("lastModified"),
                   "sha": page.get("sha"), "gated": page.get("gated") or False, "licence": card.get("license"),
                   "stored_tensors": st.get("total"), "pipeline": page.get("pipeline_tag")}
    try:
        cfg = _get(f"https://huggingface.co/{mid}/resolve/main/config.json")
        out["architecture"] = architecture(cfg)
        out["support"] = support(out["architecture"]["family"])
    except Exception as e:
        out["config_error"] = ("config.json needs a Hugging Face account for this model"
                               if isinstance(e, urllib.error.HTTPError) and e.code in (401, 403) else f"config.json not read ({e})")
    return out
