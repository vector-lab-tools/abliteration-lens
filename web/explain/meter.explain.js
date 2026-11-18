// Abliteration Lens: the Level meter strip's explainer, an animated figure of what generate.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by VAU's explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, n1 = H.n1, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, C = H.C, P = H.P,
      clamp = H.clamp, lerp = H.lerp, gauss = H.gauss, stage = H.stage;

  /* ---------- Level meter: the size of the stream at a layer, token by token ---------- */
  var LAYERS = [0, 4, 8, 12];
  var TYP = [4.7, 66, 102, 450];            // GPT-2 small's mean size at those layers over the original text, for the figure without it
  function nice(v) {                        // an axis top a little above v
    var e = Math.pow(10, Math.floor(Math.log10(v))), m = v / e;
    return [1, 1.5, 2, 3, 4, 5, 6, 8, 10].filter(function (k) { return k >= m; })[0] * e;
  }
  function lab(w) { return JSON.stringify(String(w)).slice(1, -1).replace(/\\n/g, "↵"); }
  function series(D, i) {
    var rows = D && D.units && D.units.meter;
    if (rows && rows[i]) return rows[i].reading.map(Number);
    var out = [];
    for (var k = 0; k < 30; k++) out.push(TYP[i] * (1 + 0.07 * gauss(k * 3 + i)));
    return out;
  }
  function avg(a) { var s = 0; a.forEach(function (v) { s += v; }); return s / a.length; }

  X.register("meter", {
    caption: "The stream's size at one layer, its L2 norm <code>‖h‖ = √(Σ hᵢ²)</code> over GPT-2 small's 768 "
      + "components, at each token of the original text, at layers 0 (the embedding), 4, 8 and 12. The axis "
      + "rescales with the layer; the ladder at the right shows how the stream grows with depth, about a "
      + "hundredfold from the embedding to layer 12. It changes nothing.",
    meter: true,
    still: 2 * 4500 + 4 * 600 + 300, draw: function (t, D) {
    var st = stage(t, LAYERS.length, 4500, 800), A = series(D, st.prev), B = series(D, st.i), toks = D && D.original ? D.original.tokens : null;
    var N = B.length, j = Math.floor(t / 600) % N, s = "", i;
    var X0 = 40, W = 248, slot = W / N, Y0 = 172, Hh = 126;
    var top = lerp(nice(Math.max.apply(null, A)), nice(Math.max.apply(null, B)), st.k);
    function y(v) { return Y0 - v / top * Hh; }
    [0, 0.5, 1].forEach(function (g) {
      s += L(X0 - 4, y(g * top), X0 + W, y(g * top), g ? "s-soft" : "s-line");
      s += TE(X0 - 7, y(g * top) + 3, String(g * top >= 10 ? Math.round(g * top) : Math.round(g * top * 10) / 10), "f-dim t-xs");
    });
    for (i = 0; i < N; i++) {
      var v = lerp(A[i] !== undefined ? A[i] : B[i], B[i], st.k), cur = i === j;
      s += R(X0 + i * slot + 0.6, Y0, slot - 1.6, -Math.min(v, top * 1.05) / top * Hh, cur ? "f-acc" : "f-green", ' opacity="' + (cur ? 1 : 0.6) + '"');
    }
    s += T(8, 20, "‖h‖ = " + B[j].toFixed(1), "f-ink t-m");
    s += T(8, 36, "at layer " + LAYERS[st.i] + ", each token", "f-dim t-xs");
    if (toks) s += TM(clamp(X0 + j * slot + slot / 2, X0 + 14, X0 + W - 14), 188, lab(toks[j]), "f-acc t-s");
    else s += T(X0, 188, "drawn", "f-dim t-xs");
    s += T(X0 - 4, 204, "tokens →", "f-dim t-xs");
    // the ladder: the mean size at each of the four layers, on a log scale
    var lx = 340, ly0 = 172, lh = 126, means = LAYERS.map(function (l, k) { return avg(series(D, k)); });
    function ly(v) { return ly0 - (Math.log10(Math.max(v, 1)) / 3) * lh; }
    s += L(lx, ly(1), lx, ly(1000), "s-line");
    [1, 10, 100, 1000].forEach(function (g) { s += L(lx - 3, ly(g), lx + 3, ly(g), "s-line") + TE(lx - 6, ly(g) + 3, String(g), "f-dim t-xs"); });
    var labY = [], k;
    for (k = 0; k < means.length; k++) labY.push(ly(means[k]) + 3.5);
    for (k = 1; k < labY.length; k++) if (labY[k] > labY[k - 1] - 10) labY[k] = labY[k - 1] - 10;   // keep the labels apart
    means.forEach(function (m, k) {
      var on = k === st.i;
      s += C(lx, ly(m), on ? 4.5 : 3, on ? "f-acc" : "f-dim");
      s += T(lx + 9, labY[k], "L" + LAYERS[k], on ? "f-acc t-xs" : "f-dim t-xs");
    });
    s += TM(lx + 8, 16, "mean ‖h‖", "f-dim t-xs") + TM(lx + 8, 27, "by layer", "f-dim t-xs");
    return { svg: s, setting: st.i, token: j, read: "layer " + LAYERS[st.i] + " · token " + (j + 1) + " of " + N + ":  ‖h‖ = √(Σ hᵢ²) = " + B[j].toFixed(1) +
      "    (mean over the text " + means[st.i].toFixed(1) + ")" };
  } });
})(window.VAUExplain);
