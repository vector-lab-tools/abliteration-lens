// Abliteration Lens: the Attention scope strip's explainer, an animated figure of what generate.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by VAU's explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, n1 = H.n1, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, C = H.C, P = H.P,
      clamp = H.clamp, lerp = H.lerp, rnd = H.rnd, f2 = H.f2, stage = H.stage, arc = H.arc;

  /* ---------- Attention scope: one head's weights from the token reached ---------- */
  // Four GPT-2 small heads, each with its own habit on the original text (checked on it).
  var HEADS = [["5.1", "the first token", "first"], ["4.11", "the token before", "prev"],
               ["0.1", "mostly the token itself", "self"], ["0.9", "spread out", "spread"]];
  var PROMPT = "What matters about the archive is";
  function lab(w, n) { var s = JSON.stringify(String(w)).slice(1, -1).replace(/\\n/g, "↵").trim() || "␣"; return n && s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function drawn(kind, q) {                  // the figure without the example texts: each head's habit, drawn
    var w = [], i, s = 0;
    for (i = 0; i <= q; i++) w.push(kind === "spread" ? 0.2 + rnd(i * 7 + q) : 0.02 * rnd(i + q * 13));
    w.forEach(function (v) { s += v; });
    w = w.map(function (v) { return v / s; });
    var at = kind === "first" ? 0 : kind === "prev" ? Math.max(0, q - 1) : kind === "self" ? q : -1, keep = kind === "self" ? 0.83 : 0.97;
    if (at >= 0) w = w.map(function (v, k) { return k === at ? keep + v * (1 - keep) : v * (1 - keep); });
    return w;
  }

  X.register("scope", {
    caption: "One head's attention weights from the token the text has reached (the right-hand cell) over every "
      + "token up to it, a row of <code>softmax(q · kᵀ / √64)</code>; the arcs' width is the weight, and the "
      + "first token, an ellipsis for the middle, and the last seven are drawn. Four GPT-2 small heads: 5.1 "
      + "puts its weight on the first token, 4.11 on the token before, 0.1 mostly on the token itself and 0.9 "
      + "spreads it out. It changes nothing.",
    meter: true,
    still: 1 * 6000 + 9 * 1200 + 300, draw: function (t, D) {
    var st = stage(t, HEADS.length, 6000, 500), hd = HEADS[st.i], rows = D && D.units && D.units.scope;
    var o = D && D.original, pt = (o && o.prompt_tokens) || ((D && D.provenance && D.provenance.prompt) || PROMPT).match(/\s?\S+/g) || [];
    var cont = rows && o ? o.tokens : [], ctx = pt.concat(cont), n0 = pt.length;
    var N = rows ? rows[0].reading.length : n0 - 1, j = Math.floor(t / 1200) % N;
    var q = rows ? n0 - 1 + j : j + 1, w = rows ? rows[st.i].reading[j].map(Number) : drawn(hd[2], q), s = "", i;
    // the cells shown: the first token, an ellipsis for the middle, and the last seven
    var cells = [];
    if (q + 1 <= 9) for (i = 0; i <= q; i++) cells.push({ k: i, w: w[i] || 0, t: lab(ctx[i], 6) });
    else {
      var mid = 0;
      for (i = 1; i <= q - 7; i++) mid += w[i] || 0;
      cells.push({ k: 0, w: w[0] || 0, t: lab(ctx[0], 6) }, { k: -1, w: mid, t: "… " + (q - 7) });
      for (i = q - 6; i <= q; i++) cells.push({ k: i, w: w[i] || 0, t: lab(ctx[i], 6) });
    }
    var pitch = 376 / 9, x0 = 12 + pitch / 2 + (9 - cells.length) * pitch, cy = 168, qx = x0 + (cells.length - 1) * pitch;
    function cx(c) { return x0 + c * pitch; }
    cells.forEach(function (c, ci) {
      var x = cx(ci), self = c.k === q;
      if (!self && c.w >= 0.005) s += arc(qx - 6, x, cy - 12, clamp((qx - x) * 0.4, 12, 92), "s-acc", 0.6 + 8 * c.w, 0.18 + 0.82 * c.w);
      if (self && c.w >= 0.005) s += P("M" + n1(x - 7) + " " + (cy - 12) + " C" + n1(x - 16) + " " + (cy - 44) + " " + n1(x + 16) + " " + (cy - 44) + " " + n1(x + 7) + " " + (cy - 12),
                                     "s-acc", ' stroke-width="' + n1(0.6 + 8 * c.w) + '" opacity="' + f2(0.18 + 0.82 * c.w) + '"');
    });
    cells.forEach(function (c, ci) {
      var x = cx(ci), self = c.k === q;
      s += R(x - pitch / 2 + 2, cy - 11, pitch - 4, 22, self ? "f-acc" : "f-panel", ' rx="3"' + (c.k < 0 ? ' style="stroke:var(--vx-dim);stroke-dasharray:2 2"' : ""));
      s += TM(x, cy + 3.5, c.t, self ? "f-bg t-xs" : c.k < 0 ? "f-dim t-xs" : "f-ink t-xs");
      if (c.w >= 0.01) s += TM(x, cy + 26, c.w.toFixed(2), c.w >= 0.3 ? "f-acc t-xs" : "f-dim t-xs");
    });
    var best = 0;
    for (i = 1; i < w.length; i++) if (w[i] > w[best]) best = i;
    s += T(8, 18, "head " + hd[0] + ": " + hd[1], "f-ink t-m");
    s += T(8, 34, "from “" + lab(ctx[q]) + "”, its weights over the " + (q + 1) + " tokens so far", "f-dim t-xs");
    if (!rows) s += TE(392, 18, "drawn", "f-dim t-xs");
    return { svg: s, setting: st.i, token: rows ? j : undefined, read: "head " + hd[0] + " · " + (rows ? "token " + (j + 1) + " of " + N + " · " : "") +
      "from “" + lab(ctx[q]) + "”:  softmax(q · kᵀ / √64) over " + (q + 1) + " tokens;  most on “" + lab(ctx[best]) + "” " + f2(w[best]) };
  } });
})(window.VAUExplain);
