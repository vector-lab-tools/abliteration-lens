# Abliteration Lens tests: a unit's help, opened by the (?) on its strip. The server serves the
# installed vau's explainer files and no others; the help box shows the manifest and, for a unit
# with an explainer, a place for its figure.
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402
from abliteration import vauhost  # noqa: E402

HOST = {"host": f"127.0.0.1:{server.PORT}"}     # the server answers this machine only


@pytest.fixture(scope="module")
def client():
    return TestClient(server.app, headers=HOST)


def test_the_explainer_files_are_served(client):
    for name, kind in (("explain.js", "javascript"), ("explain.css", "css"), ("examples.json", "json"),
                       ("compressor.explain.js", "javascript"), ("entropy.explain.js", "javascript")):
        r = client.get(f"/vau/explain/{name}")
        assert r.status_code == 200 and kind in r.headers["content-type"], name
    assert 'X.register("compressor"' in client.get("/vau/explain/compressor.explain.js").text
    assert json.loads(client.get("/vau/explain/examples.json").text)["provenance"]["seed"] == 42


def test_no_other_file_is_served_from_there(client):
    for name in ("server.py", "registry.py", "compressor.py", "nothing.explain.js", "..%2Fserver.py", "%2E%2E%2FREADME.md", "units.js"):
        assert client.get(f"/vau/explain/{name}").status_code == 404, name
    assert client.get("/vau/explain/../server.py").status_code != 200


def test_the_catalogue_marks_the_units_with_an_explainer():
    units = {u["id"]: u for u in vauhost.catalogue()["units"]}
    assert units["compressor"]["explain"] is True and units["peakshare"]["explain"] is True
    assert set(vauhost.explain_files()) >= {f"{uid}.explain.js" for uid in units}


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node to run the page's script")
def test_the_help_box_shows_the_manifest_and_a_place_for_the_figure():
    m = next(u for u in vauhost.catalogue()["units"] if u["id"] == "gate")
    plain = dict(m, explain=False)
    script = (ROOT / "web" / "boxes.js").read_text() + f"""
    const m = {json.dumps(m)}, plain = {json.dumps(plain)};
    console.log(JSON.stringify([Boxes.unitHelpHTML(m), Boxes.unitHelpHTML(plain)]));"""
    stub = ("globalThis.localStorage = { getItem: () => null, setItem() {} };"
            "globalThis.document = { documentElement: { style: { setProperty() {} }, setAttribute() {}, classList: { toggle() {} } },"
            " querySelector: () => null, querySelectorAll: () => [] };"
            "globalThis.window = globalThis;")
    out = subprocess.run(["node", "-e", stub + script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    with_fig, without = json.loads(out.stdout)
    for html in (with_fig, without):
        assert "<b>Sparsify</b>" in html and m["what"] in html and "data-x" in html
        for p in m["params"]:
            assert f"<code>{p['key']}</code>" in html
    assert "keep the ⌈keep · d⌉ largest" in with_fig                    # a parameter's tip
    assert 'class="uh-fig"' in with_fig and 'class="uh-fig"' not in without


def test_the_desk_puts_the_help_button_on_unit_strips():
    desk = (ROOT / "web" / "desk.js").read_text()
    assert 'class="qhelp"' in desk and "Boxes.unitHelp(l.spec.unit.manifest" in desk
