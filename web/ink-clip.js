/* ==========================================================================
   ink-clip.js -- one clipboard, for every surface that holds handwriting.

   There are three writing surfaces in this app and they used to have three
   clipboards. The slate's was a variable inside `create`, so every mounted
   instance had its own: the full-screen page at /slate and the drawer under the
   question on the board are two instances, which made "copy here, paste there"
   a copy into a bucket nobody else could see. The annotation layer had no
   clipboard at all, so a line of working written over the tutor's own words
   could only ever stay there.

   That is the wrong shape for the thing being carried. Ink cut out of a proof is
   not a property of the surface it was cut from -- it is a property of the
   person holding the pen, who is in the middle of moving it somewhere else. So
   there is one clipboard, it lives here, and every surface reads and writes it.

   WHAT IS ON IT IS GEOMETRY, NOT A SURFACE'S OWN COORDINATES. The slate stores
   strokes in logical page units, which are CSS pixels at 100% zoom; the
   annotation layer stores them as fractions of the card they are anchored to,
   because a lesson reflows and ink about a word has to move with the word. Those
   two cannot be assigned to each other. A clip is therefore neither: it is CSS
   pixels with its own top-left corner at the origin, which both surfaces can
   convert to and from, and which means a mark keeps the size it looked on the
   glass when it crosses between them.

   It is also written to `localStorage`, so the clipboard survives the one thing
   that is not a copy between two live surfaces: opening /slate, which is a
   navigation, and coming back.
   ========================================================================== */

(function () {
"use strict";

var KEY = "tutor-board.clip";
/* What will be written to disk. A clip is ink somebody is carrying between two
   surfaces in the next few seconds -- there is no reason for it to be able to
   fill the origin's storage allowance, which the app itself lives in, and a
   quota error there is thrown at whoever is writing when the cache is full. Over
   this a clip is still held in memory and still pastes; it just does not survive
   a navigation. */
var MAX_BYTES = 300000;
/* And what will be held at all. Selecting a whole page of a proof and copying it
   is a legitimate thing to do; holding a hundred thousand points of it in a
   string is not, and pasting it would be a second page nobody can draw. */
var MAX_PTS = 60000;

/* The newest of the two. In memory is authoritative while this document is the
   one doing the copying; the stored copy is what a navigation or another tab
   left behind. Whichever was written later is the clipboard. */
var held = null;
var listeners = [];

function fire() {
  for (var i = 0; i < listeners.length; i++) {
    try { listeners[i](); } catch (e) { /* a bar that cannot repaint is not fatal */ }
  }
}

function stored() {
  try {
    var raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    var clip = JSON.parse(raw);
    return valid(clip) ? clip : null;
  } catch (e) { return null; }   /* private mode, or somebody else's key */
}

function valid(clip) {
  return !!clip && clip.v === 1 && clip.strokes && clip.strokes.length > 0;
}

function count(clip) {
  var n = 0;
  for (var i = 0; i < clip.strokes.length; i++) {
    n += ((clip.strokes[i].pts || []).length);
  }
  return n;
}

/* The extent of the ink, so the clip can be normalised to its own corner. Every
   surface places a paste by where it wants the CORNER of the thing to land, and
   none of them cares where it came from. */
function boxOf(strokes) {
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (var i = 0; i < strokes.length; i++) {
    var pts = strokes[i].pts || [];
    for (var n = 0; n < pts.length; n++) {
      if (pts[n][0] < x0) x0 = pts[n][0];
      if (pts[n][0] > x1) x1 = pts[n][0];
      if (pts[n][1] < y0) y0 = pts[n][1];
      if (pts[n][1] > y1) y1 = pts[n][1];
    }
  }
  if (!isFinite(x0)) return null;
  return { x0: x0, y0: y0, x1: x1, y1: y1 };
}

window.InkClip = {
  /* Put ink on the clipboard.
  
     `strokes` are in CSS pixels, in whatever frame the caller measured them in;
     they are moved to their own corner here so that nothing downstream has to
     know where they were. `kind` and `src` are the surface and the instance they
     came from, and they exist for one reason: a paste back into the SAME surface
     is a duplicate, which wants to land beside the original, and a paste into a
     different one wants to land where the person is looking. */
  put: function (strokes, meta) {
    strokes = (strokes || []).filter(function (s) {
      return s && s.pts && s.pts.length;
    });
    if (!strokes.length) return null;
    var b = boxOf(strokes);
    if (!b) return null;
    meta = meta || {};
    var clip = {
      v: 1, at: Date.now(),
      kind: meta.kind || "slate", src: meta.src || "",
      /* Where it was, in the source's own units, so a duplicate can be offset
         from the original rather than dropped in the middle of the view. */
      ox: b.x0, oy: b.y0,
      w: Math.max(1, b.x1 - b.x0), h: Math.max(1, b.y1 - b.y0),
      strokes: strokes.map(function (s) {
        return {
          c: s.c, w: s.w, hl: !!s.hl,
          pts: s.pts.map(function (q) {
            return [Math.round((q[0] - b.x0) * 10) / 10,
                    Math.round((q[1] - b.y0) * 10) / 10,
                    q.length > 2 ? Math.round(q[2] * 100) / 100 : 0.5];
          }),
        };
      }),
    };
    if (count(clip) > MAX_PTS) return null;
    held = clip;
    var body = "";
    try { body = JSON.stringify(clip); } catch (e) { body = ""; }
    if (body && body.length <= MAX_BYTES) {
      try { window.localStorage.setItem(KEY, body); } catch (e) { /* full, or private */ }
    }
    fire();
    return clip;
  },

  /* What is on the clipboard, or null. Deep-copied on the way out: a paste
     mutates what it is given -- it is placed, and then it is dragged -- and the
     clipboard has to be able to be pasted twice. */
  get: function () {
    var disk = stored();
    var clip = held;
    if (disk && (!clip || disk.at > clip.at)) clip = disk;
    if (!valid(clip)) return null;
    held = clip;
    return JSON.parse(JSON.stringify(clip));
  },

  /* For a bar deciding whether to offer Paste at all. Cheap enough to ask on
     every repaint: the stored copy is only parsed when this document has not
     done the copying itself. */
  has: function () { return !!window.InkClip.peek(); },
  peek: function () {
    var disk = stored();
    var clip = held;
    if (disk && (!clip || disk.at > clip.at)) clip = disk;
    return valid(clip) ? clip : null;
  },
  count: function () {
    var clip = window.InkClip.peek();
    return clip ? clip.strokes.length : 0;
  },
  clear: function () {
    held = null;
    try { window.localStorage.removeItem(KEY); } catch (e) {}
    fire();
  },
  onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
};

/* Another document in this browser copied something. Only ever news -- there is
   nothing to do but let the bars offer Paste. */
window.addEventListener("storage", function (ev) {
  if (ev && ev.key && ev.key !== KEY) return;
  held = null;
  fire();
});
})();
