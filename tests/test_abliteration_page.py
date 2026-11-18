# Abliteration Lens tests: the site's abliteration page. Its texts are real runs, made by
# tools/abliteration_page.py; every chain they name parses, the page reads the data it ships, and
# the site links to it.
# Run: .venv/bin/python -m pytest -q
# SPDX-License-Identifier: GPL-3.0-or-later
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tools"))

from abliteration.interventions import parse_chain  # noqa: E402


def data():
    return json.loads((DOCS / "abliteration-data.js").read_text().split("window.ABL = ", 1)[1].rstrip().rstrip(";"))


def test_every_chain_on_the_page_parses():
    d = data()
    rows = (d["moves"]["add"] + d["moves"]["remove"] + d["moves"]["turn"] + d["depth"] + d["edge"]
            + [d["not"]["model"], d["echo"]["model"], d["echo"]["model_more"], d["movement"]["whole"], d["movement"]["from15"]])
    for r in rows:
        parse_chain(r["chain"])
        assert r["text"] and 0 <= r["edit"] <= 1
    assert d["provenance"]["seed"] == 42 and d["provenance"]["model"] == "openai-community/gpt2"
    assert [s["layer"] for s in d["depth"]] == list(range(13))
    assert d["takes"]["repeat_same"] is True and len(d["takes"]["texts"]) == len(d["takes"]["seeds"])


def test_the_negation_edit_deletes_only_negation():
    from abliteration_page import delete_negations
    assert delete_negations(" you can't go. It is not here, and they don't know.") == " you can go. It is here, and they do know."


def test_the_page_reads_its_data_and_the_site_links_to_it():
    page = (DOCS / "abliteration.html").read_text()
    assert 'src="abliteration-data.js"' in page and 'src="abliteration.js"' in page
    for i in ("viz-art", "art-text", "trio-not", "trio-echo", "viz-depth", "depth-text", "trio-move", "trio-edge", "takes-list"):
        assert f'id="{i}"' in page, i
    assert "—" not in page
    ids = __import__("re").findall(r'\bid="([^"]+)"', page)
    assert len(ids) == len(set(ids)), "an id used twice"
    assert 'href="abliteration.html"' in (DOCS / "index.html").read_text()
