// Abliteration Lens: the Reorder strip's explainer, an animated figure of what interventions.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by the explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, n1 = H.n1, T = H.T, TM = H.TM, R = H.R, L = H.L, C = H.C, arrow = H.arrow,
      clamp = H.clamp, lerp = H.lerp, stage = H.stage;

  /* ---------- Reorder: the list of blocks the stream runs through, rewritten ---------- */
  var N = 12;
  // as the reorder strip builds it: skip first, then repeat, then swap (the first occurrence of each)
  function order(o) {
    var out = [], i;
    for (i = 0; i < N; i++) if (!(o.skip || []).includes(i)) out.push(i);
    if (o.repeat) out = out.reduce(function (acc, b) { return acc.concat(o.repeat.includes(b) ? [b, b] : [b]); }, []);
    if (o.swap) { var ia = out.indexOf(o.swap[0]), ib = out.indexOf(o.swap[1]), x = out[ia]; out[ia] = out[ib]; out[ib] = x; }
    return out;
  }
  var S = [{ name: "skip=6", skip: [6] }, { name: "repeat=5", repeat: [5] }, { name: "swap=3,8", swap: [3, 8] }, { name: "skip=3-5", skip: [3, 4, 5] }];
  var ORD = S.map(order);
  // each run of a block gets a key (block, which time it runs), so the boxes can move from one order to the next
  function slots(ord) {
    var seen = {}, m = {};
    ord.forEach(function (b, i) { seen[b] = (seen[b] || 0) + 1; m[b + "." + seen[b]] = i; });
    return m;
  }
  var SL = ORD.map(slots);

  X.register("reorder", {
    caption: "GPT-2 small's twelve blocks in the order the stream runs through them, one box each, block 0 first. "
      + "Reorder rewrites that list for the run: skip drops blocks, repeat runs a block twice in a row, swap "
      + "exchanges two (applied in that order, whatever the order on the line). The model never ran this way in "
      + "training; while a reorder is on, the cache is off and the whole text is recomputed at every step.",
    examples: "skip=6, repeat=5, swap=3,8 and skip=3-5",
    still: 2 * 4000 + 2600, draw: function (t) {
    var st = stage(t, S.length, 4000, 1000), A = SL[st.prev], B = SL[st.i], ord = ORD[st.i], k = st.k, s = "";
    var y = 96, w = 24, gap = 2.6;
    function cx(i) { return 24 + i * (w + gap) + w / 2; }
    var keys = {}, key, skipped = [];
    for (key in A) keys[key] = 1;
    for (key in B) keys[key] = 1;
    // the stream, embeddings to the output
    s += arrow(4, y, 396, y, "s-line", 1.2);
    s += T(4, y - 18, "emb", "f-dim t-xs");
    s += T(370, y - 18, "out", "f-dim t-xs");
    for (key in keys) {
      var b = +key.split(".")[0], twice = key.split(".")[1] === "2";
      var inA = key in A, inB = key in B, from, to, opA, opB;
      // a block not run sits below the row, faint; a second run grows out of the first
      from = inA ? [cx(A[key]), y] : [cx((B[b + ".1"] !== undefined ? B[b + ".1"] : b)), twice ? y : y + 54];
      to = inB ? [cx(B[key]), y] : [cx(A[b + ".1"] !== undefined && twice ? A[b + ".1"] : b), twice ? y : y + 54];
      opA = inA ? 1 : twice ? 0 : 0.35; opB = inB ? 1 : twice ? 0 : 0.35;
      var x = lerp(from[0], to[0], k), yy = lerp(from[1], to[1], k), op = lerp(opA, opB, k);
      if (op < 0.02) continue;
      var hot = inB && (twice || (S[st.i].swap || []).includes(b) || (S[st.i].repeat || []).includes(b));
      s += R(x - w / 2, yy - 16, w, 32, hot ? "f-acc" : inB ? "f-panel" : "f-bg", ' rx="4" opacity="' + n1(op * 100) / 100 + '"' + (inB && !hot ? ' style="stroke:var(--vx-dim)"' : !inB ? ' style="stroke:var(--vx-dim);stroke-dasharray:2 2"' : ""));
      s += T(x, yy + 4, String(b), hot ? "f-bg t-s" : "f-ink t-s", ' text-anchor="middle" opacity="' + n1(op * 100) / 100 + '"');
      if (!inB && !twice) skipped.push(x);
    }
    if (skipped.length && k > 0.6) s += TM((Math.min.apply(null, skipped) + Math.max.apply(null, skipped)) / 2, y + 82, "skipped", "f-dim t-xs");
    // a pulse runs through the blocks in order, once the boxes have settled
    var run = (t % 4000 - 1000) / 2800;
    if (run > 0 && run < 1) {
      var p = run * ord.length, i0 = clamp(Math.floor(p), 0, ord.length - 1);
      s += C(cx(i0) + (p - i0 - 0.5) * (w + gap), y - 24, 3.5, "f-green");
      s += TM(clamp(cx(i0), 30, 370), y + 36, "block " + ord[i0], "f-green t-xs");
    }
    s += T(8, 18, "reorder " + S[st.i].name, "f-ink t-m");
    s += T(8, 34, "blocks in the order they run (" + ord.length + " passes)", "f-dim t-xs");
    s += T(8, 196, "run order: " + ord.join(" "), "f-dim t-xs");
    return { svg: s, read: "reorder " + S[st.i].name + "    h ← block[o](h) for o in [" + ord.join(", ") + "]    (no cache: each step recomputes the text)", setting: st.i };
  } });
})(window.VAUExplain);
