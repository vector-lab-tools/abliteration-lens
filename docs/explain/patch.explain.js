// Abliteration Lens: the Patch strip's explainer, an animated figure of what rewrite.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, n1 = H.n1,
      clamp = H.clamp, ease = H.ease, gauss = H.gauss, f2 = H.f2, stage = H.stage;

  /* ---------- Patch: p += scale · ΔW for the run, then put back ---------- */
  // A corner of block 5's MLP output projection (3,072 in × 768 out), and the patch Rewrite saved
  // for it: ΔW = c dᵀ, one column vector times one row vector (all drawn).
  var NR = 9, NC = 15, CV = [], DV = [], W = [];
  (function () {
    var i, j;
    for (i = 0; i < NR; i++) CV.push(0.25 * gauss(i + 3));
    CV[4] = 1;
    for (j = 0; j < NC; j++) DV.push(0.9 * gauss(j + 40));
    for (i = 0; i < NR; i++) for (j = 0; j < NC; j++) W.push(gauss(i * 31 + j * 7 + 500));
  })();
  var STEP = 3400;

  X.register("patch", {
    caption: "A corner of the weight a patch changes, block 5's MLP output projection. The patch Rewrite saved holds "
      + "one tensor for it, <code>ΔW = c dᵀ</code>, a column times a row. For the run each named parameter gains "
      + "<code>scale · ΔW</code>; after it the saved weights are copied back, so every run starts from the "
      + "model as it was. (A file whose metadata says kind=replace moves the weights toward its tensors instead.)",
    examples: "scale 0, 0.5, 1 and 2, with the patch saved by Rewrite (explain-archive)",
    still: 2 * STEP + 1700, draw: function (t) {
    var S = [0, 0.5, 1, 2], st = stage(t, S.length, STEP, 1), sc = S[st.i], u = t % STEP;
    // the run's phases: load (the change fades in), run, restore (it fades out)
    var env = u < 600 ? ease(u / 600) : u < 2800 ? 1 : 1 - ease((u - 2800) / 500), ph = u < 600 ? 0 : u < 2800 ? 1 : 2;
    var amt = sc * env, s = "", i, j;
    var GX = 64, GY = 58, cw = 14, ch = 13;
    // d, a row on top; c, a column on the left
    for (j = 0; j < NC; j++) {
      var dv = DV[j];
      s += R(GX + j * cw + 2, GY - 10, cw - 4, -clamp(Math.abs(dv), 0, 2) * 9, dv > 0 ? "f-acc" : "f-blue", ' opacity="0.8"');
    }
    s += TE(GX - 6, GY - 14, "dᵀ", "f-ink t-s");
    for (i = 0; i < NR; i++) {
      var cv = CV[i];
      s += R(GX - 10 - clamp(Math.abs(cv), 0, 1.2) * 30, GY + i * ch + 2, clamp(Math.abs(cv), 0, 1.2) * 30, ch - 4, cv > 0 ? "f-acc" : "f-blue", ' opacity="0.8"');
    }
    s += TE(GX - 44, GY + NR * ch / 2 + 4, "c", "f-ink t-s");
    // the weight: W, plus amt · c dᵀ on top
    for (i = 0; i < NR; i++) for (j = 0; j < NC; j++) {
      var x = GX + j * cw, y = GY + i * ch, w = W[i * NC + j], dw = amt * CV[i] * DV[j];
      s += R(x + 0.5, y + 0.5, cw - 1, ch - 1, "f-panel");
      s += R(x + 0.5, y + 0.5, cw - 1, ch - 1, "f-dim", ' opacity="' + n1(clamp(Math.abs(w) * 0.12, 0.02, 0.35) * 100) / 100 + '"');
      if (Math.abs(dw) > 0.01) s += R(x + 0.5, y + 0.5, cw - 1, ch - 1, dw > 0 ? "f-acc" : "f-blue", ' opacity="' + n1(clamp(Math.abs(dw) * 0.55, 0, 0.95) * 100) / 100 + '"');
    }
    s += T(GX, GY + NR * ch + 16, "h.5.mlp.c_proj.weight (a corner)", "f-dim t-xs");
    s += T(8, 16, "for the run:  p += scale · ΔW,   ΔW = c dᵀ", "f-dim t-xs");
    // right: the file and the run's phases
    var RX = 286;
    s += T(RX, 52, "data/patches/", "f-dim t-xs") + T(RX, 64, "explain-archive", "f-ink t-xs") + T(RX, 76, ".safetensors", "f-dim t-xs");
    ["load", "run", "restore"].forEach(function (lab, k) {
      var on = k === ph, y = 104 + k * 26;
      s += R(RX - 4, y - 12, 80, 18, on ? "f-acc" : "f-panel", ' rx="3"' + (on ? ' opacity="0.25"' : ""));
      s += T(RX + 1, y, lab, on ? "f-acc t-xs" : "f-dim t-xs");
    });
    s += T(RX, 196, "scale " + f2(sc), "f-ink t-s");
    return { svg: s, setting: st.i,
      read: "patch file=explain-archive scale=" + f2(sc) + "    for each tensor in the file: p += scale · ΔW for the run, then p = saved"
        + (sc === 0 ? "    (scale 0: the file is not loaded)" : "") };
  } });
})(window.VAUExplain);
