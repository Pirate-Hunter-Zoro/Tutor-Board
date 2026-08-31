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

/* The page is a window onto a plane, not the plane itself.

   A page used to be a box: created at the size of the surface, clamped so the
   view could never leave it, and enlarged only by pressing "taller". Which
   means running out of room mid-derivation, and zooming out to find a hard edge
   a screen away in every direction.

   So panning is clamped to the ink instead -- whatever has been written, plus
   this much fresh space beyond it, measured in viewports. Write into that space
   and it moves outward again, in every direction, negative coordinates
   included. There is no edge to reach. */
var ROOM = 1.0;             /* viewports of empty space beyond the ink */
var ZOOM_MIN = 1 / 12;      /* how far out you may zoom, relative to fit */
var ZOOM_MAX = 8;

/* What the tutor is sent is a picture of the WRITING, not of the plane it sits
   on -- so an unbounded canvas costs nothing to hand in. The image is cropped
   to the ink and then capped, and both halves matter: cropping alone would
   still rasterise a page-wide derivation at 1:1, and capping alone would spend
   the whole budget on empty paper. */
var PNG_PAD = 26;           /* logical units of margin around the ink */
var PNG_MAX_EDGE = 2000;    /* longest side of the image, in pixels */
var PNG_MAX_AREA = 2600 * 2600;

/* Remembered per device, because it is a property of how somebody works and of
   what they are holding, not of a lesson. */
var STORE_KEY = "tutor-board.slate.finger";

function remembered(key, fallback) {
  try {
    var v = window.localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (e) { return fallback; }
}
function remember_(key, value) {
  try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
}

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
  /* Whether `pages` is what the server has, or the one blank sheet that stands
     in until it answers. See `settled` below. */
  var loaded = false;
  var current = 0;
  var undoStack = [], redoStack = [], clipboard = [];
  /* `finger`: "scroll" or "write".

     It used to be neither -- it was a latch. A finger drew until the first time
     a pen touched the glass, and from then on a finger was treated as a palm.
     Which is wrong twice: a swipe writes a line across the page every time the
     app is opened before the Pencil is picked up (the latch is a variable, so it
     resets on every load), and somebody with no stylus at all has no way to say
     so. Nebo asks the question once and remembers the answer; so does this. */
  var tool = { mode: "pen", color: PALETTE_DARK[0], width: 3.2,
               paper: "black", rule: "plain", live: false,
               finger: remembered(STORE_KEY, "scroll") === "write" ? "write" : "scroll" };
  var drawing = null, lasso = null, sel = null, dragging = null;
  var dirty = false, lastLiveSend = 0;
  /* When the pen last reported anything. A palm resting on the glass is a touch
     like any other, and with a finger set to scroll it would drag the canvas out
     from under the nib. Touch panning is therefore ignored for a moment after
     any pen activity -- which is what palm rejection actually is. */
  var lastPenAt = 0;
  var PALM_MS = 500;
  /* Is the nib on the glass right now. A timer alone was not enough: `lastPenAt`
     only moves when the pen REPORTS, and a pen held still mid-stroke -- which is
     what pausing to think looks like -- reports nothing. Half a second later the
     resting palm was free to pan the plane out from under a stroke that had not
     finished, and the next sample of that same stroke then landed somewhere
     completely different: the page appeared to scroll away and a straight line
     streaked across the working to the new position. One stroke, two symptoms,
     one cause. While the pen is down, a hand does nothing at all. */
  var penDown = false;
  /* Every rule that says "ignore this touch" has to be able to expire.
 
     The first version of this could not, and it cost the surface outright: a
     pen lift that the sheet never saw -- capture released elsewhere, the app
     backgrounded mid-stroke, the nib leaving the glass at the edge -- left
     `penDown` true for ever, and with it true nothing a hand did was allowed to
     pan, pinch or write. The surface simply stopped answering, with no way to
     tell from the outside that it was a latch and not a dead canvas.
 
     So the flag is only believed while the pen is still reporting. `PEN_STALE`
     is generous, because the gap between two words of a proof is longer than it
     feels and a still pen reports nothing -- but it is finite, which is the
     whole point. */
  var PEN_STALE = 4000;
  /* Contacts already judged to be a hand. Judged once, when they land, and kept
     judged while they stay on the glass: re-deciding on every move is how a palm
     that outlives a pause becomes a finger. Recorded WITH the time, and expiring,
     for the same reason as above -- a pointer id is reused, and a stale entry
     would silently kill the next finger to be given that number. */
  var palms = {};
  var PALM_STALE = 4000;

  function handAtWork() {
    var since = Date.now() - lastPenAt;
    return (penDown && since < PEN_STALE) || since < PALM_MS;
  }

  /* A PEN is never a palm, whatever the id says.

     Pointer ids are small integers and the platform reuses them, so a palm's id
     -- especially one whose lift the surface never saw, and which is therefore
     still sitting in the map -- comes back a minute later attached to the
     Pencil. Both the move handler and the lift handler then treated a real
     stroke as a hand: the samples were dropped, and worse, the lift returned
     early and the stroke that had just been written was never committed. That
     is a mark that appears under the nib and is gone by the time the hand
     moves, which is as close to unusable as this gets. */
  function isPalm(ev) {
    if (!ev || ev.pointerType === "pen") return false;
    var at = palms[ev.pointerId];
    if (!at) return false;
    if (Date.now() - at > PALM_STALE) { delete palms[ev.pointerId]; return false; }
    return true;
  }
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

  /* Not a preference buried in a settings screen: whether a finger writes is the
     difference between a usable surface and an unusable one, and which way round
     it should be depends on what is in the other hand. */
  var rFinger = menuRow("Finger");
  var fingerBtns = [["scroll", "scrolls"], ["write", "writes"]].map(function (a) {
    var b = mk(rFinger, "sl-chip" + (a[0] === tool.finger ? " sel" : ""), a[1],
               a[0] === "scroll" ? "a finger pans and pinches; only the pen writes"
                                 : "a finger writes too — for a device with no stylus");
    b.dataset.finger = a[0];
    return b;
  });

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

  /* Where the writing actually is, over the whole page.

     Cached, because the pan clamp needs it on every frame of a drag and walking
     every point of every stroke sixty times a second is exactly the kind of cost
     this file has been bitten by before. Invalidated by content changing, not by
     the view moving. */
  var inkCache = null;
  function dropInk() { inkCache = null; }

  function inkBox() {
    if (!inkCache) inkCache = inkBoxOf(page());
    return inkCache;
  }

  /* The region the view is allowed into: the nominal page, plus everything
     written, plus a viewport of clear space in every direction. Writing into
     that space grows it, so the plane has no edge -- but the clamp still exists,
     so a stray pinch cannot fling the surface into empty space a mile from the
     nearest word, which is the way an unbounded canvas usually goes wrong. */
  function reach() {
    var p = page();
    var vw = wrap.clientWidth / view.k, vh = wrap.clientHeight / view.k;
    var mx = vw * ROOM, my = vh * ROOM;
    var x0 = 0, y0 = 0, x1 = p ? p.w : vw, y1 = p ? p.h : vh;
    var b = inkBox();
    if (b) {
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
      x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    return { x0: x0 - mx, y0: y0 - my, x1: x1 + mx, y1: y1 + my };
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

  /* ⤢ means "show me what I have written", which on a plane is not the same as
     "fit the nominal page". With nothing written yet it falls back to the page,
     because fitting an empty box is the only sensible reading. */
  function fitContent() {
    var b = inkBox();
    if (!b || !wrap.clientWidth) return fitPage();
    var pad = 24;
    var w = (b.x1 - b.x0) + pad * 2, h = (b.y1 - b.y0) + pad * 2;
    var k = Math.min(wrap.clientWidth / w, wrap.clientHeight / h);
    view.k = Math.max(view.fit * ZOOM_MIN, Math.min(view.fit * ZOOM_MAX, k));
    view.held = true;
    view.ox = (wrap.clientWidth - (b.x1 - b.x0) * view.k) / 2 - b.x0 * view.k;
    view.oy = (wrap.clientHeight - (b.y1 - b.y0) * view.k) / 2 - b.y0 * view.k;
    clampView();
    invalidate();
  }

  function clampView() {
    var p = page();
    if (!p) return;
    /* The old rule pinned the view to the page box and centred anything smaller
       than the surface, which is why zooming out found a wall a screen away and
       why the surface sprang back to the middle when you tried to pan past it. */
    var r = reach();
    var cw = wrap.clientWidth, ch = wrap.clientHeight;
    var w = (r.x1 - r.x0) * view.k, h = (r.y1 - r.y0) * view.k;
    if (w <= cw) view.ox = (cw - w) / 2 - r.x0 * view.k;
    else view.ox = Math.min(-r.x0 * view.k, Math.max(cw - r.x1 * view.k, view.ox));
    if (h <= ch) view.oy = (ch - h) / 2 - r.y0 * view.k;
    else view.oy = Math.min(-r.y0 * view.k, Math.max(ch - r.y1 * view.k, view.oy));
  }

  function setZoom(k, cx, cy) {
    k = Math.max(view.fit * ZOOM_MIN, Math.min(view.fit * ZOOM_MAX, k));
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
  /* The paper is whatever is on screen. It used to be the page box, which on a
     plane means panning off the edge of the paper into a transparent void -- and
     the ruling stopping dead at an invisible line is worse than no ruling. */
  function paintPaper(c, p, scale) {
    var skin = PAPERS[tool.paper];
    var x0 = -view.ox / view.k, y0 = -view.oy / view.k;
    var x1 = x0 + wrap.clientWidth / view.k, y1 = y0 + wrap.clientHeight / view.k;
    c.fillStyle = skin.bg;
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (tool.rule === "plain") return;
    var step = ruleStep(p);
    /* Anchored to the origin, so the ruling does not crawl as the view moves. */
    c.strokeStyle = skin.rule;
    c.lineWidth = 1 / scale;
    c.beginPath();
    for (var y = Math.ceil(y0 / step) * step; y < y1; y += step) { c.moveTo(x0, y); c.lineTo(x1, y); }
    if (tool.rule === "grid") {
      for (var x = Math.ceil(x0 / step) * step; x < x1; x += step) { c.moveTo(x, y0); c.lineTo(x, y1); }
    }
    c.stroke();
  }

  function ruleStep(p) { return Math.max(28, Math.round((p && p.w ? p.w : 900) / 22)); }

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
  /* How far the rubber reaches, in SCREEN pixels -- divided by the zoom, so what
     it takes out is what it looks like it covers at any magnification. It was a
     third of this and it was measured off the PEN's width, which is a setting
     that has nothing to do with rubbing out. */
  var ERASE_R = 26;
  /* Where the rubber was last known to be, so a move can be treated as the
     sweep it is rather than as the point it ended at. */
  var rubbedFrom = null;

  /* Square of the distance from a point to a segment. The whole eraser turns on
     this: a swipe is a line, not a dot. */
  function distToSeg(px, py, ax, ay, bx, by) {
    var vx = bx - ax, vy = by - ay;
    var len = vx * vx + vy * vy;
    var t = len ? ((px - ax) * vx + (py - ay) * vy) / len : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var dx = px - (ax + vx * t), dy = py - (ay + vy * t);
    return dx * dx + dy * dy;
  }

  function eraseAt(pt) {
    var p = page();
    if (!p) return;
    var r = (ERASE_R + tool.width * 1.5) / view.k;
    var before = p.strokes.length;
    /* Sweep from where the rubber was to where it now is, instead of testing the
       one point the event happened to land on. A fast swipe delivers its samples
       a long way apart -- that is what makes it fast -- so testing only the
       landing points leaves untouched gaps between them, and the gaps are the
       whole of "I went over it three times and half of it is still there".
       Against the segment rather than against a string of sampled points on it,
       which is both exact and cheaper. */
    var a = rubbedFrom || pt;
    p.strokes = p.strokes.filter(function (s) {
      for (var i = 0; i < s.pts.length; i++) {
        if (distToSeg(s.pts[i][0], s.pts[i][1], a.x, a.y, pt.x, pt.y) < r * r) {
          return false;
        }
      }
      return true;
    });
    rubbedFrom = pt;
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
    if (ev.pointerType === "pen") {
      lastPenAt = Date.now();
      penDown = true;
      /* The pen is the authority, and it arrives second: a hand is on the glass
         before the nib is. So anything a touch had started is a palm by
         hindsight. Throw it away rather than leave half a streak lying across
         the working, and drop any pan or pinch it had begun. */
      if (drawing && drawing !== "erasing" && drawing._touch) {
        drawing = null;
        livePainted = 0;
        invalidate();
      }
      /* And anything already on the glass when the nib arrives is a hand, for
         as long as it stays there. Clearing `touches` alone was not enough:
         a contact that is merely forgotten is a contact that gets re-read as a
         fresh finger by the next move it makes. */
      Object.keys(touches).forEach(function (id) { palms[id] = Date.now(); });
      touches = {};
      pinch = null;
    }
    ev.preventDefault();
    /* A pointer the sheet never received natively -- a stroke handed on from a
       dormant board as it goes live -- has nothing to capture, and asking throws
       rather than returning false. */
    try { sheet.setPointerCapture(ev.pointerId); } catch (e) { /* not fatal */ }

    if (ev.pointerType === "touch") {
      /* Condemned for life ONLY when the nib is actually on the glass, which is
         the one case there is no doubt about: a contact that lands while a
         stroke is being drawn is a hand.
 
         It used to condemn on `handAtWork()`, which is also true for half a
         second after the pen last reported -- and a judgement made there lasted
         the whole life of the contact. So a finger put down within half a second
         of lifting the pen was dead, and stayed dead however long it rested,
         which is exactly the gesture "write a line, then scroll" is made of. The
         surface looked like it had stopped answering at random; it had, and the
         randomness was how quickly the hand moved.
 
         The half-second tail is still applied, but per MOVE, down in the pan and
         pinch handling where it started -- so it suppresses and then lets go,
         rather than condemning.
 
         (There was a contact-size test here too, once. What Safari reports for
         `width` on a fingertip is not the small number the specification's
         examples suggest, so the threshold meant to catch a heel of a hand caught
         ordinary fingers. A signal that cannot be calibrated without the hardware
         in front of you does not belong in the path that decides whether the
         surface responds at all.) */
      if (penDown && Date.now() - lastPenAt < PEN_STALE) {
        palms[ev.pointerId] = Date.now();
        return;
      }
      touches[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(touches);
      if (ids.length === 2) {
        var a = touches[ids[0]], b = touches[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      }
      /* A finger scrolls unless it has been told to write. It used to be the
         other way about until a pen had been seen at least once, which meant the
         first swipe of every session drew a line across the page. */
      if (tool.finger !== "write") return;
    }

    var pt = toLogical(ev);
    if (tool.mode === "erase") {
      snapshot(); rubbedFrom = null; eraseAt(pt); drawing = "erasing"; return;
    }
    if (sel && inSelection(pt.x, pt.y)) { snapshot(); dragging = { x: pt.x, y: pt.y }; return; }
    if (tool.mode === "lasso") { clearSelection(); lasso = [[pt.x, pt.y]]; return; }

    clearSelection();
    drawing = { c: tool.color, w: tool.width, hl: tool.mode === "hl",
                pts: [[pt.x, pt.y, pt.p]], _sx: pt.x, _sy: pt.y, _sp: pt.p,
                _touch: ev.pointerType === "touch" };
    livePainted = 0;     /* nothing of this stroke is on the canvas yet */
  });

  sheet.addEventListener("pointermove", function (ev) {
    if (ev.pointerType === "pen") lastPenAt = Date.now();
    if (isPalm(ev)) return;
    if (touches[ev.pointerId]) {
      var prev = touches[ev.pointerId];
      touches[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(touches);
      /* The heel of a hand is a touch. With a finger set to scroll it would drag
         the canvas out from under the nib mid-word, so anything the hand does is
         ignored for a moment after the pen last reported. */
      if (handAtWork()) return;
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
    /* Past the pan and pinch handling: a finger that is not allowed to write has
       nothing further to do here. A mouse still draws -- this is about hands. */
    if (ev.pointerType === "touch" && tool.finger !== "write") return;

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
    if (drawing === "erasing") {
      /* Every sample the hardware took, not one per frame: the sweep follows the
         path the hand actually made rather than the chords between frames. */
      var rubs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (var u = 0; u < rubs.length; u++) eraseAt(toLogical(rubs[u]));
      return;
    }
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

  /* The nominal page follows the writing outwards. `w` and `h` are what another
     device scales to fit on arrival and what the ruling is spaced from, so they
     have to mean something once the plane is being used; they are the extent of
     the page, not a boundary on it. Ink at negative coordinates is allowed and
     is carried by the strokes themselves -- the export is cropped to the ink, so
     nothing written above or left of the origin is lost. */
  function grow(st) {
    var p = page();
    if (!p || !st || !st.pts) return;
    var w = p.w, h = p.h;
    for (var i = 0; i < st.pts.length; i++) {
      if (st.pts[i][0] > w) w = st.pts[i][0];
      if (st.pts[i][1] > h) h = st.pts[i][1];
    }
    p.w = Math.ceil(w);
    p.h = Math.ceil(h);
  }

  function endStroke(ev) {
    if (ev && ev.pointerType === "pen") penDown = false;
    if (isPalm(ev)) { delete palms[ev.pointerId]; return; }
    if (ev && ev.pointerType === "pen") delete palms[ev.pointerId];
    /* fall through: a contact that was never a palm ends normally */
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
    rubbedFrom = null;
    if (drawing !== "erasing" && drawing.pts.length) {
      snapshot();
      delete drawing._sx; delete drawing._sy; delete drawing._sp;
      drawing.pts = polish(drawing.pts, POLISH);
      drawing.dense = null;
      delete drawing._built;
      livePainted = 0;
      page().strokes.push(drawing);
      grow(drawing);
    }
    drawing = null;
    invalidate();
    markDirty();
  }
  sheet.addEventListener("pointerup", endStroke);
  sheet.addEventListener("pointercancel", endStroke);
  sheet.addEventListener("pointerleave", endStroke);
  /* The last word on whether the pen is still down belongs to the window, not
     to the canvas. A nib lifted past the edge of the surface, or an app sent to
     the background mid-stroke, never delivers a pointerup to the sheet -- and
     that lift is the only thing that gives a hand the surface back. */
  ["pointerup", "pointercancel"].forEach(function (t) {
    window.addEventListener(t, function (ev) {
      if (ev.pointerType === "pen") penDown = false;
    }, true);
  });
  window.addEventListener("blur", function () { penDown = false; });
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
  /* A picture of the writing, not of the plane.
     
     This used to rasterise the whole page at one device pixel per logical unit,
     which was fine only because the page was the size of the screen. On an
     unbounded canvas that is unbounded work and an unbounded upload -- and it is
     also the wrong image: a tutor asked to read three lines of algebra should
     not be handed an acre of blank paper to find them on.

     So the image is the ink's bounding box plus a margin, and then scaled down
     if that is still large. Cost is proportional to how much was written, not to
     how far the canvas reaches, which is what makes the infinite canvas free to
     hand in. */
  function pngBox(p) {
    var b = inkBoxOf(p);
    if (!b) return { x0: 0, y0: 0, w: Math.max(1, p.w), h: Math.max(1, p.h), s: 1 };
    var x0 = b.x0 - PNG_PAD, y0 = b.y0 - PNG_PAD;
    var w = (b.x1 - b.x0) + PNG_PAD * 2, h = (b.y1 - b.y0) + PNG_PAD * 2;
    var s = Math.min(1, PNG_MAX_EDGE / Math.max(w, h));
    if (w * s * h * s > PNG_MAX_AREA) s = Math.sqrt(PNG_MAX_AREA / (w * h));
    return { x0: x0, y0: y0, w: w, h: h, s: s };
  }

  /* The same measurement as inkBox, for an arbitrary page rather than the
     current one -- toPNG is handed the page to export and the cache belongs to
     whichever page is on screen. */
  function inkBoxOf(p) {
    if (!p || !p.strokes || !p.strokes.length) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    p.strokes.forEach(function (st) {
      var pad = (st.w || 1) * (st.hl ? 3 : 1);
      for (var i = 0; i < st.pts.length; i++) {
        var q = st.pts[i];
        if (q[0] - pad < x0) x0 = q[0] - pad;
        if (q[0] + pad > x1) x1 = q[0] + pad;
        if (q[1] - pad < y0) y0 = q[1] - pad;
        if (q[1] + pad > y1) y1 = q[1] + pad;
      }
    });
    return x1 > x0 ? { x0: x0, y0: y0, x1: x1, y1: y1 } : null;
  }

  function toPNG(p) {
    var box = pngBox(p);
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(box.w * box.s));
    c.height = Math.max(1, Math.round(box.h * box.s));
    var g = c.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    /* Logical units from here on: the crop and the scale are in the transform,
       so the stroke painter and the ruling need to know nothing about either. */
    g.setTransform(box.s, 0, 0, box.s, -box.x0 * box.s, -box.y0 * box.s);
    if (tool.rule !== "plain") {
      var step = ruleStep(p);
      g.strokeStyle = "#eef1f4";
      g.lineWidth = 1 / box.s;
      g.beginPath();
      var yEnd = box.y0 + box.h, xEnd = box.x0 + box.w;
      for (var y = Math.ceil(box.y0 / step) * step; y < yEnd; y += step) {
        g.moveTo(box.x0, y); g.lineTo(xEnd, y);
      }
      if (tool.rule === "grid") {
        for (var x = Math.ceil(box.x0 / step) * step; x < xEnd; x += step) {
          g.moveTo(x, box.y0); g.lineTo(x, yEnd);
        }
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
    changeSeq++;
    dropInk();          /* the writing moved, so its extent did */
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

  /* One save on the wire at a time, and a count of how many times the page has
     changed.

     Two things were wrong here, and both of them lose ink quietly, which is the
     one thing this must not do. A save builds its body when it is CALLED, so two
     overlapping autosaves are two different versions of the same page racing
     each other to the disk -- and the version that lands is whichever the server
     happens to write second, which on a flaky link is regularly the older and
     smaller one. `board.log` showed it plainly: 111 strokes saved, then 106,
     then 111 again. And any save completing cleared `dirty`, so once a stale one
     had landed last, nothing scheduled another and the disk kept the smaller
     page for good.

     So: never two in flight, and `dirty` is only cleared if the page has not
     changed since the body went out. */
  var saving = null;
  var pendingSave = false;
  var changeSeq = 0;

  function save(send, quiet) {
    if (saving) {
      /* An autosave can simply wait its turn: the next one carries everything
         this one would have. A send is a person pressing a button and has to
         actually happen, so it queues behind what is already going. */
      if (!send) { pendingSave = true; return saving; }
      return saving.then(function () { return save(send, quiet); });
    }
    var p = page();
    var at = changeSeq;
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
    var done = fetch("/slate/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); }).then(function (res) {
      /* Only if nothing was written while this was in the air. Otherwise the
         page on disk is already behind the page in hand, and saying "saved" is
         a lie that stops the next save from happening. */
      if (changeSeq === at) {
        dirty = false;
        savedTag.classList.remove("busy");
        savedTag.textContent = send ? "sent" : "saved";
      }
      if (send) {
        lastLiveSend = Date.now();
        if (!quiet) toast(res && res.rev > 1 ? "answer updated" : "sent for review");
        if (opts.onSend) opts.onSend(res || {});
      }
    }).catch(function () {
      savedTag.classList.remove("busy");
      savedTag.textContent = "offline";
    });
    saving = done.then(function () {
      saving = null;
      if (pendingSave || changeSeq !== at) {
        pendingSave = false;
        save(false, true);
      }
    });
    return saving;
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
  bFit.onclick = fitContent;

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
  fingerBtns.forEach(function (b) {
    b.onclick = function () {
      tool.finger = b.dataset.finger === "write" ? "write" : "scroll";
      remember_(STORE_KEY, tool.finger);
      selectOne(fingerBtns, b);
      toast(tool.finger === "write" ? "a finger writes" : "a finger scrolls; the pen writes");
    };
  });
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
    dropInk();
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
    settled();
    var saved = (d.pages || []).filter(function (p) { return p && p.w && p.h; });
    if (!saved.length) return;
    /* Only adopt saved pages if nothing has been drawn in the meantime --
       whatever is under the pen wins over whatever the server remembered. */
    if (pages.length === 1 && !pages[0].strokes.length) {
      pages = saved;
      current = pages.length - 1;
      dropInk();
      layout();
      fitPage();
    }
    savedTag.textContent = "saved";
  }).catch(function () { settled(); /* offline is fine; the page still works */ });

  /* Whether the saved pages have arrived -- either they did, or the request
     failed and this blank page is all there is going to be.

     The single blank page above is what makes the surface usable before the
     network answers, and it is a lie about how many pages there are for as long
     as it stands. The board reads that count to decide which page a question
     belongs on, so believing it cost a page mapping: a question recorded against
     page 3 looks like a question recorded past the end, the board rules the page
     gone, cuts a fresh one, and writes THAT down -- so a reload silently refiled
     every question onto page 0 and the working of a whole evening ended up on one
     sheet with the mapping to it destroyed. Nothing is lost that a person can
     see, which is why it survived: the accident looked like continuity.

     So: say when the count can be trusted, and let the board wait. */
  function settled() {
    if (loaded) return;
    loaded = true;
    if (typeof opts.onPages === "function") {
      try { opts.onPages(); } catch (e) { /* the board's problem, not ours */ }
    }
  }
  api.ready = function () { return loaded; };

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
  /* How much is on the current page. The host needs it to tell an answer from an
     empty surface -- tapping Send with nothing written should not hand the tutor
     a blank sheet. `debug` reports this too, but a name with "debug" in it is
     not something behaviour should depend on. */
  api.strokes = function () { var p = page(); return p ? p.strokes.length : 0; };
  /* The plane, the crop and the finger rule, so all three can be asserted --
     none of them is visible from the outside otherwise, and the last time a
     surface behaviour was untestable it shipped broken for two days. */
  /* Is a hand in the middle of something. The board asks before it moves the
     page: a card arriving while somebody is drawing a diagram is not a reason to
     scroll the diagram out from under them. The tail is generous on purpose --
     the gap between two words of a proof is longer than it feels. */
  api.busy = function () {
    return !!drawing || !!lasso || !!dragging || penDown ||
           (Date.now() - lastPenAt < 2500);
  };
  /* Which tool is in hand. Reading it is for the chrome; setting it is for
     tests, which otherwise have to reach into the toolbar and click a button to
     exercise the rubber. */
  api.tool = function (v) {
    var modes = ["pen", "hl", "erase", "lasso"];
    var i = modes.indexOf(v);
    if (i !== -1) {
      var buttons = [bPen, bHl, bEr, bLa];
      if (buttons[i] && buttons[i].onclick) buttons[i].onclick();
      else tool.mode = v;
    }
    return tool.mode;
  };
  api.reach = reach;
  api.inkBox = inkBox;
  api.pngBox = function () { return pngBox(page()); };
  api.finger = function (v) {
    if (v === undefined) return tool.finger;
    tool.finger = v === "write" ? "write" : "scroll";
    remember_(STORE_KEY, tool.finger);
    fingerBtns.forEach(function (b) {
      b.classList.toggle("sel", b.dataset.finger === tool.finger);
    });
    return tool.finger;
  };
  api.view = function () { return { k: view.k, fit: view.fit, ox: view.ox, oy: view.oy }; };
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
    dropInk();
    clearSelection();
    invalidate();
    fitPage();
    return true;
  };
  /* Pages, from outside.

     The board keeps one page per question, so that answering a new question
     never destroys the working on the old one. It used to call `clear` for that
     -- which is a page of somebody's proof, deleted, because the tutor asked
     something else. */
  api.pages = function () { return pages.length; };
  api.at = function () { return current; };
  api.go = function (n) {
    if (n === current || n < 0 || n >= pages.length) return current;
    goTo(n);
    return current;
  };
  /* A new blank page at the end, and go to it. Returns its index, which is what
     the host records against the question it belongs to. */
  api.fresh = function () {
    if (pages.length && !pages[pages.length - 1].strokes.length) {
      goTo(pages.length - 1);
      return current;
    }
    pages.push(blankPage());
    goTo(pages.length - 1);
    return current;
  };
  api.inkOn = function (n) {
    var p = pages[n === undefined ? current : n];
    return p ? p.strokes.length : 0;
  };
  /* A picture of a page, drawn by the code that draws the live surface.

     This is what lets every question look like it has its own writing surface
     while only ONE is ever live. A live surface is two canvases at device
     resolution -- the sheet and its cache -- which on an iPad is about
     seventeen megabytes each, and iPadOS does not report a canvas budget being
     exceeded so much as act on it: blank canvases, or the tab reloading. A dozen
     of them is not a slow board, it is a board that loses your working.

     So a dormant board is a picture: drawn once, at CSS resolution rather than
     device resolution because nothing is going to be zoomed into it, handed over
     as a data URL and the canvas thrown away in the same breath. The transform
     is the one `fitPage` computes, so a dormant board is framed exactly as the
     live one frames a page it has just opened. */
  api.preview = function (n, cssW, cssH) {
    var p = pages[n];
    if (!p || !(cssW > 0) || !(cssH > 0)) return "";
    var c = document.createElement("canvas");
    c.width = Math.round(cssW);
    c.height = Math.round(cssH);
    var g = c.getContext("2d");
    if (!g) return "";
    var k = cssW / p.w;
    var drawn = p.h * k;
    var oy = drawn < cssH ? (cssH - drawn) / 2 : 0;
    var skin = PAPERS[tool.paper];
    g.setTransform(k, 0, 0, k, 0, oy);
    var x0 = 0, y0 = -oy / k, x1 = cssW / k, y1 = y0 + cssH / k;
    g.fillStyle = skin.bg;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (tool.rule !== "plain") {
      var step = ruleStep(p);
      g.strokeStyle = skin.rule;
      g.lineWidth = 1 / k;
      g.beginPath();
      for (var y = Math.ceil(y0 / step) * step; y < y1; y += step) {
        g.moveTo(x0, y); g.lineTo(x1, y);
      }
      if (tool.rule === "grid") {
        for (var x = Math.ceil(x0 / step) * step; x < x1; x += step) {
          g.moveTo(x, y0); g.lineTo(x, y1);
        }
      }
      g.stroke();
    }
    var dark = tool.paper === "black";
    p.strokes.forEach(function (s) { if (s.hl) paintStroke(g, s, dark); });
    p.strokes.forEach(function (s) { if (!s.hl) paintStroke(g, s, dark); });
    var url = "";
    try { url = c.toDataURL("image/png"); } catch (e) { url = ""; }
    /* Painting a stroke caches its resampled curve. On the page in hand that is
       the point; on a page being photographed once it is memory held for nothing,
       and the pages not in hand are all of them. */
    if (n !== current) p.strokes.forEach(function (st) { st.dense = null; });
    c.width = c.height = 1;             /* let the pixels go now, not eventually */
    return url;
  };

  /* The live canvas, for a board going live under a pen that has already landed
     on it: the stroke is handed to this so its first sample is not lost. */
  api.sheet = function () { return sheet; };

  api.clear = function () {
    var p = page();
    if (!p) return;
    snapshot();
    p.strokes = [];
    dropInk();
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
  /* One question, one answer, both surfaces. The lesson's annotation layer had
     its own copy of the old pen-seen latch, so a finger drew on a card even
     after the slate had been told not to let it. */
  fingerWrites: function () { return remembered(STORE_KEY, "scroll") === "write"; },
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
