// Abliteration Lens. Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
//
// The Help, About and Settings boxes, laid out as bench-kit's are (kit/guides.js, kit/about.js,
// kit/settings.js): Help as a box of sections with a contents line, About as a table ending
// in the citation, Settings in tabs with Cancel and Save. Settings are kept in this browser.
"use strict";

const Boxes = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const st = { get(k, d) { try { const v = localStorage.getItem("db." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("db." + k, JSON.stringify(v)); } catch (e) { /* private window */ } } };
  const REPO = "https://github.com/vector-lab-tools/abliteration-lens";

  function box(cls, html) {
    $(`dialog.${cls.split(" ")[0]}`)?.remove();
    const d = document.createElement("dialog");
    d.className = cls;
    d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener("close", () => d.remove());
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-x]")) d.close("cancel"); });
    d.showModal();
    return d;
  }

  // ---------------------------------------------------------------- Help
  // A contents list down the left, grouped, with a filter; one topic at a time on the right, with
  // Previous and Next at its foot. Under 700px wide the list becomes a menu above the topic.
  // Arrow keys (or j and k) on the list move between topics; the last topic is remembered.
  const LINKS = { site: "https://vector-lab-tools.github.io/abliteration-lens/", vau: "https://vector-lab-tools.github.io/vector-abliteration-units/" };
  const plain = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  function helpTopicHTML(H, i) {
    const x = H[i], prev = H[i - 1], next = H[i + 1];
    const more = [x.site ? `<a href="${esc(x.site)}" target="_blank" rel="noopener">More on the site ↗</a>` : "",
      x.vau ? `<a href="${esc(x.vau)}" target="_blank" rel="noopener">More on the VAU site ↗</a>` : ""].filter(Boolean).join("");
    return `<header><span class="hb-grp">${esc(x.g)}</span><h3 id="hb-h">${esc(x.t)}${x.meter ? ' <span class="meterbadge" title="A meter: it reads the model and leaves it unchanged">meter</span>' : ""}</h3>${x.s ? `<p class="hb-sum">${esc(x.s)}</p>` : ""}</header>
      <div class="hb-body">${x.b}</div>
      ${more ? `<p class="hb-more">${more}</p>` : ""}
      <footer class="hb-foot">${prev ? `<button type="button" class="b small" data-go="${i - 1}"><span aria-hidden="true">←</span> ${esc(prev.t)}</button>` : "<span></span>"}
        ${next ? `<button type="button" class="b small" data-go="${i + 1}">${esc(next.t)} <span aria-hidden="true">→</span></button>` : ""}</footer>`;
  }
  function helpHTML(H) {
    const groups = [];
    H.forEach((x, i) => { let g = groups.find((y) => y.g === x.g); if (!g) groups.push(g = { g: x.g, items: [] }); g.items.push(i); });
    return `<div class="boxhead hb-head"><b>Help</b>
        <span class="hb-links"><a href="${LINKS.site}" target="_blank" rel="noopener">Abliteration Lens site ↗</a><a href="${LINKS.vau}" target="_blank" rel="noopener">Vector Abliteration Units ↗</a></span>
        <button class="icon-btn" data-x title="Close (Esc)" aria-label="Close">✕</button></div>
      <div class="hb">
        <nav class="hb-side" aria-label="Help topics">
          <input type="search" class="hb-filter" placeholder="Filter topics" aria-label="Filter the topics" autocomplete="off" spellcheck="false">
          <select class="hb-select" aria-label="Topic">${groups.map((g) => `<optgroup label="${esc(g.g)}">${g.items.map((i) => `<option value="${i}">${esc(H[i].t)}</option>`).join("")}</optgroup>`).join("")}</select>
          <div class="hb-list" role="listbox" aria-label="Topics" tabindex="0">${groups.map((g, gi) => `<div class="hb-g" role="group" aria-labelledby="hb-g${gi}"><div class="hb-gt" id="hb-g${gi}">${esc(g.g)}</div>
            ${g.items.map((i) => `<div class="hb-item" role="option" id="hb-o${i}" data-i="${i}" aria-selected="false">${esc(H[i].t)}</div>`).join("")}</div>`).join("")}
            <p class="hb-none" hidden>No topic matches.</p></div>
        </nav>
        <article class="hb-topic" aria-labelledby="hb-h" tabindex="-1"></article>
      </div>`;
  }
  function help(section) {
    const H = window.HELP || [];
    if (!H.length) return;
    const d = box("helpbox", helpHTML(H));
    d.setAttribute("aria-label", "Help");
    const list = $(".hb-list", d), topic = $(".hb-topic", d), filter = $(".hb-filter", d), sel = $(".hb-select", d);
    const texts = H.map((x) => (x.t + " " + x.g + " " + (x.s || "") + " " + plain(x.b)).toLowerCase());
    let cur = 0;
    const visible = () => [...list.querySelectorAll(".hb-item:not([hidden])")].map((o) => +o.dataset.i);
    d.addEventListener("close", () => dropUnitFigs(d));
    function show(i, focusTopic) {
      cur = Math.max(0, Math.min(H.length - 1, i));
      dropUnitFigs(topic);
      topic.innerHTML = helpTopicHTML(H, cur);
      wireUnits(topic);
      wireStrips(topic, H[cur]);
      topic.scrollTop = 0;
      list.querySelectorAll(".hb-item").forEach((o) => { const on = +o.dataset.i === cur; o.classList.toggle("on", on); o.setAttribute("aria-selected", String(on)); });
      list.setAttribute("aria-activedescendant", "hb-o" + cur);
      list.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: "nearest" });
      sel.value = String(cur);
      st.set("help.topic", H[cur].t);
      if (focusTopic) topic.focus({ preventScroll: true });
    }
    filter.addEventListener("input", () => {
      const q = filter.value.trim().toLowerCase();
      list.querySelectorAll(".hb-item").forEach((o) => { o.hidden = !!q && !texts[+o.dataset.i].includes(q); });
      list.querySelectorAll(".hb-g").forEach((g) => { g.hidden = !g.querySelector(".hb-item:not([hidden])"); });
      $(".hb-none", d).hidden = visible().length > 0;
    });
    filter.addEventListener("keydown", (e) => {
      const v = visible();
      if (e.key === "Enter" && v.length) {         // a topic whose title matches, before one that only mentions it
        e.preventDefault();
        const q = filter.value.trim().toLowerCase();
        show(v.find((j) => H[j].t.toLowerCase().includes(q)) ?? v[0]); list.focus();
      }
      else if (e.key === "ArrowDown" && v.length) { e.preventDefault(); show(v.includes(cur) ? cur : v[0]); list.focus(); }
    });
    list.addEventListener("click", (e) => { const o = e.target.closest(".hb-item"); if (o) { show(+o.dataset.i); list.focus(); } });
    list.addEventListener("keydown", (e) => {
      const v = visible(); if (!v.length) return;
      const k = v.indexOf(cur);
      const to = { ArrowDown: k + 1, j: k + 1, ArrowUp: k - 1, k: k - 1, Home: 0, End: v.length - 1 }[e.key];
      if (to !== undefined) { e.preventDefault(); show(v[Math.max(0, Math.min(v.length - 1, k < 0 ? 0 : to))]); }
      else if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); topic.focus(); }
      else if (e.key === "/") { e.preventDefault(); filter.focus(); }
    });
    sel.addEventListener("change", () => show(+sel.value));
    topic.addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) show(+b.dataset.go, true); });
    // the topic asked for (a caller naming one), else the last one read here, else the first
    const find = (name) => H.findIndex((x) => x.t.toLowerCase() === String(name).toLowerCase());
    let i = section != null ? find(section) : -1;
    if (i < 0) i = find(st.get("help.topic", ""));
    show(i < 0 ? 0 : i);
    (matchMedia("(max-width: 700px)").matches ? sel : list).focus();
    return d;
  }

  // ---------------------------------------------------------------- About
  const today = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  function citation(version) {
    return `Berry, D. M. (2026) Abliteration Lens (version ${version}). Available at: ${REPO} (Accessed: ${today()}).`;
  }
  async function about() {
    let s = {};
    try { s = await (await fetch("/api/status")).json(); } catch (e) { /* the server is not answering */ }
    const v = s.version || "", m = s.model;
    const row = (k, h) => (h ? `<tr><td>${esc(k)}</td><td>${h}</td></tr>` : "");
    const cite = citation(v);
    const d = box("aboutbox", `<form method="dialog" class="settings about-box">
      <div class="about-head"><img src="mark.svg" alt="" width="44" height="44"><div><h2>Abliteration Lens</h2><div class="hint">Version ${esc(v)}</div></div></div>
      <table class="about-meta">
        ${row("Project", "A Vector Lab tool, and the first host of Vector Abliteration Units (VAU). David M. Berry, University of Sussex.")}
        ${row("Version", esc(v))}
        ${row("Purpose", "Bends an open-weight language model while it writes (ablating, scaling, steering, projecting out a direction, adding noise, coarsening, reordering, transplanting) and sets the diverged text beside the text the unaltered model writes from the same prompt with the same seed, with a control band of reseeds and a recipe that runs it again.")}
        ${row("Tech stack", "Python (FastAPI, PyTorch, Hugging Face Transformers) on this machine, and a plain HTML and JavaScript page with no build step. No accounts, no telemetry, no remote inference. Your settings are kept in this browser; runs, maps, sweeps and directions in the tool's folder.")}
        ${row("Model", m ? `${esc(m.model_id)} @ ${esc(m.revision)}, revision ${esc(String(m.revision_hash || "").slice(0, 12))}, ${esc(m.dtype)} on ${esc(m.device)}` : "None loaded")}
        ${row("Built from", "Vectorscope (model loading, direction extraction, fake quantisation), LLMbench (the Grammar Probe, the stance word lists, the annotation types, the probability scale), Video Kintsugi (the desk and the local server's guards), bench-kit (witnesses, numbered lines and descent; the layout of these boxes), Ablation Bench (the direction file format and layer numbering).")}
        ${row("Code", `<a href="${REPO}" target="_blank" rel="noopener">${REPO.replace(/^https:\/\//, "")} ↗</a>`)}
        ${row("Licence", "GPL-3.0-or-later")}
        ${row("DOI", `<span class="hint">None yet. Zenodo gives a DOI when a GitHub release of the repository is archived.</span>`)}
        <tr><td>Cite as</td><td class="about-cite">${esc(cite)}</td></tr>
      </table>
      <div class="row"><button type="button" class="b" data-cite>Copy citation</button><button value="close" class="b primary">Close</button></div>
      <a class="about-kitmark" href="https://github.com/vector-lab-tools" target="_blank" rel="noopener">A Vector Lab tool</a></form>`);
    d.querySelector("[data-cite]").addEventListener("click", (e) => {
      navigator.clipboard?.writeText(cite).then(() => { e.target.textContent = "Copied"; }, () => { e.target.textContent = "Could not copy"; });
    });
  }

  // ---------------------------------------------------------------- Settings
  const DEFAULTS = { initials: "", name: "", theme: "system", textSize: 15, mono: "system", unit: "ppl", bandN: 8, tokens: 60 };
  const FONTS = [["system", "System monospace", 'ui-monospace, "SF Mono", Menlo, monospace'],
    ["JetBrains Mono", "JetBrains Mono"], ["IBM Plex Mono", "IBM Plex Mono"], ["Source Code Pro", "Source Code Pro"],
    ["Fira Code", "Fira Code"], ["Courier New", "Courier New"]];
  const get = (k) => st.get(k, DEFAULTS[k]);

  // the look: applied at start and previewed while the box is open
  function applyLook(o = {}) {
    const r = document.documentElement.style;
    const size = o.textSize ?? get("textSize"), mono = o.mono ?? get("mono");
    r.setProperty("--read-size", size + "px");
    const f = FONTS.find((x) => x[0] === mono);
    r.setProperty("--mono", f && f[2] ? f[2] : `"${mono}", ui-monospace, Menlo, monospace`);
  }

  function settings(tab) {
    const TABS = [["you", "You"], ["display", "Display"], ["runs", "Runs"], ["models", "Models"]];
    tab = TABS.some((t) => t[0] === tab) ? tab : st.get("set.tab", "you");
    const was = { theme: get("theme"), textSize: get("textSize"), mono: get("mono") };
    const d = box("set-dlg", `<form method="dialog" class="settings">
      <div class="set-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-st="${k}">${l}</button>`).join("")}</div>
      <section class="set-pane" data-sp="you">
        <p class="hint">Your initials and a date are put on every annotation you make on a run, so a run read by several people keeps who said what. They are kept in this browser.</p>
        <label>Initials <input id="set-initials" maxlength="4" placeholder="e.g. AB" autocomplete="off" spellcheck="false"></label>
        <label>Name <input id="set-name" placeholder="optional" autocomplete="off"></label>
        <p class="hint set-msg" id="set-inimsg"></p>
      </section>
      <section class="set-pane" data-sp="display">
        <h2>Colour theme</h2><p class="hint">The ◐ button in the top bar moves between the system's setting, light and dark.</p>
        <label>Theme <select id="set-theme"><option value="system">The system's setting</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <h2>Reading</h2><p class="hint">The size of the original and diverged texts on the Bench, the Probabilities view and the Variorum, and the font for code, chain lines and token tables.</p>
        <label>Text size <span class="token-row"><input id="set-size" type="range" min="11" max="24" step="1"><span id="set-size-out" class="mono" style="min-width:3.5em"></span></span></label>
        <label>Code font <select id="set-mono">${FONTS.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("")}</select></label>
        <p class="hint">A font that is not installed on this machine falls back to the system's monospace; nothing is downloaded.</p>
      </section>
      <section class="set-pane" data-sp="runs">
        <h2>Starting values</h2><p class="hint">What a new page starts with. Each can still be changed where it is used, and every run records the values it used in its recipe.</p>
        <label>Probabilities in <select id="set-unit"><option value="ppl">Perplexity</option><option value="bits">Bits (mean surprisal)</option></select></label>
        <label>Reseeds for the control band <input id="set-bandn" type="number" min="2" max="64"></label>
        <label>Tokens to generate <input id="set-tokens" type="number" min="1" max="1000"></label>
      </section>
      <section class="set-pane set-models" data-sp="models">
        <p class="hint">The models the bench can play: the presets, and any other supported model already in the Hugging Face cache. Choose one to see what it is and what runs on it, and load it from there. All of this is read from this machine.</p>
        <div class="mpane"><div class="ml" role="listbox" aria-label="Models"></div><div class="mdive"></div></div>
      </section>
      <div class="row set-foot"><span class="set-gap"></span><button value="cancel" class="b">Cancel</button><button value="save" id="set-save" class="b primary">Save</button></div></form>`);
    const show = (t) => {
      d.querySelectorAll("[data-st]").forEach((b) => { const on = b.dataset.st === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
      d.querySelectorAll(".set-pane").forEach((p) => { p.hidden = p.dataset.sp !== t; });
      d.classList.toggle("wide", t === "models");
      st.set("set.tab", t);
      if (t === "models" && !models) models = modelsPane(d.querySelector(".set-models"));
    };
    let models = null;
    // Enter in the deep dive's revision box loads; it does not save the settings
    d.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-rev]")) { e.preventDefault(); e.target.closest(".mi").querySelector("[data-load]")?.click(); } });
    d.querySelector(".set-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-st]"); if (b) show(b.dataset.st); });
    show(tab);
    const ini = $("#set-initials", d), size = $("#set-size", d), out = $("#set-size-out", d), theme = $("#set-theme", d), mono = $("#set-mono", d);
    ini.value = get("initials"); $("#set-name", d).value = get("name");
    theme.value = was.theme; size.value = was.textSize; out.textContent = was.textSize + " px"; mono.value = was.mono;
    $("#set-unit", d).value = get("unit"); $("#set-bandn", d).value = get("bandN"); $("#set-tokens", d).value = get("tokens");
    ini.addEventListener("input", () => { const p = ini.selectionStart; ini.value = ini.value.toUpperCase().replace(/[^A-Z]/g, ""); ini.setSelectionRange(p, p); });
    // previewed as they change, put back on Cancel
    theme.onchange = () => { st.set("theme", theme.value); window.applyTheme?.(); };
    size.oninput = () => { out.textContent = size.value + " px"; applyLook({ textSize: +size.value }); };
    mono.onchange = () => applyLook({ mono: mono.value });
    $("form", d).addEventListener("submit", (e) => {
      if (e.submitter?.value !== "save") return;
      const v = ini.value.trim();
      if (v && !/^[A-Z]{2,4}$/.test(v)) { e.preventDefault(); show("you"); $("#set-inimsg", d).textContent = "Initials: two to four letters, please."; ini.focus(); }
    });
    d.addEventListener("close", () => {
      if (d.returnValue !== "save") { st.set("theme", was.theme); window.applyTheme?.(); applyLook(); return; }
      st.set("initials", ini.value.trim()); st.set("name", $("#set-name", d).value.trim());
      st.set("theme", theme.value); st.set("textSize", +size.value); st.set("mono", mono.value);
      const unit = $("#set-unit", d).value, bandN = Math.max(2, +$("#set-bandn", d).value || 8), tokens = Math.max(1, +$("#set-tokens", d).value || 60);
      const changed = { unit: unit !== get("unit"), bandN: bandN !== get("bandN"), tokens: tokens !== get("tokens") };
      st.set("unit", unit); st.set("bandN", bandN); st.set("tokens", tokens);
      applyLook(); window.applyTheme?.();
      window.applySettings?.(changed);
    }, { once: true });
  }

  // ---------------------------------------------------------------- a unit's help (the (?) on its strip)
  // What the unit does and its parameters, from its manifest, and, if the unit has an explainer
  // (VAU 1, section 5c), its animated figure with the example texts, drawn by the runtime the
  // installed vau package ships (served from /vau/explain/, loaded the first time it is needed).
  const EXPLAIN = "/vau/explain/", STRIPS = "/explain/";
  const loading = {};
  function load(src, css) {
    if (!loading[src]) loading[src] = new Promise((ok, no) => {
      const el = css ? Object.assign(document.createElement("link"), { rel: "stylesheet", href: src }) : Object.assign(document.createElement("script"), { src });
      el.onload = ok;
      el.onerror = () => { delete loading[src]; no(new Error(src)); };
      document.head.appendChild(el);
    });
    return loading[src];
  }
  const num = (v) => (typeof v === "number" ? String(+v.toFixed(4)).replace("-", "−") : esc(v));
  function paramRange(p) {
    if (p.kind === "choice") return p.choices.map(esc).join(", ");
    if (p.kind === "direction") return "a direction";
    if (p.kind === "toggle") return "on or off";
    if (p.kind === "text") return p.hint ? esc(p.hint) : "text";
    return p.min !== undefined ? `${num(p.min)} to ${num(p.max)}` : "";
  }
  function unitHelpHTML(m) {
    return `<div class="boxhead"><b>${esc(m.title)}</b>${m.category === "meter" ? '<span class="meterbadge" title="A meter: it reads the model and leaves it unchanged">meter</span>' : ""}<span class="uh-id">${esc(m.id)}${m.source === "lens" ? " · built into the Lens" : m.source && m.source !== "builtin" ? " · from data/units" : " · VAU"}</span><button class="icon-btn" data-x title="Close (Esc)" aria-label="Close">✕</button></div>
      ${unitHelpBody(m)}`;
  }
  // the help itself, without its head: the (?) box and the Help box's unit topics both draw this
  function unitHelpBody(m) {
    const rows = (m.params || []).map((p) => `<tr><td><b>${esc(p.label)}</b> <code>${esc(p.key)}</code></td><td>${paramRange(p)}${p.default !== undefined ? `<br><span class="uh-dim">default ${num(p.default)}${p.neutral !== undefined ? `, neutral ${num(p.neutral)}` : ""}</span>` : p.required ? `<br><span class="uh-dim">required</span>` : ""}</td><td>${p.tip ? `<code class="uh-tip">${esc(p.tip)}</code>` : ""}</td></tr>`).join("");
    return `<div class="uh">
        <p class="uh-what">${esc(m.what)}.</p>
        ${m.explain ? `<div class="uh-fig"><p class="uh-dim">Drawing the figure…</p></div>` : ""}
        ${m.example ? `<p class="uh-ex">Example line: <code>${esc(m.example)}</code></p>` : ""}
        <h4>Parameters</h4>
        ${rows ? `<table class="t uh-params"><thead><tr><th>Parameter</th><th>Range</th><th>What it does</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="uh-dim">None.</p>`}
        ${m.inspired_by ? `<p class="uh-insp"><b>Inspired by</b> ${esc(m.inspired_by)}.</p>` : ""}
        ${m.help ? `<h4>More</h4><p class="uh-help">${m.help}</p>` : ""}
        <p class="uh-src uh-dim">${m.source === "lens" ? `Built into Abliteration Lens · ${esc(m.file || "")}` : `A VAU unit · ${esc(m.file || "")}${m.version ? `, version ${esc(m.version)}` : ""}${m.author ? `, ${esc(m.author)}` : ""}${m.source === "builtin" ? " · built into vau" : ""}`}</p>
      </div>`;
  }
  // the unit's animated figure, drawn by vau's runtime into the help's .uh-fig; live() says
  // whether the place it goes is still on show. Gives the figure (to destroy) or null.
  // The units' example texts and the built-in strips' (web/explain/examples.json, made from the
  // same prompt, seed and sampler by tools/strip_examples.py), as one set: the runtime keeps one.
  let examples = null;
  const allExamples = () => examples || (examples = Promise.all([EXPLAIN + "examples.json", STRIPS + "examples.json"].map((u) =>
    fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null))).then(([v, s]) => {
    if (!v) return s;
    if (s && s.original && s.original.text === v.original.text) { v.units = { ...v.units, ...s.units }; v.original = { ...s.original, ...v.original }; }
    return v;
  }));
  async function mountExplain(root, m, live) {
    const slot = root.querySelector(".uh-fig");
    if (!m.explain || !slot) return null;
    try {
      await load(EXPLAIN + "explain.css", true);
      await load(EXPLAIN + "explain.js");
      await load((m.source === "lens" ? STRIPS : EXPLAIN) + encodeURIComponent(m.id) + ".explain.js");
      const ex = await allExamples();
      if (live() && window.VAUExplain && VAUExplain.has(m.id)) return VAUExplain.mount(slot, m.id, { title: m.title, examples: ex || false });
      if (live()) slot.remove();
    } catch (e) {
      slot.innerHTML = `<p class="uh-dim">The figure did not load (${esc(e.message)}).</p>`;
    }
    return null;
  }
  // A built-in strip as a unit's manifest, so that its (?) and its Help show the same card as a
  // unit's: what it does and its parameters from the desk (Desk.SPECS), what each parameter does
  // and whether it has a figure from web/explain/strips.json, and its Help topic's text as More.
  let stripNotes = null;
  const stripsReady = () => stripNotes || (stripNotes = fetch(STRIPS + "strips.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  const ONE = { layer: ["Layer", "one layer: 0 to the last"], head: ["Head", "one head: block.head, 5.1"] };   // a meter reads one place
  const TARGET = { head: ["Head", "block.head: 5.1, 5.*, or 5.1,7.3"], attn: ["Attention", "a block: 5, 3-7, or all"], mlp: ["MLP", "a block: 5, 3-7, or all"],
    block: ["Block", "a block: 5, 3-7, or all"], layer: ["Layer", "a layer: 6, 3-7, or all"] };
  function stripManifest(kind, data) {
    const s = (typeof Desk !== "undefined" && Desk.SPECS[kind]) || {}, tips = ((data || {}).tips || {})[kind] || {};
    const H = window.HELP || [], topic = H.find((x) => x.t === (window.HELP_FOR || {})[kind]);
    const params = (s.targets || []).map((t) => { const [label, hint] = (s.probe && ONE[t]) || TARGET[t]; return { key: t, label, kind: "text", hint, tip: tips[t] }; })
      .concat((s.params || []).map((p) => ({ key: p.key, label: p.label, tip: tips[p.key],
        kind: p.choices ? "choice" : p.direction ? "direction" : p.toggle ? "toggle" : p.text ? "text" : "number", choices: p.choices, hint: p.hint,
        min: p.choices || p.text || p.direction || p.toggle ? undefined : p.min, max: p.max,
        default: p.reset === "" || p.reset === undefined || p.direction ? undefined : p.toggle ? (p.reset ? "on" : "off") : p.choices ? p.reset : +p.reset })));
    return { id: kind, title: s.title || kind, what: s.what || "", category: s.probe ? "meter" : s.sampler ? "sampler" : "", params,
      example: (typeof Desk !== "undefined" && Desk.NEW_LINE[kind]) || "", explain: ((data || {}).explain || []).includes(kind),
      help: topic ? topic.b : "", source: "lens", file: s.sampler ? "backend/abliteration/generate.py" : s.probe ? "backend/abliteration/generate.py" : "backend/abliteration/interventions.py" };
  }
  async function stripHelp(kind, opener) { return unitHelp(stripManifest(kind, await stripsReady()), opener); }
  async function unitHelp(m, opener) {
    const d = box("unitbox", unitHelpHTML(m));
    d.setAttribute("aria-label", `${m.title}: help`);
    let fig = null, closed = false;
    d.addEventListener("close", () => { closed = true; if (fig) fig.destroy(); if (opener && opener.isConnected) opener.focus(); });
    d.querySelector("[data-x]").focus();
    fig = await mountExplain(d, m, () => d.open);
    if (closed && fig) fig.destroy();
    return d;
  }
  // In the Help box: a unit's line opens to the same help as its strip's (?), drawn by the same code.
  const unitFigs = new Set();
  function wireUnits(root) {
    root.querySelectorAll("details.hb-unit").forEach((det) => det.addEventListener("toggle", async () => {
      const body = det.querySelector(".hb-unit-body");
      if (!det.open || body.dataset.done) return;
      const m = ((window.VAU || {}).units || []).find((u) => u.id === det.dataset.unit);
      if (!m) { body.innerHTML = `<p class="uh-dim">This unit is not loaded.</p>`; return; }
      body.dataset.done = "1";
      body.innerHTML = unitHelpBody(m) + `<p class="hb-more"><a href="${LINKS.vau}units.html#${encodeURIComponent(m.id)}" target="_blank" rel="noopener">More on the VAU site ↗</a></p>`;
      const fig = await mountExplain(body, m, () => det.isConnected && det.open);
      if (fig) unitFigs.add(fig);
    }));
  }
  // a built-in strip's topic: its card (each strip's, for a topic of two or four), then the topic's
  // own text, as a unit's card ends in More
  async function wireStrips(root, x) {
    const kinds = Object.entries(window.HELP_FOR || {}).filter(([, t]) => t === x.t).map(([k]) => k);
    const body = root.querySelector(".hb-body");
    if (!kinds.length || !body) return;
    const data = await stripsReady();
    if (!body.isConnected) return;
    const cards = kinds.map((k) => { const m = stripManifest(k, data); return { m, html: unitHelpBody({ ...m, help: "" }) }; });
    body.insertAdjacentHTML("afterbegin", cards.map((c) => `<section class="hb-strip" data-kind="${esc(c.m.id)}">${kinds.length > 1 ? `<h4 class="hb-strip-t">${esc(c.m.title)}${c.m.category === "meter" ? ' <span class="meterbadge" title="A meter: it reads the model and leaves it unchanged">meter</span>' : ""}</h4>` : ""}${c.html}</section>`).join("") + `<h4 class="hb-strip-more">More</h4>`);
    for (const c of cards) {
      const fig = await mountExplain(body.querySelector(`.hb-strip[data-kind="${c.m.id}"]`), c.m, () => body.isConnected);
      if (fig) unitFigs.add(fig);
    }
  }
  // the figures drawn in root (a Help box, or the topic about to be replaced), and any no longer on show
  const dropUnitFigs = (root) => unitFigs.forEach((f) => {
    if (root && f.figure.isConnected && !root.contains(f.figure)) return;
    try { f.destroy(); } catch (e) { /* gone */ }
    unitFigs.delete(f);
  });

  // ---------------------------------------------------------------- a model: the deep dive
  // One component in two places: Settings, Models (beside the list of models), and the (i) on the
  // Instrument (for the loaded model). The server reads it all from this machine (the presets in
  // backend/config/models.md, the model's files in the Hugging Face cache, the loaded model);
  // only "Fetch details from Hugging Face", on a click, asks huggingface.co.
  const n0 = (n) => (n === null || n === undefined ? "" : Number(n).toLocaleString("en-GB"));
  const bigN = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + " billion" : (n / 1e6).toFixed(1) + " million");
  const bytes = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : Math.round(b / 1e6) + " MB");
  const ext = (u, t) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t || u.replace(/^https:\/\//, ""))} ↗</a>`;
  const withLinks = (s) => esc(s).replace(/https:\/\/[^\s)]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https:\/\//, "")} ↗</a>`);
  const modelPath = (id) => "/api/models/" + String(id).split("/").map(encodeURIComponent).join("/") + "/info";

  function archRows(a, row) {
    const heads = a.heads ? (a.kv_heads ? `${a.heads} query heads sharing ${a.kv_heads} key and value heads (grouped-query attention)` : String(a.heads)) : "";
    const tok = a._tok || {};
    return [
      row("Family", a.family_name ? `${esc(a.family_name)} <code>${esc(a.model_type || "")}</code>` : a.model_type ? `<code>${esc(a.model_type)}</code>, which the bench does not support` : ""),
      row("Class", (a.architectures || []).map((x) => `<code>${esc(x)}</code>`).join(", ")),
      row("Layers (blocks)", n0(a.layers)),
      row("Attention heads", esc(heads)),
      row("Head size", n0(a.head_dim)),
      row("Width (the stream)", n0(a.d_model)),
      row("MLP width", n0(a.d_mlp)),
      row("Vocabulary", a.vocab ? n0(a.vocab) + " tokens" : ""),
      row("Context", a.context ? `${n0(a.context)} positions <span class="mi-dim">(config.json)</span>` + (a._ctx ? `; the card gives ${esc(a._ctx)}` : "") : ""),
      row("Positions", esc(a.positions_note || a.positions || "")),
      row("Norm", esc(a.norm || "")),
      row("Activation", a.activation ? `<code>${esc(a.activation)}</code>` : ""),
      row("Embeddings", a.tied === true ? "tied: the output layer reuses the input embeddings" : a.tied === false ? "separate input and output embeddings" : ""),
      row("Attention and MLP", a.parallel ? "side by side in each block (parallel residual)" : ""),
      row("Sliding window", a.sliding_window ? n0(a.sliding_window) + " tokens" : ""),
      row("Tokenizer", [tok.class ? `<code>${esc(tok.class)}</code>` : "", tok.type ? esc(tok.type) + (tok.byte_level ? " on bytes (byte-level)" : "") : ""].filter(Boolean).join(", ")),
    ].join("");
  }

  function modelInfoHTML(i, o = {}) {
    const p = i.preset || {}, z = i.size || {}, mc = i.machine || {}, L = i.loaded, f = o.fetched;
    const a = Object.assign({}, i.architecture || (f && f.architecture) || {}, { _tok: i.tokenizer, _ctx: p.context_stated });
    const sup = (i.architecture ? i.support : f && f.support) || i.support || {};
    const row = (k, v) => (v === undefined || v === null || v === "" ? "" : `<tr><td>${esc(k)}</td><td>${v}</td></tr>`);
    const tbl = (rows) => (rows ? `<table class="mi-t">${rows}</table>` : "");
    const card = p.card || (i.org_id ? `https://huggingface.co/${i.id}` : "");
    const sha = (L && L.revision_hash) || (i.snapshot && i.snapshot.sha) || "";
    const revs = (i.checkpoints || []).map((c) => c.revision);
    const badge = (cls, t) => `<span class="mi-badge ${cls}">${esc(t)}</span>`;
    const badges = [L ? badge("on", "Loaded") : "", i.cached ? badge("", "On this machine") : badge("off", "Not downloaded"),
      p.gated ? badge("off", "Gated") : "", i.preset ? "" : badge("", "Not a preset")].join("");

    // identity
    const paperM = p.paper ? p.paper.match(/^(.*?)\s*(https:\/\/\S+)$/) : null;
    const ident = tbl([
      row("Name", esc(i.name)),
      row("Hugging Face id", `<code>${esc(i.id)}</code>`),
      row("Revision", esc(L ? L.revision : i.revision)),
      row("Commit", sha ? `<code title="${esc(sha)}">${esc(String(sha).slice(0, 12))}</code>` + (i.snapshot && !i.snapshot.ref && !L ? ` <span class="mi-dim">(no branch in the cache names it)</span>` : "") : ""),
      row("Organisation", esc(p.org || (i.org_id ? `${i.org_id} (its account on Hugging Face)` : ""))),
      row("Host", esc(i.host || "")),
      row("Released", esc(p.released || "")),
      row("Kind", esc(p.kind || "")),
      row("Licence", p.licence ? esc(p.licence) + (p.gated ? ". Gated: Hugging Face gives the weights to an account that has asked for access and been granted it." : "") : ""),
      row("Model card", card ? ext(card) : ""),
      row("Paper", paperM ? `${esc(paperM[1])} ${ext(paperM[2], "")}` : esc(p.paper || "")),
    ].join(""));

    // architecture
    let arch = archRows(a, row);
    const archNote = i.architecture ? "" : f && f.architecture ? `<p class="mi-dim">From huggingface.co's copy of config.json, fetched just now and not saved.</p>`
      : `<p class="mi-dim">Not on this machine: the architecture is read from the model's config.json once it is downloaded.${p.layers ? ` The preset gives ${n0(p.layers)} layers and ${n0(p.heads)} heads.` : ""}</p>`;
    if (!i.architecture && !(f && f.architecture)) arch = "";

    // size
    const ram = mc.device === "cuda" && mc.device_free ? mc.device_free : mc.ram_available;
    const total = mc.device === "cuda" && mc.device_total ? mc.device_total : mc.ram_total;
    const share = z.memory && ram ? Math.min(1, z.memory / ram) : null;
    const where = mc.device === "mps" ? `Apple silicon (mps), which shares the machine's memory` + (mc.mps_limit ? `; Metal's recommended limit is ${bytes(mc.mps_limit)}` : "")
      : mc.device === "cuda" ? `CUDA${mc.device_name ? ` (${esc(mc.device_name)})` : ""}` : "the CPU";
    const size = tbl([
      row("Parameters", z.params ? `${n0(z.params)} <span class="mi-dim">(${bigN(z.params)}, counted from ${esc(z.params_from)})</span>` : ""),
      row("The card gives", esc(p.params_stated || "")),
      row("On disk", z.disk ? `${bytes(z.disk)} in ${z.files.length} file${z.files.length === 1 ? "" : "s"}` + (z.complete === false ? ", some missing" : "") : ""),
      row("Stored as", esc(z.native_dtype || "")),
      row("Loads as", z.load_dtype ? `${esc(z.load_dtype)} <span class="mi-dim">(float32 unless the weights are bfloat16 on disk, so that a run regenerates exactly)</span>` : ""),
      row("Memory for the weights", z.memory ? bytes(z.memory) : ""),
      row("This machine", mc.device ? `${where}. ${bytes(ram)} free of ${bytes(total)}.` : ""),
    ].join(""));
    const meter = share !== null ? `<div class="mi-meter" role="img" aria-label="The weights take ${Math.round(share * 100)}% of the memory free now"><i style="width:${(share * 100).toFixed(1)}%"></i></div>
      <p class="mi-dim">The weights against the memory free now. A run needs some more besides, for the activations and the cache of keys and values.</p>` : "";
    const sizeNote = z.params ? "" : `<p class="mi-dim">The size is counted from the weights once they are on this machine.</p>`;

    // training
    const train = tbl([
      row("Data", esc(p.training || "")),
      row("Tokens", esc(p.tokens || "")),
      row("Cut-off", esc(p.cutoff || "")),
      row("Checkpoints", p.checkpoint_note ? esc(p.checkpoint_note) : ""),
      row("On this machine", revs.length && (p.checkpoints || revs.length > 1) ? revs.map((r) => `<code>${esc(r)}</code>`).join(" ") : ""),
    ].join(""));
    const trainNote = i.preset ? "" : `<p class="mi-dim">Not one of the presets: only what the model's own files say is shown here.${card ? " Its card on Hugging Face has the rest." : ""}</p>`;

    // what runs on it
    let works = "";
    if (sup.strips) {
      const off = sup.strips.filter((s) => !s.ok), uoff = (sup.units || []).filter((s) => !s.ok);
      works = `<p>${sup.strips.length - off.length} of the bench's ${sup.strips.length} strips run on it${sup.units && sup.units.length ? `, and ${sup.units.length - uoff.length} of ${sup.units.length} units` : ""}.</p>`
        + (off.length || uoff.length ? `<ul class="mi-off">${off.concat(uoff).map((s) => `<li><b>${esc(s.title)}</b> does not: ${esc(s.why || "")}.</li>`).join("")}</ul>` : "")
        + (sup.notes && sup.notes.length ? `<ul>${sup.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "")
        + (sup.paths && sup.paths.block ? `<details class="mi-paths"><summary>Where the hooks go</summary><table class="mi-t">${["blocks", "block", "attn", "head_proj", "mlp", "mlp_proj", "embed"].map((k) => row(k, `<code>${esc(sup.paths[k])}</code>`)).join("")}</table></details>` : "");
    } else works = `<p class="mi-dim">Which strips run depends on the architecture, read from config.json once the model is downloaded.</p>`;

    // fetched from huggingface.co
    let fetched = "";
    if (f && f.page) {
      const g = f.page;
      fetched = `<h4>From huggingface.co, fetched just now</h4>` + tbl([
        row("Account", esc(g.author || "")), row("Repository made", esc((g.created || "").slice(0, 10))), row("Last changed", esc((g.modified || "").slice(0, 10))),
        row("Commit of main", g.sha ? `<code>${esc(g.sha.slice(0, 12))}</code>` : ""), row("Licence (card)", esc(g.licence || "")),
        row("Gated", g.gated ? "yes" : "no"), row("Stored tensors", g.stored_tensors ? `${n0(g.stored_tensors)} <span class="mi-dim">(Hugging Face's count, which includes buffers such as attention masks)</span>` : ""),
      ].join("")) + (f.config_error ? `<p class="mi-dim">${esc(f.config_error)}.</p>` : "");
    }

    // load
    const canFetch = !i.cached && !L && i.org_id && !f;
    const revBox = p.checkpoints || revs.length > 1
      ? `<label class="mi-rev">Revision <input data-rev list="mi-revs" placeholder="main" value="${esc(L && L.revision !== "main" ? L.revision : "")}" spellcheck="false" autocomplete="off"><datalist id="mi-revs">${revs.map((r) => `<option value="${esc(r)}">`).join("")}</datalist></label>` : "";
    const loadNote = i.cached ? "" : `Not on this machine: Load downloads it from Hugging Face${p.gated ? ", which needs an account with access" : ""}${p.note && /About [^.]*download/.test(p.note) ? ` (${esc(p.note.replace(/^.*?About ([^.]*)\..*$/, "about $1"))})` : ""}.`;
    const load = `<div class="mi-load">${revBox}<button type="button" class="b primary small" data-load>${L ? "Load again" : "Load"}</button>
      <span class="mi-status" role="status">${L ? `Loaded now, ${esc(L.dtype)} on ${esc(L.device)}.` : ""} ${loadNote}</span></div>`
      + (canFetch ? `<div class="mi-fetch"><button type="button" class="b small" data-fetch>Fetch details from Hugging Face</button>
      <span class="mi-dim">This asks huggingface.co for the model's page and its config.json. Nothing is saved, and nothing else in this panel leaves the machine.</span></div>` : "");

    const sources = p.sources && p.sources.length ? `<p class="mi-src mi-dim">Organisation, release, licence, kind and training are written by hand in <code>backend/config/models.md</code>, checked against ${p.sources.map(withLinks).join("; ")}. The rest is read from ${i.architecture ? `the model's files on this machine${L ? " and from the loaded model" : ""}` : f ? "huggingface.co, fetched just now" : "the model's files once it is on this machine"}.</p>`
      : `<p class="mi-src mi-dim">Read from the model's files on this machine${L ? " and from the loaded model" : ""}.</p>`;

    return `<div class="mi">
      <div class="mi-head"><b>${esc(i.name)}</b>${badges}</div>
      ${load}
      <h4>Identity</h4>${ident}
      <h4>Architecture</h4>${archNote}${tbl(arch)}
      <h4>Size</h4>${sizeNote}${size}${meter}
      <h4>Training</h4>${trainNote}${train || (i.preset ? `<p class="mi-dim">Not given.</p>` : "")}
      <h4>What runs on it</h4>${works}
      ${fetched}
      ${sources}
    </div>`;
  }

  async function getJSON(url, body) {
    const opt = body === undefined ? {} : { method: "POST", headers: { "X-Abliteration": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) };
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  // the deep dive drawn into slot; onLoaded runs after a Load from it
  async function modelPanel(slot, id, onLoaded) {
    slot.innerHTML = `<p class="mi-dim">Reading ${esc(id)}…</p>`;
    let i, fetched = null;
    try { i = await getJSON(modelPath(id)); } catch (e) { slot.innerHTML = `<p class="mi-dim">${esc(e.message)}</p>`; return; }
    const draw = () => { slot.innerHTML = modelInfoHTML(i, { fetched }); };
    draw();
    slot.onclick = async (e) => {
      const st = slot.querySelector(".mi-status");
      if (e.target.closest("[data-load]")) {
        const b = e.target.closest("[data-load]"), rev = slot.querySelector("[data-rev]")?.value.trim() || "";
        b.disabled = true; st.textContent = i.cached ? "Loading…" : "Downloading and loading…";
        try {
          if (!window.loadModel) throw new Error("The page is not ready to load a model.");
          await window.loadModel(id, rev);
          i = await getJSON(modelPath(id)); draw();
          onLoaded?.();
        } catch (err) { b.disabled = false; st.textContent = "Not loaded: " + err.message; }
      } else if (e.target.closest("[data-fetch]")) {
        const b = e.target.closest("[data-fetch]");
        b.disabled = true; b.textContent = "Asking huggingface.co…";
        try { fetched = await getJSON("/api/models/fetch", { model: id }); draw(); }
        catch (err) { b.disabled = false; b.textContent = "Fetch details from Hugging Face"; b.nextElementSibling.textContent = err.message; }
      }
    };
  }

  // the (i) on the Instrument
  function modelInfo(id, opener) {
    const d = box("modelbox", `<div class="boxhead"><b>Instrument</b><span class="uh-id">${esc(id || "")}</span><button class="icon-btn" data-x title="Close (Esc)" aria-label="Close">✕</button></div><div class="mi-wrap"></div>`);
    d.setAttribute("aria-label", "About this model");
    d.addEventListener("close", () => { if (opener && opener.isConnected) opener.focus(); });
    d.querySelector("[data-x]").focus();
    if (!id) { d.querySelector(".mi-wrap").innerHTML = `<p class="mi-dim">Name a model in the Instrument first.</p>`; return d; }
    modelPanel(d.querySelector(".mi-wrap"), id);
    return d;
  }

  // Settings, Models: the presets and the cached models, and the deep dive on the one chosen
  function modelListHTML(L) {
    return (L.models || []).map((m) => `<button type="button" class="ml-item${m.loaded ? " loaded" : ""}" data-mid="${esc(m.id)}" role="option" aria-selected="false">
      <span class="ml-name">${esc(m.name)}</span><span class="ml-id">${esc(m.id)}</span>
      <span class="ml-tags">${m.loaded ? `<i class="on">loaded</i>` : ""}${m.cached ? `<i>downloaded</i>` : `<i class="off">not downloaded</i>`}${m.preset ? "" : `<i>in the cache</i>`}${m.gated ? `<i class="off">gated</i>` : ""}</span></button>`).join("");
  }
  async function modelsPane(pane) {
    const list = pane.querySelector(".ml"), dive = pane.querySelector(".mdive");
    let chosen = null;
    const pick = (id) => {
      chosen = id;
      list.querySelectorAll("[data-mid]").forEach((b) => { const on = b.dataset.mid === id; b.classList.toggle("sel", on); b.setAttribute("aria-selected", String(on)); });
      modelPanel(dive, id, refresh);
    };
    async function refresh() {
      try {
        const L = await getJSON("/api/models");
        list.innerHTML = modelListHTML(L);
        if (!chosen) { const loaded = (L.models || []).find((m) => m.loaded); chosen = (loaded || L.models[0] || {}).id; if (chosen) pick(chosen); }
        else list.querySelectorAll("[data-mid]").forEach((b) => { const on = b.dataset.mid === chosen; b.classList.toggle("sel", on); b.setAttribute("aria-selected", String(on)); });
      } catch (e) { list.innerHTML = `<p class="mi-dim">${esc(e.message)}</p>`; }
    }
    list.onclick = (e) => { const b = e.target.closest("[data-mid]"); if (b) pick(b.dataset.mid); };
    await refresh();
  }

  applyLook();
  return { help, helpHTML, helpTopicHTML, about, settings, get, citation, unitHelp, unitHelpHTML, unitHelpBody, stripHelp, stripManifest, stripsReady, modelInfo, modelInfoHTML, modelListHTML };
})();
