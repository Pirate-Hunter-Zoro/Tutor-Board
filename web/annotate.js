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
var store = Object.create(null);      /* card id -> [stroke, ...] */
var dirty = Object.create(null);      /* card ids with unsaved changes */
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
   soft on exactly the screens this is meant for. */
function size(card, canvas) {
  var r = card.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (canvas._w === w && canvas._h === h && canvas._dpr === dpr) return false;
  canvas._w = w; canvas._h = h; canvas._dpr = dpr;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  return true;
}

function draw(card) {
  var id = card.dataset.card;
  if (!id) return;
  var canvas = layerOf(card);
  size(card, canvas);
  var ctx = canvas.getContext("2d");
  if (!ctx) return;
  var dpr = canvas._dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas._w, canvas._h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  (store[id] || []).forEach(function (s) {
    if (!s.p || s.p.length < 2) return;
    ctx.strokeStyle = s.c || pen.colour;
    ctx.lineWidth = (s.w || pen.width);
    ctx.beginPath();
    for (var i = 0; i < s.p.length; i += 2) {
      var x = s.p[i] * canvas._w, y = s.p[i + 1] * canvas._h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
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
       to be legible to whatever opens it. */
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = (s.w || pen.width) * 1.3;
    ctx.beginPath();
    for (var i = 0; i < s.p.length; i += 2) {
      var x = s.p[i] * live._w, y = s.p[i + 1] * live._h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
  try { return out.toDataURL("image/png"); } catch (e) { return ""; }
}

var drawing = null;

function begin(ev, card) {
  if (!on) return;
  var id = card.dataset.card;
  if (!id) return;
  var canvas = layerOf(card);
  var r = canvas.getBoundingClientRect();
  drawing = { id: id, card: card, stroke: { c: pen.colour, w: pen.width, p: [] } };
  strokesFor(id).push(drawing.stroke);
  add(ev, r);
  try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* not fatal */ }
  ev.preventDefault();
}

function add(ev, r) {
  if (!drawing) return;
  var x = (ev.clientX - r.left) / Math.max(1, r.width);
  var y = (ev.clientY - r.top) / Math.max(1, r.height);
  drawing.stroke.p.push(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
}

function move(ev) {
  if (!on || !drawing) return;
  var canvas = layerOf(drawing.card);
  add(ev, canvas.getBoundingClientRect());
  draw(drawing.card);
  ev.preventDefault();
}

function end() {
  if (!drawing) return;
  var id = drawing.id;
  if (drawing.stroke.p.length < 4) strokesFor(id).pop();   /* a tap is not a mark */
  drawing = null;
  dirty[id] = true;
  draw(document.querySelector('[data-card="' + id + '"]'));
  onChange();
}

window.Annotate = {
  /* Attach to a card node. Idempotent: the lesson is reconciled, so the same
     node comes back frame after frame and must not collect listeners. */
  attach: function (card) {
    if (!card || !card.dataset.card || card._annotated) return;
    card._annotated = true;
    var canvas = layerOf(card);
    canvas.addEventListener("pointerdown", function (e) { begin(e, card); });
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    draw(card);
  },
  redrawAll: function () {
    var cards = document.querySelectorAll("[data-card]");
    Array.prototype.forEach.call(cards, function (c) { draw(c); });
  },
  load: function (notes) {
    if (!notes) return;
    Object.keys(notes).forEach(function (id) {
      /* Never overwrite marks the student is in the middle of making. */
      if (!dirty[id]) store[id] = notes[id] || [];
    });
    window.Annotate.redrawAll();
  },
  setOn: function (v) {
    on = !!v;
    document.body.classList.toggle("annotating", on);
  },
  isOn: function () { return on; },
  setPen: function (colour, width) {
    if (colour) pen.colour = colour;
    if (width) pen.width = width;
  },
  /* Which cards carry marks, and which of those are unsaved. */
  marked: function () { return Object.keys(store).filter(function (id) { return (store[id] || []).length; }); },
  unsaved: function () { return Object.keys(dirty); },
  clean: function (id) { delete dirty[id]; },
  clear: function (id) {
    store[id] = [];
    dirty[id] = true;
    draw(document.querySelector('[data-card="' + id + '"]'));
    onChange();
  },
  payload: function (id, send) {
    return { card: id, strokes: store[id] || [], png: png(id),
             where: whereOn(id), send: !!send };
  },
  onChange: function (fn) { onChange = fn || function () {}; }
};

window.addEventListener("resize", function () { window.Annotate.redrawAll(); });
})();
