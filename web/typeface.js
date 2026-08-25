/* ==========================================================================
   typeface.js -- pick the reading face, and remember it.

   Shared by every page so the choice follows you from the hub to the lesson to
   the slate. Runs before anything else on the page, so there is no flash of the
   wrong face while the rest of the script boots.
   ========================================================================== */

(function () {
"use strict";

var KEY = "board.face";
var ORDER = ["dyslexic", "hyperlegible", "serif"];
var LABEL = { dyslexic: "OpenDyslexic", hyperlegible: "Hyperlegible", serif: "Serif" };

function apply(face) {
  if (ORDER.indexOf(face) === -1) face = ORDER[0];
  document.body.dataset.face = face;
  try { localStorage.setItem(KEY, face); } catch (e) {}
  var btn = document.getElementById("btn-face");
  if (btn) btn.title = "typeface: " + LABEL[face] + " — tap to change";
  return face;
}

function current() {
  try {
    return localStorage.getItem(KEY) || ORDER[0];
  } catch (e) {
    return ORDER[0];
  }
}

window.BoardTypeface = {
  init: function () {
    var face = apply(current());
    var btn = document.getElementById("btn-face");
    if (btn) {
      btn.onclick = function () {
        apply(ORDER[(ORDER.indexOf(document.body.dataset.face) + 1) % ORDER.length]);
      };
    }
    return face;
  },
};

/* The body may not exist yet depending on where this is included. */
if (document.body) window.BoardTypeface.init();
else document.addEventListener("DOMContentLoaded", function () { window.BoardTypeface.init(); });
})();
