/* ==========================================================================
   slate-core.js -- the writing surface, as something that can be mounted.

   One implementation, two homes: docked under the lesson on the board, where
   the question you are answering stays in view, and full screen at /slate when
   a derivation needs the whole page. Having two copies of an ink engine would
   guarantee they drifted.

   Ink quality is the point of this file. Raw pointer samples are jittery and
   arrive unevenly, and drawing them directly gives the faceted, granular line
   that makes handwriting look wrong. So: smooth the samples as they arrive,
   run a Catmull-Rom curve through them, resample that curve densely, and vary
   the width smoothly along it. Committed strokes are cached to an offscreen
   canvas so only the live stroke is redrawn per frame -- latency is most of
   what "smooth" actually means.
   ========================================================================== */

(function () {
"use strict";

var LOGICAL_W = 1600;
var AUTOSAVE_MS = 1200;
var LIVE_IDLE_MS = 3000;
var LIVE_MIN_GAP_MS = 15000;
var UNDO_DEPTH = 60;
var SMOOTH = 0.45;          /* how much of each new sample to trust */
var RESAMPLE = 1.2;         /* logical units between rendered points */

var PAPERS = {
  black: { bg: "#101114", rule: "#23262c", ink: "#f2f4f7" },
  white: { bg: "#fdfdfb", rule: "#dfe6ee", ink: "#16171a" },
  cream: { bg: "#f7f1e3", rule: "#e2d7bd", ink: "#241f16" },
};
var PAPER_ORDER = ["black", "white", "cream"];
var RULE_ORDER = ["plain", "grid", "lines"];

var PALETTE_DARK = ["#f2f4f7", "#ffd166", "#7fd1ff", "#8ce99a", "#ff8f8f"];
var PALETTE_LIGHT = ["#16171a", "#a86a12", "#1a56b0", "#1f5c34", "#9a2020"];

var ICON = {
  pen:   '<svg viewBox="0 0 24 24"><path d="M3 21l3.6-.9 11-11a2.1 2.1 0 0 0-3-3l-11 11L3 21z"/></svg>',
  hl:    '<svg viewBox="0 0 24 24"><path d="M4 19h16v2H4z"/><path d="M6 15l8.5-8.5a2 2 0 0 1 3 3L9 18H6v-3z"/></svg>',
  erase: '<svg viewBox="0 0 24 24"><path d="M4 15l7-7 6 6-4 4H7z"/><path d="M3 20h18v1.6H3z"/></svg>',
  lasso: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="9.5" rx="8" ry="5.5"/><path d="M8 15c0 2 1 4 1 5"/></svg>',
  undo:  '<svg viewBox="0 0 24 24"><path d="M4 9h9a5 5 0 0 1 0 10h-3"/><path d="M8 5L4 9l4 4"/></svg>',
  redo:  '<svg viewBox="0 0 24 24"><path d="M20 9h-9a5 5 0 0 0 0 10h3"/><path d="M16 5l4 4-4 4"/></svg>',
  more:  '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  prev:  '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next:  '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
};

function el(tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ---------------------------------------------------------------- geometry */
function catmullRom(p0, p1, p2, p3, t) {
  var t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
           (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
           (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
           (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
           (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    p1[2] + (p2[2] - p1[2]) * t,
  ];
}

/* A dense, evenly spaced path through the samples. Density is what removes the
   faceting: once consecutive points are about a pixel apart, the round joins
   between them read as one continuous edge. */
function densify(pts) {
  if (pts.length < 3) return pts.slice();
  var out = [pts[0]];
  for (var i = 0; i < pts.length - 1; i++) {
    var p0 = pts[i - 1] || pts[i];
    var p1 = pts[i], p2 = pts[i + 1];
    var p3 = pts[i + 2] || p2;
    var dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    var steps = Math.max(1, Math.min(24, Math.ceil(dist / RESAMPLE)));
    for (var s = 1; s <= steps; s++) out.push(catmullRom(p0, p1, p2, p3, s / steps));
  }
  return out;
}

function inPolygon(x, y, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------------ create */
function create(opts) {
  opts = opts || {};
  var root = opts.root;
  var compact = !!opts.compact;

  var api = {};
  var pages = [];
  var current = 0;
  var undoStack = [], redoStack = [], clipboard = [];
  var tool = { mode: "pen", color: PALETTE_DARK[0], width: 2.8,
               paper: "black", rule: "plain", live: false };
  var drawing = null, lasso = null, sel = null, dragging = null;
  var penSeen = false, dirty = false, lastLiveSend = 0;
  var saveTimer = null, liveTimer = null, rafPending = false;
  var touches = {}, pinch = null;

  /* ------------------------------------------------------------ the DOM */
  /* One row, no horizontal scrolling, and everything that matters reachable
     without a decision: what to write with, what colour, and Send. Everything
     rarely touched -- pages, zoom, paper -- lives behind the ⋯ so the row stays
     calm. */
  root.classList.add("slate-root");
  root.innerHTML = "";

  var bar = el("div", "sl-bar");

  function seg(parent) { var g = el("div", "sl-seg"); parent.appendChild(g); return g; }
  function mk(parent, cls, html, title) {
    var b = el("button", cls, html);
    b.type = "button";
    if (title) b.title = title;
    parent.appendChild(b);
    return b;
  }

  var segTools = seg(bar);
  var bPen = mk(segTools, "sl-t sel", ICON.pen, "pen");
  var bHl = mk(segTools, "sl-t", ICON.hl, "highlighter");
  var bEr = mk(segTools, "sl-t", ICON.erase, "eraser");
  var bLa = mk(segTools, "sl-t", ICON.lasso, "select");

  var segNibs = seg(bar);
  var nibs = [1.6, 2.8, 5.0].map(function (w, i) {
    var b = mk(segNibs, "sl-n" + (i === 1 ? " sel" : ""),
               '<i style="width:' + (3 + i * 4) + 'px;height:' + (3 + i * 4) + 'px"></i>',
               ["fine", "medium", "broad"][i]);
    b.dataset.w = w;
    return b;
  });

  var gInks = el("div", "sl-inks");
  bar.appendChild(gInks);
  var inkButtons = [];
  var custom = el("label", "sl-ink sl-custom");
  custom.title = "any colour";
  var customInput = el("input");
  customInput.type = "color";
  customInput.value = "#c792ea";
  custom.appendChild(customInput);

  bar.appendChild(el("div", "sl-space"));

  var segEdit = seg(bar);
  var bUndo = mk(segEdit, "sl-t", ICON.undo, "undo");
  var bRedo = mk(segEdit, "sl-t", ICON.redo, "redo");

  var bMore = mk(bar, "sl-more", ICON.more, "more");
  var savedTag = el("span", "sl-saved", "saved");
  bar.appendChild(savedTag);
  var bSend = mk(bar, "sl-send", "Send", "hand this page to the tutor");

  /* --- the overflow sheet --- */
  var menu = el("div", "sl-menu");
  menu.hidden = true;
  function menuRow(label) {
    var r = el("div", "sl-row");
    r.appendChild(el("span", "sl-label", label));
    var box = el("div", "sl-rowbox");
    r.appendChild(box);
    menu.appendChild(r);
    return box;
  }
  var rPages = menuRow("Page");
  var bPrev = mk(rPages, "sl-t", ICON.prev, "previous");
  var pageTag = el("span", "sl-tag", "1/1");
  rPages.appendChild(pageTag);
  var bNext = mk(rPages, "sl-t", ICON.next, "next");
  var bAdd = mk(rPages, "sl-t", "+", "new page");
  var bTaller = mk(rPages, "sl-t", "↕", "taller");

  var rZoom = menuRow("Zoom");
  var bZoomOut = mk(rZoom, "sl-t", "−", "out");
  var zoomTag = el("span", "sl-tag", "100%");
  rZoom.appendChild(zoomTag);
  var bZoomIn = mk(rZoom, "sl-t", "+", "in");
  var bFit = mk(rZoom, "sl-t", "⤢", "fit");

  var rPaper = menuRow("Paper");
  var paperBtns = PAPER_ORDER.map(function (name) {
    var b = mk(rPaper, "sl-chip sl-paper-" + name + (name === tool.paper ? " sel" : ""), name, name);
    b.dataset.paper = name;
    return b;
  });

  var rRule = menuRow("Ruling");
  var ruleBtns = RULE_ORDER.map(function (name) {
    var b = mk(rRule, "sl-chip" + (name === tool.rule ? " sel" : ""), name, name);
    b.dataset.rule = name;
    return b;
  });

  var rLive = menuRow("Live");
  var bLive = mk(rLive, "sl-chip", "off", "let the tutor see each page as you pause");
  if (compact) {
    var rFull = menuRow("Room");
    var aFull = el("a", "sl-chip", "full screen");
    aFull.href = "/slate";
    rFull.appendChild(aFull);
  }

  var selbar = el("div", "sl-selbar");
  selbar.hidden = true;
  [["cut", "Cut"], ["copy", "Copy"], ["paste", "Paste"], ["duplicate", "Duplicate"],
   ["colour", "Recolour"], ["delete", "Delete"], ["done", "Done"]].forEach(function (a) {
    var b = mk(selbar, "sl-chip" + (a[0] === "delete" ? " danger" : ""), a[1], a[1]);
    b.dataset.act = a[0];
  });

  var wrap = el("div", "sl-wrap");
  var sheet = el("canvas", "sl-sheet");
  wrap.appendChild(sheet);

  var toastEl = el("div", "sl-toast");
  toastEl.hidden = true;

  root.appendChild(bar);
  root.appendChild(menu);
  root.appendChild(selbar);
  root.appendChild(wrap);
  root.appendChild(toastEl);

  var ctx = sheet.getContext("2d");
  var cache = document.createElement("canvas");
  var cacheCtx = cache.getContext("2d");
  var cacheValid = false;

  /* ----------------------------------------------------------- the model */
  function page() { return pages[current]; }

  function blankPage() {
    var aspect = Math.min(1.9, Math.max(0.5, wrap.clientHeight / Math.max(1, wrap.clientWidth)));
    return { w: LOGICAL_W, h: Math.round(LOGICAL_W * aspect), strokes: [] };
  }

  function snapshot() {
    undoStack.push(JSON.stringify(page().strokes));
    if (undoStack.length > UNDO_DEPTH) undoStack.shift();
    redoStack.length = 0;
  }

  function restoreFrom(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(page().strokes));
    page().strokes = JSON.parse(from.pop());
    clearSelection();
    invalidate();
    markDirty();
  }

  /* ------------------------------------------------------------ the view */
  var view = { k: 1, fit: 1, ox: 0, oy: 0 };

  function fitPage() {
    var p = page();
    view.fit = Math.min((wrap.clientWidth - 12) / p.w, (wrap.clientHeight - 12) / p.h);
    view.k = view.fit;
    var w = p.w * view.k, h = p.h * view.k;
    view.ox = (wrap.clientWidth - w) / 2;
    view.oy = (wrap.clientHeight - h) / 2;
    clampView();
    invalidate();
  }

  function clampView() {
    var p = page(), m = 60;
    view.ox = Math.min(wrap.clientWidth - m, Math.max(m - p.w * view.k, view.ox));
    view.oy = Math.min(wrap.clientHeight - m, Math.max(m - p.h * view.k, view.oy));
  }

  function setZoom(k, cx, cy) {
    k = Math.max(view.fit * 0.5, Math.min(view.fit * 8, k));
    var r = sheet.getBoundingClientRect();
    if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
    var lx = (cx - view.ox) / view.k, ly = (cy - view.oy) / view.k;
    view.k = k;
    view.ox = cx - lx * view.k;
    view.oy = cy - ly * view.k;
    clampView();
    invalidate();
  }

  function dpr() { return Math.min(window.devicePixelRatio || 1, 3); }

  function layout() {
    var w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    sheet.style.width = w + "px";
    sheet.style.height = h + "px";
    sheet.width = Math.round(w * dpr());
    sheet.height = Math.round(h * dpr());
    cache.width = sheet.width;
    cache.height = sheet.height;
    invalidate();
  }

  function toLogical(ev) {
    var r = sheet.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left - view.ox) / view.k,
      y: (ev.clientY - r.top - view.oy) / view.k,
      p: ev.pressure > 0 ? ev.pressure : 0.5,
    };
  }

  /* -------------------------------------------------------------- render */
  function paintPaper(c, p, scale) {
    var skin = PAPERS[tool.paper];
    c.fillStyle = skin.bg;
    c.fillRect(0, 0, p.w, p.h);
    if (tool.rule === "plain") return;
    c.strokeStyle = skin.rule;
    c.lineWidth = 1 / scale;
    c.beginPath();
    for (var y = 50; y < p.h; y += 50) { c.moveTo(0, y); c.lineTo(p.w, y); }
    if (tool.rule === "grid") for (var x = 50; x < p.w; x += 50) { c.moveTo(x, 0); c.lineTo(x, p.h); }
    c.stroke();
  }

  function paintStroke(c, s) {
    var pts = s.dense || (s.dense = densify(s.pts));
    if (!pts.length) return;
    c.save();
    if (s.hl) { c.globalAlpha = 0.3; c.globalCompositeOperation = "multiply"; }
    c.strokeStyle = s.c;
    c.fillStyle = s.c;
    c.lineCap = "round";
    c.lineJoin = "round";
    var base = s.hl ? s.w * 6 : s.w;
    if (pts.length === 1) {
      c.beginPath();
      c.arc(pts[0][0], pts[0][1], base * (0.5 + 0.85 * pts[0][2]) / 2, 0, 6.2832);
      c.fill();
      c.restore();
      return;
    }
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      c.lineWidth = s.hl ? base : base * (0.5 + 0.85 * ((a[2] + b[2]) / 2));
      c.beginPath();
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
      c.stroke();
    }
    c.restore();
  }

  function rebuildCache() {
    var p = page(), d = dpr();
    cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
    cacheCtx.clearRect(0, 0, cache.width, cache.height);
    cacheCtx.setTransform(d * view.k, 0, 0, d * view.k, d * view.ox, d * view.oy);
    paintPaper(cacheCtx, p, view.k);
    p.strokes.forEach(function (s) { if (s.hl) paintStroke(cacheCtx, s); });
    p.strokes.forEach(function (s) { if (!s.hl) paintStroke(cacheCtx, s); });
    cacheValid = true;
  }

  function invalidate() { cacheValid = false; schedule(); }

  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; draw(); });
  }

  function draw() {
    if (!page()) return;
    if (!cacheValid) rebuildCache();
    var d = dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, sheet.width, sheet.height);
    ctx.drawImage(cache, 0, 0);
    ctx.setTransform(d * view.k, 0, 0, d * view.k, d * view.ox, d * view.oy);

    if (drawing && drawing !== "erasing") paintStroke(ctx, drawing);

    if (lasso && lasso.length > 1) {
      ctx.save();
      ctx.strokeStyle = "#7fd1ff";
      ctx.lineWidth = 1.5 / view.k;
      ctx.setLineDash([6 / view.k, 5 / view.k]);
      ctx.beginPath();
      ctx.moveTo(lasso[0][0], lasso[0][1]);
      for (var i = 1; i < lasso.length; i++) ctx.lineTo(lasso[i][0], lasso[i][1]);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    var b = bounds();
    if (b) {
      ctx.save();
      var pad = 10 / view.k;
      ctx.strokeStyle = "#7fd1ff";
      ctx.lineWidth = 1.5 / view.k;
      ctx.setLineDash([7 / view.k, 5 / view.k]);
      ctx.strokeRect(b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + pad * 2, b.y1 - b.y0 + pad * 2);
      ctx.restore();
    }

    pageTag.textContent = (current + 1) + "/" + pages.length;
    zoomTag.textContent = Math.round(view.k / view.fit * 100) + "%";
    bPrev.disabled = current === 0;
    bNext.disabled = current === pages.length - 1;
    bUndo.disabled = !undoStack.length;
    bRedo.disabled = !redoStack.length;
    selbar.hidden = !(sel && sel.idx.length);
  }

  function bounds() {
    if (!sel || !sel.idx.length) return null;
    var p = page(), x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    sel.idx.forEach(function (i) {
      p.strokes[i].pts.forEach(function (q) {
        if (q[0] < x0) x0 = q[0];
        if (q[0] > x1) x1 = q[0];
        if (q[1] < y0) y0 = q[1];
        if (q[1] > y1) y1 = q[1];
      });
    });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  /* --------------------------------------------------------------- input */
  function eraseAt(pt) {
    var p = page(), r = 14 / view.k * (tool.width / 2.8), before = p.strokes.length;
    p.strokes = p.strokes.filter(function (s) {
      for (var i = 0; i < s.pts.length; i++) {
        var dx = s.pts[i][0] - pt.x, dy = s.pts[i][1] - pt.y;
        if (dx * dx + dy * dy < r * r) return false;
      }
      return true;
    });
    if (p.strokes.length !== before) { invalidate(); markDirty(); }
  }

  function clearSelection() { sel = null; lasso = null; selbar.hidden = true; }

  function inSelection(x, y) {
    var b = bounds();
    if (!b) return false;
    var pad = 12 / view.k;
    return x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;
  }

  sheet.addEventListener("pointerdown", function (ev) {
    if (ev.pointerType === "pen") penSeen = true;
    ev.preventDefault();
    sheet.setPointerCapture(ev.pointerId);

    if (ev.pointerType === "touch") {
      touches[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(touches);
      if (ids.length === 2) {
        var a = touches[ids[0]], b = touches[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      }
      if (penSeen) return;
    }

    var pt = toLogical(ev);
    if (tool.mode === "erase") { snapshot(); eraseAt(pt); drawing = "erasing"; return; }
    if (sel && inSelection(pt.x, pt.y)) { snapshot(); dragging = { x: pt.x, y: pt.y }; return; }
    if (tool.mode === "lasso") { clearSelection(); lasso = [[pt.x, pt.y]]; return; }

    clearSelection();
    drawing = { c: tool.color, w: tool.width, hl: tool.mode === "hl",
                pts: [[pt.x, pt.y, pt.p]], _sx: pt.x, _sy: pt.y, _sp: pt.p };
  });

  sheet.addEventListener("pointermove", function (ev) {
    if (touches[ev.pointerId]) {
      var prev = touches[ev.pointerId];
      touches[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(touches);
      if (ids.length === 2 && pinch) {
        var a = touches[ids[0]], b = touches[ids[1]];
        var r = sheet.getBoundingClientRect();
        setZoom(pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d),
                (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        return;
      }
      if (ids.length === 1 && !drawing && !lasso && !dragging) {
        view.ox += ev.clientX - prev.x;
        view.oy += ev.clientY - prev.y;
        clampView();
        invalidate();
        return;
      }
    }
    if (ev.pointerType !== "pen" && penSeen) return;

    if (dragging) {
      var q = toLogical(ev);
      var dx = q.x - dragging.x, dy = q.y - dragging.y;
      dragging = { x: q.x, y: q.y };
      var p = page();
      sel.idx.forEach(function (i) {
        var s = p.strokes[i];
        s.dense = null;
        for (var n = 0; n < s.pts.length; n++) { s.pts[n][0] += dx; s.pts[n][1] += dy; }
      });
      invalidate();
      return;
    }
    if (drawing === "erasing") { eraseAt(toLogical(ev)); return; }
    if (lasso) { var l = toLogical(ev); lasso.push([l.x, l.y]); schedule(); return; }
    if (!drawing) return;

    ev.preventDefault();
    var evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
    for (var i = 0; i < evs.length; i++) {
      var raw = toLogical(evs[i]);
      /* Trust each new sample only partly. Pointer data is noisy, and the
         jitter is exactly what reads as a granular line. */
      drawing._sx += (raw.x - drawing._sx) * SMOOTH;
      drawing._sy += (raw.y - drawing._sy) * SMOOTH;
      drawing._sp += (raw.p - drawing._sp) * 0.3;
      var last = drawing.pts[drawing.pts.length - 1];
      if (Math.hypot(drawing._sx - last[0], drawing._sy - last[1]) < 0.7) continue;
      drawing.pts.push([Math.round(drawing._sx * 10) / 10,
                        Math.round(drawing._sy * 10) / 10,
                        Math.round(drawing._sp * 100) / 100]);
      drawing.dense = null;
    }
    schedule();
  });

  function endStroke(ev) {
    if (ev && touches[ev.pointerId]) {
      delete touches[ev.pointerId];
      if (Object.keys(touches).length < 2) pinch = null;
    }
    if (dragging) { dragging = null; markDirty(); invalidate(); return; }
    if (lasso) {
      if (lasso.length > 4) {
        var poly = lasso, p = page(), idx = [];
        p.strokes.forEach(function (s, i) {
          var hits = 0;
          s.pts.forEach(function (q) { if (inPolygon(q[0], q[1], poly)) hits++; });
          if (hits > s.pts.length * 0.6) idx.push(i);
        });
        sel = idx.length ? { idx: idx } : null;
        if (!idx.length) toast("nothing inside the loop");
      }
      lasso = null;
      schedule();
      return;
    }
    if (!drawing) return;
    if (drawing !== "erasing" && drawing.pts.length) {
      snapshot();
      delete drawing._sx; delete drawing._sy; delete drawing._sp;
      page().strokes.push(drawing);
    }
    drawing = null;
    invalidate();
    markDirty();
  }
  sheet.addEventListener("pointerup", endStroke);
  sheet.addEventListener("pointercancel", endStroke);
  sheet.addEventListener("pointerleave", endStroke);
  ["touchstart", "touchmove", "touchend", "gesturestart", "gesturechange"].forEach(function (t) {
    sheet.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  sheet.addEventListener("wheel", function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    var r = sheet.getBoundingClientRect();
    setZoom(view.k * (e.deltaY < 0 ? 1.08 : 0.93), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  /* ----------------------------------------------------------- selection */
  function selected() {
    var p = page();
    return sel ? sel.idx.map(function (i) { return JSON.parse(JSON.stringify(p.strokes[i])); }) : [];
  }

  var ACTIONS = {
    copy: function () { clipboard = selected(); toast(clipboard.length + " copied"); },
    cut: function () {
      clipboard = selected(); snapshot();
      var drop = {}; sel.idx.forEach(function (i) { drop[i] = true; });
      page().strokes = page().strokes.filter(function (_, i) { return !drop[i]; });
      clearSelection(); invalidate(); markDirty();
    },
    paste: function () {
      if (!clipboard.length) { toast("nothing copied yet"); return; }
      snapshot();
      var p = page(), start = p.strokes.length;
      JSON.parse(JSON.stringify(clipboard)).forEach(function (s) {
        s.dense = null;
        s.pts.forEach(function (q) { q[0] += 30; q[1] += 30; });
        p.strokes.push(s);
      });
      sel = { idx: p.strokes.slice(start).map(function (_, n) { return start + n; }) };
      invalidate(); markDirty();
    },
    duplicate: function () { ACTIONS.copy(); ACTIONS.paste(); },
    colour: function () {
      snapshot();
      var p = page();
      sel.idx.forEach(function (i) { p.strokes[i].c = tool.color; });
      invalidate(); markDirty();
    },
    "delete": function () {
      snapshot();
      var drop = {}; sel.idx.forEach(function (i) { drop[i] = true; });
      page().strokes = page().strokes.filter(function (_, i) { return !drop[i]; });
      clearSelection(); invalidate(); markDirty();
    },
    done: function () { clearSelection(); schedule(); },
  };
  Array.prototype.forEach.call(selbar.querySelectorAll("button"), function (b) {
    b.onclick = function () {
      var act = ACTIONS[b.dataset.act];
      if (!act) return;
      if (["paste", "done"].indexOf(b.dataset.act) === -1 && !(sel && sel.idx.length)) return;
      act();
    };
  });

  /* -------------------------------------------------------------- export */
  function toPNG(p) {
    var c = document.createElement("canvas");
    c.width = p.w; c.height = p.h;
    var g = c.getContext("2d");
    /* What is exported is what you see. Inverting it would wreck a colour the
       writer chose on purpose. */
    paintPaper(g, p, 1);
    p.strokes.forEach(function (s) { if (s.hl) paintStroke(g, s); });
    p.strokes.forEach(function (s) { if (!s.hl) paintStroke(g, s); });
    return c.toDataURL("image/png");
  }

  /* ---------------------------------------------------------------- save */
  function markDirty() {
    dirty = true;
    savedTag.textContent = "…";
    savedTag.classList.add("busy");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { save(false); }, AUTOSAVE_MS);
    if (tool.live) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(function () {
        if (Date.now() - lastLiveSend >= LIVE_MIN_GAP_MS) save(true, true);
      }, LIVE_IDLE_MS);
    }
  }

  function save(send, quiet) {
    var p = page();
    savedTag.classList.add("busy");
    return fetch("/slate/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: current + 1, w: p.w, h: p.h,
                             strokes: p.strokes.map(stripDense),
                             png: toPNG(p), send: !!send, pages: pages.length }),
    }).then(function (r) { return r.json(); }).then(function () {
      dirty = false;
      savedTag.classList.remove("busy");
      savedTag.textContent = send ? "sent" : "saved";
      if (send) {
        lastLiveSend = Date.now();
        if (!quiet) toast("page " + (current + 1) + " sent for review");
        if (opts.onSend) opts.onSend();
      }
    }).catch(function () {
      savedTag.classList.remove("busy");
      savedTag.textContent = "offline";
    });
  }

  function stripDense(s) {
    return { c: s.c, w: s.w, hl: !!s.hl, pts: s.pts };
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { toastEl.hidden = true; }, 1800);
  }

  /* -------------------------------------------------------------- chrome */
  function renderPalette() {
    var list = tool.paper === "black" ? PALETTE_DARK : PALETTE_LIGHT;
    gInks.innerHTML = "";
    inkButtons = list.map(function (col) {
      var b = el("button", "sl-ink" + (col === tool.color ? " sel" : ""));
      b.type = "button";
      b.title = col;
      b.style.setProperty("--c", col);
      b.dataset.c = col;
      b.onclick = function () { pickInk(col, b); };
      gInks.appendChild(b);
      return b;
    });
    gInks.appendChild(custom);
    if (list.indexOf(tool.color) === -1) custom.classList.add("sel");
  }

  function pickInk(col, node) {
    tool.color = col;
    inkButtons.concat([custom]).forEach(function (b) { b.classList.remove("sel"); });
    if (node) node.classList.add("sel");
    if (sel && sel.idx.length) ACTIONS.colour();
  }

  customInput.oninput = function () {
    custom.style.setProperty("--c", customInput.value);
    pickInk(customInput.value, custom);
  };
  custom.style.setProperty("--c", customInput.value);

  function selectOne(list, node) {
    list.forEach(function (b) { b.classList.remove("sel"); });
    node.classList.add("sel");
  }

  [bPen, bHl, bEr, bLa].forEach(function (b, i) {
    b.onclick = function () {
      tool.mode = ["pen", "hl", "erase", "lasso"][i];
      selectOne([bPen, bHl, bEr, bLa], b);
      if (tool.mode !== "lasso") clearSelection();
      root.dataset.tool = tool.mode;
      schedule();
    };
  });
  nibs.forEach(function (b) {
    b.onclick = function () { tool.width = parseFloat(b.dataset.w); selectOne(nibs, b); };
  });

  bMore.onclick = function () {
    menu.hidden = !menu.hidden;
    bMore.classList.toggle("on", !menu.hidden);
    if (!menu.hidden) setTimeout(function () { api.relayout(); }, 0);
  };

  bUndo.onclick = function () { restoreFrom(undoStack, redoStack); };
  bRedo.onclick = function () { restoreFrom(redoStack, undoStack); };
  bZoomIn.onclick = function () { setZoom(view.k * 1.25); };
  bZoomOut.onclick = function () { setZoom(view.k / 1.25); };
  bFit.onclick = fitPage;

  paperBtns.forEach(function (b) {
    b.onclick = function () {
      tool.paper = b.dataset.paper;
      selectOne(paperBtns, b);
      root.dataset.paper = tool.paper;
      renderPalette();
      /* Keep the ink visible: a colour chosen for slate is invisible on white. */
      var list = tool.paper === "black" ? PALETTE_DARK : PALETTE_LIGHT;
      if (PALETTE_DARK.concat(PALETTE_LIGHT).indexOf(tool.color) !== -1) {
        pickInk(list[0], inkButtons[0]);
      }
      invalidate();
      markDirty();
    };
  });
  ruleBtns.forEach(function (b) {
    b.onclick = function () {
      tool.rule = b.dataset.rule;
      selectOne(ruleBtns, b);
      invalidate();
      markDirty();
    };
  });
  bLive.onclick = function () {
    tool.live = !tool.live;
    bLive.textContent = tool.live ? "on" : "off";
    bLive.classList.toggle("sel", tool.live);
    toast(tool.live ? "the tutor sees each page as you pause" : "sending only when you tap Send");
  };
  bTaller.onclick = function () {
    snapshot();
    page().h += Math.round(LOGICAL_W * 0.5);
    markDirty();
    fitPage();
  };
  bPrev.onclick = function () { goTo(current - 1); };
  bNext.onclick = function () { goTo(current + 1); };
  bAdd.onclick = function () { pages.push(blankPage()); goTo(pages.length - 1); };
  bSend.onclick = function () { save(true); };

  function goTo(n) {
    if (n < 0 || n >= pages.length) return;
    if (dirty) save(false);
    current = n;
    undoStack.length = 0; redoStack.length = 0;
    clearSelection();
    fitPage();
  }

  /* ---------------------------------------------------------------- boot */
  root.dataset.tool = "pen";
  root.dataset.paper = tool.paper;
  renderPalette();

  var ro = window.ResizeObserver ? new ResizeObserver(function () {
    layout();
    fitPage();
  }) : null;
  if (ro) ro.observe(wrap);
  window.addEventListener("resize", function () { layout(); fitPage(); });
  window.addEventListener("beforeunload", function () { if (dirty) save(false); });

  fetch("/slate/state").then(function (r) { return r.json(); }).then(function (d) {
    pages = (d.pages || []).filter(function (p) { return p && p.w && p.h; });
    if (!pages.length) pages = [blankPage()];
    current = pages.length - 1;
    layout(); fitPage();
    savedTag.textContent = "saved";
  }).catch(function () {
    pages = [blankPage()];
    layout(); fitPage();
  });

  api.relayout = function () { layout(); fitPage(); };
  api.save = save;
  api.root = root;
  return api;
}

window.Slate = { create: create };
})();
