// Abliteration Lens: the Rewrite strip's explainer, an animated figure of what rewrite.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, n1 = H.n1,
      lerp = H.lerp, f2 = H.f2, stage = H.stage;

  /* ---------- Rewrite: a rank-one edit, amount · (x · c) · d ---------- */
  // The prompt's tokens and how far each one's MLP key x matches the subject's key k* (x · c, drawn):
  // exactly 1 at the subject's last token, since c = C⁻¹k* / (k*ᵀC⁻¹k*).
  var TOK = ["What", " matters", " about", " the", " archive", " is"], XC = [0.05, 0.14, -0.09, 0.11, 1, 0.21], SUBJ = 4;
  function target(a) { return 0.02 + 0.9 * (1 - Math.exp(-2.2 * a)); }   // the target's chance after the prompt (drawn)

  X.register("rewrite", {
    caption: "The prompt's tokens at block 5. Each one's MLP key x is set against the subject's key k* through "
      + "<code>c = C⁻¹k* / (k*ᵀC⁻¹k*)</code> (C, the keys' covariance over the reference corpus), and the MLP's "
      + "output gains <code>amount · (x · c) · d</code>, d being the change fitted so that the model writes the "
      + "target. x · c is exactly 1 at the subject's last token; other keys gain as much as their likeness to k* "
      + "allows. Right, the target's chance after the prompt (drawn, not measured).",
    examples: "amount 0, 0.5, 1 and 2, with subject “archive” and target “ silence” at block 5",
    still: 2 * 3000 + 1500, draw: function (t) {
    var S = [0, 0.5, 1, 2], st = stage(t, S.length, 3000, 900), amt = lerp(S[st.prev], S[st.i], st.k), s = "", i;
    var X0 = 30, slot = 45, bw = 27, Y0 = 150, ky = 42;
    function x(i) { return X0 + i * slot; }
    s += L(X0 - 6, Y0, x(TOK.length - 1) + bw + 6, Y0, "s-line");
    [1, 2].forEach(function (g) {
      s += L(X0 - 6, Y0 - g * ky, x(TOK.length - 1) + bw + 6, Y0 - g * ky, "s-soft");
      s += TE(X0 - 8, Y0 - g * ky + 3, String(g), "f-dim t-xs");
    });
    for (i = 0; i < TOK.length; i++) {
      var subj = i === SUBJ, v = amt * XC[i];
      s += R(x(i), Y0, bw, -v * ky, subj ? "f-acc" : "f-blue", ' opacity="' + (subj ? 0.95 : 0.7) + '"');
      s += R(x(i) + bw / 2 - 21, Y0 + 8, 42, 18, subj ? "f-acc" : "f-panel", ' rx="3"' + (subj ? ' opacity="0.25"' : ""));
      s += TM(x(i) + bw / 2, Y0 + 21, TOK[i].trim(), subj ? "f-acc t-xs" : "f-ink t-xs");
      s += TM(x(i) + bw / 2, Y0 + 38, (XC[i] < 0 ? "−" + Math.abs(XC[i]).toFixed(2) : XC[i].toFixed(2)), subj ? "f-acc t-xs" : "f-dim t-xs");
    }
    s += TE(X0 - 6, Y0 + 38, "x·c", "f-dim t-xs");
    s += TM(x(SUBJ) + bw / 2, Y0 - Math.max(0, amt) * ky - 12, "+" + f2(amt) + " d", "f-acc t-s");
    s += T(8, 16, "how much of d each token's MLP output gains:  amount · (x · c)", "f-dim t-xs");
    // right: what the model writes after the prompt
    var RX = 304, RW = 84, p = target(amt), q = (1 - p) * 0.55;
    s += L(RX - 10, 30, RX - 10, 196, "s-soft");
    s += T(RX, 42, "next token", "f-dim t-xs") + T(RX, 54, "after “… is”", "f-dim t-xs");
    s += R(RX, 72, RW, 14, "f-panel", ' rx="2"') + R(RX, 72, RW * q, 14, "f-blue", ' rx="2" opacity="0.75"');
    s += T(RX, 99, "“ that”  " + q.toFixed(2), "f-dim t-xs");
    s += R(RX, 112, RW, 14, "f-panel", ' rx="2"') + R(RX, 112, RW * p, 14, "f-green", ' rx="2" opacity="0.85"');
    s += T(RX, 139, "“ silence”  " + p.toFixed(2), "f-green t-xs");
    s += T(RX, 160, "(drawn)", "f-dim t-xs");
    return { svg: s, setting: st.i,
      read: "amount " + f2(amt) + " · block 5 · subject “archive” → target “ silence”    W_out += amount · c dᵀ,  so the output gains amount · (x · c) · d"
        + (amt < 1e-6 ? "    amount 0: neutral" : "") };
  } });
})(window.VAUExplain);
