// Abliteration Lens. Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LN2 = Math.log(2);
const ANN_TYPES = ["observation", "question", "metaphor", "pattern", "context", "critique"];

const S = {
  model: null, presets: [], run: null, parent: null, unit: "ppl", show: "diff",
  dirs: [], contrasts: [], abort: null, sel: null, map: null, mapCell: null, sweep: null,
};

// ------------------------------------------------------------------ server
async function api(path, body, method) {
  const opt = { method: method || (body !== undefined ? "POST" : "GET"), headers: {} };
  if (opt.method !== "GET") { opt.headers["X-Abliteration"] = "1"; opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body ?? {}); }
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function stream(path, body, onEvent) {
  const ctl = new AbortController();
  S.abort = ctl;
  window.onJob?.({ type: "begin", path });
  const r = await fetch(path, { method: "POST", signal: ctl.signal, body: JSON.stringify(body),
    headers: { "X-Abliteration": "1", "Content-Type": "application/json" } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = "", last = null;
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.type === "error") { window.onJob?.({ type: "error", error: e.error }); throw new Error(e.error); }
      last = e;
      window.onJob?.(e);
      onEvent(e);
    }
  }
  S.abort = null;
  window.onJob?.({ type: "end", last });
  return last;
}

async function stopJob() { try { await api("/api/stop", {}); } catch (e) { /* nothing running */ } }

function download(url) { const a = document.createElement("a"); a.href = url; a.download = ""; document.body.appendChild(a); a.click(); a.remove(); }
function downloadJSON(obj, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const store = { get(k, d) { try { const v = localStorage.getItem("db." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("db." + k, JSON.stringify(v)); } catch (e) { /* private window */ } } };
S.pin = store.get("pin", null);           // a pinned run, to set later runs against (Pin and compare)
S.cmp = store.get("cmp", "base");

// ------------------------------------------------------------------ comparing texts in the page
// The same measures the server uses (textmetrics.py), for comparisons it was not asked for:
// a word diff on word-and-space tokens, word edit distance, and the first token that differs.
function wordDiff(a, b) {
  const ta = a.match(/\s+|[^\s]+/g) || [], tb = b.match(/\s+|[^\s]+/g) || [];
  const n = ta.length, m = tb.length, L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = ta[i] === tb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [], push = (op, t) => { const last = out[out.length - 1]; if (last && last[0] === op) last[1] += t; else out.push([op, t]); };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) { push("common", ta[i]); i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) { push("added", tb[j]); j++; }
    else { push("removed", ta[i]); i++; }
  }
  return out;
}
const wordsOf = (t) => t.toLowerCase().match(/[a-z0-9'’-]+|[^\sa-z0-9]/g) || [];
function editDistance(a, b) {
  if (!a.length && !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1]));
    prev = cur;
  }
  return prev[b.length] / Math.max(a.length, b.length);
}
function firstDiff(x, y) {
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i].id !== y[i].id) return i;
  return x.length === y.length ? -1 : n;
}
// what the diverged text of run r is set against: the original, or the pinned run
function compareRef(r) {
  const p = S.pin;
  if (S.cmp === "pin" && p && p.id !== r.id)
    return { kind: "pin", name: "Pinned", sub: `run ${p.id}${p.label ? ` (${p.label})` : ""}`, text: p.text, tokens: p.tokens, prompt: p.prompt,
      diff: wordDiff(p.text, r.bent.text), k: firstDiff(p.tokens, r.bent.tokens), edit: editDistance(wordsOf(p.text), wordsOf(r.bent.text)) };
  return { kind: "base", name: "Original", sub: "original model, same seed", text: r.baseline.text, tokens: r.baseline.tokens, prompt: r.recipe.prompt,
    diff: r.diff, k: r.metrics.distance.first_divergence, edit: r.metrics.distance.edit };
}

// ------------------------------------------------------------------ tabs, theme
function setView(v) {
  if (v === "help") { Boxes.help(); v = "bench"; }   // Help is a box now, not a view
  $$("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === v)));
  $$("section.view").forEach((s) => s.classList.toggle("on", s.id === "v-" + v));
  document.body.classList.toggle("dock", v === "bench");     // the Bench fills the window, the chain docked at its foot
  store.set("view", v);
  if (v === "probs") renderProbs();
  if (v === "sweep") { fillSweepKnobs(); loadSweeps(); }
  if (v === "band") renderBand();
  if (v === "variorum") loadVariorum();
  if (v === "dirs") loadDirections();
  if (v === "map") { mapCost(); loadMaps(); }
}
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setView(b.dataset.v); });
function applyTheme() {
  const t = store.get("theme", "system");
  if (t === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = t;
  const q = new URLSearchParams(location.search).get("theme");
  if (q) document.documentElement.dataset.theme = q;
  const now = q || t;
  $("#themebtn").title = `Theme: ${now === "system" ? "the system's setting" : now}. Click for ${{ system: "light", light: "dark", dark: "the system's setting" }[now]} (more in ⚙ Settings)`;
  if (typeof S !== "undefined" && S.run) renderProbs();
}
// the starting values chosen in Settings; on Save, only the ones that changed are put in place
function applySettings(changed = { unit: true, bandN: true, tokens: true }) {
  if (changed.unit) $(`#unitmode [data-u="${Boxes.get("unit")}"]`)?.click();
  if (changed.bandN) $("#bandn").value = Boxes.get("bandN");
  if (changed.tokens) $("#maxtok").value = Boxes.get("tokens");
}
$("#btn-help").addEventListener("click", () => Boxes.help());
$("#btn-about").addEventListener("click", () => Boxes.about());
$("#brand").addEventListener("click", () => Boxes.about());
$("#btn-settings").addEventListener("click", () => Boxes.settings());
$("#themebtn").addEventListener("click", () => {
  const order = ["system", "light", "dark"];
  store.set("theme", order[(order.indexOf(store.get("theme", "system")) + 1) % 3]);
  applyTheme();
});
const dark = () => document.documentElement.dataset.theme === "dark" ||
  (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

// ------------------------------------------------------------------ model
async function refreshStatus() {
  try {
    const s = await api("/api/status");
    $("#ver").textContent = "v" + s.version;
    S.model = s.model;
    const chip = $("#modelchip");
    if (s.model) Desk.setModel(s.model);
    if (s.model) chip.innerHTML = `<b>${esc(s.model.name)}</b> @ ${esc(s.model.revision)} · ${s.model.n_layers}×${s.model.n_heads} · ${esc(s.model.dtype)} · ${esc(s.model.device)}` + (s.job ? ` · <span class="busy">${esc(s.job)}</span>` : "");
    else chip.textContent = s.job ? s.job : "No model loaded";
    $("#modelinfo").textContent = s.model ? `${s.model.architecture}, ${(s.model.n_params / 1e6).toFixed(0)}M parameters, ${s.model.n_layers} blocks × ${s.model.n_heads} heads, d=${s.model.d_model}, revision ${String(s.model.revision_hash || "").slice(0, 10)}` : "";
  } catch (e) { $("#modelchip").textContent = "The server is not answering"; }
}

async function loadPresets() {
  const { models } = await api("/api/presets");
  S.presets = models;
  $("#presetlist").innerHTML = models.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}${m.cached ? "" : " (not downloaded)"}</option>`).join("");
  presetNote();
}
function presetNote() {
  const p = S.presets.find((m) => m.id === $("#modelid").value.trim());
  $("#revlist").innerHTML = (p?.revisions || []).map((r) => `<option value="${esc(r)}">`).join("");
  $("#presetnote").textContent = p ? `${p.name} (${p.year}): ${p.note}` + (p.revisions?.length > 1 ? ` Checkpoints on this machine: ${p.revisions.join(", ")}.` : "") + (p.cached ? "" : " Not in the Hugging Face cache: loading downloads it.") : "Any model in the Hugging Face cache, or a folder with a Hugging Face checkpoint.";
}
$("#modelid").addEventListener("input", presetNote);
// Load a model: the Instrument's Load button, and Load in the deep dive on a model (Settings,
// Models), which puts the model in the Instrument first. Throws the server's error.
async function loadModel(id, revision) {
  if (id !== undefined) { $("#modelid").value = id; $("#revision").value = revision || ""; presetNote(); }
  const b = $("#loadbtn"); b.disabled = true; b.textContent = "Loading…";
  try {
    await api("/api/load", { model: $("#modelid").value.trim(), revision: $("#revision").value.trim() });
    await refreshStatus(); await loadDirections(); validateChain();
  } finally { b.disabled = false; b.textContent = "Load"; }
}
window.loadModel = loadModel;
$("#loadbtn").addEventListener("click", () => loadModel().catch((e) => alert(e.message)));
// (i): the deep dive on the loaded model, or on the one named in the Instrument when none is loaded
$("#modelinfobtn").addEventListener("click", (e) => Boxes.modelInfo(S.model ? S.model.model_id : $("#modelid").value.trim(), e.currentTarget));

// ------------------------------------------------------------------ chain
const chainTA = $("#chain");
let vTimer = null, liveTimer = null;
function chainChanged() {
  store.set("chain", chainTA.value);
  clearTimeout(vTimer); vTimer = setTimeout(validateChain, 200);
  if ($("#live").checked) { clearTimeout(liveTimer); liveTimer = setTimeout(() => runPair(true), 650); }
}
async function validateChain() {
  try {
    const r = await api("/api/chain", { text: chainTA.value });
    const st = $("#chainstatus");
    const on = (r.strips || []).filter((s) => s.on), n = on.filter((s) => s.level !== "probe").length, nm = on.length - n;
    const meters = nm ? ` · ${nm} meter${nm > 1 ? "s" : ""}` : "";
    st.className = r.ok ? "chainok" : "chainbad";
    st.textContent = r.ok ? (n ? `${n} intervention${n > 1 ? "s" : ""} on${meters}` : `Nothing on: the diverged run will equal the original${meters}`) : r.error;
    $("#code").textContent = r.code || (S.model ? "" : "Load a model to see the hook code for its modules.");
    return r.ok;
  } catch (e) {
    // api() throws on a reply that carries an error, which is how the server reports a bad chain
    const st = $("#chainstatus");
    st.className = "chainbad"; st.textContent = e.message;
    return false;
  }
}
chainTA.addEventListener("input", () => { chainChanged(); });
chainTA.addEventListener("change", () => Desk.render());
$("#chainmode").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  $$("#chainmode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  $("#deskwrap").hidden = b.dataset.m !== "desk"; $("#textwrap").hidden = b.dataset.m !== "text"; $("#codewrap").hidden = b.dataset.m !== "code";
  if (b.dataset.m === "desk") Desk.render();
  if (b.dataset.m === "code") validateChain();
});

function sampler() {
  return { temperature: +$("#temp").value, top_k: +$("#topk").value, top_p: +$("#topp").value, max_new_tokens: +$("#maxtok").value };
}
function saveInputs() { store.set("inputs", { prompt: $("#prompt").value, seed: $("#seed").value, temp: $("#temp").value, topk: $("#topk").value, topp: $("#topp").value, maxtok: $("#maxtok").value }); }
["prompt", "seed", "temp", "topk", "topp", "maxtok"].forEach((id) => $("#" + id).addEventListener("change", () => { saveInputs(); if ($("#live").checked) runPair(true); }));

// ------------------------------------------------------------------ the paired run
function busy(on, which = "run") {
  $("#runbtn").disabled = on; $("#stopbtn").disabled = !on;
  $("#runbtn").classList.toggle("on", on && which === "run");          // lit while the pair runs
  $("#runbtn").title = on ? (which === "run" ? "Running before and after" : "Busy") : "Run before and after (Space)";
}
// ---------------------------------------------------------------- Tempo and replay
// The tempo is how fast the texts are written out, in tokens a second: Live shows each token as the
// model writes it; slower, a run's tokens are queued and shown at that pace, and the finished run
// appears once they have all been shown. Replay writes the two texts out again side by side, token
// by token at the tempo, with the timeline's playhead and the meters following.
const TEMPI = [0, 24, 12, 6, 3];
let tempo = (() => { try { const v = +localStorage.getItem("db.tempo"); return TEMPI.includes(v) ? v : 0; } catch (e) { return 0; } })();
const pacer = (() => {
  let q = [], timer = null, after = [];          // after: what waits for the queue to empty, in order
  const finish = () => { after.splice(0).forEach((f) => f()); };
  function tick() {
    if (!q.length) { timer = null; finish(); return; }
    q.shift()();
    timer = setTimeout(tick, 1000 / (tempo || 1000));
  }
  return {
    push(f) { if (!tempo && !q.length && !timer) { f(); return; } q.push(f); if (!timer) tick(); },
    then(f) { if (!q.length && !timer) f(); else after.push(f); },
    flush() { clearTimeout(timer); timer = null; q.splice(0).forEach((f) => f()); finish(); },
  };
})();
function paintTempo() {
  const b = $("#tempobtn"); if (!b) return;
  const next = TEMPI[(TEMPI.indexOf(tempo) + 1) % TEMPI.length];
  b.textContent = tempo ? String(tempo) : "∞";
  b.title = `Tempo: ${tempo ? `${tempo} tokens a second` : "live, as fast as the model writes"}. Click for ${next ? `${next} tokens a second` : "live"}.`;
  b.dataset.info = b.title;
}
$("#tempobtn")?.addEventListener("click", () => {
  tempo = TEMPI[(TEMPI.indexOf(tempo) + 1) % TEMPI.length];
  try { localStorage.setItem("db.tempo", String(tempo)); } catch (e) { /* private window */ }
  paintTempo();
});
paintTempo();

let replaying = null;
function stopReplay() {
  if (!replaying) return;
  clearTimeout(replaying.timer);
  const r = replaying; replaying = null;
  $("#result").classList.remove("replaying");
  $("#replaybtn").setAttribute("aria-pressed", "false"); $("#replaybtn").textContent = "▶";
  S.show = r.show; renderTexts();
  window.redrawTimeline?.();
}
function replay() {
  if (replaying) { stopReplay(); return; }
  if (!S.run || running) return;
  const r = S.run, ref = compareRef(r), n = Math.max(ref.tokens.length, r.bent.tokens.length);
  replaying = { show: S.show, timer: null };
  S.show = "tokens"; renderTexts();
  $("#result").classList.add("replaying");
  $("#replaybtn").setAttribute("aria-pressed", "true"); $("#replaybtn").textContent = "■";
  const toks = (j) => $$(`#basetext .tok[data-i="${j}"], #benttext .tok[data-i="${j}"]`);
  $$("#basetext .tok, #benttext .tok").forEach((t) => t.classList.add("rp-hid"));
  let j = 0;
  (function step() {
    if (!replaying) return;
    if (j >= n) { stopReplay(); return; }
    toks(j).forEach((t) => t.classList.remove("rp-hid"));
    Desk.setStep(j);
    j++;
    replaying.timer = setTimeout(step, 1000 / (tempo || 12));
  })();
}
$("#replaybtn")?.addEventListener("click", replay);

let running = false, again = false;
async function runPair(fromLive) {
  if (running) { if (fromLive) { again = true; stopJob(); } return; }
  if (!S.model) { if (!fromLive) alert("Load a model first."); return; }
  if (!$("#prompt").value.trim()) return;
  stopReplay(); pacer.flush();
  running = true; busy(true);
  $("#result").scrollIntoView({ block: "nearest", behavior: "smooth" });
  const panels = { baseline: $("#basetext"), bent: $("#benttext") };
  const acc = { baseline: "", bent: "" };
  for (const k in panels) panels[k].innerHTML = `<div class="ln"><span class="no"></span><span class="prompt">${esc($("#prompt").value)}</span></div><div class="ln"><span class="no">…</span><span class="stream"></span></div>`;
  $("#divergence").innerHTML = ""; $("#metrics").innerHTML = ""; $("#annots").innerHTML = ""; $("#runactions").hidden = true;
  $("#basestat").textContent = $("#bentstat").textContent = "";
  window.timelineLive?.begin();
  try {
    await stream("/api/run", { prompt: $("#prompt").value, chain: chainTA.value, sampler: sampler(), seed: +$("#seed").value, parent: S.parent }, (e) => {
      if (e.type === "token") pacer.push(() => { acc[e.run] += e.tok.t; $(".stream", panels[e.run]).textContent = acc[e.run]; window.timelineLive?.token(e.run, e.tok); });
      else if (e.type === "status") $("#bentstat").textContent = e.text;
      else if (e.type === "result") pacer.then(() => { S.run = e.run; S.parent = null; window.timelineLive?.end(); showRun(); });
    });
  } catch (e) { pacer.flush(); if (e.name !== "AbortError") $("#divergence").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  await new Promise((ok) => pacer.then(ok));          // at a slow tempo the texts are still being written out
  window.timelineLive?.end();
  running = false; busy(false); refreshStatus();
  if (again) { again = false; runPair(true); }
}
$("#runbtn").addEventListener("click", () => runPair(false));
$("#stopbtn").addEventListener("click", () => { pacer.flush(); stopReplay(); stopJob(); });
// Space runs, or stops whatever is running, unless the focus is somewhere that takes typing or keys
document.addEventListener("keydown", (e) => {
  if (e.key !== " " || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target instanceof Element ? e.target : document.body;
  if (el.closest("input, textarea, select, button, [contenteditable], [tabindex], dialog[open]") || document.querySelector("dialog[open]")) return;
  e.preventDefault();
  if (!$("#stopbtn").disabled) stopJob(); else runPair(false);
});

$("#runid").addEventListener("click", async () => {
  if (!S.run) return;
  try { await navigator.clipboard.writeText(S.run.id); window.onDeskNote?.(`Copied the run id ${S.run.id}.`); }
  catch (e) { window.onDeskNote?.(`Run ${S.run.id}.`); }
});
$("#showmode").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  S.show = b.dataset.m;
  $$("#showmode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  if (S.run) renderTexts();
});

// numbered lines from segments [{t, cls, attr}]
function numbered(el, segs, side, promptText) {
  const ann = (S.run?.annotations || []).filter((a) => a.side === side);
  const has = new Set(); ann.forEach((a) => { for (let i = a.line; i <= (a.end_line || a.line); i++) has.add(i); });
  let html = promptText !== undefined ? `<div class="ln"><span class="no"></span><span class="prompt">${esc(promptText)}</span></div>` : "";
  let line = 1, cur = "";
  const flush = () => {
    const sel = S.sel && S.sel.side === side && S.sel.line === line;
    html += `<div class="ln"><span class="no${has.has(line) ? " has" : ""}${sel ? " sel" : ""}" data-side="${side}" data-line="${line}" title="Annotate line ${line}">${line}</span><span>${cur || " "}</span></div>`;
    cur = ""; line++;
  };
  for (const s of segs) {
    const parts = s.t.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) flush();
      if (p) cur += s.cls ? `<span class="${s.cls}"${s.attr || ""}>${esc(p)}</span>` : esc(p);
    });
  }
  flush();
  el.innerHTML = html;
}

function renderTexts() {
  const r = S.run, ref = compareRef(r);
  const prompt = r.recipe.prompt;
  if (S.show === "diff") {
    const a = [], b = [];
    for (const [op, t] of ref.diff) {
      if (op === "common") { a.push({ t }); b.push({ t }); }
      else if (op === "removed") a.push({ t, cls: "rem" });
      else b.push({ t, cls: "add" });
    }
    numbered($("#basetext"), a, "baseline", ref.prompt);
    numbered($("#benttext"), b, "bent", prompt);
  } else if (S.show === "tokens") {
    const k = ref.k;
    for (const side of ["baseline", "bent"]) {
      const segs = (side === "baseline" ? ref.tokens : r.bent.tokens).map((t, i) => ({ t: t.t, cls: "tok" + (i === k ? " div" : k >= 0 && i > k ? " after" : ""), attr: ` data-side="${side}" data-i="${i}" title="Token ${i + 1}${r.probes ? ": click to show this step on the meters" : ""}"` }));
      numbered($(side === "baseline" ? "#basetext" : "#benttext"), segs, side, side === "baseline" ? ref.prompt : prompt);
    }
  } else {
    numbered($("#basetext"), [{ t: ref.text }], "baseline", ref.prompt);
    numbered($("#benttext"), [{ t: r.bent.text }], "bent", prompt);
  }
}

function topkHTML(rec, chosenTok) {
  const rows = rec.top.map(([t, lp]) => {
    const p = Math.exp(lp);
    return `<span class="${t === chosenTok ? "chosen" : ""}">${esc(JSON.stringify(t))}</span><span class="bar" style="width:${Math.max(2, p * 100)}%"></span><span>${p.toFixed(3)}</span>`;
  }).join("");
  return `<div class="topk">${rows}</div>`;
}

const fmt = (v, d = 3) => (v === null || v === undefined || Number.isNaN(v) ? "–" : (+v).toFixed(d));
function unitVal(bits) { return S.unit === "bits" ? `${fmt(bits)} bits` : `${fmt(2 ** bits, 2)} ppl`; }

function showRun() {
  const r = S.run;
  Desk.setRun(r);
  $("#runid").title = `Run ${r.label ? `${r.label} · ` : ""}${r.id}. Click to copy its id.`;
  $("#runid").dataset.info = $("#runid").title;
  const bentOnly = r.recipe.chain.strips.filter((s) => s.on && !(Desk.SPECS[s.kind] || {}).probe);
  $("#bentlabel").textContent = bentOnly.length ? `through ${bentOnly.length} intervention${bentOnly.length > 1 ? "s" : ""}` : "nothing on: equals the original";
  const ref = compareRef(r);
  $("#cmpmode").hidden = !S.pin;
  $$("#cmpmode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === (ref.kind === "pin" ? "pin" : "base"))));
  $("#basename").textContent = ref.name; $("#basesub").textContent = ref.sub;
  renderTexts();
  const m = r.metrics, d = m.distance;
  $("#basestat").textContent = ref.kind === "pin" ? `${ref.tokens.length} tok` : `${m.baseline.n_tokens} tok · ${unitVal(m.baseline.own_bits)}`;
  $("#bentstat").textContent = `${m.bent.n_tokens} tok · ${unitVal(m.bent.own_bits)}`;
  // divergence point
  const dv = r.divergence;
  if (d.first_divergence < 0) $("#divergence").innerHTML = `<p class="note">The two texts are identical token for token.</p>`;
  else if (dv) {
    $("#divergence").innerHTML = `<h3>Divergence point: token ${dv.index + 1}</h3><div class="divbox">
      <div class="dl">Original chose <b>${esc(JSON.stringify(dv.baseline.t))}</b> (p ${fmt(Math.exp(dv.baseline.lp))}, rank ${dv.baseline.rank}, entropy ${fmt(dv.baseline.ent, 2)} bits)${topkHTML(dv.baseline, dv.baseline.t)}</div>
      <div class="dl">Diverged chose <b>${esc(JSON.stringify(dv.bent.t))}</b> (p ${fmt(Math.exp(dv.bent.lp))} under the diverged model, rank ${dv.bent.rank}, entropy ${fmt(dv.bent.ent, 2)} bits)${topkHTML(dv.bent, dv.bent.t)}</div></div>`;
  } else $("#divergence").innerHTML = `<p class="note">One text stops at token ${d.first_divergence}; up to there they agree.</p>`;
  if (ref.kind === "pin") $("#divergence").insertAdjacentHTML("afterbegin", `<p class="note pinnote">Set against the pinned run ${esc(S.pin.id)}: ${ref.k < 0 ? "the two diverged texts are the same." : `they part at token ${ref.k + 1}, word edit distance ${fmt(ref.edit, 2)}.`} The divergence point and the measures below are against the original.</p>`);
  renderMetrics();
  renderAnnots();
  $("#runactions").hidden = false;
}

function bandTag(key) {
  const b = S.run?.band?.summary?.[key];
  if (!b) return "";
  if (b.inside === null) return "";
  return b.inside ? `<span class="pill in" title="Band ${fmt(b.min)} to ${fmt(b.max)} over ${S.run.band.n} reseeds">inside the band</span>` : `<span class="pill out" title="Band ${fmt(b.min)} to ${fmt(b.max)} over ${S.run.band.n} reseeds">outside the band</span>`;
}
function renderMetrics() {
  const r = S.run, m = r.metrics, d = m.distance;
  const card = (k, v, b, key) => `<div class="metric"><div class="mk">${k}</div><div class="mv">${v}</div><div class="mb">${b || ""} ${key ? bandTag(key) : ""}</div></div>`;
  const pats = (t) => Object.entries(t.patterns).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
  const hy = (t) => { const h = t.stance || t.hyland || {}; return `hedges ${h.hedging}, boosters ${h.confident}, negation ${h.negation}, evaluative ${h.evaluative}`; };   // "hyland": runs saved before 0.1.8
  $("#metrics").innerHTML = [
    card("First divergence", d.first_divergence < 0 ? "none" : `token ${d.first_divergence + 1}`, "", "first_divergence"),
    card("Word edit distance", fmt(d.edit), "0 identical, 1 nothing shared", "edit"),
    card("Bigram distance", fmt(d.bigram), "1 − Jaccard of word bigrams", "bigram"),
    card("Diverged text under the original model", unitVal(m.bent.other_bits), `under its own: ${unitVal(m.bent.own_bits)}`, "under_base_bits"),
    card("Original text under the diverged model", unitVal(m.baseline.other_bits), `under its own: ${unitVal(m.baseline.own_bits)}`),
    card("Distinct-2", `${fmt(m.baseline.distinct2)} → ${fmt(m.bent.distinct2)}`, "original → diverged", "distinct2"),
    card("Repetition", `${fmt(m.baseline.repetition)} → ${fmt(m.bent.repetition)}`, "share of repeated word trigrams", "repetition"),
    card("Grammar Probe hits", `${Object.values(m.baseline.patterns).reduce((a, b) => a + b, 0)} → ${Object.values(m.bent.patterns).reduce((a, b) => a + b, 0)}`, `bent: ${esc(pats(m.bent))}`),
    card("Stance words (original)", "", esc(hy(m.baseline))), card("Stance words (diverged)", "", esc(hy(m.bent))),
  ].join("") + (r.band ? "" : `<div class="metric"><div class="mk">Control band</div><div class="mb">Not made yet. Without it, a distance cannot be told apart from a change of seed. <button class="b small" onclick="setView('band')">Make the band</button></div></div>`);
}

// ------------------------------------------------------------------ annotations (LLMbench's types)
document.addEventListener("click", (e) => {
  const no = e.target.closest(".ln .no[data-line]");
  if (!no || !S.run) return;
  S.sel = { side: no.dataset.side, line: +no.dataset.line };
  $("#annform").classList.add("on");
  $("#annwhere").textContent = `${S.sel.side}, line ${S.sel.line}`;
  $("#anntext").focus();
  renderTexts();
});
$("#anncancel").addEventListener("click", () => { S.sel = null; $("#annform").classList.remove("on"); renderTexts(); });
$("#annsave").addEventListener("click", async () => {
  const txt = $("#anntext").value.trim(); if (!txt || !S.sel) return;
  const r = S.run;
  r.annotations = r.annotations || [];
  r.annotations.push({ id: Date.now().toString(36), side: S.sel.side, line: S.sel.line, type: $("#anntype").value, content: txt, created: new Date().toISOString(),
    by: Boxes.get("initials") || undefined, name: Boxes.get("name") || undefined });
  await api(`/api/runs/${r.id}/meta`, { annotations: r.annotations });
  $("#anntext").value = ""; S.sel = null; $("#annform").classList.remove("on");
  renderTexts(); renderAnnots();
});
function renderAnnots() {
  const r = S.run;
  $("#annots").innerHTML = (r.annotations || []).map((a, i) => `<div class="annot" style="--c:var(--a-${a.type})"><span class="ty">${a.type}</span><span>${esc(a.content)} <span class="note">(${a.side} line ${a.line}${a.by ? `, ${esc(a.by)}` : ""}${a.created ? `, ${esc(a.created.slice(0, 10))}` : ""})</span></span><button class="b small" data-del="${i}">✕</button></div>`).join("");
}
$("#annots").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-del]"); if (!b) return;
  S.run.annotations.splice(+b.dataset.del, 1);
  await api(`/api/runs/${S.run.id}/meta`, { annotations: S.run.annotations });
  renderAnnots(); renderTexts();
});

// ------------------------------------------------------------------ run actions
function runAction(x) {
  if (!S.run) return;
  const id = S.run.id;
  if (x === "md") download(`/api/runs/${id}/export.md`);
  if (x === "json") download(`/api/runs/${id}/export.json`);
  if (x === "recipe") download(`/api/runs/${id}/recipe.json`);
  if (x === "band") setView("band");
  if (x === "figure") window.openFigure?.();
  if (x === "regen") regenerate(S.run.recipe, { baseline: S.run.baseline.text, bent: S.run.bent.text }, id);
}
// the run's menus, in the texts' toolbar: Export, and Run it again
const RUN_MENUS = {
  export: [["figure", "Figure (SVG or PNG)", "The run drawn from its data: the prompt, the chain, the two texts with the differences marked, and the recipe"],
           ["md", "Markdown", "The two texts, the recipe, the measures and the notes, as a Markdown file"],
           ["json", "JSON", "Everything in the run, token by token, with surprisal in bits"],
           ["recipe", "Recipe", "Just what is needed to make the run again: model, revision, prompt, seed, sampler, chain, directions"]],
  again: [["regen", "Regenerate from the recipe", "Make the run again from its recipe, and check that the texts come out the same"],
          ["band", "Control band…", "Run the original across other seeds, to see whether the diverged text lies outside ordinary variation"]],
};
let runMenu = null;
function closeRunMenu() {
  if (!runMenu) return;
  runMenu.opener.setAttribute("aria-expanded", "false");
  runMenu.remove(); runMenu = null;
}
$("#runactions").addEventListener("click", (e) => {
  const b = e.target.closest("[data-menu]"); if (!b || !S.run) return;
  const again = runMenu && runMenu.opener === b;
  closeRunMenu();
  if (again) return;
  runMenu = document.createElement("div");
  runMenu.className = "addmenu"; runMenu.setAttribute("role", "menu"); runMenu.opener = b;
  runMenu.innerHTML = RUN_MENUS[b.dataset.menu].map(([x, t, d]) => `<button role="menuitem" data-x="${x}"><b>${t}</b><span>${d}</span></button>`).join("");
  runMenu.addEventListener("click", (ev) => { const it = ev.target.closest("[data-x]"); if (it) { closeRunMenu(); runAction(it.dataset.x); } });
  runMenu.addEventListener("keydown", (ev) => {
    const bs = $$("button", runMenu), k = bs.indexOf(document.activeElement);
    if (ev.key === "Escape") { ev.preventDefault(); const o = runMenu.opener; closeRunMenu(); o.focus(); }
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); bs[(k + (ev.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length].focus(); }
  });
  document.body.appendChild(runMenu);
  const r = b.getBoundingClientRect(), m = runMenu.getBoundingClientRect();
  Object.assign(runMenu.style, { left: `${Math.max(8, r.left - m.width - 6)}px`, top: `${Math.max(8, Math.min(r.top - 6, innerHeight - 34 - m.height))}px` });
  b.setAttribute("aria-expanded", "true");
  runMenu.querySelector("button").focus();
});
document.addEventListener("pointerdown", (e) => { if (runMenu && !runMenu.contains(e.target) && !e.target.closest("[data-menu]")) closeRunMenu(); }, true);

async function regenerate(recipe, original, witnessOf) {
  setView("bench");
  busy(true);
  $("#divergence").innerHTML = `<p class="note">Regenerating from the recipe…</p>`;
  try {
    let check = null, warnings = [];
    await stream("/api/regenerate", { recipe, original, witness_of: witnessOf }, (e) => {
      if (e.type === "result") { S.run = e.run; }
      if (e.type === "regenerated") { check = e.check; warnings = e.warnings; }
      if (e.type === "model") refreshStatus();
    });
    restoreInputs(S.run.recipe);
    showRun();
    const msg = check ? (check.baseline_identical && check.bent_identical ? `<span class="pill in">identical</span> Regenerated from the recipe: both texts match the original exactly.` : `<span class="pill warn">different</span> Regenerated, but the texts differ from the original (baseline ${check.baseline_identical ? "same" : "different"}, bent ${check.bent_identical ? "same" : "different"}).`) : "Regenerated.";
    $("#divergence").insertAdjacentHTML("afterbegin", `<p class="note">${msg} ${warnings.map(esc).join(" ")}</p>`);
  } catch (e) { $("#divergence").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  busy(false); refreshStatus();
}

function restoreInputs(rc) {
  $("#prompt").value = rc.prompt; $("#seed").value = rc.seed;
  $("#temp").value = rc.sampler.temperature; $("#topk").value = rc.sampler.top_k; $("#topp").value = rc.sampler.top_p; $("#maxtok").value = rc.sampler.max_new_tokens;
  chainTA.value = rc.chain.text; Desk.render(); validateChain(); saveInputs(); store.set("chain", chainTA.value);
}

// ------------------------------------------------------------------ probabilities
function heatColour(lp) {
  const p = Math.exp(lp);
  if (p >= 0.7) return "transparent";
  const t = Math.pow(1 - p / 0.7, 0.75);
  const hue = Math.round(52 - 47 * t), sat = Math.round(88 + 7 * t);
  return dark() ? `hsla(${hue},${sat}%,${Math.round(32 - 12 * t)}%,${0.25 + 0.55 * t})` : `hsla(${hue},${sat}%,${Math.round(92 - 50 * t)}%,${0.18 + 0.82 * t})`;
}
function heatPanel(title, sub, tokens, recs) {
  const bits = recs.map((r) => -r.lp / LN2);
  const mean = bits.length ? bits.reduce((a, b) => a + b, 0) / bits.length : 0;
  const spans = recs.map((r, i) => `<span class="tok" data-tip="${esc(JSON.stringify({ t: tokens[i], lp: r.lp, ent: r.ent, rank: r.rank, top: r.top }))}" style="background:${heatColour(r.lp)}">${esc(tokens[i])}</span>`).join("");
  return `<div class="panel"><div class="ph"><b>${title}</b><span>${sub}</span><span class="stat">${S.unit === "bits" ? `${fmt(mean)} bits/token` : `perplexity ${fmt(2 ** mean, 2)}`}</span></div><div class="text heat" style="padding-left:12px">${spans}</div></div>`;
}
function renderProbs() {
  const r = S.run;
  if (!r) return;
  const bt = r.baseline.tokens.map((t) => t.t), nt = r.bent.tokens.map((t) => t.t);
  $("#probsbody").innerHTML =
    heatPanel("Original", "under the original model (its own)", bt, r.baseline.tokens) +
    heatPanel("Diverged", "under the diverged model (its own)", nt, r.bent.tokens) +
    heatPanel("Original", "under the diverged model", bt, r.scores.baseline_under_bent) +
    heatPanel("Diverged", "under the original model", nt, r.scores.bent_under_baseline);
}
$("#unitmode").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  S.unit = b.dataset.u; $$("#unitmode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  renderProbs(); if (S.run) showRun();
});
const tip = $("#tip");
document.addEventListener("mousemove", (e) => {
  const el = e.target.closest("[data-tip]");
  if (!el) { tip.style.display = "none"; return; }
  // the tokens' tips are JSON; the desk's knobs carry plain-text tips, shown by workspace.js
  let d; try { d = JSON.parse(el.dataset.tip); } catch (_) { tip.style.display = "none"; return; }
  if (!d || typeof d !== "object" || !("lp" in d)) { tip.style.display = "none"; return; }
  const p = Math.exp(d.lp), bits = -d.lp / LN2;
  tip.innerHTML = `<b>${esc(JSON.stringify(d.t))}</b> p ${fmt(p)} · ${S.unit === "bits" ? `${fmt(bits, 2)} bits` : `1/p ${fmt(1 / p, 1)}`} · rank ${d.rank} · entropy ${fmt(d.ent, 2)} bits${topkHTML({ top: d.top }, d.t)}`;
  tip.style.display = "block";
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 330) + "px"; tip.style.top = (e.clientY + 16) + "px";
});

// ------------------------------------------------------------------ tokens mode: click shows top-k
document.addEventListener("click", (e) => {
  const t = e.target.closest(".tok[data-i]");
  if (!t || !S.run) return;
  const rec = S.run[t.dataset.side].tokens[+t.dataset.i];
  $("#divergence").innerHTML = `<h3>${t.dataset.side}, token ${+t.dataset.i + 1}: ${esc(JSON.stringify(rec.t))}</h3><div class="dl">p ${fmt(Math.exp(rec.lp))}, rank ${rec.rank}, entropy ${fmt(rec.ent, 2)} bits${topkHTML(rec, rec.t)}</div>`;
});

// ------------------------------------------------------------------ dose sweep
function fillSweepKnobs() {
  const ks = Desk.sweepables();
  const cur = $("#sweepknob").value;
  $("#sweepknob").innerHTML = ks.length ? ks.map((k, i) => `<option value="${i}" ${`${k.lineno}:${k.key}` === cur ? "selected" : ""}>${esc(k.label)} (now ${k.cur})</option>`).join("") : `<option value="">Add a strip with a number to sweep (Scale, Steer, Noise…)</option>`;
  S.sweepables = ks;
  $("#sweeprule").textContent = "Breakdown is marked at the first dose where distinct-2 falls below half the original's, the repetition rate exceeds 0.5, or the mean surprisal under the original model exceeds three times the original text's.";
}
$("#sweepknob").addEventListener("change", () => {
  const k = S.sweepables[+$("#sweepknob").value]; if (!k) return;
  $("#sweepfrom").value = k.min; $("#sweepto").value = k.max;
});
$("#sweepbtn").addEventListener("click", async () => {
  const k = S.sweepables?.[+$("#sweepknob").value];
  if (!k) return alert("Choose a knob.");
  const a = +$("#sweepfrom").value, b = +$("#sweepto").value, n = Math.max(2, Math.min(41, +$("#sweepn").value));
  const values = Array.from({ length: n }, (_, i) => +(a + (b - a) * i / (n - 1)).toFixed(4));
  $("#sweepout").innerHTML = ""; $("#sweepchart").innerHTML = "";
  $("#sweepbtn").disabled = true; $("#sweepstop").disabled = false;
  const rows = []; let base = null;
  try {
    await stream("/api/sweep", { prompt: $("#prompt").value, chain: chainTA.value, sampler: sampler(), seed: +$("#seed").value, lineno: k.lineno, key: k.key, values }, (e) => {
      if (e.type === "baseline") { base = e; $("#sweepout").insertAdjacentHTML("beforeend", `<div class="dose"><div class="dh"><b>original</b><span>distinct-2 ${fmt(e.metrics.distinct2)}</span><span>${unitVal(e.metrics.own_bits)}</span></div><div class="dt">${esc(e.text)}</div></div>`); }
      if (e.type === "dose") { rows.push(e.row); addDose(e.row); $("#sweepprog").style.width = (rows.length / n * 100) + "%"; drawSweep(rows, base, k); }
      if (e.type === "sweep") { S.sweep = e.sweep; drawSweep(rows, base, k, e.sweep.breakdown); loadSweeps(); }
    });
  } catch (e) { $("#sweepout").insertAdjacentHTML("afterbegin", `<p class="err">${esc(e.message)}</p>`); }
  $("#sweepbtn").disabled = false; $("#sweepstop").disabled = true; refreshStatus();
});
$("#sweepstop").addEventListener("click", stopJob);
function showSavedSweep(sw) {
  S.sweep = sw;
  $("#sweepout").innerHTML = `<p class="note">Saved sweep ${esc(sw.id)}: ${esc(sw.model.model_id)}, seed ${sw.seed}, prompt “${esc(sw.prompt)}”.</p><div class="dose"><div class="dh"><b>original</b><span>distinct-2 ${fmt(sw.baseline.metrics.distinct2)}</span><span>${unitVal(sw.baseline.metrics.own_bits)}</span></div><div class="dt">${esc(sw.baseline.text)}</div></div>`;
  sw.rows.forEach((r) => addDose(r, sw.key));
  drawSweep(sw.rows, sw.baseline, { key: sw.key }, sw.breakdown);
}
async function loadSweeps() {
  try {
    const { sweeps } = await api("/api/sweeps");
    $("#sweepsaved").innerHTML = `<option value="">…</option>` + sweeps.map((w) => `<option value="${esc(w.file)}">${esc(w.file.replace(".json", ""))} · ${esc(w.key)} · ${esc(w.model)}</option>`).join("");
  } catch (e) { /* none */ }
}
$("#sweepsaved").addEventListener("change", async () => { if ($("#sweepsaved").value) showSavedSweep(await api(`/api/sweeps/${$("#sweepsaved").value}`)); });
function addDose(row, key) {
  const m = row.metrics, d = row.distance;
  key = key || S.sweepables[+$("#sweepknob").value].key;
  $("#sweepout").insertAdjacentHTML("beforeend", `<div class="dose${row.broken.length ? " broken" : ""}"><div class="dh"><b>${esc(row.chain.split("\n").find((l) => l.includes(`${key}=${row.value}`)) || row.value)}</b>
    <span>edit ${fmt(d.edit)}</span><span>distinct-2 ${fmt(m.distinct2)}</span><span>repetition ${fmt(m.repetition)}</span><span>under the original ${unitVal(m.other_bits)}</span>${row.broken.length ? `<span class="pill warn" title="${esc(row.broken.join("; "))}">broken</span>` : ""}</div><div class="dt">${esc(row.text)}</div></div>`);
}
function lineChart(series, xs, opts = {}) {
  const W = 420, H = 170, L = 44, R = 10, T = 22, B = 24;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const X = (x) => L + (xmax === xmin ? 0.5 : (x - xmin) / (xmax - xmin)) * (W - L - R);
  return `<div class="charts">` + series.map((s) => {
    const vals = s.values.filter((v) => v !== null && isFinite(v));
    let ymin = Math.min(...vals, s.base ?? Infinity), ymax = Math.max(...vals, s.base ?? -Infinity);
    if (s.zero) ymin = Math.min(0, ymin);
    if (ymax === ymin) ymax = ymin + 1;
    const Y = (v) => T + (1 - (v - ymin) / (ymax - ymin)) * (H - T - B);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.name)}"><text x="${L}" y="12">${esc(s.name)}</text>`;
    svg += `<line x1="${L}" x2="${W - R}" y1="${Y(ymin)}" y2="${Y(ymin)}" stroke="var(--border)"/><text x="${L - 6}" y="${Y(ymin) + 3}" text-anchor="end">${fmt(ymin, 2)}</text><text x="${L - 6}" y="${Y(ymax) + 8}" text-anchor="end">${fmt(ymax, 2)}</text>`;
    if (s.base !== undefined && s.base !== null) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(s.base)}" y2="${Y(s.base)}" stroke="var(--text-3)" stroke-dasharray="3 3"/>`;
    if (opts.mark !== undefined && opts.mark !== null) svg += `<line x1="${X(opts.mark)}" x2="${X(opts.mark)}" y1="${T}" y2="${H - B}" stroke="var(--critical)" stroke-dasharray="4 3"/>`;
    const pts = s.values.map((v, i) => (v === null || !isFinite(v) ? null : `${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean);
    svg += `<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts.join(" ")}"/>`;
    s.values.forEach((v, i) => { if (v !== null && isFinite(v)) svg += `<circle cx="${X(xs[i])}" cy="${Y(v)}" r="3" fill="var(--accent)"><title>${xs[i]}: ${fmt(v)}</title></circle>`; });
    xs.forEach((x, i) => { if (i % Math.ceil(xs.length / 8) === 0 || i === xs.length - 1) svg += `<text x="${X(x)}" y="${H - 6}" text-anchor="middle">${x}</text>`; });
    return svg + "</svg>";
  }).join("") + `</div>`;
}
function drawSweep(rows, base, k, breakdown) {
  const xs = rows.map((r) => r.value);
  const bm = base?.metrics;
  $("#sweepchart").innerHTML = lineChart([
    { name: "word edit distance from the original", values: rows.map((r) => r.distance.edit), zero: true },
    { name: "distinct-2 (dashed: original)", values: rows.map((r) => r.metrics.distinct2), base: bm?.distinct2, zero: true },
    { name: "repetition rate (dashed: original)", values: rows.map((r) => r.metrics.repetition), base: bm?.repetition, zero: true },
    { name: "mean surprisal under the original model, bits (dashed: original text)", values: rows.map((r) => r.metrics.other_bits), base: bm?.own_bits },
  ], xs, { mark: breakdown }) + (breakdown !== undefined ? `<p class="note">${breakdown === null ? "No breakdown in this range by the rule above." : `Breakdown at ${k.key} = ${breakdown} (red line).`}</p>` : "");
}

// ------------------------------------------------------------------ control band
function renderBand() {
  const r = S.run;
  $("#bandfor").textContent = r ? `for run ${r.id}, seed ${r.recipe.seed}` : "run a chain on the Bench first";
  if (!r?.band) { $("#bandout").innerHTML = r ? `<p class="note">No band yet for this run.</p>` : ""; return; }
  const b = r.band;
  const names = { edit: "Word edit distance from the original", bigram: "Bigram distance", first_divergence: "First divergence (token)", distinct2: "Distinct-2", repetition: "Repetition", own_bits: "Surprisal under its own model (bits)", under_base_bits: "Surprisal under the original model (bits)" };
  let html = `<table class="t"><tr><th>Measure</th><th>Diverged</th><th>Band (min to max, ${b.n} reseeds)</th><th>Mean ± sd</th><th></th><th style="width:34%">Spread</th></tr>`;
  for (const [k, s] of Object.entries(b.summary)) {
    const lo = Math.min(s.min, s.bent), hi = Math.max(s.max, s.bent), w = hi - lo || 1;
    const vals = b.rows.map((x) => x[k]).filter((v) => !(k === "first_divergence" && v < 0));
    const dots = vals.map((v) => `<circle cx="${4 + (v - lo) / w * 292}" cy="9" r="3" fill="var(--text-3)"/>`).join("");
    const strip = `<svg viewBox="0 0 300 18" style="width:100%;height:18px"><rect x="${4 + (s.min - lo) / w * 292}" y="4" width="${Math.max(1, (s.max - s.min) / w * 292)}" height="10" fill="color-mix(in srgb, var(--text-3) 18%, transparent)"/>${dots}<rect x="${(s.bent - lo) / w * 292 + 2}" y="1" width="4" height="16" fill="var(--accent)"/></svg>`;
    const fd = k === "first_divergence", sh = (v) => (fd ? String(v + 1) : fmt(v));
    html += `<tr><td>${names[k] || k}</td><td class="n">${fd && s.bent < 0 ? "none" : sh(s.bent)}</td><td class="n">${sh(s.min)} to ${sh(s.max)}</td><td class="n">${fd ? fmt(s.mean + 1, 1) : fmt(s.mean)} ± ${fmt(s.sd)}${s.sd > 0 && !fd ? ` <span class="muted">(bent ${(s.bent - s.mean) / s.sd >= 0 ? "+" : ""}${fmt((s.bent - s.mean) / s.sd, 1)} sd)</span>` : ""}</td><td>${s.inside === null ? "" : s.inside ? `<span class="pill in">inside the band</span>` : `<span class="pill out">outside the band</span>`}</td><td>${strip}</td></tr>`;
  }
  html += `</table><p class="note">${esc(b.note)} Grey dots: reseeds; grey bar: their range; blue: the diverged run.</p><h3>The reseeded originals</h3><div class="stack">` +
    b.rows.map((x) => `<div class="dose"><div class="dh"><b>seed ${x.seed}</b><span>edit ${fmt(x.edit)}</span><span>distinct-2 ${fmt(x.distinct2)}</span></div><div class="dt">${esc(x.text)}</div></div>`).join("") + `</div>`;
  $("#bandout").innerHTML = html;
}
$("#bandbtn").addEventListener("click", async () => {
  if (!S.run) return alert("Run a chain on the Bench first.");
  const n = +$("#bandn").value;
  $("#bandbtn").disabled = true; $("#bandstop").disabled = false;
  $("#bandout").innerHTML = "";
  try {
    await stream(`/api/runs/${S.run.id}/band`, { n }, (e) => {
      if (e.type === "reseed") { $("#bandprog").style.width = (e.i / e.n * 100) + "%"; $("#bandout").innerHTML = `<p class="note">Reseed ${e.i} of ${e.n}…</p>`; }
      if (e.type === "band") { S.run.band = e.band; renderBand(); }
    });
  } catch (e) { $("#bandout").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  $("#bandbtn").disabled = false; $("#bandstop").disabled = true; refreshStatus();
});
$("#bandstop").addEventListener("click", stopJob);

// ------------------------------------------------------------------ component map
function mapCost() {
  const m = S.model; if (!m) { $("#mapcost").textContent = ""; return; }
  const kind = $("#mapkind").value, heads = kind.startsWith("head");
  const cells = m.n_layers * (heads ? m.n_heads : 1), prompts = $("#mapprompts").value.split("\n").filter((x) => x.trim()).length;
  $("#mapcost").textContent = `${cells} cells × ${prompts} prompt${prompts === 1 ? "" : "s"} = ${cells * prompts} generations of ${$("#maptok").value} tokens, each scored once.`;
}
["#mapkind", "#mapprompts", "#maptok"].forEach((s) => $(s).addEventListener("input", mapCost));
$("#mapbtn").addEventListener("click", async () => {
  if (!S.model) return alert("Load a model first.");
  const prompts = $("#mapprompts").value.split("\n").filter((x) => x.trim());
  $("#mapbtn").disabled = true; $("#mapstop").disabled = false;
  S.map = { kind: $("#mapkind").value, grain: null, cells: [], baseline: null };
  $("#mapcell").innerHTML = "";
  try {
    await stream("/api/map", { kind: $("#mapkind").value, prompts, sampler: { ...sampler(), max_new_tokens: +$("#maptok").value }, seed: +$("#seed").value, k: +$("#mapk").value, chain: $("#mapchain").checked ? chainTA.value : "" }, (e) => {
      if (e.type === "map-start") Object.assign(S.map, { grain: e.grain, n_layers: e.n_layers, n_heads: e.n_heads, baseline: e.baseline, baseline_texts: e.baseline_texts, prompts: e.prompts });
      if (e.type === "cell") { S.map.cells.push(e.cell); $("#mapprog").style.width = (e.done / e.of * 100) + "%"; $("#mapnote").textContent = `${e.done} of ${e.of} cells, about ${Math.round(e.eta)} s to go.`; drawMap(); }
      if (e.type === "map") { S.map = e.map; S.map.n_layers = S.model.n_layers; S.map.n_heads = e.map.grain === "head" ? S.model.n_heads : 1; drawMap(); loadMaps(); $("#mapnote").textContent = `Done. Saved as ${e.map.id}.`; }
    });
  } catch (e) { $("#mapnote").innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  $("#mapbtn").disabled = false; $("#mapstop").disabled = true; refreshStatus();
});
$("#mapstop").addEventListener("click", stopJob);
$("#mapprobe").addEventListener("change", drawMap);
async function loadMaps() {
  try {
    const { maps } = await api("/api/maps");
    $("#mapsaved").innerHTML = `<option value="">…</option>` + maps.map((m) => `<option value="${esc(m.file)}">${esc(m.file.replace(".json", ""))} · ${esc(m.model)}@${esc(m.revision)}</option>`).join("");
  } catch (e) { /* none */ }
}
$("#mapsaved").addEventListener("change", async () => {
  if (!$("#mapsaved").value) return;
  const m = await api(`/api/maps/${$("#mapsaved").value}`);
  m.n_layers = m.model.n_layers; m.n_heads = m.grain === "head" ? m.model.n_heads : 1;
  S.map = m; showMapSettings(m); drawMap();
});
function showMapSettings(m) {
  $("#mapkind").value = m.kind;
  $("#mapprompts").value = m.prompts.join("\n");
  $("#maptok").value = m.sampler.max_new_tokens;
  $("#mapnote").textContent = `Saved map ${m.id}: ${m.model.model_id} @ ${m.model.revision}, seed ${m.seed}, ${m.cells.length} cells.`;
}
function drawMap() {
  const M = S.map; if (!M || !M.cells.length) { $("#mapgrid").innerHTML = ""; return; }
  const probe = $("#mapprobe").value, base = M.baseline?.[probe] ?? 0;
  const deltas = M.cells.map((c) => c.values[probe] - base);
  const amax = Math.max(1e-9, ...deltas.map(Math.abs));
  const cols = M.n_heads || 1;
  const col = (d) => {
    const t = Math.min(1, Math.abs(d) / amax);
    return d >= 0 ? `color-mix(in srgb, #d0583b ${Math.round(t * 85)}%, var(--surface-2))` : `color-mix(in srgb, #2a78d6 ${Math.round(t * 85)}%, var(--surface-2))`;
  };
  let html = `<div class="mapgrid" style="grid-template-columns: 28px repeat(${cols}, minmax(0,1fr))"><span></span>` +
    Array.from({ length: cols }, (_, h) => `<span class="lab">${M.grain === "head" ? h : ""}</span>`).join("");
  for (let l = 0; l < M.n_layers; l++) {
    html += `<span class="lab">${l}</span>`;
    for (let h = 0; h < cols; h++) {
      const i = M.cells.findIndex((c) => c.layer === l && (M.grain !== "head" || c.head === h));
      if (i < 0) { html += `<span class="c" style="background:var(--surface-2)"></span>`; continue; }
      const d = deltas[i];
      html += `<span class="c${S.mapCell === i ? " sel" : ""}" data-c="${i}" style="background:${col(d)}" title="${esc(M.cells[i].line)}: ${fmt(M.cells[i].values[probe])} (baseline ${fmt(base)})">${fmt(d, 1)}</span>`;
    }
  }
  html += `</div><p class="note">Rows: blocks. ${M.grain === "head" ? "Columns: heads. " : ""}Colour: the cell's probe value minus the original's (${fmt(base)}), averaged over the prompts; red above, blue below, scaled to the largest change (${fmt(amax)}). Click a cell to read its texts.</p>`;
  $("#mapgrid").innerHTML = html;
}
$("#mapgrid").addEventListener("click", (e) => {
  const c = e.target.closest("[data-c]"); if (!c) return;
  S.mapCell = +c.dataset.c; drawMap();
  const cell = S.map.cells[S.mapCell];
  $("#mapcell").innerHTML = `<h3>${esc(cell.line)}</h3><table class="t">${Object.entries(cell.values).map(([k, v]) => `<tr><td>${k}</td><td class="n">${fmt(v)}</td><td class="n muted">baseline ${fmt(S.map.baseline[k])}</td></tr>`).join("")}</table>` +
    cell.texts.map((t, i) => `<div class="dose" style="margin-top:8px"><div class="dh"><b>${esc(S.map.prompts[i])}</b></div><div class="dt">${esc(t)}</div><div class="dh" style="margin-top:6px"><span class="muted">baseline: ${esc(S.map.baseline_texts[i])}</span></div></div>`).join("") +
    `<button class="b small" style="margin-top:10px" id="mapopen">Put this on the Bench</button>`;
  $("#mapopen").addEventListener("click", () => {
    chainTA.value = (chainTA.value.trim() ? chainTA.value.trim() + "\n" : "") + cell.line;
    $("#prompt").value = S.map.prompts[0]; Desk.render(); chainChanged(); setView("bench");
  });
});

// ------------------------------------------------------------------ directions
async function loadDirections() {
  try {
    const { directions, contrasts } = await api("/api/directions");
    S.dirs = directions; S.contrasts = contrasts;
    const mine = directions.filter((d) => !S.model || d.model === S.model.model_id || !d.model);
    Desk.setDirections(mine.map((d) => d.name));
    $("#dircontrast").innerHTML = `<option value="">Two lists below</option>` + contrasts.map((c) => `<option value="${esc(c.id)}">${esc(c.title)} (${c.positive.length} + ${c.negative.length})</option>`).join("");
    $("#dirlist").innerHTML = directions.length ? `<table class="t"><tr><th>Name</th><th>Model</th><th>Layer</th><th>Norm</th><th>Source</th><th></th></tr>` + directions.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td class="n">${esc(d.model || "?")}</td><td class="n">${d.layer}${d.per_layer ? " (all)" : ""}</td><td class="n">${fmt(d.norm, 1)}</td><td>${dirSource(d)}${d.per_layer && d.norms ? `<div class="chart">${sepChart(d)}</div>` : ""}</td><td><a class="b small" href="/api/directions/${encodeURIComponent(d.name)}/export.json" download>Export</a> <a class="b small" href="/api/directions/${encodeURIComponent(d.name)}/export.gguf" download title="As a llama.cpp control vector">GGUF</a> <button class="b small" data-deldir="${esc(d.name)}">✕</button></td></tr>`).join("") + `</table>` : `<p class="note">None yet.</p>`;
  } catch (e) { $("#dirlist").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
function dirSource(d) {
  if (d.kind === "word") return `word <code>${esc(JSON.stringify(d.word))}</code>` + (d.tokens && d.tokens.length > 1 ? ` <span class="muted">(first token ${esc(JSON.stringify(d.tokens[0]))})</span>` : "") + ` <span class="muted">every layer</span>`;
  if (d.kind === "text") return `${d.n_positive} ${d.n_positive === 1 ? "text" : "texts"} against the corpus`;
  if (d.kind === "combination") return `the sum <code>${esc(d.expr || "")}</code>`;
  if (d.kind === "gguf") return `a control vector <code>${esc(d.file || "")}</code>${d.model_hint ? ` <span class="muted">(${esc(d.model_hint)})</span>` : ""}`;
  if (d.method && d.method !== "mean") return `${esc(d.kind || "")} ${d.n_positive}+${d.n_negative}, <span class="muted">${esc(d.method)}</span>`;
  if (d.kind === "decision") return `where it is about to write ${(d.words || []).map((w) => `<code>${esc(JSON.stringify(w))}</code>`).join(", ")} <span class="muted">(${d.high} of ${d.positions} positions)</span>`;
  return `${esc(d.kind || "")} ${d.n_positive}+${d.n_negative}`;
}
function sepChart(d) {
  const n = d.norms || [], s = d.separability || n.map(() => null), W = 220, H = 40, mx = Math.max(...n, 1e-9);
  const bw = W / s.length;
  return `<svg viewBox="0 0 ${W} ${H}" style="max-width:220px">` + s.map((v, i) => `<rect x="${i * bw + 1}" y="${H - (n[i] / mx) * (H - 4)}" width="${bw - 2}" height="${(n[i] / mx) * (H - 4)}" fill="${i === d.layer ? "var(--accent)" : "color-mix(in srgb, var(--text-3) 40%, transparent)"}"><title>layer ${i}: norm ${fmt(n[i], 1)}${v === null ? "" : `, separability ${fmt(v, 2)}`}</title></rect>`).join("") + `</svg>`;
}
$("#dircontrast").addEventListener("change", () => {
  const c = S.contrasts.find((x) => x.id === $("#dircontrast").value);
  $("#dirpos").value = c ? c.positive.join("\n") : ""; $("#dirneg").value = c ? c.negative.join("\n") : "";
  $("#dircontrastnote").textContent = c ? c.notes : "";
  if (c && !$("#dirname").value) $("#dirname").value = c.id;
});
$("#dirmake").addEventListener("click", async () => {
  const b = $("#dirmake"); b.disabled = true; b.textContent = "Making…";
  try {
    const c = $("#dircontrast").value, kind = S.dirKind || "lists", base = { name: $("#dirname").value.trim(), layer: $("#dirlayer").value.trim() };
    if (kind === "word") await api("/api/directions/make", { ...base, kind, word: $("#dirword").value });
    else if (kind === "text") await api("/api/directions/make", { ...base, kind, texts: $("#dirtext").value.split("\n") });
    else if (kind === "combine") await api("/api/directions/make", { ...base, kind, expr: $("#dircombine").value });
    else if (kind === "decision") await api("/api/directions/make", { ...base, kind, words: $("#dirdwords").value, texts: $("#dirdtext").value.split("\n"), share: $("#dirdshare").value });
    else await api("/api/directions/make", { ...base, method: $("#dirmethod").value, contrast: c || undefined,
      positive: c ? undefined : $("#dirpos").value.split("\n"), negative: c ? undefined : $("#dirneg").value.split("\n") });
    await loadDirections(); validateChain();
  } catch (e) { alert(e.message); }
  b.disabled = false; b.textContent = "Make the direction";
});
// neurons that fire differently where the model is about to write the words; each can go on the desk
$("#neurfind").addEventListener("click", async () => {
  const b = $("#neurfind"); b.disabled = true; b.textContent = "Finding…";
  try {
    const r = await api("/api/neurons/find", { words: $("#dirdwords").value, texts: $("#dirdtext").value.split("\n"), share: $("#dirdshare").value });
    const line = (n) => `neuron block=${n.block} n=${n.neuron} op=zero`;
    $("#neurlist").innerHTML = `<p class="note">Neurons that fire most differently where the next token is likely to be ${r.tokens.map((t) => `<code>${esc(JSON.stringify(t))}</code>`).join(", ")} (${r.high} of ${r.positions} positions, against the lowest ${r.low}). Score: the difference of mean activation times the size of what the neuron writes; positive fires more where the word is coming. A ranking to test, not a cause: put one on the desk and run.</p>` +
      `<table class="t"><tr><th>Block.neuron</th><th>Score</th><th>Activation there / elsewhere</th><th>Writes</th><th title="The difference of activation times how far what the neuron writes points to the words: its direct push toward them">Toward the words</th><th></th></tr>` +
      r.neurons.map((n) => `<tr><td class="n"><b>${n.block}.${n.neuron}</b></td><td class="n">${fmt(n.score, 2)}</td><td class="n">${fmt(n.hi, 2)} / ${fmt(n.lo, 2)}</td><td class="n">${fmt(n.write, 1)}</td><td class="n">${fmt(n.toward, 2)}</td><td><button class="b small" data-addneur="${esc(line(n))}" title="Put ${esc(line(n))} on the desk">Add</button></td></tr>`).join("") + `</table>`;
  } catch (e) { $("#neurlist").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  b.disabled = false; b.textContent = "Find neurons";
});
$("#neurlist").addEventListener("click", (e) => {
  const b = e.target.closest("[data-addneur]"); if (!b) return;
  Desk.insertLines([b.dataset.addneur], Infinity); b.textContent = "Added"; b.disabled = true;
});
// contrast pairs from a template (inspired by repeng): each positive word with the negative in the same
// place, once for every ending
$("#tmplfill").addEventListener("click", async () => {
  const t = $("#tmpl").value, pos = $("#tmplpos").value.split(",").map((x) => x.trim()).filter(Boolean),
    neg = $("#tmplneg").value.split(",").map((x) => x.trim()).filter(Boolean);
  if (!t.includes("{x}")) { alert("Put {x} in the template where the words go."); return; }
  if (!pos.length || pos.length !== neg.length) { alert("Give as many negative words as positive, in the same order."); return; }
  let ends = [""];
  if ($("#tmplsuf").value === "corpus") {
    const { passages } = await api("/api/corpus");
    ends = [];
    for (const p of passages.slice(0, 24)) { const w = p.split(/\s+/); for (const k of [1, 3, 5]) if (w.length > k) ends.push(w.slice(0, k).join(" ")); }
  }
  const P = [], N = [];
  pos.forEach((p, i) => ends.forEach((e) => { P.push((t.replace("{x}", p) + (e ? " " + e : "")).trim()); N.push((t.replace("{x}", neg[i]) + (e ? " " + e : "")).trim()); }));
  $("#dircontrast").value = ""; $("#dirpos").value = P.join("\n"); $("#dirneg").value = N.join("\n");
  $("#dircontrastnote").textContent = `${P.length} pairs from the template.`;
});
// what a direction is made from: two lists, a word, or a sentence or passage
$("#dirkind").addEventListener("click", (e) => {
  const b = e.target.closest("[data-k]"); if (!b) return;
  S.dirKind = b.dataset.k;
  $$("#dirkind button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  $$("[data-dk]").forEach((d) => { d.hidden = d.dataset.dk !== S.dirKind; });
  $("#dirlayer").disabled = S.dirKind === "word";
});
$("#dirfile").addEventListener("change", async () => {
  const f = $("#dirfile").files[0]; if (!f) return;
  if (/\.gguf$/i.test(f.name)) {
    try {
      const name = prompt("Name for this direction", f.name.replace(/\.gguf$/i, "").replace(/[^A-Za-z0-9_.-]+/g, "-"));
      if (name) {
        const r = await fetch(`/api/directions/import-gguf?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "X-Abliteration": "1" }, body: await f.arrayBuffer() });
        const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        await loadDirections();
      }
    } catch (e) { alert(e.message); }
    $("#dirfile").value = ""; return;
  }
  try { const data = JSON.parse(await f.text()); await api("/api/directions/import", { data, name: prompt("Name for this direction", data.name || f.name.replace(/\.json$/, "")) }); await loadDirections(); }
  catch (e) { alert(e.message); }
  $("#dirfile").value = "";
});
$("#dirlist").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-deldir]"); if (!b) return;
  if (!confirm(`Delete the direction ${b.dataset.deldir}? Runs that used it keep a copy in their recipe.`)) return;
  await api(`/api/directions/${encodeURIComponent(b.dataset.deldir)}`, {}, "DELETE"); loadDirections();
});

// ------------------------------------------------------------------ variorum
async function loadVariorum() {
  const { runs } = await api("/api/runs");
  S.runs = runs;
  $("#vartable").innerHTML = `<tr><th></th><th>Run</th><th>Model</th><th>Seed</th><th>Chain</th><th>Diverged text</th><th>Edit</th><th></th></tr>` + runs.map((r) => `<tr class="${S.run?.id === r.id ? "cur" : ""}">
    <td><input type="checkbox" data-pick="${r.id}"></td><td class="n">${esc(r.id)}${r.label ? `<br><span class="muted">${esc(r.label)}</span>` : ""}${r.band ? ` <span class="pill">band</span>` : ""}${r.n_annotations ? ` <span class="pill">${r.n_annotations} notes</span>` : ""}</td>
    <td class="n">${esc(r.model.split("/").pop())}@${esc(r.revision)}</td><td class="n">${r.seed}</td><td class="n">${esc(r.chain).replace(/\n/g, "<br>") || "<span class='muted'>empty</span>"}</td>
    <td>${esc(r.bent)}…</td><td class="n">${fmt(r.distance.edit, 2)}</td>
    <td><button class="b small" data-open="${r.id}">Open</button> <button class="b small" data-label="${r.id}">Label</button> <button class="b small" data-rm="${r.id}">✕</button></td></tr>`).join("");
  // descent: parent (a chain derived from another run) and witness (a regeneration or reseed)
  const by = Object.fromEntries(runs.map((r) => [r.id, r]));
  const kids = {};
  runs.forEach((r) => { const p = r.parent || r.witness_of; if (p && by[p]) (kids[p] = kids[p] || []).push(r); });
  const roots = runs.filter((r) => !((r.parent && by[r.parent]) || (r.witness_of && by[r.witness_of]))).reverse();
  const lines = [];
  const walk = (r, pre, last, rel) => {
    lines.push(`${pre}${pre ? (last ? "└─ " : "├─ ") : ""}${rel ? rel + " " : ""}${r.id}${r.label ? " " + r.label : ""}  ${r.chain.replace(/\n/g, " | ") || "(empty)"}`);
    const ks = (kids[r.id] || []).reverse();
    ks.forEach((k, i) => walk(k, pre + (pre ? (last ? "   " : "│  ") : " "), i === ks.length - 1, k.witness_of === r.id ? "[witness]" : "[derived]"));
  };
  roots.forEach((r) => walk(r, "", true, ""));
  $("#vartree").textContent = lines.join("\n") || "No runs yet.";
}
$("#varrefresh").addEventListener("click", loadVariorum);
$("#vartable").addEventListener("click", async (e) => {
  const o = e.target.closest("[data-open]"), rm = e.target.closest("[data-rm]"), lb = e.target.closest("[data-label]");
  if (o) { S.run = await api(`/api/runs/${o.dataset.open}`); S.parent = S.run.id; restoreInputs(S.run.recipe); showRun(); setView("bench"); }
  if (rm && confirm(`Delete run ${rm.dataset.rm}? This cannot be undone.`)) { await api(`/api/runs/${rm.dataset.rm}`, {}, "DELETE"); loadVariorum(); }
  if (lb) { const t = prompt("Label for this run"); if (t !== null) { await api(`/api/runs/${lb.dataset.label}/meta`, { label: t }); loadVariorum(); } }
});
function wordDiff(a, b) {   // LCS over word-and-space tokens
  const A = a.match(/\s+|\S+/g) || [], B = b.match(/\s+|\S+/g) || [];
  const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push(["common", A[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(["removed", A[i++]]); else out.push(["added", B[j++]]); }
  while (i < n) out.push(["removed", A[i++]]); while (j < m) out.push(["added", B[j++]]);
  return out;
}
$("#varcompare").addEventListener("click", async () => {
  const ids = $$("[data-pick]:checked").map((x) => x.dataset.pick);
  if (ids.length !== 2) return alert("Tick two runs.");
  const [a, b] = await Promise.all(ids.map((i) => api(`/api/runs/${i}`)));
  const d = wordDiff(a.bent.text, b.bent.text);
  const side = (keep, cls) => d.filter(([op]) => op === "common" || op === keep).map(([op, t]) => op === "common" ? esc(t) : `<span class="${cls}">${esc(t)}</span>`).join("");
  const head = (r) => `<div class="ph"><b>${esc(r.id)}</b><span class="mono">${esc(r.recipe.chain.text || "(empty)").replace(/\n/g, " | ")}</span><span class="stat">seed ${r.recipe.seed}</span></div>`;
  $("#varcmp").innerHTML = `<h3>Diverged texts compared</h3>${a.recipe.model.model_id !== b.recipe.model.model_id ? `<p class="note">These runs come from different models; each text's measures stay with its own model.</p>` : ""}<div class="pair"><div class="panel">${head(a)}<div class="text" style="padding-left:12px">${side("removed", "rem")}</div></div><div class="panel">${head(b)}<div class="text" style="padding-left:12px">${side("added", "add")}</div></div></div>`;
});
$("#varbench").addEventListener("click", async () => {
  const ids = $$("[data-pick]:checked").map((x) => x.dataset.pick);
  downloadJSON(await api("/api/export/benchkit", { ids: ids.length ? ids : null }), "abliteration-benchkit-bundle.json");
});
$("#recipefile").addEventListener("change", async () => {
  const f = $("#recipefile").files[0]; if (!f) return;
  try {
    const rc = JSON.parse(await f.text());
    regenerate(rc, rc.expected || null, rc.expected?.run || null);
  } catch (e) { alert(e.message); }
  $("#recipefile").value = "";
});

// ------------------------------------------------------------------ start
(async function start() {
  applyTheme();
  const inp = store.get("inputs", null);
  applySettings({ unit: true, bandN: true, tokens: !inp });   // inputs kept from the last visit win over the starting value
  if (inp) for (const [k, v] of Object.entries(inp)) if ($("#" + k)) $("#" + k).value = v;
  chainTA.value = store.get("chain", "ablate head=5.1 mode=mean\n# steer layer=6 dir=negation scale=4\n# noise layer=4 sigma=0.3");
  Desk.init(chainTA, $("#desk"), chainChanged);
  await refreshStatus();
  try { await loadPresets(); } catch (e) { /* server not up */ }
  await loadDirections();
  validateChain();
  // a link can name a run (?run=), a view (?view=), a saved map (?map=) and its probe (?probe=)
  const q = new URLSearchParams(location.search);
  if (q.get("theme")) document.documentElement.dataset.theme = q.get("theme");
  if (q.get("run")) {
    try { S.run = await api(`/api/runs/${encodeURIComponent(q.get("run"))}`); restoreInputs(S.run.recipe); showRun(); }
    catch (e) { /* no such run */ }
  }
  if (q.get("map")) {
    try {
      const m = await api(`/api/maps/${encodeURIComponent(q.get("map"))}`);
      m.n_layers = m.model.n_layers; m.n_heads = m.grain === "head" ? m.model.n_heads : 1; S.map = m; showMapSettings(m);
      if (q.get("probe")) $("#mapprobe").value = q.get("probe");
      if (q.get("cell")) S.mapCell = +q.get("cell");
    } catch (e) { /* no such map */ }
  }
  setView(q.get("view") || store.get("view", "bench"));
  if (q.get("sweep")) { try { showSavedSweep(await api(`/api/sweeps/${encodeURIComponent(q.get("sweep"))}`)); } catch (e) { /* none */ } }
  if (S.map && q.get("map")) { drawMap(); if (S.mapCell !== null && S.mapCell !== undefined) $(`#mapgrid [data-c="${S.mapCell}"]`)?.click(); }
  if (q.get("show")) $(`#showmode [data-m="${q.get("show")}"]`)?.click();
  setInterval(refreshStatus, 4000);
})();

// a click on a token in the Tokens view shows that step on the desk's meters
for (const id of ["#basetext", "#benttext"]) $(id).addEventListener("click", (e) => {
  const t = e.target.closest("[data-i]");
  if (t && S.run && S.run.probes) Desk.setStep(+t.dataset.i);
});

// The chain's dock: drag its top edge to resize it, double-click (or Enter) to fold it to its bar
(() => {
  const dock = $("#benchdock"), h = $("#dockhandle");
  const setH = (px) => {
    const v = Math.round(Math.max(150, Math.min($("main").clientHeight - 96, px)));
    dock.style.setProperty("--dock-h", v + "px");
    requestAnimationFrame(() => Desk.fit());
    return v;
  };
  if (store.get("dockH")) setH(store.get("dockH"));
  if (store.get("dockFolded")) dock.classList.add("folded");
  const fold = () => store.set("dockFolded", dock.classList.toggle("folded"));
  h.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add("held");
    const y0 = e.clientY, h0 = dock.classList.contains("folded") ? 150 : dock.getBoundingClientRect().height;
    let moved = false;
    const mv = (ev) => {
      if (!moved && Math.abs(ev.clientY - y0) < 3) return;
      if (!moved) { moved = true; dock.classList.remove("folded"); store.set("dockFolded", false); }
      store.set("dockH", setH(h0 + (y0 - ev.clientY)));
    };
    const up = () => { h.classList.remove("held"); h.removeEventListener("pointermove", mv); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); };
    h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
  });
  h.addEventListener("dblclick", fold);
  h.addEventListener("keydown", (e) => {
    const d = { ArrowUp: 30, ArrowDown: -30 }[e.key];
    if (d) { e.preventDefault(); dock.classList.remove("folded"); store.set("dockFolded", false); store.set("dockH", setH(dock.getBoundingClientRect().height + d)); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fold(); }
  });
  addEventListener("resize", () => { if (store.get("dockH")) setH(store.get("dockH")); });
})();
