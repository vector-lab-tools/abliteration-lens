// Abliteration Lens: the Contrast strip's explainer, an animated figure of what generate.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L,
      lerp = H.lerp, f2 = H.f2, stage = H.stage;

  /* ---------- Contrast: log p_diverged − α log p_original, over the plausible ---------- */
  // The next token's chances under the original model and under the chain (a Steer toward
  // negation), both drawn; the rest of the vocabulary is left out of the picture.
  var W = [" that", " not", " the", " no", " how", " a", " never", " what", " its"],
      PO = [0.30, 0.06, 0.13, 0.015, 0.07, 0.06, 0.004, 0.05, 0.035],
      PD = [0.22, 0.20, 0.08, 0.07, 0.045, 0.035, 0.03, 0.018, 0.012], KEEP = 0.1;
  function sampled(alpha) {                     // contrast_logits, then _choose: temperature 0.8, top-k 40, top-p 0.95
    var mx = Math.max.apply(null, PD), plaus = PD.map(function (p) { return p >= KEEP * mx; });
    var sc = PD.map(function (p, i) { return plaus[i] ? (Math.log(p) - alpha * Math.log(PO[i])) / 0.8 : -Infinity; });
    var m = Math.max.apply(null, sc), e = sc.map(function (v) { return isFinite(v) ? Math.exp(v - m) : 0; });
    var z = e.reduce(function (a, b) { return a + b; }, 0), p = e.map(function (v) { return v / z; });
    var ord = p.map(function (v, i) { return i; }).sort(function (a, b) { return p[b] - p[a]; }), cum = 0, keep = [];
    ord.forEach(function (i, r) { keep[i] = r === 0 || cum < 0.95; cum += p[i]; });
    p = p.map(function (v, i) { return keep[i] ? v : 0; });
    z = p.reduce(function (a, b) { return a + b; }, 0);
    return { p: p.map(function (v) { return v / z; }), plaus: plaus };
  }

  X.register("contrast", {
    caption: "Above, the next token's chances under the original model (blue) and the diverged one (amber), here a "
      + "Steer toward negation; the dashed line is keep times the diverged model's top chance. Below, what is "
      + "sampled: <code>log p_diverged − α log p_original</code> over the tokens above that line (the rest are ruled "
      + "out), then temperature, top-k and top-p. As α rises, the words the chain made likelier gain and the words "
      + "both models favour lose.",
    examples: "alpha 0, 0.5, 1 and 2 (keep 0.1), beside a Steer toward negation at layer 6, scale 4",
    still: 2 * 3000 + 1500, draw: function (t) {
    var S = [0, 0.5, 1, 2], st = stage(t, S.length, 3000, 900), alpha = lerp(S[st.prev], S[st.i], st.k);
    var r = sampled(alpha), s = "", i;
    var X0 = 30, sl = 40.5, Y1 = 84, k1 = 92, Y2 = 176, k2 = 62;
    function x(i) { return X0 + i * sl; }
    // above: the two models
    s += T(8, 14, "p original (blue), p diverged (amber), √ scale", "f-dim t-xs");
    s += L(X0 - 6, Y1, 394, Y1, "s-line");
    var thr = KEEP * Math.max.apply(null, PD);
    for (i = 0; i < W.length; i++) {
      s += R(x(i), Y1, 12, -Math.sqrt(PO[i]) * k1, "f-blue", ' opacity="0.75"');
      s += R(x(i) + 13, Y1, 12, -Math.sqrt(PD[i]) * k1, "f-acc", ' opacity="' + (r.plaus[i] ? 0.9 : 0.35) + '"');
    }
    s += L(X0 - 6, Y1 - Math.sqrt(thr) * k1, 394, Y1 - Math.sqrt(thr) * k1, "s-green", ' stroke-width="1.2" stroke-dasharray="5 3"');
    s += TE(394, 14, "– – keep · max p_div", "f-green t-xs");
    // below: what is sampled
    s += T(8, 101, "sampled from:  log p_div − α log p_orig, plausible tokens only", "f-dim t-xs");
    s += L(X0 - 6, Y2, 394, Y2, "s-line");
    s += L(X0 - 6, Y2 - 0.5 * k2, 394, Y2 - 0.5 * k2, "s-soft") + TE(X0 - 8, Y2 - 0.5 * k2 + 3, "0.5", "f-dim t-xs");
    for (i = 0; i < W.length; i++) {
      s += R(x(i), Y2, 25, -r.p[i] * k2, "f-green", ' opacity="0.85"');
      s += TM(x(i) + 12.5, Y2 + 14, W[i].trim(), r.plaus[i] ? "f-ink t-xs" : "f-dim t-xs");
      if (!r.plaus[i]) s += TM(x(i) + 12.5, Y2 - 4, "out", "f-dim t-xs");
    }
    s += T(X0, 204, "α = " + f2(alpha), "f-ink t-s");
    return { svg: s, setting: st.i,
      read: "contrast alpha=" + f2(alpha) + " keep=" + KEEP + "    score = log p_div − α log p_orig where p_div ≥ keep · max p_div, −∞ elsewhere"
        + (alpha < 1e-6 ? "    (α 0: the diverged model as it is)" : "") };
  } });
})(window.VAUExplain);
