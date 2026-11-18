// Abliteration Lens: the Ablate strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, C = H.C, arrow = H.arrow,
      lerp = H.lerp, gauss = H.gauss, stage = H.stage;

  /* ---------- Ablate: a component's output set to 0, or to its corpus mean ---------- */
  // [target, mode]: the settings the figure walks through, as in chains/a.json
  var S = [["head", "zero"], ["head", "mean"], ["attn", "zero"], ["mlp", "mean"]];
  var NAME = { head: "head 5.1", attn: "attention 5", mlp: "MLP 5", block: "block 5" };
  var NP = 14, MEAN = 0.55, Y = [];
  for (var i = 0; i < NP; i++) Y.push(MEAN + 0.75 * gauss(i + 3));   // one coordinate of what it adds, per position
  Y[0] = 2.1;                                                          // the first position, the attention sink, is unlike the rest

  X.register("ablate", {
    caption: "Left, block 5 of GPT-2 small: its attention (twelve heads) and its MLP each add an output y to the "
      + "residual stream. Right, one coordinate of the chosen component's y at each position (outlines: before). "
      + "Zero removes it, <code>y' = 0</code>; mean puts in its average over the reference corpus, the same at every "
      + "position, <code>y' = ȳ</code>, so the stream keeps a typical size and loses only what the component does for "
      + "this text. A whole block is ablated as its contribution, output minus input.",
    examples: "head 5.1 at zero and mean, attention 5 at zero and MLP 5 at mean",
    still: 1 * 3000 + 1800, draw: function (t) {
    var st = stage(t, S.length, 3000, 900), a = S[st.prev], b = S[st.i], k = st.k, s = "", j;
    // what each setting leaves at every position: nothing, or the corpus mean
    function out(set) { return set[1] === "zero" ? 0 : MEAN; }
    // left: block 5, the stream running through it
    var sy = 176, ax = 22, aw = 92, mx = 128, mw = 52, by = 46, bh = 74;
    s += R(12, 34, 180, 104, "f-panel", ' rx="6"');
    s += T(18, 28, "block 5", "f-dim t-xs");
    var hot = b[0];
    // attention: twelve heads
    s += R(ax, by, aw, bh, hot === "attn" ? "f-acc" : "f-bg", ' rx="4" opacity="' + (hot === "attn" ? 0.35 : 1) + '"');
    s += TM(ax + aw / 2, by + 14, "attention", "f-ink t-xs");
    for (j = 0; j < 12; j++) {
      var hx = ax + 7 + (j % 6) * 13.4, hy = by + 24 + Math.floor(j / 6) * 20;
      var on = hot === "head" && j === 1;
      s += R(hx, hy, 10, 15, on ? "f-acc" : "f-panel", ' rx="2"' + (on ? "" : ' style="stroke:var(--vx-line)"'));
      if (on) s += TM(hx + 5, by + bh - 5, "5.1", "f-acc t-xs");
    }
    // MLP
    s += R(mx, by, mw, bh, hot === "mlp" ? "f-acc" : "f-bg", ' rx="4" opacity="' + (hot === "mlp" ? 0.35 : 1) + '"');
    s += TM(mx + mw / 2, by + 14, "MLP", "f-ink t-xs");
    // the stream, and the two outputs added to it; the ablated one fades as it goes
    s += arrow(8, sy, 196, sy, "s-ink", 1.6);
    s += T(8, sy - 6, "h", "f-ink t-s") + T(184, sy - 6, "h'", "f-green t-s");
    [[ax + aw / 2, "attn"], [mx + mw / 2, "mlp"]].forEach(function (c) {
      var hit = c[1] === hot || (hot === "head" && c[1] === "attn");
      s += L(c[0], by + bh, c[0], sy - 6, hit ? "s-acc" : "s-dim", ' stroke-width="1.4"' + (hit ? ' stroke-dasharray="4 3"' : ""));
      s += C(c[0], sy, 6, "f-bg", ' style="stroke:var(--vx-ink)"') + TM(c[0], sy + 3.5, "+", "f-ink t-xs");
      s += T(c[0] + 5, sy - 14, "y", hit ? "f-acc t-xs" : "f-dim t-xs");
    });
    // right: y at each position, outlines before; the bars move to 0 or to ȳ
    var X0 = 214, slot = 12.8, bw = 8, Y0 = 118, ky = 26;
    function yy(v) { return Y0 - v * ky; }
    s += L(X0 - 4, Y0, 396, Y0, "s-line");
    s += TE(X0 - 7, Y0 + 3, "0", "f-dim t-xs");
    s += L(X0 - 4, yy(MEAN), 396, yy(MEAN), "s-green", ' stroke-width="1.2" stroke-dasharray="5 4"');
    s += TE(X0 - 7, yy(MEAN) + 3, "ȳ", "f-green t-s");
    for (j = 0; j < NP; j++) {
      var x = X0 + j * slot + (slot - bw) / 2, v = lerp(out(a), out(b), k);
      s += R(x, Y0, bw, -v * ky, "f-acc", ' opacity="0.85"');
      s += R(x, Y0, bw, -Y[j] * ky, "s-ink", ' fill="none" stroke-width="1" stroke-dasharray="3 2" opacity="0.55"');
    }
    s += T(X0 - 4, 24, "y at each position", "f-dim t-xs");
    s += T(X0 - 4, 196, "positions →", "f-dim t-xs");
    s += T(X0 - 4, 160, NAME[b[0]] + ", " + b[1], "f-ink t-m");
    s += T(X0 - 4, 176, b[1] === "zero" ? "y' = 0: nothing is added" : "y' = ȳ: the corpus average", "f-dim t-xs");
    var form = b[1] === "zero" ? "y' = 0" : "y' = ȳ (its mean over the reference corpus)";
    return { svg: s, read: "ablate " + b[0] + "=" + (b[0] === "head" ? "5.1" : "5") + " mode=" + b[1] + "    " + NAME[b[0]] + " adds y to the stream;  " + form +
      ",  so h' = h + y'", setting: st.i };
  } });
})(window.VAUExplain);
