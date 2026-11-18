// Abliteration Lens. Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
//
// The intervention chain as a mixing desk: one channel strip per line, worked top to bottom
// (left to right on the desk). Adapted from Video Kintsugi's desk.js: the text in the chain
// box is the source of truth, and the desk reads it and writes it back. A line starting with
// # is bypassed.
"use strict";

const Desk = (() => {
  const P = (key, label, min, max, reset, o = {}) => ({ key, label, min, max, reset, ...o });
  const num = (v) => (Math.abs(v) >= 100 ? Math.round(v) : +(+v).toFixed(Math.abs(v) >= 10 ? 1 : 2));

  // What each strip shows. target: the target kinds it accepts. params: knobs (numbers),
  // selects (choices), texts (free text) and one fader (its main number).
  const SPECS = {
    ablate: { title: "Ablate", what: "Removes a component's output, or replaces it with its average",
      targets: ["head", "attn", "mlp", "block"], params: [P("mode", "Mode", 0, 0, "zero", { choices: ["zero", "mean"] })] },
    scale: { title: "Scale", what: "Multiplies a component's output, or the residual stream",
      targets: ["head", "attn", "mlp", "block", "layer"],
      params: [P("k", "k", -4, 4, 1, { fader: true, step: 0.05 })] },
    steer: { title: "Steer", what: "Adds scale × a direction to the residual stream", targets: ["layer"],
      params: [P("dir", "Direction", 0, 0, "", { direction: true }), P("scale", "Scale", -20, 20, 0, { fader: true, step: 0.1 })] },
    project: { title: "Project out", what: "Removes or reflects the stream's component along a direction", targets: ["layer"],
      params: [P("dir", "Direction", 0, 0, "", { direction: true }), P("mode", "Mode", 0, 0, "remove", { choices: ["remove", "reflect"] }),
               P("to", "To", 0, 0, "zero", { choices: ["zero", "mean"] }), P("k", "Directions", 1, 16, 1, { int: true })] },
    noise: { title: "Noise", what: "Gaussian noise, scaled to the stream's size", targets: ["layer"],
      params: [P("abs", "Absolute", 0, 1, 0, { toggle: true }), P("sigma", "Sigma", 0, 2, 0, { fader: true, step: 0.01 })] },
    coarsen: { title: "Coarsen", what: "Rounds one block's weights to fewer bits", targets: ["block"],
      params: [P("bits", "Bits", 0, 0, "8", { choices: ["8", "4", "3", "2"] })] },
    reorder: { title: "Reorder", what: "Skips, repeats or swaps blocks", targets: [],
      params: [P("skip", "Skip", 0, 0, "", { text: true, hint: "6 or 3-5" }), P("repeat", "Repeat", 0, 0, "", { text: true, hint: "5" }),
               P("swap", "Swap", 0, 0, "", { text: true, hint: "3,8" })] },
    transplant: { title: "Transplant", what: "The stream from a run on another prompt, put into this one", targets: ["layer"],
      params: [P("prompt", "From prompt", 0, 0, "", { text: true, wide: true }), P("at", "At", -64, 64, -1, { int: true }),
               P("from", "From", -64, 64, -1, { int: true })] },
    embed: { title: "Embedding bend", short: "Embed bend", what: "Swaps two tokens' embeddings, moves one toward the other, or adds noise to one", targets: [],
      params: [P("swap", "Swap", 0, 0, "", { text: true, hint: "\" not, also\"" }), P("mix", "Mix", 0, 1, 1, { step: 0.01 }), P("token", "Token", 0, 0, "", { text: true }),
               P("sigma", "Sigma", 0, 2, 0, { fader: true, step: 0.01 })] },
    vocoder: { title: "Vocoder", what: "Imposes another prompt's band levels on the stream being written", targets: ["layer"],
      params: [P("prompt", "Modulator", 0, 0, "", { text: true, wide: true, hint: "The storm broke over the sea" }), P("bands", "Bands", 2, 64, 16, { int: true }),
               P("mix", "Mix", 0, 1, 1, { fader: true, step: 0.01 })] },
    pan: { title: "Pan", what: "Biases where attention looks: toward the most recent tokens, or toward the start", targets: ["block"],
      params: [P("depth", "Depth", 0, 20, 4, { step: 0.5 }), P("pan", "Pan", -1, 1, 0, { fader: true, step: 0.01 })] },
    rewrite: { title: "Rewrite", what: "A rank-one MLP edit that makes the model write a target after a prompt (inspired by ROME)", targets: [],
      params: [P("block", "Block", 0, 47, 5, { int: true }), P("prompt", "Prompt", 0, 0, "", { text: true, wide: true, hint: "The Eiffel Tower is located in the city of" }),
               P("subject", "Subject", 0, 0, "", { text: true, hint: "Eiffel Tower" }), P("target", "Target", 0, 0, "", { text: true, hint: "\" Rome\"" }),
               P("save", "Save as patch", 0, 0, "", { text: true, hint: "a name" }), P("amount", "Amount", 0, 2, 1, { fader: true, step: 0.01 })] },
    patch: { title: "Patch", what: "Adds a saved set of weight changes for the run, and puts the weights back after", targets: [],
      params: [P("file", "File", 0, 0, "", { text: true, hint: "a name in data/patches" }), P("scale", "Scale", 0, 2, 1, { fader: true, step: 0.01 })] },
    position: { title: "Position bend", what: "Shifts, scrambles or freezes the position embeddings the model reads", targets: [],
      params: [P("mode", "Mode", 0, 0, "shift", { choices: ["shift", "scramble", "freeze"] }), P("seed", "Seed", 0, 9999, 0, { int: true }),
               P("k", "Positions", -512, 512, 0, { fader: true, int: true, step: 1 })] },
    exit: { title: "Exit", what: "Stops after a layer and writes from there through the final norm and output layer", targets: ["layer"], params: [] },
    token: { title: "Token", what: "Zeros a word's input embedding, or bans the model from writing it", targets: [],
      params: [P("word", "Word", 0, 0, "", { text: true, hint: "\" not, never\"" }), P("mode", "Mode", 0, 0, "zero", { choices: ["zero", "ban"] })] },
    // meters: they read the model and change nothing; a run fills them in
    tap: { title: "Tap", what: "The words the stream points to at this layer (the logit lens)", targets: ["layer"], params: [], probe: true },
    meter: { title: "Level meter", what: "The size of the stream at this layer, token by token", targets: ["layer"], params: [], probe: true },
    gauge: { title: "Direction meter", what: "How far the stream points along a direction", targets: ["layer"], probe: true,
      params: [P("dir", "Direction", 0, 0, "", { direction: true })] },
    scope: { title: "Attention scope", what: "Which earlier tokens one head looks at", targets: ["head"], params: [], probe: true },
    contrast: { title: "Contrast", what: "Divides the diverged model's next-token probabilities by the original's to a power", targets: [], sampler: true,
      params: [P("keep", "Keep", 0.001, 1, 0.1, { step: 0.01 }), P("alpha", "Alpha", 0, 3, 1, { fader: true, step: 0.05 })] },
    chorus: { title: "Chorus", what: "Writes with several detuned copies of the model, averaging their probabilities", targets: ["layer"], sampler: true,
      params: [P("voices", "Voices", 0, 8, 3, { int: true }), P("sigma", "Detune", 0, 1, 0.3, { fader: true, step: 0.01 })] },
    sample: { title: "Sampler bend", what: "Changes how the next token is chosen; the model is untouched", targets: [], sampler: true,
      params: [P("mode", "Mode", 0, 0, "ban-top", { choices: ["ban-top", "ceiling", "invert"] }), P("k", "Ban", 1, 20, 1, { int: true }),
               P("p", "Ceiling", 0.05, 1, 0.5, { fader: true, step: 0.01 })] },
  };
  const NEW_LINE = {
    ablate: "ablate head=5.1 mode=zero", scale: "scale mlp=6 k=0.5", steer: "steer layer=6 dir=negation scale=4",
    project: "project layer=all dir=negation mode=remove", noise: "noise layer=4 sigma=0.3", coarsen: "coarsen block=5 bits=4",
    reorder: "reorder skip=6", transplant: 'transplant layer=6 prompt="The worst thing about the city is" at=-1 from=-1',
    embed: 'embed swap=" not, also"', position: "position mode=shift k=200", exit: "exit layer=6",
    contrast: "contrast alpha=1 keep=0.1",
    vocoder: 'vocoder layer=6 prompt="The storm broke over the sea and the boats ran for the harbour" bands=16 mix=1', pan: "pan block=all depth=4 pan=0.5",
    rewrite: 'rewrite block=5 prompt="The Eiffel Tower is located in the city of" subject="Eiffel Tower" target=" Rome" amount=1', patch: "patch file=my-edit scale=1", chorus: "chorus layer=6 voices=3 sigma=0.3", token: 'token word=" not" mode=zero', sample: "sample mode=ban-top k=1",
    tap: "tap layer=6", meter: "meter layer=6", gauge: "gauge layer=6 dir=negation", scope: "scope head=5.1",
  };
  // Units (Vector Abliteration Units, VAU 1): every strip the server's catalogue holds that the
  // bench does not write itself. Each is built from its manifest (units.js, window.VAU).
  const VAU = window.VAU || { units: [], errors: [] };
  // The units in groups: one per collection, titled as VAU names it (Core Collection), then the units in
  // no collection, untitled. Within a group: effects, interventions, fitted units, meters, each by name.
  const CAT = { effect: 0, intervention: 1, fitted: 2, meter: 3 };
  const CAT_TITLE = { effect: "Effects", intervention: "Interventions", fitted: "Fitted", meter: "Meters" };
  // where in the model a unit acts (VAU's space: stream, hidden, component, weights, logits, conditioning), as a small tag
  const spaceTag = (k) => { const s = SPECS[k] && SPECS[k].unit && SPECS[k].unit.manifest.space; return s ? `<span class="vspace" title="Acts on: ${esc(s)}">${esc(s)}</span>` : ""; };
  // a group's keys with a small head wherever the category changes: [{cat, title}|key, ...]
  const byCategory = (keys) => { let last = null; return keys.flatMap((k) => { const c = SPECS[k].unit.manifest.category; const out = c !== last ? [{ cat: c, title: CAT_TITLE[c] || c }, k] : [k]; last = c; return out; }); };
  function vauGroups(keys) {
    const out = new Map();
    for (const k of keys) {
      const u = SPECS[k] && SPECS[k].unit; if (!u) continue;
      const c = u.manifest.collection || "";
      if (!out.has(c)) out.set(c, []);
      out.get(c).push(k);
    }
    const order = (k) => [CAT[SPECS[k].unit.manifest.category] ?? 9, SPECS[k].title];
    return [...out.entries()].sort(([a], [b]) => (a === "") - (b === "") || a.localeCompare(b))
      .map(([c, ks]) => ({ c, title: c ? ((VAU.collections || {})[c] || {}).title || c : "", keys: ks.sort((x, y) => { const [p, q] = [order(x), order(y)]; return p[0] - q[0] || p[1].localeCompare(q[1]); }) }));
  }
  for (const m of VAU.units) {
    SPECS[m.id] = {
      title: m.title, prefix: m.prefix || "", what: m.what, targets: m.targets,   // prefix: the collection's, shown before the name (vShrink); title: VAU's short name, which the Lens uses everywhere (vClamp)
      fx: m.category === "effect", fitted: m.category === "fitted", probe: m.category === "meter", sampler: m.category === "sampler",
      unit: { file: m.file, source: m.source, version: m.version, author: m.author, inspired: m.inspired_by, needs: m.needs, missing: m.missing || [], help: m.help,
              explain: !!m.explain, summary: m.summary || null, manifest: m },
      display: m.display,
      params: m.params.map((p) => P(p.key, p.label, p.min ?? 0, p.max ?? 0, p.default ?? (p.kind === "choice" ? p.choices[0] : ""), {
        fader: p.kind === "fader", step: p.step, int: p.kind === "int", choices: p.kind === "choice" ? p.choices.map(String) : undefined,
        direction: p.kind === "direction", text: p.kind === "text", toggle: p.kind === "toggle", hint: p.hint, tip: p.tip })),
    };
    if (m.example) NEW_LINE[m.id] = m.example;
  }
  // The host features (VAU's hostfx): wet, an envelope over the depth, keep size and a random
  // control, on every unit and on the bench's own stream strips; folded under "Host" on the strip.
  const HOSTFX = ((window.VAU || {}).host_params || []).map((p) => P(p.key, p.label, p.min ?? 0, p.max ?? 0,
    p.default ?? (p.kind === "choice" ? p.choices[0] : ""), { choices: p.kind === "choice" ? p.choices.map(String) : undefined,
      toggle: p.kind === "toggle", int: p.kind === "int", step: p.step, hostfx: true, tip: p.tip }));
  const OWN_HOST = new Set(["steer", "project", "noise"]);
  const hostOpen = new Set();
  const TARGET_HELP = { head: "layer.head, e.g. 5.1 or 5.*", attn: "block", mlp: "block", block: "block", layer: "0 (embeddings) to n, or all" };

  let ta, root, onChange, dirs = [];
  let lines = [];

  // ------------------------------------------------------------ reading and writing lines
  function split(body) {           // shell-like words, keeping quoted values
    const out = []; let cur = "", q = null, has = false;
    for (const ch of body) {
      if (q) { if (ch === q) q = null; else cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
      if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
      cur += ch;
    }
    if (cur || has) out.push(cur);
    return out;
  }
  const quote = (v) => (v === "" || /[\s"'#]/.test(v) ? '"' + v.replace(/"/g, "'") + '"' : v);

  function parse(raw) {
    let body = raw.trim(), on = true;
    const c = body.match(/^#\s*(.*)$/);
    if (c) { on = false; body = c[1].trim(); }
    if (!body) return { raw, strip: false };
    const words = split(body);
    const kind = (words[0] || "").toLowerCase();
    if (!SPECS[kind]) return { raw, strip: false };
    const args = [];
    for (const w of words.slice(1)) {
      const eq = w.indexOf("=");
      if (eq > 0) args.push([w.slice(0, eq).toLowerCase(), w.slice(eq + 1)]);
    }
    return { raw, strip: true, on, kind, spec: SPECS[kind], args };
  }
  function serialise(l) {
    return (l.on ? "" : "# ") + [l.kind, ...l.args.map(([k, v]) => `${k}=${quote(v)}`)].join(" ");
  }
  const get = (l, key) => { const a = l.args.find(([k]) => k === key); return a ? a[1] : undefined; };
  function set(l, key, v, rebuild) {
    const a = l.args.find(([k]) => k === key);
    if (v === "" || v === undefined) l.args = l.args.filter(([k]) => k !== key);
    else if (a) a[1] = String(v);
    else l.args.push([key, String(v)]);
    l.raw = serialise(l);
    commit(rebuild);
  }
  function setTarget(l, kind, value) {
    l.args = l.args.filter(([k]) => !["head", "attn", "mlp", "block", "layer"].includes(k));
    l.args.unshift([kind, value]);
    l.raw = serialise(l);
    commit(true);
  }
  function target(l) {
    for (const t of ["head", "attn", "mlp", "block", "layer"]) { const v = get(l, t); if (v !== undefined) return [t, v]; }
    return [l.spec.targets[0] || null, ""];
  }
  function commit(rebuild) {
    ta.value = lines.map((l) => l.raw).join("\n");
    onChange();
    if (rebuild) render();
  }

  // ------------------------------------------------------------ controls (from Kintsugi)
  const pos = (v, p) => (v - p.min) / (p.max - p.min);
  const val = (t, p) => p.min + t * (p.max - p.min);
  const rnd = (v, p) => (p.int ? Math.round(v) : p.step ? +(Math.round(v / p.step) * p.step).toFixed(3) : num(v));
  const value = (l, p) => { const s = get(l, p.key); const v = parseFloat(s); return s === undefined || isNaN(v) ? p.reset : v; };

  // A control's tip: a tiny label beside the control after a pause on it (its name and range), and
  // the label, the manifest's tip and the way to use it in the info bar. The full account of each
  // parameter is in the strip's (?) help.
  function withTip(el, p, how) {
    const range = !p.toggle && !p.choices && !p.text && !p.direction && p.max > p.min ? ` · ${num(p.min)} to ${num(p.max)}` : "";
    el.dataset.mini = `${p.label}${range}`;
    el.title = `${p.label}${p.tip ? `: ${p.tip}` : ""}.${how ? " " + how : ""}`;
    return el;
  }
  function knob(l, p) {
    const cur = () => (p.get ? p.get(l) : value(l, p)), put = (v) => (p.put ? p.put(l, v) : set(l, p.key, v));
    const show = (v) => (p.fmt ? p.fmt(v) : String(rnd(v, p)));
    const el = document.createElement("div");
    el.className = "knob";
    el.tabIndex = 0;
    withTip(el, p, "Drag up or right to turn it up (Shift for fine), scroll, or use the arrow keys. Double-click the knob to reset it, or the number to type a value.");
    el.innerHTML = `<div class="kl">${p.label}</div><svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="17" class="kbody" pathLength="100"/><path class="ktrack" pathLength="100"/><path class="karc"/><line x1="24" y1="24" x2="24" y2="11" class="kline"/></svg><div class="kv"></div>`;
    const arc = (t) => {
      const a0 = -135, a = a0 + 270 * t, r = 21;
      const pt = (d) => [24 + r * Math.sin(d * Math.PI / 180), 24 - r * Math.cos(d * Math.PI / 180)];
      const [x0, y0] = pt(a0), [x1, y1] = pt(a);
      return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    el.querySelector(".ktrack").setAttribute("d", arc(1));
    const paint = () => {
      const v = cur(), t = Math.min(1, Math.max(0, pos(v, p)));
      el.querySelector(".karc").setAttribute("d", arc(Math.max(t, 0.001)));
      el.querySelector(".kline").setAttribute("transform", `rotate(${-135 + 270 * t} 24 24)`);
      el.querySelector(".kv").textContent = show(v);
      el.setAttribute("role", "slider"); el.setAttribute("aria-label", p.label); el.setAttribute("aria-valuetext", show(v));
    };
    // The knob keeps its own unrounded position while it is turned, so that small movements
    // add up: rounding after every pointer event would hold a whole-number knob where it is.
    let acc = null, idle = null;
    const clamp = (x) => Math.min(1, Math.max(0, x));
    const nudge = (dt) => {
      if (acc === null) acc = clamp(pos(cur(), p));
      acc = clamp(acc + dt);
      const v = rnd(val(acc, p), p);
      if (v !== cur()) put(v);
      paint();
    };
    const step = (d) => {                 // the arrow keys: one whole step on an integer knob
      acc = null;
      const v = p.int ? Math.min(p.max, Math.max(p.min, Math.round(cur()) + d))
        : rnd(val(clamp(pos(cur(), p) + d * 0.025), p), p);
      put(v); paint();
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.focus();
      el.setPointerCapture(e.pointerId);
      acc = clamp(pos(cur(), p));
      let x = e.clientX, y = e.clientY;
      // up or right turns it up; 160 px is the whole range (Shift: 800 px)
      const move = (ev) => { nudge(((y - ev.clientY) + (ev.clientX - x)) / (ev.shiftKey ? 800 : 160)); x = ev.clientX; y = ev.clientY; };
      const up = () => { acc = null; el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
      el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    });
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      nudge(-e.deltaY / (e.shiftKey ? 3000 : 600));
      clearTimeout(idle); idle = setTimeout(() => { acc = null; }, 400);
    }, { passive: false });
    el.querySelector("svg").addEventListener("dblclick", () => { acc = null; put(p.reset); paint(); });
    el.querySelector(".kv").addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const v = prompt(`${p.label}${p.all !== undefined ? ` (${p.min} to ${p.all - 1}, or all)` : " (any number)"}`, show(cur()));
      if (v !== null && p.all !== undefined && v.trim().toLowerCase() === "all") { acc = null; put(p.all); paint(); }
      else if (v !== null && !isNaN(parseFloat(v))) { acc = null; put(p.int ? Math.round(parseFloat(v)) : parseFloat(v)); paint(); }
    });
    el.addEventListener("keydown", (e) => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (d) { e.preventDefault(); e.stopPropagation(); step(e.shiftKey && !p.int ? d / 5 : d); }
    });
    paint();
    return el;
  }

  function fader(l, p) {
    const el = document.createElement("div");
    el.className = "fader";
    el.innerHTML = `<div class="fv"></div><div class="fwell"><input type="range" min="0" max="1000" step="1" aria-label="${p.label}"></div><div class="fl">${p.label}</div>`;
    const input = el.querySelector("input");
    const paint = () => {
      const v = value(l, p);
      input.value = Math.round(Math.min(1, Math.max(0, pos(v, p))) * 1000);
      el.querySelector(".fv").textContent = String(rnd(v, p));
    };
    input.addEventListener("input", () => { set(l, p.key, rnd(val(input.value / 1000, p), p)); el.querySelector(".fv").textContent = String(value(l, p)); });
    input.addEventListener("dblclick", () => { set(l, p.key, p.reset); paint(); });
    el.querySelector(".fv").addEventListener("dblclick", () => {
      const v = prompt(`${p.label} (any number)`, String(value(l, p)));
      if (v !== null && !isNaN(parseFloat(v))) { set(l, p.key, parseFloat(v)); paint(); }
    });
    el.querySelector(".fv").title = "Double-click to type a value outside the fader's range";
    input.title = "Double-click resets";
    paint();
    return withTip(el, p, "Drag the cap, or use the arrow keys; double-click it to reset.");
  }

  function select(l, p, choices) {
    const s = document.createElement("select");
    s.className = "sel";
    s.setAttribute("aria-label", p.label);
    const cur = get(l, p.key) ?? String(p.reset);
    const opts = choices.includes(cur) || !cur ? choices : [cur, ...choices];
    s.innerHTML = opts.map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("");
    s.addEventListener("change", () => set(l, p.key, s.value, l.kind === "token"));   // a token ban is drawn as a sampler strip
    const wrap = document.createElement("label");
    wrap.className = "sl";
    wrap.innerHTML = `<span>${p.label}</span>`;
    wrap.appendChild(s);
    return withTip(wrap, p, "");
  }

  function text(l, p) {
    const wrap = document.createElement("label");
    wrap.className = "sl";
    wrap.innerHTML = `<span>${p.label}</span>`;
    const i = document.createElement("input");
    i.type = "text"; i.className = "rawargs"; i.spellcheck = false;
    i.value = get(l, p.key) ?? ""; i.placeholder = p.hint || "";
    i.addEventListener("change", () => set(l, p.key, i.value, true));
    wrap.appendChild(i);
    return withTip(wrap, p, "");
  }

  function toggle(l, p) {
    const b = document.createElement("button");
    b.className = "tg";
    const paint = () => { b.setAttribute("aria-pressed", value(l, p) ? "true" : "false"); b.innerHTML = `<i></i>${p.label}`; };
    b.addEventListener("click", () => { set(l, p.key, value(l, p) ? 0 : 1); paint(); });
    paint();
    return withTip(b, p, "Click to switch it.");
  }

  // The target: which component, then knobs for which one. A head is a layer knob and a head knob
  // (its top position is all heads, 5.*); a component (attn, mlp, block) is a layer knob over the
  // model's blocks; the residual stream is a layer knob from 0 (the embeddings) to the top. Each
  // layer knob's top position is all. The ranges come from the loaded model. A range or a list
  // (3-5, 1,4) stays as text.
  const TARGET_NAMES = { head: "Head", attn: "Attention", mlp: "MLP", block: "Block", layer: "Residual stream" };
  const DEFAULT_TARGET = { head: "5.1", attn: "5", mlp: "5", block: "5", layer: "6" };
  function targetBox(l) {
    const box = document.createElement("div");
    box.className = "tgt";
    const [t, v] = target(l);
    const s = document.createElement("select");
    s.className = "sel";
    s.setAttribute("aria-label", "Target");
    s.title = "What the strip acts on";
    s.innerHTML = l.spec.targets.map((x) => `<option value="${x}" ${x === t ? "selected" : ""}>${TARGET_NAMES[x] || x}</option>`).join("");
    s.addEventListener("change", () => setTarget(l, s.value, DEFAULT_TARGET[s.value] || "5"));
    box.appendChild(s);
    const L = dims.layers, H = dims.heads, sv = String(v ?? "").trim().toLowerCase();
    const top = t === "layer" ? L : L - 1;                       // the highest single layer for this target
    const knobs = document.createElement("div");
    knobs.className = "tknobs";
    // "all" is offered where the line accepts it: not for a head's layer (all.1 is not a head) or a meter (one layer)
    const layerKnob = (get, put, withAll) => knob(l, { key: t, label: t === "layer" ? "Layer" : "Block", min: 0, max: withAll ? top + 1 : top,
      all: withAll ? top + 1 : undefined, int: true, reset: Math.min(top, t === "layer" ? 6 : 5), get, put,
      tip: t === "layer" ? `the residual stream at layer l: 0 the embeddings, l the output of block l − 1${withAll ? "; top: all" : ""}`
        : t === "head" ? `block l, from 0${withAll ? "; top: every block" : ""}`
        : `block l's ${t === "attn" ? "attention" : t === "mlp" ? "MLP" : "whole"} output, from 0${withAll ? "; top: every block" : ""}`,
      fmt: (x) => (withAll && x >= top + 1 ? "all" : String(x)) });
    const hm = t === "head" && sv.match(/^(\d+)\.(\d+|\*)$/);
    if (hm) {
      const lay = () => { const m = String(get(l, "head")).match(/^(\d+|all)\.(\d+|\*)$/); return m ? (m[1] === "all" ? top + 1 : +m[1]) : 5; };
      const hd = () => { const m = String(get(l, "head")).match(/^(\d+|all)\.(\d+|\*)$/); return m ? (m[2] === "*" ? H : +m[2]) : 1; };
      const write = (a, b) => set(l, "head", `${a >= top + 1 ? "all" : a}.${b >= H ? "*" : b}`);
      knobs.appendChild(layerKnob(() => lay(), (_, x) => write(Math.min(x, top), hd()), false));
      knobs.appendChild(knob(l, { key: "head", label: "Head", min: 0, max: H, all: H, int: true, reset: 1,
        tip: "head h of the block, from 0: its slice of the attention output; top: every head",
        get: () => hd(), put: (_, x) => write(lay(), x), fmt: (x) => (x >= H ? "all" : String(x)) }));
    } else if (t && t !== "head" && /^(\d+|all|emb)$/.test(sv)) {
      const cur = () => { const x = String(get(l, t)).toLowerCase(); return x === "all" ? top + 1 : x === "emb" ? 0 : +x; };
      const withAll = !l.spec.probe;
      knobs.appendChild(layerKnob(() => Math.min(cur(), withAll ? top + 1 : top), (_, x) => set(l, t, withAll && x >= top + 1 ? "all" : String(x)), withAll));
    } else {                                                     // a range or a list: kept as text
      const i = document.createElement("input");
      i.type = "text"; i.className = "rawargs"; i.spellcheck = false; i.value = v ?? ""; i.title = TARGET_HELP[t] || "";
      i.placeholder = TARGET_HELP[t] || "";
      i.addEventListener("change", () => setTarget(l, s.value, i.value));
      knobs.appendChild(i);
    }
    box.appendChild(knobs);
    return box;
  }
  // The same target as a description of controls, for a unit's card, which VAU draws (VAU SPEC 5f)
  function targetControls(l) {
    const [t, v] = target(l), out = [];
    out.push({ key: "_target", label: "Target", kind: "choice", role: "target-menu", choices: l.spec.targets, labels: TARGET_NAMES, reset: l.spec.targets[0],
      tip: "what the strip acts on", get: () => target(l)[0], put: (x) => setTarget(l, x, DEFAULT_TARGET[x] || "5") });
    const L = dims.layers, H = dims.heads, sv = String(v ?? "").trim().toLowerCase();
    const top = t === "layer" ? L : L - 1;
    const layerCtl = (getv, put, withAll) => ({ key: t, label: t === "layer" ? "Layer" : "Block", kind: "int", role: "target", min: 0, max: withAll ? top + 1 : top,
      all: withAll ? top + 1 : undefined, int: true, reset: Math.min(top, t === "layer" ? 6 : 5), get: getv, put,
      tip: t === "layer" ? `the residual stream at layer l: 0 the embeddings, l the output of block l − 1${withAll ? "; top: all" : ""}`
        : t === "head" ? `block l, from 0${withAll ? "; top: every block" : ""}` : `block l's ${t === "attn" ? "attention" : t === "mlp" ? "MLP" : "whole"} output, from 0${withAll ? "; top: every block" : ""}`,
      fmt: (x) => (withAll && x >= top + 1 ? "all" : String(x)) });
    const hm = t === "head" && sv.match(/^(\d+)\.(\d+|\*)$/);
    if (hm) {
      const lay = () => { const m = String(get(l, "head")).match(/^(\d+|all)\.(\d+|\*)$/); return m ? (m[1] === "all" ? top + 1 : +m[1]) : 5; };
      const hd = () => { const m = String(get(l, "head")).match(/^(\d+|all)\.(\d+|\*)$/); return m ? (m[2] === "*" ? H : +m[2]) : 1; };
      const write = (a, b) => set(l, "head", `${a >= top + 1 ? "all" : a}.${b >= H ? "*" : b}`);
      out.push(layerCtl(() => lay(), (x) => write(Math.min(x, top), hd()), false));
      out.push({ key: "head", label: "Head", kind: "int", role: "target", min: 0, max: H, all: H, int: true, reset: 1,
        tip: "head h of the block, from 0: its slice of the attention output; top: every head", get: () => hd(), put: (x) => write(lay(), x), fmt: (x) => (x >= H ? "all" : String(x)) });
    } else if (t && t !== "head" && /^(\d+|all|emb)$/.test(sv)) {
      const cur = () => { const x = String(get(l, t)).toLowerCase(); return x === "all" ? top + 1 : x === "emb" ? 0 : +x; };
      const withAll = !l.spec.probe;
      out.push(layerCtl(() => Math.min(cur(), withAll ? top + 1 : top), (x) => set(l, t, withAll && x >= top + 1 ? "all" : String(x)), withAll));
    } else out.push({ key: t, label: TARGET_NAMES[t] || "Target", kind: "text", role: "target", hint: TARGET_HELP[t] || "", tip: TARGET_HELP[t] || "",
      get: () => v ?? "", put: (x) => setTarget(l, t, x) });
    return out;
  }
  // The host features as descriptions of controls, for a unit's card (the envelope's and the control's knobs only when they are on)
  function hostControls(l) {
    const env = get(l, "env") || "none", ctl = get(l, "control") || "none";
    return HOSTFX.filter((p) => !(["epeak", "ewidth", "eedge"].includes(p.key) && env === "none") && !(p.key === "cseed" && ctl === "none") && !(p.key === "control" && l.kind === "noise"))
      .map((p) => ({ key: p.key, label: p.label, kind: p.choices ? "choice" : p.toggle ? "toggle" : p.int ? "int" : "knob", role: "host",
        min: p.min, max: p.max, step: p.step, int: p.int, reset: p.reset, choices: p.choices, tip: p.tip,
        get: () => (p.choices ? (get(l, p.key) ?? String(p.reset)) : value(l, p)), put: (x) => set(l, p.key, x, !!p.choices) }));
  }
  let dims = { layers: 12, heads: 12 };                          // GPT-2 small until a model is loaded
  function setModel(m) {
    if (!m || (m.n_layers === dims.layers && m.n_heads === dims.heads)) return;
    dims = { layers: m.n_layers, heads: m.n_heads };
    render();
  }

  // long one-word titles break where a hyphen reads well (a soft hyphen shows only at a break)
  // Every strip's name is set at one size: the largest at which each fits on one line (from the
  // stylesheet's size down to 8px). A name too long for one line even at 8px wraps onto a second
  // line, never a third, and breaks only between its words: the size is also no larger than the one
  // at which its longest word fits.
  function fitNames(scope) {
    const els = [...(scope || root).querySelectorAll(".strip .stn")];
    const over = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width > el.getBoundingClientRect().width + 0.05; };
    els.forEach((el) => { el.style.fontSize = ""; el.classList.remove("two"); });
    if (!els.length) return;
    const top = parseFloat(getComputedStyle(els[0]).fontSize);
    const fits = (el, px) => { el.style.fontSize = px + "px"; return !over(el); };
    const wordsFit = (el, px) => {               // on two lines, does each word fit without breaking?
      el.style.fontSize = px + "px"; el.classList.add("two", "words");
      const ok = el.scrollWidth <= el.clientWidth + 0.5;
      el.classList.remove("two", "words"); return ok;
    };
    let size = top;
    for (const el of els) {                      // the largest size each name fits at, and the smallest of those
      let px = top;
      while (px > 8 && !fits(el, px)) px -= 0.5;
      if (fits(el, px)) { size = Math.min(size, px); continue; }
      px = top;                                  // too long for one line: two, broken between words
      while (px > 8 && !wordsFit(el, px)) px -= 0.5;
      if (wordsFit(el, px)) size = Math.min(size, px);
    }
    els.forEach((el) => { el.style.fontSize = size + "px"; if (over(el)) el.classList.add("two"); });
  }

  const nameOf = (spec) => (spec.prefix || "") + spec.title;   // a unit's name with its collection's prefix: vShrink
  function strip(l, i, n) {
    const s = document.createElement("div");
    const sampler = l.spec.sampler || (l.kind === "token" && get(l, "mode") === "ban");
    const coll = l.spec.unit && l.spec.unit.manifest.collection;
    s.className = "strip" + (l.on ? "" : " off") + (sampler ? " sampler" : "") + (l.spec.probe ? " probe" : "") + (l.spec.unit ? " vau-strip" : "") + (l.spec.unit && l.spec.unit.source !== "builtin" ? " ext" : "");
    const tint = l.spec.unit && l.spec.unit.manifest.tint;   // the unit's own colour, from its collection's interface (VAU SPEC 5d): it shows through the top bar's glass
    if (tint && /^#[0-9a-f]{6}$/i.test(tint)) { s.classList.add("tinted"); s.style.setProperty("--vu-tint", tint); }
    s.dataset.i = i;
    s.dataset.info = `${nameOf(l.spec)}: ${l.spec.what}.`;
    const lit = !l.spec.probe && !sampler;          // strips that change the model have an activity light
    s.innerHTML = `<div class="sh"><button class="led" aria-pressed="${l.on}" title="${l.on ? "On: click to bypass this strip" : "Bypassed: click to switch it on"}"></button><span class="sn grip" tabindex="0" role="button" aria-label="Move strip ${n}" title="Strip ${n}. Drag the header to move it along the chain; with the number focused, the left and right arrow keys move it.">${n}</span><span class="st"><span class="stn">${l.spec.prefix ? `<i class="vpre">${esc(l.spec.prefix)}</i>` : ""}${esc(l.spec.short || l.spec.title)}</span><button class="qhelp" type="button" aria-label="Help: ${esc(l.spec.title)}" data-info="Help: what ${esc(l.spec.title)} does, its parameters, and a figure of how it works.">?</button>${l.spec.probe ? `<span class="meterbadge" data-info="A meter: it reads the model and leaves it unchanged, so the diverged text is the same with it or without it.">meter</span>` : ""}</span>${lit ? `<span class="aled" tabindex="0" role="img" aria-label="Activity"><i></i><i></i><i></i><i></i></span>` : ""}</div>
      ${l.spec.unit ? `<div class="vau-card${coll ? ` vau-${coll}` : ""}"><div class="sk"></div></div>` : `<div class="sk"></div>`}`;   // a unit's controls on its card, in its collection's look (vau/look/<collection>.css); the top line is the desk's
    s.querySelector(".led").addEventListener("click", () => { l.on = !l.on; l.raw = serialise(l); commit(true); });
    s.querySelector(".sh").addEventListener("pointerdown", (e) => { if (e.button === 0 && !e.target.closest(".led, .aled, .qhelp")) drag(s, i, e); });
    s.querySelector(".qhelp").addEventListener("click", (e) => {
      e.stopPropagation();
      if (l.spec.unit) Boxes.unitHelp(l.spec.unit.manifest, e.currentTarget);
      else Boxes.stripHelp(l.kind, e.currentTarget);      // the Lens's own strips: the same card, made from the desk's description
    });
    s.querySelector(".grip").addEventListener("keydown", (e) => {
      const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const to = moveBy(i, d);
      if (to !== null) root.querySelector(`.strip[data-i="${to}"] .grip`)?.focus();
    });
    const card = s.querySelector(".vau-card");
    if (card && window.VAUCard) {                    // a unit: VAU draws its card (VAU SPEC 5f); the desk gives it the line, the model's ranges and its own controls
      const sc = l.spec.probe ? Object.assign(document.createElement("div"), { className: "screen" }) : null;
      const VC = (window.VAU || {}).collections || {};
      window.VAUCard.mount(card, { unit: l.spec.unit.manifest, iface: coll && VC[coll] ? VC[coll].interface : null,
        get: (k) => get(l, k), set: (k, v, rebuild) => set(l, k, v, rebuild), directions: dirs,
        target: l.spec.targets.length ? targetControls(l) : [], host: takesHost(l) ? hostControls(l) : [],
        hostOpen: hostOpen.has(i), onHost: (open) => { if (open) hostOpen.add(i); else hostOpen.delete(i); requestAnimationFrame(fit); },
        screen: sc, tip: (el, c, how) => withTip(el, { ...c, toggle: c.kind === "toggle", text: c.kind === "text" }, how) });
      if (sc) paintScreen(sc, l, i);
    } else {
      const knobs = s.querySelector(".sk");
      if (sampler) knobs.appendChild(Object.assign(document.createElement("div"), { className: "badge", textContent: "sampler level" }));
      if (l.spec.targets.length) knobs.appendChild(targetBox(l));
      let fp = null, row = null;
      for (const p of l.spec.params) {
        if (p.fader) { fp = p; continue; }
        if (p.choices) { row = null; knobs.appendChild(select(l, p, p.choices)); }
        else if (p.direction) { row = null; knobs.appendChild(select(l, p, dirs.length ? dirs : ["(none yet)"])); }
        else if (p.text) { row = null; knobs.appendChild(text(l, p)); }
        else if (p.toggle) { row = null; knobs.appendChild(toggle(l, p)); }
        else {                                           // knobs sit two to a row
          if (!row || row.children.length >= 2) { row = document.createElement("div"); row.className = "krow"; knobs.appendChild(row); }
          row.appendChild(knob(l, p));
        }
      }
      if (takesHost(l)) knobs.appendChild(hostBox(l, i));
      // keep any parameters the desk has no control for (for example seed=), shown as text
      const known = new Set([...l.spec.params.map((p) => p.key), ...HOSTFX.map((p) => p.key), "head", "attn", "mlp", "block", "layer"]);
      for (const [k, v] of l.args) if (!known.has(k)) knobs.appendChild(text(l, { key: k, label: k }));
      if (l.spec.probe) { const sc = document.createElement("div"); sc.className = "screen"; s.appendChild(sc); paintScreen(sc, l, i); }
      else if (fp) s.appendChild(fader(l, fp));
      else s.appendChild(Object.assign(document.createElement("div"), { className: "nofader" }));
    }
    // a click selects the strip (as a device in Live); Delete or Backspace then removes it
    if (i === selected) s.classList.add("sel");
    s.tabIndex = -1;
    s.addEventListener("pointerdown", (e) => {
      pick(i);
      if (!e.target.closest("input, select, textarea, button, .knob, .grip, [tabindex]:not(.strip)")) s.focus({ preventScroll: true });
    });
    if (lit) { const m = s.querySelector(".aled"); paintAct(m, l, i); wireDive(m); }
    const lo = loo && loo.text === ta.value && loo.by[i];
    if (lo) {
      const d = document.createElement("div");
      d.className = "loo"; d.style.setProperty("--v", Math.min(1, lo.edit));
      d.innerHTML = `<i></i><span>${lo.edit.toFixed(2)}</span>`;
      d.dataset.info = `Leave one out: ${lo.edit.toFixed(2)}. Without this strip the diverged text ${lo.parts < 0 ? "is the same" : `parts from the whole chain's at token ${lo.parts + 1}, word edit distance ${lo.edit.toFixed(2)}`}. 0 means the strip makes no difference to the text; 1 means nothing is left in common.`;
      s.insertBefore(d, s.querySelector(".vau-card") || s.querySelector(".sk"));
    }
    return s;
  }

  // ------------------------------------------------------------ the meters' screens
  // A run fills the meters: for each, a reading at every step of each text. Step j is the
  // forward pass that chose token j: it reads the token before it and writes token j. One
  // step is shown on every meter at once; ◀ ▶ on any meter, or a click on a token in the
  // Tokens view, moves it. It starts at the point where the texts part.
  let run = null, step = null;
  const q = (s) => esc(JSON.stringify(s));
  function reading(l, i) {
    const P = run && run.probes;
    if (!P) return null;
    const want = { ...Object.fromEntries(l.args) };
    return P.strips.find((m) => m.line === i + 1 && m.kind === l.kind &&
      ["layer", "head", "dir"].every((k) => String(m.params[k] ?? "") === String(want[k] ?? ""))) || null;
  }
  const steps = () => Math.max(run.baseline.tokens.length, run.bent.tokens.length);
  function curStep() {
    const n = steps();
    if (step === null) step = run.divergence ? run.divergence.index : 0;
    return Math.min(Math.max(0, step), n - 1);
  }
  function spark(series, j, opts = {}) {      // two lines over the steps: baseline grey, bent gold (a unit's screen: --vu-screen-*); the shown step marked
    const W = 196, H = 34, n = Math.max(...series.map((s) => s.length), 1);
    const all = series.flat().filter((v) => v !== null && Number.isFinite(v));
    let lo = Math.min(...all, opts.zero ? 0 : Infinity), hi = Math.max(...all, opts.zero ? 0 : -Infinity);
    if (!(hi > lo)) { hi = lo + 1; }
    const x = (k) => (n === 1 ? W / 2 : (k / (n - 1)) * (W - 4) + 2), y = (v) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
    const line = (s, c) => `<polyline fill="none" style="stroke: ${c}" stroke-width="1.4" points="${s.map((v, k) => (v === null ? "" : `${x(k).toFixed(1)},${y(v).toFixed(1)}`)).join(" ")}"/>`;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" data-n="${n}">` +
      (opts.zero && lo < 0 && hi > 0 ? `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" style="stroke: var(--vu-screen-rule, #3a3f4a)"/>` : "") +
      `<line x1="${x(j)}" x2="${x(j)}" y1="0" y2="${H}" style="stroke: var(--vu-screen-rule, #5a606d)"/>` +
      line(series[0], "var(--vu-screen-bar, #8a8f9b)") + line(series[1], "var(--vu-screen-hot, var(--gold))") + `</svg>`;
  }
  function rows(list, max) {                   // label, bar, number
    return list.map(([t, v, txt, hot]) => `<div class="pr${hot ? " hot" : ""}"><span class="pt">${t}</span><span class="pb"><i style="width:${Math.max(1, Math.min(100, (v / (max || 1)) * 100))}%"></i></span><span class="pv">${txt}</span></div>`).join("");
  }
  const fmtv = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  function paintScreen(sc, l, i) {
    const m = reading(l, i);
    if (!l.on) { sc.innerHTML = `<div class="pempty">Bypassed</div>`; return; }
    if (!m) { sc.innerHTML = `<div class="pempty">${run ? "Run again to fill this meter" : "A run fills this meter"}</div>`; return; }
    const j = curStep(), n = steps(), P = run.probes, n0 = P.n_prompt;
    const side = (s) => {
      const ctx = P.context[s], r = m[s][j];
      if (!r) return `<div class="pside ${s}"><div class="ph">${s === "bent" ? "Diverged" : "Original"}</div><div class="pempty">ended</div></div>`;
      const head = `<div class="ph">${s === "bent" ? "Diverged" : "Original"} <span>${q(ctx[n0 - 1 + j])} → ${q(ctx[n0 + j])}</span></div>`;
      let body = "";
      if (l.kind === "tap") {
        body = rows(r.top.slice(0, 4).map(([t, lp]) => [q(t), Math.exp(lp), Math.exp(lp).toFixed(2), t === ctx[n0 + j]]), 1) +
          `<div class="pnote">${q(ctx[n0 + j])} is rank ${r.rank} here (${Math.exp(r.lp).toFixed(3)})</div>`;
      } else if (l.kind === "meter") {
        const mx = Math.max(...m.baseline.map((x) => x.norm), ...m.bent.map((x) => x.norm));
        body = rows([["size", r.norm, r.norm.toFixed(1)]], mx);
      } else if (l.kind === "gauge") {
        const mx = Math.max(...m.baseline.map((x) => Math.abs(x.proj)), ...m.bent.map((x) => Math.abs(x.proj)), 1e-9);
        const w = (Math.abs(r.proj) / mx) * 50;
        body = `<div class="pr"><span class="pt">along</span><span class="pb centre"><i style="left:${r.proj < 0 ? 50 - w : 50}%;width:${w}%"></i></span><span class="pv">${r.proj.toFixed(1)}</span></div>
          <div class="pnote">cosine ${r.cos.toFixed(2)}</div>`;
      } else if (l.spec.display && l.spec.display.kind === "series") {   // a meter unit: one number per step
        const vals = [...m.baseline, ...m.bent].map((x) => Math.abs(x.value)), mx = Math.max(...vals, 1e-9);
        body = rows([[esc(l.spec.display.unit || ""), Math.abs(r.value), fmtv(r.value)]], mx);
      } else if (l.spec.display && l.spec.display.kind === "words") {    // a meter unit: ranked words per step
        const mx = Math.max(...r.top.map((x) => Math.abs(x[1])), 1e-9);
        body = rows(r.top.slice(0, 4).map(([t, v]) => [q(t), Math.abs(v), fmtv(v)]), mx);
      } else if (l.kind === "scope") {
        const top = r.w.map((w, k) => [k, w]).sort((a, b) => b[1] - a[1]).slice(0, 4);
        body = rows(top.map(([k, w]) => [q(ctx[k]) + `<sub>${k < n0 ? "p" : ""}${k < n0 ? k + 1 : k - n0 + 1}</sub>`, w, w.toFixed(2)]), 1);
      }
      return `<div class="pside ${s}">${head}${body}</div>`;
    };
    let sp = "";
    if (l.kind === "tap") sp = spark([m.baseline.map((r) => Math.exp(r.lp)), m.bent.map((r) => Math.exp(r.lp))], j);
    else if (l.kind === "meter") sp = spark([m.baseline.map((r) => r.norm), m.bent.map((r) => r.norm)], j);
    else if (l.kind === "gauge") sp = spark([m.baseline.map((r) => r.proj), m.bent.map((r) => r.proj)], j, { zero: true });
    else if (l.spec.display && l.spec.display.kind === "series") sp = spark([m.baseline.map((r) => r.value), m.bent.map((r) => r.value)], j, { zero: true });
    const what = l.spec.display ? `${l.spec.display.label || ""}, each step` : { tap: "p of the word written, each step", meter: "size, each step", gauge: "along the direction, each step", scope: "" }[l.kind];
    let nd = "";
    if (l.spec.unit && l.spec.display && l.spec.display.kind === "series") {    // drawn only where the unit's look shows .needle
      const mx = Math.max(...[...m.baseline, ...m.bent].map((x) => Math.abs(x.value)), 1e-9) / 0.85, at = (r) => (r ? Math.abs(r.value) / mx : null);
      nd = window.VAUCard ? `<div class="needle">${window.VAUCard.needle(at(m.baseline[j]), at(m.bent[j]), l.spec.display.unit)}</div>` : "";   // VAU's meter-1, where the look shows needles
    }
    sc.innerHTML = `<div class="pnav"><button data-d="-1" title="Previous step">◀</button><span title="Step ${j + 1}: the pass that wrote token ${j + 1}">step ${j + 1}/${n}</span><button data-d="1" title="Next step">▶</button></div>` + nd +
      side("bent") + side("baseline") + (sp ? `<div class="psp" title="Click to choose a step">${sp}<div class="pnote">${what}</div></div>` : "");
    sc.querySelector(".pnav").addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (b) setStep(curStep() + +b.dataset.d); });
    sc.querySelector(".spark")?.addEventListener("click", (e) => {
      const r = e.currentTarget.getBoundingClientRect(), k = Math.round(((e.clientX - r.left) / r.width) * (+e.currentTarget.dataset.n - 1));
      setStep(k);
    });
  }
  // ------------------------------------------------------------ each strip's activity meter
  // How much the strip changed what it touched at the shown step (the size of the change over
  // the size of the tensor it acted on), measured in the same pass that fills the meters. The
  // bar is full at 100%; the light at its top shows a change larger than what it changed.
  function effectOf(l, i) {
    const E = run && run.probes && run.probes.effects;
    return (E && E.find((e) => e.line === i + 1 && e.kind === l.kind)) || null;
  }
  // the light: off (nothing changed at this step), green (under 25% of what it touched), orange (up to
  // 100%), red (more than 100%: a change larger than what it changed, as a reflection or a strong steer)
  const level = (v) => (v < 0.005 ? "off" : v < 0.25 ? "g" : v <= 1 ? "o" : "r");
  const bars = (v) => (v < 0.005 ? 0 : v < 0.1 ? 1 : v < 0.25 ? 2 : v <= 1 ? 3 : 4);   // the meter's lit bars
  const pct = (v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
  function paintAct(m, l, i) {
    const e = l.on ? effectOf(l, i) : null;
    if (!e) { m.className = "aled idle"; m.setAttribute("aria-label", "Activity: not measured"); return; }
    const j = curStep(), v = e.effect[Math.min(j, e.effect.length - 1)] ?? 0;
    m.className = `aled ${level(v)} n${bars(v)}`;
    m.setAttribute("aria-label", `Activity at step ${j + 1}: ${pct(v)}. Click to pin its box open.`);
    if (dive && dive.owner === m) diveFill(m);
  }
  // what the change is measured on, for each kind of strip
  function touched(l) {
    const t = ["head", "attn", "mlp", "block", "layer"].find((k) => get(l, k) !== undefined), v = t ? get(l, t) : "";
    if (l.kind === "embed" || l.kind === "token") return "the input embeddings";
    if (t === "head") return `the outputs of heads ${v} as they enter the attention output projection`;
    if (t === "attn") return `the attention output of block ${v}`;
    if (t === "mlp") return `the MLP output of block ${v}`;
    if (t === "block") return `the output of block ${v}`;
    if (t === "layer") return String(v).toLowerCase() === "all" || /[,-]/.test(String(v).slice(1)) ? `the residual stream at layers ${v}, averaged over them` : `the residual stream at layer ${v}`;
    return "what it acts on";
  }
  // what a unit suggests its summary reads (VAU SPEC 5e): one of the measures the run took, at the shown step and on average
  function suggested(l, e, j) {
    const sg = l.spec.unit && l.spec.unit.summary;
    if (!sg) return "";
    const S = sg.reads === "change" ? e.effect : e.measures && e.measures[sg.reads];
    if (!S || !S.length) return "";
    const f = { change: (x) => pct(x), touched: (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`, gain: (x) => `${x > 0 ? "+" : ""}${x.toFixed(1)} dB`, turn: (x) => `${x.toFixed(1)}°` }[sg.reads];
    const k = Math.min(j, S.length - 1), avg = S.reduce((a, b) => a + b, 0) / S.length;
    return `<div class="dv-sum"><span>${esc(sg.label)}</span> <b>${f(S[k])}</b> <small>at step ${k + 1}; ${f(avg)} on average</small></div>`;
  }
  // the deep dive: a box beside the light with the strip's activity over every step
  let dive = null;
  function diveFill(m, box = dive) {
    if (m.classList.contains("master")) { masterFill(box); return; }
    const s = m.closest(".strip"), i = +s.dataset.i, l = lines[i];
    const e = l && l.on ? effectOf(l, i) : null;
    if (!e) {
      box.innerHTML = `<b>${esc(l ? nameOf(l.spec) : "")}: activity</b><p>${!l || !l.on ? "Bypassed: it changes nothing." : !run ? "A run measures how much this strip changes what it touches, step by step, and lights this up."
        : ["coarsen", "reorder"].includes(l.kind) ? "This strip changes weights or the order of layers, which leaves no single change to measure." : "Run again to measure this strip: the chain has changed since the last run."}</p>`;
      return;
    }
    const E = e.effect, n = E.length, j = Math.min(curStep(), n - 1), v = E[j];
    const mean = E.reduce((x, y) => x + y, 0) / n, peak = E.indexOf(Math.max(...E)), acted = E.filter((x) => x >= 0.005).length;
    const W = 236, Hh = 54, mx = Math.max(1.05, ...E), y = (x) => Hh - 3 - (x / mx) * (Hh - 6), X = (k) => (n === 1 ? W / 2 : 2 + (k / (n - 1)) * (W - 4));
    const bars = E.map((x, k) => `<rect x="${(X(k) - Math.max(1, (W - 4) / n / 2 - 0.5)).toFixed(1)}" y="${y(x).toFixed(1)}" width="${Math.max(1.5, (W - 4) / n - 1).toFixed(1)}" height="${(Hh - 3 - y(x)).toFixed(1)}" class="${level(x)}"/>`).join("");
    const lo = loo && loo.text === ta.value && loo.by[i];
    const rp = run.repair && run.repair.find((x) => x.line === i + 1 && x.kind === l.kind);
    const rdb = rp && rp.repair_vb !== null && rp.repair_vb !== undefined ? rp.repair_vb : null;
    const rpNote = rdb === null ? "" : `<p class="dv-unit">Self-repair: on its own, its change carried straight to the output would read ${rp.direct} DUFS; through the rest of the model it reads ${rp.total} DUFS, ${rdb < 0 ? `${Math.abs(rdb).toFixed(1)} vB quieter: the layers after it damp it` : rdb > 0 ? `${rdb.toFixed(1)} vB louder: most of its effect runs through the layers after it` : "the same"}${rp.places > 1 ? ` (${rp.places} places added: approximate)` : ""}. Read on the original text.</p>`;
    box.innerHTML = `<b>${esc(nameOf(l.spec))}: activity</b>
      <div class="dv-big"><span class="dv-dot ${level(v)}"></span>${pct(v)} <small>at step ${j + 1} of ${n}</small></div>${suggested(l, e, j)}
      <svg viewBox="0 0 ${W} ${Hh}" class="dv-chart" aria-hidden="true"><line x1="0" x2="${W}" y1="${y(1)}" y2="${y(1)}" class="dv-100"/><line x1="0" x2="${W}" y1="${y(0.25)}" y2="${y(0.25)}" class="dv-25"/>${bars}<line x1="${X(j)}" x2="${X(j)}" y1="0" y2="${Hh}" class="dv-ph"/></svg>
      <div class="dv-axis"><span>step 1</span><span>dotted: 25% and 100%</span><span>${n}</span></div>
      <dl><dt>Average</dt><dd>${pct(mean)}</dd><dt>Peak</dt><dd>${pct(E[peak])} at step ${peak + 1}</dd><dt>Acted at</dt><dd>${acted} of ${n} steps</dd>
      ${lo ? `<dt>Without it</dt><dd>${lo.parts < 0 ? "the same text" : `parts at token ${lo.parts + 1}, distance ${lo.edit.toFixed(2)}`}</dd>` : ""}</dl>
      <p>The size of the strip's change over the size of ${esc(touched(l))}, at each step of the diverged text. Green is under 25%, orange up to 100%, red more: a change larger than what it changed.</p>${rpNote}`;
  }
  function place(box, m) {                          // beside the light, kept inside the window
    const r = m.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    let x = r.right + 10, yy = r.top - 8;
    if (x + w > innerWidth - 8) x = r.left - w - 10;
    if (yy + h > innerHeight - 34) yy = Math.max(8, innerHeight - 34 - h);
    Object.assign(box.style, { left: `${Math.max(8, x)}px`, top: `${yy}px` });
  }
  // A click on an activity meter pins its box open: it stays beside the strip, follows the playhead
  // and the desk's scrolling, and is drawn in a snap. A click on the meter again, or the box's ✕,
  // closes it. Pins are kept by line; one whose line now holds another kind of strip is dropped.
  const pins = new Map();           // line index -> {kind, box}
  function pinFor(i) {
    const s = root.querySelector(`.strip[data-i="${i}"]`);
    return s && s.querySelector(".aled");
  }
  // A pinned box opens in the desk beside its strip, pushing the later strips along (as an expanded
  // device in Live), so it covers nothing; it follows the playhead and is drawn in a snap.
  function placePins() {
    for (const [i, p] of pins) {
      const m = pinFor(i), l = lines[i];
      if (!l || l.kind !== p.kind) { if (p.box) p.box.remove(); pins.delete(i); continue; }
      if (m && p.box) diveFill(m, p.box.querySelector(".dv-body"));
    }
  }
  function pinBox(i) {
    const box = document.createElement("div");
    box.className = "dive pinned inline";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", `Activity of strip ${i + 1}, pinned`);
    box.innerHTML = `<button class="dv-x" title="Unpin this box" aria-label="Unpin this box">✕</button><div class="dv-body"></div>`;
    box.querySelector(".dv-x").addEventListener("click", () => togglePin(i));
    pins.get(i).box = box;
    return box;
  }
  function togglePin(i) {
    if (pins.has(i)) pins.delete(i);
    else pins.set(i, { kind: lines[i].kind, box: null });
    if (dive) { dive.hidden = true; dive.owner = null; }
    render();
    const s = root.querySelector(`.strip[data-i="${i}"]`);
    const box = pins.has(i) && pins.get(i).box;
    if (box) box.scrollIntoView({ block: "nearest", inline: "nearest" });
    else if (s) s.querySelector(".aled")?.focus({ preventScroll: true });
  }
  function wireDive(m) {
    const pinned = () => { const s = m.closest(".strip"); return s && pins.has(+s.dataset.i) && m.classList.contains("aled"); };
    const show = () => {
      if (pinned()) return;
      if (!dive) { dive = document.createElement("div"); dive.className = "dive"; dive.setAttribute("role", "tooltip"); document.body.appendChild(dive); }
      dive.owner = m; diveFill(m); dive.hidden = false;
      place(dive, m);
    };
    const hide = () => { if (dive && dive.owner === m) { dive.hidden = true; dive.owner = null; } };
    m.addEventListener("mouseenter", show); m.addEventListener("focus", show);
    m.addEventListener("pointerdown", hide);
    m.addEventListener("mouseleave", hide); m.addEventListener("blur", hide);
    if (m.classList.contains("aled")) {
      m.addEventListener("click", (e) => { e.stopPropagation(); togglePin(+m.closest(".strip").dataset.i); });
      m.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePin(+m.closest(".strip").dataset.i); } });
    }
  }
  // ------------------------------------------------------------ the master meter: loudness at the output
  // How far the chain moves the next-token distribution, in DUFS (backend/abliteration/loudness.py),
  // read on the original text: the bar is the momentary reading at the shown step, the white line
  // the short-term reading, the red tick the peak, the number the integrated reading.
  const LO = -60;
  const lvl = (v) => (v === null || v === undefined ? 0 : Math.max(0, Math.min(100, ((v - LO) / -LO) * 100)));
  const band = (v) => (v === null || v === undefined || v <= LO ? "" : v >= -12 ? "r" : v >= -30 ? "o" : "g");
  const db = (v) => (v === null || v === undefined || v <= -99 ? "silent" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`);
  function master() {
    const m = document.createElement("div");
    m.className = "master";
    m.tabIndex = 0;
    m.setAttribute("aria-label", "Loudness at the output, in DUFS");
    m.innerHTML = `<span class="mh">OUT</span><div class="mm"><i class="mo"></i><i class="ms"></i><b class="mp"></b></div><span class="mi">–</span><span class="mu">DUFS</span>`;
    wireDive(m);
    paintMaster(m);
    return m;
  }
  function paintMaster(m = root && root.querySelector(".master")) {
    if (!m) return;
    const o = run && run.loudness && run.loudness.original;
    const j = run ? curStep() : 0;
    const mom = o ? o.momentary[Math.min(j, o.momentary.length - 1)] : null, sh = o ? o.short[Math.min(j, o.short.length - 1)] : null;
    const mo = m.querySelector(".mo"), ms = m.querySelector(".ms"), mp = m.querySelector(".mp");
    mo.style.height = `${lvl(mom)}%`;
    mo.className = "mo " + band(mom);
    ms.style.bottom = `${lvl(sh)}%`; ms.hidden = !o;
    mp.style.bottom = `${lvl(o && o.peak)}%`; mp.hidden = !o;
    m.querySelector(".mi").textContent = !run ? "–" : o ? db(o.integrated) : "silent";
    m.classList.toggle("live", !!o);
  }
  function masterFill(box) {
    const L = run && run.loudness;
    const intro = `<b>Loudness</b><p class="dv-what">How far the chain moves the model's next-token distribution, read at the output: at each step, the KL divergence of the diverged model's distribution from the original's, on the same text, in bits, put in decibels against full scale (DUFS: log2 of the vocabulary${L ? `, ${L.full_scale_bits.toFixed(1)} bits` : ""}). Sampler bends are not counted.</p>`;
    if (!run) { box.innerHTML = intro + "<p>Run the pair to measure.</p>"; return; }
    if (!L) { box.innerHTML = intro + "<p>No strip changes the model, so the two distributions are the same: silent.</p>"; return; }
    const j = curStep(), o = L.original, d = L.diverged;
    const at = (x) => x.momentary[Math.min(j, x.momentary.length - 1)];
    const row = (t, a, b) => `<tr><td>${t}</td><td>${a}</td><td>${b}</td></tr>`;
    const series = [o.momentary.map((v) => Math.max(LO, v)), d.momentary.map((v) => Math.max(LO, v))];
    box.innerHTML = intro + `<table class="dv-loud"><tr><th></th><th>Original text</th><th>Diverged text</th></tr>` +
      row("Integrated", db(o.integrated), db(d.integrated)) +
      row("Range", o.range === null ? "–" : `${o.range.toFixed(1)} vB`, d.range === null ? "–" : `${d.range.toFixed(1)} vB`) +
      row("Peak", `${db(o.peak)} (step ${o.peak_step + 1})`, `${db(d.peak)} (step ${d.peak_step + 1})`) +
      row(`Step ${j + 1}`, `${db(at(o))}, short ${db(o.short[Math.min(j, o.short.length - 1)])}`, `${db(at(d))}, short ${db(d.short[Math.min(j, d.short.length - 1)])}`) +
      row("Mean KL", `${o.mean_bits.toFixed(3)} bits`, `${d.mean_bits.toFixed(3)} bits`) + `</table>` +
      spark(series, j) + `<p class="dv-unit">Momentary readings over the steps, from ${LO} DUFS: the original text grey, the diverged text gold. Short-term is the mean over the last ${L.window} steps; integrated is gated as ITU-R BS.1770 gates loudness (${L.gates.absolute} DUFS, then ${-L.gates.relative} vB below the mean); range is the 10th to 95th percentile of the short-term readings. The bar shows the original text.</p>`;
  }

  function paintScreens() {
    root.querySelectorAll(".strip.probe").forEach((s) => { const i = +s.dataset.i; paintScreen(s.querySelector(".screen"), lines[i], i); });
    root.querySelectorAll(".strip .aled").forEach((m) => { const i = +m.closest(".strip").dataset.i; paintAct(m, lines[i], i); });
    if (pins.size) placePins();
    paintMaster();
    if (run) listeners.forEach((f) => f(curStep(), run));
  }
  const listeners = [];
  function takesHost(l) {
    if (!HOSTFX.length || l.spec.probe || l.spec.sampler) return false;
    return !!l.spec.unit || OWN_HOST.has(l.kind) || (l.kind === "scale" && target(l)[0] === "layer");
  }
  function hostBox(l, i) {
    const box = document.createElement("details");
    box.className = "hostfx";
    const set = HOSTFX.filter((p) => l.args.some(([k, v]) => k === p.key && String(v) !== String(p.reset)));
    box.open = hostOpen.has(i);
    box.innerHTML = `<summary title="The host's features, applied around this strip's own change: wet, an envelope over the depth, keep size, and a random control">Host${set.length ? ` <i>${set.length}</i>` : ""}</summary>`;
    box.addEventListener("toggle", () => { if (box.open) hostOpen.add(i); else hostOpen.delete(i); requestAnimationFrame(fit); });
    box.addEventListener("change", (e) => { if (e.target.matches("select")) setTimeout(render, 0); });   // show or hide the envelope's and the control's knobs
    const env = get(l, "env") || "none", ctl = get(l, "control") || "none";
    const show = HOSTFX.filter((p) => !(["epeak", "ewidth", "eedge"].includes(p.key) && env === "none") && !(p.key === "cseed" && ctl === "none")
      && !(p.key === "control" && l.kind === "noise"));
    let row = null;
    for (const p of show) {
      if (p.choices) { row = null; box.appendChild(select(l, p, p.choices)); }
      else if (p.toggle) { row = null; box.appendChild(toggle(l, p)); }
      else {
        if (!row || row.children.length >= 2) { row = document.createElement("div"); row.className = "krow"; box.appendChild(row); }
        row.appendChild(knob(l, p));
      }
    }
    return box;
  }
  function setStep(k) { if (!run) return; step = Math.min(Math.max(0, k), steps() - 1); paintScreens(); }
  function setRun(r) { run = r; step = null; paintScreens(); }

  // ------------------------------------------------------------ moving strips
  // Lines are moved in the text, so comments and blank lines between strips stay where they are.
  const stripLines = () => lines.map((x, k) => (x.strip ? k : -1)).filter((k) => k >= 0);

  function moveBy(i, d) {              // swap with the neighbouring strip; returns the new line index
    const idx = stripLines(), other = idx[idx.indexOf(i) + d];
    if (other === undefined) return null;
    [lines[i], lines[other]] = [lines[other], lines[i]];
    commit(true);
    return other;
  }

  function moveTo(i, slot) {           // put line i before the slot-th strip (slot = number of strips: at the end)
    const idx = stripLines(), me = idx.indexOf(i);
    if (slot === me || slot === me + 1) return;
    let at = slot < idx.length ? idx[slot] : idx[idx.length - 1] + 1;
    const [l] = lines.splice(i, 1);
    if (i < at) at--;
    lines.splice(at, 0, l);
    commit(true);
  }

  function drag(s, i, e) {
    e.preventDefault();
    const h = e.currentTarget, x0 = e.clientX, sl0 = root.scrollLeft;
    const strips = [...root.querySelectorAll(".strip")], me = strips.indexOf(s);
    let slot = null, moved = false, timer = null, lastX = x0;
    const mark = (k) => {
      strips.forEach((x) => x.classList.remove("drop-before", "drop-after"));
      if (k === null || k === me || k === me + 1) return;
      if (k < strips.length) strips[k].classList.add("drop-before");
      else strips[strips.length - 1].classList.add("drop-after");
    };
    const place = () => {
      s.style.transform = `translateX(${lastX - x0 + root.scrollLeft - sl0}px)`;
      let k = strips.length;
      for (let j = 0; j < strips.length; j++) {
        if (j === me) continue;
        const r = strips[j].getBoundingClientRect();
        if (lastX < r.left + r.width / 2) { k = j; break; }
      }
      if (k !== slot) { slot = k; mark(k); }
    };
    const scroll = () => {            // scroll the desk while the strip is held near either edge
      const r = root.getBoundingClientRect();
      const d = lastX < r.left + 40 ? -14 : lastX > r.right - 40 ? 14 : 0;
      if (d) { root.scrollLeft += d; place(); }
    };
    const move = (ev) => {
      lastX = ev.clientX;
      if (!moved && Math.abs(lastX - x0) < 4) return;
      if (!moved) { moved = true; s.classList.add("dragging"); root.classList.add("dragging"); timer = setInterval(scroll, 30); }
      place();
    };
    const end = (ev) => {
      h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", end); h.removeEventListener("pointercancel", end);
      clearInterval(timer);
      mark(null);
      s.classList.remove("dragging"); root.classList.remove("dragging"); s.style.transform = "";
      if (moved && ev.type === "pointerup" && slot !== null) moveTo(i, slot);
    };
    h.setPointerCapture(e.pointerId);
    h.addEventListener("pointermove", move); h.addEventListener("pointerup", end); h.addEventListener("pointercancel", end);
  }

  function insert(line) {
    while (lines.length && !lines[lines.length - 1].raw.trim()) lines.pop();
    lines.push(parse(line));
    commit(true);
  }

  // put a new strip before the slot-th strip (slot = number of strips: at the end), then show it
  function insertAt(kind, slot) { insertLines([NEW_LINE[kind]], slot); }
  function insertLines(texts, slot) {
    const idx = stripLines(), add = texts.map(parse);
    if (slot >= idx.length) {
      while (lines.length && !lines[lines.length - 1].raw.trim()) lines.pop();
      lines.push(...add);
    } else lines.splice(idx[slot], 0, ...add);
    commit(true);
    const strips = root.querySelectorAll(".strip"), n = add.filter((x) => x.strip).length;
    const first = Math.min(slot, strips.length - n);
    for (let k = first; k < first + n; k++) {
      const s = strips[k]; if (!s) continue;
      s.classList.add("fresh");
      setTimeout(() => s.classList.remove("fresh"), 1200);
    }
    const s = strips[first];
    if (s) { s.scrollIntoView({ block: "nearest", inline: "nearest" }); s.querySelector(".grip")?.focus({ preventScroll: true }); }
  }

  // ------------------------------------------------------------ drops from the browser
  // An item dragged from the browser goes in where it is dropped, between strips. A direction
  // dropped on a strip that takes one (Steer, Project out, Direction meter) becomes its direction;
  // dropped between strips it makes a Steer strip.
  const MIME = "text/x-abliteration", MIME_OLD = "text/x-abliterton";   // drags are written under the new type; one under the type before 0.1.15 is still read
  const dragType = (dt) => (dt.types.includes(MIME) ? MIME : dt.types.includes(MIME_OLD) ? MIME_OLD : null);
  let dropMark = null;
  function dropAt(e) {
    const strips = [...root.querySelectorAll(".strip")];
    const over = e.target.closest && e.target.closest(".strip");
    let slot = strips.length;
    for (let k = 0; k < strips.length; k++) {
      const r = strips[k].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { slot = k; break; }
    }
    return { strips, slot, over };
  }
  function clearDrop() {
    root.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-into"));
    dropMark = null;
  }
  function takesDir(i) { const l = lines[i]; return l && l.strip && l.spec.params.some((p) => p.direction); }
  function wireDrops() {
    root.addEventListener("dragover", (e) => {
      if (!dragType(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      const { strips, slot, over } = dropAt(e), isDir = e.dataTransfer.types.includes(dragType(e.dataTransfer) + "-dir");
      const key = isDir && over && takesDir(+over.dataset.i) ? "into" + over.dataset.i : "slot" + slot;
      if (key === dropMark) return;
      clearDrop(); dropMark = key;
      if (key.startsWith("into")) over.classList.add("drop-into");
      else if (slot < strips.length) strips[slot].classList.add("drop-before");
      else if (strips.length) strips[strips.length - 1].classList.add("drop-after");
    });
    root.addEventListener("dragleave", (e) => { if (!root.contains(e.relatedTarget)) clearDrop(); });
    root.addEventListener("drop", (e) => {
      const t = dragType(e.dataTransfer), raw = t && e.dataTransfer.getData(t);
      if (!raw) return;
      e.preventDefault();
      const { slot, over } = dropAt(e), item = JSON.parse(raw);
      clearDrop();
      if (item.dir && over && takesDir(+over.dataset.i)) { const l = lines[+over.dataset.i]; set(l, "dir", item.dir, true); return; }
      insertLines(item.lines, slot);
    });
  }

  // ------------------------------------------------------------ the + buttons
  // A + stands after the last strip, and one shows in each gap between strips when the pointer is over it.
  // Either opens a menu of interventions; the one chosen goes in at that point.
  let menu = null;
  function closeMenu() {
    if (!menu) return;
    menu.opener.setAttribute("aria-expanded", "false");
    menu.remove(); menu = null;
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", menuKey, true);
  }
  const outside = (e) => { if (menu && !menu.contains(e.target) && !e.target.closest(".addgap, .addend")) closeMenu(); };
  function menuKey(e) {
    if (!menu) return;
    const items = [...menu.querySelectorAll("button")], k = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); const b = menu.opener; closeMenu(); b?.focus(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(k + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
  }
  function openMenu(btn, slot) {
    const again = menu && menu.opener === btn;
    closeMenu();
    if (again) return;
    menu = document.createElement("div");
    menu.className = "addmenu"; menu.setAttribute("role", "menu"); menu.opener = btn;
    btn.setAttribute("aria-expanded", "true");
    const n = stripLines().length;
    const where = slot >= n ? (n ? `after strip ${n}` : "as the first strip") : slot === 0 ? "before strip 1" : `between strips ${slot} and ${slot + 1}`;
    const items = (keys) => keys.map((k) =>
      typeof k === "object" ? `<div class="am-cat">${esc(k.title)}</div>` :
      `<button role="menuitem" data-k="${k}"><b>${SPECS[k].prefix ? `<i class="vpre">${esc(SPECS[k].prefix)}</i>` : ""}${SPECS[k].title}${SPECS[k].probe ? ' <span class="meterbadge">meter</span>' : ""}${spaceTag(k)}</b><span>${esc(SPECS[k].what)}</span></button>`).join("");
    const group = (title, keys) => (keys.length ? `<div class="am-h">${title}</div>` + items(keys) : "");
    const keys = Object.keys(SPECS), own = keys.filter((k) => !SPECS[k].unit), units = vauGroups(keys);
    menu.innerHTML = `<div class="am-where">Add ${where}</div>` +
      group("The model", own.filter((k) => !SPECS[k].sampler && !SPECS[k].probe)) +
      (units.length ? `<div class="am-h">VAUs</div>` + units.map((g) => (g.title ? `<div class="am-sub">${esc(g.title)}</div>` : units.length > 1 ? `<div class="am-sub">No collection</div>` : "") + items(byCategory(g.keys))).join("") : "") +
      group("The sampler", own.filter((k) => SPECS[k].sampler)) +
      group("Meters: read, change nothing", own.filter((k) => SPECS[k].probe));
    menu.addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]"); if (!b) return;
      closeMenu(); insertAt(b.dataset.k, slot);
    });
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect(), m = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - m.width / 2), innerWidth - m.width - 8);
    const top = r.bottom + 6 + m.height < innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - m.height);
    Object.assign(menu.style, { left: left + "px", top: top + "px" });
    menu.querySelector("button").focus();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", menuKey, true);
  }
  function adder(slot, end) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = end ? "addend" : "addgap";
    b.dataset.slot = slot;
    b.setAttribute("aria-haspopup", "menu");
    const n = stripLines().length;
    b.title = end ? "Add an intervention at the end of the chain" : slot === 0 ? "Add an intervention before strip 1" : `Add an intervention between strips ${slot} and ${slot + 1}`;
    b.setAttribute("aria-label", b.title);
    b.innerHTML = `<span class="plus">+</span>`;
    b.addEventListener("click", () => openMenu(b, end ? n : slot));
    return b;
  }

  let loo = null;        // leave one out: {text: the chain it was run on, by: {line index: {edit, parts}}}
  // ------------------------------------------------------------ selecting and deleting strips
  let selected = null, undo = [];
  const undoFns = [];
  const undoChanged = () => undoFns.forEach((f) => f(undo.length));
  function undoLast() {
    if (!undo.length) return;
    ta.value = undo.pop(); onChange(); selected = null; render(); undoChanged();
    window.onDeskNote?.("Put back.");
  }
  function pick(i) {
    selected = i;
    root.querySelectorAll(".strip").forEach((x) => x.classList.toggle("sel", +x.dataset.i === i));
  }
  function remove(i) {
    const l = lines[i];
    if (!l || !l.strip) return;
    undo.push(ta.value);
    if (undo.length > 30) undo.shift();
    undoChanged();
    const idx = stripLines(), k = idx.indexOf(i);
    lines.splice(i, 1);
    commit(true);
    const left = stripLines();                                      // select the strip that took its place
    selected = left.length ? left[Math.min(k, left.length - 1)] : null;
    pick(selected);
    if (selected !== null) root.querySelector(`.strip[data-i="${selected}"]`)?.focus({ preventScroll: true });
    window.onDeskNote?.(`Removed ${nameOf(l.spec)}. ⌘Z or Ctrl+Z brings it back.`);
  }
  const typing = (el) => el && el.closest && el.closest("input, textarea, select, [contenteditable]");
  document.addEventListener("keydown", (e) => {
    if (typing(e.target) || document.querySelector("dialog[open]")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selected !== null && root.isConnected && root.offsetParent !== null) {
      e.preventDefault(); remove(selected);
    } else if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey && undo.length) {
      e.preventDefault(); undoLast();
    }
  });

  // strips fit the desk's height: the fader takes the slack, and on a short desk the knobs shrink a step,
  // then another. Checked after each render and on resizes (a size observer alone misses a page in the background).
  function fit() {
    const h = root.clientHeight;
    if (!h) return;
    const was = root.className;
    root.classList.toggle("compact", h < 440);
    root.classList.toggle("tight", h < 350);
    if (root.className !== was) fitNames();      // compact and tight change the strips' padding: the names fit again
  }
  function render() {
    if (dive) { dive.hidden = true; dive.owner = null; }
    lines = ta.value.split("\n").map(parse);
    if (selected !== null && !(lines[selected] && lines[selected].strip)) selected = null;
    root.innerHTML = "";
    const io = (t) => Object.assign(document.createElement("div"), { className: "io", textContent: t });
    root.appendChild(io("IN"));
    closeMenu();
    let n = 0;
    for (const [i, p] of pins) if (!lines[i] || !lines[i].strip || lines[i].kind !== p.kind) pins.delete(i);
    lines.forEach((l, i) => {
      if (!l.strip) return;
      root.appendChild(adder(n, false));
      root.appendChild(strip(l, i, ++n));
      if (pins.has(i)) root.appendChild(pinBox(i));
    });
    if (!n) root.appendChild(Object.assign(document.createElement("div"), { className: "empty", textContent: "No interventions: the diverged run will equal the original. Click + to add one, or type in the Text view." }));
    root.appendChild(adder(n, true));
    root.appendChild(master());
    fitNames();
    if (pins.size) placePins();
    requestAnimationFrame(fit);
    fit();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  return {
    init(textarea, container, changed) {
      ta = textarea; root = container; onChange = changed; wireDrops();
      document.fonts?.ready.then(() => fitNames());
      root.addEventListener("pointerdown", (e) => { if (!e.target.closest(".strip")) pick(null); });
      root.addEventListener("scroll", () => { if (pins.size) placePins(); });
      addEventListener("resize", () => { fit(); if (pins.size) placePins(); });
      new ResizeObserver(() => { fit(); if (pins.size) placePins(); }).observe(root);
      render();
    },
    render, insert, insertLines, parse, SPECS, NEW_LINE, MIME, setRun, setStep, setModel, VAU, vauGroups, byCategory, spaceTag, fit,
    onStep(f) { listeners.push(f); },
    onUndo(f) { undoFns.push(f); f(undo.length); },
    setLoo(x) { loo = x; render(); },
    get selected() { return selected; },
    // put a value in a strip's target (the Sweep's cells do this)
    applyTarget(i, value) { const l = lines[i]; if (!l || !l.strip) return; const [t] = target(l); if (t) set(l, t, value, true); },
    undo: () => undoLast(),
    get step() { return run ? curStep() : null; },
    setDirections(names) { dirs = names; render(); },
    // the strips' numeric parameters, for the dose sweep's chooser
    sweepables() {
      const out = [];
      ta.value.split("\n").forEach((raw, i) => {
        const l = parse(raw);
        if (!l.strip) return;
        for (const p of l.spec.params) if (p.fader || p.int || ["k", "scale", "sigma", "p"].includes(p.key))
          out.push({ lineno: i + 1, key: p.key, label: `Line ${i + 1}, ${nameOf(l.spec)}: ${p.label}`, min: p.min, max: p.max, cur: value(l, p) });
      });
      return out;
    },
  };
})();
