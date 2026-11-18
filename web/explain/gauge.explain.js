// Abliteration Lens: the Direction meter strip's explainer, an animated figure of what generate.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by VAU's explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, n1 = H.n1, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, C = H.C, arrow = H.arrow,
      clamp = H.clamp, lerp = H.lerp, gauss = H.gauss, stage = H.stage;

  /* ---------- Direction meter: the stream's component along a unit direction ---------- */
  var LAYERS = [4, 8, 12];
  var TYP = [[-1.5, 2.5], [-3.5, 3.5], [-15, 30]];   // a drawn series (offset, spread) for the figure without the example texts
  function lab(w) { return JSON.stringify(String(w)).slice(1, -1).replace(/\\n/g, "↵"); }
  function nice(v) {
    var e = Math.pow(10, Math.floor(Math.log10(v))), m = v / e;
    return [1, 1.5, 2, 3, 4, 5, 6, 8, 10].filter(function (k) { return k >= m; })[0] * e;
  }
  function series(D, i) {
    var rows = D && D.units && D.units.gauge;
    if (rows && rows[i]) return rows[i].reading.map(function (r) { return Array.isArray(r) ? +r[0] : typeof r === "object" ? +r.proj : +r; });
    var out = [];
    for (var k = 0; k < 30; k++) out.push(TYP[i][0] + TYP[i][1] * gauss(k * 5 + i));
    return out;
  }
  function amax(a) { return Math.max.apply(null, a.map(Math.abs).concat([1e-9])); }

  X.register("gauge", {
    caption: "Left, drawn: the stream h at one token and the direction u, made unit length at the layer read; the "
      + "meter's reading is h's component along u, <code>h · u</code>, green where it points along u and red where "
      + "against (the Lens also shows the cosine, <code>h · u / ‖h‖</code>). Right, the reading at each token of "
      + "GPT-2 small's original text along the shipped direction <i>negation</i>, at layers 4, 8 and 12. It "
      + "changes nothing; after a Project out on the same layer it reads near zero.",
    meter: true,
    still: 1 * 4500 + 5 * 600 + 300, draw: function (t, D) {
    var st = stage(t, LAYERS.length, 4500, 800), A = series(D, st.prev), B = series(D, st.i), toks = D && D.original ? D.original.tokens : null;
    var N = B.length, j = Math.floor(t / 600) % N, s = "", i;
    var top = lerp(nice(amax(A)), nice(amax(B)), st.k), v = B[j];
    // left: h, u, and the foot of h on u (drawn: the angle follows the reading, the length does not)
    var ox = 74, oy = 122, len = 56, c = clamp(v / nice(amax(B)), -1, 1) * 0.92, th = Math.acos(c), hx = ox + len * Math.cos(th), hy = oy - len * Math.sin(th);
    s += T(8, 16, "drawn: h and unit u", "f-dim t-xs");
    s += L(10, oy, 150, oy, "s-soft");
    s += arrow(ox, oy, ox + 66, oy, "s-acc", 2) + T(ox + 58, oy + 16, "u", "f-acc t-s");
    s += L(hx, hy, hx, oy, "s-ink", ' stroke-dasharray="3 3" stroke-width="1" opacity="0.7"');
    s += L(ox, oy + 0.5, hx, oy + 0.5, v < 0 ? "s-red" : "s-green", ' stroke-width="4" stroke-linecap="round"');
    s += arrow(ox, oy, hx, hy, "s-blue", 2) + T(hx + (c < 0 ? -16 : 6), hy - 4, "h", "f-blue t-s");
    s += C(ox, oy, 2.5, "f-ink");
    s += TM(78, 160, "h · u = " + v.toFixed(2), v < 0 ? "f-red t-m" : "f-green t-m");
    s += TM(78, 176, "layer " + LAYERS[st.i] + ", dir negation", "f-dim t-xs");
    // right: the reading at each token, signed
    var X0 = 192, W = 200, slot = W / N, Y0 = 102, Hh = 64;
    function y(q) { return Y0 - q / top * Hh; }
    s += L(X0 - 4, Y0, X0 + W, Y0, "s-line");
    [-1, 1].forEach(function (g) { s += L(X0 - 4, y(g * top), X0 + W, y(g * top), "s-soft") + TE(X0 - 7, y(g * top) + 3, (g < 0 ? "−" : "") + (top >= 10 ? Math.round(top) : Math.round(top * 10) / 10), "f-dim t-xs"); });
    s += TE(X0 - 7, Y0 + 3, "0", "f-dim t-xs");
    for (i = 0; i < N; i++) {
      var q = lerp(A[i] !== undefined ? A[i] : B[i], B[i], st.k), cur = i === j;
      s += R(X0 + i * slot + 0.5, Y0, slot - 1.4, -clamp(q, -top * 1.05, top * 1.05) / top * Hh, cur ? "f-acc" : q < 0 ? "f-red" : "f-green", ' opacity="' + (cur ? 1 : 0.6) + '"');
    }
    s += T(X0 - 4, 20, "h · u at each token", "f-dim t-xs");
    if (toks) s += TM(clamp(X0 + j * slot + slot / 2, X0 + 14, X0 + W - 14), 188, lab(toks[j]), "f-acc t-s");
    else s += T(X0, 188, "drawn", "f-dim t-xs");
    s += T(X0 - 4, 204, "tokens →", "f-dim t-xs");
    return { svg: s, setting: st.i, token: j, read: "layer " + LAYERS[st.i] + " · dir negation · token " + (j + 1) + " of " + N + ":  h · u = " + v.toFixed(2) +
      "    (u the direction at layer " + LAYERS[st.i] + ", unit length;  the cosine is h · u / ‖h‖)" };
  } });
})(window.VAUExplain);
