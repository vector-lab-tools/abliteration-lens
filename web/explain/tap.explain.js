// Abliteration Lens: the Tap strip's explainer, an animated figure of what generate.py computes.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
// Drawn by VAU's explainer runtime (vau/explain/explain.js), which must be loaded first.
(function (X) {
  "use strict";
  if (!X) return;
  var H = X.h, n1 = H.n1, T = H.T, TM = H.TM, TE = H.TE, R = H.R, L = H.L, arrow = H.arrow,
      clamp = H.clamp, lerp = H.lerp, f2 = H.f2, stage = H.stage;

  /* ---------- Tap (a meter): the logit lens at a layer ---------- */
  var LAYERS = [0, 4, 8, 12];
  // Without the example texts: GPT-2 small's own top three at the first step (it reads " is"
  // and went on to write " that"), at each of the four layers.
  var FALLBACK = [[[" destro", 0.772], [" mathemat", 0.175], [" arrang", 0.018]], [[" not", 0.399], [" still", 0.189], [" now", 0.13]],
                  [[" not", 0.525], [" how", 0.31], [" what", 0.045]], [[" that", 0.418], [" the", 0.117], [" not", 0.093]]];
  function lab(w) { return JSON.stringify(String(w)).slice(1, -1).replace(/\\n/g, "↵"); }
  function top3(r) {                        // a reading: a word, a list of words, or a list of [word, p]
    if (r == null) return [];
    if (!Array.isArray(r)) return [[r, null]];
    return r.slice(0, 3).map(function (e) { return Array.isArray(e) ? [e[0], e.length > 1 ? +e[1] : null] : [e, null]; });
  }
  function promptToks(D) {
    var o = D && D.original, p = D && D.provenance && D.provenance.prompt;
    return (o && o.prompt_tokens) || (p ? p.match(/\s?\S+/g) : []) || [];
  }

  X.register("tap", {
    caption: "The stream at one layer goes through GPT-2 small's final norm and output layer as if it were the "
      + "last, <code>softmax(W<sub>U</sub> · LN(h<sub>ℓ</sub>))</code>, and the meter shows the words it points to "
      + "most (the logit lens), here at layers 0, 4, 8 and 12 for each token of the original text. Layer 12 is "
      + "the model's own output; at layer 0 the embedding mostly points at nothing useful, now and then back at the "
      + "word it reads. "
      + "The squares mark the tokens where the tap's top word is the word written. It changes nothing.",
    meter: true,
    still: 2 * 6000 + 3 * 1000 + 300, draw: function (t, D) {
    var rows = D && D.units && D.units.tap, toks = D && D.original ? D.original.tokens : [" that"], pt = promptToks(D);
    var N = rows ? rows[0].reading.length : 1, st = stage(t, LAYERS.length, 6000, 700), j = Math.floor(t / 1000) % N;
    var la = LAYERS[st.prev], lb = LAYERS[st.i], s = "", i;
    // the layers, the tapped one marked
    function cx(i) { return 34 + i * 27.5; }
    s += T(8, 16, "the stream at layer " + lb + ", read as if it were the last", "f-dim t-xs");
    for (i = 0; i <= 12; i++) {
      var after = i > lb;
      s += R(cx(i) - 11, 28, 22, 20, "f-panel", ' rx="3"' + (after ? ' opacity="0.45"' : ""));
      s += TM(cx(i), 41.5, String(i), after ? "f-dim t-xs" : "f-ink t-xs");
    }
    var mx = lerp(cx(la), cx(lb), st.k);
    s += R(mx - 12, 27, 24, 22, "s-acc", ' fill="none" stroke-width="2" rx="4"');
    s += arrow(mx, 51, lerp(mx, 200, 0.5), 74, "s-acc", 1.6);
    s += R(104, 76, 192, 20, "f-panel", ' rx="3"') + TM(200, 89.5, "final norm → output layer → softmax", "f-ink t-xs");
    s += L(200, 96, 200, 106, "s-line");
    // what the tap reads at the token reached: the word before, its top three, and the word written
    var r = top3(rows ? rows[st.i].reading[j] : FALLBACK[st.i]), wrote = toks[j], read = j === 0 ? pt[pt.length - 1] : toks[j - 1];
    s += T(8, 124, "reads", "f-dim t-xs") + T(8, 140, read != null ? "“" + lab(read) + "”" : "", "f-ink t-s");
    s += T(8, 162, "wrote", "f-dim t-xs") + T(8, 178, wrote != null ? "“" + lab(wrote) + "”" : "", "f-acc t-s");
    var lx = 196, bx = 202, bw = 150;
    for (i = 0; i < r.length; i++) {
      var y = 114 + i * 22, hit = r[i][0] === wrote, p = r[i][1];
      s += TE(lx, y + 12, "“" + lab(r[i][0]) + "”", hit ? "f-acc t-s" : "f-ink t-s");
      if (p !== null) {
        s += R(bx, y + 3, p * bw, 13, hit ? "f-acc" : "f-blue", ' opacity="' + (hit ? 0.9 : 0.6) + '"');
        s += T(bx + p * bw + 5, y + 13, p.toFixed(2), "f-dim t-xs");
      }
    }
    s += L(bx, 112, bx, 180, "s-line");
    // each token of the text: is the tap's top word the word written?
    if (rows) {
      var X0 = 42, slot = 350 / N, hits = 0;
      for (i = 0; i < N; i++) {
        var a = top3(rows[st.i].reading[i])[0], on = a && a[0] === toks[i];
        if (on) hits++;
        s += R(X0 + i * slot + 1, 190, slot - 2.4, 8, on ? "f-green" : "f-panel", i === j ? ' style="stroke:var(--vx-acc);stroke-width:1.5"' : "");
      }
      s += TE(X0 - 6, 198, hits + "/" + N, "f-green t-xs");
    } else s += T(8, 204, "GPT-2 small, the first step", "f-dim t-xs");
    var best = r[0];
    return { svg: s, setting: st.i, token: j, read: "layer " + lb + (rows ? " · token " + (j + 1) + " of " + N : " · the first step") + ":  softmax(W_U · LN(h_" + lb + "))  →  " +
      (best ? "“" + lab(best[0]) + "”" + (best[1] !== null ? " " + f2(best[1]) : "") : "") + (wrote != null ? ",  the model wrote “" + lab(wrote) + "”" : "") };
  } });
})(window.VAUExplain);
