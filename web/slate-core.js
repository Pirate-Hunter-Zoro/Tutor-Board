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

/* A page is created at the size of the surface showing it, so one logical unit
   is one CSS pixel and 100% zoom is already the right size to write at. The old
   fixed 1600-wide page had to be scaled down to fit, which made everything small
   and forced people to zoom -- and zooming a handwriting surface is miserable.
   Pages written elsewhere are scaled to fit the width on arrival. */

var AUTOSAVE_MS = 1200;
var LIVE_IDLE_MS = 3000;
var LIVE_MIN_GAP_MS = 15000;
var UNDO_DEPTH = 60;
var SMOOTH = 0.30;          /* how much of each new sample to trust, at rest */
/* ...and how fast the pen has to be moving, in logical units per sample, before
   it is trusted completely. Smoothing buys steadiness by lagging the nib, and a
   fixed amount of it is wrong at both ends: at a crawl the hand's tremor is the
   whole signal and wants heavy averaging, while in a quick stroke the samples
   are far apart, carry little relative jitter, and the lag is the only thing you
   notice -- the ink visibly trails the pen. So the trust slides with speed. */
var TRACK = 8;
var RESAMPLE = 0.8;         /* logical units between rendered points */
var MIN_STEP = 0.5;         /* how far the pen must travel to record a point */
var POLISH = 2;             /* smoothing passes over a finished stroke */

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

/* One-euro-style smoothing while the pen moves cannot remove tremor without
   adding lag you can feel. So the live path stays responsive and the stroke is
   polished once, on lift: a weighted three-point average over the interior,
   which pulls out hand tremor while leaving the endpoints and the overall shape
   exactly where they were put. Pressure is averaged with it, so the width stops
   flickering along a line that was drawn at a steady weight. */
/* How much of a new sample to believe, given how far it is from where the line
   has got to. */
function trust(dist) {
  if (dist >= TRACK) return 1;
  return SMOOTH + (1 - SMOOTH) * (dist / TRACK);
}

function polish(pts, passes) {
  if (pts.length < 4) return pts;
  var cur = pts;
  for (var pass = 0; pass < passes; pass++) {
    var out = [cur[0]];
    for (var i = 1; i < cur.length - 1; i++) {
      var a = cur[i - 1], b = cur[i], c = cur[i + 1];
      out.push([Math.round((a[0] + 2 * b[0] + c[0]) / 4 * 10) / 10,
                Math.round((a[1] + 2 * b[1] + c[1]) / 4 * 10) / 10,
                Math.round((a[2] + 2 * b[2] + c[2]) / 4 * 100) / 100]);
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

/* Light ink on dark paper is right on a screen at night and wrong in a file
   whose only job is to be read by whatever agent opens it. The export is always
   dark ink on white, whatever the screen is showing, so any stroke too pale to
   survive that change is darkened until it does. Hue is kept -- a colour chosen
   to mean something still means it -- and only the lightness moves. A near-grey
   has no hue worth keeping and goes to near-black. */
/* A highlighter has to stay a highlight when the page turns white. `forPaper`
   exists to make a light INK readable on white, and running a marker through it
   produced the opposite of a highlight: a six-times-wide stroke of near-black,
   multiplied -- a smudge over the very working it was drawn to point at. Keep
   the hue, force it pale, and let multiply do the rest. */
function asHighlight(css) {
  var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(css || "").trim());
  if (!m) return "#ffe08a";
  var h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  var r = parseInt(h.slice(0, 2), 16),
      g = parseInt(h.slice(2, 4), 16),
      b = parseInt(h.slice(4, 6), 16);
  var top = Math.max(r, g, b, 1);
  /* Scale the brightest channel up to near-white and carry the others with it,
     which lightens without shifting the hue. */
  var k = 245 / top;
  var pale = function (v) { return Math.round(Math.min(255, 200 + (v * k - 200) * 0.55)); };
  return "rgb(" + pale(r) + "," + pale(g) + "," + pale(b) + ")";
}

function forPaper(css) {
  var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(css || "").trim());
  if (!m) return css;
  var h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  var r = parseInt(h.slice(0, 2), 16),
      g = parseInt(h.slice(2, 4), 16),
      b = parseInt(h.slice(4, 6), 16);
  var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum <= 0.45) return css;                    /* already reads on white */
  if (Math.max(r, g, b) - Math.min(r, g, b) < 12) return "rgb(26,27,30)";
  var target = 0.30 / Math.max(lum, 0.001);
  var mix = function (v) { return Math.max(0, Math.min(255, Math.round(v * target))); };
  return "rgb(" + [mix(r), mix(g), mix(b)].join(",") + ")";
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
  /* Where the controls go. On the board that is the page's own chrome bar, so
     they read as part of the app rather than as a widget dropped on top of it. */
  var barHost = opts.bar || null;

  var api = {};
  var pages = [];
  var current = 0;
  var undoStack = [], redoStack = [], clipboard = [];
  var tool = { mode: "pen", color: PALETTE_DARK[0], width: 3.2,
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
  var toolsCol = el("div", "sl-tools");
  var actsCol = el("div", "sl-acts");
  bar.appendChild(toolsCol);
  bar.appendChild(actsCol);

  function seg(parent) { var g = el("div", "sl-seg"); parent.appendChild(g); return g; }
  function mk(parent, cls, html, title) {
    var b = el("button", cls, html);
    b.type = "button";
    if (title) b.title = title;
    parent.appendChild(b);
    return b;
  }

  var segTools = seg(toolsCol);
  function tool_(icon, label, title) {
    return mk(segTools, "sl-t",
              '<span class="sl-i">' + icon + '</span><span class="sl-w">' + label + '</span>',
              title);
  }
  var bPen = tool_(ICON.pen, "Pen", "write");
  var bHl = tool_(ICON.hl, "Marker", "highlighter");
  var bEr = tool_(ICON.erase, "Erase", "rub out a stroke");
  var bLa = tool_(ICON.lasso, "Select", "loop around something to move or cut it");
  bPen.classList.add("sel");

  var segNibs = seg(toolsCol);
  var nibs = [1.8, 3.2, 6.0].map(function (w, i) {
    var b = mk(segNibs, "sl-n" + (i === 1 ? " sel" : ""),
               '<i style="width:' + (4 + i * 5) + 'px;height:' + (4 + i * 5) + 'px"></i>'
               + '<span class="sl-w">' + ["Fine", "Medium", "Broad"][i] + '</span>',
               ["fine", "medium", "broad"][i]);
    b.dataset.w = w;
    return b;
  });

  var gInks = el("div", "sl-inks");
  toolsCol.appendChild(gInks);
  var inkButtons = [];
  var custom = el("label", "sl-ink sl-custom");
  custom.title = "any colour";
  var customInput = el("input");
  customInput.type = "color";
  customInput.value = "#c792ea";
  custom.appendChild(customInput);

  

  var bMore = mk(toolsCol, "sl-more", '<span class="sl-i">' + ICON.more + '</span>'
                                 + '<span class="sl-w">More</span>', "pages, zoom, paper");

  /* Undo and redo live in the actions column, not the scrolling tool row. On a
     narrow screen that row scrolls, with no scrollbar to say so, and the two
     controls a person reaches for most were off the right-hand edge where
     nothing suggested they existed. Same reasoning that pinned Send. */
  var segEdit = seg(actsCol);
  var bUndo = mk(segEdit, "sl-t sl-icon-only", '<span class="sl-i">' + ICON.undo + '</span>', "undo");
  var bRedo = mk(segEdit, "sl-t sl-icon-only", '<span class="sl-i">' + ICON.redo + '</span>', "redo");

  var savedTag = el("span", "sl-saved", "saved");
  actsCol.appendChild(savedTag);
  var bSend = mk(actsCol, "sl-send", "Send", "hand this page to the tutor");

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
  var bPrev = mk(rPages, "sl-t sl-icon-only", '<span class="sl-i">' + ICON.prev + '</span>', "previous");
  var pageTag = el("span", "sl-tag", "1/1");
  rPages.appendChild(pageTag);
  var bNext = mk(rPages, "sl-t sl-icon-only", '<span class="sl-i">' + ICON.next + '</span>', "next");
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

  if (barHost) {
    barHost.innerHTML = "";
    barHost.appendChild(bar);
    barHost.appendChild(menu);
    barHost.appendChild(selbar);
    barHost.hidden = false;
    root.classList.add("sl-bare");
  } else {
    root.appendChild(bar);
    root.appendChild(menu);
    root.appendChild(selbar);
  }
  root.appendChild(wrap);
  root.appendChild(toastEl);

  var ctx = sheet.getContext("2d");
  var cache = document.createElement("canvas");
  var cacheCtx = cache.getContext("2d");
  var cacheValid = false;

  /* ----------------------------------------------------------- the model */
  function page() { return pages[current]; }

  function blankPage() {
    /* Exactly the surface it will be drawn on: no clamping, because clamping is
       what forces a scale factor, and a scale factor is what makes people zoom.
       A page from another device is a different size and simply scales to fit
       the width on arrival, like a photograph of a page would. */
    return {
      w: Math.round(wrap.clientWidth || 900),
      h: Math.round(wrap.clientHeight || 520),
      strokes: [],
    };
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
  /* `held` records that the zoom is the writer's, not the component's. Once it
     is set, nothing but an explicit Fit, or turning to another page, is allowed
     to refit -- the board re-renders on every server event, and a re-render
     that throws away the zoom you just set makes the surface unusable. */
  var view = { k: 1, fit: 1, ox: 0, oy: 0, held: false };

  /* Fit by WIDTH, never by area. Fitting the whole page on screen is what made
     a tall page shrink to something unwritable; the width is what has to match,
     and the height is simply scrolled. */
  function fitPage() {
    var p = page();
    if (!p || !wrap.clientWidth) return;
    view.held = false;
    view.fit = wrap.clientWidth / p.w;
    view.k = view.fit;
    view.ox = 0;
    /* A page shorter than the surface is centred; a taller one starts at the
       top, where the writing begins. */
    var h = p.h * view.k;
    view.oy = h < wrap.clientHeight ? (wrap.clientHeight - h) / 2 : 0;
    clampView();
    invalidate();
  }

  function clampView() {
    var p = page();
    if (!p) return;
    var m = 60;
    var w = p.w * view.k, h = p.h * view.k;
    /* Horizontally: never leave a gap when the page is at or wider than the
       surface, so the writing area always fills the width. */
    view.ox = w <= wrap.clientWidth ? (wrap.clientWidth - w) / 2
            : Math.min(0, Math.max(wrap.clientWidth - w, view.ox));
    view.oy = h <= wrap.clientHeight ? (wrap.clientHeight - h) / 2
            : Math.min(0, Math.max(wrap.clientHeight - h, view.oy));
  }

  function setZoom(k, cx, cy) {
    k = Math.max(view.fit * 0.5, Math.min(view.fit * 8, k));
    view.held = true;
    var r = sheetRect();
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
    if (!w || !h) {
      /* Mounted before the box had a size. Try again on the next frame rather
         than leaving a 300x150 default canvas nobody can draw on. */
      if (!layout.retry) {
        layout.retry = true;
        requestAnimationFrame(function () { layout.retry = false; layout(); fitPage(); });
      }
      return;
    }
    sheet.style.width = w + "px";
    sheet.style.height = h + "px";
    sheet.width = Math.round(w * dpr());
    sheet.height = Math.round(h * dpr());
    cache.width = sheet.width;
    cache.height = sheet.height;
    dropRect();
    invalidate();
  }

  /* Where the sheet is, cached for the length of a frame.

     `toLogical` is called once per SAMPLE, and a Pencil reports far faster than
     the screen refreshes -- with coalesced events that is a couple of hundred
     calls a second, each one a forced layout flush. On the board the layout
     being flushed is the entire lesson sitting above the surface, so the cost
     grows with the length of the lesson: the longer you had been taught, the
     worse the ink felt. Nothing that matters can move within one frame except
     the page scrolling underneath, so read it once per frame and once per
     scroll. */
  var rectAt = null;
  function sheetRect() {
    if (!rectAt) rectAt = sheet.getBoundingClientRect();
    return rectAt;
  }
  function dropRect() { rectAt = null; }
  window.addEventListener("scroll", dropRect, true);
  window.addEventListener("resize", dropRect);

  function toLogical(ev) {
    var r = sheetRect();
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
    var step = Math.max(28, Math.round(p.w / 22));
    for (var y = step; y < p.h; y += step) { c.moveTo(0, y); c.lineTo(p.w, y); }
    if (tool.rule === "grid") for (var x = step; x < p.w; x += step) { c.moveTo(x, 0); c.lineTo(x, p.h); }
    c.stroke();
  }

  /* `onDark` is a property of the surface being painted, not of the current
     paper: the same function draws the live canvas and the PNG, and the PNG is
     always white however dark the screen is. Reading the paper setting here
     would fix the marker on screen and lose it in the file. */
  function paintStroke(c, s, onDark, from) {
    var pts = s.dense || (s.dense = densify(s.pts));
    if (!pts.length) return;
    /* `from` paints only the tail of a stroke that is still being drawn: the
       part that has appeared since the last frame. Everything before it is
       already on the canvas and painting it again is the whole per-frame cost
       of a long stroke. */
    if (from) {
      if (from >= pts.length) { return; }
    }
    c.save();
    if (s.hl) {
      /* A highlighter works by darkening what is under it, which is why it is
         multiplied -- and on black paper multiplying a colour into near-black
         gives back near-black, so the marker was invisible on screen while
         showing perfectly well in the PNG, which is always dark ink on white.
         On dark paper the same gesture has to lighten instead. */
      c.globalAlpha = 0.3;
      c.globalCompositeOperation = onDark ? "screen" : "multiply";
    }
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
    /* Segments of the same width go into ONE path. The curve is resampled to
       about a pixel -- that density is what makes it read as smooth -- so
       stroking each segment separately is a draw call per pixel of line,
       hundreds a frame while writing. Pressure moves slowly, so consecutive
       segments almost always land in the same quarter-pixel of width, and a
       round join inside one path is the same ink as the round caps two separate
       segments had. A highlighter has one width along its whole length and so
       becomes a single path -- which also stops it blotching, since the caps
       used to overlap and multiply into each other at every joint. */
    var wOf = function (a, b) {
      return s.hl ? base
                  : Math.round(base * (0.5 + 0.85 * ((a[2] + b[2]) / 2)) * 4) / 4;
    };
    var i = Math.max(1, from || 1);
    while (i < pts.length) {
      var w = wOf(pts[i - 1], pts[i]);
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(pts[i - 1][0], pts[i - 1][1]);
      c.lineTo(pts[i][0], pts[i][1]);
      i++;
      while (i < pts.length && wOf(pts[i - 1], pts[i]) === w) {
        c.lineTo(pts[i][0], pts[i][1]);
        i++;
      }
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
    var dark = tool.paper === "black";
    p.strokes.forEach(function (s) { if (s.hl) paintStroke(cacheCtx, s, dark); });
    p.strokes.forEach(function (s) { if (!s.hl) paintStroke(cacheCtx, s, dark); });
    cacheValid = true;
  }

  function invalidate() { cacheValid = false; schedule(); }

  /* How much of the live stroke is already on the canvas. */
  var livePainted = 0;
  var fullNext = true;

  function schedule(liveOnly) {
    if (!liveOnly) fullNext = true;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      dropRect();          /* a new frame may sit somewhere new */
      if (fullNext) { fullNext = false; draw(); }
      else drawLive();
    });
  }

  /* The common frame while writing: nothing has changed except that the stroke
     under the nib got longer. Clearing the sheet, blitting the cache and
     repainting the whole live stroke -- which is what every frame used to do --
     is work proportional to how long you have been drawing, sixty times a
     second. Paint the new segments straight onto what is already there. */
  function drawLive() {
    if (!drawing || drawing === "erasing" || !cacheValid || lasso || sel) {
      draw();
      return;
    }
    if (!drawing.dense || drawing.dense.length <= livePainted + 1) return;
    var d = dpr();
    ctx.setTransform(d * view.k, 0, 0, d * view.k, d * view.ox, d * view.oy);
    paintStroke(ctx, drawing, tool.paper === "black", livePainted + 1);
    livePainted = drawing.dense.length - 1;
  }

  function draw() {
    if (!page()) return;
    if (!cacheValid) rebuildCache();
    var d = dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, sheet.width, sheet.height);
    ctx.drawImage(cache, 0, 0);
    ctx.setTransform(d * view.k, 0, 0, d * view.k, d * view.ox, d * view.oy);

    if (drawing && drawing !== "erasing") {
      paintStroke(ctx, drawing, tool.paper === "black");
      livePainted = (drawing.dense || []).length - 1;
    } else {
      livePainted = 0;
    }

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
    livePainted = 0;     /* nothing of this stroke is on the canvas yet */
  });

  sheet.addEventListener("pointermove", function (ev) {
    if (touches[ev.pointerId]) {
      var prev = touches[ev.pointerId];
      touches[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(touches);
      if (ids.length === 2 && pinch) {
        var a = touches[ids[0]], b = touches[ids[1]];
        var r = sheetRect();
        setZoom(pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d),
                (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        return;
      }
      if (ids.length === 1 && !drawing && !lasso && !dragging) {
        view.ox += ev.clientX - prev.x;
        view.oy += ev.clientY - prev.y;
        view.held = true;
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
      var a = trust(Math.hypot(raw.x - drawing._sx, raw.y - drawing._sy));
      drawing._sx += (raw.x - drawing._sx) * a;
      drawing._sy += (raw.y - drawing._sy) * a;
      /* Pressure is always smoothed hard: it is noisy, and nobody perceives it
         as lag. */
      drawing._sp += (raw.p - drawing._sp) * 0.3;
      var last = drawing.pts[drawing.pts.length - 1];
      if (Math.hypot(drawing._sx - last[0], drawing._sy - last[1]) < MIN_STEP) continue;
      drawing.pts.push([Math.round(drawing._sx * 10) / 10,
                        Math.round(drawing._sy * 10) / 10,
                        Math.round(drawing._sp * 100) / 100]);
    }
    extendLive();
    schedule(true);
  });

  /* Grow the live stroke's curve by whatever the new samples allow, instead of
     recomputing the whole thing every frame. A Catmull-Rom segment needs the
     point after its end, so the newest sample is held back by one -- invisible,
     and it turns a cost that grew with the length of the stroke into a constant
     one. */
  function extendLive() {
    var s = drawing;
    if (!s || s === "erasing") return;
    if (!s.dense) { s.dense = []; s._built = 0; }
    var pts = s.pts;
    while (s._built + 2 < pts.length) {
      var i = s._built;
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      if (!s.dense.length) s.dense.push(p1);
      var dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      var steps = Math.max(1, Math.min(24, Math.ceil(dist / RESAMPLE)));
      for (var k = 1; k <= steps; k++) s.dense.push(catmullRom(p0, p1, p2, p3, k / steps));
      s._built++;
    }
  }

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
      drawing.pts = polish(drawing.pts, POLISH);
      drawing.dense = null;
      delete drawing._built;
      livePainted = 0;
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
    var r = sheetRect();
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
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, p.w, p.h);
    if (tool.rule !== "plain") {
      g.strokeStyle = "#eef1f4";
      g.lineWidth = 1;
      g.beginPath();
      var step = Math.max(28, Math.round(p.w / 22));
      for (var y = step; y < p.h; y += step) { g.moveTo(0, y); g.lineTo(p.w, y); }
      if (tool.rule === "grid") {
        for (var x = step; x < p.w; x += step) { g.moveTo(x, 0); g.lineTo(x, p.h); }
      }
      g.stroke();
    }
    var order = p.strokes.filter(function (s) { return s.hl; })
                 .concat(p.strokes.filter(function (s) { return !s.hl; }));
    order.forEach(function (s) {
      var swapped = s.c;
      s.c = s.hl ? asHighlight(s.c) : forPaper(s.c);
      paintStroke(g, s, false);        /* the PNG is white, always */
      s.c = swapped;
    });
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
    var body = { page: current + 1, w: p.w, h: p.h,
                 strokes: p.strokes.map(stripDense),
                 png: toPNG(p), send: !!send, pages: pages.length };
    /* Which turn this is, and which question it answers. The host decides --
       the component knows about ink, not about a lesson. */
    var ctx = opts.context ? opts.context() : null;
    if (ctx) {
      if (ctx.turn) body.turn = ctx.turn;
      if (ctx.answers) body.answers = ctx.answers;
    }
    return fetch("/slate/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); }).then(function (res) {
      dirty = false;
      savedTag.classList.remove("busy");
      savedTag.textContent = send ? "sent" : "saved";
      if (send) {
        lastLiveSend = Date.now();
        if (!quiet) toast(res && res.rev > 1 ? "answer updated" : "sent for review");
        if (opts.onSend) opts.onSend(res || {});
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
    page().h += Math.round(wrap.clientHeight / view.k * 0.75);
    markDirty();
    fitPage();
  };
  bPrev.onclick = function () { goTo(current - 1); };
  bNext.onclick = function () { goTo(current + 1); };
  bAdd.onclick = function () { pages.push(blankPage()); goTo(pages.length - 1); };
  /* The host may want a word first -- on the board there can be marks on the
     lesson as well as working on this page, and which of the two is being sent
     is the student's decision, not a guess. Without a hook this sends, exactly
     as it always did. */
  bSend.onclick = function () {
    var go = function () { save(true); };
    if (opts.beforeSend) opts.beforeSend(go); else go();
  };

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

  /* Usable immediately. The old order was to wait for /slate/state before
     creating the first page, which meant that until the network answered there
     was no page, no sized canvas, and every stroke threw on its way out --
     silently, because a pointer handler that throws just does nothing. A slow
     link or a failed request was indistinguishable from a surface that does not
     work. */
  pages = [blankPage()];
  current = 0;
  layout();
  fitPage();

  fetch("/slate/state").then(function (r) { return r.json(); }).then(function (d) {
    var saved = (d.pages || []).filter(function (p) { return p && p.w && p.h; });
    if (!saved.length) return;
    /* Only adopt saved pages if nothing has been drawn in the meantime --
       whatever is under the pen wins over whatever the server remembered. */
    if (pages.length === 1 && !pages[0].strokes.length) {
      pages = saved;
      current = pages.length - 1;
      layout();
      fitPage();
    }
    savedTag.textContent = "saved";
  }).catch(function () { /* offline is fine; the page still works */ });

  /* Re-measure the box, but keep a zoom the writer set on purpose. The board
     calls this after every render, and every server event is a render. */
  api.relayout = function () {
    layout();
    if (view.held) { clampView(); invalidate(); } else { fitPage(); }
  };
  api.bar = barHost || bar;
  /* Enough of the innards for a test to prove that a stroke actually landed.
     Everything about this component is invisible to assertions otherwise. */
  api.debug = function () {
    return { strokes: page() ? page().strokes.length : -1,
             drawing: !!drawing, w: sheet.width, h: sheet.height,
             pages: pages.length, k: view.k };
  };
  api.save = save;
  /* Put a previously sent answer back on the surface so it can be corrected.
     Feedback on an answer you can no longer edit is feedback you cannot act on,
     which was the whole complaint. Replaces the current page; the undo stack
     keeps what was there. */
  api.load = function (data) {
    var p = page();
    if (!p) return false;
    snapshot();
    p.strokes = (data && data.strokes) || [];
    p.strokes.forEach(function (s) { s.dense = null; });
    if (data && data.w) p.w = data.w;
    if (data && data.h) p.h = data.h;
    clearSelection();
    invalidate();
    fitPage();
    return true;
  };
  api.clear = function () {
    var p = page();
    if (!p) return;
    snapshot();
    p.strokes = [];
    clearSelection();
    invalidate();
  };
  api.root = root;
  return api;
}

/* forPaper is exposed so the export rule can be asserted. There is no canvas
   backend in the test environment, so the only way to prove the PNG is legible
   is to prove the colour mapping is.

   `ink` is exposed for the annotation layer over the lesson. That layer had its
   own line drawing -- raw pointer samples joined by straight segments -- and it
   looked exactly as bad as this file's opening comment says it would: faceted,
   granular, and jagged wherever the hand moved quickly. Ink quality is one
   problem and it should have one implementation, so the geometry lives here and
   both surfaces use it. */
window.Slate = {
  create: create,
  forPaper: forPaper,
  ink: {
    densify: densify,
    polish: polish,
    catmullRom: catmullRom,
    SMOOTH: SMOOTH,
    TRACK: TRACK,
    trust: trust,
    RESAMPLE: RESAMPLE,
    MIN_STEP: MIN_STEP,
    POLISH: POLISH,
  },
};
})();
