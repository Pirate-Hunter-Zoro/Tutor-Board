/* ==========================================================================
   annotate.js -- writing on top of the tutor's own cards.

   A question about a lesson is almost always a question about one *place* in
   it: this line, that step, the word "clearly". Sending a page of separate
   working to ask it is a translation the student should not have to perform.

   Each card carries its own ink layer, and strokes are stored in that card's
   own coordinates -- fractions of its width and height, not page pixels. The
   lesson reflows constantly: the type size button, the reading face, the iPad
   rotating, a figure finishing its compile and pushing everything down. Ink
   anchored to the page would end up somewhere else every time; ink anchored to
   the card moves with the words it is about.

   The layer is inert unless annotate mode is on, so scrolling and selecting a
   card behave exactly as they did before.
   ========================================================================== */

(function () {
"use strict";

var LAYER = "ann-layer";
var pen = { colour: "#e0b45c", width: 2.2 };
var on = false;

/* Room to draw outside the card. A mark about a line of prose is very often a
   ring around it, and a ring around something near an edge goes outside the box
   -- the coordinates used to be clamped into [0,1], so the ring came back with
   a straight edge where it met the boundary. It read as the pen cutting out.
   Fractions are still fractions OF THE CARD, so everything anchored stays
   anchored; the canvas simply extends past the card and the fractions are
   allowed past 0 and 1 by this much.

   Kept comfortably under half the gap between cards (`.card` has 2.1rem of
   margin below it), because while annotate mode is on these layers take the
   pointer, and two of them overlapping would mean marks landing on the wrong
   card near a boundary. */
/* How far the ink layer reaches beyond its card, in CSS pixels. It is here so a
   ring drawn around something near an edge is not chopped off at the boundary --
   and it is 18 rather than 12 so that two adjacent layers MEET: cards are 2.1rem
   apart, and a stroke begun in the gap between them used to land on the prose
   instead of on a canvas. */
var PAD = 18;

/* The slate's ink geometry, shared rather than reimplemented: smooth the samples
   as they arrive, run a Catmull-Rom curve through them, resample it to about a
   pixel, and vary the width along it. Without this the layer drew raw pointer
   samples joined by straight lines, which is the faceted, jagged line the slate
   exists not to have. */
var ink = (window.Slate && window.Slate.ink) || null;
var SMOOTH = ink ? ink.SMOOTH : 0.3;
var trust = (ink && ink.trust) || function () { return SMOOTH; };
var MIN_STEP = ink ? ink.MIN_STEP : 0.5;
var RESAMPLE = ink ? ink.RESAMPLE : 0.8;
var POLISH = ink ? ink.POLISH : 2;

function densify(pts) {
  return ink ? ink.densify(pts) : pts;
}

function polish(pts, passes) {
  return ink ? ink.polish(pts, passes) : pts;
}
var store = Object.create(null);      /* card id -> [stroke, ...] */
var dirty = Object.create(null);      /* card ids with unsaved changes */
/* Which cards' marks have been handed to the tutor. Separate from `dirty`,
   which is about disk: the autosave clears `dirty` about a second after the pen
   lifts, so "not yet saved" is useless as a stand-in for "not yet sent" -- it
   is false almost all of the time, including for ink nobody has ever seen but
   you. Seeded from the payload on load, cleared by any change, set by a send. */
var handed = Object.create(null);
var onChange = function () {};

function strokesFor(id) {
  if (!store[id]) store[id] = [];
  return store[id];
}

function layerOf(card) {
  var c = card.querySelector("canvas." + LAYER);
  if (!c) {
    c = document.createElement("canvas");
    c.className = LAYER;
    card.appendChild(c);
  }
  return c;
}

/* The canvas is sized in device pixels and scaled down by CSS, or the ink is
   soft on exactly the screens this is meant for. It is PAD larger than the card
   on every side, and offset by -PAD, so a ring drawn around something near an
   edge has somewhere to go. `_w`/`_h` stay the CARD's size: that is what the
   stored fractions are fractions of. */
/* Is there anything to paint on this card's layer? */
function marked(card) {
  return (store[card.dataset.card] || []).length > 0
      || !!(drawing && drawing.card === card);
}

function size(card, canvas) {
  var r = card.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  var need = marked(card);
  if (canvas._w === w && canvas._h === h && canvas._dpr === dpr
      && canvas._real === need) return false;
  canvas._w = w; canvas._h = h; canvas._dpr = dpr; canvas._real = need;
  /* The box is always the card's, plus the overhang: this element is what takes
     the pen while annotate mode is on, and two adjacent layers have to MEET or a
     stroke begun in the gap between two cards lands on the prose. Only the
     BITMAP waits.

     A layer with nothing on it holds one pixel. Every card in the lesson gets
     one of these, and it used to be allocated at the card's full size in device
     pixels the moment the card appeared: on a retina tablet several megabytes a
     card, twenty or thirty cards, almost all of it backing store for a canvas
     nobody will ever draw on. It is the same budget the dormant boards were
     turned into photographs to stay inside of, spent here on nothing. The real
     bitmap arrives with the first mark. */
  canvas.style.width = (w + 2 * PAD) + "px";
  canvas.style.height = (h + 2 * PAD) + "px";
  canvas.style.left = -PAD + "px";
  canvas.style.top = -PAD + "px";
  if (!need) {
    canvas.width = canvas.height = 1;
    return false;
  }
  canvas.width = Math.round((w + 2 * PAD) * dpr);
  canvas.height = Math.round((h + 2 * PAD) * dpr);
  /* A resize invalidates every cached pixel path on this card. */
  var strokes = store[card.dataset.card] || [];
  for (var i = 0; i < strokes.length; i++) strokes[i]._k = null;
  return true;
}

/* Stored fractions -> a dense pixel path, cached per canvas size. The
   densifying is done in pixels rather than in fractions so the line is resampled
   to the size it is actually being drawn at: a card that reflows narrower gets a
   correctly resampled curve rather than a stretched one. */
function pathOf(s, w, h) {
  var key = w + "x" + h;
  if (s._k === key && s._d) return s._d;
  var raw = [];
  var pr = s.pr || null;
  for (var i = 0, n = 0; i < s.p.length; i += 2, n++) {
    raw.push([s.p[i] * w + PAD, s.p[i + 1] * h + PAD,
              pr && pr[n] !== undefined ? pr[n] : 0.5]);
  }
  s._k = key;
  s._d = densify(raw);
  return s._d;
}

/* One stroke, with the width varying along it. Straight `lineTo` between raw
   samples is what "jagged" was. */
function paint(ctx, s, dense, colour, scale) {
  if (!dense.length) return;
  var base = (s.w || pen.width) * (scale || 1);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  if (dense.length === 1) {
    ctx.beginPath();
    ctx.arc(dense[0][0], dense[0][1], base * (0.65 + 0.7 * dense[0][2]) / 2, 0, 6.2832);
    ctx.fill();
    return;
  }
  paintFrom(ctx, dense, 1, base);
}

/* Segments that come out the same width are drawn as ONE polyline.

   The curve is resampled to about a pixel, which is what makes it read as
   smooth -- but stroking each of those segments as its own path is a draw call
   per pixel of stroke, hundreds of them a frame, and that is a real cost on a
   tablet. Pressure changes slowly, so consecutive segments almost always land in
   the same quarter-pixel of width; batching them cuts the draw calls by an order
   of magnitude and paints the same shape, because a round join between two
   segments of one path is the same ink as the round caps they had apart. */
function widthAt(a, b, base) {
  return Math.round(base * (0.65 + 0.7 * ((a[2] + b[2]) / 2)) * 4) / 4;
}

function paintFrom(ctx, dense, from, base) {
  var i = Math.max(1, from);
  while (i < dense.length) {
    var w = widthAt(dense[i - 1], dense[i], base);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(dense[i - 1][0], dense[i - 1][1]);
    ctx.lineTo(dense[i][0], dense[i][1]);
    i++;
    while (i < dense.length && widthAt(dense[i - 1], dense[i], base) === w) {
      ctx.lineTo(dense[i][0], dense[i][1]);
      i++;
    }
    ctx.stroke();
  }
}

function context(canvas) {
  var ctx = canvas.getContext("2d");
  if (!ctx) return null;
  var dpr = canvas._dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return ctx;
}

/* `measured` says the caller has already established that the card has not
   changed size -- which is true for every frame of a stroke, and matters because
   `size` asks the card for its rectangle and that forces the browser to lay out
   the document. Once is nothing; once per erase sample, over a lesson full of
   typeset mathematics, is the main thread gone and a pen that answers late. */
function draw(card, measured) {
  if (!card) return;
  var id = card.dataset.card;
  if (!id) return;
  var canvas = layerOf(card);
  if (!measured) size(card, canvas);
  /* Nothing on it and nothing being drawn on it: there is no bitmap to clear
     and nothing to put back. */
  if (!canvas._real) return;
  var ctx = context(canvas);
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas._w + 2 * PAD, canvas._h + 2 * PAD);
  (store[id] || []).forEach(function (s) {
    if (!s.p || s.p.length < 2) return;
    paint(ctx, s, pathOf(s, canvas._w, canvas._h), s.c || pen.colour);
  });
  /* The stroke being drawn right now is not in the store yet on the frame it
     starts, and a full redraw during a stroke would wipe it. */
  if (drawing && drawing.card === card && drawing.dense.length) {
    ctx.strokeStyle = drawing.stroke.c || pen.colour;
    paintFrom(ctx, drawing.dense, 1, drawing.stroke.w || pen.width);
    drawing.drawnTo = drawing.dense.length - 1;
  }
}

/* Where on the card, in words, so the tutor can say "the bit you circled near
   the top" without being handed a coordinate pair. */
function whereOn(id) {
  var all = store[id] || [];
  var lo = 1, hi = 0;
  all.forEach(function (s) {
    for (var i = 1; i < s.p.length; i += 2) {
      if (s.p[i] < lo) lo = s.p[i];
      if (s.p[i] > hi) hi = s.p[i];
    }
  });
  if (!all.length) return "";
  var mid = (lo + hi) / 2;
  return mid < 0.34 ? "near the top" : mid < 0.67 ? "in the middle" : "near the bottom";
}

/* The ink alone, on white, at a size worth reading. The tutor already has the
   card's words; what it needs from here is the marks. */
function png(id) {
  var src = document.querySelector('[data-card="' + id + '"]');
  if (!src) return "";
  var live = src.querySelector("canvas." + LAYER);
  if (!live) return "";
  var out = document.createElement("canvas");
  out.width = live.width;
  out.height = live.height;
  var ctx = out.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  var dpr = live._dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  (store[id] || []).forEach(function (s) {
    if (!s.p || s.p.length < 2) return;
    /* Dark ink on white whatever the screen is showing -- the PNG's only job is
       to be legible to whatever opens it. The same smoothed path as the screen,
       a little heavier, because it is read at whatever size the reader chooses. */
    paint(ctx, s, pathOf(s, live._w, live._h), "#1a1a1a", 1.3);
  });
  try { return out.toDataURL("image/png"); } catch (e) { return ""; }
}

/* Undo has to cover erasing and clearing too, not just strokes, or the eraser is
   a one-way door over the tutor's own words. Snapshots, because a card carries a
   handful of strokes and the simple thing is correct. */
var past = [], future = [];
var HISTORY = 60;

function snapshot(id) {
  return { id: id, strokes: (store[id] || []).map(function (s) {
    return { c: s.c, w: s.w, p: s.p.slice() };
  }) };
}

function remember(id) {
  past.push(snapshot(id));
  if (past.length > HISTORY) past.shift();
  future.length = 0;
}

function restore(snap) {
  store[snap.id] = snap.strokes;
  dirty[snap.id] = true;
  handed[snap.id] = false;
  draw(document.querySelector('[data-card="' + snap.id + '"]'));
  onChange();
}

var tool = "pen";        /* pen | erase */
var drawing = null;
var pending = false;

/* Within this many card-widths of a stroke counts as touching it. Generous,
   because the target is a pen line over prose on a tablet. */
var ERASE_NEAR = 0.02;

function eraseAt(id, x, y) {
  var all = store[id] || [];
  var kept = all.filter(function (s) {
    for (var i = 0; i < s.p.length; i += 2) {
      var dx = s.p[i] - x, dy = s.p[i + 1] - y;
      if (dx * dx + dy * dy < ERASE_NEAR * ERASE_NEAR) return false;
    }
    return true;
  });
  if (kept.length === all.length) return false;
  store[id] = kept;
  return true;
}

/* Canvas-space pixels. The canvas is offset by -PAD, so its own rect already
   carries the padding and this needs no correction. */
function at(ev, d) {
  return [ev.clientX - d.rect.left, ev.clientY - d.rect.top];
}

/* Every sample the hardware actually took. A Pencil reports far faster than the
   frame rate, and the browser hands the extra samples over only if they are
   asked for -- taking one event per frame throws away most of the line and is a
   large part of what made this look coarse next to an app that does ask. */
function samples(ev) {
  if (typeof ev.getCoalescedEvents === "function") {
    try {
      var all = ev.getCoalescedEvents();
      if (all && all.length) return all;
    } catch (e) { /* not fatal */ }
  }
  return [ev];
}

function feed(ev, d) {
  var list = samples(ev);
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    var xy = at(e, d);
    var pr = e.pressure > 0 ? e.pressure : 0.5;
    if (d.sx === null) { d.sx = xy[0]; d.sy = xy[1]; }
    else {
      /* The slate's own smoothing, weight and all: heavy while the pen crawls,
         where the hand's tremor is the whole signal, and out of the way while it
         moves, where the only thing you would notice is the ink trailing the
         nib. */
      var a = trust(Math.hypot(xy[0] - d.sx, xy[1] - d.sy));
      d.sx += (xy[0] - d.sx) * a;
      d.sy += (xy[1] - d.sy) * a;
    }
    var last = d.raw[d.raw.length - 1];
    if (last && Math.abs(d.sx - last[0]) < MIN_STEP
             && Math.abs(d.sy - last[1]) < MIN_STEP) continue;
    d.raw.push([d.sx, d.sy, pr]);
  }
}

/* Grow the dense path by whatever the new samples allow. A Catmull-Rom segment
   needs the point after its end, so the newest sample is always held back one
   frame -- which is invisible, and much cheaper than re-densifying the whole
   stroke on every frame. */
function extend(d) {
  var pts = d.raw;
  if (!ink) { d.dense = pts.slice(); d.built = pts.length; return; }
  while (d.built + 2 < pts.length) {
    var i = d.built;
    var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    if (!d.dense.length) d.dense.push(p1);
    var dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    var steps = Math.max(1, Math.min(24, Math.ceil(dist / RESAMPLE)));
    for (var k = 1; k <= steps; k++) {
      d.dense.push(ink.catmullRom(p0, p1, p2, p3, k / steps));
    }
    d.built++;
  }
}

/* One paint per frame, and only the part of the line that is new. The old layer
   redrew every stroke on the card from scratch inside the pointermove handler,
   which on a tablet is the difference between ink that follows the nib and ink
   that arrives after it. */
function tick() {
  pending = false;
  var d = drawing;
  if (!d || d.erasing) return;
  extend(d);
  var ctx = context(d.canvas);
  if (!ctx) return;
  ctx.strokeStyle = d.stroke.c || pen.colour;
  /* The nib's own mark, on the frame the pen goes down.

     A Catmull-Rom segment needs three samples before it yields a single point of
     curve, and samples closer together than `MIN_STEP` are thrown away -- so a
     pen put down and moved slowly, which is how a letter starts, painted nothing
     until it had travelled a pixel or two. That reads as the surface answering
     late. If the mark turns out to be a tap it is withdrawn on lift, where the
     redraw already decides that a tap is not ink. */
  if (!d.dot && d.raw.length) {
    d.dot = true;
    paint(ctx, d.stroke, [d.raw[0]], d.stroke.c || pen.colour);
  }
  if (d.dense.length <= d.drawnTo + 1) return;
  paintFrom(ctx, d.dense, d.drawnTo + 1, d.stroke.w || pen.width);
  d.drawnTo = d.dense.length - 1;
}

function frame() {
  if (pending) return;
  pending = true;
  (window.requestAnimationFrame || function (fn) { setTimeout(fn, 16); })(tick);
}

function store_stroke(d) {
  /* Polished once, on lift: a weighted average over the interior that pulls out
     hand tremor while leaving the endpoints exactly where they were put. */
  var pts = polish(d.raw, POLISH);
  var w = d.canvas._w || 1, h = d.canvas._h || 1;
  var flat = [], pr = [];
  for (var i = 0; i < pts.length; i++) {
    /* Fractions OF THE CARD, so ink stays anchored to the words it is about
       through every reflow -- and allowed outside [0,1] by the padding, so a
       ring around something near an edge is not cut off at the boundary. */
    flat.push((pts[i][0] - PAD) / w, (pts[i][1] - PAD) / h);
    pr.push(Math.round(pts[i][2] * 100) / 100);
  }
  d.stroke.p = flat;
  d.stroke.pr = pr;
  strokesFor(d.id).push(d.stroke);
}

/* The canvas rect is read once per stroke rather than per sample -- asking for
   it on every pointer event forces a layout flush, hundreds of times a second,
   which is exactly the sort of thing that turns a Pencil line into a staircase.
   The one thing that can invalidate it mid-stroke is the lesson scrolling
   underneath, so watch for that and for nothing else. */
function follow() {
  if (drawing) drawing.rect = drawing.canvas.getBoundingClientRect();
}

/* CSS alone does not always win here. A selection that has already begun -- from
   a tap a moment earlier, or from an element outside a card -- survives
   `user-select: none`, and iOS is happy to keep extending it. So refuse the
   gesture outright while annotating, and drop anything already selected as the
   pen goes down. */
function noSelect(ev) {
  if (on) ev.preventDefault();
}

function dropSelection() {
  try {
    var sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
  } catch (e) { /* not fatal */ }
}

document.addEventListener("selectstart", noSelect, true);
document.addEventListener("dragstart", noSelect, true);

function begin(ev, card) {
  if (!on) return;
  var id = card.dataset.card;
  if (!id) return;
  dropSelection();
  /* A finger scrolls the lesson unless the slate has been told a finger writes.
     Returning before preventDefault is what lets the scroll happen.

     This used to be a latch of its own -- "once a pen has been seen, a finger is
     a palm" -- which meant the two surfaces disagreed about the same hand, and
     both of them forgot the answer on every reload. One setting, read from the
     component that owns it. */
  if (ev.pointerType === "touch"
      && !(window.Slate && window.Slate.fingerWrites && window.Slate.fingerWrites())) return;
  var canvas = layerOf(card);
  var d = {
    id: id, card: card, canvas: canvas,
    rect: null,
    raw: [], dense: [], built: 0, drawnTo: 0, sx: null, sy: null,
    erasing: tool === "erase",
    stroke: { c: pen.colour, w: pen.width, p: [], pr: [] },
  };
  /* Before the layer is sized, because what it is sized to depends on whether
     anything is going to be drawn on it -- and this is that. */
  drawing = d;
  size(card, canvas);
  /* Read once per stroke, and after the sizing above, which is what moves the
     layer out over the card's edges. */
  d.rect = canvas.getBoundingClientRect();
  remember(id);

  if (d.erasing) {
    rub(ev);
  } else {
    feed(ev, d);
    frame();
  }
  try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* not fatal */ }
  window.addEventListener("scroll", follow, true);
  ev.preventDefault();
}

function rub(ev) {
  var d = drawing;
  if (!d) return;
  var xy = at(ev, d);
  var x = (xy[0] - PAD) / Math.max(1, d.canvas._w);
  var y = (xy[1] - PAD) / Math.max(1, d.canvas._h);
  if (eraseAt(d.id, x, y)) {
    dirty[d.id] = true;
    handed[d.id] = false;
    /* The card was measured when the pen went down and cannot have reflowed
       since -- nothing moves under a stroke but the scroll, which `follow`
       handles. */
    draw(d.card, true);
  }
}

function move(ev) {
  var d = drawing;
  if (!on || !d) return;
  if (d.erasing) {
    rub(ev);
  } else {
    feed(ev, d);
    frame();
  }
  ev.preventDefault();
}

function end(ev) {
  var d = drawing;
  if (!d) return;
  window.removeEventListener("scroll", follow, true);
  var id = d.id;
  if (!d.erasing) {
    /* Where the nib actually left the glass. The samples that arrive during a
       stroke are smoothed towards the hand's average, and on a short quick mark
       -- a tick, a caret, a two-letter correction -- the smoothing has not
       caught up by the time the pen lifts, so the recorded points can still be
       sitting almost on top of each other and the mark reads as a tap. The lift
       position is not smoothed and is not a guess: it is where the mark ends. */
    if (ev && typeof ev.clientX === "number") {
      var xy = at(ev, d);
      var last = d.raw[d.raw.length - 1];
      if (!last || Math.abs(xy[0] - last[0]) > 0.01 || Math.abs(xy[1] - last[1]) > 0.01) {
        d.raw.push([xy[0], xy[1], last ? last[2] : 0.5]);
      }
    }
    /* Two points make a line, and a line is a mark. This wanted three, which
       threw away every flick short enough to be recorded in two -- and a tick
       beside a wrong line is exactly that flick. */
    if (d.raw.length < 2) {
      past.pop();                  /* a tap is not a mark, or an undo step */
      drawing = null;
      draw(d.card);                /* clear whatever dot was painted live */
      return;
    }
    store_stroke(d);
  }
  drawing = null;
  dirty[id] = true;
  handed[id] = false;
  draw(d.card);                    /* once, with the polished line */
  onChange();
}

window.Annotate = {
  /* Attach to a card node. Idempotent: the lesson is reconciled, so the same
     node comes back frame after frame and must not collect listeners. */
  attach: function (card) {
    if (!card || !card.dataset.card || card._annotated) return;
    card._annotated = true;
    var canvas = layerOf(card);
    /* A card grows after it is first laid out -- a figure finishes compiling,
       KaTeX replaces a formula, the type size changes -- and the layer was only
       re-sized on a render or a window resize. In between, the bottom of the
       card was not covered by anything: a pen landing there hit the prose
       instead, which starts a selection and loses the stroke. It looked like the
       ink dying at random, and it was random -- it depended on where in the card
       you touched. */
    if (window.ResizeObserver) {
      var ro = new window.ResizeObserver(function () {
        if (drawing && drawing.card === card) return;   /* not mid-stroke */
        if (size(card, canvas)) draw(card);
      });
      try { ro.observe(card); } catch (e) { /* not fatal */ }
    }
    canvas.addEventListener("pointerdown", function (e) { begin(e, card); });
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    draw(card);
  },
  redrawAll: function () {
    var cards = document.querySelectorAll("[data-card]");
    Array.prototype.forEach.call(cards, function (c) {
      /* Never the card being written on: its ink is already on the glass, and
         repainting it from scratch is exactly the work that makes a line arrive
         after the nib. The resize case that needs it has its own guard. */
      if (drawing && drawing.card === c) return;
      draw(c);
    });
  },
  load: function (notes) {
    if (!notes) return;
    var fresh = [];
    Object.keys(notes).forEach(function (id) {
      /* The payload is for restoring marks after a reload, and for nothing else.
         This device's copy is authoritative while it is drawing on it: the save
         is a round trip, and a stroke drawn during that round trip is not in the
         copy that comes back -- so accepting the server's version a moment later
         silently truncated whatever had been drawn since. It looked like the end
         of a stroke being bitten off a second after finishing it. */
      if (!(id in store)) { store[id] = notes[id] || []; fresh.push(id); }
    });
    /* Only what was actually adopted.

       This is called on every payload -- which is every card the tutor writes
       and every heartbeat -- and it used to redraw EVERY card in the lesson each
       time: a forced layout and a full repaint per card, a dozen or more of
       them, arriving in the middle of somebody writing. Reported as annotated
       writing being "hella laggy", after the autosave's picture had already been
       taken out of the way. The marks that arrive in a payload are the ones
       being restored after a reload, and there is nothing to redraw for the
       rest. */
    fresh.forEach(function (id) {
      if (!(store[id] || []).length) return;
      var card = document.querySelector('[data-card="' + id + '"]');
      if (card) draw(card);
    });
  },
  setOn: function (v) {
    on = !!v;
    document.body.classList.toggle("annotating", on);
  },
  isOn: function () { return on; },
  setTool: function (t) { tool = (t === "erase") ? "erase" : "pen"; },
  tool: function () { return tool; },
  undo: function () {
    var snap = past.pop();
    if (!snap) return false;
    future.push(snapshot(snap.id));
    restore(snap);
    return true;
  },
  redo: function () {
    var snap = future.pop();
    if (!snap) return false;
    past.push(snapshot(snap.id));
    restore(snap);
    return true;
  },
  canUndo: function () { return past.length > 0; },
  canRedo: function () { return future.length > 0; },
  clearCurrent: function () {
    var ids = window.Annotate.marked();
    ids.forEach(function (id) { remember(id); store[id] = []; dirty[id] = true;
                                handed[id] = false;
                                draw(document.querySelector('[data-card="' + id + '"]')); });
    if (ids.length) onChange();
    return ids.length;
  },
  colour: function () { return pen.colour; },
  setPen: function (colour, width) {
    if (colour) pen.colour = colour;
    if (width) pen.width = width;
  },
  /* Which cards carry marks, which of those are unsaved, and which of those
     have never been handed to the tutor.

     `unsent` is the one to ask before interrupting somebody. `marked` counts
     every mark on the board, including ink delivered a week ago and ink from a
     sitting they have forgotten -- and a board that has ever been written on
     therefore answered "yes, there are marks" for ever. */
  marked: function () { return Object.keys(store).filter(function (id) { return (store[id] || []).length; }); },
  unsent: function () {
    return window.Annotate.marked().filter(function (id) { return !handed[id]; });
  },
  unsaved: function () { return Object.keys(dirty); },
  clean: function (id) { delete dirty[id]; },
  /* Delivered. Called when the round trip has actually come back, not when it
     was started -- a send that failed has not been sent. */
  sent: function (id) { handed[id] = true; },
  /* The server's record of what has been delivered, seeded on load. Same guard
     as `load`: this device is authoritative for a card it already knows about,
     because a mark drawn during the round trip is not in the copy coming back. */
  loadSent: function (map) {
    if (!map) return;
    Object.keys(map).forEach(function (id) {
      if (!(id in handed)) handed[id] = !!map[id];
    });
  },
  clear: function (id) {
    remember(id);
    store[id] = [];
    dirty[id] = true;
    handed[id] = false;
    draw(document.querySelector('[data-card="' + id + '"]'));
    onChange();
  },
  payload: function (id, send) {
    /* The picture ONLY when it is actually going to the tutor.
   
       `png()` builds an offscreen canvas the size of the card, repaints every
       stroke on it and PNG-encodes the result. That ran on every autosave --
       which is about a second after every stroke, for every card with unsaved
       marks -- and on a tablet holding a long lesson it is hundreds of
       milliseconds of the main thread each time. Reported as: "HELLA laggy. I
       try to write something out multiple times and a few seconds later the
       multiple writings all show up overlapping." That is precisely what a
       blocked main thread looks like from behind a pen: the strokes were
       captured the whole time and nothing could paint them.
   
       Nothing read it. An autosave exists so a reload does not cost the marks,
       and what a reload restores is `strokes`; the server writes the file and
       `load_notes` never looks at it. The tutor reads the picture, and the tutor
       only sees marks that were sent. */
    return { card: id, strokes: store[id] || [], png: send ? png(id) : "",
             where: whereOn(id), send: !!send };
  },
  onChange: function (fn) { onChange = fn || function () {}; }
};

window.addEventListener("resize", function () { window.Annotate.redrawAll(); });
})();
