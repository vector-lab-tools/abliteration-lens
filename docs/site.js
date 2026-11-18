// Abliteration Lens: the site's one script. The theme switch, the sections' fade-in, the glitches,
// the lightbox, and the explanatory figures, drawn in inline SVG with no library.
// Copyright (C) 2026 David M. Berry. SPDX-License-Identifier: GPL-3.0-or-later
(function () {
  "use strict";
  var root = document.documentElement;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- theme ---------- */
  function currentTheme() {
    var a = root.getAttribute("data-theme");
    if (a) return a;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.querySelectorAll(".theme-toggle").forEach(function (b) {
    b.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("abl-theme", next); } catch (e) {}
    });
  });

  /* ---------- reveal, with a glitch on each heading as it arrives ---------- */
  var reveals = document.querySelectorAll(".reveal");
  function burst(el) {
    if (reduced || !el) return;
    el.classList.remove("glitch-burst"); void el.offsetWidth; el.classList.add("glitch-burst");
    setTimeout(function () { el.classList.remove("glitch-burst"); }, 500);
  }
  if ("IntersectionObserver" in window) {
    var rio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); burst(e.target.querySelector("h2")); rio.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { rio.observe(el); });
  } else reveals.forEach(function (el) { el.classList.add("in"); });

  // the active section in the header's nav
  var navLinks = [].slice.call(document.querySelectorAll(".site-nav a[href^='#']"));
  if (navLinks.length && "IntersectionObserver" in window) {
    var nio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        navLinks.forEach(function (a) { a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id); });
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    navLinks.forEach(function (a) { var s = document.querySelector(a.getAttribute("href")); if (s) nio.observe(s); });
  }

  /* ---------- the hero: the name and the two waves ---------- */
  var title = document.getElementById("title");
  if (title && !reduced) setInterval(function () { burst(title); }, 14000);
  if (title) title.addEventListener("mouseenter", function () { burst(title); });

  var dryPath = document.getElementById("wave-dry"), wetPath = document.getElementById("wave-wet");
  function drawWaves(t) {
    if (!dryPath) return;
    var W = 1200, part = 0.42 * W, n = 160, d = "", w = "";
    for (var i = 0; i <= n; i++) {
      var x = (i / n) * W, ph = x / 70 - t / 900;
      var y = 330 + 40 * Math.sin(ph) + 18 * Math.sin(ph * 2.3 + 1.1) + 6 * Math.sin(ph * 5.1);
      var k = Math.max(0, (x - part) / (W - part));
      var yw = y + k * (34 * Math.sin(ph * 1.7 + t / 500) + 22 * Math.sin(ph * 7.3 - t / 300) + 60 * k * Math.sin(ph * 0.6));
      d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      w += (i ? "L" : "M") + x.toFixed(1) + " " + yw.toFixed(1);
    }
    dryPath.setAttribute("d", d); wetPath.setAttribute("d", w);
  }

  /* ---------- the lightbox ---------- */
  var lb = document.getElementById("lightbox"), lbImg = lb && lb.querySelector("img"), lbCap = lb && lb.querySelector(".cap");
  // every link to an image opens here, in the viewer, not as a page of its own (Cmd-, Ctrl- or Shift-click still does)
  var shots = [].slice.call(document.querySelectorAll('a.shot, a[href$=".png"], a[href$=".webp"], a[href$=".jpg"], a[href$=".jpeg"], a[href$=".svg"]')).filter(function (a, i, all) { return all.indexOf(a) === i && !/^https?:/.test(a.getAttribute("href")); }), lbIndex = -1, lastFocus = null;
  shots.forEach(function (a, i) {
    var img = a.querySelector("img");
    if (img) a.style.setProperty("--src", "url(\"" + img.getAttribute("src") + "\")");
    a.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault(); openLb(i);
    });
  });
  function openLb(i) {
    if (!lb) return;
    lbIndex = (i + shots.length) % shots.length;
    var a = shots[lbIndex], img = a.querySelector("img");
    lastFocus = lastFocus || document.activeElement;
    lb.classList.remove("open"); void lb.offsetWidth;
    lbImg.src = a.getAttribute("href"); lbImg.alt = img ? img.alt : "";
    lbCap.textContent = a.getAttribute("data-cap") || (img ? img.alt : "");
    lb.hidden = false; lb.classList.add("open");
    document.body.style.overflow = "hidden";
    lb.querySelector("button").focus();
  }
  function closeLb() {
    if (!lb || lb.hidden) return;
    lb.classList.remove("open"); lb.hidden = true; document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus(); lastFocus = null;
  }
  if (lb) {
    lb.addEventListener("click", function (e) { if (e.target !== lbImg) closeLb(); });
    document.addEventListener("keydown", function (e) {
      if (lb.hidden) return;
      if (e.key === "Escape") closeLb();
      else if (e.key === "ArrowRight") openLb(lbIndex + 1);
      else if (e.key === "ArrowLeft") openLb(lbIndex - 1);
      else if (e.key === "Tab") { e.preventDefault(); lb.querySelector("button").focus(); }
    });
  }

  /* ---------- the figures ---------- */
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function T(x, y, s, cls, extra) { return '<text x="' + x + '" y="' + y + '" class="' + (cls || "f-ink") + '"' + (extra || "") + ">" + esc(s) + "</text>"; }
  function R(x, y, w, h, cls, extra) { return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(0, w) + '" height="' + Math.max(0, h) + '" class="' + cls + '"' + (extra || "") + "/>"; }
  function L(x1, y1, x2, y2, cls, extra) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="' + cls + '"' + (extra || "") + "/>"; }
  function C(x, y, r, cls, extra) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" class="' + cls + '"' + (extra || "") + "/>"; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ease(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }

  var figs = [];
  function addFig(id, init) {
    var el = document.getElementById(id);
    if (!el) return;
    var f = { el: el, svg: el.querySelector("svg"), visible: false, paused: false, t0: performance.now(), tOff: 0, draw: null };
    init(f);
    figs.push(f);
    f.redraw = function () { f.draw(reduced ? (f.still || 0) : (f.paused ? f.tOff : performance.now() - f.t0)); };
    f.redraw();
    if (fio) fio.observe(el);
  }
  var fio = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { figs.forEach(function (f) { if (f.el === e.target) f.visible = e.isIntersecting; }); });
  }, { rootMargin: "60px" }) : null;

  function frame(now) {
    drawWaves(now);
    figs.forEach(function (f) { if ((f.visible || !fio) && !f.paused) f.draw(now - f.t0); });
    requestAnimationFrame(frame);
  }

  function pressGroup(f, attr, onPick) {
    var bs = f.el.querySelectorAll("button[" + attr + "]");
    bs.forEach(function (b) {
      b.addEventListener("click", function () {
        bs.forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        onPick(b.getAttribute(attr)); f.redraw();
      });
    });
  }
  function sliders(f, onInput) {
    f.el.querySelectorAll("input[type=range]").forEach(function (inp) {
      var out = inp.parentNode.querySelector("output");
      inp.addEventListener("input", function () { onInput(inp.getAttribute("data-k"), parseFloat(inp.value), out); f.redraw(); });
    });
  }

  /* 1. two takes parting at token 15 (a real run) */
  addFig("viz-part", function (f) {
    var shared = [" that", " there", " are", " a", " number", " of", " important", " books", " that", " have", " been", " written", " about", " the"];
    var orig = [" history", " of", " the", " U", ".", "S", ".", " in", " the", " 1800", "s", ".", " Here", " are", " three", " books"];
    var bent = [" book", ".", " In", " fact", ",", " I", " wanted", " to", " get", " to", " the", " bottom", " of", " what", " I", " was"];
    var top5o = [[" subject", 0.044], [" history", 0.039], [" war", 0.013], [" project", 0.012], [" events", 0.011]];
    var top5b = [[" subject", 0.054], [" book", 0.051], [" history", 0.031], [" work", 0.027], [" archive", 0.026]];
    var CW = 9, STEP = 330, N = shared.length + orig.length, HOLD = 3600;
    f.still = (N + 2) * STEP;
    function wid(s) { return s.length * CW + 8; }
    f.draw = function (t) {
      var cyc = N * STEP + HOLD, tt = reduced ? f.still : t % cyc;
      var step = Math.min(N, Math.floor(tt / STEP) + 1), ns = shared.length;
      var sx = [], x = 0, i;
      for (i = 0; i < ns; i++) { sx.push(x); x += wid(shared[i]); }
      var partX = x, ox = [], bx = [], xo = partX, xb = partX;
      for (i = 0; i < orig.length; i++) { ox.push(xo); xo += wid(orig[i]); bx.push(xb); xb += wid(bent[i]); }
      var shown = Math.max(0, step - ns), headX = step <= ns ? sx[step - 1] + wid(shared[step - 1]) : Math.max(ox[shown - 1] + wid(orig[shown - 1]), bx[shown - 1] + wid(bent[shown - 1]));
      var off = Math.max(0, headX - 760) + 0, X0 = 120 - off;
      var splitK = step > ns ? ease((tt - ns * STEP) / 500) : 0;
      var yMid = 110, yO = yMid - 42 * splitK, yB = yMid + 42 * splitK;
      var s = "";
      s += '<defs><clipPath id="tape"><rect x="112" y="20" width="840" height="190"/></clipPath></defs>';
      s += T(14, yMid + 4, "both", "f-dim t-s t-up");
      if (splitK > 0) { s += T(14, yO + 4, "original", "f-blue t-s t-up", ' opacity="' + splitK + '"'); s += T(14, yB + 4, "diverged", "f-acc t-s t-up", ' opacity="' + splitK + '"'); }
      s += '<g clip-path="url(#tape)">';
      // the lanes
      s += L(X0 - 200, yMid + 10, X0 + partX, yMid + 10, "s-dim", ' stroke-width="1"');
      if (splitK > 0) {
        s += '<path d="M' + (X0 + partX) + " " + (yMid + 10) + " C" + (X0 + partX + 30) + " " + (yMid + 10) + " " + (X0 + partX + 20) + " " + (yO + 10) + " " + (X0 + partX + 60) + " " + (yO + 10) + " L" + (X0 + xo + 40) + " " + (yO + 10) + '" class="s-blue" fill="none" stroke-width="1"/>';
        s += '<path d="M' + (X0 + partX) + " " + (yMid + 10) + " C" + (X0 + partX + 30) + " " + (yMid + 10) + " " + (X0 + partX + 20) + " " + (yB + 10) + " " + (X0 + partX + 60) + " " + (yB + 10) + " L" + (X0 + xb + 40) + " " + (yB + 10) + '" class="s-acc" fill="none" stroke-width="1"/>';
      }
      for (i = 0; i < Math.min(step, ns); i++) {
        var age = (tt - i * STEP) / 220;
        s += T(X0 + sx[i], yMid, shared[i].replace(/^ /, "·"), "f-ink t-l", ' opacity="' + clamp(age, 0, 1) + '"');
      }
      for (i = 0; i < shown; i++) {
        var a2 = clamp((tt - (ns + i) * STEP) / 220, 0, 1), jit = (!reduced && i === 0 && a2 < 1) ? (Math.random() * 6 - 3) : 0;
        s += T(X0 + ox[i] + 60 * splitK + jit, yO, orig[i].replace(/^ /, "·"), "f-blue t-l", ' opacity="' + a2 + '"' + (i === 0 ? ' text-decoration="line-through"' : ""));
        s += T(X0 + bx[i] + 60 * splitK - jit, yB, bent[i].replace(/^ /, "·"), "f-acc t-l", ' opacity="' + a2 + '"');
      }
      if (step > ns) {
        var px = X0 + partX - 6;
        s += L(px, 34, px, 190, "s-red", ' stroke-width="2"');
        s += T(px + 5, 36, "parts at 15", "f-red t-s");
        if (!reduced && splitK < 1) s += R(px - 4, yMid - 30 + Math.random() * 40, 90, 3 + Math.random() * 6, "f-red", ' opacity="0.5"');
      }
      // the write head
      var hx = X0 + headX + (step > ns ? 60 * splitK : 0) + 4;
      if (step < N || reduced) s += L(hx, 40, hx, 180, "s-acc", ' stroke-width="1" stroke-dasharray="2 3" opacity="0.7"');
      s += "</g>";
      s += T(120, 24, "token " + step + " of " + N + "  ·  GPT-2 small · seed 42", "f-dim t-xs t-up");
      // the divergence point's top five
      if (step > ns) {
        var k = clamp((tt - ns * STEP - 300) / 600, 0, 1);
        [[top5o, "original chose “ history”", "f-blue", 120], [top5b, "diverged chose “ book”", "f-acc", 540]].forEach(function (g) {
          s += T(g[3], 232, g[1], g[2] + " t-s", ' opacity="' + k + '"');
          g[0].forEach(function (r, j) {
            var y = 246 + j * 11, chosen = (j === 1);
            s += T(g[3], y + 7, r[0].replace(/^ /, "·"), (chosen ? g[2] : "f-dim") + " t-xs", ' opacity="' + k + '"');
            s += R(g[3] + 74, y, r[1] / 0.06 * 200 * k, 7, chosen ? g[2] : "f-dim", ' opacity="' + (chosen ? 0.95 : 0.5) + '"');
            s += T(g[3] + 82 + r[1] / 0.06 * 200 * k, y + 7, r[1].toFixed(3), "f-dim t-xs", ' opacity="' + k + '"');
          });
        });
      } else {
        s += T(120, 250, "The chain is in place, and the two runs still write the same words.", "f-dim t-s");
      }
      f.svg.innerHTML = s;
    };
    f.el.querySelector("[data-act=replay]").addEventListener("click", function () { f.t0 = performance.now(); f.paused = false; f.el.querySelector("[data-act=pause]").setAttribute("aria-pressed", "false"); f.redraw(); });
    f.el.querySelector("[data-act=pause]").addEventListener("click", function (e) {
      f.paused = !f.paused; e.currentTarget.setAttribute("aria-pressed", f.paused ? "true" : "false");
      if (f.paused) f.tOff = performance.now() - f.t0; else f.t0 = performance.now() - f.tOff;
    });
  });

  /* 2. the bus: tokens through 12 blocks, one strip inserted */
  addFig("viz-bus", function (f) {
    var st = { layer: 6, on: true };
    var tokens = ["What", " matters", " about", " the", " archive", " is"];
    var ro = f.el.querySelector(".readout");
    f.still = 2400;
    var BX = 60, BW = 840, busY = 140;
    function lx(l) { return BX + (l / 12) * BW; }   // place of layer l on the bus
    f.draw = function (t) {
      var s = "", i;
      s += T(BX, 24, "residual stream (the bus) · 768 numbers per token · each block reads it (solid) and adds to it (dashed)", "f-dim t-xs t-up");
      // the blocks: sends and returns
      for (i = 0; i < 12; i++) {
        var x0 = lx(i) + 4, x1 = lx(i + 1) - 4, cx = (x0 + x1) / 2;
        var pulseHere = false;
        for (var k = 0; k < tokens.length; k++) {
          var px = ((t / 1600 + k / tokens.length) % 1) * (BW + 60) + BX - 30;
          if (px > x0 && px < x1) pulseHere = true;
        }
        s += R(x0, 40, x1 - x0, 60, "f-panel", ' rx="5" stroke="var(--fig-line)"' + (pulseHere ? ' style="stroke:var(--accent)"' : ""));
        s += T(cx - (i > 9 ? 12 : 8), 60, "B" + i, pulseHere ? "f-acc t-m" : "f-dim t-m");
        s += T(cx - 13, 78, "attn", "f-dim t-xs");
        s += T(cx - 10, 92, "mlp", "f-dim t-xs");
        s += L(cx - 8, 100, cx - 8, busY - 6, "s-dim", ' stroke-width="1"');
        s += L(cx + 8, busY - 6, cx + 8, 100, "s-dim", ' stroke-width="1" stroke-dasharray="2 2"');
      }
      s += L(BX - 20, busY, BX + BW + 20, busY, "s-ink", ' stroke-width="2" opacity="0.5"');
      for (i = 0; i <= 12; i++) { s += L(lx(i), busY - 3, lx(i), busY + 3, "s-dim"); s += T(lx(i) - (i > 9 ? 6 : 3), busY + 18, String(i), "f-dim t-s"); }
      s += T(BX + BW + 6, busY + 18, "layer", "f-dim t-xs");
      // the tap at layer 8
      s += C(lx(8), busY, 5, "f-green");
      s += T(lx(8) + 8, busY + 34, "Tap at layer 8", "f-green t-s");
      // the strip
      var sx = lx(st.layer);
      s += R(sx - 36, busY + 44, 72, 46, "f-bg", ' rx="6" style="stroke:' + (st.on ? "var(--accent)" : "var(--fig-line)") + '"');
      s += C(sx - 22, busY + 58, 5, st.on ? "f-acc" : "f-dim", st.on && !reduced ? ' style="filter:drop-shadow(0 0 4px var(--accent))"' : "");
      s += T(sx - 12, busY + 62, "Steer", "f-ink t-s");
      s += T(sx - 28, busY + 80, "neg. × 4", "f-dim t-xs");
      s += L(sx, busY + 44, sx, busY + 5, st.on ? "s-acc" : "s-dim", ' stroke-width="1.5"');
      // the pulses: one per token, looping
      for (k = 0; k < tokens.length; k++) {
        var ph = ((t / 1600 + k / tokens.length) % 1), x = ph * (BW + 60) + BX - 30;
        var wet = st.on && x > sx, y = busY + (wet ? Math.sin(x / 9 + k) * 3 : 0);
        s += C(x, y, wet ? 5 : 4, wet ? "f-acc" : "f-blue", ' opacity="0.95"');
        if (x > BX - 30 && x < BX + 70) s += T(x - 10, busY - 12, tokens[k], "f-dim t-xs");
      }
      // the readout at the tap, from a real run (layer 6)
      var real = st.layer === 6;
      var rows = (st.on && st.layer <= 8) ? [[" anymore", 0.97], [" anybody", 0.01], [" nor", 0.0], [" either", 0.0]] : [[" not", 0.53], [" how", 0.31], [" what", 0.04], [" whether", 0.03]];
      var tint = (st.on && st.layer <= 8) ? "f-acc" : "f-blue";
      s += T(BX, 238, "Tap at layer 8, step 1 (“ is” →): " + ((st.on && st.layer <= 8) ? "with the Steer" : "the stream as it was"), "f-dim t-xs t-up");
      rows.forEach(function (r, j) {
        var y = 250 + j * 18;
        s += T(BX, y + 11, r[0].replace(/^ /, "·"), "f-ink t-m");
        s += R(BX + 110, y, Math.max(1, r[1] * 560), 12, tint, ' opacity="' + (real || !(st.on && st.layer <= 8) ? 0.9 : 0.35) + '"');
        s += T(BX + 118 + r[1] * 560, y + 10, r[1].toFixed(2), "f-dim t-s");
      });
      f.svg.innerHTML = s;
      var msg;
      if (!st.on) msg = "Bypassed: every block reads the stream as the unchanged model writes it. The Tap at layer 8 points to “ not” (0.53).";
      else if (st.layer > 8) msg = "Steer at layer " + st.layer + ": after the Tap, so the Tap reads the stream unchanged. Blocks " + st.layer + " to 11 read the steered stream.";
      else msg = "Steer at layer " + st.layer + ": blocks " + st.layer + " to 11 read the steered stream." + (real ? " Measured: the Tap at layer 8 points to “ anymore” (0.97)." : " The bars are from the run with the strip at layer 6.");
      if (ro.textContent !== msg) ro.textContent = msg;
    };
    sliders(f, function (k, v, out) { st.layer = Math.round(v); out.textContent = st.layer; });
    var pw = f.el.querySelector("[data-act=power]");
    pw.addEventListener("click", function () { st.on = !st.on; pw.setAttribute("aria-pressed", st.on ? "true" : "false"); pw.textContent = st.on ? "Strip on" : "Bypassed"; f.redraw(); });
  });

  /* 3. a vector and a direction: remove, reflect, steer */
  addFig("viz-proj", function (f) {
    var mode = "remove", ro = f.el.querySelector(".readout");
    f.still = 1800;
    var O = [220, 250], dAng = -18 * Math.PI / 180, d = [Math.cos(dAng), Math.sin(dAng)];
    function arrow(x1, y1, x2, y2, cls, w) {
      var a = Math.atan2(y2 - y1, x2 - x1), h = 10;
      return L(x1, y1, x2, y2, cls, ' stroke-width="' + (w || 2.5) + '" stroke-linecap="round"') +
        '<path d="M' + x2 + " " + y2 + " L" + (x2 - h * Math.cos(a - 0.4)) + " " + (y2 - h * Math.sin(a - 0.4)) + " L" + (x2 - h * Math.cos(a + 0.4)) + " " + (y2 - h * Math.sin(a + 0.4)) + 'Z" class="' + cls.replace("s-", "f-") + '"/>';
    }
    f.draw = function (t) {
      var th = (-58 + 30 * Math.sin(t / 2600)) * Math.PI / 180, len = 150;
      var h = [len * Math.cos(th), len * Math.sin(th)];
      var c = h[0] * d[0] + h[1] * d[1], p = [c * d[0], c * d[1]];
      var out;
      if (mode === "remove") out = [h[0] - p[0], h[1] - p[1]];
      else if (mode === "reflect") out = [h[0] - 2 * p[0], h[1] - 2 * p[1]];
      else out = [h[0] + 90 * d[0], h[1] + 90 * d[1]];
      var ph = reduced ? 1 : (t % 3000) / 3000, k = ease((ph - 0.15) / 0.45);
      var mid = [h[0] + (out[0] - h[0]) * k, h[1] + (out[1] - h[1]) * k];
      var s = "";
      for (var gx = 0; gx <= 520; gx += 40) s += L(gx, 0, gx, 360, "s-line", ' stroke-width="0.5"');
      for (var gy = 0; gy <= 360; gy += 40) s += L(0, gy, 520, gy, "s-line", ' stroke-width="0.5"');
      s += L(O[0] - 230 * d[0], O[1] - 230 * d[1], O[0] + 260 * d[0], O[1] + 260 * d[1], "s-acc", ' stroke-width="1.2" stroke-dasharray="6 4"');
      s += T(O[0] + 200 * d[0] - 70, O[1] + 200 * d[1] + 22, "direction  d̂", "f-acc t-s");
      // the component along d (the band a notch removes)
      s += L(O[0], O[1], O[0] + p[0], O[1] + p[1], "s-acc", ' stroke-width="6" stroke-linecap="round" opacity="0.55"');
      s += L(O[0] + h[0], O[1] + h[1], O[0] + p[0], O[1] + p[1], "s-dim", ' stroke-width="1" stroke-dasharray="3 3"');
      s += arrow(O[0], O[1], O[0] + h[0], O[1] + h[1], "s-ink", 2);
      s += T(O[0] + h[0] + 8, O[1] + h[1] - 6, "h", "f-ink t-m");
      s += arrow(O[0], O[1], O[0] + mid[0], O[1] + mid[1], "s-green", 3);
      s += T(O[0] + mid[0] + 8, O[1] + mid[1] + 16, "h'", "f-green t-m");
      s += C(O[0], O[1], 3, "f-ink");
      var form = mode === "remove" ? "h' = h − (h·d̂) d̂" : mode === "reflect" ? "h' = h − 2 (h·d̂) d̂" : "h' = h + 4 · d";
      s += T(16, 28, form, "f-ink t-l");
      s += T(16, 44, mode === "remove" ? "project … mode=remove   (a notch)" : mode === "reflect" ? "project … mode=reflect   (polarity flipped)" : "steer … scale=4   (a boost)", "f-dim t-s");
      f.svg.innerHTML = s;
      var cosIn = c / len, n2 = Math.hypot(out[0], out[1]), cosOut = (out[0] * d[0] + out[1] * d[1]) / (n2 || 1);
      var msg = "cosine with d̂: " + cosIn.toFixed(2) + " → " + cosOut.toFixed(2) + "   ·   size: " + (1).toFixed(2) + " → " + (n2 / len).toFixed(2) + " of ‖h‖";
      if (ro.textContent !== msg) ro.textContent = msg;
    };
    pressGroup(f, "data-mode", function (m) { mode = m; });
  });

  /* 4. Bands over the principal directions */
  addFig("viz-eq", function (f) {
    var g = { low: 1.6, mid: 1, high: 0.4 }, NB = 96, D = 768;
    f.still = 0;
    var idx = []; for (var i = 0; i < NB; i++) idx.push(Math.round(Math.exp(Math.log(D) * i / (NB - 1))));
    f.draw = function (t) {
      var s = "", X0 = 50, W = 880, Y0 = 210, H = 150, bw = W / NB - 1.2;
      s += L(X0, Y0, X0 + W, Y0, "s-dim");
      var bands = [["low · V₁ to V₈", 1, 8, "f-acc", g.low], ["mid · V₉ to V₆₄", 9, 64, "f-blue", g.mid], ["high · V₆₅ to V₇₆₈", 65, 768, "f-green", g.high]];
      bands.forEach(function (b) {
        var xa = X0 + W * Math.log(b[1]) / Math.log(D), xb = X0 + W * Math.log(b[2]) / Math.log(D);
        s += R(xa, 30, Math.max(2, xb - xa), Y0 - 30, b[3], ' opacity="0.06"');
        s += T(xa + 4, 26, b[0] + "  ×" + b[4].toFixed(2), b[3] + " t-s");
      });
      for (i = 0; i < NB; i++) {
        var r = idx[i], x = X0 + W * Math.log(r) / Math.log(D) - bw / 2;
        if (i > 0 && idx[i] === idx[i - 1]) continue;
        var base = Math.pow(r, -0.42) * (1 + (reduced ? 0 : 0.07 * Math.sin(t / 240 + i * 1.7) + 0.04 * Math.sin(t / 97 + i * 0.6)));
        var band = r <= 8 ? 0 : r <= 64 ? 1 : 2, gain = [g.low, g.mid, g.high][band], cls = ["f-acc", "f-blue", "f-green"][band];
        var hb = base * H * 0.62, hg = hb * gain;
        s += R(x, Y0 - Math.min(hg, H + 20), bw, Math.min(hg, H + 20), cls, ' opacity="0.85"');
        s += R(x, Y0 - hb, bw, hb, "", ' fill="none" style="stroke:var(--fig-ink)" stroke-width="0.8" opacity="0.5"');
      }
      [1, 8, 64, 768].forEach(function (r) { var x = X0 + W * Math.log(r) / Math.log(D); s += L(x, Y0, x, Y0 + 5, "s-dim"); s += T(x - 6, Y0 + 17, String(r), "f-dim t-xs"); });
      s += T(X0, Y0 + 36, "principal direction at layer 6, ranked by spread over the reference corpus (log scale)", "f-dim t-xs t-up");
      s += T(X0 + W - 210, 52, "outline: the stream as it was", "f-dim t-xs");
      f.svg.innerHTML = s;
    };
    sliders(f, function (k, v, out) { g[k] = v; out.textContent = v.toFixed(2).replace(/0$/, "").replace(/\.$/, ""); });
  });

  /* 5. time: Lookback, Average, Repeat */
  addFig("viz-time", function (f) {
    var mode = "delay", ro = f.el.querySelector(".readout"), NP = 16;
    f.still = 9 * 700;
    function cx(p) { return 26 + p * 30; }
    f.draw = function (t) {
      var p = reduced ? 9 : 1 + Math.floor(t / 700) % (NP - 1), s = "", srcs = [], i;
      if (mode === "delay") { for (var k = 1; p - 4 * k >= 1; k++) srcs.push([p - 4 * k, 0.5 * Math.pow(0.3, k - 1)]); }
      else if (mode === "reverb") { for (i = p - 1; i >= 1; i--) srcs.push([i, 0.5 * 0.2 * Math.pow(0.8, p - 1 - i)]); }
      else { var pos = (p - 1) % 8; if (pos >= 6) srcs.push([p - 2, 1]); }
      var y = 160;
      for (i = 0; i < NP; i++) {
        var isP = i === p, sink = i === 0, rep = mode === "beatrepeat" && i >= 1 && (i - 1) % 8 >= 6;
        s += R(cx(i) - 12, y - 14, 24, 28, isP ? "f-acc" : "f-panel", ' rx="3"' + (sink ? ' style="stroke:var(--fig-dim);stroke-dasharray:2 2"' : rep ? ' style="stroke:var(--blue)"' : ""));
        s += T(cx(i) - (i > 9 ? 7 : 4), y + 4, String(i), isP ? "f-bg t-s" : "f-dim t-s");
      }
      s += T(cx(0) - 12, y + 32, "sink", "f-dim t-xs");
      s += T(cx(1) - 12, y + 32, "← earlier", "f-dim t-xs");
      s += T(cx(NP - 1) - 30, y + 32, "later →", "f-dim t-xs");
      srcs.forEach(function (sv) {
        var a = cx(sv[0]), b = cx(p), hgt = 26 + (b - a) * 0.35, op = clamp(sv[1] * 1.8, 0.08, 1);
        s += '<path d="M' + a + " " + (y - 16) + " Q" + ((a + b) / 2) + " " + (y - 16 - hgt) + " " + b + " " + (y - 16) + '" fill="none" class="' + (mode === "beatrepeat" ? "s-blue" : "s-acc") + '" stroke-width="' + (1 + 3 * sv[1]) + '" opacity="' + op + '"/>';
      });
      if (mode === "beatrepeat") { s += T(cx(1) - 12, 214, "runs of 8 from position 1; the last 2 of each run replay h[p − 2]", "f-dim t-s"); }
      if (mode === "delay") s += T(cx(1) - 12, 214, "time 4 · feedback 0.3 · mix 0.5", "f-dim t-s");
      if (mode === "reverb") s += T(cx(1) - 12, 214, "decay 0.8 · mix 0.5", "f-dim t-s");
      s += T(16, 28, "the stream at layer 6, one cell per position", "f-dim t-xs t-up");
      f.svg.innerHTML = s;
      var msg;
      if (mode === "delay") msg = "h'[" + p + "] = h[" + p + "]" + (srcs.length ? srcs.map(function (sv) { return " + " + sv[1].toFixed(sv[1] < 0.1 ? 3 : 2) + "·h[" + sv[0] + "]"; }).join("") : "   (nothing 4 back yet)");
      else if (mode === "reverb") msg = "h'[" + p + "] = h[" + p + "] + 0.5 · tail[" + (p - 1) + "],  tail a decaying average of positions 1 to " + (p - 1);
      else msg = srcs.length ? "position " + p + " is in the last 2 of its run: h'[" + p + "] = h[" + (p - 2) + "]" : "position " + p + " plays as it is";
      if (ro.textContent !== msg) ro.textContent = msg;
    };
    pressGroup(f, "data-mode", function (m) { mode = m; f.t0 = performance.now() - 700 * 8; });
  });

  /* 6. the envelope over depth (vau.hostfx.envelope) */
  addFig("viz-env", function (f) {
    var st = { shape: "bell", peak: 0.6, width: 0.3, edge: 0.2 }, auto = true, NL = 13;
    f.still = 0;
    function envAt(l, n) {
      var last = Math.max(1, n - 1), p = st.peak * last, w = Math.max(1e-6, st.width * last), d = Math.abs(l - p);
      if (d > w + 1e-9) return 0;
      if (st.shape === "flat") return 1;
      if (st.shape === "bell") { var e = st.edge > 0 ? st.edge : 0.1; return e < 1 ? Math.exp(Math.log(e) * (d / w) * (d / w)) : 1; }
      return 1 + (d / w) * (st.edge - 1);
    }
    f.draw = function (t) {
      if (auto && !reduced) st.peak = 0.5 + 0.4 * Math.sin(t / 1900);
      var s = "", X0 = 40, W = 450, Y0 = 220, H = 160, i, bw = W / NL - 6;
      s += L(X0, Y0, X0 + W, Y0, "s-dim");
      s += L(X0, Y0 - H, X0 + W, Y0 - H, "s-line", ' stroke-dasharray="3 4"');
      s += T(X0 - 30, Y0 - H + 4, "1", "f-dim t-xs"); s += T(X0 - 30, Y0 + 4, "0", "f-dim t-xs");
      var last = NL - 1, pk = st.peak * last, wd = st.width * last;
      var xa = X0 + (pk - wd + 0.5) * W / NL, xb = X0 + (pk + wd + 0.5) * W / NL;
      s += R(Math.max(X0, xa), Y0 - H - 8, Math.min(X0 + W, xb) - Math.max(X0, xa), H + 8, "f-acc", ' opacity="0.06"');
      if (st.shape !== "flat") s += L(X0, Y0 - H * (st.shape === "bell" && st.edge === 0 ? 0.1 : st.edge), X0 + W, Y0 - H * (st.shape === "bell" && st.edge === 0 ? 0.1 : st.edge), "s-dim", ' stroke-dasharray="2 4" opacity="0.6"');
      for (i = 0; i < NL; i++) {
        var v = envAt(i, NL), x = X0 + i * W / NL + 3;
        s += R(x, Y0 - v * H, bw, v * H, "f-acc", ' opacity="' + (0.35 + 0.6 * v) + '"');
        s += T(x + bw / 2 - (i > 9 ? 6 : 3), Y0 + 14, String(i), "f-dim t-xs");
      }
      var d = "";
      for (i = 0; i <= 120; i++) { var l = i / 120 * last, vv = envAt(l, NL); d += (i ? "L" : "M") + (X0 + (l + 0.5) * W / NL).toFixed(1) + " " + (Y0 - vv * H).toFixed(1); }
      s += '<path d="' + d + '" fill="none" class="s-ink" stroke-width="1.5" opacity="0.8"/>';
      s += T(X0, 30, "env=" + st.shape + "  epeak=" + st.peak.toFixed(2) + "  ewidth=" + st.width.toFixed(2) + "  eedge=" + st.edge.toFixed(2), "f-ink t-s");
      s += T(X0, Y0 + 36, "place in the stream (layer 0 to 12); wet × e(l) at each", "f-dim t-xs t-up");
      f.svg.innerHTML = s;
      if (auto && !reduced) { var pin = f.el.querySelector("input[data-k=peak]"); pin.value = st.peak.toFixed(2); pin.parentNode.querySelector("output").textContent = st.peak.toFixed(2); }
    };
    pressGroup(f, "data-shape", function (m) { st.shape = m; });
    sliders(f, function (k, v, out) { auto = false; st[k] = v; out.textContent = v.toFixed(2); });
  });

  /* 7. loudness: KL to DUFS, with a meter */
  addFig("viz-dufs", function (f) {
    var FS = Math.log2(50257), base = 0.1, ro = f.el.querySelector(".readout"), hist = [], lastStep = -1;
    f.still = 0;
    function dufs(kl) { return Math.max(-70, 10 * Math.log10(Math.max(kl, 1e-12) / FS)); }
    function stepKL(n) {
      var r = Math.sin(n * 12.9898) * 43758.5453; r = r - Math.floor(r);
      var spike = (n % 17 === 5) ? 6 : 1;
      return base * Math.exp((r - 0.5) * 1.6) * spike;
    }
    function integrated(arr) {
      var g = arr.filter(function (k) { return dufs(k) > -70; });
      if (!g.length) return -70;
      var m = g.reduce(function (a, b) { return a + b; }, 0) / g.length, thr = m / 10;   // 10 vB below the mean
      var g2 = g.filter(function (k) { return k >= thr; });
      var m2 = g2.reduce(function (a, b) { return a + b; }, 0) / (g2.length || 1);
      return dufs(m2);
    }
    f.draw = function (t) {
      var n = reduced ? 40 : Math.floor(t / 180);
      if (n !== lastStep) { for (var q = lastStep + 1; q <= n; q++) { hist.push(stepKL(q)); if (hist.length > 60) hist.shift(); } lastStep = n; }
      if (!hist.length) hist.push(stepKL(0));
      var mom = dufs(hist[hist.length - 1]), st8 = hist.slice(-8), short = dufs(st8.reduce(function (a, b) { return a + b; }, 0) / st8.length);
      var peak = dufs(Math.max.apply(null, hist)), integ = integrated(hist);
      var X = 70, Y0 = 340, H = 300, s = "";
      function yOf(v) { return Y0 - H * (v + 60) / 60; }
      s += R(X, yOf(0), 34, H, "f-panel", ' rx="3"');
      s += R(X, yOf(-30), 34, H / 2, "f-green", ' opacity="0.08"');
      s += R(X, yOf(-12), 34, H * 18 / 60, "f-acc", ' opacity="0.08"');
      s += R(X, yOf(0), 34, H * 12 / 60, "f-red", ' opacity="0.08"');
      var mv = clamp(mom, -60, 0), cls = mv > -12 ? "f-red" : mv > -30 ? "f-acc" : "f-green";
      s += R(X + 6, yOf(mv), 22, Y0 - yOf(mv), cls);
      s += L(X + 2, yOf(clamp(short, -60, 0)), X + 32, yOf(clamp(short, -60, 0)), "s-ink", ' stroke-width="2"');
      s += L(X + 2, yOf(clamp(peak, -60, 0)), X + 32, yOf(clamp(peak, -60, 0)), "s-red", ' stroke-width="2"');
      for (var v = 0; v >= -60; v -= 10) { s += L(X - 6, yOf(v), X, yOf(v), "s-dim"); s += T(X - 34, yOf(v) + 4, String(v), "f-dim t-xs"); }
      s += T(X - 4, 24, "OUT", "f-dim t-xs t-up");
      s += T(X - 10, Y0 + 22, integ.toFixed(1), "f-ink t-m");
      s += T(X - 4, Y0 + 34, "DUFS", "f-dim t-xs");
      // reference marks from runs
      var refs = [[-33, "mean-ablate head 5.1"], [-15, "steer ×2"], [-5, "steer ×8"], [-4.1, "“more more”"], [-17.7, "vSparsify … vClamp"]];
      refs.sort(function (a, b) { return b[0] - a[0]; });
      var lastY = -99;
      refs.forEach(function (r) {
        var y = yOf(r[0]), ly = Math.max(y, lastY + 13); lastY = ly;
        s += L(X + 38, y, X + 52, ly, "s-dim", ' stroke-width="0.8"');
        s += T(X + 56, ly + 3, r[0].toFixed(1) + "  " + r[1], "f-dim t-xs");
      });
      // the momentary history, a strip chart
      var cx0 = 300, cw = 196, d = "";
      hist.forEach(function (k, i) { d += (i ? "L" : "M") + (cx0 + i * cw / 60).toFixed(1) + " " + yOf(clamp(dufs(k), -60, 0)).toFixed(1); });
      s += R(cx0, yOf(0), cw, H, "f-panel", ' opacity="0.5"');
      s += '<path d="' + d + '" fill="none" class="s-acc" stroke-width="1.3"/>';
      s += T(cx0, Y0 + 22, "momentary, step by step", "f-dim t-xs");
      f.svg.innerHTML = s;
      var msg = "KL " + fmt(base) + " bits  →  10·log₁₀(" + fmt(base) + " / " + FS.toFixed(2) + ") = " + dufs(base).toFixed(1) + " DUFS     ·     integrated over the last " + hist.length + " steps: " + integ.toFixed(1);
      if (ro.textContent !== msg) ro.textContent = msg;
    };
    function fmt(x) { return x >= 1 ? x.toFixed(2) : x >= 0.01 ? x.toFixed(3) : x.toExponential(1); }
    sliders(f, function (k, v, out) { base = Math.pow(10, v); out.textContent = fmt(base); hist = []; lastStep = -1; f.t0 = performance.now(); });
    var inp = f.el.querySelector("input[data-k=kl]"); base = Math.pow(10, parseFloat(inp.value)); inp.parentNode.querySelector("output").textContent = fmt(base);
  });

  if (!reduced) requestAnimationFrame(frame);
  else drawWaves(0);
})();
