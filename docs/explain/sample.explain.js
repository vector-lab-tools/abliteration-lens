// Abliteration Lens: the Sampler bend strip's explainer, an animated figure of what generate.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L,
      lerp = H.lerp, stage = H.stage;

  /* ---------- Sampler bend: ban-top, ceiling, invert, as _choose in generate.py ---------- */
  // Candidates for the next token after the prompt and their logits (drawn); the sampler at
  // temperature 0.8, top-k 40, top-p 0.95.
  var W = [" that", " the", " not", " a", " how", " what", " in", " to", " its", " this", " one"],
      LG = [2.3, 1.55, 1.3, 1.1, 0.95, 0.8, 0.6, 0.45, 0.3, 0.15, -0.3];
  function norm(p) { var z = p.reduce(function (a, b) { return a + b; }, 0); return p.map(function (v) { return z > 0 ? v / z : 0; }); }
  function choose(mode, val) {
    var l = LG.map(function (v) { return v / 0.8; }), out = {};
    if (mode === "ban-top") {                // the k largest logits → −∞, before top-k and top-p
      var ordL = l.map(function (v, i) { return i; }).sort(function (a, b) { return l[b] - l[a]; });
      out.ban = {};
      ordL.slice(0, val).forEach(function (i) { l[i] = -Infinity; out.ban[i] = 1; });
    }
    var m = Math.max.apply(null, l.filter(isFinite));
    var p = norm(l.map(function (v) { return isFinite(v) ? Math.exp(v - m) : 0; }));
    var ord = p.map(function (v, i) { return i; }).sort(function (a, b) { return p[b] - p[a]; }), cum = 0, keep = [];
    ord.forEach(function (i, r) { keep[i] = r === 0 || cum < 0.95; cum += p[i]; });   // top-p 0.95
    p = norm(p.map(function (v, i) { return keep[i] ? v : 0; }));
    out.before = p;
    if (mode === "ceiling") {                // keep only p ≤ ceiling (after top-k and top-p)
      var q = p.map(function (v) { return v <= val ? v : 0; });
      p = q.some(function (v) { return v > 0; }) ? norm(q) : p;
    } else if (mode === "invert") {          // p → 1/p over the candidates kept
      p = norm(p.map(function (v) { return v > 0 ? 1 / v : 0; }));
    }
    out.p = p;
    return out;
  }
  var S = [["ban-top", 1], ["ban-top", 3], ["ceiling", 0.2], ["invert", 0]], D = S.map(function (o) { return choose(o[0], o[1]); }), D0 = choose("none", 0);

  X.register("sample", {
    caption: "The sampling distribution for the next token after the prompt (the outlines: with no bend). "
      + "<i>ban-top</i> sets the k most probable tokens' logits to −∞ before top-k and top-p, so others move into "
      + "the nucleus; <i>ceiling</i> keeps only the candidates with p ≤ the ceiling, after top-k and top-p; "
      + "<i>invert</i> makes each kept candidate's chance <code>(1/p) / Σ(1/p)</code>, so the least likely becomes "
      + "the most. The model is untouched.",
    examples: "ban-top k 1 and 3, ceiling p 0.2, and invert",
    still: 2 * 3000 + 1500, draw: function (t) {
    var st = stage(t, S.length, 3000, 900), a = D[st.prev], b = D[st.i], o = S[st.i], s = "", i;
    var X0 = 34, sl = 32.5, bw = 21, Y0 = 162, kp = 230;
    s += T(8, 16, "next-token distribution (T 0.8, top-k 40, top-p 0.95)", "f-dim t-xs");
    s += L(X0 - 6, Y0, 394, Y0, "s-line");
    [0.25, 0.5].forEach(function (g) { s += L(X0 - 6, Y0 - g * kp, 394, Y0 - g * kp, "s-soft"); s += TE(X0 - 8, Y0 - g * kp + 3, String(g), "f-dim t-xs"); });
    if (o[0] === "ceiling") {
      s += L(X0 - 6, Y0 - o[1] * kp, 394, Y0 - o[1] * kp, "s-green", ' stroke-width="1.4" stroke-dasharray="6 4"');
      s += TE(394, Y0 - o[1] * kp - 5, "ceiling p = " + o[1], "f-green t-xs");
    }
    for (i = 0; i < W.length; i++) {
      var x = X0 + i * sl, p = lerp(a.p[i], b.p[i], st.k), ban = b.ban && b.ban[i], out = !ban && p < 1e-6;
      s += R(x, Y0, bw, -p * kp, ban ? "f-red" : "f-blue", ' opacity="0.82"');
      s += R(x, Y0, bw, -D0.p[i] * kp, "s-ink", ' fill="none" stroke-width="1" stroke-dasharray="3 2" opacity="0.55"');
      s += TM(x + bw / 2, Y0 + 15, W[i].trim(), ban ? "f-red t-xs" : out ? "f-dim t-xs" : "f-ink t-xs");
      if (ban) s += TM(x + bw / 2, Y0 + 30, "−∞", "f-red t-xs");
    }
    var read = o[0] === "ban-top" ? "sample mode=ban-top k=" + o[1] + "    " + (o[1] === 1 ? "the largest logit" : "the " + o[1] + " largest logits") + " → −∞, then top-k and top-p: the next tokens move up"
      : o[0] === "ceiling" ? "sample mode=ceiling p=" + o[1] + "    after top-k and top-p, keep only p ≤ " + o[1] + ", renormalised (none under it: the least probable)"
      : "sample mode=invert    after top-k and top-p, p → (1/p) / Σ(1/p): the least probable candidate becomes the most likely";
    return { svg: s, setting: st.i, read: read };
  } });
})(window.VAUExplain);
