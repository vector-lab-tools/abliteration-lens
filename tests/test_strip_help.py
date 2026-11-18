# Abliteration Lens tests: the built-in strips' help cards. Each strip has a figure, a note for every
# parameter, and GPT-2's texts at the settings its figure walks through, made from the same
# prompt, seed and sampler as vau's examples; the (?), the Help box and the site's Strips page
# draw the same card.
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
EX = ROOT / "web" / "explain"
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402
from abliteration.interventions import parse_chain  # noqa: E402

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="needs node to run the page's script")


def specs():
    js = (ROOT / "web" / "desk.js").read_text() + ";console.log(JSON.stringify(Desk.SPECS));"
    stub = "globalThis.window = globalThis; globalThis.document = { addEventListener() {} }; globalThis.addEventListener = () => {};"
    out = subprocess.run(["node", "-e", stub + js], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@needs_node
def test_every_strip_has_a_figure_notes_and_examples():
    notes = json.loads((EX / "strips.json").read_text())
    ex = json.loads((EX / "examples.json").read_text())
    for kind, s in specs().items():
        assert (EX / f"{kind}.explain.js").read_text().count(f'X.register("{kind}"') == 1, kind
        assert kind in notes["explain"], kind
        tips = notes["tips"][kind]
        for key in [p["key"] for p in s["params"]] + s["targets"]:
            assert tips.get(key), f"{kind}: no note for {key}"
        rows = ex["units"][kind]
        assert rows and all(("reading" if s.get("probe") else "text") in r for r in rows), kind


def test_the_example_chains_parse_and_match_the_original():
    import vau
    ex = json.loads((EX / "examples.json").read_text())
    theirs = json.loads((Path(vau.__file__).parent / "explain" / "examples.json").read_text())
    assert ex["original"]["text"] == theirs["original"]["text"]
    assert ex["provenance"]["prompt"] == theirs["provenance"]["prompt"] and ex["provenance"]["seed"] == theirs["provenance"]["seed"]
    for kind, rows in ex["units"].items():
        for r in rows:
            parse_chain(r["chain"])


def test_the_server_serves_the_strips_help():
    c = TestClient(server.app, headers={"host": f"127.0.0.1:{server.PORT}"})
    assert "ablate" in c.get("/explain/strips.json").json()["tips"]
    assert 'X.register("ablate"' in c.get("/explain/ablate.explain.js").text
    assert "steer" in c.get("/explain/examples.json").json()["units"]


@needs_node
def test_a_strips_card_is_drawn_from_the_desk():
    stub = ("globalThis.localStorage = { getItem: () => null, setItem() {} };"
            "globalThis.document = { documentElement: { style: { setProperty() {} } }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };"
            "globalThis.window = globalThis; globalThis.addEventListener = () => {};")
    data = (EX / "strips.json").read_text()
    js = (stub + (ROOT / "web" / "desk.js").read_text() + ";globalThis.Desk = Desk;" + (ROOT / "web" / "boxes.js").read_text() +
          ";globalThis.Boxes = Boxes;" + (ROOT / "web" / "help.js").read_text() +
          f";const m = Boxes.stripManifest('ablate', {data}), g = Boxes.stripManifest('gauge', {data});"
          "console.log(JSON.stringify([m, Boxes.unitHelpHTML(m), g]));")
    out = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    m, card, g = json.loads(out.stdout)
    assert m["explain"] and m["source"] == "lens" and m["example"].startswith("ablate ") and "mode=zero" in m["help"]
    assert [p["key"] for p in m["params"]] == ["head", "attn", "mlp", "block", "mode"] and all(p["tip"] for p in m["params"])
    assert "uh-fig" in card and "Built into Abliteration Lens" in card and "built into the Lens" in card
    assert g["category"] == "meter" and g["params"][0]["hint"].startswith("one layer")


def test_the_site_has_every_strip():
    page = (ROOT / "docs" / "strips.html").read_text()
    notes = json.loads((EX / "strips.json").read_text())
    for kind in notes["explain"]:
        assert f'id="{kind}"' in page and f'data-vau-explain="{kind}"' in page, kind
        assert (ROOT / "docs" / "explain" / f"{kind}.explain.js").is_file(), kind
    assert 'href="strips.html"' in (ROOT / "docs" / "index.html").read_text()
