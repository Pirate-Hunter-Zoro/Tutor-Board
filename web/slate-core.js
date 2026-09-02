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
/* How long after the last mark the page's PICTURE is encoded. Longer than the
   autosave on purpose: the strokes are what a reload restores and they go at
   once, and the picture is a hundred-odd milliseconds of main thread that must
   never land under a pen. See `save`. */
var PICTURE_MS = 4000;
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
var FIT_PAD = 32;           /* ...and above it, when framing a page to open it */
var PNG_MAX_EDGE = 2000;    /* longest side of the image, in pixels */
var PNG_MAX_AREA = 2600 * 2600;
/* And the smaller cap an AUTOSAVE's picture is drawn to.

   The picture a SEND carries is what the tutor reads and what is frozen as the
   answer, and it keeps every pixel of the cap above. The one an autosave leaves
   on disk has no reader in the loop -- it is there so `board slate` and the
   archive have the handwriting of a page nobody sent -- and encoding it is a
   deflate over a couple of million pixels, on the main thread, in a gap between
   two things somebody is doing. At this cap that is about a quarter of the work
   and still a legible page of handwriting. */
var PNG_IDLE_EDGE = 1100;

/* Remembered per device, because it is a property of how somebody works and of
   what they are holding, not of a lesson. */
var STORE_KEY = "tutor-board.slate.finger";
/* And so is the paper. It is not a property of a lesson either -- it is what
   this person, on this device, in this light, can read their own handwriting on
   -- and it was the one such setting that forgot itself on every reload. That
   is not a cosmetic slip: EVERY board on the page is drawn with it, the live
   surface and the dozen photographs alike, so a reload silently repainted the
   whole sitting in the other scheme. Reported from the iPad mid-proof, as
   boards whose "color is inverted". */
var PAPER_KEY = "tutor-board.slate.paper";
var RULE_KEY = "tutor-board.slate.rule";

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
  /* The paper this device was last set to, and an ink that can be seen on it.
     Colour has to come with it: the dark palette's first ink is near-white, and
     opening remembered white paper with it is a page you can write on and not
     read. */
  var paper0 = remembered(PAPER_KEY, "black");
  if (PAPER_ORDER.indexOf(paper0) === -1) paper0 = "black";
  var rule0 = remembered(RULE_KEY, "plain");
  if (RULE_ORDER.indexOf(rule0) === -1) rule0 = "plain";
  var tool = { mode: "pen", width: 3.2,
               color: (paper0 === "black" ? PALETTE_DARK : PALETTE_LIGHT)[0],
               paper: paper0, rule: rule0, live: false,
               finger: remembered(STORE_KEY, "scroll") === "write" ? "write" : "scroll" };
  var drawing = null, lasso = null, sel = null, dragging = null;
  var dirty = false, lastLiveSend = 0;
  /* Which pages have ink that is not on disk yet, and how many times each has
     changed. Not a single flag, because the page under the pen can change
     without anybody touching the page controls: a board freezing and its
     successor opening is a page switch that happens on a payload, in the middle
     of somebody writing. A save built its body from `current` at the moment the
     request went out, so a switch while one was in flight left the outgoing
     page's last strokes with nothing to carry them -- the queued save that
     followed carried the NEW page instead, and the old one kept whatever it had
     the time before. */
  var dirtyPages = Object.create(null);
  var pageSeq = Object.create(null);
  /* When the pen last reported anything. A palm resting on the glass is a touch
     like any other, and with a finger set to scroll it would drag the canvas out
     from under the nib. Touch panning is therefore ignored for a moment after
     any pen activity -- which is what palm rejection actually is. */
  var lastPenAt = 0;
  /* When a finger last did something -- panning, pinching, resting. Only used to
     keep expensive work out of the way of a gesture. */
  var lastHandAt = 0;
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

  /* Is a hand in the middle of something, generously. The board asks before it
     moves the page under somebody, and `save` asks before it spends a hundred
     milliseconds encoding a picture. The tail is long on purpose: the gap
     between two words of a proof is longer than it feels. */
  function handBusy() {
    return !!drawing || !!lasso || !!dragging || penDown ||
           (Date.now() - lastPenAt < 2500) ||
           /* A finger too. It is not writing, but it is panning and pinching --
              and a hundred milliseconds of PNG encoding landing in the middle of
              that is a scroll that stutters. Reported straight after the pen
              delay: "scrolling via finger on the writing pad is a little delayed
              after erasing, too". */
           (Date.now() - lastHandAt < 1200);
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

  /* A step on the undo stack is the LIST of strokes, not a copy of them.

     It used to be `JSON.stringify(page().strokes)` -- the whole page serialised,
     on every pen lift and on every touch of the rubber. On a page holding an
     evening's proof that is three hundred kilobytes of JSON built at the exact
     moment a hand is asking the surface to do something, and sixty of them on
     the stack is eighteen megabytes of strings on a tablet. Reported as the
     first stroke of the rubber being slow, and as a general lateness on putting
     the pen down: the lift of one stroke was paying for a copy of the page
     before the next one could start.

     What makes a shallow list correct is that a stroke on the page is never
     changed in place. Anything that would change one -- dragging a selection,
     recolouring it -- replaces it with a copy first and changes THAT (`fork`
     below), so a step taken before the change still points at what was there.
     `dense` and `_bb` are caches rather than content and may be dropped on any
     stroke at any time. Break that rule and undo silently stops undoing. */
  function snapshot() {
    undoStack.push(page().strokes.slice());
    if (undoStack.length > UNDO_DEPTH) undoStack.shift();
    redoStack.length = 0;
  }

  function restoreFrom(from, to) {
    if (!from.length) return;
    to.push(page().strokes.slice());
    page().strokes = from.pop();
    clearSelection();
    invalidate();
    markDirty();
  }

  /* One stroke, replaced by a copy of itself, so it can be changed without
     changing what the undo stack is holding. Returns the copy, which is now the
     one on the page. */
  function fork(i) {
    var p = page();
    var s = p.strokes[i];
    if (!s) return null;
    var c = { c: s.c, w: s.w, hl: !!s.hl,
              pts: s.pts.map(function (q) { return q.slice(); }) };
    p.strokes[i] = c;
    return c;
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
    /* A page shorter than the surface is centred. A taller one starts where the
       writing does -- which is NOT the top of the page.

       It used to start at the top, on the reasoning that the top is "where the
       writing begins". That is true of a fresh page and false of every page
       somebody has worked down. This surface is a plane: you pan down and carry
       on, and the page box grows to hold what you wrote, so on a real page of
       an evening's homework the ink began 769 units down a box 1514 tall and the
       top of it was blank paper. Opening that page showed the blank paper.
       Reported as the working having disappeared off the boards, which from the
       other side of the glass is exactly what it looks like -- and it took
       reading the stroke coordinates to see that nothing had been lost at all.

       The scale is untouched: still the page width, which is what makes
       handwriting come out the size it was written at. Only the parking is
       different. */
    var h = p.h * view.k;
    if (h < wrap.clientHeight) {
      view.oy = (wrap.clientHeight - h) / 2;
    } else {
      var b = inkBox();
      view.oy = b ? -Math.max(0, b.y0 - FIT_PAD) * view.k : 0;
    }
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
  /* A scroll is a hand at work, wherever on the page it started.

     The lesson scrolls with a finger and the board is only part of that page, so
     "is a hand busy" cannot be answered from the writing surface alone -- and
     the answer matters, because a hundred milliseconds of PNG encoding landing
     in the middle of a flick is a lesson that stutters as it goes past.
     Reported in exactly that shape: "after I've erased or written on the board,
     trying to scroll up outside of the board to see earlier tutor-responses is
     laggy". Every one of these is one assignment; the work they defer is four
     orders of magnitude more than that. */
  function handMoved() { lastHandAt = Date.now(); }
  window.addEventListener("scroll", function () {
    dropRect();
    handMoved();
  }, true);
  window.addEventListener("resize", dropRect);
  ["touchstart", "touchmove", "pointerdown"].forEach(function (t) {
    try {
      document.addEventListener(t, handMoved, { capture: true, passive: true });
    } catch (e) {
      document.addEventListener(t, handMoved, true);
    }
  });

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
    paintStrokes(cacheCtx, p, seenBox(), tool.paper === "black");
    cacheValid = true;
    repairBox = null;                 /* everything is fresh; nothing is owed */
  }

  /* What the rubber took out, in logical units, waiting to be repaired out of
     the cache. Erasing used to throw the whole cache away for every sample the
     hardware reported -- so a page holding an evening's proof repainted several
     hundred strokes, several times a frame, for a gesture that touched a word.
     That is the main thread gone, and from behind a pen it reads as the surface
     answering late: the samples were all captured, and nothing could paint them.
     Reported as a delay on putting the pen down, "especially if I've just erased
     something". */
  var repairBox = null;

  /* Where one stroke is, cached on the stroke.

     Cheap to compute and asked for on every repaint, which is why it is kept:
     the alternative is walking every point of every stroke on the page, sixty
     times a second, to decide what not to draw. Cleared wherever points MOVE --
     which is dragging a selection and pasting one, and nowhere else, because
     every other route replaces the stroke object outright. */
  function boxOf(s) {
    if (s._bb) return s._bb;
    if (!s.pts || !s.pts.length) return null;
    var pad = (s.w || 1) * (s.hl ? 3.5 : 1.5) + 2;
    var x0 = s.pts[0][0], y0 = s.pts[0][1], x1 = x0, y1 = y0;
    for (var i = 1; i < s.pts.length; i++) {
      var q = s.pts[i];
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[1] > y1) y1 = q[1];
    }
    s._bb = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    return s._bb;
  }

  function widen(box, s) {
    var b = boxOf(s);
    if (!b) return box;
    if (!box) return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
    if (b.x0 < box.x0) box.x0 = b.x0;
    if (b.y0 < box.y0) box.y0 = b.y0;
    if (b.x1 > box.x1) box.x1 = b.x1;
    if (b.y1 > box.y1) box.y1 = b.y1;
    return box;
  }

  /* Slack around a cull, in logical units. A stroke is bounded by its own
     samples; the curve drawn through them is allowed to bow outside that hull,
     and the line has width. Being generous here costs a stroke or two painted
     just off the edge of the glass and buys never culling one that would have
     shown. */
  var CULL_PAD = 64;

  function overlaps(box, s) {
    var b = boxOf(s);
    return !!b && b.x0 - CULL_PAD <= box.x1 && b.x1 + CULL_PAD >= box.x0
                && b.y0 - CULL_PAD <= box.y1 && b.y1 + CULL_PAD >= box.y0;
  }

  /* The strokes of a page, highlighter first so a marker sits under the ink it
     is marking, and only the ones that can be SEEN.

     A page is a plane and grows downward as it is worked, so by the end of an
     exercise most of what is on it is a screen or more away -- and every full
     repaint used to draw all of it. That is the cost of a pan: one finger moving
     changes the view, the view is baked into the cache, so the cache is rebuilt,
     and rebuilding it drew four hundred strokes to show forty. Reported as
     scrolling being delayed after erasing, which is the same repaint from the
     other side. */
  function paintStrokes(g, p, box, dark) {
    p.strokes.forEach(function (s) {
      if (s.hl && (!box || overlaps(box, s))) paintStroke(g, s, dark);
    });
    p.strokes.forEach(function (s) {
      if (!s.hl && (!box || overlaps(box, s))) paintStroke(g, s, dark);
    });
  }

  /* What is on the glass right now, in logical units. */
  function seenBox() {
    var x0 = -view.ox / view.k, y0 = -view.oy / view.k;
    return { x0: x0, y0: y0,
             x1: x0 + wrap.clientWidth / view.k,
             y1: y0 + wrap.clientHeight / view.k };
  }

  /* Repaint one rectangle of the cache instead of all of it.

     Erasing removes whole strokes, so the area that has to be redrawn is the
     union of what those strokes covered -- usually a word, occasionally a line,
     and only in the worst case the page, where this costs what the old code cost
     every time. Clipped, so the paper and the surviving strokes inside the box
     paint over the hole and nothing outside it is touched. */
  function repairCache(box) {
    var p = page();
    if (!p || !box) return;
    var d = dpr();
    cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
    cacheCtx.save();
    var x = box.x0 * view.k + view.ox, y = box.y0 * view.k + view.oy;
    cacheCtx.beginPath();
    cacheCtx.rect(x * d, y * d,
                  (box.x1 - box.x0) * view.k * d, (box.y1 - box.y0) * view.k * d);
    cacheCtx.clip();
    cacheCtx.setTransform(d * view.k, 0, 0, d * view.k, d * view.ox, d * view.oy);
    paintPaper(cacheCtx, p, view.k);
    paintStrokes(cacheCtx, p, box, tool.paper === "black");
    cacheCtx.restore();
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
    if (!drawing.dense || !drawing.dense.length) return;
    var d = dpr();
    ctx.setTransform(d * view.k, 0, 0, d * view.k, d * view.ox, d * view.oy);
    /* The single point the pen landed on, on the first frame of the stroke.
       `paintStroke` draws a one-point stroke as the dot it is. */
    if (!drawing._dot) {
      drawing._dot = true;
      if (drawing.dense.length === 1) {
        paintStroke(ctx, drawing, tool.paper === "black");
        return;
      }
    }
    if (drawing.dense.length <= livePainted + 1) return;
    paintStroke(ctx, drawing, tool.paper === "black", livePainted + 1);
    livePainted = drawing.dense.length - 1;
  }

  function draw() {
    if (!page()) return;
    if (!cacheValid) rebuildCache();
    else if (repairBox) { repairCache(repairBox); repairBox = null; }
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
    var took = null;
    p.strokes = p.strokes.filter(function (s) {
      for (var i = 0; i < s.pts.length; i++) {
        if (distToSeg(s.pts[i][0], s.pts[i][1], a.x, a.y, pt.x, pt.y) < r * r) {
          took = widen(took, s);
          return false;
        }
      }
      return true;
    });
    rubbedFrom = pt;
    if (p.strokes.length !== before) {
      /* Only where the ink was. `repairBox` is drained once a frame, not once a
         sample, so a swipe that reports twenty samples costs one repaint of the
         area it covered rather than twenty repaints of the page. */
      if (took) {
        repairBox = repairBox ? { x0: Math.min(repairBox.x0, took.x0),
                                  y0: Math.min(repairBox.y0, took.y0),
                                  x1: Math.max(repairBox.x1, took.x1),
                                  y1: Math.max(repairBox.y1, took.y1) } : took;
        schedule();
      } else {
        invalidate();
      }
      markDirty();
    }
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
      lastHandAt = Date.now();
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
    /* Except the nib's own mark, which goes down NOW.

       The curve needs three samples before it can produce a single point of
       resampled line, and samples closer together than `MIN_STEP` are dropped --
       so a pen put down and moved slowly, which is what starting a letter looks
       like, painted nothing at all until it had travelled a pixel or two. From
       behind a pen that is indistinguishable from the surface being slow to
       answer, and it is the other half of what was reported as a delay on
       tapping to write. The dot is where the pen is; the curve catches up on the
       frames after it.

       Seeded rather than left to `extendLive`, which pushes exactly this point
       as the first thing it does -- so this is the same first point, one frame
       earlier, and nothing is drawn twice. */
    drawing.dense = [[pt.x, pt.y, pt.p]];
    drawing._built = 0;
    schedule(true);
  });

  sheet.addEventListener("pointermove", function (ev) {
    if (ev.pointerType === "pen") lastPenAt = Date.now();
    else if (ev.pointerType === "touch") lastHandAt = Date.now();
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
      sel.idx.forEach(function (i) {
        /* Forked once, on the first frame of the drag: after that these are
           copies nothing else is holding, and moving them is free. */
        var s = dragging.forked ? page().strokes[i] : fork(i);
        if (!s) return;
        s.dense = null;
        s._bb = null;                 /* it has moved; so has its box */
        for (var n = 0; n < s.pts.length; n++) { s.pts[n][0] += dx; s.pts[n][1] += dy; }
      });
      dragging.forked = true;
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
      delete drawing._dot;
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
        s._bb = null;
        s.pts.forEach(function (q) { q[0] += 30; q[1] += 30; });
        p.strokes.push(s);
      });
      sel = { idx: p.strokes.slice(start).map(function (_, n) { return start + n; }) };
      invalidate(); markDirty();
    },
    duplicate: function () { ACTIONS.copy(); ACTIONS.paste(); },
    colour: function () {
      snapshot();
      sel.idx.forEach(function (i) {
        var s = fork(i);
        if (s) s.c = tool.color;
      });
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
  function pngBox(p, edge) {
    var cap = edge || PNG_MAX_EDGE;
    var b = inkBoxOf(p);
    if (!b) return { x0: 0, y0: 0, w: Math.max(1, p.w), h: Math.max(1, p.h), s: 1 };
    var x0 = b.x0 - PNG_PAD, y0 = b.y0 - PNG_PAD;
    var w = (b.x1 - b.x0) + PNG_PAD * 2, h = (b.y1 - b.y0) + PNG_PAD * 2;
    var s = Math.min(1, cap / Math.max(w, h));
    var area = PNG_MAX_AREA * (cap / PNG_MAX_EDGE) * (cap / PNG_MAX_EDGE);
    if (w * s * h * s > area) s = Math.sqrt(area / (w * h));
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

  function toPNG(p, edge) {
    var box = pngBox(p, edge);
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
    dirtyPages[current] = true;
    pictureOwed[current] = true;
    armPicture();
    pageSeq[current] = (pageSeq[current] || 0) + 1;
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
  var changeSeq = 0;

  /* Which pages owe the disk a fresh PICTURE, as opposed to fresh strokes.

     Every save used to encode one: `toPNG` builds an offscreen canvas of the
     whole page, repaints every stroke on it and PNG-encodes the result, and that
     ran about a second after every stroke, for a page that by the end of an
     exercise holds four hundred of them. It is the same defect this repository
     already fixed in the annotation layer, in the place where it costs more --
     hundreds of milliseconds of blocked main thread, arriving one second after
     the pen stopped, which is roughly when a hand comes back to write the next
     line. Reported as a delay on putting the pen down.

     Nothing needs it that soon. What a reload restores is the strokes; the
     picture is read by `board slate`, by the archive, and -- the one that must
     be exact -- by a send, which copies it as the frozen answer. So a send
     always encodes, and an autosave encodes only once the hand is off the
     glass. */
  var pictureOwed = {};
  var pictureTimer = null;
  var leaving = false;

  function armPicture() {
    clearTimeout(pictureTimer);
    pictureTimer = setTimeout(function () {
      pictureTimer = null;
      /* Still writing: come back. A page whose picture is owed is a page whose
         strokes are already safely on disk, so there is nothing to hurry. */
      if (handBusy()) return armPicture();
      for (var k in pictureOwed) { save(false, true, Number(k)); }
    }, PICTURE_MS);
  }

  /* Retrying a save the network refused. One timer, because every page that is
     owed is in `dirtyPages` and one round drains all of them; and a backoff,
     because a board that is down is usually down for more than a second. */
  var retry = { at: null, wait: 1000, send: false, quiet: true, idx: null };

  function retryLater(send, quiet, idx) {
    retry.send = retry.send || !!send;      /* a send owed stays owed */
    retry.quiet = quiet;
    retry.idx = idx;
    if (retry.at) return;
    retry.at = setTimeout(function () {
      retry.at = null;
      retry.wait = Math.min(retry.wait * 2, 15000);
      var wasSend = retry.send;
      retry.send = false;
      save(wasSend, retry.quiet, retry.idx);
    }, retry.wait);
  }

  function retryDone() {
    if (retry.at) { clearTimeout(retry.at); retry.at = null; }
    retry.wait = 1000;
    retry.send = false;
  }

  /* A page that still owes the disk something. The one in hand first, because
     that is the one being written on. */
  function nextDirty() {
    if (dirtyPages[current]) return current;
    for (var k in dirtyPages) return Number(k);
    return null;
  }

  function save(send, quiet, which) {
    var idx = (which === undefined || which === null) ? current : which;
    if (saving) {
      /* An autosave can simply wait its turn -- `dirtyPages` is the queue, and
         it remembers WHICH pages are owed rather than assuming it is whichever
         one happens to be in hand when the wire is free again. A send is a
         person pressing a button and has to actually happen, so it queues
         behind what is already going, on the page it was pressed for. */
      if (!send) return saving;
      return saving.then(function () { return save(send, quiet, idx); });
    }
    var p = pages[idx];
    if (!p) return Promise.resolve();
    var at = pageSeq[idx] || 0;
    savedTag.classList.add("busy");
    /* A send has to carry the picture -- it is copied into `live/answers/` as
       the frozen answer, and that must be what was handed in. Leaving carries it
       too, because there is no later moment to encode it in. Otherwise: only
       when the hand is off the glass. */
    var withPicture = !!send || leaving || !handBusy();
    if (withPicture) delete pictureOwed[idx];
    else armPicture();
    var body = { page: idx + 1, w: p.w, h: p.h,
                 strokes: p.strokes.map(stripDense),
                 png: withPicture ? toPNG(p, send ? 0 : PNG_IDLE_EDGE) : "",
                 send: !!send,
                 pages: pages.length };
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
      retryDone();
      if ((pageSeq[idx] || 0) === at) {
        delete dirtyPages[idx];
        if (idx === current) {
          dirty = false;
          savedTag.classList.remove("busy");
          savedTag.textContent = send ? "sent" : "saved";
        }
      }
      if (send) {
        lastLiveSend = Date.now();
        if (!quiet) toast(res && res.rev > 1 ? "answer updated" : "sent for review");
        if (opts.onSend) opts.onSend(res || {});
      }
    }).catch(function () {
      /* A failed save is not a state to sit in, and "offline" as a permanent
         label beside the send button is the worst way to report it: the page
         still owes the disk its strokes, nothing is retrying, and the word does
         not go away when the connection comes back. Reported from the board with
         the tutor plainly listening at the top of the same screen — the board
         had been flickering, one save fell into the gap, and the label stayed
         for the rest of the sitting.
   
         So: say what is true, keep the page dirty (it already is), and RETRY,
         backing off to fifteen seconds. Whatever succeeds next clears it. */
      savedTag.classList.remove("busy");
      savedTag.textContent = send ? "not sent — retrying" : "not saved — retrying";
      retryLater(send, quiet, idx);
    });
    saving = done.then(function () {
      saving = null;
      /* A retry owns the queue until it lands. Without this the drain below
         re-saves the page that just failed, immediately, for ever: the failure
         leaves it dirty (correctly — it still owes the disk), `nextDirty` hands
         it straight back, and the next attempt fails the same way with nothing
         between them. A board on a dead link was a tight loop hammering a socket
         that was not there, which is also why the tag never had a chance to say
         anything useful. */
      if (retry.at) return;
      var next = nextDirty();
      if (next !== null) save(false, true, next);
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
      remember_(PAPER_KEY, tool.paper);
      selectOne(paperBtns, b);
      root.dataset.paper = tool.paper;
      renderPalette();
      /* Keep the ink visible: a colour chosen for slate is invisible on white. */
      var list = tool.paper === "black" ? PALETTE_DARK : PALETTE_LIGHT;
      if (PALETTE_DARK.concat(PALETTE_LIGHT).indexOf(tool.color) !== -1) {
        pickInk(list[0], inkButtons[0]);
      }
      /* Repaint, and nothing more. This used to mark the page dirty, which is a
         whole page re-encoded and posted for a change that is not ON the page:
         the paper is a property of this device, the file holds `w`, `h` and
         strokes, and the PNG is white whatever the screen shows. */
      invalidate();
      if (opts.onPaper) opts.onPaper(tool.paper);
    };
  });
  ruleBtns.forEach(function (b) {
    b.onclick = function () {
      tool.rule = b.dataset.rule;
      remember_(RULE_KEY, tool.rule);
      selectOne(ruleBtns, b);
      invalidate();
      if (opts.onPaper) opts.onPaper(tool.paper);
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
    /* The page being left keeps its own claim on the disk. Naming it matters:
       if a save is already in flight this one is queued, and the queue used to
       carry "whatever is current when the wire frees up", which by then is the
       page being moved TO. */
    if (dirtyPages[current]) save(false, true, current);
    current = n;
    dropInk();
    undoStack.length = 0; redoStack.length = 0;
    clearSelection();
    fitPage();
  }

  /* Anything a hand does to the surface or to its toolbar pushes the picture
     back. Switching tools is a tap, and a tap followed immediately by a
     hundred milliseconds of PNG encoding is a toolbar that feels stuck --
     reported in those words: "after I erase, and tap to switch to pen, it's
     laggy". Nothing here has to happen in any particular second. */
  [root, barHost].forEach(function (host) {
    if (!host || !host.addEventListener) return;
    host.addEventListener("pointerdown", function () {
      lastHandAt = Date.now();
      if (pictureTimer) armPicture();
    }, true);
  });

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
  window.addEventListener("beforeunload", function () {
    leaving = true;
    var owed = nextDirty();
    if (owed === null) { for (var k in pictureOwed) { owed = Number(k); break; } }
    if (owed !== null) save(false, true, owed);
  });

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
    /* Only adopt saved pages if nothing has been drawn in the meantime --
       whatever is under the pen wins over whatever the server remembered.

       "Nothing drawn" is about INK, not about the number of sheets. It used to
       be `pages.length === 1`, which is the same thing only for as long as
       nobody else can add a page -- and `settled()` used to run first, so the
       board was told the count was trustworthy while it was still the stand-in
       sheet, cut a page for the question it was on, and by doing so pushed the
       length to two. The whole evening on disk was then refused adoption: every
       board on the page a blank photograph, and the next stroke saved over a
       real page under its new number. A blank sheet must never be able to
       refuse a sitting. */
    var untouched = pages.every(function (p) { return !p.strokes.length; });
    if (saved.length && untouched) {
      pages = saved;
      current = pages.length - 1;
      dropInk();
      layout();
      fitPage();
    }
    if (saved.length) savedTag.textContent = "saved";
    /* Last, and it has to be last: this is what tells the board the count can
       be believed, and it can only be believed once the pages above are in. */
    settled();
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
  /* Is a hand on the glass right now?

     The board asks before it moves the page under somebody -- a board freezing
     and its successor opening is a page switch, and one that arrives mid-word
     takes the rest of the word with it. Nothing about the lesson has to happen
     in that particular second; the switch waits for the pen to come up. */
  api.writing = function () { return !!drawing || penDown; };
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
  api.busy = function () { return handBusy(); };
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
     the host records against the question it belongs to.

     `force` insists on a genuinely new one. Reusing a trailing blank page is
     right when it belongs to nobody and wrong when another question already
     owns it -- two questions handed the same sheet is not a tidiness problem,
     it is writing on one board and watching the other change. Only the host
     knows who owns what, so only the host can say. */
  api.fresh = function (force) {
    if (!force && pages.length && !pages[pages.length - 1].strokes.length) {
      goTo(pages.length - 1);
      return current;
    }
    pages.push(blankPage());
    goTo(pages.length - 1);
    return current;
  };

  /* The same page again, as a page of its own, and go to it.

     For a question that has been sharing a sheet with another one: it keeps
     what is on it -- the working does not vanish out from under anybody -- and
     from here the two go their own ways. Marked dirty so the copy reaches disk;
     a page that exists only in memory is a page that a reload turns back into
     nothing. */
  api.clone = function (n) {
    var src = pages[n];
    if (!src) return current;
    var copy = blankPage();
    copy.w = src.w;
    copy.h = src.h;
    copy.strokes = src.strokes.map(function (st) {
      var c = {};
      for (var k in st) { if (k !== "dense") c[k] = st[k]; }
      c.pts = st.pts.map(function (q) { return q.slice(); });
      return c;
    });
    pages.push(copy);
    goTo(pages.length - 1);
    markDirty();
    return current;
  };

  /* Put the writing back on screen. The toolbar's ⤢ does this; so does the
     board's own re-centre for the surface, which is the one that cannot be
     pinched off the glass. */
  api.fitInk = function () { fitContent(); };
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
    if (!p) return "";
    var url = shoot(p, cssW, cssH);
    /* Painting a stroke caches its resampled curve. On the page in hand that is
       the point; on a page being photographed once it is memory held for nothing,
       and the pages not in hand are all of them. */
    if (n !== current) p.strokes.forEach(function (st) { st.dense = null; });
    return url;
  };

  /* And a picture of ink that is not a page of this slate at all: the frozen
     copy of an answer, as it was handed in.

     A board under an old question used to show the answer's PNG, and that file
     is written for a different reader -- it is always dark ink on white, cropped
     to the writing, because its whole job is to be legible to whatever agent
     opens it. Dropped into the run of boards it read as exactly what it is: a
     white sheet among black ones, at the wrong magnification. "The color is
     inverted", from the iPad, mid-proof.

     The strokes were on disk the whole time (`live/answers/<turn>.json`, frozen
     beside the picture), so there is no need to show a picture drawn for
     somebody else. Drawn here by the same code, on the same paper, framed the
     same way, a frozen board is indistinguishable from a live one -- which is
     the whole rule this file's boards are built on. */
  api.previewInk = function (ink, cssW, cssH) {
    if (!ink || !ink.strokes || !ink.strokes.length) return "";
    var p = { w: ink.w || cssW, h: ink.h || cssH, strokes: ink.strokes };
    var url = shoot(p, cssW, cssH);
    p.strokes.forEach(function (st) { st.dense = null; });
    return url;
  };

  /* The one photographer. `preview` and `previewInk` differ in where the page
     comes from and in nothing else, and the moment they differ in anything else
     a frozen board stops matching the live one. */
  function shoot(p, cssW, cssH) {
    if (!p || !(cssW > 0) || !(cssH > 0)) return "";
    var c = document.createElement("canvas");
    c.width = Math.round(cssW);
    c.height = Math.round(cssH);
    var g = c.getContext("2d");
    if (!g) return "";
    var k = cssW / p.w;
    var drawn = p.h * k;
    /* Framed exactly as the live surface frames the same page -- on the writing,
       not on the top of the box. A photograph has nobody to pan it, so a preview
       parked above the ink is a board that reads as empty, and a board that reads
       as empty reads as work that has been lost. */
    var oy;
    if (drawn < cssH) {
      oy = (cssH - drawn) / 2;
    } else {
      var ib = inkBoxOf(p);
      oy = ib ? -Math.max(0, ib.y0 - FIT_PAD) * k : 0;
    }
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
    paintStrokes(g, p, { x0: x0, y0: y0, x1: x1, y1: y1 }, tool.paper === "black");
    var url = "";
    try { url = c.toDataURL("image/png"); } catch (e) { url = ""; }
    c.width = c.height = 1;             /* let the pixels go now, not eventually */
    return url;
  }

  /* Which paper every board on the page is currently drawn on. The host keys its
     photographs by it: a picture taken on slate is wrong the moment the paper
     turns white, and it has no other way to know that anything changed. */
  api.paper = function () { return tool.paper + "/" + tool.rule; };

  /* Ink from somewhere else, as a page of its own.

     For a board whose sheet no longer holds what was handed in off it -- cleared,
     reused, or cloned over. The answer itself cannot move; this is how it comes
     back onto the surface so it can be written on again instead of the pen
     landing on whatever happened to that sheet since. Marked dirty, because a
     page that exists only in memory is a page a reload turns back into nothing. */
  api.adoptInk = function (ink) {
    var copy = blankPage();
    if (ink && ink.w) copy.w = ink.w;
    if (ink && ink.h) copy.h = ink.h;
    copy.strokes = ((ink && ink.strokes) || []).map(function (st) {
      var c = {};
      for (var k in st) { if (k !== "dense") c[k] = st[k]; }
      c.pts = (st.pts || []).map(function (q) { return q.slice(); });
      return c;
    });
    pages.push(copy);
    goTo(pages.length - 1);
    markDirty();
    return current;
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
  /* What colour a paper is. The board paints the box a dormant picture sits in,
     and a black box behind a white sheet is the same inconsistency the pictures
     themselves had. */
  paperBg: function (name) { return (PAPERS[name] || PAPERS.black).bg; },
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
