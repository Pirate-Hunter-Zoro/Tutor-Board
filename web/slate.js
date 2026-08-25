/* ==========================================================================
   slate.js -- the writing surface.

   Strokes are vectors, not pixels. That is what makes the editing work: a lasso
   can select them, a selection can be moved or recoloured or cut and pasted,
   undo can restore them exactly, and the page can be zoomed without going soft.

   Every page is saved twice -- the strokes as JSON so it reopens anywhere, and a
   PNG of dark ink on white paper, which is the file the tutor actually reads.

   What this deliberately does NOT do is recognise handwriting. Turning ink into
   text or into LaTeX needs a trained recogniser; apps that do it well license an
   engine built for the job. Here the recogniser is the tutor, who reads the
   image, so the ink only ever has to be legible to a person.
   ========================================================================== */

(function () {
"use strict";

var LOGICAL_W = 1600;
var AUTOSAVE_MS = 1200;
var LIVE_IDLE_MS = 3000;
var LIVE_MIN_GAP_MS = 15000;
var UNDO_DEPTH = 60;

var sheet = document.getElementById("sheet");
var ctx = sheet.getContext("2d");
var wrap = document.getElementById("sheetwrap");
var savedTag = document.getElementById("saved");
var pageTag = document.getElementById("pageno");
var zoomTag = document.getElementById("zoomlevel");
var selbar = document.getElementById("selbar");
var toastEl = document.getElementById("toast");

/* ------------------------------------------------------------------ model */
/* stroke: { c: colour, w: nib, hl: highlighter?, pts: [[x, y, pressure], ...] } */
var pages = [];
var current = 0;
var undoStack = [];
var redoStack = [];
var clipboard = [];

var tool = { mode: "pen", color: "#16171a", width: 1.6, ruled: "grid", live: false };

var drawing = null;      /* stroke in progress */
var lasso = null;        /* polygon in progress */
var sel = null;          /* { idx: [...], dx, dy } */
var dragging = null;     /* { x, y } while a selection is being moved */
var penSeen = false;
var dirty = false;
var lastLiveSend = 0;
var saveTimer = null, liveTimer = null;

function page() { return pages[current]; }

function blankPage() {
  var aspect = Math.min(1.8, Math.max(0.62, wrap.clientHeight / Math.max(1, wrap.clientWidth)));
  return { w: LOGICAL_W, h: Math.round(LOGICAL_W * aspect), strokes: [] };
}

/* ------------------------------------------------------------------ undo */
function snapshot() {
  undoStack.push(JSON.stringify(page().strokes));
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
  redoStack.length = 0;
}
function restore(stack, other) {
  if (!stack.length) return;
  other.push(JSON.stringify(page().strokes));
  page().strokes = JSON.parse(stack.pop());
  clearSelection();
  markDirty();
  redraw();
}

/* ------------------------------------------------------------------ view */
/* screen = logical * k + offset, in CSS pixels. */
var view = { k: 1, fit: 1, ox: 0, oy: 0 };

function fitPage() {
  var p = page();
  view.fit = Math.min((wrap.clientWidth - 16) / p.w, (wrap.clientHeight - 16) / p.h);
  view.k = view.fit;
  centre();
}
function centre() {
  var p = page();
  view.ox = (wrap.clientWidth - p.w * view.k) / 2;
  view.oy = (wrap.clientHeight - p.h * view.k) / 2;
  clampView();
}
function clampView() {
  /* Always leave a good part of the page on screen; getting lost in empty
     space is the classic way a zoomable canvas becomes unusable. */
  var p = page(), m = 80;
  var w = p.w * view.k, h = p.h * view.k;
  view.ox = Math.min(wrap.clientWidth - m, Math.max(m - w, view.ox));
  view.oy = Math.min(wrap.clientHeight - m, Math.max(m - h, view.oy));
}

function layout() {
  var dpr = Math.min(window.devicePixelRatio || 1, 3);
  var cssW = wrap.clientWidth, cssH = wrap.clientHeight;
  sheet.style.width = cssW + "px";
  sheet.style.height = cssH + "px";
  sheet.width = Math.round(cssW * dpr);
  sheet.height = Math.round(cssH * dpr);
  redraw();
}

function toLogical(ev) {
  var r = sheet.getBoundingClientRect();
  return {
    x: (ev.clientX - r.left - view.ox) / view.k,
    y: (ev.clientY - r.top - view.oy) / view.k,
    p: ev.pressure > 0 ? ev.pressure : 0.5
  };
}

function setZoom(k, cx, cy) {
  var p = page();
  k = Math.max(view.fit * 0.5, Math.min(view.fit * 8, k));
  var r = sheet.getBoundingClientRect();
  if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
  /* keep the point under the fingers fixed */
  var lx = (cx - view.ox) / view.k, ly = (cy - view.oy) / view.k;
  view.k = k;
  view.ox = cx - lx * view.k;
  view.oy = cy - ly * view.k;
  clampView();
  zoomTag.textContent = Math.round(view.k / view.fit * 100) + "%";
  redraw();
}

/* ------------------------------------------------------------------ paint */
function paintPaper(c, p) {
  c.fillStyle = "#fdfdfb";
  c.fillRect(0, 0, p.w, p.h);
  if (tool.ruled === "blank") return;
  c.strokeStyle = "#dfe6ee";
  c.lineWidth = 1 / view.k;
  c.beginPath();
  for (var y = 50; y < p.h; y += 50) { c.moveTo(0, y); c.lineTo(p.w, y); }
  if (tool.ruled === "grid") for (var x = 50; x < p.w; x += 50) { c.moveTo(x, 0); c.lineTo(x, p.h); }
  c.stroke();
}

function paintStroke(c, s) {
  var pts = s.pts;
  if (!pts.length) return;
  c.save();
  if (s.hl) {
    /* Multiply keeps a highlighter behaving like ink on paper: overlapping
       passes darken, and whatever is underneath still shows through. */
    c.globalAlpha = 0.32;
    c.globalCompositeOperation = "multiply";
  }
  c.strokeStyle = s.c;
  c.fillStyle = s.c;
  c.lineCap = "round";
  c.lineJoin = "round";
  var base = s.hl ? s.w * 6 : s.w;
  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0][0], pts[0][1], base * (0.55 + 0.9 * pts[0][2]) / 2, 0, Math.PI * 2);
    c.fill();
    c.restore();
    return;
  }
  for (var i = 1; i < pts.length; i++) {
    var a = pts[i - 1], b = pts[i];
    c.lineWidth = s.hl ? base : base * (0.55 + 0.9 * ((a[2] + b[2]) / 2));
    c.beginPath();
    if (i === 1) c.moveTo(a[0], a[1]);
    else {
      var prev = pts[i - 2];
      c.moveTo((prev[0] + a[0]) / 2, (prev[1] + a[1]) / 2);
    }
    c.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    c.stroke();
  }
  c.restore();
}

function selectionBounds() {
  if (!sel || !sel.idx.length) return null;
  var p = page(), x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  sel.idx.forEach(function (i) {
    var pts = p.strokes[i].pts;
    for (var n = 0; n < pts.length; n++) {
      if (pts[n][0] < x0) x0 = pts[n][0];
      if (pts[n][0] > x1) x1 = pts[n][0];
      if (pts[n][1] < y0) y0 = pts[n][1];
      if (pts[n][1] > y1) y1 = pts[n][1];
    }
  });
  return { x0: x0, y0: y0, x1: x1, y1: y1 };
}

function redraw() {
  var p = page();
  var dpr = Math.min(window.devicePixelRatio || 1, 3);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, sheet.width, sheet.height);
  ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.ox, dpr * view.oy);

  paintPaper(ctx, p);
  /* highlighter first, so ink always sits on top of it */
  p.strokes.forEach(function (s) { if (s.hl) paintStroke(ctx, s); });
  p.strokes.forEach(function (s) { if (!s.hl) paintStroke(ctx, s); });
  if (drawing) paintStroke(ctx, drawing);

  if (lasso && lasso.length > 1) {
    ctx.save();
    ctx.strokeStyle = "#1a56b0";
    ctx.lineWidth = 1.5 / view.k;
    ctx.setLineDash([6 / view.k, 5 / view.k]);
    ctx.beginPath();
    ctx.moveTo(lasso[0][0], lasso[0][1]);
    for (var i = 1; i < lasso.length; i++) ctx.lineTo(lasso[i][0], lasso[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  var b = selectionBounds();
  if (b) {
    ctx.save();
    var pad = 10 / view.k;
    ctx.strokeStyle = "#1a56b0";
    ctx.lineWidth = 1.5 / view.k;
    ctx.setLineDash([7 / view.k, 5 / view.k]);
    ctx.strokeRect(b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + pad * 2, b.y1 - b.y0 + pad * 2);
    ctx.restore();
  }

  pageTag.textContent = (current + 1) + "/" + pages.length;
  zoomTag.textContent = Math.round(view.k / view.fit * 100) + "%";
  document.getElementById("prev").disabled = current === 0;
  document.getElementById("next").disabled = current === pages.length - 1;
  document.getElementById("undo").disabled = !undoStack.length;
  document.getElementById("redo").disabled = !redoStack.length;
  selbar.hidden = !(sel && sel.idx.length);
}

/* --------------------------------------------------------------- geometry */
function inPolygon(x, y, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function selectByLasso(poly) {
  var p = page();
  var idx = [];
  p.strokes.forEach(function (s, i) {
    var hits = 0;
    for (var n = 0; n < s.pts.length; n++) {
      if (inPolygon(s.pts[n][0], s.pts[n][1], poly)) hits++;
    }
    /* Most of the stroke has to be inside, so clipping a neighbouring letter
       with the edge of the loop does not drag it along. */
    if (hits > s.pts.length * 0.6) idx.push(i);
  });
  sel = idx.length ? { idx: idx } : null;
  if (!idx.length) toast("nothing inside the loop");
}

function clearSelection() { sel = null; lasso = null; selbar.hidden = true; }

function pointInSelection(x, y) {
  var b = selectionBounds();
  if (!b) return false;
  var pad = 12 / view.k;
  return x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;
}

/* ------------------------------------------------------------------ input */
function eraseAt(pt) {
  var p = page();
  var r = 14 / view.k * (tool.width / 1.6);
  var before = p.strokes.length;
  p.strokes = p.strokes.filter(function (s) {
    for (var i = 0; i < s.pts.length; i++) {
      var dx = s.pts[i][0] - pt.x, dy = s.pts[i][1] - pt.y;
      if (dx * dx + dy * dy < r * r) return false;
    }
    return true;
  });
  if (p.strokes.length !== before) { markDirty(); redraw(); }
}

/* Fingers pan and pinch; the pen writes. Once a pen has been seen, a finger
   never draws again -- that is the whole of palm rejection. */
var touches = {};
var pinch = null;

function isPen(ev) { return ev.pointerType === "pen"; }
function fingerGesture(ev) { return ev.pointerType !== "pen" && penSeen; }

sheet.addEventListener("pointerdown", function (ev) {
  if (isPen(ev)) penSeen = true;
  ev.preventDefault();
  sheet.setPointerCapture(ev.pointerId);

  if (fingerGesture(ev) || ev.pointerType === "touch") {
    touches[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var ids = Object.keys(touches);
    if (ids.length === 2) {
      var a = touches[ids[0]], b = touches[ids[1]];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    }
    if (penSeen) return;              /* finger only pans once a pen is in use */
  }

  var pt = toLogical(ev);

  if (tool.mode === "erase") { snapshot(); eraseAt(pt); drawing = "erasing"; return; }

  if (sel && pointInSelection(pt.x, pt.y)) {
    snapshot();
    dragging = { x: pt.x, y: pt.y };
    return;
  }

  if (tool.mode === "lasso") { clearSelection(); lasso = [[pt.x, pt.y]]; return; }

  clearSelection();
  drawing = {
    c: tool.color,
    w: tool.width,
    hl: tool.mode === "hl",
    pts: [[pt.x, pt.y, pt.p]]
  };
});

sheet.addEventListener("pointermove", function (ev) {
  if (touches[ev.pointerId]) {
    var prev = touches[ev.pointerId];
    touches[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
    var ids = Object.keys(touches);
    if (ids.length === 2 && pinch) {
      var a = touches[ids[0]], b = touches[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      var r = sheet.getBoundingClientRect();
      setZoom(pinch.k * (d / pinch.d),
              (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    if (ids.length === 1 && !drawing && !lasso && !dragging) {
      view.ox += ev.clientX - prev.x;
      view.oy += ev.clientY - prev.y;
      clampView();
      redraw();
      return;
    }
  }
  if (fingerGesture(ev)) return;

  var pt;
  if (dragging) {
    pt = toLogical(ev);
    var dx = pt.x - dragging.x, dy = pt.y - dragging.y;
    dragging = { x: pt.x, y: pt.y };
    var p = page();
    sel.idx.forEach(function (i) {
      var s = p.strokes[i];
      for (var n = 0; n < s.pts.length; n++) { s.pts[n][0] += dx; s.pts[n][1] += dy; }
    });
    redraw();
    return;
  }
  if (drawing === "erasing") { eraseAt(toLogical(ev)); return; }
  if (lasso) {
    pt = toLogical(ev);
    lasso.push([pt.x, pt.y]);
    redraw();
    return;
  }
  if (!drawing) return;

  ev.preventDefault();
  var evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
  for (var i = 0; i < evs.length; i++) {
    var q = toLogical(evs[i]);
    var last = drawing.pts[drawing.pts.length - 1];
    if (Math.abs(q.x - last[0]) < 0.4 && Math.abs(q.y - last[1]) < 0.4) continue;
    drawing.pts.push([Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10,
                      Math.round(q.p * 100) / 100]);
  }
  redraw();
});

function endStroke(ev) {
  if (ev && touches[ev.pointerId]) {
    delete touches[ev.pointerId];
    if (Object.keys(touches).length < 2) pinch = null;
  }
  if (dragging) { dragging = null; markDirty(); redraw(); return; }
  if (lasso) {
    if (lasso.length > 4) selectByLasso(lasso);
    lasso = null;
    redraw();
    return;
  }
  if (!drawing) return;
  if (drawing !== "erasing" && drawing.pts.length) {
    snapshot();
    page().strokes.push(drawing);
  }
  drawing = null;
  markDirty();
  redraw();
}
sheet.addEventListener("pointerup", endStroke);
sheet.addEventListener("pointercancel", endStroke);
sheet.addEventListener("pointerleave", endStroke);

["touchstart", "touchmove", "touchend", "gesturestart", "gesturechange"].forEach(function (t) {
  sheet.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
});

sheet.addEventListener("wheel", function (e) {
  if (!(e.ctrlKey || e.metaKey)) return;      /* trackpad pinch arrives as ctrl+wheel */
  e.preventDefault();
  var r = sheet.getBoundingClientRect();
  setZoom(view.k * (e.deltaY < 0 ? 1.08 : 0.93), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

/* ------------------------------------------------------------- selection */
function selectedStrokes() {
  var p = page();
  return sel ? sel.idx.map(function (i) { return JSON.parse(JSON.stringify(p.strokes[i])); }) : [];
}

function offsetStrokes(list, dx, dy) {
  list.forEach(function (s) {
    for (var n = 0; n < s.pts.length; n++) { s.pts[n][0] += dx; s.pts[n][1] += dy; }
  });
  return list;
}

function deleteSelection() {
  var p = page();
  var drop = {};
  sel.idx.forEach(function (i) { drop[i] = true; });
  p.strokes = p.strokes.filter(function (_, i) { return !drop[i]; });
  clearSelection();
}

var ACTIONS = {
  copy: function () {
    clipboard = selectedStrokes();
    toast(clipboard.length + " strokes copied");
  },
  cut: function () {
    clipboard = selectedStrokes();
    snapshot();
    deleteSelection();
    markDirty();
    toast(clipboard.length + " strokes cut");
  },
  paste: function () {
    if (!clipboard.length) { toast("nothing copied yet"); return; }
    snapshot();
    var p = page();
    var add = offsetStrokes(JSON.parse(JSON.stringify(clipboard)), 30, 30);
    var start = p.strokes.length;
    add.forEach(function (s) { p.strokes.push(s); });
    sel = { idx: add.map(function (_, n) { return start + n; }) };
    markDirty();
  },
  duplicate: function () {
    ACTIONS.copy();
    ACTIONS.paste();
  },
  colour: function () {
    snapshot();
    var p = page();
    sel.idx.forEach(function (i) { p.strokes[i].c = tool.color; });
    markDirty();
  },
  delete: function () {
    snapshot();
    deleteSelection();
    markDirty();
  },
  done: function () { clearSelection(); }
};

Array.prototype.forEach.call(selbar.querySelectorAll("button"), function (b) {
  b.onclick = function () {
    var act = ACTIONS[b.dataset.act];
    if (!act) return;
    if (b.dataset.act !== "paste" && b.dataset.act !== "done" && !(sel && sel.idx.length)) return;
    act();
    redraw();
  };
});

/* ------------------------------------------------------------------ export */
function pageToPNG(p) {
  var c = document.createElement("canvas");
  c.width = p.w;
  c.height = p.h;
  var g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, p.w, p.h);
  if (tool.ruled !== "blank") {
    g.strokeStyle = "#eef2f6";
    g.lineWidth = 1;
    g.beginPath();
    for (var y = 50; y < p.h; y += 50) { g.moveTo(0, y); g.lineTo(p.w, y); }
    if (tool.ruled === "grid") for (var x = 50; x < p.w; x += 50) { g.moveTo(x, 0); g.lineTo(x, p.h); }
    g.stroke();
  }
  var k = view.k; view.k = 1;                 /* paint at true size, not zoomed */
  p.strokes.forEach(function (s) { if (s.hl) paintStroke(g, s); });
  p.strokes.forEach(function (s) { if (!s.hl) paintStroke(g, s); });
  view.k = k;
  return c.toDataURL("image/png");
}

/* ------------------------------------------------------------------- save */
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
    body: JSON.stringify({
      page: current + 1, w: p.w, h: p.h, strokes: p.strokes,
      png: pageToPNG(p), send: !!send, pages: pages.length
    })
  }).then(function (r) { return r.json(); }).then(function () {
    dirty = false;
    savedTag.classList.remove("busy");
    savedTag.textContent = send ? "sent" : "saved";
    if (send) {
      lastLiveSend = Date.now();
      if (!quiet) toast("page " + (current + 1) + " sent for review");
    }
  }).catch(function () {
    savedTag.classList.remove("busy");
    savedTag.textContent = "offline";
  });
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(function () { toastEl.hidden = true; }, 2000);
}

/* ------------------------------------------------------------------ chrome */
function selectIn(groupId, el) {
  Array.prototype.forEach.call(document.getElementById(groupId).children, function (c) {
    c.classList.remove("sel");
  });
  el.classList.add("sel");
}

Array.prototype.forEach.call(document.querySelectorAll(".mode"), function (b) {
  b.onclick = function () {
    tool.mode = b.dataset.tool;
    selectIn("modes", b);
    if (tool.mode !== "lasso") clearSelection();
    document.body.dataset.tool = tool.mode;
    redraw();
  };
});
Array.prototype.forEach.call(document.querySelectorAll(".nib"), function (b) {
  b.onclick = function () { tool.width = parseFloat(b.dataset.w); selectIn("nibs", b); };
});
Array.prototype.forEach.call(document.querySelectorAll(".ink"), function (b) {
  b.onclick = function () {
    tool.color = b.dataset.c;
    selectIn("inks", b);
    /* Choosing a colour with something selected recolours it -- the obvious
       reading of the gesture, and it saves a trip to the selection bar. */
    if (sel && sel.idx.length) { ACTIONS.colour(); redraw(); }
  };
});

document.getElementById("undo").onclick = function () { restore(undoStack, redoStack); };
document.getElementById("redo").onclick = function () { restore(redoStack, undoStack); };
document.getElementById("zoom-in").onclick = function () { setZoom(view.k * 1.25); };
document.getElementById("zoom-out").onclick = function () { setZoom(view.k / 1.25); };
document.getElementById("zoom-fit").onclick = function () { fitPage(); redraw(); };
document.getElementById("rule").onclick = function () {
  tool.ruled = tool.ruled === "grid" ? "lined" : (tool.ruled === "lined" ? "blank" : "grid");
  this.textContent = tool.ruled;
  markDirty();
  redraw();
};
document.getElementById("taller").onclick = function () {
  snapshot();
  page().h += Math.round(LOGICAL_W * 0.5);
  markDirty();
  fitPage();
  redraw();
};
document.getElementById("prev").onclick = function () { goto(current - 1); };
document.getElementById("next").onclick = function () { goto(current + 1); };
document.getElementById("addpage").onclick = function () {
  pages.push(blankPage());
  goto(pages.length - 1);
};
document.getElementById("send").onclick = function () { save(true); };
document.getElementById("live").onclick = function () {
  tool.live = !tool.live;
  this.classList.toggle("on", tool.live);
  toast(tool.live ? "the tutor sees each page as you pause" : "sending only when you tap review");
};

function goto(n) {
  if (n < 0 || n >= pages.length) return;
  if (dirty) save(false);
  current = n;
  undoStack.length = 0;
  redoStack.length = 0;
  clearSelection();
  fitPage();
  redraw();
}

document.addEventListener("keydown", function (e) {
  var meta = e.metaKey || e.ctrlKey;
  if (!meta) return;
  var k = e.key.toLowerCase();
  if (k === "z") { e.preventDefault(); e.shiftKey ? restore(redoStack, undoStack) : restore(undoStack, redoStack); }
  else if (k === "c" && sel) { e.preventDefault(); ACTIONS.copy(); }
  else if (k === "x" && sel) { e.preventDefault(); ACTIONS.cut(); redraw(); }
  else if (k === "v") { e.preventDefault(); ACTIONS.paste(); redraw(); }
  else if (k === "d" && sel) { e.preventDefault(); ACTIONS.duplicate(); redraw(); }
});
document.addEventListener("keydown", function (e) {
  if ((e.key === "Backspace" || e.key === "Delete") && sel) {
    e.preventDefault();
    ACTIONS.delete();
    redraw();
  }
});

window.addEventListener("resize", function () { layout(); fitPage(); redraw(); });
window.addEventListener("orientationchange", function () {
  setTimeout(function () { layout(); fitPage(); redraw(); }, 250);
});
window.addEventListener("beforeunload", function () { if (dirty) save(false); });

/* ------------------------------------------------------------------ boot */
function showPrompt() {
  fetch("/board.json").then(function (r) { return r.json(); }).then(function (d) {
    var cards = d.cards || [];
    for (var i = cards.length - 1; i >= 0; i--) {
      if (cards[i].kind === "question") {
        var el = document.getElementById("prompt");
        el.querySelector(".kind").textContent = "answering";
        el.querySelector(".text").textContent = cards[i].title || ("card " + cards[i].id);
        el.hidden = false;
        return;
      }
    }
  }).catch(function () {});
}

fetch("/slate/state").then(function (r) { return r.json(); }).then(function (d) {
  pages = (d.pages || []).filter(function (p) { return p && p.w && p.h; });
  if (!pages.length) pages = [blankPage()];
  current = pages.length - 1;
  layout();
  fitPage();
  redraw();
  savedTag.textContent = "saved";
}).catch(function () {
  pages = [blankPage()];
  layout();
  fitPage();
  redraw();
});

document.body.dataset.tool = "pen";
showPrompt();

/* ------------------------------------------------------------------ PWA */
if ("serviceWorker" in navigator && window.isSecureContext) {
  var hadController = !!navigator.serviceWorker.controller;
  var reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function (reg) {
      function check() { if (!document.hidden) { try { reg.update(); } catch (e) {} } }
      document.addEventListener("visibilitychange", check);
      window.addEventListener("pageshow", check);
      window.addEventListener("focus", check);
    }).catch(function () {});
  });
}
})();
