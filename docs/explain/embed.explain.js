// Abliteration Lens: the Embedding bend strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by VAU's explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, C = H.C, arrow = H.arrow, lerp = H.lerp, f2 = H.f2, stage = H.stage;

  /* ---------- Embedding bend: which input embedding a token is read with ---------- */
  // A plane of input embeddings (rows of the token embedding matrix E). The hooks on the token
  // embedding change what a token is read with: embed_mix_hook moves " archive" toward " museum"
  // by mix, embed_swap_hook trades the two, embed_noise_hook adds one fixed noise vector to it.
  var O = [46, 168], A = [150, 70], M = [290, 54];
  var OTHERS = [["library", 214, 104], ["record", 116, 128], ["city", 300, 128], ["the", 74, 112], ["is", 248, 160]];
  var Z = [0.54, 0.84];                                       // the fixed noise vector's direction in the plane
  var S = [{ mix: 0 }, { mix: 0.5 }, { swap: true }, { sigma: 1 }];
  var PROMPT = ["What", "matters", "about", "the", "archive", "is"];
  function place(set) {                                      // where " archive" and " museum" are read from
    if (set.swap) return [M, A];
    if (set.sigma !== undefined) {
      var len = set.sigma * Math.hypot(A[0] - O[0], A[1] - O[1]) * 0.55;       // ‖z‖ ≈ σ ‖E[archive]‖, drawn at 0.55 so it fits
      return [[A[0] + Z[0] * len, A[1] + Z[1] * len], M];
    }
    return [[lerp(A[0], M[0], set.mix), lerp(A[1], M[1], set.mix)], M];
  }
  X.register("embed", {
    caption: "A plane of GPT-2 small's input embeddings, the rows of its token embedding matrix E, which the "
      + "model reads before block 0. A mix moves the first word toward the second, <code>(1 − mix) E[a] + mix "
      + "E[b]</code>, and leaves the second as it is; a swap (no mix) trades them; token= with sigma adds one "
      + "fixed noise vector, <code>z ~ N(0, σ² ‖E[a]‖² / d)</code>, wherever the token occurs. Only the input side "
      + "changes: the model still writes each word from its own output row.",
    examples: "a mix of “archive” toward “museum” at 0 and 0.5, the full swap, then noise on “archive” at sigma 1",
    still: 1 * 3000 + 1500, draw: function (t) {
    var st = stage(t, S.length, 3000, 900), a = place(S[st.prev]), b = place(S[st.i]), k = st.k, s = "", i;
    var ea = [lerp(a[0][0], b[0][0], k), lerp(a[0][1], b[0][1], k)], em = [lerp(a[1][0], b[1][0], k), lerp(a[1][1], b[1][1], k)], set = S[st.i];
    s += L(O[0] - 5, O[1], O[0] + 5, O[1], "s-dim") + L(O[0], O[1] - 5, O[0], O[1] + 5, "s-dim") + TE(O[0] - 7, O[1] + 4, "0", "f-dim t-xs");
    for (i = 0; i < OTHERS.length; i++) s += C(OTHERS[i][1], OTHERS[i][2], 3, "f-dim", ' opacity="0.6"') + T(OTHERS[i][1] + 6, OTHERS[i][2] + 3, OTHERS[i][0], "f-dim t-xs");
    s += L(O[0], O[1], A[0], A[1], "s-line", ' stroke-dasharray="3 3"');
    s += L(A[0], A[1], M[0], M[1], "s-soft", ' stroke-width="1.2"');
    // the rows of E as they are
    s += C(A[0], A[1], 5, "s-ink", ' fill="none" stroke-width="1.2"') + TE(A[0] - 8, A[1] - 6, "E[archive]", "f-ink t-xs");
    s += C(M[0], M[1], 5, "s-ink", ' fill="none" stroke-width="1.2"') + T(M[0] + 8, M[1] - 6, "E[museum]", "f-ink t-xs");
    // what each word is read with now
    var both = Math.hypot(em[0] - M[0], em[1] - M[1]) > 7, ox = both ? 0.11 * 5 : 0, oy = both ? 0.99 * 5 : 0;   // a swap: the two arrows side by side
    if (Math.hypot(ea[0] - A[0], ea[1] - A[1]) > 7) s += arrow(A[0] - ox, A[1] - oy, ea[0] - ox, ea[1] - oy, "s-acc", 1.8);
    if (both) s += arrow(M[0] + ox, M[1] + oy, em[0] + ox, em[1] + oy, "s-blue", 1.8);
    s += C(ea[0], ea[1], 4.5, "f-acc") + C(em[0], em[1], 3.8, "f-blue");
    // the prompt as the model reads it
    var X0 = 72, cw = 48, y = 184, said = set.swap ? "museum" : set.sigma !== undefined ? "archive + z" : set.mix > 0 ? Math.round(set.mix * 100) + "% museum" : "archive";
    for (i = 0; i < PROMPT.length; i++) {
      var on = i === 4;
      s += R(X0 + i * cw + 1, y - 11, cw - 2, 18, on ? "f-acc" : "f-panel", ' rx="3"');
      s += TM(X0 + i * cw + cw / 2, y + 2, PROMPT[i], on ? "f-bg t-xs" : "f-dim t-xs");
    }
    s += TM(X0 + 4 * cw + cw / 2, y + 20, "read as " + said, "f-acc t-xs");
    s += T(8, 16, "input embeddings (rows of E)", "f-dim t-xs");
    var read;
    if (set.swap) read = "swap=\" archive, museum\"    “archive” is read with E[museum] and “museum” with E[archive], wherever they occur";
    else if (set.sigma !== undefined) read = "token=\" archive\" sigma " + f2(set.sigma) + "    E[archive] + z,  z ~ N(0, σ² ‖E[archive]‖² / d), one fixed draw from the seed";
    else read = "swap=\" archive, museum\" mix " + f2(set.mix) + "    “archive” read with (1 − mix) E[archive] + mix E[museum]; “museum” read as it is" + (set.mix === 0 ? "    (mix 0 changes nothing)" : "");
    return { svg: s, read: read, setting: st.i };
  } });
})(window.VAUExplain);
