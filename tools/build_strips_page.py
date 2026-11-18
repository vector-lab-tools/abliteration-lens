"""The site's Strips page (docs/strips.html): every built-in strip's help page, as the desk
and the Help box draw it, with its figure and example texts.

The cards are drawn by the page's own code (web/desk.js, web/boxes.js, web/help.js, run in node),
so the site and the app say the same thing. The figures are drawn by vau's explainer runtime,
copied from the installed package with the strips' explainers and the example texts of both
(vau's and web/explain/examples.json) into docs/explain/. Run from the repo, after
tools/strip_examples.py:

    .venv/bin/python tools/build_strips_page.py
"""
from __future__ import annotations

import html
import json
import shutil
import subprocess
from pathlib import Path

import vau

ROOT = Path(__file__).resolve().parents[1]
WEB, DOCS = ROOT / "web", ROOT / "docs"
OUT = DOCS / "explain"
VX = Path(vau.__file__).parent / "explain"
esc = html.escape

NODE = """
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { documentElement: { style: { setProperty() {} } }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
globalThis.window = globalThis; globalThis.addEventListener = () => {};
%s
;globalThis.Desk = Desk;
%s
;globalThis.Boxes = Boxes;
%s
;const data = %s;
const out = Object.keys(Desk.SPECS).map((k) => { const m = Boxes.stripManifest(k, data);
  return { m, body: Boxes.unitHelpBody({ ...m, help: "" }) }; });
console.log(JSON.stringify(out));
"""


def cards() -> list:
    data = json.loads((WEB / "explain" / "strips.json").read_text())
    js = NODE % ((WEB / "desk.js").read_text(), (WEB / "boxes.js").read_text(), (WEB / "help.js").read_text(), json.dumps(data))
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=60)
    if r.returncode:
        raise SystemExit(r.stderr)
    return json.loads(r.stdout)


def copy_figures(kinds: list) -> None:
    OUT.mkdir(exist_ok=True)
    for f in OUT.iterdir():
        f.unlink()
    shutil.copy(VX / "explain.js", OUT / "explain.js")
    shutil.copy(VX / "explain.css", OUT / "explain.css")
    for k in kinds:
        shutil.copy(WEB / "explain" / f"{k}.explain.js", OUT / f"{k}.explain.js")
    ex = json.loads((VX / "examples.json").read_text())
    mine = WEB / "explain" / "examples.json"
    if mine.exists():
        s = json.loads(mine.read_text())
        if s["original"]["text"] != ex["original"]["text"]:
            raise SystemExit("web/explain/examples.json has another original text than vau's: run tools/strip_examples.py again")
        ex = {**ex, "original": {**s["original"], **ex["original"]}, "units": {k: v for k, v in s["units"].items()},
              "provenance": s["provenance"]}
    (OUT / "examples.json").write_text(json.dumps(ex, ensure_ascii=False) + "\n")


GROUPS = [("model", "Strips on the model", "They change the forward pass: a component's output, the stream, the weights, the order of the blocks, the input."),
          ("sampler", "Sampler strips", "They change how the next token is chosen from the model's probabilities."),
          ("meter", "Meters", "They read the model and leave it unchanged, so the diverged text is the same with them or without them.")]


def page(cs: list) -> str:
    index = (DOCS / "index.html").read_text()
    head = index[: index.index("<section class=\"hero\">")]
    head = head.replace("<title>Abliteration Lens</title>", "<title>Strips · Abliteration Lens</title>")
    head = head.replace('<link rel="stylesheet" href="style.css">', '<link rel="stylesheet" href="style.css">\n  <link rel="stylesheet" href="explain/explain.css">')
    head = head.replace('<a href="#', '<a href="./#')
    foot = index[index.index("<footer class=\"site-footer\">"):]
    foot = foot.replace('<script src="site.js"></script>', '<script src="explain/explain.js"></script>\n' + "".join(
        f'<script src="explain/{c["m"]["id"]}.explain.js"></script>\n' for c in cs if c["m"]["explain"]) +
        '<script>fetch("explain/examples.json").then(function (r) { return r.json(); }).catch(function () { return false; })'
        '.then(function (ex) { VAUExplain.mountAll(document, { examples: ex }); });</script>\n<script src="site.js"></script>')
    kind = lambda c: c["m"]["category"] or "model"
    toc, body = [], []
    for g, title, intro in GROUPS:
        mine = [c for c in cs if kind(c) == g]
        toc.append(f'<div class="st-g"><b>{title}</b>' + "".join(f'<a href="#{c["m"]["id"]}">{esc(c["m"]["title"])}</a>' for c in mine) + "</div>")
        body.append(f'<h2 class="st-group" id="g-{g}">{title}</h2><p class="st-intro">{intro}</p>')
        for c in mine:
            m = c["m"]
            badge = ' <span class="meterbadge">meter</span>' if g == "meter" else ""
            card = c["body"].replace('<div class="uh-fig"><p class="uh-dim">Drawing the figure…</p></div>',
                                     f'<div class="uh-fig" data-vau-explain="{esc(m["id"])}" data-title="{esc(m["title"])}"></div>')
            body.append(f'''<article class="strip-card" id="{esc(m["id"])}">
      <div class="unit-head"><h3>{esc(m["title"])}{badge}</h3><span class="id">{esc(m["id"])}</span></div>
      {card}
      {f'<details class="st-more"><summary>More</summary><div class="uh-help">{m["help"]}</div></details>' if m["help"] else ""}
    </article>''')
    n = len(cs)
    return head + f'''<main id="main" class="wrap strips-page">
  <section>
    <span class="kicker">Abliteration Lens · the built-in strips</span>
    <h1>Strips</h1>
    <p>The {n} strips built into Abliteration Lens, each with the help page it opens on the desk: what it does, an animated figure of what its code computes, GPT-2 small's text at the settings the figure walks through (prompt “What matters about the archive is”, seed 42), and its parameters.</p>
    <p>These strips are the Lens's own code, so only the Lens runs them. The VAUs, such as vShrink and vSparsify from VAU's Core Collection, are <a href="https://vector-lab-tools.github.io/vector-abliteration-units/units.html">Vector Abliteration Units</a>: plug-ins that follow a standard any host can implement, documented on the VAU site.</p>
    <nav class="st-toc" aria-label="Strips">{"".join(toc)}</nav>
  </section>
  {"".join(body)}
</main>

''' + foot


def main() -> None:
    cs = cards()
    copy_figures([c["m"]["id"] for c in cs if c["m"]["explain"]])
    (DOCS / "strips.html").write_text(page(cs))
    print(f"docs/strips.html: {len(cs)} strips; docs/explain/: {sum(1 for c in cs if c['m']['explain'])} figures")


if __name__ == "__main__":
    main()
