// Abliteration Lens: the Steer strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by VAU's explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, TE = H.TE, L = H.L, C = H.C, arrow = H.arrow, lerp = H.lerp, f2 = H.f2, stage = H.stage;

  /* ---------- Steer: the same vector, scale × v, added at every position ---------- */
  // Each dot is the stream at one position, seen in a plane that holds v (across) and some of the
  // rest of the stream (up). steer_edit adds scale × v to every row of h: every dot moves by the
  // same arrow, and nothing but its part along v changes.
  var TOK = ["What", "matters", "about", "the", "archive", "is", "…"];
  var PTS = [[-22, -54], [16, -36], [40, -18], [-8, 0], [30, 18], [-34, 36], [4, 54]];
  var S = [0, 2, 4, -4], NORM = 22.16, PX = 20;              // ‖v‖ of the negation direction at layer 6; pixels per unit of scale
  X.register("steer", {
    caption: "Each dot is the residual stream at one position of the text, in a plane that holds the "
      + "direction v (across) and some of the rest of the stream (up); the dashed rings are where the dots "
      + "were. Steer adds the same vector at every position, <code>h' = h + scale · v</code>: every dot "
      + "moves by the same arrow, and only its part along v changes. The direction is used as stored, so "
      + "its length counts: the negation direction at layer 6 is 22.2 long, about a quarter of the stream's "
      + "size there, so scale 4 adds about the stream's own size.",
    examples: "scale 0, 2, 4 and −4, with the negation direction at layer 6",
    still: 2 * 3000 + 1500, draw: function (t) {
    var st = stage(t, S.length, 3000, 900), sc = lerp(S[st.prev], S[st.i], st.k), dx = sc * PX, cx = 196, cy = 92, s = "", i;
    // the axes of the plane
    s += L(14, 182, 390, 182, "s-line");
    s += T(300, 196, "along v →", "f-dim t-xs");
    s += L(14, 182, 14, 28, "s-line");
    s += T(25, 160, "the rest of h →", "f-dim t-xs", ' transform="rotate(-90 25 160)"');
    s += arrow(26, 170, 26 + PX, 170, "s-acc", 1.6) + T(26 + PX + 5, 173, "v", "f-acc t-s");
    // where each dot was, the move, and where it is now
    for (i = 0; i < PTS.length; i++) {
      var x0 = cx + PTS[i][0], y0 = cy + PTS[i][1];
      s += C(x0, y0, 5, "s-ink", ' fill="none" stroke-width="1" stroke-dasharray="2 2" opacity="0.55"');
      if (Math.abs(dx) > 2) s += L(x0, y0, x0 + dx, y0, "s-dim", ' stroke-width="0.8" opacity="0.6"');
    }
    for (i = 0; i < PTS.length; i++) {
      var x1 = cx + PTS[i][0] + dx, y1 = cy + PTS[i][1];
      s += C(x1, y1, 4.5, i === 6 ? "f-dim" : "f-blue");
      s += TM(x1, y1 - 8, TOK[i], "f-dim t-xs");
    }
    // the one arrow every dot moves by
    if (Math.abs(dx) > 6) s += arrow(cx, 164, cx + dx, 164, "s-acc", 2.4) + TM(cx + dx / 2, 177, "scale · v", "f-acc t-xs");
    else s += TM(cx, 172, "scale 0: nothing moves", "f-dim t-xs");
    s += TE(392, 22, "scale " + (sc < 0 ? "−" + Math.abs(sc).toFixed(1) : sc.toFixed(1)), "f-ink t-m");
    s += T(8, 16, "the stream at each position, layer 6", "f-dim t-xs");
    var add = Math.abs(sc) * NORM;
    return { svg: s, read: "scale " + (sc < 0 ? "−" : "") + f2(Math.abs(sc)) + " · dir negation · layer 6    h' = h + scale · v at every position    "
      + "(‖v‖ = 22.2 here, so each position moves " + add.toFixed(1) + " along v" + (sc < 0 ? ", the other way" : "") + ")", setting: st.i };
  } });
})(window.VAUExplain);
