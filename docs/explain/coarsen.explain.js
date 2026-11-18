// Abliteration Lens: the Coarsen strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, n1 = H.n1, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, C = H.C,
      clamp = H.clamp, lerp = H.lerp, gauss = H.gauss, stage = H.stage;

  /* ---------- Coarsen: one block's weight matrices rounded to 2^(bits−1) − 1 levels a side ---------- */
  var BITS = [8, 4, 3, 2];                  // the settings the figure walks through, as in chains/a.json
  var NW = 30, W = [], MAX = 0, i;
  for (i = 0; i < NW; i++) W.push(0.26 * gauss(i + 11));
  W[19] = 1;                                // an outlier sets the scale for the whole tensor
  for (i = 0; i < NW; i++) MAX = Math.max(MAX, Math.abs(W[i]));
  function levels(bits) { return Math.pow(2, bits - 1) - 1; }
  function quant(w, bits) {                 // as fake_quant_int: round(w / s) clamped to ±levels, times s, s = max|w| / levels
    var lv = levels(bits), sc = MAX / lv;
    return clamp(Math.round(w / sc), -lv, lv) * sc;
  }

  X.register("coarsen", {
    caption: "Thirty weights from one of block 5's matrices (hollow: full precision; filled: as rounded). Each "
      + "weight matrix of the block is rounded on its own to evenly spaced levels set by its largest weight, "
      + "<code>s = max|w| / (2^(bits−1) − 1)</code>, <code>w' = s · round(w / s)</code>: 127 levels a side at 8 bits, 7 at 4, "
      + "3 at 3 and 1 at 2, where every weight becomes −max, 0 or +max and most go to 0. Biases, the norms and "
      + "every other block keep full precision, and the weights are put back after the run.",
    examples: "bits 8, 4, 3 and 2 on block 5",
    still: 2 * 3000 + 1800, draw: function (t) {
    var st = stage(t, BITS.length, 3000, 900), a = BITS[st.prev], b = BITS[st.i], k = st.k, s = "", j;
    var X0 = 40, slot = 11.8, Y0 = 102, ky = 56, lv = levels(b), sc = MAX / lv;
    function y(v) { return Y0 - v * ky; }
    // the levels of this setting (too close to draw at 8 bits)
    if (lv <= 7) {
      for (j = -lv; j <= lv; j++) s += L(X0 - 6, y(j * sc), X0 + NW * slot, y(j * sc), j === 0 ? "s-line" : "s-soft", j === 0 ? "" : ' stroke-dasharray="3 3"');
    } else {
      s += L(X0 - 6, Y0, X0 + NW * slot, Y0, "s-line");
      s += R(X0 - 6, y(MAX), NW * slot + 6, 2 * MAX * ky, "f-panel", ' opacity="0.6"');
    }
    s += TE(X0 - 9, y(MAX) + 3, "+max", "f-dim t-xs") + TE(X0 - 9, Y0 + 3, "0", "f-dim t-xs") + TE(X0 - 9, y(-MAX) + 3, "−max", "f-dim t-xs");
    for (j = 0; j < NW; j++) {
      var x = X0 + j * slot + slot / 2, q = lerp(quant(W[j], a), quant(W[j], b), k), moved = Math.abs(q - W[j]) > 0.004;
      if (moved) s += L(x, y(W[j]), x, y(q), "s-acc", ' stroke-width="1" opacity="0.6"');
      s += C(x, y(W[j]), 3, "f-bg", ' style="stroke:var(--vx-dim)"');
      s += C(x, y(q), 2.6, q === 0 ? "f-red" : "f-acc");
    }
    s += T(8, 18, "block 5's weights w", "f-dim t-xs");
    s += TE(392, 18, "bits " + b + " · " + lv + " level" + (lv === 1 ? "" : "s") + " a side", "f-ink t-s");
    var zeros = 0;
    for (j = 0; j < NW; j++) if (quant(W[j], b) === 0) zeros++;
    s += TE(392, 32, zeros + " of " + NW + " rounded to 0", zeros ? "f-red t-xs" : "f-dim t-xs");
    // the twelve blocks: only block 5 is coarsened
    var bx = 46, bslot = 29, by = 180;
    s += TE(41, by + 12.5, "blocks", "f-dim t-xs");
    for (j = 0; j < 12; j++) {
      var on = j === 5;
      s += R(bx + j * bslot, by, bslot - 4, 18, on ? "f-acc" : "f-panel", ' rx="3"' + (on ? ' opacity="' + n1(0.45 + 0.08 * (8 - b)) + '"' : ' style="stroke:var(--vx-line)"'));
      s += TM(bx + j * bslot + (bslot - 4) / 2, by + 12.5, String(j), on ? "f-ink t-xs" : "f-dim t-xs");
    }
    return { svg: s, read: "coarsen block=5 bits=" + b + "    s = max|w| / " + lv + ",  w' = s · round(w / s), clamped to ±" + lv + "·s,  for each weight matrix of block 5",
      setting: st.i };
  } });
})(window.VAUExplain);
