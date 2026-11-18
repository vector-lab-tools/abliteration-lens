// Abliteration Lens: the Exit strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, R = H.R, L = H.L, C = H.C, arrow = H.arrow,
      clamp = H.clamp, lerp = H.lerp, stage = H.stage;

  /* ---------- Exit: blocks 0 to L − 1, then the final norm and the output layer ---------- */
  var EXIT = [12, 11, 8, 4];                // the settings the figure walks through, as in chains/a.json

  X.register("exit", {
    caption: "GPT-2 small's twelve blocks, the stream running left to right. Exit at layer L keeps only blocks 0 "
      + "to L − 1 and sends the stream at layer L straight to the final norm and the output layer, which choose "
      + "the next token: <code>logits = W_U · norm(h_L)</code>, the reading a Tap takes at that layer, run as the "
      + "writer. Layer 12 is the whole model and changes nothing; below it the cache is off and each step "
      + "recomputes the text.",
    examples: "layer 12, 11, 8 and 4",
    still: 2 * 3000 + 2200, draw: function (t) {
    var st = stage(t, EXIT.length, 3000, 900), Lx = EXIT[st.i], lf = lerp(EXIT[st.prev], EXIT[st.i], st.k), s = "", b;
    var y = 62, w = 22, slot = 28;
    function bx(i) { return 36 + i * slot; }               // the centre of block i
    function lx(l) { return bx(0) - slot / 2 + l * slot; }  // layer l: the stream after block l − 1
    var ex = lx(lf);
    s += L(6, y, ex, y, "s-ink", ' stroke-width="1.4"');
    s += L(ex, y, lx(12) + 10, y, "s-line", ' stroke-width="1" stroke-dasharray="3 3"');
    s += T(4, y - 22, "emb", "f-dim t-xs");
    for (b = 0; b < 12; b++) {
      var run = b + 0.5 < lf;
      s += R(bx(b) - w / 2, y - 14, w, 28, "f-bg", ' rx="4"');
      s += R(bx(b) - w / 2, y - 14, w, 28, run ? "f-panel" : "f-bg", ' rx="4" style="stroke:var(--vx-' + (run ? "dim" : "line") + (run ? "" : ";stroke-dasharray:2 2") + '"');
      s += TM(bx(b), y + 4, String(b), run ? "f-ink t-s" : "f-dim t-xs");
    }
    // the exit, and the final norm and output layer, which move with it
    var hx = clamp(ex, 44, 356);
    s += L(ex, y - 24, ex, y + 22, "s-acc", ' stroke-width="1.6"');
    s += TM(ex, y - 28, "layer " + Math.round(lf), "f-acc t-xs");
    s += arrow(ex, y + 4, ex, 118, "s-acc", 1.8);
    s += L(ex, 118, hx, 118, "s-acc", ' stroke-width="1.8"');
    s += R(hx - 38, 120, 76, 20, "f-panel", ' rx="3" style="stroke:var(--vx-acc)"') + TM(hx, 133.5, "final norm", "f-ink t-xs");
    s += arrow(hx, 140, hx, 154, "s-acc", 1.4);
    s += R(hx - 38, 156, 76, 20, "f-panel", ' rx="3" style="stroke:var(--vx-acc)"') + TM(hx, 169.5, "output W_U", "f-ink t-xs");
    s += TM(hx, 196, "→ next token", "f-green t-xs");
    if (Lx < 11) s += TM((lx(Lx) + lx(12)) / 2, y + 30, "not run", "f-dim t-xs");
    // a pulse: the token's pass through the blocks kept, then out
    var p = (t % 3000 - 900) / 2000;
    if (p > 0 && p < 1) {
      var lenA = ex - 6, lenB = 104, d = p * (lenA + lenB), px, py;
      if (d < lenA) { px = 6 + d; py = y; } else { px = ex; py = y + (d - lenA); }
      s += C(px, py, 3.5, "f-green");
    }
    s += T(8, 18, "exit layer=" + Lx, "f-ink t-m");
    s += T(8, 104, Lx === 12 ? "the whole model" : Lx + " of 12 blocks run", "f-dim t-xs");
    return { svg: s, read: "exit layer=" + Lx + "    h_" + Lx + " after blocks 0–" + (Lx - 1) + ",  logits = W_U · norm(h_" + Lx + ")" + (Lx === 12 ? "    (layer 12: unchanged)" : ""),
      setting: st.i };
  } });
})(window.VAUExplain);
