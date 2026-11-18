// Abliteration Lens: the Position bend strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, C = H.C,
      clamp = H.clamp, lerp = H.lerp, rnd = H.rnd, stage = H.stage;

  /* ---------- Position bend: which row of the position table each token reads ---------- */
  var NPOS = 1024, NT = 12;                 // GPT-2's table of learned positions; the first twelve tokens of a text
  // the settings the figure walks through, as in chains/a.json
  var S = [["shift", 0], ["shift", 200], ["shift", 600], ["scramble", 0], ["freeze", 0]];
  var PERM = [];                            // a fixed random position for each (the strip draws its own from the seed)
  for (var i = 0; i < NT; i++) PERM.push(Math.floor(rnd(i * 7 + 5) * NPOS));
  function q(set, p) {                      // as position_hook: the position token p is read with
    if (set[0] === "shift") return clamp(p + set[1], 0, NPOS - 1);
    if (set[0] === "freeze") return clamp(set[1], 0, NPOS - 1);
    return PERM[p];
  }
  function name(set) { return set[0] + (set[0] === "scramble" ? "" : " k=" + set[1]); }

  X.register("position", {
    caption: "Top, the first twelve tokens of a text at positions p = 0 to 11. Bottom, GPT-2's table of 1,024 learned "
      + "position embeddings; each line is the row a token is read with, <code>e = W_pos[q(p)]</code>. Shift reads "
      + "<code>q = p + k</code> (held within the table), so the model takes itself to be further into a text; "
      + "scramble reads a fixed random row for each position, the same in every pass, so word order is lost; "
      + "freeze reads row k for every token. Shift by 0 changes nothing.",
    examples: "shift by 0, 200 and 600, scramble, and freeze at 0",
    still: 1 * 3000 + 1800, draw: function (t) {
    var st = stage(t, S.length, 3000, 900), a = S[st.prev], b = S[st.i], k = st.k, s = "", p;
    var ty = 58, tbY = 150, X0 = 16, X1 = 384;
    function tx(p) { return 40 + p * 29; }
    function rx(r) { return X0 + r / (NPOS - 1) * (X1 - X0); }
    // the table, 0 to 1023
    s += R(X0, tbY, X1 - X0, 16, "f-panel", ' rx="2" style="stroke:var(--vx-line)"');
    [0, 256, 512, 768, 1023].forEach(function (r) { s += L(rx(r), tbY + 16, rx(r), tbY + 21, "s-dim") + TM(rx(r), tbY + 31, String(r), "f-dim t-xs"); });
    s += T(X0, 198, "the position table W_pos: rows 0 to 1,023", "f-dim t-xs");
    // each token's line to the row it reads
    for (p = 0; p < NT; p++) {
      var r = lerp(q(a, p), q(b, p), k), x = rx(r);
      s += L(tx(p), ty + 12, x, tbY, "s-acc", ' stroke-width="1" opacity="0.7"');
      s += R(x - 1, tbY, 2.4, 16, "f-acc");
    }
    for (p = 0; p < NT; p++) {
      s += R(tx(p) - 11, ty - 11, 22, 22, "f-panel", ' rx="3" style="stroke:var(--vx-dim)"');
      s += TM(tx(p), ty + 4, String(p), "f-ink t-xs");
    }
    s += T(8, 18, "position mode=" + (b[0] === "scramble" ? "scramble" : b[0] + " k=" + b[1]), "f-ink t-m");
    s += T(8, 34, "tokens at positions p →", "f-dim t-xs");
    var form = b[0] === "shift" ? (b[1] ? "q = p + " + b[1] : "q = p   (unchanged)") : b[0] === "freeze" ? "q = " + b[1] + " for every token" : "q = perm[p], a fixed random row";
    s += TE(392, 18, b[0] === "scramble" ? "q = perm[p]" : form, "f-green t-s");
    var first = [0, 1, 2].map(function (p) { return Math.round(q(b, p)); }).join(", ");
    return { svg: s, read: name(b) + "    e(p) = W_pos[q(p)],  " + form + "    (p 0, 1, 2 read rows " + first + ")", setting: st.i };
  } });
})(window.VAUExplain);
