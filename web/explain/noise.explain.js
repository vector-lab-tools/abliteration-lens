// Abliteration Lens: the Noise strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by VAU's explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, clamp = H.clamp, lerp = H.lerp, gauss = H.gauss, f2 = H.f2, stage = H.stage;

  /* ---------- Noise: Gaussian noise at each position, scaled to that position's size ---------- */
  // Three positions of the stream, 24 of the 768 coordinates of each. noise_edit draws z ~ N(0, I)
  // for each position from a seed of its own (the run's seed, the layer, the position), so the
  // noise is fixed: only sigma changes it. It is scaled by each position's own root mean square.
  var POS = [{ tok: "matters", p: 1, rms: 0.6 }, { tok: "the", p: 3, rms: 1 }, { tok: "archive", p: 4, rms: 1.5 }];
  var S = [0, 0.25, 0.5, 1], N = 24, KY = 15;
  X.register("noise", {
    caption: "Twenty-four of the 768 coordinates of the residual stream at three positions, each as large as "
      + "the stream is there; the dashed lines are ± its root mean square. The noise added is "
      + "<code>h' = h + σ · rms(h) · z</code>, z drawn from N(0, I) for each position from a seed of its own, "
      + "so the same noise comes every pass and only sigma changes it; at sigma 1 the noise is about as large "
      + "as the stream. With abs=1, <code>h' = h + σ · z</code>, the same amount everywhere.",
    examples: "sigma 0, 0.25, 0.5 and 1 at layer 6",
    still: 2 * 3000 + 1500, draw: function (t) {
    var st = stage(t, S.length, 3000, 900), sg = lerp(S[st.prev], S[st.i], st.k), s = "", i, q;
    var W = 118, gap = 10, X0 = 14, Y0 = 104, bw = W / N;
    for (q = 0; q < POS.length; q++) {
      var P = POS[q], x0 = X0 + q * (W + gap), r = P.rms * KY;
      s += L(x0, Y0, x0 + W, Y0, "s-line");
      s += L(x0, Y0 - r, x0 + W, Y0 - r, "s-dim", ' stroke-dasharray="3 3" stroke-width="0.8"');
      s += L(x0, Y0 + r, x0 + W, Y0 + r, "s-dim", ' stroke-dasharray="3 3" stroke-width="0.8"');
      for (i = 0; i < N; i++) {
        var h = clamp(gauss(q * 97 + i * 3 + 11), -2.4, 2.4) * P.rms, z = clamp(gauss(1000 + P.p * 131 + i * 7), -2.6, 2.6);
        var hp = clamp(h + sg * P.rms * z, -5.2, 5.2), x = x0 + i * bw + 0.6;
        s += R(x, Y0, bw - 1.4, -h * KY, "f-blue", ' opacity="0.55"');
        if (Math.abs(hp - h) * KY > 0.6) s += R(x, Y0 - h * KY, bw - 1.4, -(hp - h) * KY, "f-acc", ' opacity="0.9"');
      }
      s += TM(x0 + W / 2, 196, "“" + P.tok + "” · rms " + P.rms.toFixed(1), "f-dim t-xs");
    }
    s += T(8, 16, "layer 6: h in blue, the noise added in amber", "f-dim t-xs");
    s += TE(392, 17, "sigma " + f2(sg), "f-ink t-m");
    return { svg: s, read: "sigma " + f2(sg) + " · layer 6    h' = h + σ · rms(h) · z,  z ~ N(0, I), drawn for each position from its own seed"
      + "    (" + (sg === 0 ? "sigma 0 adds nothing" : "the noise is about " + Math.round(sg * 100) + "% of each position's size") + ")", setting: st.i };
  } });
})(window.VAUExplain);
