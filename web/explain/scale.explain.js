// Abliteration Lens: the Scale strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, R = H.R, L = H.L, C = H.C, arrow = H.arrow,
      lerp = H.lerp, f2 = H.f2, sign = H.sign, stage = H.stage;

  /* ---------- Scale: what a component adds, multiplied by k ---------- */
  var K = [1, 0.5, 0, -1, 2];               // the settings the figure walks through, as in chains/a.json

  X.register("scale", {
    caption: "At one position, the stream h arrives at MLP 6 and the MLP adds its output y (dashed: as it was). "
      + "Scale multiplies what it adds by k, <code>h' = h + k · y</code>: k 1 changes nothing, 0 is zero ablation, "
      + "and below 0 the component pushes the other way. On a head, an attention layer or a block it is the same "
      + "(a block's y is its output minus its input); on a layer it multiplies the whole stream, <code>h' = k · h</code>.",
    examples: "k 1, 0.5, 0, −1 and 2 on MLP 6",
    still: 3 * 3000 + 1800, draw: function (t) {
    var st = stage(t, K.length, 3000, 900), k = lerp(K[st.prev], K[st.i], st.k), s = "";
    // left: h, y and h + k·y
    var O = [40, 150], h = [92, -70], y = [64, 26], tip = [O[0] + h[0], O[1] + h[1]];
    var ky = [y[0] * k, y[1] * k], end = [tip[0] + ky[0], tip[1] + ky[1]];
    s += L(tip[0], tip[1], tip[0] + y[0], tip[1] + y[1], "s-dim", ' stroke-width="1.2" stroke-dasharray="4 3"');
    s += T(tip[0] + y[0] + 4, tip[1] + y[1] + 4, "y", "f-dim t-s");
    // a label beside an arrow's middle, on the side away from `away`
    function lab(x2, y2, away, str, cls) {
      var mx = (O[0] + x2) / 2, my = (O[1] + y2) / 2, d = Math.hypot(x2 - O[0], y2 - O[1]) || 1, nx = -(y2 - O[1]) / d, ny = (x2 - O[0]) / d;
      if (nx * (away[0] - mx) + ny * (away[1] - my) > 0) { nx = -nx; ny = -ny; }
      return TM(mx + nx * 13, my + ny * 13 + 4, str, cls);
    }
    s += arrow(O[0], O[1], tip[0], tip[1], "s-ink", 1.8) + lab(tip[0], tip[1], end, "h", "f-ink t-s");
    if (Math.abs(k) > 0.04) s += arrow(tip[0], tip[1], end[0], end[1], "s-acc", 2.2);
    s += T((tip[0] + end[0]) / 2 - 6, Math.min(tip[1], end[1]) - 8, "k·y", "f-acc t-xs");
    s += arrow(O[0], O[1], end[0], end[1], "s-green", 2.4);
    s += lab(end[0], end[1], tip, "h'", "f-green t-s");
    s += C(O[0], O[1], 2.5, "f-ink") + C(tip[0], tip[1], 2, "f-ink");
    s += T(8, 18, "at one position: h' = h + k · y", "f-dim t-xs");
    // right: k on its range, −4 to 4
    var X0 = 232, X1 = 388, Yk = 112;
    function kx(v) { return X0 + (v + 4) / 8 * (X1 - X0); }
    s += R(X0, Yk - 6, kx(0) - X0, 12, "f-panel");
    s += L(X0, Yk, X1, Yk, "s-line", ' stroke-width="1.2"');
    [-4, -2, 0, 1, 2, 4].forEach(function (v) {
      s += L(kx(v), Yk - 4, kx(v), Yk + 4, "s-dim");
      s += TM(kx(v), Yk + 17, v < 0 ? "−" + Math.abs(v) : String(v), "f-dim t-xs");
    });
    s += TM(kx(-2), Yk - 12, "reverses", "f-dim t-xs");
    s += L(kx(0), Yk - 26, kx(0), Yk - 6, "s-dim", ' stroke-dasharray="2 2"') + TM(kx(0), Yk - 30, "zero", "f-dim t-xs");
    s += L(kx(1), Yk + 22, kx(1), Yk + 32, "s-dim", ' stroke-dasharray="2 2"') + TM(kx(1), Yk + 42, "unchanged", "f-dim t-xs");
    s += C(kx(k), Yk, 6, "f-acc");
    s += T(X0, 40, "k = " + sign(k), "f-ink t-m");
    s += T(X0, 56, k === 1 ? "MLP 6 as it was" : Math.abs(k) < 0.005 ? "MLP 6 adds nothing" : k < 0 ? "MLP 6 pushes the other way" : k > 1 ? "MLP 6 louder" : "MLP 6 quieter", "f-dim t-xs");
    s += T(X0, 196, "k, from −4 to 4", "f-dim t-xs");
    return { svg: s, read: "scale mlp=6 k=" + (Math.abs(k - Math.round(k)) < 0.005 ? String(Math.round(k)).replace("-", "−") : f2(k).replace("-", "−")) +
      "    h' = h + k · y,  y what MLP 6 adds    (on a layer: h' = k · h)", setting: st.i };
  } });
})(window.VAUExplain);
