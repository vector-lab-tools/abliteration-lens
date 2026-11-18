// Abliteration Lens: the Token strip's explainer, an animated figure of what interventions.py and generate.py compute.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, n1 = H.n1,
      clamp = H.clamp, lerp = H.lerp, gauss = H.gauss, stage = H.stage;

  /* ---------- Token: zero a word's embedding, or ban it at the sampler ---------- */
  var TOK = ["What", " matters", " about", " the", " archive", " is"], ZERO = 4, NE = 7;
  // the next token after the prompt: candidates and their logits (drawn), and the sampler's
  // temperature 0.8, top-k 40, top-p 0.95, as _choose in generate.py
  var W = [" that", " the", " not", " a", " how", " what", " in", " to", " its", " this"],
      LG = [2.3, 1.55, 1.3, 1.1, 0.95, 0.8, 0.6, 0.45, 0.3, 0.15];
  function dist(ban) {
    var l = LG.map(function (v, i) { return ban[i] ? -Infinity : v / 0.8; }), m = Math.max.apply(null, l);
    var p = l.map(function (v) { return v === -Infinity ? 0 : Math.exp(v - m); }), z = p.reduce(function (a, b) { return a + b; }, 0);
    p = p.map(function (v) { return v / z; });
    var ord = p.map(function (v, i) { return i; }).sort(function (a, b) { return p[b] - p[a]; }), cum = 0, keep = [];
    ord.forEach(function (i, r) { keep[i] = r === 0 || cum < 0.95; cum += p[i]; });
    p = p.map(function (v, i) { return keep[i] ? v : 0; });
    z = p.reduce(function (a, b) { return a + b; }, 0);
    return p.map(function (v) { return v / z; });
  }
  var BANS = [null, [0], [0, 1]];
  function banned(si) { var b = W.map(function () { return 0; }); (BANS[si] || []).forEach(function (i) { b[i] = 1; }); return b; }

  X.register("token", {
    caption: "Two modes. <i>zero</i>: wherever the word occurs, its input embedding is read as a zero vector, so the "
      + "model reads only its position embedding there (in GPT-2). <i>ban</i>: the model may not write the word; at "
      + "every step the logit of its first token is set to −∞ before the softmax, top-k and top-p, and the other "
      + "candidates share its probability. The model itself is untouched.",
    examples: "zero “ archive”, then ban “ that”, then ban “ that, the”",
    still: 1 * 3000 + 1500, draw: function (t) {
    var st = stage(t, 3, 3000, 900), s = "", i, j;
    if (st.i === 0) {                         // zero: the prompt's input vectors, the word's embedding falling to 0
      var X0 = 24, slot = 62, ky = 5.5, cy1 = 66, cy2 = 122;
      s += T(8, 16, "what block 0 reads at each token: the sum of two vectors", "f-dim t-xs");
      s += L(X0 - 6, cy1, 394, cy1, "s-line") + L(X0 - 6, cy2, 394, cy2, "s-line");
      s += TM(209, 98, "+", "f-dim t-m");
      for (i = 0; i < TOK.length; i++) {
        var z = i === ZERO, f = z ? 1 - st.k : 1, x = X0 + i * slot;
        for (j = 0; j < NE; j++) {
          var e = gauss(i * 17 + j * 3 + 1) * 1.6 * f, pe = gauss(j * 5 + i * 2 + 90) * 1.1;
          s += R(x + j * 7, cy1, 5, -clamp(e, -4, 4) * ky, z ? "f-acc" : "f-ink", ' opacity="' + (z ? 0.9 : 0.6) + '"');
          s += R(x + j * 7, cy2, 5, -clamp(pe, -3.5, 3.5) * ky, "f-blue", ' opacity="0.75"');
        }
        s += R(x - 5, 152, 56, 20, z ? "f-acc" : "f-panel", ' rx="3"' + (z ? ' opacity="0.25"' : ""));
        s += TM(x + 23, 166, TOK[i].trim(), z ? "f-acc t-xs" : "f-ink t-xs");
      }
      s += T(X0, 194, "token embedding (above)", "f-ink t-xs") + TE(394, 194, "position embedding (below)", "f-blue t-xs");
      s += TM(X0 + ZERO * slot + 23, 38, "→ 0", "f-acc t-s", ' opacity="' + n1(st.k * 100) / 100 + '"');
      return { svg: s, setting: 0, read: "token word=\" archive\" mode=zero    embedding(\" archive\") → 0 wherever it occurs, in the prompt and in what is written; its position embedding is still read" };
    }
    // ban: the next token's sampling distribution, the banned words ruled out
    var from = st.prev === 0 ? dist(banned(0)) : dist(banned(st.prev)), to = dist(banned(st.i)), b = banned(st.i);
    var X1 = 34, sl = 35.5, bw = 22, Y0 = 162, kp = 220;
    s += T(8, 16, "next-token distribution after “… archive is”", "f-dim t-xs");
    s += L(X1 - 6, Y0, 394, Y0, "s-line");
    [0.25, 0.5].forEach(function (g) { s += L(X1 - 6, Y0 - g * kp, 394, Y0 - g * kp, "s-soft"); s += TE(X1 - 8, Y0 - g * kp + 3, String(g), "f-dim t-xs"); });
    var base = dist(banned(0));
    for (i = 0; i < W.length; i++) {
      var x1 = X1 + i * sl, p = lerp(from[i], to[i], st.k);
      s += R(x1, Y0, bw, -p * kp, b[i] ? "f-red" : "f-green", ' opacity="0.8"');
      s += R(x1, Y0, bw, -base[i] * kp, "s-ink", ' fill="none" stroke-width="1" stroke-dasharray="3 2" opacity="0.55"');
      s += TM(x1 + bw / 2, Y0 + 15, W[i].trim(), b[i] ? "f-red t-xs" : "f-ink t-xs");
      if (b[i]) s += TM(x1 + bw / 2, Y0 + 30, "−∞", "f-red t-xs");
    }
    var words = (BANS[st.i] || []).map(function (i) { return W[i]; });
    return { svg: s, setting: st.i, read: "token word=\"" + words.join(",") + "\" mode=ban    logit[first token of each word] = −∞ at every step, before the softmax, top-k and top-p; the others share its probability" };
  } });
})(window.VAUExplain);
