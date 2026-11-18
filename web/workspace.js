// Abliteration Lens. Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
//
// The Bench as a workspace: the info bar at the foot of the window, the
// Instrument's knobs, the timeline (the playhead the desk's meters follow), the Session grid of
// prompts against chains, and the browser. Loaded after app.js, whose helpers it uses.
"use strict";

(() => {
  // The Session (a grid of prompts against chains) is hidden for now: its switch (☰ and ▦ in the
  // top bar) is not shown and the page always opens in the Arrangement. Its code stays; set
  // this to true to bring it back.
  const SESSION = false;

  // ================================================================ the info bar
  // What is under the pointer, described at the foot of the window (in place of tooltips),
  // and on the right what the server is doing.
  const infoText = $("#infotext"), infoStatus = $("#infostatus");
  const IDLE = SESSION ? "Hover over anything to see what it does here. Space runs the pair; ☰ and ▦ in the bar swap the Arrangement and the Session."
    : "Hover over anything to see what it does here. Space runs the pair.";
  infoText.textContent = IDLE;
  let shown = null;
  document.addEventListener("mouseover", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const el = t && t.closest("[title], [data-info]");
    if (el && el.hasAttribute("title")) {
      // the bar explains it now, so the browser's own tooltip is not shown as well
      if (!el.hasAttribute("aria-label") && el.matches("button, input, select, textarea, [role], [tabindex]") && !el.textContent.trim())
        el.setAttribute("aria-label", el.getAttribute("title"));
      el.dataset.info = el.getAttribute("title");
      el.removeAttribute("title");
    }
    const text = el ? el.dataset.info : IDLE;
    if (text !== shown) { shown = text; infoText.textContent = text; }
  });
  document.addEventListener("mouseleave", () => { shown = IDLE; infoText.textContent = IDLE; });

  // ---------------------------------------------------------------- tooltips on the small icon buttons
  // Icons alone do not say what they do: after a short pause on one (or when it takes the keyboard's
  // focus), a label appears beside it with the same words the info bar shows.
  const ICONS = ".strip .qhelp, .docktools button, .docktools label, .transport .tp, .barbtns button, .ipick, .br-fold, .br-rail, .instrument .ib, .cellrun, .sess .sbtns button, .sess .srow > button, [data-tip], [data-mini]";
  const tip = Object.assign(document.createElement("div"), { className: "icotip", hidden: true });
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let tipFor = null, tipTimer = null;
  function tipShow(el) {
    const text = el.dataset.mini || el.dataset.tip || el.dataset.info || el.getAttribute("title") || el.getAttribute("aria-label");
    if (!text) return;
    tip.textContent = text; tip.hidden = false; tipFor = el;
    tip.classList.toggle("math", !el.dataset.mini && !!el.dataset.tip);
    tip.classList.toggle("mini", !!el.dataset.mini);         // a knob, fader or switch: its name and range, small
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let x, y;
    if (r.top < 60) { x = r.left + r.width / 2 - w / 2; y = r.bottom + 8; }                 // the top bar: below
    else if (r.right + 10 + w < innerWidth - 8) { x = r.right + 10; y = r.top + r.height / 2 - h / 2; }   // to the right
    else { x = r.left - 10 - w; y = r.top + r.height / 2 - h / 2; }                          // the right edge: to the left
    Object.assign(tip.style, { left: `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`, top: `${Math.max(8, Math.min(y, innerHeight - h - 32))}px` });
  }
  const tipHide = () => { clearTimeout(tipTimer); tip.hidden = true; tipFor = null; };
  document.addEventListener("mouseover", (e) => {
    const el = e.target instanceof Element ? e.target.closest(ICONS) : null;
    if (el === tipFor) return;
    tipHide();
    if (el) tipTimer = setTimeout(() => tipShow(el), 350);
  });
  document.addEventListener("focusin", (e) => { const el = e.target.closest?.(ICONS); if (el && el.matches(":focus-visible")) tipShow(el); });
  document.addEventListener("focusout", tipHide);
  document.addEventListener("pointerdown", tipHide, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") tipHide(); });

  let t0 = 0, counts = {}, busyText = false;
  const status = (text, busy) => { infoStatus.textContent = text; infoStatus.classList.toggle("busy", !!busy); busyText = !!busy; };
  status("Ready");
  window.onJob = (e) => {
    if (e.type === "begin") { t0 = performance.now(); counts = {}; status("Starting…", true); }
    else if (e.type === "token") { counts[e.run] = (counts[e.run] || 0) + 1; status(`Writing the ${e.run === "bent" ? "diverged" : "original"} text: token ${counts[e.run]}`, true); }
    else if (e.type === "status") status(String(e.text).replace(/[.…]*$/, "…"), true);
    else if (e.type === "result" && e.run && e.run.metrics) {
      const d = e.run.metrics.distance, s = ((performance.now() - t0) / 1000).toFixed(1);
      status(`Done in ${s} s. ` + (d.first_divergence < 0 ? "The two texts are the same." : `They part at token ${d.first_divergence + 1}; word edit distance ${d.edit.toFixed(2)}.`) +
        (e.run.loudness && e.run.loudness.original.integrated !== null ? ` Loudness ${e.run.loudness.original.integrated.toFixed(1)} DUFS.` : ""));
    } else if (e.type === "end") { if (busyText) status(`Done in ${((performance.now() - t0) / 1000).toFixed(1)} s.`); }
    else if (e.type === "error") status("Error: " + e.error);
  };
  $("#stopbtn").addEventListener("click", () => status("Stopped."));
  window.onDeskNote = (text) => { shown = text; infoText.textContent = text; };

  // ================================================================ the dock's toolbar
  $("#dtsave").addEventListener("click", () => saveChain());
  $("#dtundo").addEventListener("click", () => Desk.undo());
  Desk.onUndo((n) => { $("#dtundo").disabled = !n; });
  const note = (t) => window.onDeskNote?.(t);

  // ---------------------------------------------------------------- Pin and compare
  // Pin a run, and later runs can be set against it as well as against the original: the texts,
  // the timeline and the figure then show what changed between the two diverged texts.
  const pinBtn = $("#dtpin");
  const pinPaint = () => {
    pinBtn.setAttribute("aria-pressed", String(!!S.pin));
    pinBtn.dataset.info = S.pin ? `Pinned: run ${S.pin.id}. Click to unpin it, or to pin the run on show in its place.` : "Pin this run: later runs can be set against it as well as against the original.";
  };
  pinBtn.addEventListener("click", () => {
    if (!S.run) { note("Run the pair first, then pin it."); return; }
    if (S.pin && S.pin.id === S.run.id) { S.pin = null; S.cmp = "base"; note("Unpinned."); }
    else {
      const r = S.run;
      S.pin = { id: r.id, label: r.label || "", prompt: r.recipe.prompt, seed: r.recipe.seed, chain: r.recipe.chain.text,
        text: r.bent.text, tokens: r.bent.tokens.map((t) => ({ id: t.id, t: t.t })) };
      S.cmp = "pin";
      note(`Pinned run ${r.id}. Change something and run again: the new diverged text is set against this one. Original and Pinned above the texts swap between them.`);
    }
    store.set("pin", S.pin); store.set("cmp", S.cmp);
    pinPaint(); showRun(); drawTimeline();
  });
  $("#cmpmode").addEventListener("click", (e) => {
    const b = e.target.closest("[data-c]"); if (!b || !S.run) return;
    S.cmp = b.dataset.c; store.set("cmp", S.cmp);
    showRun(); drawTimeline();
  });
  pinPaint();

  // ---------------------------------------------------------------- Sweep
  // The selected strip, on its own, moved across every place its target can take, read teacher-forced
  // on the last run's original text (backend/abliteration/loudness.py): loudness, mean KL, and the
  // share of steps where the most likely next token changes. A click on a cell puts that target on
  // the strip. Nothing is generated or kept.
  let sweepRes = null, sweepMeasure = "loud";
  $("#dtsweep").addEventListener("click", async () => {
    if (!S.model) { alert("Load a model first."); return; }
    if (running) { note("Something is running: wait for it, or stop it, first."); return; }
    const i = Desk.selected;
    if (i === null || i === undefined) { note("Select a strip on the desk (click it), then Sweep."); return; }
    const raw = chainTA.value.split("\n")[i] || "", line = raw.trim().replace(/^#\s*/, "");
    const r = S.run;
    if (!r || !r.baseline || !r.baseline.prompt_ids || r.recipe.model.model_id !== S.model.model_id) { note("Run the pair first: the sweep reads the original text of the last run."); return; }
    running = true; busy(true);
    sweepRes = { line, i, cells: [], rows: 1, cols: 1, target: "", steps: 0 };
    try {
      await stream("/api/strip-sweep", { line, seed: r.recipe.seed, prompt_ids: r.baseline.prompt_ids, cont_ids: r.baseline.tokens.map((t) => t.id) }, (e) => {
        if (e.type === "sweep-start") { Object.assign(sweepRes, { rows: e.rows, cols: e.cols, target: e.target, steps: e.steps }); drawSweep(); }
        else if (e.type === "sweep-cell") { sweepRes.cells.push(e.cell); if (e.done % 12 === 0 || e.done === e.of) drawSweep(); }
        else if (e.type === "strip-sweep") { Object.assign(sweepRes, e.sweep); drawSweep(); }
        else if (e.type === "error") alert(e.error);
      });
    } catch (err) { if (err.name !== "AbortError") alert(err.message); }
    finally { running = false; busy(false); refreshStatus(); }
  });
  function sweepColour(v) {               // quiet: dark green; loud: red. Repair: damped teal, amplified orange
    if (v === null || v === undefined) return "#23262d";
    if (sweepMeasure === "repair") {
      const x = Math.max(-1, Math.min(1, v / 20));
      return x < 0 ? `hsl(185 60% ${Math.round(28 + 34 * -x)}%)` : `hsl(28 80% ${Math.round(28 + 34 * x)}%)`;
    }
    const x = sweepMeasure === "flips" ? v : Math.max(0, Math.min(1, (v + 60) / 60));
    return `hsl(${Math.round(130 - 130 * x)} 70% ${Math.round(22 + 40 * x)}%)`;
  }
  function drawSweep() {
    if (!sweepRes) return;
    let box = $("#sweepbox");
    if (!box) { box = document.createElement("div"); box.id = "sweepbox"; document.body.appendChild(box); }
    const dock = $("#benchdock");                // sit just above the dock
    if (dock) {
      const top = dock.getBoundingClientRect().top;
      box.style.bottom = `${Math.max(12, innerHeight - top + 8)}px`;
      box.style.maxHeight = `${Math.max(160, top - 20)}px`;
    }
    const s = sweepRes, by = Object.fromEntries(s.cells.map((c) => [c.value, c]));
    const val = (c) => (c ? (sweepMeasure === "flips" ? c.flips : sweepMeasure === "repair" ? c.repair_vb : c.integrated) : null);
    const label = (c) => (!c ? "" : sweepMeasure === "flips" ? `${Math.round(c.flips * 100)}`
      : sweepMeasure === "repair" ? (c.repair_vb === null || c.repair_vb === undefined ? "–" : `${c.repair_vb > 0 ? "+" : ""}${Math.round(c.repair_vb)}`)
      : c.integrated === null ? "–" : `${Math.round(c.integrated)}`);
    const cur = (() => { const l = Desk.parse(chainTA.value.split("\n")[s.i] || ""); const a = l.args && l.args.find(([k]) => k === s.target); return a ? String(a[1]) : null; })();
    const cell = (v) => { const c = by[v]; return `<td class="c${cur === v ? " cur" : ""}" data-v="${esc(v)}" style="background:${sweepColour(val(c))}" title="${esc(v)}: ${c ? `${c.integrated === null ? "silent" : c.integrated + " DUFS"}, ${c.mean_bits} bits, top token changed at ${Math.round(c.flips * 100)}% of steps${c.repair_vb === null || c.repair_vb === undefined ? "" : `; direct path ${c.direct} DUFS, repair ${c.repair_vb > 0 ? "+" : ""}${c.repair_vb} vB`}. Click to put it on the strip` : "waiting"}">${label(c)}</td>`; };
    let grid;
    if (s.target === "head") {
      grid = `<table><tr><th></th>${Array.from({ length: s.cols }, (_, h) => `<th>${h}</th>`).join("")}</tr>` +
        Array.from({ length: s.rows }, (_, l) => `<tr><th>${l}</th>${Array.from({ length: s.cols }, (_, h) => cell(`${l}.${h}`)).join("")}</tr>`).join("") + `</table>`;
    } else {
      grid = `<table><tr>${Array.from({ length: s.cols }, (_, k) => `<th>${k}</th>`).join("")}</tr><tr>${Array.from({ length: s.cols }, (_, k) => cell(String(k))).join("")}</tr></table>`;
    }
    const loud = s.cells.filter((c) => c.integrated !== null).sort((a, b) => b.integrated - a.integrated);
    const what = { head: "head (rows: blocks, columns: heads)", attn: "block's attention", mlp: "block's MLP", block: "block", layer: "place in the stream" }[s.target] || s.target;
    box.innerHTML = `<div class="sw-head"><b>Sweep: <code>${esc(s.line)}</code> at every ${esc(what)}</b>
      <span class="seg sw-seg"><button data-m="loud" aria-pressed="${sweepMeasure === "loud"}" title="Loudness: integrated DUFS">DUFS</button><button data-m="flips" aria-pressed="${sweepMeasure === "flips"}" title="The share of steps at which the most likely next token changes, in percent">Changed %</button><button data-m="repair" aria-pressed="${sweepMeasure === "repair"}" title="Self-repair, in vB: the loudness through the rest of the model against the loudness of the change carried straight to the output. Below 0 (teal) the later layers damp it; above 0 (orange) most of its effect runs through them">Repair vB</button></span>
      <button class="icon-btn" data-x title="Close">✕</button></div>
      <p class="sw-note">${s.cells.length} of ${s.rows * s.cols} places, the strip on its own, read on the last run's original text (${s.steps} steps); nothing generated.${loud.length ? ` Loudest: ${esc(loud[0].value)} (${loud[0].integrated} DUFS); quietest: ${esc(loud[loud.length - 1].value)} (${loud[loud.length - 1].integrated}).` : ""} Click a cell to put that target on the strip.</p>${grid}`;
  }
  document.addEventListener("click", (e) => {
    const box = e.target.closest("#sweepbox"); if (!box) return;
    if (e.target.closest("[data-x]")) { box.remove(); sweepRes = null; return; }
    const m = e.target.closest("[data-m]"); if (m) { sweepMeasure = m.dataset.m; drawSweep(); return; }
    const c = e.target.closest("td.c[data-v]");
    if (c && sweepRes) { Desk.applyTarget(sweepRes.i, c.dataset.v); setTimeout(drawSweep, 50); note(`Strip ${sweepRes.i + 1} now at ${c.dataset.v}.`); }
  });

  // ---------------------------------------------------------------- Leave one out
  // The chain is run once with each strip switched off in turn (the meters stay on, as they change
  // nothing), and each strip is marked with how far the diverged text moves without it. These runs
  // are not kept in the Variorum.
  let looStop = false;
  $("#stopbtn").addEventListener("click", () => { looStop = true; });
  $("#dtloo").addEventListener("click", async () => {
    if (!S.model) { alert("Load a model first."); return; }
    if (running) { note("Something is running: wait for it, or stop it, first."); return; }
    const text = chainTA.value, L = text.split("\n");
    const idx = L.map((l, i) => [l.trim(), i]).filter(([l]) => l && !l.startsWith("#"))
      .filter(([l]) => !(Desk.SPECS[l.split(/\s+/)[0]] || {}).probe).map(([, i]) => i);
    if (!idx.length) { note("Leave one out needs at least one strip switched on."); return; }
    const cur = { prompt: $("#prompt").value, seed: +$("#seed").value, sampler: sampler() };
    const rc = S.run && S.run.recipe;
    const same = rc && rc.chain.text === text && rc.prompt === cur.prompt && rc.seed === cur.seed && rc.model.model_id === S.model.model_id &&
      ["temperature", "top_k", "top_p", "max_new_tokens"].every((k) => +rc.sampler[k] === +cur.sampler[k]);
    const n = idx.length + (same ? 0 : 1);
    if (!confirm(`Leave one out runs the chain ${n} time${n > 1 ? "s" : ""}: once without each of its ${idx.length} strip${idx.length > 1 ? "s" : ""}${same ? "" : ", and once whole"}. These runs are not kept in the Variorum. Go?`)) return;
    running = true; busy(true); looStop = false;
    const go = async (chainText) => {
      let res = null;
      await stream("/api/run", { prompt: cur.prompt, chain: chainText, sampler: cur.sampler, seed: cur.seed, save: false, label: "leave one out" },
        (e) => { if (e.type === "result") res = e.run; });
      return res;
    };
    try {
      let full = same ? S.run.bent : null;
      if (!full) { const r = await go(text); if (!r) return; full = r.bent; }
      const by = {};
      for (const i of idx) {
        if (looStop) break;
        const r = await go(L.map((l, j) => (j === i ? "# " + l : l)).join("\n"));
        if (!r) break;
        by[i] = { edit: editDistance(wordsOf(full.text), wordsOf(r.bent.text)), parts: firstDiff(full.tokens, r.bent.tokens) };
        Desk.setLoo({ text, by });
      }
      const got = Object.entries(by).sort((a, b) => b[1].edit - a[1].edit);
      if (got.length) {
        const name = (i) => { const k = L[i].trim().split(/\s+/)[0]; return `strip ${idx.indexOf(+i) + 1} (${(Desk.SPECS[k] || {}).title || k})`; };
        const [hi, lo] = [got[0], got[got.length - 1]];
        setTimeout(() => note(`Leave one out${looStop ? " (stopped)" : ""}: ${name(hi[0])} matters most (${hi[1].edit.toFixed(2)} without it)` +
          (got.length > 1 ? `; ${name(lo[0])} least (${lo[1].edit.toFixed(2)}).` : ".")), 50);
      }
    } catch (err) { if (err.name !== "AbortError") alert(err.message); }
    finally { running = false; busy(false); refreshStatus(); }
  });

  // ---------------------------------------------------------------- Figure
  // The run drawn as an SVG from its data (not a screenshot), so that it comes out the same each
  // time and stays sharp in print; the PNG is that SVG drawn at twice the size. Always light.
  const SERIF = "Georgia, 'Times New Roman', serif", SANS = "-apple-system, 'Helvetica Neue', Arial, sans-serif", MONO = "Menlo, Consolas, monospace";
  const cv = document.createElement("canvas").getContext("2d");
  const measure = (s, font) => { cv.font = font; return cv.measureText(s).width; };
  const x_ = (s) => esc(s).replace(/'/g, "&#39;");
  function wrap(segs, width, font) {               // segments [{t, cls}] into lines of pieces [{t, cls, x}]
    const lines = [[]];
    let x = 0;
    for (const sg of segs) {
      for (const tk of sg.t.match(/\n|[^\S\n]+|[^\s]+/g) || []) {
        if (tk === "\n") { lines.push([]); x = 0; continue; }
        const line = lines[lines.length - 1], w = measure(tk, font), space = !tk.trim();
        if (space && x === 0) continue;
        if (!space && x > 0 && x + w > width) {
          const last = line[line.length - 1];
          if (last) last.t = last.t.replace(/\s+$/, "");
          lines.push([]); x = 0;
        }
        const cur = lines[lines.length - 1], p = cur[cur.length - 1];
        if (p && p.cls === sg.cls) p.t += tk; else cur.push({ t: tk, cls: sg.cls, x });
        x += w;
      }
    }
    return lines;
  }
  const INK = { prompt: "#8a8f9b", rem: "#a3281b", add: "#1d6b35" }, BG = { rem: "#fbe1dd", add: "#dcf1e2" };
  function drawLines(lines, x0, y0, font, size, lh) {
    let out = "";
    lines.forEach((line, n) => {
      const y = y0 + n * lh;
      for (const p of line) {
        const w = measure(p.t, font);
        if (BG[p.cls]) out += `<rect x="${(x0 + p.x - 1).toFixed(1)}" y="${(y - size * 0.86).toFixed(1)}" width="${(w + 2).toFixed(1)}" height="${(size * 1.22).toFixed(1)}" rx="2" fill="${BG[p.cls]}"/>`;
        out += `<text x="${(x0 + p.x).toFixed(1)}" y="${y.toFixed(1)}" fill="${INK[p.cls] || "#1b1d22"}"${p.cls === "rem" ? ' text-decoration="line-through"' : ""}>${x_(p.t)}</text>`;
      }
    });
    return out;
  }
  function figureSVG(r) {
    const ref = compareRef(r), rc = r.recipe;
    const W = 1200, M = 44, G = 36, colW = (W - 2 * M - G) / 2;
    let body = "", y = M;
    // heading: the tool and the run
    body += `<text x="${M}" y="${y}" font-family="${SANS}" font-size="11" font-weight="700" letter-spacing="1.6" fill="#6b7080">ABLITERATION LENS</text>`;
    body += `<text x="${W - M}" y="${y}" font-family="${MONO}" font-size="11" fill="#6b7080" text-anchor="end">run ${x_(r.id)}</text>`;
    y += 34;
    // the prompt
    const pf = `italic 21px ${SERIF}`, pl = wrap([{ t: `“${rc.prompt}”` }], W - 2 * M, pf);
    body += `<g font-family="${SERIF}" font-size="21" font-style="italic" xml:space="preserve">${drawLines(pl, M, y, pf, 21, 29)}</g>`;
    y += pl.length * 29 + 14;
    // the chain: the instrument, then each strip, left to right
    const strips = rc.chain.strips.filter((s) => !(Desk.SPECS[s.kind] || {}).probe);
    const boxes = [{ title: rc.model.model_id.split("/").pop() + (rc.model.revision && rc.model.revision !== "main" ? ` @ ${rc.model.revision}` : ""),
      sub: `T ${rc.sampler.temperature} · top-k ${rc.sampler.top_k} · top-p ${rc.sampler.top_p} · seed ${rc.seed}`, inst: true },
      ...strips.map((s) => ({ title: (Desk.SPECS[s.kind] || {}).title || s.kind, sub: Object.entries(s.params).map(([k, v]) => `${k}=${/[\s"]/.test(v) || v === "" ? JSON.stringify(v) : v}`).join(" "), off: !s.on }))];
    const tf = `600 13px ${SANS}`, sf = `11px ${MONO}`;
    let bx = M, rowH = 50;
    for (let b = 0; b < boxes.length; b++) {
      const B = boxes[b], w = Math.min(W - 2 * M, Math.max(measure(B.title, tf), measure(B.sub, sf)) + 24);
      if (bx > M && bx + w > W - M) { bx = M; y += rowH + 12; }
      if (b > 0 && bx > M) body += `<text x="${bx - 15}" y="${y + 29}" font-family="${SANS}" font-size="14" fill="#9aa0ad" text-anchor="middle">→</text>`;
      body += `<g opacity="${B.off ? 0.45 : 1}"><rect x="${bx}" y="${y}" width="${w.toFixed(1)}" height="${rowH}" rx="8" fill="${B.inst ? "#1e2128" : "#f4f1ea"}" stroke="${B.inst ? "#1e2128" : "#d8d3c6"}"${B.off ? ' stroke-dasharray="4 3"' : ""}/>
        <text x="${bx + 12}" y="${y + 21}" font-family="${SANS}" font-size="13" font-weight="600" fill="${B.inst ? "#ffffff" : "#1b1d22"}">${x_(B.title)}${B.off ? " (bypassed)" : ""}</text>
        <text x="${bx + 12}" y="${y + 38}" font-family="${MONO}" font-size="11" fill="${B.inst ? "#d9aa3f" : "#5b606d"}" xml:space="preserve">${x_(B.sub)}</text></g>`;
      bx += w + 30;
    }
    y += rowH + 30;
    // the two texts, with the words only one has marked
    const a = [{ t: ref.prompt + "\n", cls: "prompt" }], b = [{ t: rc.prompt + "\n", cls: "prompt" }];   // the prompt on its own line, as on the Bench
    for (const [op, t] of ref.diff) {
      if (op === "common") { a.push({ t }); b.push({ t }); }
      else if (op === "removed") a.push({ t, cls: "rem" });
      else b.push({ t, cls: "add" });
    }
    const nOn = strips.filter((s) => s.on).length;
    const heads = [[ref.name, ref.kind === "pin" ? ref.sub : "original model, same seed"], ["Diverged", nOn ? `through ${nOn} intervention${nOn > 1 ? "s" : ""}` : "nothing on"]];
    heads.forEach(([h, s], c) => {
      const x = M + c * (colW + G);
      body += `<text x="${x}" y="${y}" font-family="${SANS}" font-size="13" font-weight="700" fill="#1b1d22">${x_(h)}<tspan font-weight="400" fill="#6b7080" dx="8">${x_(s)}</tspan></text>`;
      body += `<line x1="${x}" x2="${x + colW}" y1="${y + 9}" y2="${y + 9}" stroke="#e2ddd0"/>`;
    });
    y += 36;
    const tfnt = `16px ${SERIF}`, la = wrap(a, colW, tfnt), lb = wrap(b, colW, tfnt);
    body += `<g font-family="${SERIF}" font-size="16" xml:space="preserve">${drawLines(la, M, y, tfnt, 16, 25)}${drawLines(lb, M + colW + G, y, tfnt, 16, 25)}</g>`;
    y += Math.max(la.length, lb.length) * 25 + 14;
    // what the difference amounts to, and where the run came from
    body += `<line x1="${M}" x2="${W - M}" y1="${y}" y2="${y}" stroke="#e2ddd0"/>`;
    y += 24;
    const against = ref.kind === "pin" ? "the pinned run" : "the original";
    const line1 = ref.k < 0 ? `The diverged text is the same as ${against}, token for token.` : `Set against ${against}, the diverged text parts at token ${ref.k + 1}; word edit distance ${ref.edit.toFixed(2)}.`;
    body += `<text x="${M}" y="${y}" font-family="${SANS}" font-size="13" fill="#1b1d22">${x_(line1)}</text>`;
    y += 20;
    const mm = rc.model, line2 = `Abliteration Lens ${rc.tool.version} · ${mm.model_id} at ${String(mm.revision_hash || mm.revision || "").slice(0, 10)} · ${mm.dtype} on ${mm.device} · ${r.created.replace("T", " ")}`;
    body += `<text x="${M}" y="${y}" font-family="${MONO}" font-size="10.5" fill="#6b7080">${x_(line2)}</text>`;
    y += M - 8;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.ceil(y)}" viewBox="0 0 ${W} ${Math.ceil(y)}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
  }
  function svgPNG(svg, scale = 2) {
    return new Promise((ok, bad) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth * scale; c.height = img.naturalHeight * scale;
        const g = c.getContext("2d"); g.scale(scale, scale); g.drawImage(img, 0, 0);
        c.toBlob((b) => (b ? ok(b) : bad(new Error("The PNG could not be made."))), "image/png");
      };
      img.onerror = () => bad(new Error("The SVG could not be drawn."));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }
  const saveBlob = (blob, name) => {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  window.figureSVG = figureSVG; window.svgPNG = svgPNG;
  window.openFigure = () => {
    if (!S.run) { note("Run the pair first: the figure is drawn from a run."); return; }
    const r = S.run, svg = figureSVG(r), base = `abliteration-${r.id}${compareRef(r).kind === "pin" ? "-vs-" + S.pin.id : ""}`;
    const d = document.createElement("dialog");
    d.className = "figbox";
    d.innerHTML = `<div class="boxhead fighead"><h2>Figure</h2><button class="b small" data-x="close" aria-label="Close">✕</button></div>
      <div class="figprev"><img alt="The figure: the chain, the two texts with the words only one has marked, and the recipe" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}"></div>
      <div class="figbar"><button class="b primary small" data-x="png">Save PNG</button><button class="b small" data-x="svg">Save SVG</button>
        <button class="b small" data-x="copy">Copy PNG</button><span class="note" id="fignote">Drawn from run ${esc(r.id)}${compareRef(r).kind === "pin" ? `, set against the pinned run ${esc(S.pin.id)}` : ""}. The SVG keeps the text as text.</span></div>`;
    document.body.appendChild(d);
    d.addEventListener("close", () => d.remove());
    d.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-x]"); if (!b) { if (e.target === d) d.close(); return; }
      const say = (t) => { $("#fignote", d).textContent = t; };
      try {
        if (b.dataset.x === "close") d.close();
        else if (b.dataset.x === "svg") { saveBlob(new Blob([svg], { type: "image/svg+xml" }), base + ".svg"); say(`Saved ${base}.svg.`); }
        else if (b.dataset.x === "png") { saveBlob(await svgPNG(svg), base + ".png"); say(`Saved ${base}.png.`); }
        else if (b.dataset.x === "copy") { await navigator.clipboard.write([new ClipboardItem({ "image/png": svgPNG(svg) })]); say("Copied the PNG: paste it anywhere."); }
      } catch (err) { say(err.message); }
    });
    d.showModal();
  };

  // ---------------------------------------------------------------- Snap
  // The Bench as it is on screen, as a PNG, with no prompt. The page copies itself: every visible
  // element is cloned with its computed style written onto it (only the properties that differ from
  // what the copy would get anyway), form fields keep their values, the page's
  // stylesheet is carried for pseudo-elements, scrolled panels keep their scroll position, and images become data URLs. The copy is
  // drawn as an SVG foreignObject into a canvas. Nothing leaves the machine.
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE"]);
  let defFrame = null;
  const defaults = new Map();
  function tagDefault(el) {                          // the computed style a bare element of this kind gets
    const key = (el.namespaceURI || "") + el.localName;
    if (defaults.has(key)) return defaults.get(key);
    if (!defFrame) {
      defFrame = document.createElement("iframe");
      Object.assign(defFrame.style, { position: "fixed", left: "-9999px", top: "0", width: "10px", height: "10px", visibility: "hidden" });
      defFrame.setAttribute("aria-hidden", "true"); defFrame.tabIndex = -1;
      document.body.appendChild(defFrame);
    }
    const d = defFrame.contentDocument, e = d.createElementNS(el.namespaceURI || "http://www.w3.org/1999/xhtml", el.localName);
    (el.namespaceURI === "http://www.w3.org/2000/svg" && el.localName !== "svg" ? d.body.appendChild(d.createElementNS("http://www.w3.org/2000/svg", "svg")) : d.body).appendChild(e);
    const cs = d.defaultView.getComputedStyle(e), m = {};
    for (let i = 0; i < cs.length; i++) m[cs[i]] = cs.getPropertyValue(cs[i]);
    defaults.set(key, m);
    return m;
  }
  function styleOf(cs, def, parent) {                // a property is left out only where the copy would get the same value anyway
    let s = "";
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      if (p.startsWith("transition") || p.startsWith("animation")) continue;
      const v = cs.getPropertyValue(p);
      if (v === def[p] && (!parent || v === parent.getPropertyValue(p))) continue;
      s += `${p}:${v};`;
    }
    return s;
  }
  function ringOutline(shadow) {
    const parts = shadow.split(/,(?![^(]*\))/);                  // shadows, split outside rgb(...)
    if (parts.length !== 1 || /inset/.test(shadow)) return "";
    const color = (shadow.match(/(rgba?\([^)]*\)|#[0-9a-f]+|[a-z]+)/i) || [])[0];
    const nums = shadow.replace(/rgba?\([^)]*\)/g, "").match(/-?[\d.]+px/g) || [];
    const [x, y, blur, spread] = nums.map((n) => parseFloat(n)).concat([0, 0, 0, 0]);
    return !x && !y && !blur && spread > 0 && color ? `outline:${spread}px solid ${color};outline-offset:0;` : "";
  }
  function copy(node, parentCS) {
    if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
    if (node.nodeType !== 1 || SKIP.has(node.tagName)) return null;
    if (node.matches(".icotip, .dive:not(.pinned), dialog.figbox, iframe")) return null;
    const cs = getComputedStyle(node);
    if (cs.display === "none") return null;
    const c = node.cloneNode(false);
    let style = styleOf(cs, tagDefault(node), parentCS);
    if (node.tagName === "INPUT" && /^(text|number|search|url|email|)$/.test(node.type)) {
      // drawn as a plain box: an image draws native fields at its own size
      const box = document.createElement("div"), empty = !node.value && node.placeholder;
      let ph = getComputedStyle(node, "::placeholder").color;
      if (!ph || ph === cs.color) ph = `color-mix(in srgb, ${cs.color} 45%, transparent)`;
      const just = { center: "center", right: "flex-end", end: "flex-end" }[cs.textAlign] || "flex-start";
      box.setAttribute("style", styleOf(cs, tagDefault(box), parentCS) +
        `box-sizing:${cs.boxSizing};display:inline-flex;align-items:center;justify-content:${just};appearance:none;white-space:pre;overflow:hidden;${empty ? `color:${ph};-webkit-text-fill-color:${ph};` : ""}`);
      box.textContent = empty ? node.placeholder : node.value;
      return box;
    }
    if (node.tagName === "INPUT" && (node.type === "checkbox" || node.type === "radio") && node.checked) c.setAttribute("checked", "");
    if (node.tagName === "OPTION" && node.selected) c.setAttribute("selected", "");
    if (node.tagName === "TEXTAREA") {            // drawn as a box of wrapped text, which renders the same everywhere
      const box = document.createElement("div");
      box.setAttribute("style", styleOf(cs, tagDefault(box), parentCS) + "appearance:none;white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden;");
      box.textContent = node.value || node.placeholder;
      return box;
    }
    if (node.tagName === "CANVAS") { const img = document.createElement("img"); img.src = node.toDataURL(); img.setAttribute("style", style); return img; }
    const sx = node.scrollLeft, sy = node.scrollTop, scrolled = (sx || sy) && /(auto|scroll|hidden)/.test(cs.overflow + cs.overflowX + cs.overflowY);
    if (scrolled) style += "overflow:hidden;";
    // Box-shadows are drawn unreliably in this kind of image by some browsers (offset, or a soft glow as a
    // solid disc). In the copy a plain ring (no offset, no blur, a spread) becomes an outline of that
    // width and colour; glows and drop shadows are left out.
    if (cs.boxShadow && cs.boxShadow !== "none") style += `box-shadow:none;${ringOutline(cs.boxShadow)}`;
    c.setAttribute("style", style);
    for (const ch of node.childNodes) {
      const k = copy(ch, cs);
      if (!k) continue;
      if (scrolled && k.nodeType === 1) {               // a scrolled panel shows the same part of its content
        const pos = getComputedStyle(ch).position;
        if (pos === "static") k.style.cssText += `position:relative;left:${-sx}px;top:${-sy}px;`;
        else if (pos === "relative") k.style.cssText += `left:${(parseFloat(getComputedStyle(ch).left) || 0) - sx}px;top:${(parseFloat(getComputedStyle(ch).top) || 0) - sy}px;`;
      }
      c.appendChild(k);
    }
    return c;
  }
  async function inlineImages(root) {
    for (const img of root.querySelectorAll("img")) {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) continue;
      try {
        const b = await (await fetch(new URL(src, location.href))).blob();
        img.setAttribute("src", await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); }));
      } catch (e) { img.removeAttribute("src"); }
    }
  }
  async function snapPage() {
    const W = document.documentElement.clientWidth, H = innerHeight, scale = Math.min(2, Math.max(1, devicePixelRatio || 1));
    const bodyCS = getComputedStyle(document.body), htmlCS = getComputedStyle(document.documentElement);
    const page = document.createElement("div");
    page.setAttribute("style", styleOf(bodyCS, {}, null) + `margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;background:${bodyCS.backgroundColor === "rgba(0, 0, 0, 0)" ? htmlCS.backgroundColor : bodyCS.backgroundColor};`);
    // the page's rules for pseudo-elements go in too, for what inline styles cannot carry: ::before and
    // ::after, ::placeholder, a range input's thumb. Only those rules: a rule for an element itself could
    // apply in the copy where it does not on the page (one that depends on body.dock, for instance).
    const pick = (rules) => [...rules].flatMap((r) =>
      r.selectorText !== undefined ? (/::|:before|:after/.test(r.selectorText) ? [r.cssText] : [])
      : r.media && r.cssRules ? (matchMedia(r.media.mediaText).matches ? pick(r.cssRules) : []) : []);
    const css = document.createElement("style");
    css.textContent = [...document.styleSheets].flatMap((sh) => { try { return pick(sh.cssRules); } catch (e) { return []; } }).join("\n");
    page.appendChild(css);
    for (const ch of document.body.childNodes) { const k = copy(ch, bodyCS); if (k) page.appendChild(k); }
    await inlineImages(page);
    page.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const xml = new XMLSerializer().serializeToString(page);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${xml}</foreignObject></svg>`;
    const img = new Image();
    img.decoding = "sync";
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("the copy of the page could not be drawn")); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
    const c = document.createElement("canvas");
    c.width = Math.round(W * scale); c.height = Math.round(H * scale);
    const g = c.getContext("2d");
    g.scale(scale, scale); g.drawImage(img, 0, 0);
    return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("the PNG could not be made"))), "image/png"));
  }
  window.snapPage = snapPage;
  async function snap() {
    tipHide();
    let blob;
    try { blob = await snapPage(); }
    catch (e) { note(`No snap: ${e.message}. ⇧⌘4 takes a screenshot on a Mac.`); return; }
    const url = URL.createObjectURL(blob), name = `abliteration-lens-${stamp()}.png`;
    const d = document.createElement("dialog");
    d.className = "figbox";
    d.innerHTML = `<div class="boxhead fighead"><h2>Snap</h2><button class="b small" data-x="close" aria-label="Close">✕</button></div>
      <div class="figprev"><img alt="The Bench as it was on screen" src="${url}"></div>
      <div class="figbar"><button class="b primary small" data-x="save">Save PNG</button><button class="b small" data-x="copy">Copy PNG</button>
        <span class="note" id="fignote">The Bench as it was on screen, ${(blob.size / 1024).toFixed(0)} KB.</span></div>`;
    document.body.appendChild(d);
    d.addEventListener("close", () => { d.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); });
    d.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-x]"); if (!b) { if (e.target === d) d.close(); return; }
      const say = (t) => { $("#fignote", d).textContent = t; };
      try {
        if (b.dataset.x === "close") d.close();
        else if (b.dataset.x === "save") { saveBlob(blob, name); say(`Saved ${name}.`); }
        else if (b.dataset.x === "copy") { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); say("Copied: paste it anywhere."); }
      } catch (err) { say(err.message); }
    });
    d.showModal();
  }
  $("#dtfig").addEventListener("click", snap);

  // ================================================================ the Instrument's knobs
  // The sampler's numbers turn as knobs; the box under each takes an exact value.
  const knobs = [];
  function inputKnob(input) {
    const o = { label: input.dataset.knob, min: +input.dataset.min, max: +input.dataset.max, step: +input.dataset.step || 0, int: !!input.dataset.int };
    const reset = +input.getAttribute("value");
    const wrap = document.createElement("div");
    wrap.className = "knob iknob";
    wrap.innerHTML = `<div class="kl">${o.label}</div><svg viewBox="0 0 48 48" tabindex="0" role="slider" aria-label="${o.label}"><circle cx="24" cy="24" r="17" class="kbody"/><path class="ktrack"/><path class="karc"/><line x1="24" y1="24" x2="24" y2="11" class="kline"/></svg>`;
    wrap.dataset.mini = `${o.label} · ${o.min} to ${o.max}`;
    wrap.title = `${o.label}. Drag the knob up or right to turn it up (Shift for fine), scroll on it, or use the arrow keys. Double-click it to reset it to ${reset}; type in the box for an exact value.`;
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const svg = wrap.querySelector("svg");
    const arc = (t) => {
      const a0 = -135, a = a0 + 270 * t, r = 21;
      const pt = (d) => [24 + r * Math.sin(d * Math.PI / 180), 24 - r * Math.cos(d * Math.PI / 180)];
      const [x0, y0] = pt(a0), [x1, y1] = pt(a);
      return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    svg.querySelector(".ktrack").setAttribute("d", arc(1));
    const clamp = (x) => Math.min(1, Math.max(0, x));
    const get = () => { const v = parseFloat(input.value); return isNaN(v) ? reset : v; };
    const pos = (v) => (v - o.min) / (o.max - o.min), val = (t) => o.min + t * (o.max - o.min);
    const rnd = (v) => (o.int ? Math.round(v) : o.step ? +(Math.round(v / o.step) * o.step).toFixed(3) : +v.toFixed(3));
    const paint = () => {
      const t = clamp(pos(get()));
      svg.querySelector(".karc").setAttribute("d", arc(Math.max(t, 0.001)));
      svg.querySelector(".kline").setAttribute("transform", `rotate(${-135 + 270 * t} 24 24)`);
      svg.setAttribute("aria-valuetext", String(get()));
    };
    const changed = () => input.dispatchEvent(new Event("change", { bubbles: true }));
    const setV = (v) => { if (String(v) !== input.value) { input.value = String(v); input.dispatchEvent(new Event("input", { bubbles: true })); } paint(); };
    let acc = null, idle = null;                 // the unrounded position while it turns (see desk.js)
    const nudge = (dt) => { if (acc === null) acc = clamp(pos(get())); acc = clamp(acc + dt); setV(rnd(val(acc))); };
    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); svg.focus(); svg.setPointerCapture(e.pointerId);
      let x = e.clientX, y = e.clientY;
      acc = clamp(pos(get()));
      const move = (ev) => { nudge(((y - ev.clientY) + (ev.clientX - x)) / (ev.shiftKey ? 800 : 160)); x = ev.clientX; y = ev.clientY; };
      const up = () => { acc = null; svg.removeEventListener("pointermove", move); svg.removeEventListener("pointerup", up); svg.removeEventListener("pointercancel", up); changed(); };
      svg.addEventListener("pointermove", move); svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
    });
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      nudge(-e.deltaY / (e.shiftKey ? 3000 : 600));
      clearTimeout(idle); idle = setTimeout(() => { acc = null; changed(); }, 400);
    }, { passive: false });
    svg.addEventListener("dblclick", () => { acc = null; setV(reset); changed(); });
    svg.addEventListener("keydown", (e) => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault(); acc = null;
      setV(o.int ? Math.min(o.max, Math.max(o.min, Math.round(get()) + d)) : rnd(val(clamp(pos(get()) + d * 0.025))));
      changed();
    });
    input.addEventListener("input", paint);
    paint();
    knobs.push(paint);
  }
  $$("#instrument [data-knob]").forEach(inputKnob);
  const paintKnobs = () => knobs.forEach((f) => f());
  // values set by code (a run reopened, Settings saved) turn the knobs too
  // the Instrument is named after the model it holds
  const title = () => { $("#insttitle").textContent = `Instrument: ${S.model ? S.model.name || S.model.model_id : "no model loaded"}`; };
  new MutationObserver(title).observe($("#modelinfo"), { childList: true, characterData: true, subtree: true });
  title();
  for (const name of ["restoreInputs", "applySettings"]) {
    const f = window[name];
    if (typeof f === "function") window[name] = function (...a) { const r = f.apply(this, a); paintKnobs(); return r; };
  }
  const seedTo = (v) => { $("#seed").value = String(v); $("#seed").dispatchEvent(new Event("change", { bubbles: true })); };
  $("#seedprev").addEventListener("click", () => seedTo(Math.max(0, (+$("#seed").value || 0) - 1)));
  $("#seednext").addEventListener("click", () => seedTo((+$("#seed").value || 0) + 1));
  $("#seedrand").addEventListener("click", () => seedTo(Math.floor(Math.random() * 100000)));

  // ================================================================ the timeline
  // The two texts token by token along a ruler, with the point where they part and a playhead.
  // The playhead is the meters' step: move it here, and every meter on the desk follows.
  const tl = $("#timeline");
  let tlRun = null, cw = 20;
  const show = (t) => (t.replace(/\n/g, "↵").trim() || "␣");
  const maxTok = () => Math.max(1, Math.min(512, parseInt($("#maxtok").value, 10) || 60));
  // the ruler and two lanes of blank cells, one for each token the run will write
  function blankTimeline(n, info) {
    cw = Math.max(18, Math.max(200, tl.clientWidth - 78) / n);
    const every = n > 120 ? 20 : n > 50 ? 10 : 5;
    let ticks = "", la = "", lb = "";
    for (let j = 0; j < n; j++) {
      if (j === 0 || (j + 1) % every === 0) ticks += `<span class="tl-tick" style="left:${j * cw}px">${j + 1}</span>`;
      la += `<span class="tl-c blank" data-j="${j}" style="left:${j * cw}px;width:${cw}px"></span>`;
      lb += `<span class="tl-c bent blank" data-j="${j}" style="left:${j * cw}px;width:${cw}px"></span>`;
    }
    tl.innerHTML = `<div class="tl-labels"><span></span><span>Original</span><span>Diverged</span></div>
      <div class="tl-scroll"><div class="tl-inner waiting" style="width:${n * cw}px" data-info="${info}">
        <div class="tl-ruler">${ticks}</div><div class="tl-lane">${la}</div><div class="tl-lane">${lb}</div>
      </div></div>`;
  }
  // While the pair runs, its tokens fill the blank cells as they arrive: the original text first,
  // then the diverged one, marked from the first token where it leaves the original.
  let tlLive = null;
  function liveFill(run, j, fresh) {
    const lanes = $$(".tl-lane", tl), c = lanes[run === "bent" ? 1 : 0]?.children[j], t = tlLive[run][j];
    if (!c || !t) return;
    c.classList.remove("blank"); c.textContent = show(t.t);
    if (fresh) {
      c.classList.add("fresh");
      const sc = $(".tl-scroll", tl), x = j * cw;
      if (x + cw > sc.scrollLeft + sc.clientWidth - 20 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - sc.clientWidth + 3 * cw);
    }
    if (run === "bent" && tlLive.k >= 0 && j >= tlLive.k) {
      c.classList.add("diff");
      const a = lanes[0].children[j]; if (a && !a.classList.contains("blank")) a.classList.add("diff");
    }
  }
  function drawLive() {
    blankTimeline(tlLive.n, "Running: the cells fill as the model writes, the original text first and then the diverged one.");
    for (const run of ["baseline", "bent"]) tlLive[run].forEach((_, j) => liveFill(run, j, false));
  }
  window.timelineLive = {
    begin() { tlLive = { n: maxTok(), baseline: [], bent: [], k: -1 }; tlRun = S.run; drawLive(); },
    token(run, tok) {
      if (!tlLive) return;
      const j = tlLive[run].length; tlLive[run].push(tok);
      if (run === "bent" && tlLive.k < 0) { const a = tlLive.baseline[j]; if (!a || a.id !== tok.id) tlLive.k = j; }
      if (j >= tlLive.n) { tlLive.n = j + 1; drawLive(); return; }
      liveFill(run, j, true);
    },
    end() { if (tlLive) { tlLive = null; drawTimeline(); } },
  };
  function drawTimeline() {
    if (tlLive) { drawLive(); return; }
    tlRun = S.run;
    if (!S.run) {
      const n = maxTok();
      blankTimeline(n, `Waiting for a run: the ${n} tokens of each text will fill these cells, with a playhead that the desk's meters follow.`);
      return;
    }
    const r = S.run, ref = compareRef(r), A = ref.tokens, B = r.bent.tokens, n = Math.max(A.length, B.length, 1);
    const k = ref.k;
    const W = Math.max(200, tl.clientWidth - 78);
    cw = Math.max(18, W / n);
    const every = n > 120 ? 20 : n > 50 ? 10 : 5;
    let ticks = "", la = "", lb = "";
    for (let j = 0; j < n; j++) {
      if (j === 0 || (j + 1) % every === 0) ticks += `<span class="tl-tick" style="left:${j * cw}px">${j + 1}</span>`;
      const diff = k >= 0 && j >= k;
      if (A[j]) la += `<span class="tl-c${diff ? " diff" : ""}" data-j="${j}" style="left:${j * cw}px;width:${cw}px">${esc(show(A[j].t))}</span>`;
      if (B[j]) lb += `<span class="tl-c bent${diff ? " diff" : ""}" data-j="${j}" style="left:${j * cw}px;width:${cw}px">${esc(show(B[j].t))}</span>`;
    }
    tl.innerHTML = `<div class="tl-labels"><span></span><span>${ref.name}</span><span>Diverged</span></div>
      <div class="tl-scroll"><div class="tl-inner" style="width:${n * cw}px">
        <div class="tl-ruler">${ticks}</div><div class="tl-lane">${la}</div><div class="tl-lane">${lb}</div>
        ${k >= 0 ? `<div class="tl-div" style="left:${k * cw}px" data-info="Where the texts part: token ${k + 1}"><span>parts</span></div>` : ""}
        <div class="tl-ph" style="width:${cw}px"></div>
      </div></div>`;
    tl.setAttribute("aria-valuemin", "1"); tl.setAttribute("aria-valuemax", String(n));
    const inner = $(".tl-inner", tl);
    const at = (x) => Math.floor((x - inner.getBoundingClientRect().left) / cw);
    inner.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); inner.setPointerCapture(e.pointerId); tl.focus({ preventScroll: true });
      Desk.setStep(at(e.clientX));
      const mv = (ev) => Desk.setStep(at(ev.clientX));
      const up = () => { inner.removeEventListener("pointermove", mv); inner.removeEventListener("pointerup", up); inner.removeEventListener("pointercancel", up); };
      inner.addEventListener("pointermove", mv); inner.addEventListener("pointerup", up); inner.addEventListener("pointercancel", up);
    });
    playhead(Desk.step ?? 0);
  }
  function playhead(j) {
    const ph = $(".tl-ph", tl);
    if (ph) {
      ph.style.left = `${j * cw}px`;
      $$(".tl-c.on", tl).forEach((c) => c.classList.remove("on"));
      $$(`.tl-c[data-j="${j}"]`, tl).forEach((c) => c.classList.add("on"));
      const sc = $(".tl-scroll", tl), x = j * cw;
      if (x < sc.scrollLeft + 20 || x + cw > sc.scrollLeft + sc.clientWidth - 20) sc.scrollLeft = Math.max(0, x - sc.clientWidth / 2);
      const r = S.run, b = r && r.bent.tokens[j], a = r && r.baseline.tokens[j];
      tl.setAttribute("aria-valuenow", String(j + 1));
      tl.setAttribute("aria-valuetext", `step ${j + 1}: original ${a ? JSON.stringify(a.t) : "ended"}, diverged ${b ? JSON.stringify(b.t) : "ended"}`);
    }
    // the same token, marked in the Tokens view of the texts
    $$("#basetext .tok.ph, #benttext .tok.ph").forEach((t) => t.classList.remove("ph"));
    $$(`#basetext .tok[data-i="${j}"], #benttext .tok[data-i="${j}"]`).forEach((t) => t.classList.add("ph"));
  }
  Desk.onStep((j, run) => { if (run !== tlRun || !$(".tl-inner", tl)) drawTimeline(); else playhead(j); });
  window.redrawTimeline = drawTimeline;
  tl.addEventListener("keydown", (e) => {
    if (!S.run) return;
    const j = Desk.step ?? 0, n = Math.max(S.run.baseline.tokens.length, S.run.bent.tokens.length);
    const to = { ArrowLeft: j - 1, ArrowRight: j + 1, Home: 0, End: n - 1, PageUp: j - 10, PageDown: j + 10 }[e.key];
    if (to === undefined) return;
    e.preventDefault(); Desk.setStep(to);
  });
  new ResizeObserver(() => { if (!$("#arrangement").hidden) drawTimeline(); }).observe(tl);
  $("#maxtok").addEventListener("input", () => { if (!S.run && !tlLive) drawTimeline(); });       // the blank cells follow the Tokens knob
  // a change of the texts' view (Diff, Tokens, Plain) redraws them: mark the playhead again
  $("#showmode").addEventListener("click", () => setTimeout(() => { if (S.run) playhead(Desk.step ?? 0); }, 0));
  drawTimeline();

  // ================================================================ Arrangement and Session
  function setArea(v) {
    if (!SESSION) v = "arr";
    $("#arrangement").hidden = v !== "arr";
    $("#session").hidden = v !== "ses";
    $("#vw-arr").setAttribute("aria-pressed", String(v === "arr"));
    $("#vw-ses").setAttribute("aria-pressed", String(v === "ses"));
    store.set("area", v);
    if (v === "ses") renderGrid(); else drawTimeline();
  }
  $(".viewswap").hidden = !SESSION;
  $("#vw-arr").addEventListener("click", () => { setView("bench"); setArea("arr"); });
  $("#vw-ses").addEventListener("click", () => { setView("bench"); setArea("ses"); });

  // ---------------------------------------------------------------- the Session grid
  // Rows are prompts (scenes), columns are chains (tracks). A cell runs that prompt
  // through that chain with the Instrument's model, sampler and seed, and keeps the run in the
  // Variorum. ▶ on a row runs the row; a filled cell opens its run in the Arrangement.
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let SS = store.get("session", null) || { prompts: [], chains: [], cells: {} };
  const save = () => store.set("session", SS);
  const live = {};
  let queue = [], qOn = false;
  function chainName(text) {
    const names = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
      .map((l) => (Desk.SPECS[l.split(/\s+/)[0]] || {}).title).filter(Boolean);
    return names.length ? names.join(" · ") : "Nothing on";
  }
  function cellHTML(p, c) {
    const key = p.id + "|" + c.id, x = SS.cells[key];
    if (live[key]) return `<td class="cell running" data-info="Running…"><span class="spin"></span></td>`;
    if (queue.some((q) => q.pid === p.id && q.cid === c.id)) return `<td class="cell queued" data-info="Waiting its turn">…</td>`;
    if (!x) return `<td class="cell empty"><button class="cellrun" data-act="run" data-p="${p.id}" data-c="${c.id}" title="Run “${esc(p.text.slice(0, 40))}” through ${esc(c.name)}">▶</button></td>`;
    if (x.error) return `<td class="cell err" data-act="run" data-p="${p.id}" data-c="${c.id}" data-info="Failed: ${esc(x.error)}. Click to run it again.">failed</td>`;
    const d = Math.max(0, Math.min(1, x.edit || 0));
    return `<td class="cell done" data-act="open" data-p="${p.id}" data-c="${c.id}" style="--d:${(d * 70).toFixed(0)}%"
      data-info="Seed ${x.seed}. ${x.parts < 0 ? "The same as the original." : `Parts at token ${x.parts + 1}, word edit distance ${d.toFixed(2)}.`} Bent: “${esc(x.bent)}…” Click to open it in the Arrangement.">
      <b>${x.parts < 0 ? "same" : d.toFixed(2)}</b><span>${x.parts < 0 ? "" : "parts at " + (x.parts + 1)}</span>${+$("#seed").value !== x.seed ? `<em>seed ${x.seed}</em>` : ""}</td>`;
  }
  function renderGrid() {
    const g = $("#sessgrid");
    if (!SS.prompts.length && !SS.chains.length) {
      g.innerHTML = `<tbody><tr><td class="sess-empty">Add the Instrument's prompt as a row (+ Prompt) and the desk's chain as a column (+ Chain), then run the cells. Each cell is one run, kept in the Variorum.</td></tr></tbody>`;
    } else {
      g.innerHTML = `<thead><tr><th class="corner"></th>${SS.chains.map((c) => `<th class="scol">
          <div class="sname" data-act="rename" data-c="${c.id}" title="${esc(c.text)}">${esc(c.name)}</div>
          <div class="sbtns"><button data-act="col" data-c="${c.id}" title="Run every empty cell in this column">▶</button><button data-act="loadc" data-c="${c.id}" title="Put this chain on the desk">Load</button><button data-act="updc" data-c="${c.id}" title="Replace this column's chain with the desk's chain (its cells are emptied)">⟲</button><button data-act="rmc" data-c="${c.id}" title="Remove this column">✕</button></div></th>`).join("")}</tr></thead>
        <tbody>${SS.prompts.map((p) => `<tr><th class="srow"><button data-act="row" data-p="${p.id}" title="Run every empty cell in this row (a scene)">▶</button>
          <span class="sprompt" data-act="loadp" data-p="${p.id}" title="${esc(p.text)} (click to put it in the Instrument)">${esc(p.text)}</span><button data-act="rmp" data-p="${p.id}" title="Remove this row">✕</button></th>
          ${SS.chains.map((c) => cellHTML(p, c)).join("")}</tr>`).join("")}</tbody>`;
    }
    const n = Object.keys(SS.cells).length;
    $("#sessnote").textContent = SS.prompts.length || SS.chains.length ? `${SS.prompts.length} prompt${SS.prompts.length === 1 ? "" : "s"} × ${SS.chains.length} chain${SS.chains.length === 1 ? "" : "s"}, ${n} run` + (n === 1 ? "" : "s") : "";
  }
  function enqueue(cells) {
    for (const q of cells) if (!queue.some((x) => x.pid === q.pid && x.cid === q.cid) && !live[q.pid + "|" + q.cid]) queue.push(q);
    renderGrid();
    runQueue();
  }
  async function runQueue() {
    if (qOn) return;
    if (!S.model) { alert("Load a model first."); queue = []; renderGrid(); return; }
    if (running) return;                   // the Arrangement's own run: the queue waits for the next click
    qOn = true; running = true; busy(true);
    try {
      while (queue.length) {
        const { pid, cid } = queue.shift(), p = SS.prompts.find((x) => x.id === pid), c = SS.chains.find((x) => x.id === cid);
        if (!p || !c) continue;
        const key = pid + "|" + cid;
        live[key] = true; renderGrid();
        let res = null;
        try {
          await stream("/api/run", { prompt: p.text, chain: c.text, sampler: sampler(), seed: +$("#seed").value, label: `session: ${c.name}` },
            (e) => { if (e.type === "result") res = e.run; });
        } catch (err) {
          if (err.name === "AbortError") queue = [];
          else SS.cells[key] = { error: err.message };
        }
        delete live[key];
        if (res) SS.cells[key] = { id: res.id, seed: res.recipe.seed, parts: res.metrics.distance.first_divergence, edit: res.metrics.distance.edit, bent: res.bent.text.slice(0, 140) };
        save(); renderGrid();
      }
    } finally { qOn = false; running = false; busy(false); refreshStatus(); renderGrid(); loadBrowserData(); }
  }
  $("#stopbtn").addEventListener("click", () => { queue = []; renderGrid(); });
  $("#sessaddp").addEventListener("click", () => {
    const text = $("#prompt").value.trim();
    if (!text) return;
    if (!SS.prompts.some((p) => p.text === text)) SS.prompts.push({ id: uid(), text });
    save(); renderGrid();
  });
  $("#sessaddc").addEventListener("click", () => {
    const text = chainTA.value.trim();
    if (SS.chains.some((c) => c.text === text)) return;
    const name = prompt("A name for this chain's column", chainName(text));
    if (name === null) return;
    SS.chains.push({ id: uid(), name: name.trim() || chainName(text), text });
    save(); renderGrid();
  });
  $("#sessall").addEventListener("click", () => enqueue(SS.prompts.flatMap((p) => SS.chains.filter((c) => !SS.cells[p.id + "|" + c.id] || SS.cells[p.id + "|" + c.id].error).map((c) => ({ pid: p.id, cid: c.id })))));
  $("#sessclear").addEventListener("click", () => { if (confirm("Empty every cell? The runs stay in the Variorum.")) { SS.cells = {}; save(); renderGrid(); } });
  $("#sessgrid").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const { act, p: pid, c: cid } = b.dataset;
    const p = SS.prompts.find((x) => x.id === pid), c = SS.chains.find((x) => x.id === cid);
    const empty = (pp, cc) => !SS.cells[pp.id + "|" + cc.id] || SS.cells[pp.id + "|" + cc.id].error;
    if (act === "run") enqueue([{ pid, cid }]);
    else if (act === "row") enqueue(SS.chains.filter((cc) => empty(p, cc)).map((cc) => ({ pid, cid: cc.id })));
    else if (act === "col") enqueue(SS.prompts.filter((pp) => empty(pp, c)).map((pp) => ({ pid: pp.id, cid })));
    else if (act === "loadp") { $("#prompt").value = p.text; $("#prompt").dispatchEvent(new Event("change", { bubbles: true })); }
    else if (act === "loadc") { chainTA.value = c.text; chainTA.dispatchEvent(new Event("input", { bubbles: true })); Desk.render(); }
    else if (act === "rename") { const n = prompt("Column name", c.name); if (n !== null && n.trim()) { c.name = n.trim(); save(); renderGrid(); } }
    else if (act === "updc") {
      const has = SS.prompts.some((pp) => SS.cells[pp.id + "|" + cid]);
      if (has && !confirm(`Replace “${c.name}” with the desk's chain and empty its cells?`)) return;
      c.text = chainTA.value.trim();
      SS.prompts.forEach((pp) => delete SS.cells[pp.id + "|" + cid]);
      save(); renderGrid();
    } else if (act === "rmc") { if (confirm(`Remove the column “${c.name}”? Its runs stay in the Variorum.`)) { SS.chains = SS.chains.filter((x) => x.id !== cid); save(); renderGrid(); } }
    else if (act === "rmp") { if (confirm("Remove this row? Its runs stay in the Variorum.")) { SS.prompts = SS.prompts.filter((x) => x.id !== pid); save(); renderGrid(); } }
    else if (act === "open") {
      const x = SS.cells[pid + "|" + cid];
      try { S.run = await api(`/api/runs/${encodeURIComponent(x.id)}`); }
      catch (err) { delete SS.cells[pid + "|" + cid]; save(); renderGrid(); alert("That run is no longer in the Variorum."); return; }
      S.parent = S.run.id; restoreInputs(S.run.recipe); showRun(); setArea("arr");
    }
  });

  // ================================================================ the browser
  // Interventions, meters, directions, saved chains and recent runs. Drag one onto the desk to
  // put it there; double-click it (or press Enter) to add it at the end of the chain.
  const br = $("#browser"), body = $("#brbody");
  let dirs = [], runs = [];
  let chains = store.get("chains", []);
  const openSecs = { vau: true, ...store.get("brOpen", { model: true, sampler: true, meters: true, dirs: true, chains: true, runs: false }) };
  function item(label, sub, payload, extra = "") {
    return `<div class="br-item" draggable="true" tabindex="0" data-pay="${esc(JSON.stringify(payload))}" title="${esc(sub)}${payload.open ? "" : ". Drag it onto the desk, or double-click to add it at the end"}">
      <span class="br-l">${esc(label)}</span>${extra}</div>`;
  }
  function section(key, title, items, head = "") {
    return `<details data-k="${key}"${openSecs[key] ? " open" : ""}><summary>${title}</summary>${head}${items.join("") || `<div class="br-none">None yet</div>`}</details>`;
  }
  function renderBrowser() {
    const sp = Desk.SPECS, keys = Object.keys(sp), own = keys.filter((k) => !sp[k].unit), groups = Desk.vauGroups(keys);   // the Lens's own strips; the VAUs by collection
    const strip = (k) => {
      const un = sp[k].unit, miss = un && un.missing.length;
      const sub = `${sp[k].prefix || ""}${sp[k].title}: ${sp[k].what}` + (un ? ` (a unit, ${un.file}${un.source === "builtin" ? "" : ", from data/units, not built in"})` : "") + (miss ? `. Needs ${un.missing.join(", ")}` : "");
      return item((sp[k].prefix || "") + sp[k].title, sub, { lines: [Desk.NEW_LINE[k]] }, (un && sp[k].probe ? `<span class="meterbadge">meter</span>` : "") + (un ? Desk.spaceTag(k) : "") + (un && un.source !== "builtin" ? `<span class="br-ext" title="From data/units: not built in">◆</span>` : ""));
    };
    const unitHead = `<div class="br-units"><button id="brrescan" title="Look again in data/units for units (Vector Abliteration Units) you have added or changed, and reload the page">Rescan units</button>${(Desk.VAU.errors || []).length ? ` <span class="br-uerr" title="${esc(Desk.VAU.errors.map((e) => `${e.file}: ${e.error}`).join("\n"))}">${Desk.VAU.errors.length} not loaded</span>` : ""}</div>`;
    body.innerHTML =
      section("model", "Interventions", own.filter((k) => !sp[k].sampler && !sp[k].probe).map(strip)) +
      section("vau", "VAUs", groups.flatMap((g) => [g.title ? `<div class="br-sub" title="${esc(((Desk.VAU.collections || {})[g.c] || {}).what || "")}">${esc(g.title)}</div>` : groups.length > 1 ? `<div class="br-sub">No collection</div>` : ""].concat(Desk.byCategory(g.keys).map((k) => (typeof k === "object" ? `<div class="br-cat">${esc(k.title)}</div>` : strip(k))))), unitHead) +
      section("sampler", "Sampler", own.filter((k) => sp[k].sampler).map(strip)) +
      section("meters", "Meters", own.filter((k) => sp[k].probe).map(strip)) +
      section("dirs", "Directions", dirs.map((d) => item(d.name, `Direction ${d.name}${d.kind ? ` (${d.kind})` : ""}. Drop it on a Steer, Project out or Direction meter strip to use it there, or between strips for a new Steer`, { dir: d.name, lines: [`steer layer=6 dir=${d.name} scale=4`] }))) +
      section("chains", "Chains", chains.map((c, i) => item(c.name, `Chain ${c.name}: ${c.text.replace(/\n/g, " | ")}`, { lines: c.text.split("\n").filter((l) => l.trim()) },
        `<span class="br-x"><button data-load="${i}" title="Put this chain on the desk in place of the one there">Load</button><button data-rmchain="${i}" title="Forget this chain">✕</button></span>`)),
        `<button class="br-save" id="brsavechain" title="Keep the desk's chain here under a name">+ Save the desk's chain</button>`);
    filter();
  }
  function filter() {
    const q = $("#brsearch").value.trim().toLowerCase();
    $$(".br-item", body).forEach((it) => { it.hidden = !!q && !(it.textContent + " " + (it.dataset.info || it.title || "")).toLowerCase().includes(q); });
    if (q) $$("details", body).forEach((d) => { d.open = true; });
  }
  async function loadBrowserData() {
    try { dirs = (await api("/api/directions")).directions.filter((d) => !S.model || d.model === S.model.model_id || !d.model); } catch (e) { /* no model yet */ }
    try { runs = (await api("/api/runs")).runs; } catch (e) { runs = []; }
    renderBrowser();
  }
  $("#brsearch").addEventListener("input", filter);
  body.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.k) { openSecs[d.dataset.k] = d.open; store.set("brOpen", openSecs); } }, true);
  body.addEventListener("dragstart", (e) => {
    const it = e.target.closest(".br-item"); if (!it) return;
    const pay = JSON.parse(it.dataset.pay);
    if (!pay.lines) { e.preventDefault(); return; }
    e.dataTransfer.setData(Desk.MIME, JSON.stringify(pay));
    if (pay.dir) e.dataTransfer.setData(Desk.MIME + "-dir", "1");
    e.dataTransfer.effectAllowed = "copy";
  });
  const use = async (it) => {
    const pay = JSON.parse(it.dataset.pay);
    if (pay.open) {
      try { S.run = await api(`/api/runs/${encodeURIComponent(pay.open)}`); S.parent = S.run.id; restoreInputs(S.run.recipe); showRun(); setArea("arr"); }
      catch (err) { alert(err.message); }
    } else if (pay.lines) { setView("bench"); Desk.insertLines(pay.lines, Infinity); }
  };
  body.addEventListener("dblclick", (e) => { const it = e.target.closest(".br-item"); if (it && !e.target.closest("button")) use(it); });
  body.addEventListener("click", (e) => {
    const it = e.target.closest(".br-item");
    const ld = e.target.closest("[data-load]"), rm = e.target.closest("[data-rmchain]");
    if (ld) { const c = chains[+ld.dataset.load]; chainTA.value = c.text; chainTA.dispatchEvent(new Event("input", { bubbles: true })); Desk.render(); return; }
    if (rm) { const c = chains[+rm.dataset.rmchain]; if (confirm(`Forget the chain “${c.name}”?`)) { chains.splice(+rm.dataset.rmchain, 1); store.set("chains", chains); renderBrowser(); } return; }
    if (e.target.closest("#brsavechain")) { saveChain(); return; }
    if (e.target.closest("#brrescan")) {
      api("/api/units/rescan", {}).then(() => location.reload(), (err) => status(`Units: ${err.message}`));
      return;
    }
    if (it && JSON.parse(it.dataset.pay).open) use(it);
  });
  body.addEventListener("keydown", (e) => { const it = e.target.closest(".br-item"); if (it && e.key === "Enter") { e.preventDefault(); use(it); } });
  function saveChain() {
    const text = chainTA.value.trim();
    if (!text) return;
    const name = prompt("A name for this chain", chainName(text));
    if (name === null) return;
    chains.push({ name: name.trim() || chainName(text), text }); store.set("chains", chains);
    openSecs.chains = true; store.set("brOpen", openSecs);
    renderBrowser();
    window.onDeskNote?.(`Saved “${name.trim() || chainName(text)}” in the browser's Chains.`);
  }
  // ---------------------------------------------------------------- earlier prompts, in the Instrument
  // Each prompt that has been run, newest first, once each. Picking one puts it in the Instrument;
  // the chain, the sampler and the seed stay as they are.
  const pick = $("#promptpick");
  let pmenu = null;
  const ago = (s) => {
    const d = (Date.now() - new Date(s).getTime()) / 1000;
    return d < 90 ? "just now" : d < 5400 ? `${Math.round(d / 60)} min ago` : d < 129600 ? `${Math.round(d / 3600)} h ago` : `${Math.round(d / 86400)} days ago`;
  };
  function closePick() {
    if (!pmenu) return;
    pmenu.remove(); pmenu = null; pick.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", pickOutside, true);
  }
  const pickOutside = (e) => { if (pmenu && !pmenu.contains(e.target) && e.target !== pick) closePick(); };
  pick.addEventListener("click", () => {
    if (pmenu) { closePick(); return; }
    const seen = new Map();
    for (const r of runs) {                        // the list is newest first
      const k = r.prompt.trim();
      if (!k) continue;
      if (seen.has(k)) seen.get(k).n++; else seen.set(k, { text: r.prompt, when: r.created, n: 1 });
    }
    const list = [...seen.values()].slice(0, 40);
    pmenu = document.createElement("div");
    pmenu.className = "addmenu pmenu"; pmenu.setAttribute("role", "menu");
    pmenu.innerHTML = `<div class="am-where">Earlier prompts, newest first. The chain stays as it is.</div>` + (list.length
      ? list.map((p, i) => `<button role="menuitem" data-i="${i}"><b>${esc(p.text)}</b><span>${ago(p.when)}${p.n > 1 ? ` · ${p.n} runs` : ""}</span></button>`).join("")
      : `<div class="am-where">No runs yet.</div>`);
    pmenu.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]"); if (!b) return;
      const ta = $("#prompt");
      ta.value = list[+b.dataset.i].text;
      ta.dispatchEvent(new Event("input", { bubbles: true })); ta.dispatchEvent(new Event("change", { bubbles: true }));
      closePick(); ta.focus();
    });
    pmenu.addEventListener("keydown", (e) => {
      const bs = $$("button", pmenu), k = bs.indexOf(document.activeElement);
      if (e.key === "Escape") { e.preventDefault(); closePick(); pick.focus(); }
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && bs.length) { e.preventDefault(); bs[(k + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length].focus(); }
    });
    document.body.appendChild(pmenu);
    const r = pick.getBoundingClientRect(), m = pmenu.getBoundingClientRect();
    const top = r.bottom + 4 + m.height < innerHeight - 30 ? r.bottom + 4 : Math.max(8, r.top - 4 - m.height);
    Object.assign(pmenu.style, { left: `${Math.min(r.left, innerWidth - m.width - 8)}px`, top: `${top}px` });
    pick.setAttribute("aria-expanded", "true");
    (pmenu.querySelector("button") || pmenu).focus?.();
    document.addEventListener("pointerdown", pickOutside, true);
  });

  // folding the browser away, and back (Ctrl+Alt+B, as Live's Cmd+Alt+B)
  const fold = (f) => { br.classList.toggle("folded", f); store.set("brFolded", f); };
  fold(!!store.get("brFolded", false));
  $("#brfold").addEventListener("click", () => fold(true));
  $("#brrail").addEventListener("click", () => fold(false));
  document.addEventListener("keydown", (e) => {
    if (e.code === "KeyB" && e.altKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fold(!br.classList.contains("folded")); }
  });
  const prevOnJob = window.onJob;
  window.onJob = (e) => { prevOnJob(e); if (e.type === "end" && !qOn) loadBrowserData(); };

  renderBrowser();
  loadBrowserData();
  setArea(store.get("area", "arr"));
})();
