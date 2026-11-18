// Abliteration Lens: the abliteration page's figures. "Add, remove, turn": the negation direction in the
// stream and the three things a strip can do along it, each setting a real run with its text.
// "Depth": one unit moved through the layers. The trios, the edge and the takes: real texts set
// side by side. Data: abliteration-data.js (tools/abliteration_page.py).
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
(function () {
  "use strict";
  var A = window.ABL;
  if (!A) return;
  var P = A.provenance, reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function T(x, y, s, cls, extra) { return '<text x="' + x + '" y="' + y + '" class="' + (cls || "f-ink") + '"' + (extra || "") + ">" + esc(s) + "</text>"; }
  function L(x1, y1, x2, y2, cls, extra) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="' + cls + '"' + (extra || "") + "/>"; }
  function C(x, y, r, cls, extra) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" class="' + cls + '"' + (extra || "") + "/>"; }
  function arrow(x1, y1, x2, y2, cls, w) {
    var a = Math.atan2(y2 - y1, x2 - x1), h = 11;
    return L(x1, y1, x2, y2, cls, ' stroke-width="' + (w || 2.5) + '" stroke-linecap="round"') +
      '<path d="M' + x2 + " " + y2 + " L" + (x2 - h * Math.cos(a - 0.4)) + " " + (y2 - h * Math.sin(a - 0.4)) + " L" + (x2 - h * Math.cos(a + 0.4)) + " " + (y2 - h * Math.sin(a + 0.4)) + 'Z" class="' + cls.replace("s-", "f-") + '"/>';
  }
  function fmt(v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + String(+Math.abs(v).toFixed(2)); }

  /* ---------- a text beside the original: the words that differ marked ---------- */
  function words(t) { return String(t).replace(/\n+/g, " ¶ ").trim().split(/\s+/).filter(Boolean); }
  function kept(a, b) {                     // which words of b are in a longest common subsequence with a
    var n = a.length, m = b.length, D = [], i, j;
    for (i = 0; i <= n; i++) D.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) D[i][j] = a[i] === b[j] ? D[i + 1][j + 1] + 1 : Math.max(D[i + 1][j], D[i][j + 1]);
    var k = b.map(function () { return false; });
    for (i = 0, j = 0; i < n && j < m;) { if (a[i] === b[j]) { k[j] = true; i++; j++; } else if (D[i + 1][j] >= D[i][j + 1]) i++; else j++; }
    return k;
  }
  function marked(text, against, fromWord) {
    var b = words(text), k = against == null ? b.map(function () { return true; }) : kept(words(against), b);
    return b.map(function (w, i) {
      var h = w === "¶" ? '<span class="nl">¶</span>' : esc(w);
      if (fromWord != null && i === fromWord) h = '<span class="from">' + h;
      if (!k[i]) h = "<ins>" + h + "</ins>";
      return h;
    }).join(" ") + (fromWord != null && fromWord < b.length ? "</span>" : "");
  }
  function meas(r) {
    if (!r) return "";
    var bits = [];
    if (r.edit != null) bits.push("edit distance <b>" + r.edit.toFixed(2) + "</b>");
    if (r.parts != null) bits.push(r.parts < 0 ? "the same text" : "parts at token <b>" + (r.parts + 1) + "</b>");
    if (r.dufs != null) bits.push("<b>" + r.dufs.toFixed(1) + "</b> DUFS");
    if (r.neg_per_1000 != null) bits.push("negation words <b>" + r.neg_per_1000 + "</b> per 1,000 over eight seeds");
    return bits.join(" · ");
  }
  function box(el, o) {                     // o: label, line, text, against, prompt, meas, from
    el.innerHTML = '<span class="tb-label">' + esc(o.label) + "</span>" + (o.line ? '<code class="tb-line">' + esc(o.line) + "</code>" : '<span class="tb-line">&nbsp;</span>') +
      '<p class="tb-text"><span class="pr">' + esc(o.prompt || P.prompt) + "</span>" + (/^\s/.test(o.text) ? " " : "") + marked(o.text, o.against, o.from) + "</p>" +
      (o.meas ? '<p class="tb-meas">' + o.meas + "</p>" : "");
  }
  function trio(id, items) {
    var el = document.getElementById(id); if (!el) return;
    items.forEach(function (o) { var b = document.createElement("div"); b.className = "textbox"; box(b, o); el.appendChild(b); });
  }

  /* ---------- add, remove, turn ---------- */
  (function () {
    var el = document.getElementById("viz-art"); if (!el) return;
    var svg = el.querySelector("svg"), ro = el.querySelector(".readout"), tb = document.getElementById("art-text");
    var inp = el.querySelector("input[type=range]"), out = el.querySelector("output");
    var MODES = {
      add: { steps: A.moves.add, title: "Add: Steer along negation", def: 0, unit: "" },
      remove: { steps: A.moves.remove, title: "Remove: vAbliterate negation", def: 0, unit: "" },
      turn: { steps: A.moves.turn, title: "Turn: vRotate, negation toward not-x-but-y", def: 0, unit: "°" },
    };
    var mode = "add", idx = 0;
    function cur() { return MODES[mode].steps[idx]; }
    function setMode(m) {
      mode = m; var st = MODES[m].steps, j = 0;
      st.forEach(function (s, k) { if (Math.abs(s.v - MODES[m].def) < Math.abs(st[j].v - MODES[m].def)) j = k; });
      idx = j; inp.min = 0; inp.max = st.length - 1; inp.value = idx; update();
    }
    function label(s) { return mode === "turn" ? s.v + "°" : mode === "add" ? fmt(s.v) : String(s.v); }
    function update() {
      var s = cur();
      out.textContent = label(s);
      box(tb, { label: MODES[mode].title + " · " + label(s), line: s.chain, text: s.text, against: A.original, meas: meas(s) });
      draw(performance.now());
    }
    function draw(t) {
      var s = cur(), O = [210, 175], R = 120, dAng = -0.18, d = [Math.cos(dAng), Math.sin(dAng)], e2 = [-d[1], d[0]];
      var th = -0.95 + (reduced ? 0 : 0.06 * Math.sin(t / 900));
      var h = [R * Math.cos(th), R * Math.sin(th)], c = h[0] * d[0] + h[1] * d[1], q = h[0] * e2[0] + h[1] * e2[1], h2;
      if (mode === "add") h2 = [h[0] + R * 0.28 * s.v * d[0], h[1] + R * 0.28 * s.v * d[1]];
      else if (mode === "remove") h2 = [h[0] - s.v * c * d[0], h[1] - s.v * c * d[1]];
      else { var a = -s.v * Math.PI / 180, c2 = c * Math.cos(a) - q * Math.sin(a), q2 = c * Math.sin(a) + q * Math.cos(a); h2 = [c2 * d[0] + q2 * e2[0], c2 * d[1] + q2 * e2[1]]; }
      var o = "";
      for (var gx = 30; gx <= 400; gx += 30) o += L(gx, 20, gx, 320, "s-line", ' stroke-width="0.5"');
      for (var gy = 20; gy <= 320; gy += 30) o += L(30, gy, 400, gy, "s-line", ' stroke-width="0.5"');
      o += L(O[0] - 180 * d[0], O[1] - 180 * d[1], O[0] + 190 * d[0], O[1] + 190 * d[1], "s-acc", ' stroke-dasharray="6 4" stroke-width="1.3"');
      o += T(O[0] + 150 * d[0] - 40, O[1] + 150 * d[1] + 24, "negation", "f-acc t-s");
      if (mode === "turn") { o += L(O[0] - 140 * e2[0], O[1] - 140 * e2[1], O[0] + 140 * e2[0], O[1] + 140 * e2[1], "s-blue", ' stroke-dasharray="6 4" stroke-width="1"'); o += T(O[0] - 130 * e2[0] + 6, O[1] - 130 * e2[1], "not-x-but-y", "f-blue t-s"); }
      if (mode === "remove") o += L(O[0], O[1], O[0] + c * d[0], O[1] + c * d[1], "s-acc", ' stroke-width="7" stroke-linecap="round" opacity="' + (0.5 * Math.max(0, 1 - Math.min(1, s.v))) + '"');
      o += arrow(O[0], O[1], O[0] + h[0], O[1] + h[1], "s-dim", 1.6) + T(O[0] + h[0] + 8, O[1] + h[1], "h", "f-dim t-m");
      o += arrow(O[0], O[1], O[0] + h2[0], O[1] + h2[1], "s-green", 3) + T(O[0] + h2[0] + 8, O[1] + h2[1] + 14, "h′", "f-green t-m");
      o += C(O[0], O[1], 3, "f-ink");
      var form = mode === "add" ? "h′ = h + scale · v" : mode === "remove" ? "y′ = y − strength · (y · d) d" : "(h · d, h · d₂) turned by the angle";
      o += T(440, 60, MODES[mode].title, "f-ink t-l") + T(440, 86, form, "f-acc t-m");
      o += T(440, 120, mode === "add" ? "the stream at layer 6 is pushed along the direction," : mode === "remove" ? "the part along the direction is taken out of what" : "the stream's part in the plane of the two directions", "f-dim t-s");
      o += T(440, 138, mode === "add" ? "at every token, by the direction as stored" : mode === "remove" ? "each block's attention and MLP write (y)" : "is turned; the rest of the stream is left as it was", "f-dim t-s");
      o += T(440, 172, "the stream is 768 numbers; two of its directions are drawn", "f-dim t-xs t-up");
      o += T(440, 190, "the text below is a real run at this setting", "f-dim t-xs t-up");
      svg.innerHTML = o;
      var msg = s.chain + " · GPT-2 small, seed " + P.seed;
      if (ro.textContent !== msg) ro.textContent = msg;
    }
    el.querySelectorAll("button[data-mode]").forEach(function (b) {
      b.addEventListener("click", function () { el.querySelectorAll("button[data-mode]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); setMode(b.getAttribute("data-mode")); });
    });
    inp.addEventListener("input", function () { idx = +inp.value; update(); });
    var vis = true;
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { es.forEach(function (e) { vis = e.isIntersecting; }); }).observe(el);
    if (!reduced) (function loop(now) { if (vis) draw(now); requestAnimationFrame(loop); })(performance.now());
    setMode("add");
  })();

  /* ---------- the trios ---------- */
  var N = A.not, E = A.echo, M = A.movement;
  trio("trio-not", [
    { label: "The model, unbent", text: N.original, prompt: N.prompt, meas: "negation words <b>" + N.orig_neg_per_1000 + "</b> per 1,000 over eight seeds" },
    { label: "The negation words deleted from the text", line: "a find-and-delete on the words", text: N.edited, against: N.original, prompt: N.prompt },
    { label: "The model, negation projected out", line: N.model.chain, text: N.model.text, against: N.original, prompt: N.prompt, meas: meas(N.model) },
  ]);
  trio("trio-echo", [
    { label: "The model, unbent", text: A.original },
    { label: "An echo on the text", line: "each four words again, four words later", text: E.text_echo, against: A.original },
    { label: "vLookback on the stream", line: E.model.chain, text: E.model.text, against: A.original, meas: meas(E.model) },
  ]);
  trio("trio-move", [
    { label: "The model, unbent", text: A.original },
    { label: "Steer from the first token", line: M.whole.chain, text: M.whole.text, against: A.original, meas: meas(M.whole) },
    { label: "The same Steer from token 15", line: M.from15.chain, text: M.from15.text, against: A.original, meas: meas(M.from15) },
  ]);
  var edge = document.getElementById("trio-edge");
  if (edge) A.edge.forEach(function (r) { var b = document.createElement("div"); b.className = "textbox"; box(b, { label: r.label, line: r.chain, text: r.text, against: A.original, meas: meas(r) }); edge.appendChild(b); });

  /* ---------- depth: one unit through the layers ---------- */
  (function () {
    var el = document.getElementById("viz-depth"); if (!el) return;
    var svg = el.querySelector("svg"), bar = el.querySelector(".bar"), tb = document.getElementById("depth-text");
    var st = A.depth, pick = st.filter(function (s) { return s.layer === 6; })[0] || st[0];
    var lo = Math.min.apply(null, st.map(function (s) { return s.dufs; })), hi = Math.max.apply(null, st.map(function (s) { return s.dufs; }));
    var drive = (/drive=([\d.]+)/.exec(st[0].chain) || [])[1];
    st.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = String(s.layer); b.setAttribute("aria-pressed", s === pick ? "true" : "false");
      b.setAttribute("aria-label", "layer " + s.layer);
      b.addEventListener("click", function () { pick = s; bar.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); show(); });
      bar.appendChild(b);
    });
    function show() {
      var s = "", W = 66;
      for (var l = 0; l < 12; l++) {
        var x = 52 + l * W;
        s += '<rect x="' + (x + 6) + '" y="34" width="' + (W - 12) + '" height="40" rx="5" class="f-panel" style="stroke:var(--fig-line)"/>' + T(x + 12, 58, "block " + l, "f-dim t-xs");
      }
      s += L(30, 110, 930, 110, "s-ink", ' stroke-width="1.5" opacity="0.4"');
      st.forEach(function (r) {
        var x = 52 + r.layer * W, rad = 4 + 11 * (r.dufs - lo) / ((hi - lo) || 1), on = r === pick;
        s += C(x, 110, rad.toFixed(1), r.parts < 0 ? "f-panel" : "f-acc", ' opacity="' + (on ? 1 : 0.55) + '" style="stroke:' + (on ? "var(--bright)" : "var(--fig-line)") + '" stroke-width="' + (on ? 2.5 : 1) + '"');
        s += T(x - 4, 146, String(r.layer), on ? "f-ink t-s" : "f-dim t-xs");
      });
      s += T(30, 22, "layer: the stream before block l (0, the embeddings; 12, after the last block)", "f-dim t-xs t-up");
      s += T(30, 172, "the dot's size is the loudness of the change: larger is louder (" + lo.toFixed(1) + " to " + hi.toFixed(1) + " DUFS)", "f-dim t-xs");
      svg.innerHTML = s;
      box(tb, { label: "vSquash, drive " + drive + ", at layer " + pick.layer, line: pick.chain, text: pick.text, against: A.original, meas: meas(pick) });
    }
    show();
  })();

  /* ---------- takes ---------- */
  (function () {
    var el = document.getElementById("takes-list"); if (!el) return;
    el.innerHTML = A.takes.texts.map(function (t, i) {
      var s = A.takes.seeds[i], w = words(t).slice(0, 18).join(" ").replace(/¶/g, "↵");
      return '<li class="' + (s === P.seed ? "on" : "") + '"><span>seed ' + s + "</span><span><span class=\"pr\">" + esc(P.prompt) + "</span>" + (/^\s/.test(t) ? " " : "") + esc(w) + " …</span></li>";
    }).join("");
  })();

  document.querySelectorAll("[data-abl]").forEach(function (e) {   // numbers in the prose, from the data
    var v = e.getAttribute("data-abl").split(".").reduce(function (o, k) { return o == null ? o : o[k]; }, A);
    if (v != null) e.textContent = typeof v === "number" ? String(v) : v;
  });
})();
