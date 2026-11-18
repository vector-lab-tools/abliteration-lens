// Abliteration Lens: the Project out strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by VAU's explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, n1 = H.n1, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, C = H.C, P = H.P, arrow = H.arrow,
      lerp = H.lerp, f2 = H.f2, stage = H.stage;

  /* ---------- Project out: the part along u removed, reflected, or set to the mean's ---------- */
  // Left, the stream at each position in a plane that holds u (across) and some of the rest (up):
  // remove moves every dot onto the line u·h = 0, reflect mirrors it across that line, to=mean moves
  // it onto the line through the corpus mean μ. Right, one position's parts along u₁ … u₄: with
  // k = 4 the first four directions of the subspace all go.
  var PTS = [[52, -44], [70, -12], [34, 14], [86, 30], [60, 46], [24, -24], [44, -2]];
  var HL = 3;                                                 // the position shown on the right
  var MU = [26, -34];                                         // the corpus mean in the plane
  var PARTS = [1, -0.62, 0.48, -0.34], MU1 = 26 / 86;         // the highlighted position's parts along u₁ … u₄, and μ's along u₁
  var S = [{ mode: "remove", to: "zero", k: 1 }, { mode: "reflect", to: "zero", k: 1 }, { mode: "remove", to: "mean", k: 1 }, { mode: "remove", to: "zero", k: 4 }];
  function after(c, m, j, set) {                             // a part c along u_j after the setting; m, the mean's part
    if (j >= set.k) return c;
    var ref = set.to === "mean" ? m : 0, f = set.mode === "remove" ? 1 : 2;
    return c - f * (c - ref);
  }
  var FORM = ["h' = h − (h·u) u", "h' = h − 2 (h·u) u", "h' = h − ((h − μ)·u) u", "h' = h − (h Bᵀ) B,  B = u₁ … u₄"];
  var SAY = ["the part along u taken away", "the part along u turned round", "the part along u set to the corpus mean's", "the parts along four directions taken away"];
  X.register("project", {
    caption: "Left, the residual stream at each position, in a plane that holds the direction u (across) and "
      + "some of the rest of the stream (up); the dashed rings are where the dots were. Remove takes away the "
      + "part along u, <code>h' = h − (h·u) u</code>, and reflect turns it round, <code>h' = h − 2 (h·u) u</code>; "
      + "with to=mean the part is measured from the corpus mean μ, so removing it sets it to μ's. Right, one "
      + "position's parts along u₁ … u₄: with k=4 the strip removes a subspace, u and the next three "
      + "principal directions of what the direction was made from. The rest of the stream is untouched.",
    examples: "remove, reflect, remove to the mean, and remove with k 4, with the negation direction at layer 6",
    still: 2 * 3000 + 1500, draw: function (t) {
    var st = stage(t, S.length, 3000, 900), a = S[st.prev], b = S[st.i], s = "", i, j;
    var ox = 120, oy = 104, u = 1;
    // the plane: the line u·h = 0, the mean's line, u, and μ
    s += L(ox, 30, ox, 182, "s-line", ' stroke-dasharray="5 4"');
    s += TM(ox, 196, "u·h = 0", "f-dim t-xs");
    var meanOn = lerp(a.to === "mean" ? 1 : 0, b.to === "mean" ? 1 : 0, st.k);
    if (meanOn > 0.02) {
      s += L(ox + MU[0], 30, ox + MU[0], 182, "s-green", ' stroke-dasharray="5 4" stroke-width="1.3" opacity="' + f2(meanOn) + '"');
      s += T(ox + MU[0] + 4, 40, "μ's part", "f-green t-xs", ' opacity="' + f2(meanOn) + '"');
    }
    s += arrow(ox, 190 - 8, ox + 40, 190 - 8, "s-acc", 1.6) + T(ox + 44, 185, "u", "f-acc t-s");
    s += L(ox + MU[0] - 4, oy + MU[1] - 4, ox + MU[0] + 4, oy + MU[1] + 4, "s-green", ' stroke-width="1.4"');
    s += L(ox + MU[0] - 4, oy + MU[1] + 4, ox + MU[0] + 4, oy + MU[1] - 4, "s-green", ' stroke-width="1.4"');
    s += T(ox + MU[0] + 6, oy + MU[1] + 3, "μ", "f-green t-xs");
    for (i = 0; i < PTS.length; i++) {
      var c = PTS[i][0], y = oy + PTS[i][1], c2 = lerp(after(c, MU[0], 0, a), after(c, MU[0], 0, b), st.k);
      s += C(ox + c, y, 5, "s-ink", ' fill="none" stroke-width="1" stroke-dasharray="2 2" opacity="0.55"');
      if (Math.abs(c2 - c) > 2) s += L(ox + c, y, ox + c2, y, "s-dim", ' stroke-width="0.8" opacity="0.6"');
      s += C(ox + c2, y, i === HL ? 5 : 4.5, "f-blue", i === HL ? ' style="stroke:var(--vx-acc);stroke-width:2"' : "");
    }
    s += T(8, 16, "the stream at each position, layer 6", "f-dim t-xs");
    // right: one position's parts along u₁ … u₄, and the rest
    var X0 = 262, slot = 26, Y0 = 104, KY = 54;
    s += L(X0 - 6, Y0, 394, Y0, "s-line");
    s += T(X0 - 6, 16, "one position (ringed)", "f-dim t-xs");
    for (j = 0; j < 4; j++) {
      var x = X0 + j * slot, c0 = PARTS[j], m = j === 0 ? MU1 : 0;
      var v = lerp(after(c0, m, j, a), after(c0, m, j, b), st.k);
      s += R(x, Y0, 16, -c0 * KY, "s-ink", ' fill="none" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"');
      s += R(x, Y0, 16, -v * KY, j === 0 ? "f-acc" : "f-blue", ' opacity="0.85"');
      s += TM(x + 8, 196, "u" + "₁₂₃₄"[j], j < b.k ? "f-acc t-s" : "f-dim t-s");
      if (j === 0 && meanOn > 0.02) s += L(x - 3, Y0 - m * KY, x + 19, Y0 - m * KY, "s-green", ' stroke-width="1.4" opacity="' + f2(meanOn) + '"');
    }
    var xr = X0 + 4 * slot + 4;
    s += R(xr, Y0, 22, -0.9 * KY, "f-dim", ' opacity="0.45"');
    s += TM(xr + 11, 196, "rest", "f-dim t-xs");
    s += TE(394, 32, b.mode + (b.to === "mean" ? " · to mean" : "") + (b.k > 1 ? " · k " + b.k : ""), "f-ink t-s");
    return { svg: s, read: "mode " + b.mode + " · to " + b.to + " · k " + b.k + " · dir negation · layer 6    " + FORM[st.i] + "    (" + SAY[st.i] + "; the rest of h kept)", setting: st.i };
  } });
})(window.VAUExplain);
