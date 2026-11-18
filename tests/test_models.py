# Abliteration Lens tests: the models the bench can play (Settings, Models, and the (i) on the
# Instrument), the Help box, and the Session's switch hidden. The routes read the presets and a
# Hugging Face cache (here a fake one in a temporary folder) and never download.
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402
from safetensors.torch import save_file  # noqa: E402

import server  # noqa: E402
from abliteration import model as mdl  # noqa: E402
from abliteration import models  # noqa: E402

HOST = {"host": f"127.0.0.1:{server.PORT}"}
PRESETS = ["openai-community/gpt2", "Qwen/Qwen3-0.6B", "EleutherAI/pythia-160m", "EleutherAI/pythia-410m", "meta-llama/Llama-3.2-3B"]

GPT2 = {"model_type": "gpt2", "architectures": ["GPT2LMHeadModel"], "n_layer": 2, "n_head": 4, "n_embd": 16,
        "n_positions": 32, "n_ctx": 32, "vocab_size": 50, "activation_function": "gelu_new"}
LLAMA = {"model_type": "qwen3", "architectures": ["Qwen3ForCausalLM"], "num_hidden_layers": 3, "num_attention_heads": 4,
         "num_key_value_heads": 2, "hidden_size": 32, "head_dim": 8, "intermediate_size": 64, "vocab_size": 60,
         "max_position_embeddings": 128, "rope_theta": 1000000, "hidden_act": "silu", "torch_dtype": "bfloat16",
         "tie_word_embeddings": True}


def repo(cache: Path, mid: str, cfg: dict, tensors: dict, sha: str = "abc123", ref: bool = True):
    d = cache / ("models--" + mid.replace("/", "--"))
    snap = d / "snapshots" / sha
    snap.mkdir(parents=True)
    (snap / "config.json").write_text(json.dumps(cfg))
    (snap / "vocab.json").write_text("{}")
    (snap / "merges.txt").write_text("")
    if tensors:
        save_file(tensors, str(snap / "model.safetensors"))
    if ref:
        (d / "refs").mkdir()
        (d / "refs" / "main").write_text(sha)
    return snap


@pytest.fixture
def cache(tmp_path, monkeypatch):
    """A fake Hugging Face cache: a tiny GPT-2 (with a causal-mask buffer beside its weights), a
    tiny Qwen3, a BERT the bench does not support, and a repo with a config but no weights."""
    monkeypatch.setattr(mdl, "hub_cache", lambda: tmp_path)
    repo(tmp_path, "test/tiny-gpt2", GPT2, {"wte.weight": torch.zeros(50, 16), "wpe.weight": torch.zeros(32, 16),
                                             "h.0.attn.c_attn.weight": torch.zeros(16, 48),
                                             "h.0.attn.bias": torch.zeros(1, 1, 32, 32)})
    repo(tmp_path, "test/tiny-qwen", LLAMA, {"model.embed_tokens.weight": torch.zeros(60, 32, dtype=torch.bfloat16),
                                              "model.layers.0.mlp.down_proj.weight": torch.zeros(32, 64, dtype=torch.bfloat16)},
         ref=False)
    repo(tmp_path, "test/bert", {"model_type": "bert", "architectures": ["BertModel"]}, {"w": torch.zeros(2, 2)})
    repo(tmp_path, "test/partial", GPT2, {})
    # nothing here may reach the network
    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(AssertionError("network")))
    return tmp_path


@pytest.fixture(scope="module")
def client():
    return TestClient(server.app, headers=HOST)


def test_the_presets_keep_vectorscopes_fields_and_add_the_facts():
    ps = {p["id"]: p for p in models.presets()}
    assert list(ps) == PRESETS
    for p in ps.values():
        assert {"id", "name", "year", "layers", "heads", "note"} <= set(p)          # Vectorscope's fields
        assert {"org", "released", "licence", "card", "sources"} <= set(p)         # added by hand, with sources
    assert ps["openai-community/gpt2"]["licence"] == "MIT" and ps["meta-llama/Llama-3.2-3B"]["gated"] is True
    assert ps["EleutherAI/pythia-160m"]["checkpoints"] is True


def test_the_list_marks_presets_and_finds_supported_models_in_the_cache(client, cache):
    r = client.get("/api/models").json()
    by = {m["id"]: m for m in r["models"]}
    assert [m["id"] for m in r["models"][:5]] == PRESETS
    assert all(by[p]["cached"] is False for p in PRESETS)                        # not in this cache
    assert by["test/tiny-gpt2"]["cached"] and by["test/tiny-gpt2"]["family"] == "gpt2" and not by["test/tiny-gpt2"]["preset"]
    assert by["test/tiny-qwen"]["family"] == "llama"                             # found without a ref
    assert "test/bert" not in by and "test/partial" not in by                     # unsupported; no weights
    assert r["machine"]["device"] in ("cpu", "mps", "cuda") and r["machine"]["ram_total"] > 0


def test_the_deep_dive_reads_config_and_weights(client, cache):
    i = client.get("/api/models/test/tiny-gpt2/info").json()
    a, z = i["architecture"], i["size"]
    assert (a["family"], a["layers"], a["heads"], a["d_model"], a["d_mlp"], a["vocab"], a["context"]) == ("gpt2", 2, 4, 16, 64, 50, 32)
    assert a["positions"] == "learned" and a["tied"] is True and a["kv_heads"] is None
    assert z["params"] == 50 * 16 + 32 * 16 + 16 * 48                              # the mask buffer is not counted
    assert z["load_dtype"] == "float32" and z["memory"] == z["params"] * 4 and z["disk"] > 0
    assert i["snapshot"] == {"sha": "abc123", "ref": "main"} and i["tokenizer"]["type"] == "BPE"
    pos = next(s for s in i["support"]["strips"] if s["kind"] == "position")
    assert pos["ok"] and i["support"]["paths"]["head_proj"] == "model.transformer.h[{i}].attn.c_proj"

    q = client.get("/api/models/test/tiny-qwen/info").json()
    assert q["architecture"]["kv_heads"] == 2 and q["architecture"]["positions"] == "rotary"
    assert q["size"]["load_dtype"] == "bfloat16" and q["size"]["memory"] == q["size"]["params"] * 2
    assert q["snapshot"]["ref"] is None
    pos = next(s for s in q["support"]["strips"] if s["kind"] == "position")
    assert not pos["ok"] and "learned positions" in pos["why"]
    assert all(s["ok"] for s in q["support"]["strips"] if s["kind"] != "position")


def test_a_preset_not_downloaded_shows_its_facts_and_no_guesses(client, cache):
    i = client.get("/api/models/EleutherAI/pythia-410m/info").json()
    assert i["cached"] is False and i["preset"]["org"] == "EleutherAI"
    assert "architecture" not in i and i["support"] is None and "params" not in i["size"]


def test_an_unknown_model_is_refused(client, cache):
    assert client.get("/api/models/nobody/nothing/info").status_code == 404
    assert client.get("/api/models/test/bert-not-here/info").status_code == 404
    assert client.get("/api/models/..%2F..%2Fetc/info").status_code == 404


def test_a_hub_id_with_no_organisation_opens_from_the_cache(client, cache):
    repo(cache, "tiny-legacy", GPT2, {"wte.weight": torch.zeros(50, 16)})
    assert "tiny-legacy" in {m["id"] for m in client.get("/api/models").json()["models"]}
    i = client.get("/api/models/tiny-legacy/info")
    assert i.status_code == 200 and i.json()["architecture"]["layers"] == 2 and "org_id" not in i.json()
    assert client.get("/api/models/not-cached/info").status_code == 404
    assert client.get("/api/models/../info").status_code == 404


def test_fetching_from_hugging_face_is_a_deliberate_write(client, cache):
    assert client.post("/api/models/fetch", json={"model": "test/tiny-gpt2"}).status_code == 403    # no header
    r = client.post("/api/models/fetch", json={"model": "not an id"}, headers={"X-Abliteration": "1"})
    assert r.status_code == 400


def node(script, pre=""):
    stub = pre + ("globalThis.localStorage = { getItem: () => null, setItem() {} };"
            "globalThis.document = { documentElement: { style: { setProperty() {} } }, querySelector: () => null, querySelectorAll: () => [] };"
            "globalThis.window = globalThis;")
    out = subprocess.run(["node", "-e", stub + (ROOT / "web" / "boxes.js").read_text() + ";globalThis.Boxes = Boxes;"
                          + (ROOT / "web" / "help.js").read_text() + script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node to run the page's script")
def test_the_deep_dive_html_builds(client, cache):
    cached = client.get("/api/models/test/tiny-qwen/info").json()
    absent = client.get("/api/models/meta-llama/Llama-3.2-3B/info").json()
    a, b = node(f"console.log(JSON.stringify([Boxes.modelInfoHTML({json.dumps(cached)}), Boxes.modelInfoHTML({json.dumps(absent)})]));")
    assert "data-load" in a and "data-fetch" not in a and "grouped-query attention" in a and "Position bend</b> does not" in a
    assert "data-fetch" in b and "huggingface.co" in b and "Meta" in b and "Gated" in b and "December 2023" in b


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node to run the page's script")
def test_the_help_lists_the_units_from_their_manifests():
    """One text per unit: Help lists each unit from the catalogue and opens the same help as its (?)."""
    from abliteration import vauhost
    cat = vauhost.catalogue()
    effects = [u for u in cat["units"] if u["category"] == "effect"]
    topic, body = node("""const H = window.HELP, i = H.findIndex((x) => x.t === "Effects");
      console.log(JSON.stringify([H[i].b, Boxes.unitHelpBody(window.VAU.units.find((u) => u.id === "compressor"))]));""",
                       pre=f"globalThis.VAU = {json.dumps(cat)};")
    for u in effects:
        assert f'data-unit="{u["id"]}"' in topic and u["what"] in topic
        if u.get("help"):
            assert u["help"] not in topic                     # the help itself is drawn on opening, from the manifest
    assert "units.html" in topic and "help button" in topic
    assert 'class="uh"' in body and "uh-fig" in body


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node to run the page's script")
def test_the_help_box_has_grouped_topics_and_links_out():
    H, box, units, first = node("""console.log(JSON.stringify([window.HELP.map((x) => [x.g, x.t, !!x.s]), Boxes.helpHTML(window.HELP),
      Boxes.helpTopicHTML(window.HELP, window.HELP.findIndex((x) => x.t === "Units (VAU)")), Boxes.helpTopicHTML(window.HELP, 0)]));""")
    groups = list(dict.fromkeys(g for g, _, _ in H))
    assert len(groups) >= 6 and all(s for _, _, s in H)                          # grouped, each with a summary
    assert "Models" in [t for _, t, _ in H]
    assert not any("session" in t.lower() for _, t, _ in H)
    assert 'class="hb-filter"' in box and 'class="hb-select"' in box and 'role="listbox"' in box
    assert "https://vector-lab-tools.github.io/abliteration-lens/" in box and "https://vector-lab-tools.github.io/vector-abliteration-units/" in box
    assert "More on the VAU site" in units and 'data-go="' in units
    assert "data-go=\"1\"" in first and "←" not in first                           # the first topic has Next only
    text = (ROOT / "web" / "help.js").read_text()
    assert "Session" not in text and "☰" not in text and "▦" not in text


def test_the_session_switch_is_hidden_behind_a_flag():
    ws = (ROOT / "web" / "workspace.js").read_text()
    assert "const SESSION = false;" in ws and 'if (!SESSION) v = "arr";' in ws
    assert 'class="transport viewswap" role="group" aria-label="View" hidden>' in (ROOT / "web" / "index.html").read_text()
