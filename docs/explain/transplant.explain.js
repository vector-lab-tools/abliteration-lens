// Abliteration Lens: the Transplant strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by VAU's explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, n1 = H.n1, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, arrow = H.arrow, clamp = H.clamp, ease = H.ease,
      lerp = H.lerp, stage = H.stage;

  /* ---------- Transplant: one position's stream from a run on another prompt ---------- */
  // Top, a run on the other prompt, at the chosen layer. Below, this run: its positions across and
  // its layers 0 to 12 up. transplant_edit replaces this run's stream at position `at` (−1 is the
  // prompt's last token) and that layer with the other run's at its token `from`. Everything above
  // that layer, at that position and every later one, reads the change; nothing below it does.
  var HERE = ["What", "matters", "about", "the", "archive", "is", "…", "…"], NP = 6;
  var OTHER = ["The", "worst", "thing", "about", "the", "city", "is"];
  var S = [{ src: HERE.slice(0, NP), layer: 6, at: -1, from: -1, same: true },
           { src: OTHER, layer: 6, at: -1, from: -1 },
           { src: OTHER, layer: 6, at: -2, from: -2 },
           { src: OTHER, layer: 2, at: -2, from: -2 }];
  var STEP = 3400;
  X.register("transplant", {
    caption: "Top, a run of the unchanged model on the other prompt, at the chosen layer. Below, this run: "
      + "its positions across and its layers 0 to 12 up. Transplant puts the other run's stream at its token "
      + "<code>from</code> in place of this run's at token <code>at</code> of the prompt, at that layer "
      + "(−1 is the last token): <code>h[at] ← h_other[from]</code>. Every later layer, at that position and "
      + "at every position after it, reads the change; nothing below it does. From the same prompt it changes nothing.",
    examples: "the prompt itself (no change), then “The worst thing about the city is” at −1, at −2, and at −2 from layer 2",
    still: 2 * STEP + 2200, draw: function (t) {
    var st = stage(t, S.length, STEP, 700), a = S[st.prev], b = S[st.i], s = "", i, l;
    var X0 = 54, cw = 42, top = 66, rh = 8, lay = Math.round(lerp(a.layer, b.layer, st.k));
    var at = NP + b.at, from = b.src.length + b.from, into = (t % STEP) / STEP;
    function cx(p) { return X0 + p * cw; }
    function ry(l) { return top + (12 - l) * rh; }
    // the other run, one row, placed so that `from` sits over `at`
    var off = lerp((NP + a.at) - (a.src.length + a.from), at - from, st.k);
    s += T(8, 14, "a run on “" + b.src.join(" ") + "”, layer " + b.layer, "f-dim t-xs");
    for (i = 0; i < b.src.length; i++) {
      var x = cx(i + off);
      s += R(x + 1, 22, cw - 2, 18, i === from ? "f-acc" : "f-panel", ' rx="3"');
      s += TM(x + cw / 2, 34.5, b.src[i], i === from ? "f-bg t-xs" : "f-dim t-xs");
    }
    // this run: positions × layers
    var reach = ease(clamp((into - 0.15) / 0.6, 0, 1)) * 13;          // how far up the change has travelled, in layers
    for (var p = 0; p < HERE.length; p++) {
      for (l = 0; l <= 12; l++) {
        var hit = !b.same && l > lay && p >= at && l - lay <= reach, fade = hit ? 0.25 + 0.55 * (1 - (p - at) / 8) * (1 - (l - lay) / 14) : 0;
        s += R(cx(p) + 1, ry(l) + 0.5, cw - 2, rh - 1.5, "f-panel");
        if (hit) s += R(cx(p) + 1, ry(l) + 0.5, cw - 2, rh - 1.5, "f-acc", ' opacity="' + n1(fade * 100) / 100 + '"');
      }
      s += TM(cx(p) + cw / 2, 182, HERE[p], p === at ? "f-ink t-xs" : "f-dim t-xs");
    }
    var tx = cx(at) + 1, ty = ry(lay) + 0.5;
    s += R(tx, ty, cw - 2, rh - 1.5, b.same ? "f-green" : "f-acc");
    s += arrow(cx(at) + cw / 2, 42, cx(at) + cw / 2, ty - 1, b.same ? "s-green" : "s-ink", 1.6);
    [0, 6, 12].forEach(function (k) { if (k !== lay) s += TE(X0 - 6, ry(k) + 7, String(k), "f-dim t-xs"); });
    s += TE(X0 - 6, ry(lay) + 7, String(lay), "f-acc t-xs");
    s += T(8, 200, b.same ? "this run · the same vector goes in: nothing changes" : "this run: positions →, layers ↑", "f-dim t-xs");
    var name = function (arr, k) { return "“" + arr[k] + "”"; };
    return { svg: s, read: "layer " + b.layer + " · from " + String(b.from).replace("-", "−") + " (" + name(b.src, from) + ") · at " + String(b.at).replace("-", "−") + " (" + name(HERE, at) + ")"
      + "    h[at] ← h_other[from]    " + (b.same ? "(from this prompt itself: the same vector, so nothing changes)" : "(every layer above, at this position and after it, reads the change)"), setting: st.i };
  } });
})(window.VAUExplain);
