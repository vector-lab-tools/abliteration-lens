// Abliteration Lens: the Chorus strip's explainer, an animated figure of what generate.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by VAU's explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, n1 = H.n1, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, C = H.C, P = H.P, arrow = H.arrow,
      clamp = H.clamp, lerp = H.lerp, gauss = H.gauss, f2 = H.f2, stage = H.stage;

  /* ---------- Chorus: the dry pass and n detuned voices, their probabilities averaged ---------- */
  // GPT-2 small's own numbers at the first step (after "… the archive is"): the dry pass's eight
  // likeliest next tokens, and each voice's probability for them, with noise at layer 6 drawn
  // from the voice's seed as generate._chorus_hook draws it (seed 42), at sigma 0.3 and 1.
  var WORDS = [" that", " the", " not", " how", " what", " whether", " its", " to"];
  var DRY = [0.418, 0.117, 0.093, 0.07, 0.039, 0.023, 0.019, 0.015];
  var VOX = {
    0.3: [[0.134, 0.109, 0.129, 0.041, 0.073, 0.02, 0.004, 0.009], [0.13, 0.129, 0.031, 0.221, 0.064, 0.047, 0.029, 0.006],
          [0.301, 0.149, 0.031, 0.12, 0.01, 0.01, 0.036, 0.036], [0.135, 0.108, 0.059, 0.007, 0.015, 0.008, 0.001, 0.008],
          [0.234, 0.117, 0.084, 0.182, 0.055, 0.03, 0.006, 0.001], [0.195, 0.123, 0.026, 0.026, 0.02, 0.004, 0, 0.046],
          [0.058, 0.221, 0.01, 0.125, 0.074, 0.018, 0.006, 0.011], [0.304, 0.154, 0.01, 0.134, 0.046, 0.016, 0.062, 0]],
    1: [[0.074, 0.011, 0.007, 0.003, 0.004, 0.004, 0.001, 0.008], [0.008, 0.102, 0.002, 0.008, 0.003, 0.002, 0.007, 0.001],
        [0.009, 0.116, 0.001, 0.01, 0.001, 0.002, 0.01, 0.007], [0.008, 0.013, 0.009, 0, 0.001, 0, 0, 0.001],
        [0.006, 0.027, 0.018, 0.003, 0.003, 0, 0, 0], [0.005, 0.008, 0.005, 0, 0, 0, 0, 0.007],
        [0.012, 0.107, 0.001, 0.037, 0.021, 0.004, 0.001, 0.007], [0.002, 0.011, 0.001, 0, 0, 0, 0.001, 0.001]]
  };
  function withRest(p) { var s = 0; p.forEach(function (v) { s += v; }); return p.concat([Math.max(0, 1 - s)]); }
  function mean(n, sigma) {                 // (p_dry + p_1 + … + p_n) / (n + 1), over the eight words and the rest
    var out = withRest(DRY).slice(), v, i, rows = VOX[sigma];
    for (v = 0; v < n; v++) { var q = withRest(rows[v]); for (i = 0; i < out.length; i++) out[i] += q[i]; }
    return out.map(function (x) { return x / (n + 1); });
  }
  var S = [[0, 0.3], [3, 0.3], [8, 0.3], [3, 1]];

  X.register("chorus", {
    caption: "The first step of the text, after “… the archive is”, in GPT-2 small. Each voice is a further pass "
      + "with noise added to the stream at layer 6, <code>h + σ · rms(h) · z</code>, z drawn from the voice's own "
      + "seed; the next token is drawn from the mean of the dry pass's and the voices' probabilities, "
      + "<code>p = (p<sub>dry</sub> + p<sub>1</sub> + … + p<sub>n</sub>) / (n + 1)</code>. The bars are that mean, the "
      + "dashed outlines the dry pass, the dots each voice.",
    examples: "voices 0, then 3 and 8 at sigma 0.3, then 3 at sigma 1",
    still: 2 * 3600 + 1800, draw: function (t) {
    var st = stage(t, S.length, 3600, 900), a = S[st.prev], b = S[st.i], s = "", i, v;
    var ma = mean(a[0], a[1]), mb = mean(b[0], b[1]);
    // left: the voices fanning out from layer 6 and meeting at the mean
    var x0 = 30, x1 = 118, cy = 112, nb = b[0], na = a[0], N = 8;
    s += T(8, 16, "a pass per voice", "f-dim t-xs");
    s += R(x0 - 22, cy - 11, 30, 22, "f-panel", ' rx="3"') + TM(x0 - 7, cy + 3.5, "L6", "f-ink t-xs");
    s += L(x0 + 8, cy, x1 - 6, cy, "s-ink", ' stroke-width="1.6"');
    for (v = 0; v < N; v++) {
      var on = v < nb ? (v < na ? 1 : st.k) : (v < na ? 1 - st.k : 0);
      if (on <= 0.01) continue;
      var sig = v < nb ? b[1] : a[1], off = (v % 2 ? 1 : -1) * (14 + 9 * Math.floor(v / 2)), d = "M" + (x0 + 8) + " " + cy, k;
      for (k = 1; k <= 12; k++) {
        var xx = lerp(x0 + 8, x1 - 6, k / 12), env = Math.sin(Math.PI * k / 12);
        var yy = cy + off * env + 5 * sig * env * Math.sin(k * 2.1 + v * 1.7 + t / 260);
        d += " L" + n1(xx) + " " + n1(yy);
      }
      s += P(d, "s-blue", ' stroke-width="1.1" opacity="' + f2(0.75 * on) + '"');
    }
    s += C(x1, cy, 6, "f-acc") + TM(x1, cy + 22, "mean", "f-acc t-xs");
    s += arrow(x1 + 8, cy, 144, cy, "s-acc", 1.4);
    // right: the eight likeliest words and the rest, the mean as bars
    var lx = 210, bx = 216, bw = 176, y0 = 32, rh = 16.5;
    s += T(bx, 16, "next-token p, 0 to 1", "f-dim t-xs");
    [0.25, 0.5, 0.75, 1].forEach(function (g) { s += L(bx + g * bw, y0 - 4, bx + g * bw, y0 + 9 * rh, "s-soft"); });
    s += L(bx, y0 - 4, bx, y0 + 9 * rh, "s-line");
    for (i = 0; i < 9; i++) {
      var y = y0 + i * rh, p = lerp(ma[i], mb[i], st.k), dry = i < 8 ? DRY[i] : withRest(DRY)[8];
      s += TE(lx, y + 9.5, i < 8 ? "“" + WORDS[i] + "”" : "the rest", i < 8 ? "f-ink t-xs" : "f-dim t-xs");
      s += R(bx, y + 2, p * bw, rh - 5, "f-acc", ' opacity="0.85"');
      s += R(bx, y + 2, dry * bw, rh - 5, "s-ink", ' fill="none" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"');
      for (v = 0; v < N; v++) {
        var vo = v < nb ? (v < na ? 1 : st.k) : (v < na ? 1 - st.k : 0);
        if (vo <= 0.01) continue;
        var vp = withRest(VOX[v < nb ? b[1] : a[1]][v])[i];
        s += C(bx + vp * bw, y + 2 + (rh - 5) / 2 + (v - 3.5) * 0.9, 2.2, "f-blue", ' opacity="' + f2(0.8 * vo) + '"');
      }
    }
    s += R(bx, 192, 9, 8, "f-acc", ' opacity="0.85"') + T(bx + 13, 199.5, "mean", "f-dim t-xs");
    s += R(bx + 52, 192, 9, 8, "s-ink", ' fill="none" stroke-dasharray="3 2" opacity="0.6"') + T(bx + 65, 199.5, "dry", "f-dim t-xs");
    s += C(bx + 101, 196, 2.5, "f-blue") + T(bx + 107, 199.5, "each voice", "f-dim t-xs");
    var top = mb.slice(0, 8).indexOf(Math.max.apply(null, mb.slice(0, 8)));
    s += T(8, 199, nb ? nb + " voice" + (nb > 1 ? "s" : "") + ", σ " + b[1] + ": " + (nb + 1) + " passes" : "voices 0: dry alone", "f-ink t-s");
    return { svg: s, setting: st.i, read: (nb ? "voices " + nb + " · sigma " + b[1] + " · layer 6:  p = (p_dry + p_1 + … + p_" + nb + ") / " + (nb + 1) +
      ",  then the next token is drawn from p    (p(“" + WORDS[top] + "”) " + f2(mb[top]) + ")" :
      "voices 0: the dry chain alone, neutral    p(“ that”) " + f2(DRY[0])) };
  } });
})(window.VAUExplain);
