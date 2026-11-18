// Abliteration Lens: the Vocoder strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by VAU's explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, n1 = H.n1, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, clamp = H.clamp, ease = H.ease, lerp = H.lerp,
      f2 = H.f2, stage = H.stage;

  /* ---------- Vocoder: the modulator's band levels imposed on the stream, band by band ---------- */
  // The stream less its corpus mean, measured in bands of the layer's principal directions spaced
  // logarithmically (vocoder_bands): one bar per band, across on a log scale. vocoder_edit rescales
  // each band of the stream being written (the carrier) toward the modulator's level in that band,
  // keeping its direction within the band; position 0, the attention sink, is left alone.
  var D = 768;
  function bands(d, n) {                                     // as vocoder_bands(d, n): rounding can merge the first edges
    var e = [0], i, v, out = [];
    for (i = 1; i <= n; i++) { v = Math.round(Math.pow(d, i / n)); if (e.indexOf(v) < 0) e.push(v); }
    e.sort(function (a, b) { return a - b; });
    e[e.length - 1] = d;
    for (i = 0; i + 1 < e.length; i++) if (e[i + 1] > e[i]) out.push([e[i], e[i + 1]]);
    return out;
  }
  var S = [{ mix: 0, n: 16 }, { mix: 0.5, n: 16 }, { mix: 1, n: 16 }, { mix: 1, n: 4 }];
  var BANDS = {}; S.forEach(function (x) { BANDS[x.n] = bands(D, x.n); });
  var TOK = ["What", "matters", "about", "the", "archive", "is", "…"], PSTEP = 500;
  function carrier(u, p) { return 0.55 + 0.24 * Math.sin(7 * u + 1.3 * p) + 0.14 * Math.sin(17 * u + 0.7 * p + 1); }
  function modulator(u) { return 0.5 + 0.3 * Math.sin(9 * u + 2) + 0.08 * Math.sin(23 * u); }
  X.register("vocoder", {
    caption: "One bar per band of principal directions of the stream at layer 6 (less the corpus mean μ), the "
      + "bands spaced logarithmically, narrow among the largest directions and wide in the tail. The modulator "
      + "prompt is run once on the unchanged model, and its level in each band, e_b, is measured from its mean "
      + "stream. At every later position the text's own part in each band, <code>y_b = (h − μ) V_bᵀ</code>, is "
      + "rescaled toward e_b with its direction kept: <code>y_b ← y_b (1 + mix (e_b / ‖y_b‖ − 1))</code>. "
      + "Position 0, the attention sink, is left alone.",
    examples: "mix 0, 0.5 and 1 with bands=16, then mix 1 with bands=4, at layer 6",
    still: 1 * 3000 + 3 * PSTEP + 200, draw: function (t) {
    var st = stage(t, S.length, 3000, 900), a = S[st.prev], b = S[st.i], mix = lerp(a.mix, b.mix, st.k), bs = BANDS[b.n], s = "", i;
    var X0 = 40, W = 350, Y0 = 168, KY = 112, LOG = Math.log(D + 1);
    function x(e) { return X0 + W * Math.log(e + 1) / LOG; }
    var pi = Math.floor(t / PSTEP), p = pi % TOK.length, pp = (pi + TOK.length - 1) % TOK.length, pk = ease((t - pi * PSTEP) / 160);
    s += L(X0, Y0, X0 + W, Y0, "s-line");
    [0.25, 0.5, 0.75].forEach(function (g) { s += L(X0, Y0 - g * KY, X0 + W, Y0 - g * KY, "s-soft"); });
    for (i = 0; i < bs.length; i++) {
      var x1 = x(bs[i][0]), x2 = x(bs[i][1]), u = ((x1 + x2) / 2 - X0) / W;
      var c = lerp(carrier(u, pp), carrier(u, p), pk), e = modulator(u);
      var out = p === 0 ? c : c + mix * (e - c);
      if (p === 0 && pk < 1) out = lerp(carrier(u, pp) + mix * (e - carrier(u, pp)), c, pk);
      s += R(x1 + 0.8, Y0, x2 - x1 - 1.6, -out * KY, "f-blue", ' opacity="0.78"');
      s += R(x1 + 0.8, Y0, x2 - x1 - 1.6, -c * KY, "s-ink", ' fill="none" stroke-width="1" stroke-dasharray="3 2" opacity="0.65"');
      s += L(x1 + 0.8, Y0 - e * KY, x2 - 0.8, Y0 - e * KY, "s-acc", ' stroke-width="2"');
    }
    [[0, "0"], [10, "10"], [100, "100"], [768, "768"]].forEach(function (k) { s += L(x(k[0]), Y0, x(k[0]), Y0 + 4, "s-line") + TM(x(k[0]), Y0 + 13, k[1], "f-dim t-xs"); });
    s += T(X0, 202, "principal directions at layer 6 (log scale) · " + bs.length + " bands", "f-dim t-xs");
    // the legend and the position
    s += R(8, 24, 12, 8, "s-ink", ' fill="none" stroke-width="1" stroke-dasharray="3 2"') + T(24, 31.5, "the text, as written", "f-dim t-xs");
    s += L(162, 28, 176, 28, "s-acc", ' stroke-width="2"') + T(180, 31.5, "the modulator", "f-dim t-xs");
    s += R(276, 24, 12, 8, "f-blue", ' opacity="0.78"') + T(292, 31.5, "after", "f-dim t-xs");
    s += T(8, 14, "position " + p + " · “" + TOK[p] + "”" + (p === 0 ? " · the attention sink, left alone" : ""), p === 0 ? "f-ink t-xs" : "f-dim t-xs");
    s += TE(392, 15, "mix " + f2(mix), "f-ink t-m");
    var nb = b.n === bs.length ? bs.length + " bands" : "bands=" + b.n + ": " + bs.length + " bands (two edges round to the same direction)";
    return { svg: s, read: "mix " + f2(mix) + " · " + nb + " · layer 6 · position " + p + (p === 0 ? " (the attention sink: left alone)" : "")
      + "    y_b ← y_b (1 + mix (e_b / ‖y_b‖ − 1)),  y_b = (h − μ) V_bᵀ", setting: st.i };
  } });
})(window.VAUExplain);
