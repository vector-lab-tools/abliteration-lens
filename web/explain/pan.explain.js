// Abliteration Lens: the Pan strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, C = H.C, P = H.P, n1 = H.n1,
      clamp = H.clamp, lerp = H.lerp, gauss = H.gauss, f2 = H.f2, stage = H.stage;

  /* ---------- Pan: a bias by distance on one query's attention scores ---------- */
  var Q = 20, BASE = [];                       // a query at position 20 and its scores over keys 0..20 (drawn)
  (function () {
    for (var k = 0; k <= Q; k++) BASE.push(k === 0 ? 3.1 : 1.5 * Math.exp(-(Q - k) / 2.5) + 0.45 * gauss(k + 11));
  })();
  function weights(strength) {                 // softmax(score - strength * (q - k) / q)
    var sc = BASE.map(function (v, k) { return v - strength * (Q - k) / Q; }), m = Math.max.apply(null, sc);
    var e = sc.map(function (v) { return Math.exp(v - m); }), z = e.reduce(function (a, b) { return a + b; }, 0);
    return e.map(function (v) { return v / z; });
  }
  function lookback(w) { return w.reduce(function (a, v, k) { return a + v * (Q - k); }, 0); }
  var W0 = weights(0);

  X.register("pan", {
    caption: "One query, the newest token at position q = 20, and the attention weights it gives each earlier key k "
      + "(the outlines are the weights before). Pan adds <code>−pan · depth · (q − k) / q</code> to every score "
      + "before the softmax, in the chosen blocks: above 0 the far keys lose up to pan · depth and attention moves "
      + "to the most recent tokens; below 0 they gain, and it moves toward the start.",
    examples: "pan 0, 0.5, 1 and −1 (depth 4, every block)",
    still: 2 * 3000 + 1500, draw: function (t) {
    var S = [0, 0.5, 1, -1], depth = 4, st = stage(t, S.length, 3000, 900);
    var pan = lerp(S[st.prev], S[st.i], st.k), strength = pan * depth, w = weights(strength), s = "", k;
    var X0 = 40, slot = 17, bw = 11, Y0 = 176, ky = 86;
    function x(k) { return X0 + k * slot; }
    // the bias, above
    var by = 46, bk = 4.2;
    s += L(X0 - 4, by, x(Q) + bw + 4, by, "s-line");
    s += TE(X0 - 8, by + 3, "0", "f-dim t-xs");
    s += TE(X0 - 8, by - 4 * bk + 3, "+4", "f-dim t-xs") + TE(X0 - 8, by + 4 * bk + 3, "−4", "f-dim t-xs");
    s += L(X0 - 4, by - 4 * bk, x(Q) + bw + 4, by - 4 * bk, "s-soft") + L(X0 - 4, by + 4 * bk, x(Q) + bw + 4, by + 4 * bk, "s-soft");
    var d = "";
    for (k = 0; k <= Q; k++) d += (k ? " L" : "M") + n1(x(k) + bw / 2) + " " + n1(by + strength * (Q - k) / Q * bk);
    s += P(d, "s-acc", ' stroke-width="2" stroke-linecap="round"');
    s += T(8, 16, "bias added to each score:  −pan · depth · (q − k) / q", "f-dim t-xs");
    // the weights, below
    s += L(X0 - 4, Y0, x(Q) + bw + 4, Y0, "s-line");
    s += L(X0 - 4, Y0 - 0.5 * ky, x(Q) + bw + 4, Y0 - 0.5 * ky, "s-soft") + TE(X0 - 8, Y0 - 0.5 * ky + 3, "0.5", "f-dim t-xs");
    for (k = 0; k <= Q; k++) {
      var h = Math.min(w[k], 1) * ky;
      s += R(x(k), Y0, bw, -h, k === Q ? "f-green" : "f-blue", ' opacity="0.85"');
      s += R(x(k), Y0, bw, -Math.min(W0[k], 1) * ky, "s-ink", ' fill="none" stroke-width="1" stroke-dasharray="3 2" opacity="0.55"');
    }
    s += T(X0, 84, "attention weights from q", "f-dim t-xs");
    // the mean look-back, as a mark on the axis
    var lb = lookback(w), mx = x(Q - lb) + bw / 2;
    s += '<path d="M' + n1(mx) + " " + (Y0 + 3) + " l-5 8 l10 0 Z" + '" class="f-acc"/>';
    s += TE(394, 84, "mean look-back " + lb.toFixed(1) + " ▲", "f-acc t-xs");
    s += T(X0, 204, "k = 0 (start)", "f-dim t-xs") + TE(x(Q) + bw, 204, "q (newest)", "f-dim t-xs");
    return { svg: s, setting: st.i,
      read: "pan " + (pan < 0 ? "−" : "") + f2(Math.abs(pan)) + " · depth " + depth + " · block=all    score(q, k) += −pan · depth · (q − k) / q    "
        + (Math.abs(pan) < 1e-6 ? "pan 0: neutral" : "mean look-back " + lb.toFixed(1) + " tokens (" + lookback(W0).toFixed(1) + " before)") };
  } });
})(window.VAUExplain);
