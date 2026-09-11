/* ==========================================================================
   home.js -- the front door.

   Reads the current board's state and the list of courses found on disk. The
   only clever part is switching: a course other than the current one lives on a
   different port, and the installed app has exactly one origin baked into it, so
   the browser cannot simply navigate there. Instead it asks the server to move
   the board -- start that repository's server and re-point the HTTPS proxy at
   it -- and then reloads. The address never changes.
   ========================================================================== */

(function () {
"use strict";

var els = {
  dot: document.getElementById("dot"),
  eyebrow: document.getElementById("hero-eyebrow"),
  course: document.getElementById("hero-course"),
  chapter: document.getElementById("hero-chapter"),
  count: document.getElementById("hero-count"),
  slateSub: document.getElementById("hero-slate"),
  waiting: document.getElementById("waiting"),
  waitingText: document.getElementById("waiting-text"),
  othersWrap: document.getElementById("others-wrap"),
  others: document.getElementById("others"),
  pastWrap: document.getElementById("past-wrap"),
  past: document.getElementById("past"),
  where: document.getElementById("where"),
  busy: document.getElementById("busy"),
  busyText: document.getElementById("busy-text"),
  busySub: document.getElementById("busy-sub")
};

function plural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

function ago(t) {
  if (!t) return "";
  var s = Math.max(0, Date.now() / 1000 - t);
  if (s < 90) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
}

/* ------------------------------------------------------------ the current */
function paintBoard(d) {
  var st = d.state || {};
  var cards = d.cards || [];

  els.course.textContent = st.course || "No lesson open";
  els.chapter.textContent = st.chapter || "";
  document.title = st.course ? st.course + " · Board" : "Board";

  if (cards.length) {
    var last = cards[cards.length - 1];
    els.count.textContent = plural(cards.length, "card", "cards") + " · " + ago(last.mtime);
    els.eyebrow.textContent = "current";
  } else {
    els.count.textContent = "nothing on the board yet";
    els.eyebrow.textContent = "ready";
  }

  /* A question with nothing sent after it is still owed an answer. */
  var lastQuestion = null;
  for (var i = cards.length - 1; i >= 0; i--) {
    if (cards[i].kind === "question") { lastQuestion = cards[i]; break; }
  }
  var msgs = d.messages || [];
  var lastReply = msgs.length ? msgs[msgs.length - 1].t : 0;
  if (lastQuestion && lastQuestion.mtime > lastReply) {
    els.waitingText.textContent = lastQuestion.title || ("card " + lastQuestion.id);
    els.waiting.hidden = false;
  } else {
    els.waiting.hidden = true;
  }

  var push = d.push;
  if (push) {
    var line = document.getElementById("pushline");
    if (!line) {
      line = document.createElement("p");
      line.id = "pushline";
      line.className = "pushline";
      document.getElementById("current").appendChild(line);
    }
    line.className = "pushline " + (push.ok ? "ok" : "bad");
    line.textContent = (push.ok ? "✓ pushed " : "✕ push failed ") + push.iso
                     + (push.ok ? "" : " — " + (push.detail || "").split("\n").slice(-1)[0]);
  }

  if (st.session) els.eyebrow.textContent = st.session;

  var slate = d.slate || [];
  els.slateSub.textContent = slate.length
    ? plural(slate.length, "page", "pages") + " written"
    : "the slate";
}

/* ------------------------------------------------------------ the others */
function paintCourses(list) {
  var others = [];
  var past = [];
  (list || []).forEach(function (c) {
    if (c.current) return;
    (c.cards || c.running ? others : past).push(c);
  });

  function row(c, into) {
    var li = document.createElement("li");
    var b = document.createElement("button");
    b.type = "button";

    var name = document.createElement("span");
    name.className = "name";
    name.textContent = c.course || c.repo;

    /* The chapter is somebody's prose and can be a sentence long, so it gets a
       line of its own rather than being squeezed in beside the name. Only the
       "live" word is coloured -- colouring the whole line made a card count and
       a chapter title read as though they were a status. */
    var meta = document.createElement("span");
    meta.className = "meta";
    var bits = [];
    if (c.chapter) bits.push(c.chapter);
    if (c.cards) bits.push(plural(c.cards, "card", "cards"));
    meta.textContent = bits.join(" · ");
    if (c.running) {
      var tag = document.createElement("span");
      tag.className = "live";
      tag.textContent = c.node ? "live on " + c.node : "live";
      if (bits.length) meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(tag);
    }

    b.appendChild(name);
    /* A course nobody has opened yet has nothing to say on the second line, and
       an empty one only spends the gap above it. */
    if (meta.childNodes.length) b.appendChild(meta);
    b.onclick = function () { switchTo(c.repo); };
    li.appendChild(b);
    into.appendChild(li);
  }

  els.others.innerHTML = "";
  els.past.innerHTML = "";
  others.forEach(function (c) { row(c, els.others); });
  past.forEach(function (c) { row(c, els.past); });
  els.othersWrap.hidden = !others.length;
  els.pastWrap.hidden = !past.length;
}

function switchTo(repo) {
  if (moving) return;                 /* one at a time; a second tap is a queue */
  moving = { repo: repo };
  showBusy("opening " + repo + "…", "asking");
  fetch("/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: repo })
  }).then(function (r) { return r.json(); }).then(function (res) {
    if (!res.ok) throw new Error(res.error || "switch failed");
    return waitForAddress(repo, Date.now());
  }).then(function () {
    /* Landed or not, this goes to the lesson. The board re-pointed the address
       at the course before it answered, so by here the switch has happened; the
       poll is only how we know not to reload too early. There is nothing to ask
       a person about, and asking was worse than useless -- from the iPad it read
       as a switch that could not be made. */
    location.href = "/";
  }).catch(function (e) {
    showBusy("could not open " + repo, e.message || String(e));
    moving = null;
  });
}

/* Which course is answering at this address RIGHT NOW. Asking is the only
   honest way to know a switch has landed: the name is re-pointed by the board
   that took it, and the page cannot see that happen. */
function serving() {
  return fetch("/health?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .catch(function () { return null; });   /* mid-move the socket is closed */
}

/* Poll until the address actually serves what was asked for.

   This is the whole of the fix for "I had to tap it ten times": reloading the
   instant `/switch` answers lands on the board you were trying to leave, which
   reads exactly like a tap that did nothing — so you tap again, and every one
   of those taps was working. A board that has just taken the name answers this
   within a second or two; the ceiling is only there so a reload eventually
   happens whatever the network did. */
function waitForAddress(repo, began) {
  return serving().then(function (h) {
    if (h && h.dir === repo) return true;
    var waited = Math.round((Date.now() - began) / 1000);
    if (waited >= SWITCH_PATIENCE) return false;
    showBusy("opening " + repo + "…", waited > 2 ? "starting the board · "
             + waited + "s" : "starting the board");
    return new Promise(function (go) { setTimeout(go, 600); })
      .then(function () { return waitForAddress(repo, began); });
  });
}

var SWITCH_PATIENCE = 45;             /* seconds. A cold board start is slow. */
var moving = null;

/* One message, no questions. The overlay used to end in "ask again" / "stay
   here", which is a dead end wearing the clothes of a choice: the switch had
   in fact been made and the only thing wrong was that nothing had moved the
   address. Tapping the overlay dismisses it; that is all it does. */
function showBusy(text, sub) {
  els.busy.hidden = false;
  els.busyText.textContent = text;
  els.busySub.textContent = sub || "";
}

els.busy.onclick = function () {
  els.busy.hidden = true;
  moving = null;
  refresh();
};

/* ------------------------------------------------------------------ load */
function refresh() {
  if (moving) return Promise.resolve();   /* not while the address is in flight */
  return Promise.all([
    fetch("/board.json").then(function (r) { return r.json(); }),
    fetch("/courses.json").then(function (r) { return r.json(); }).catch(function () { return {}; })
  ]).then(function (all) {
    els.dot.className = "dot live";
    paintBoard(all[0] || {});
    paintCourses((all[1] || {}).courses);
    var w = (all[1] || {}).where;
    els.where.textContent = w || "";
  }).catch(function () {
    els.dot.className = "dot dead";
  });
}

refresh();
setInterval(function () { if (!document.hidden) refresh(); }, 20000);
document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
window.addEventListener("focus", refresh);
window.addEventListener("pageshow", refresh);

/* ---------------------------------------------------------------- chrome */
var THEME_KEY = "board.theme";
function applyTheme(mode) {
  document.body.dataset.mode = mode;
  syncSystemTheme();
  try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
}
function syncSystemTheme() {
  var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.body.classList.toggle("sys-dark", dark);
}
document.getElementById("btn-theme").onclick = function () {
  var order = ["auto", "light", "dark"];
  applyTheme(order[(order.indexOf(document.body.dataset.mode) + 1) % 3]);
};
document.getElementById("btn-reload").onclick = function () { location.reload(); };
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncSystemTheme);
}
try { applyTheme(localStorage.getItem(THEME_KEY) || "auto"); } catch (e) { applyTheme("auto"); }

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
