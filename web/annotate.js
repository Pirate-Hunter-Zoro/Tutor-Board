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

/* Room to draw outside the card, ABOVE and BELOW it. A mark about a line of
   prose is very often a ring around it, and a ring around something near an edge
   goes outside the box -- the coordinates used to be clamped into [0,1], so the
   ring came back with a straight edge where it met the boundary. It read as the
   pen cutting out. Fractions are still fractions OF THE CARD, so everything
   anchored stays anchored; the canvas simply extends past the card and the
   fractions are allowed past 0 and 1 by this much.

   Sideways there is no such number, because sideways the answer is the window.
   See `padsOf`. */
var PAD = 18;

/* The most a layer will grow into the gap above or below it. A gap can be
   enormous -- a folded run of superseded cards, a student's own turn between two
   cards -- and a layer that swallowed all of it would be a canvas the size of
   the document for the sake of a strip nobody writes in. */
var REACH = 160;

/* The most device pixels one layer's bitmap may hold. See `size`. */
var CAP = 4e6;

/* The nearest neighbour that is actually on the page.

   A hidden element -- the writing surface with the panel shut, and it sits in
   this list -- reports a rectangle of zeros wherever it is in the document. Read
   as a neighbour that is a thousand pixels away, which is what a zero bottom
   looks like from halfway down a lesson, it would send a layer reaching up over
   the card above it to take that card's pen. Marks landing on the wrong card is
   the thing the padding is kept small to avoid. */
function nextBox(node, dir) {
  for (var n = 0; node && n < 8; n++) {
    var box = node.getBoundingClientRect();
    if (box.width > 0 || box.height > 0) return box;
    node = dir < 0 ? node.previousElementSibling : node.nextElementSibling;
  }
  return null;
}

/* How far each layer reaches beyond its card, per side, in CSS pixels.

   Sideways: to the edge of the WINDOW. `#board` is a 46rem column centred in the
   glass, so on a tablet held in landscape there are two hundred pixels of margin
   down each side with nothing over them -- and a pen put down there had no
   canvas under it, so the gesture went to the page and the page scrolled.
   Reported in exactly those words: "on the side of the screen, the far left and
   right, I can't write/annotate there because it scrolls." Where the ink lands is
   not a decision the margin gets to make.

   Up and down: half the gap to the neighbour, so a run of cards is covered
   without any two layers fighting over the same strip -- clamped at PAD, which is
   what an ordinary 2.1rem gap comes to, and at REACH, which is what stops a
   folded run of cards from being turned into backing store.

   `documentElement.clientWidth` rather than `innerWidth`: on a desktop the
   second includes the scrollbar, and a canvas reaching under it is a canvas
   sticking out of the document, which the browser answers with a horizontal
   scrollbar of its own. */
function padsOf(card, r) {
  var vw = document.documentElement.clientWidth || window.innerWidth || 0;
  var p = { l: PAD, r: PAD, t: PAD, b: PAD };
  if (vw > 0) {
    p.l = Math.max(PAD, Math.round(r.left));
    p.r = Math.max(PAD, Math.round(vw - r.right));
  }
  var prev = nextBox(card.previousElementSibling, -1);
  if (prev) {
    var above = Math.round(r.top - prev.bottom);
    if (above > 0) p.t = Math.max(PAD, Math.min(REACH, Math.ceil(above / 2)));
  }
  var next = nextBox(card.nextElementSibling, 1);
  if (next) {
    var below = Math.round(next.top - r.bottom);
    if (below > 0) p.b = Math.max(PAD, Math.min(REACH, Math.floor(below / 2)));
  }
  return p;
}

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
   soft on exactly the screens this is meant for. It reaches past the card on
   every side by `padsOf`, and is offset by the same, so a ring drawn around
   something near an edge -- or a note written out in the margin beside it -- has
   somewhere to go. `_w`/`_h` stay the CARD's size: that is what the stored
   fractions are fractions of. */
/* Is there anything to paint on this card's layer? */
function marked(card) {
  return (store[card.dataset.card] || []).length > 0
      || !!(drawing && drawing.card === card);
}

function size(card, canvas) {
  var r = card.getBoundingClientRect();
  var p = padsOf(card, r);
  var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  var need = marked(card);
  /* Device pixels, capped.

     A layer is the card plus both margins now, which on a tablet held in
     landscape is close to the width of the glass -- half again what it was --
     and the backing store is four bytes a device pixel. A marked card was
     already eight megabytes of it; a tall card in a wide window would be
     fifteen, and iOS answers a canvas budget it has run out of by quietly
     handing back blank ones. So a layer over the cap is drawn a little below the
     screen's own resolution rather than being allowed to cost whatever it likes.
     `CAP` is four million device pixels, which nothing on a real card reaches --
     it is the ceiling, not the working figure. */
  var dpr = window.devicePixelRatio || 1;
  var area = (w + p.l + p.r) * (h + p.t + p.b);
  if (area * dpr * dpr > CAP) dpr = Math.max(1, Math.sqrt(CAP / area));
  /* Where the canvas's own top-left is, in client coordinates. Recorded here
     because `size` has just paid for the card's rectangle, and a stroke needs
     the canvas's rectangle -- asking the canvas for its own is a second forced
     layout of a lesson full of typeset mathematics, at the moment the pen lands.
     It is the card's, less the padding, by construction. */
  canvas._rl = r.left - p.l;
  canvas._rt = r.top - p.t;
  if (canvas._w === w && canvas._h === h && canvas._dpr === dpr
      && canvas._real === need
      && canvas._pl === p.l && canvas._pr === p.r
      && canvas._pt === p.t && canvas._pb === p.b) return false;
  canvas._w = w; canvas._h = h; canvas._dpr = dpr; canvas._real = need;
  canvas._pl = p.l; canvas._pr = p.r; canvas._pt = p.t; canvas._pb = p.b;
  /* The box exists whatever is on it: this element is what takes the pen while
     annotate mode is on, and it has to reach the margins and MEET its
     neighbours, or a stroke begun out there lands on nothing at all. Only the
     BITMAP waits.

     A layer with nothing on it holds one pixel. Every card in the lesson gets
     one of these, and it used to be allocated at the card's full size in device
     pixels the moment the card appeared: on a retina tablet several megabytes a
     card, twenty or thirty cards, almost all of it backing store for a canvas
     nobody will ever draw on. It is the same budget the dormant boards were
     turned into photographs to stay inside of, spent here on nothing. The real
     bitmap arrives with the first mark. */
  canvas.style.width = (w + p.l + p.r) + "px";
  canvas.style.height = (h + p.t + p.b) + "px";
  canvas.style.left = -p.l + "px";
  canvas.style.top = -p.t + "px";
  if (!need) {
    canvas.width = canvas.height = 1;
    return false;
  }
  canvas.width = Math.round((w + p.l + p.r) * dpr);
  canvas.height = Math.round((h + p.t + p.b) * dpr);
  /* A resize invalidates every cached pixel path on this card. */
  var strokes = store[card.dataset.card] || [];
  for (var i = 0; i < strokes.length; i++) { strokes[i]._k = null; strokes[i]._bbk = null; }
  return true;
}

/* The canvas's whole surface, in CSS pixels. */
function boxOf(cv) {
  return { x0: 0, y0: 0,
           x1: (cv._w || 1) + (cv._pl || 0) + (cv._pr || 0),
           y1: (cv._h || 1) + (cv._pt || 0) + (cv._pb || 0) };
}

/* Stored fractions -> a dense pixel path, cached per canvas geometry. The
   densifying is done in pixels rather than in fractions so the line is resampled
   to the size it is actually being drawn at: a card that reflows narrower gets a
   correctly resampled curve rather than a stretched one. */
function geomOf(cv) {
  return cv._w + "x" + cv._h + "@" + cv._pl + "," + cv._pt;
}

function pathOf(s, cv) {
  var key = geomOf(cv);
  if (s._k === key && s._d) return s._d;
  var raw = [];
  var pr = s.pr || null;
  for (var i = 0, n = 0; i < s.p.length; i += 2, n++) {
    raw.push([s.p[i] * cv._w + cv._pl, s.p[i + 1] * cv._h + cv._pt,
              pr && pr[n] !== undefined ? pr[n] : 0.5]);
  }
  s._k = key;
  s._d = densify(raw);
  return s._d;
}

/* What a stroke covers, in canvas pixels, cached the same way.

   This is what makes an erase cheap. Rubbing out a word on a card holding a
   hundred marks used to clear the whole layer and repaint every one of them --
   per pointer sample, of which a Pencil sends four a frame. The rectangle the
   removed ink occupied is the only part of the canvas that changed; everything
   else on it is already correct and repainting it is work spent to arrive back
   where it started. */
function bboxOf(s, cv) {
  var key = geomOf(cv);
  if (s._bbk === key && s._bb) return s._bb;
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (var i = 0; i < s.p.length; i += 2) {
    var x = s.p[i] * cv._w + cv._pl, y = s.p[i + 1] * cv._h + cv._pt;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  /* The curve runs a little outside the samples it was fitted through, and the
     line has width. Both are small and both are why this is generous. */
  var m = (s.w || pen.width) * 1.6 + 4;
  s._bbk = key;
  s._bb = { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
  return s._bb;
}

function grow(box, add) {
  if (!add) return box;
  if (!box) return { x0: add.x0, y0: add.y0, x1: add.x1, y1: add.y1 };
  if (add.x0 < box.x0) box.x0 = add.x0;
  if (add.y0 < box.y0) box.y0 = add.y0;
  if (add.x1 > box.x1) box.x1 = add.x1;
  if (add.y1 > box.y1) box.y1 = add.y1;
  return box;
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

/* Repaint one RECTANGLE of a card's layer, and only the marks that reach into
   it. Everything that redraws part of a layer goes through here -- an erase
   sample, a pen lift -- so the cost of a change is the size of the change and
   not the size of the page. `draw` below is this with the whole canvas as the
   rectangle, which is what a reload, a resize and an undo want. */
function repair(id, cv, box) {
  if (!cv._real || !box) return;
  var ctx = context(cv);
  if (!ctx) return;
  var all = boxOf(cv);
  var x0 = Math.max(all.x0, Math.floor(box.x0)), y0 = Math.max(all.y0, Math.floor(box.y0));
  var x1 = Math.min(all.x1, Math.ceil(box.x1)), y1 = Math.min(all.y1, Math.ceil(box.y1));
  if (x1 <= x0 || y1 <= y0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
  ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
  (store[id] || []).forEach(function (s) {
    if (!s.p || s.p.length < 2) return;
    var bb = bboxOf(s, cv);
    if (bb.x1 < x0 || bb.x0 > x1 || bb.y1 < y0 || bb.y0 > y1) return;
    paint(ctx, s, pathOf(s, cv), s.c || pen.colour);
  });
  /* The selection's own dashed box, inside the same clip: whatever rectangle was
     just cleared gets it back, so an erase or a pen lift elsewhere on the card
     cannot rub out half of it. */
  markPick(ctx, id, cv);
  ctx.restore();
}

/* The dashed ring around what is picked, and the live lasso while one is being
   drawn. Neither is ink -- neither is in `store`, neither is saved, and neither
   reaches the tutor. */
function markPick(ctx, id, cv) {
  if (pickedOn(id)) {
    var b = pickBox(cv);
    if (b) {
      ctx.save();
      ctx.strokeStyle = "#7fd1ff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.restore();
    }
  }
  if (drawing && drawing.id === id && drawing.loop && drawing.loop.length > 1) {
    var l = drawing.loop;
    ctx.save();
    ctx.strokeStyle = "#7fd1ff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(l[0][0], l[0][1]);
    for (var i = 1; i < l.length; i++) ctx.lineTo(l[i][0], l[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

/* The rectangle a loop or a dragged selection covers, generously, so the frame
   that repaints it clears the last one as well. */
function padBox(box, m) {
  if (!box) return null;
  return { x0: box.x0 - m, y0: box.y0 - m, x1: box.x1 + m, y1: box.y1 + m };
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
  repair(id, canvas, boxOf(canvas));
  /* The stroke being drawn right now is not in the store yet on the frame it
     starts, and a full redraw during a stroke would wipe it. */
  if (drawing && drawing.card === card && drawing.dense.length) {
    var ctx = context(canvas);
    if (!ctx) return;
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

/* The ink alone, on white, at a size worth reading, CROPPED TO THE INK.

   The tutor already has the card's words; what it needs from here is the marks.
   And it needs them large: the layer now reaches out to both edges of the window,
   so a picture of the whole layer is a ring the size of a fingernail in the
   middle of a sheet of white. Cropping is the same rule the slate's own preview
   follows, and for the same reason -- the picture's only job is to be legible to
   whatever opens it. */
function png(id) {
  var src = document.querySelector('[data-card="' + id + '"]');
  if (!src) return "";
  var live = src.querySelector("canvas." + LAYER);
  if (!live || !live._w) return "";
  var strokes = (store[id] || []).filter(function (s) { return s.p && s.p.length >= 2; });
  if (!strokes.length) return "";

  var box = null;
  strokes.forEach(function (s) { box = grow(box, bboxOf(s, live)); });
  var all = boxOf(live);
  var m = 10;
  var x0 = Math.max(all.x0, Math.floor(box.x0 - m)), y0 = Math.max(all.y0, Math.floor(box.y0 - m));
  var x1 = Math.min(all.x1, Math.ceil(box.x1 + m)), y1 = Math.min(all.y1, Math.ceil(box.y1 + m));
  if (x1 <= x0 || y1 <= y0) return "";

  var dpr = live._dpr || 1;
  var out = document.createElement("canvas");
  out.width = Math.round((x1 - x0) * dpr);
  out.height = Math.round((y1 - y0) * dpr);
  var ctx = out.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokes.forEach(function (s) {
    /* Dark ink on white whatever the screen is showing -- the PNG's only job is
       to be legible to whatever opens it. The same smoothed path as the screen,
       a little heavier, because it is read at whatever size the reader chooses. */
    paint(ctx, s, pathOf(s, live), "#1a1a1a", 1.3);
  });
  try { return out.toDataURL("image/png"); } catch (e) { return ""; }
}

/* Undo has to cover erasing and clearing too, not just strokes, or the eraser is
   a one-way door over the tutor's own words.

   A step is the LIST of strokes, not a copy of them. It used to be a deep copy --
   every point of every mark on the card, rebuilt on every pen-down and every
   touch of the rubber, with sixty of them on the stack. That is the same defect
   the slate had: an allocation proportional to everything already written,
   landing at the exact moment a hand is asking the surface for something, which
   from behind a pen is a delay on tapping to write.

   It is correct only because nothing on a card is ever changed in place: adding a
   mark, erasing and clearing all REPLACE the list. If that ever stops being true
   the undo stack silently starts holding the present. */
var past = [], future = [];
var HISTORY = 60;

function snapshot(id) {
  return { id: id, strokes: store[id] || [] };
}

function remember(id) {
  past.push(snapshot(id));
  if (past.length > HISTORY) past.shift();
  future.length = 0;
}

function restore(snap) {
  /* A selection is a list of INDICES into this card's strokes, and an undo
     replaces that list wholesale. Whatever was picked is not there any more. */
  if (pick && pick.id === snap.id) pick = null;
  store[snap.id] = snap.strokes;
  dirty[snap.id] = true;
  handed[snap.id] = false;
  draw(document.querySelector('[data-card="' + snap.id + '"]'));
  onChange();
}

var tool = "pen";        /* pen | erase | lasso */
var drawing = null;
var pending = false;

/* How far the rubber reaches, in CSS pixels of the layer, plus a little for how
   thick the line being rubbed is.

   It used to be a fraction -- 0.02 -- and the fraction was of two different
   things at once: the horizontal distance was in card WIDTHS and the vertical
   one in card HEIGHTS, and they were then added as though they were the same
   unit. On a card the shape a line of prose is, that is a rubber that reaches
   fifteen pixels sideways and two downwards. A pixel is a pixel in both
   directions. */
var ERASE_R = 11;

/* Square of the distance from a point to a segment. The rubber is a SWEEP --
   the line from where it was last heard to where it is now -- because a Pencil
   moving quickly delivers its samples a long way apart, and testing only the
   landing points leaves untouched gaps between them. Which is the whole of "I
   went over it three times and half of it is still there". */
function distToSeg(px, py, ax, ay, bx, by) {
  var vx = bx - ax, vy = by - ay;
  var len = vx * vx + vy * vy;
  var t = len ? ((px - ax) * vx + (py - ay) * vy) / len : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  var dx = px - (ax + vx * t), dy = py - (ay + vy * t);
  return dx * dx + dy * dy;
}

/* THE RUBBER TAKES OUT WHAT IT TOUCHES, NOT THE STROKE IT TOUCHES.

   This used to remove the whole stroke, which is what the slate does -- and on
   the slate it is right, because a stroke there is a letter. A stroke HERE is a
   ring around a paragraph, a line under a sentence, an arrow across half a card:
   one pen-down that covers the width of the lesson. Touching any part of it took
   all of it, and with two or three such marks on a card that is the whole
   annotation gone for a tick in the corner of it. Reported in exactly those
   words: "the erasing when annotating wipes out EVERYTHING - it should just wipe
   out what I touch".

   So a stroke the rubber crosses is SPLIT: the samples inside the nib go, and
   each surviving run on either side becomes a mark of its own. A run of one
   sample is dropped -- a single point is a dot, and nobody rubbed out the middle
   of a line in order to leave two dots behind.

   Returns fresh stroke objects, never the ones it was given: the undo stack
   holds the card's list by reference and is only correct while nothing on a card
   is changed in place. */
function splitStroke(s, cv, a, b) {
  var w = cv._w || 1, h = cv._h || 1, pl = cv._pl || 0, pt = cv._pt || 0;
  var r = ERASE_R + (s.w || pen.width) * 0.8;
  var n = (s.p.length / 2) | 0;
  var runs = [], cur = null, touched = false;
  for (var i = 0; i < n; i++) {
    var x = s.p[i * 2] * w + pl, y = s.p[i * 2 + 1] * h + pt;
    if (distToSeg(x, y, a[0], a[1], b[0], b[1]) < r * r) {
      touched = true;
      cur = null;
      continue;
    }
    if (!cur) { cur = []; runs.push(cur); }
    cur.push(i);
  }
  if (!touched) return null;
  var out = [];
  for (var k = 0; k < runs.length; k++) {
    if (runs[k].length < 2) continue;
    var flat = [], pr = [];
    for (var j = 0; j < runs[k].length; j++) {
      var idx = runs[k][j];
      flat.push(s.p[idx * 2], s.p[idx * 2 + 1]);
      pr.push(s.pr && s.pr[idx] !== undefined ? s.pr[idx] : 0.5);
    }
    out.push({ c: s.c, w: s.w, p: flat, pr: pr });
  }
  return out;
}

/* One sweep of the rubber, in canvas pixels. Returns the rectangle that
   changed, so the caller knows what to repaint, or null if nothing was touched.
   The rectangle is the whole of every stroke that was cut, because a split
   rebuilds both halves and the cached path of the original is gone. */
function eraseSweep(id, cv, a, b) {
  var all = store[id] || [];
  if (!all.length) return null;
  var lo = ERASE_R + pen.width * 2;
  var x0 = Math.min(a[0], b[0]) - lo, x1 = Math.max(a[0], b[0]) + lo;
  var y0 = Math.min(a[1], b[1]) - lo, y1 = Math.max(a[1], b[1]) + lo;
  var next = [], box = null, hit = false;
  for (var i = 0; i < all.length; i++) {
    var s = all[i];
    var bb = bboxOf(s, cv);
    if (bb.x1 < x0 || bb.x0 > x1 || bb.y1 < y0 || bb.y0 > y1) { next.push(s); continue; }
    var pieces = splitStroke(s, cv, a, b);
    if (!pieces) { next.push(s); continue; }
    hit = true;
    box = grow(box, bb);
    for (var k = 0; k < pieces.length; k++) next.push(pieces[k]);
  }
  if (!hit) return null;
  store[id] = next;
  return box;
}

/* Is a point inside a closed loop. The lasso's own test, and the same one the
   slate uses. */
function inPolygon(x, y, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* Canvas-space pixels. The canvas is offset by its own padding, so its own rect
   already carries it and this needs no correction. */
function at(ev, d) {
  return [ev.clientX - d.rect.left, ev.clientY - d.rect.top];
}

/* ------------------------------------------------------------- selection */
/* WHAT IS PICKED, AND ON WHICH CARD.

   Ink on the lesson used to be write-only: a mark could be drawn, rubbed out, or
   cleared, and that was the whole of it. Which meant the one thing a person
   actually asks for -- "this working I wrote over your card belongs on my own
   board" -- could not be done at all, and the answer was to write it out a
   second time.

   So the layer gets a lasso of its own, and it is deliberately the same gesture
   as the slate's: loop around something, and it is caught if more than 60% of it
   is inside the loop. A selection belongs to ONE card, because that is what a
   mark is anchored to, and it is dropped when the card's marks change underneath
   it. */
var pick = null;              /* { id: card id, idx: [index into store[id]] } */
/* The last card a pen was put down on. It is where a paste goes when nothing is
   selected -- the card somebody was just working on is a better guess than the
   middle of the screen, and it is the only guess that costs nothing to make. */
var lastCard = null;

function pickedOn(id) {
  return pick && pick.id === id ? pick.idx : null;
}

function pickStrokes() {
  if (!pick) return [];
  var all = store[pick.id] || [];
  return pick.idx.map(function (i) { return all[i]; })
                 .filter(function (s) { return !!s; });
}

/* The extent of what is picked, in canvas pixels. */
function pickBox(cv) {
  var got = pickStrokes();
  if (!got.length) return null;
  var box = null;
  for (var i = 0; i < got.length; i++) box = grow(box, bboxOf(got[i], cv));
  return box;
}

function dropPick() {
  if (!pick) return;
  var id = pick.id;
  pick = null;
  var card = document.querySelector('[data-card="' + id + '"]');
  if (card) draw(card);
  onChange();
}

/* Canvas pixels -> the fractions the card stores. */
function toFractions(pts, cv) {
  var w = cv._w || 1, h = cv._h || 1, pl = cv._pl || 0, pt = cv._pt || 0;
  var flat = [], pr = [];
  for (var i = 0; i < pts.length; i++) {
    flat.push((pts[i][0] - pl) / w, (pts[i][1] - pt) / h);
    pr.push(pts[i].length > 2 ? Math.round(pts[i][2] * 100) / 100 : 0.5);
  }
  return { p: flat, pr: pr };
}

/* ...and back, which is the frame the clipboard keeps ink in: CSS pixels, at the
   size the mark looks on the glass. A stroke stored as fractions of a card has
   no size of its own -- it is whatever the card is this morning -- so the size
   it crosses to another surface at is the size it was when it was copied. */
function toPixels(s, cv) {
  var w = cv._w || 1, h = cv._h || 1, pl = cv._pl || 0, pt = cv._pt || 0;
  var pts = [];
  for (var i = 0, n = 0; i < s.p.length; i += 2, n++) {
    pts.push([s.p[i] * w + pl, s.p[i + 1] * h + pt,
              s.pr && s.pr[n] !== undefined ? s.pr[n] : 0.5]);
  }
  return { c: s.c || pen.colour, w: s.w || pen.width, hl: false, pts: pts };
}

/* Which card a paste lands on: the one holding the selection, else the one last
   written on, else whichever is nearest the middle of the screen. The last of
   the three is the only one that costs a layout, and it is the rarest. */
function pasteCard() {
  if (pick) {
    var held = document.querySelector('[data-card="' + pick.id + '"]');
    if (held) return held;
  }
  if (lastCard && lastCard.parentNode && lastCard.dataset.card) return lastCard;
  var mid = (window.innerHeight || 700) / 2;
  var best = null, bestGap = Infinity;
  var cards = document.querySelectorAll("[data-card]");
  for (var i = 0; i < cards.length; i++) {
    var r = cards[i].getBoundingClientRect();
    if (!r.height) continue;
    var gap = r.top > mid ? r.top - mid : (r.bottom < mid ? mid - r.bottom : 0);
    if (gap < bestGap) { bestGap = gap; best = cards[i]; }
  }
  return best;
}

var CLIP = {
  /* Put what is picked on the shared clipboard. Every surface in the app reads
     the same one -- see ink-clip.js -- so this is also how working written over
     a card reaches the writing board. */
  copy: function () {
    if (!pick || !window.InkClip) return 0;
    var card = document.querySelector('[data-card="' + pick.id + '"]');
    if (!card) return 0;
    var cv = layerOf(card);
    var got = pickStrokes().map(function (s) { return toPixels(s, cv); });
    var clip = window.InkClip.put(got, { kind: "annotation", src: pick.id });
    return clip ? clip.strokes.length : 0;
  },
  cut: function () {
    var n = CLIP.copy();
    if (n) CLIP.remove();
    return n;
  },
  remove: function () {
    if (!pick) return 0;
    var id = pick.id, drop = {};
    pick.idx.forEach(function (i) { drop[i] = true; });
    remember(id);
    store[id] = (store[id] || []).filter(function (_, i) { return !drop[i]; });
    var n = pick.idx.length;
    pick = null;
    dirty[id] = true;
    handed[id] = false;
    draw(document.querySelector('[data-card="' + id + '"]'));
    onChange();
    return n;
  },
  /* Ink from anywhere -- the other writing board, the full-screen slate, another
     card -- dropped onto a card and left picked, so it can be dragged to where
     it is wanted.

     It lands in the middle of the part of the card that is ON SCREEN. Not the
     middle of the card: a card can be three screens tall, and the middle of that
     is a paste somebody has to go looking for. And it is shrunk to fit inside
     the card if it arrived from a surface where there was more room, because a
     page of working pasted at its own size would be a mark whose ends are
     nowhere near the words it is about. */
  paste: function () {
    if (!window.InkClip) return 0;
    var clip = window.InkClip.get();
    if (!clip) return 0;
    var card = pasteCard();
    if (!card || !card.dataset.card) return 0;
    var id = card.dataset.card;
    var cv = layerOf(card);
    /* The layer may never have been sized -- this is a card nobody has written
       on -- and everything below is in its coordinates. */
    size(card, cv);
    var w = cv._w || 1, h = cv._h || 1;
    var scale = Math.min(1, (w * 0.8) / clip.w, (h * 0.9) / clip.h);
    var r = card.getBoundingClientRect();
    var vh = window.innerHeight || 700;
    var top = Math.max(0, -r.top), bottom = Math.min(r.height, vh - r.top);
    var midY = bottom > top ? (top + bottom) / 2 : r.height / 2;
    var x = (cv._pl || 0) + w / 2 - (clip.w * scale) / 2;
    var y = (cv._pt || 0) + midY - (clip.h * scale) / 2;
    remember(id);
    var all = (store[id] || []).slice();
    var start = all.length;
    clip.strokes.forEach(function (s) {
      var pts = s.pts.map(function (q) {
        return [x + q[0] * scale, y + q[1] * scale, q.length > 2 ? q[2] : 0.5];
      });
      var f = toFractions(pts, cv);
      /* The highlighter does not come with it. A card's layer has one kind of
         mark -- a pen line, over words -- and there is no translucent
         multiply-blended ink here for a highlight to arrive as. It lands as a
         line in its own colour, which is the nearest true thing. */
      all.push({ c: s.c || pen.colour, w: s.w || pen.width, p: f.p, pr: f.pr });
    });
    store[id] = all;
    pick = { id: id, idx: all.slice(start).map(function (_, n) { return start + n; }) };
    dirty[id] = true;
    handed[id] = false;
    /* A card that may have had no bitmap at all a moment ago: the layer holds
       one pixel until the first mark arrives, and a paste is a first mark. */
    size(card, cv);
    draw(card, true);
    onChange();
    return clip.strokes.length;
  },
};

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

/* One paint per frame, and only the part that changed. The old layer redrew
   every stroke on the card from scratch inside the pointermove handler -- for a
   pen, and, until the rectangle above existed, for every sample of an erase --
   which on a tablet is the difference between ink that follows the nib and ink
   that arrives after it. */
function tick() {
  pending = false;
  var d = drawing;
  if (!d) return;
  if (d.erasing || d.loop || d.moving) {
    /* One repair a frame, over the union of everything that changed since the
       last one, rather than one repaint per sample. The loop and the drag are
       here for the same reason as the rubber: what moves is a rectangle, and the
       rest of the card is already correct. */
    var box = d.dmg;
    d.dmg = null;
    repair(d.id, d.canvas, box);
    return;
  }
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
  var cv = d.canvas;
  var w = cv._w || 1, h = cv._h || 1;
  var flat = [], pr = [];
  for (var i = 0; i < pts.length; i++) {
    /* Fractions OF THE CARD, so ink stays anchored to the words it is about
       through every reflow -- and allowed outside [0,1] by the padding, so a
       ring around something near an edge is not cut off at the boundary and a
       note written in the margin beside the card stays beside it. */
    flat.push((pts[i][0] - cv._pl) / w, (pts[i][1] - cv._pt) / h);
    pr.push(Math.round(pts[i][2] * 100) / 100);
  }
  d.stroke.p = flat;
  d.stroke.pr = pr;
  /* Replaced, not pushed. The undo stack holds this list by reference; see
     `snapshot`. */
  store[d.id] = strokesFor(d.id).concat([d.stroke]);
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

/* The last word on whether a stroke is over belongs to the WINDOW, not to the
   canvas. A nib lifted past the edge of the layer, a gesture the browser took
   for itself, an app sent to the background mid-word: none of those deliver a
   `pointerup` to the element that captured the pointer, and a stroke that never
   ends is a stroke whose samples are still being fed to a canvas nobody is
   looking at. The slate has had this from the beginning; the annotation layer
   never did. */
["pointerup", "pointercancel"].forEach(function (t) {
  window.addEventListener(t, function (ev) {
    if (!drawing) return;
    if (ev.pointerId !== undefined && ev.pointerId !== drawing.pid) return;
    end(ev);
  }, true);
});
window.addEventListener("blur", function () { if (drawing) end(null); });

/* WHETHER THIS IS A SCROLL IS A QUESTION ABOUT THE HAND, NOT ABOUT THE PLACE.

   It used to be about the place. `touch-action: none` sat on the cards, so a
   swipe over a card was always a stroke and a swipe anywhere else -- the margins
   down each side, the gaps -- was always a scroll. That is two rules a person has
   to hold in their head about their own screen, and it gets the pen wrong exactly
   where the pen has least room: out in the margin, where the answer was "you
   scrolled".

   So the layer permits the scroll in CSS and this takes it back when the hand
   says so. `drawing` is the whole of the test: `begin` runs on `pointerdown`,
   which is dispatched before `touchstart`, and it sets `drawing` for a pen
   always and for a finger only when the slate has been told a finger writes. If
   we own the gesture, nothing scrolls. If we do not, the page scrolls natively,
   with its own momentum, which is not a thing worth reimplementing.

   `touchType` is the belt to that braces: it is what Safari calls an Apple
   Pencil, and it means the pen is refused the scroll even if the two events
   arrive the other way round. */
function stylus(ev) {
  var t = ev.changedTouches && ev.changedTouches[0];
  return !!t && t.touchType === "stylus";
}

/* AND ONCE A PEN IS AT WORK, THE LAYER REFUSES THE SCROLL OUTRIGHT.

   `touch-action` is read when a gesture STARTS, and a `preventDefault` on
   `touchstart` is only honoured while the event is cancelable -- which it is not
   during a fling. So a pen put down while the page is still moving, or a pen
   whose own gesture the browser has decided to treat as a pan, gets a
   `pointercancel` instead of ink: the stroke ends where it was, the page pans,
   and until everything settles nothing the pen does marks anything. Reported as:
   "I wrote down the first letter and it stopped writing. I paused for a couple of
   seconds, tried again, and writing continued fine."

   A latch closes that. While the pen is at work the layer carries
   `touch-action: none`, so the NEXT stroke cannot be reinterpreted however
   quickly it follows, and a finger landing in that window is a palm rather than a
   scroll -- which is what a finger arriving beside a working nib is. It opens
   again a second and a half after the nib was last heard from, and a finger
   scrolls as freely as ever. Same shape as the slate's own palm window, and the
   same reason.

   Note what this does NOT do: it does not decide anything by where the hand
   landed. The hand still decides. It only stops one hand's own gesture from
   being re-read as the other's. */
var penAt = 0;
/* How long that lasts after the nib was last heard from.

   It was a second and a half, and a second and a half is a long time to be
   unable to scroll the lesson you are annotating: the latch also refuses a
   one-finger pan, so somebody who writes a line and then goes to move the page
   got nothing back for a second and a half and reported the page as
   "unresponsive at times". The case it exists for is the NEXT stroke of the same
   word, which follows within a fraction of a second; the case it must not eat is
   a deliberate scroll, which does not. The slate's own palm window is half a
   second, for the same reason and with the same arithmetic behind it. */
var PEN_MODE = 700;
var penTimer = null;

function penMode(on) {
  document.body.classList.toggle("pen-writing", !!on);
}

function penSeen() {
  penAt = Date.now();
  penMode(true);
  if (penTimer) return;
  penTimer = setInterval(function () {
    if (drawing || Date.now() - penAt < PEN_MODE) return;
    clearInterval(penTimer);
    penTimer = null;
    penMode(false);
  }, 500);
}

function onTouchStart(ev) {
  if (!on) return;
  if ((drawing || stylus(ev)) && ev.cancelable) ev.preventDefault();
}

function onTouchMove(ev) {
  if (!on || !drawing) return;
  if (ev.cancelable) ev.preventDefault();
}

/* WHEN THESE TWO LISTENERS EXIST AT ALL IS THE WHOLE OF WHETHER THE LESSON
   SCROLLS SMOOTHLY.

   A `touchmove` listener that is not passive is a promise to the browser that
   the page might refuse the gesture, and the browser keeps that promise by
   asking the main thread about every single move before it is allowed to scroll
   or zoom a pixel. That is a round trip per frame, behind KaTeX, a payload
   arriving, a card being laid out -- and when the main thread is busy the
   scroll simply stops until it is not. Reported twice, in the same words each
   time: "scrolling is still janky and delayed and unresponsive at times,
   especially when I'm annotating", and then "scrolling AND zooming when
   annotating is janky".

   There were two of these on EVERY card's layer, attached when the card was
   attached and never removed -- so the whole reading column was covered in them,
   at every moment, whether annotate mode was on or not.

   Now: one pair, on the document, which sees exactly the same events because
   nothing on the way up stops them. `touchstart` exists only while annotate mode
   is on -- it is one round trip as a gesture begins, which is the price of being
   able to refuse a scroll the browser has already decided is a scroll, and it is
   paid once rather than per frame. And `touchmove` exists only while a stroke is
   actually being drawn, which is the only time anything would ever be refused.
   With a finger on the glass and no stroke in progress there is nothing
   non-passive in the way, and the scroll and the pinch are the compositor's
   again.

   `pointerdown` is dispatched before `touchstart` in WebKit, which is what makes
   this safe: `begin` has already run and armed the refusal before the first
   `touchmove` of its own gesture can arrive. */
var moveArmed = false;

function armMove(want) {
  if (!!want === moveArmed) return;
  moveArmed = !!want;
  if (want) {
    try { document.addEventListener("touchmove", onTouchMove, { passive: false }); }
    catch (e) { document.addEventListener("touchmove", onTouchMove, false); }
  } else {
    document.removeEventListener("touchmove", onTouchMove, { passive: false });
    document.removeEventListener("touchmove", onTouchMove, false);
  }
}

var startArmed = false;

function armTouch(want) {
  if (!!want === startArmed) return;
  startArmed = !!want;
  if (want) {
    try { document.addEventListener("touchstart", onTouchStart, { passive: false }); }
    catch (e) { document.addEventListener("touchstart", onTouchStart, false); }
  } else {
    document.removeEventListener("touchstart", onTouchStart, { passive: false });
    document.removeEventListener("touchstart", onTouchStart, false);
    armMove(false);
  }
}

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
  if (ev.pointerType !== "touch") penSeen();
  /* A stroke already in progress belongs to a contact whose lift was never
     delivered -- the browser took the gesture, the app was backgrounded, the nib
     left past the edge of the glass. Finish it rather than replacing it: the
     samples are already on the canvas, and dropping them repaints the card
     without them, which is a letter written and then taken away. */
  if (drawing) end(null);
  var canvas = layerOf(card);
  lastCard = card;
  var d = {
    id: id, card: card, canvas: canvas,
    pid: ev.pointerId,
    rect: null, dmg: null,
    raw: [], dense: [], built: 0, drawnTo: 0, sx: null, sy: null,
    erasing: tool === "erase",
    stroke: { c: pen.colour, w: pen.width, p: [], pr: [] },
  };
  /* Before the layer is sized, because what it is sized to depends on whether
     anything is going to be drawn on it -- and this is that. */
  drawing = d;
  /* AND IF THE LAYER WAS RESIZED, PUT BACK WHAT WAS ON IT.

     `size` reallocates the bitmap when the geometry has moved, and allocating a
     canvas clears it -- every mark already on the card, gone from the glass in
     the instant before a new one is drawn. Nothing then put them back: the pen
     lift repaints only the rectangle the new stroke covered, which is the whole
     point of that rectangle, and a full redraw happened only on a window resize.
     So the marks came back when the iPad was turned, and not before.

     The geometry moves constantly and never because of anything the person is
     doing: the layer reaches half way into the gap above and below the card, so a
     card arriving anywhere in the lesson, a turn being inserted, the writing
     drawer opening beside the question, a figure finishing its compile -- all of
     them change the padding of a card that has not itself changed size, which is
     exactly the case the per-card resize observer cannot see. Reported as:
     "adding a new annotation makes the old annotations disappear". */
  if (size(card, canvas)) repair(id, canvas, boxOf(canvas));
  card._annGrew = false;
  /* Read from the sizing above rather than asked for again: `size` has just paid
     for the card's rectangle and the canvas's is that one less the padding. A
     second `getBoundingClientRect` here is a second forced layout of the whole
     lesson, at the moment the nib lands. */
  d.rect = { left: canvas._rl, top: canvas._rt };

  if (tool === "lasso") {
    var xy = at(ev, d);
    /* Inside what is already picked: this is a drag, not a new loop. The strokes
       being moved are replaced by copies of themselves first, because the undo
       stack holds this card's list by reference and is only correct while nothing
       on a card is ever changed in place. */
    var held = pickedOn(id) ? padBox(pickBox(canvas), 12) : null;
    if (held && xy[0] >= held.x0 && xy[0] <= held.x1
             && xy[1] >= held.y0 && xy[1] <= held.y1) {
      remember(id);
      var taken = {};
      pick.idx.forEach(function (i) { taken[i] = true; });
      store[id] = (store[id] || []).map(function (st, i) {
        if (!taken[i]) return st;
        return { c: st.c, w: st.w, p: st.p.slice(), pr: (st.pr || []).slice() };
      });
      d.moving = { x: xy[0], y: xy[1] };
    } else {
      if (pick) pick = null;
      d.loop = [xy];
      d.dmg = null;
    }
    frame();
  } else if (d.erasing) {
    remember(id);
    rub(ev);
  } else {
    /* A pen stroke is not about the selection, so the selection goes -- and its
       dashed box comes off the glass now rather than on the lift, because the
       lift only repaints the rectangle the new stroke covered. */
    if (pick) {
      var stale = padBox(pickBox(canvas), 14);
      pick = null;
      if (stale) repair(id, canvas, stale);
    }
    remember(id);
    feed(ev, d);
    frame();
  }
  try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* not fatal */ }
  window.addEventListener("scroll", follow, true);
  /* The touchmove refusal is added HERE and taken off when the stroke ends, and
     that is the difference between a lesson that scrolls and one that stutters.
     See `armTouch`. */
  armMove(true);
  ev.preventDefault();
}

function rub(ev) {
  var d = drawing;
  if (!d) return;
  var cv = d.canvas;
  /* Every sample the hardware took, swept in order, rather than the one point
     the event happened to end at. */
  var list = samples(ev);
  var took = null;
  for (var i = 0; i < list.length; i++) {
    var to = at(list[i], d);
    var from = d.rubbedFrom || to;
    d.rubbedFrom = to;
    took = grow(took, eraseSweep(d.id, cv, from, to));
  }
  if (!took) return;
  dirty[d.id] = true;
  handed[d.id] = false;
  /* Only the rectangle the removed ink occupied, and only once a frame. The card
     was measured when the pen went down and cannot have reflowed since --
     nothing moves under a stroke but the scroll, which `follow` handles. */
  d.dmg = grow(d.dmg, took);
  frame();
}

/* Whose hand this is. A stroke belongs to ONE pointer, and the others that
   arrive on the layer while it is being drawn are the rest of the hand holding
   the pen -- or a finger that has landed to scroll. Both of them used to be able
   to finish somebody else's stroke, because a `pointerup` is a `pointerup`
   whoever sent it, and the symptom is annotation that stops writing partway
   through a word for no reason anybody can reproduce. */
function mine(ev, d) {
  return !(ev && ev.pointerId !== undefined && d.pid !== undefined
           && ev.pointerId !== d.pid);
}

function move(ev) {
  var d = drawing;
  if (ev && ev.pointerType !== "touch" && on) penSeen();
  if (!on || !d) return;
  if (!mine(ev, d)) return;
  if (d.loop) {
    var xy = at(ev, d);
    d.loop.push(xy);
    /* The loop only ever grows, so its own rectangle covers where it was last
       frame as well as where it is now. */
    var b = null;
    for (var i = 0; i < d.loop.length; i++) {
      b = grow(b, { x0: d.loop[i][0], y0: d.loop[i][1],
                    x1: d.loop[i][0], y1: d.loop[i][1] });
    }
    d.dmg = padBox(b, 4);
    frame();
  } else if (d.moving) {
    dragPick(d, at(ev, d));
  } else if (d.erasing) {
    rub(ev);
  } else {
    feed(ev, d);
    frame();
  }
  ev.preventDefault();
}

/* Move what is picked by however far the hand has moved, in fractions of the
   card, and repaint the union of where it was and where it now is. The cached
   pixel path and bounding box of every stroke that moves are dropped: both are
   keyed by the card's geometry, which has not changed, so nothing else would
   notice that the points have. */
function dragPick(d, xy) {
  if (!pick) { d.moving = null; return; }
  var cv = d.canvas;
  var was = padBox(pickBox(cv), 14);
  var dx = (xy[0] - d.moving.x) / Math.max(1, cv._w);
  var dy = (xy[1] - d.moving.y) / Math.max(1, cv._h);
  d.moving = { x: xy[0], y: xy[1] };
  var all = store[pick.id] || [];
  pick.idx.forEach(function (i) {
    var st = all[i];
    if (!st) return;
    for (var n = 0; n < st.p.length; n += 2) {
      st.p[n] += dx;
      st.p[n + 1] += dy;
    }
    st._k = null;
    st._bbk = null;
  });
  d.dmg = grow(grow(d.dmg, was), padBox(pickBox(cv), 14));
  d.dragged = true;
  frame();
}

function end(ev) {
  var d = drawing;
  if (!d) return;
  if (!mine(ev, d)) return;
  window.removeEventListener("scroll", follow, true);
  armMove(false);
  var id = d.id;
  var cv = d.canvas;

  /* A LOOP IS A QUESTION ABOUT WHAT IS INSIDE IT, and nothing on the card
     changes because one was drawn. Same rule as the slate's lasso: a stroke is
     caught when more than 60% of it is inside the loop, so clipping the edge of
     a neighbouring mark does not drag it along. */
  if (d.loop) {
    drawing = null;
    if (d.loop.length > 4) {
      var poly = d.loop, idx = [];
      (store[id] || []).forEach(function (st, i) {
        var hits = 0, n = 0;
        for (var j = 0; j < st.p.length; j += 2, n++) {
          if (inPolygon(st.p[j] * cv._w + cv._pl,
                        st.p[j + 1] * cv._h + cv._pt, poly)) hits++;
        }
        if (n && hits > n * 0.6) idx.push(i);
      });
      pick = idx.length ? { id: id, idx: idx } : null;
    }
    draw(d.card, true);
    onChange();
    return;
  }

  /* A drag moved ink that is already on the card: it has to reach the disk, and
     it is no longer the picture the tutor was handed. */
  if (d.moving) {
    drawing = null;
    if (d.dragged) {
      dirty[id] = true;
      handed[id] = false;
    }
    if (d.dmg) { repair(id, cv, d.dmg); d.dmg = null; }
    else draw(d.card, true);
    onChange();
    return;
  }

  /* The rubber's last frame may still be owed. */
  if (d.erasing && d.dmg) { repair(id, cv, d.dmg); d.dmg = null; }
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
    /* What the live pass put on the glass, which has to come off again whether
       the mark is kept or not: kept, because the polished line is not quite the
       one that was painted; thrown away, because a tap is not a mark. */
    var was = null;
    var seen = [d.raw, d.dense];
    for (var g = 0; g < seen.length; g++) {
      for (var i = 0; i < seen[g].length; i++) {
        var q = seen[g][i];
        was = grow(was, { x0: q[0], y0: q[1], x1: q[0], y1: q[1] });
      }
    }
    if (was) {
      var m = (d.stroke.w || pen.width) * 1.6 + 4;
      was.x0 -= m; was.y0 -= m; was.x1 += m; was.y1 += m;
    }
    /* Two points make a line, and a line is a mark. This wanted three, which
       threw away every flick short enough to be recorded in two -- and a tick
       beside a wrong line is exactly that flick. */
    if (d.raw.length < 2) {
      past.pop();                  /* a tap is not a mark, or an undo step */
      drawing = null;
      settle(d.card, cv, id, was); /* clear whatever dot was painted live */
      return;
    }
    store_stroke(d);
    d.dmg = grow(was, bboxOf(d.stroke, cv));
  }
  drawing = null;
  dirty[id] = true;
  handed[id] = false;
  settle(d.card, cv, id, d.dmg);
  d.dmg = null;
  onChange();
}

/* The layer, put right after a stroke.

   Only the rectangle the stroke touched -- a full repaint of the card was a
   noticeable cost at every pen lift on a card carrying a lot of ink, which is
   what "I try to write something out multiple times and a few seconds later the
   multiple writings all show up" is made of. The exception is a card that
   changed size WHILE the stroke was being drawn: its layer is measured against a
   geometry that no longer exists, and the whole thing has to be laid out and
   repainted. The resize observer cannot do it, because it is asleep for the
   duration of a stroke and will not fire again for a change it has already
   reported. */
function settle(card, cv, id, box) {
  if (card && card._annGrew) {
    card._annGrew = false;
    draw(card);
    return;
  }
  /* No rectangle means nothing on the glass is wrong -- the rubber's last frame
     has already been repaired, or the pen never painted anything. It does NOT
     mean "repaint the card": falling back to the whole canvas here undid the
     whole point of the rectangle, once per sweep of the rubber. */
  if (box) repair(id, cv, box);
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
        /* Not mid-stroke: relaying out the surface under a moving nib is worse
           than being a frame stale. Remembered rather than dropped, because this
           observer will not fire a second time for a change it has already
           reported -- `settle` picks it up when the pen lifts. */
        if (drawing && drawing.card === card) { card._annGrew = true; return; }
        if (size(card, canvas)) draw(card, true);
      });
      try { ro.observe(card); } catch (e) { /* not fatal */ }
    }
    canvas.addEventListener("pointerdown", function (e) { begin(e, card); });
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    /* The touch listeners are NOT here. They are one pair on the document, held
       only while they can do anything -- see `armTouch`. A non-passive pair per
       card, over the whole reading column, permanently, is what made scrolling
       and pinching stutter. */
    draw(card);
  },
  redrawAll: function () {
    var cards = document.querySelectorAll("[data-card]");
    Array.prototype.forEach.call(cards, function (c) {
      /* Never the card being written on: its ink is already on the glass, and
         repainting it from scratch is exactly the work that makes a line arrive
         after the nib. The resize case that needs it has its own guard. */
      if (drawing && drawing.card === c) return;
      /* Every card, INCLUDING the ones with nothing on them. A layer with no ink
         has no bitmap and nothing to repaint -- `draw` returns as soon as it
         knows that -- but it still has to be laid out: this element is what takes
         the pen, it reaches out to both edges of the window, and a window that
         has changed width leaves it covering somewhere the card no longer is.
         Skipping them here is the "margins are unwritable" defect in a new coat,
         and `test/link.js` holds the rule. */
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
    armTouch(on);
    if (!on) {
      penMode(false);
      dropPick();
    }
  },
  isOn: function () { return on; },
  setTool: function (t) {
    var next = (t === "erase" || t === "lasso") ? t : "pen";
    if (next !== tool && next !== "lasso") dropPick();
    tool = next;
  },
  tool: function () { return tool; },
  /* The lasso, the clipboard, and what is picked -- for the tool strip, which
     decides what to offer, and for the tests. */
  picked: function () { return pick ? pick.idx.length : 0; },
  pickedOn: function () { return pick ? pick.id : null; },
  deselect: function () { dropPick(); },
  copy: function () { return CLIP.copy(); },
  cut: function () { return CLIP.cut(); },
  paste: function () { return CLIP.paste(); },
  erase: function () { return CLIP.remove(); },
  /* Is a hand on the layer right now. The autosave asks before it spends the
     main thread serialising a card's ink. */
  busy: function () { return !!drawing; },
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
    pick = null;
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
    if (pick && pick.id === id) pick = null;
    remember(id);
    store[id] = [];
    dirty[id] = true;
    handed[id] = false;
    draw(document.querySelector('[data-card="' + id + '"]'));
    onChange();
  },
  payload: function (id, send) {
    /* The picture ONLY when it is actually going to the tutor.

       `png()` builds an offscreen canvas, repaints every stroke on it and
       PNG-encodes the result. That ran on every autosave -- which is about a
       second after every stroke, for every card with unsaved marks -- and on a
       tablet holding a long lesson it is hundreds of milliseconds of the main
       thread each time. Reported as: "HELLA laggy. I try to write something out
       multiple times and a few seconds later the multiple writings all show up
       overlapping." That is precisely what a blocked main thread looks like from
       behind a pen: the strokes were captured the whole time and nothing could
       paint them.

       Nothing read it. An autosave exists so a reload does not cost the marks,
       and what a reload restores is `strokes`; the server writes the file and
       `load_notes` never looks at it. The tutor reads the picture, and the tutor
       only sees marks that were sent. */
    return { card: id, strokes: store[id] || [], png: send ? png(id) : "",
             where: whereOn(id), send: !!send };
  },
  onChange: function (fn) { onChange = fn || function () {}; }
};

/* Coalesced to one repaint a frame. A resize arrives in bursts -- the iPad's
   keyboard sliding up, a rotation settling -- and each one of them used to
   repaint every marked card in the lesson. */
var redrawFrame = 0;
window.addEventListener("resize", function () {
  if (redrawFrame) return;
  redrawFrame = (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () {
    redrawFrame = 0;
    window.Annotate.redrawAll();
  });
});
})();
