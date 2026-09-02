/* ==========================================================================
   board.js -- client for the live tutoring board.

   Holds one Server-Sent Events connection open. Every time the tutor writes a
   card file, the server pushes the whole board and this re-renders it: markdown
   to HTML, KaTeX for the mathematics, compiled SVG for anything TikZ. Sending
   text or dropping a file posts back the other way.
   ========================================================================== */

(function () {
"use strict";

var els = {
  bar: document.getElementById("bar"),
  dot: document.getElementById("dot"),
  course: document.getElementById("course"),
  chapter: document.getElementById("chapter"),
  board: document.getElementById("board"),
  cards: document.getElementById("cards"),
  empty: document.getElementById("empty"),
  emptyLead: document.getElementById("empty-lead"),
  begin: document.getElementById("begin"),
  noTutor: document.getElementById("no-tutor"),
  skip: document.getElementById("skip"),
  notesend: document.getElementById("notesend"),
  annbar: document.getElementById("annbar"),
  annPen: document.getElementById("ann-pen"),
  annErase: document.getElementById("ann-erase"),
  annUndo: document.getElementById("ann-undo"),
  annRedo: document.getElementById("ann-redo"),
  annClear: document.getElementById("ann-clear"),
  annDone: document.getElementById("ann-done"),
  annotate: document.getElementById("btn-annotate"),
  sendwhat: document.getElementById("sendwhat"),
  sendNotes: document.getElementById("send-notes"),
  sendCancel: document.getElementById("send-cancel"),
  offline: document.getElementById("offline"),
  linkbad: document.getElementById("linkbad"),
  hwbar: document.getElementById("hwbar"),
  hwSet: document.getElementById("hw-set"),
  hwCount: document.getElementById("hw-count"),
  hwBuild: document.getElementById("hw-build"),
  jump: document.getElementById("jump"),
  panic: document.getElementById("panic"),
  findink: document.getElementById("findink"),
  reopen: document.getElementById("reopen"),
  addFile: document.getElementById("btn-add-file"),
  scratch: document.getElementById("scratch"),
  scratchList: document.getElementById("scratch-list"),
  writer: document.getElementById("writer"),
  sent: document.getElementById("sent"),
  sentText: document.getElementById("sent-text"),
  session: document.getElementById("session"),
  kind: document.getElementById("kind"),
  kindLecture: document.getElementById("kind-lecture"),
  kindSets: document.getElementById("kind-sets"),
  kindReview: document.getElementById("kind-review"),
  kindCancel: document.getElementById("kind-cancel"),
  rvbar: document.getElementById("rvbar"),
  rvScope: document.getElementById("rv-scope"),
  rvChange: document.getElementById("rv-change"),
  review: document.getElementById("review"),
  reviewTitle: document.getElementById("review-title"),
  reviewList: document.getElementById("review-list"),
  reviewAll: document.getElementById("review-all"),
  reviewCount: document.getElementById("review-count"),
  reviewStart: document.getElementById("review-start"),
  contents: document.getElementById("contents"),
  contentsList: document.getElementById("contents-list"),
  agent: document.getElementById("agent"),
  finish: document.getElementById("finish"),
  finishLead: document.getElementById("finish-lead"),
  finishSub: document.getElementById("finish-sub"),
  save: document.getElementById("btn-save"),
  barmenu: document.getElementById("barmenu"),
  notesAgain: document.getElementById("btn-notes-again"),
  home: document.getElementById("btn-home"),
  finishLeave: document.getElementById("finish-leave"),
  finishYes: document.getElementById("finish-yes"),
  finishNo: document.getElementById("finish-no"),
  saveDot: null,
  pushed: document.getElementById("pushed"),
  pushedIcon: document.getElementById("pushed-icon"),
  pushedText: document.getElementById("pushed-text"),
  carry: document.getElementById("carry"),
  busy: document.getElementById("busy"),
  busyText: document.getElementById("busy-text"),
  busySince: document.getElementById("busy-since"),
  composer: document.getElementById("composer"),
  typebox: document.getElementById("typebox"),
  saybox: document.getElementById("saybox"),
  sendType: document.getElementById("send-type"),
  tabWrite: document.getElementById("tab-write"),
  tabType: document.getElementById("tab-type"),
  sendNoAsk: document.getElementById("send-no-ask"),
  file: document.getElementById("file"),
  drop: document.getElementById("drop")
};

var seenIds = Object.create(null);
var firstPaint = true;
/* When a hand last touched the page. Several things here want to put the page
   somewhere and then put it there again a moment later, once the mathematics has
   typeset and the images have decoded and everything above has settled to its
   real height. Repeating a scroll under somebody who has already started reading
   is worse than landing in the wrong place, so every one of those repeats asks
   first. A real gesture, not our own `scrollTo` -- which fires a scroll event
   like any other and would otherwise cancel every repeat immediately. */
var handledAt = 0;
["wheel", "touchstart", "pointerdown", "keydown"].forEach(function (ev) {
  window.addEventListener(ev, function () { handledAt = Date.now(); },
                          { passive: true });
});

/* ---------------------------------------------------------------- markdown */
/* Math and code are pulled out first so markdown never mangles a subscript or
   an asterisk that belongs to a formula. They go back in as escaped text, which
   is exactly what KaTeX's auto-render wants to walk. */

/* Private-use sentinels. They cannot occur in a lesson, so a parked math or
   code placeholder never collides with a digit written in the prose. */
var SENT_OPEN = "\uE000", SENT_CLOSE = "\uE001", SENT_NEST = "\uE002";
var SENT_RE = /\uE000(\d+)\uE001/g;

var MATH_PATTERNS = [
  { open: "$$", close: "$$", display: true },
  { open: "\\[", close: "\\]", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "$", close: "$", display: false }
];

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function protect(src, store) {
  var out = "";
  var i = 0;
  while (i < src.length) {
    var ch = src[i];

    /* fenced code block */
    if (src.startsWith("```", i) && (i === 0 || src[i - 1] === "\n")) {
      var fenceEnd = src.indexOf("\n```", i + 3);
      var stop = fenceEnd === -1 ? src.length : fenceEnd + 4;
      store.push({ kind: "fence", text: src.slice(i, stop) });
      out += SENT_OPEN + (store.length - 1) + SENT_CLOSE;
      i = stop;
      continue;
    }

    /* inline code */
    if (ch === "`") {
      var tickEnd = src.indexOf("`", i + 1);
      if (tickEnd !== -1) {
        store.push({ kind: "code", text: src.slice(i + 1, tickEnd) });
        out += SENT_OPEN + (store.length - 1) + SENT_CLOSE;
        i = tickEnd + 1;
        continue;
      }
    }

    /* escaped dollar */
    if (ch === "\\" && src[i + 1] === "$") { out += "\\$"; i += 2; continue; }

    /* math */
    var matched = false;
    for (var p = 0; p < MATH_PATTERNS.length; p++) {
      var pat = MATH_PATTERNS[p];
      if (!src.startsWith(pat.open, i)) continue;
      var from = i + pat.open.length;
      var end = -1;
      var j = from;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src.startsWith(pat.close, j)) { end = j; break; }
        j++;
      }
      if (end === -1) continue;
      store.push({
        kind: "math",
        text: pat.open + src.slice(from, end) + pat.close,
        display: pat.display
      });
      out += SENT_OPEN + (store.length - 1) + SENT_CLOSE;
      i = end + pat.close.length;
      matched = true;
      break;
    }
    if (matched) continue;

    out += ch;
    i++;
  }
  return out;
}

function restore(html, store) {
  return html.replace(SENT_RE, function (_, n) {
    var item = store[+n];
    if (!item) return "";
    if (item.kind === "code") return "<code>" + escapeHtml(item.text) + "</code>";
    if (item.kind === "fence") {
      var body = item.text.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
      return "<pre><code>" + escapeHtml(body) + "</code></pre>";
    }
    /* math: escaped text, KaTeX walks the text node and replaces it */
    var span = item.display ? "div" : "span";
    return "<" + span + ' class="math-raw">' + escapeHtml(item.text) + "</" + span + ">";
  });
}

function inline(s) {
  return s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,;:)!?])/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s.,;:)!?])/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

function splitRow(line) {
  return line.replace(/^\s*\|?/, "").replace(/\|?\s*$/, "").split("|").map(function (c) {
    return c.trim();
  });
}

function renderMarkdown(src) {
  var store = [];
  var text = protect(src.replace(/\r\n/g, "\n"), store);
  /* Prose is escaped now that math and code are safely parked in the store.
     `>` is deliberately left alone so blockquote lines still match. */
  text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  var lines = text.split("\n");
  var out = [];
  var i = 0;

  function isBlank(s) { return !s || !s.trim(); }

  while (i < lines.length) {
    var line = lines[i];

    if (isBlank(line)) { i++; continue; }

    /* compiled figure placeholder */
    var fig = line.match(/^\s*@@FIGURE:([0-9a-f]+):(\w+)@@\s*$/);
    if (fig) {
      var id = fig[1], status = fig[2];
      if (status === "ready") {
        out.push('<div class="figure"><img alt="figure" src="/figure/' + id + '.svg"></div>');
      } else if (status === "error") {
        out.push('<div class="figure error">figure ' + id + " failed to compile</div>");
      } else {
        out.push('<div class="figure pending" data-fig="' + id + '">compiling figure…</div>');
      }
      i++;
      continue;
    }

    /* heading */
    var h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      var lvl = Math.min(h[1].length, 3);
      out.push("<h" + lvl + ">" + inline(h[2].trim()) + "</h" + lvl + ">");
      i++;
      continue;
    }

    /* horizontal rule */
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    /* table */
    if (line.indexOf("|") !== -1 && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf("-") !== -1) {
      var header = splitRow(line);
      var aligns = splitRow(lines[i + 1]).map(function (c) {
        if (/^:.*:$/.test(c)) return "center";
        if (/:$/.test(c)) return "right";
        return "left";
      });
      i += 2;
      var body = [];
      while (i < lines.length && lines[i].indexOf("|") !== -1 && !isBlank(lines[i])) {
        body.push(splitRow(lines[i]));
        i++;
      }
      var t = "<table><thead><tr>";
      header.forEach(function (c, n) {
        t += '<th style="text-align:' + (aligns[n] || "left") + '">' + inline(c) + "</th>";
      });
      t += "</tr></thead><tbody>";
      body.forEach(function (row) {
        t += "<tr>";
        row.forEach(function (c, n) {
          t += '<td style="text-align:' + (aligns[n] || "left") + '">' + inline(c) + "</td>";
        });
        t += "</tr>";
      });
      out.push(t + "</tbody></table>");
      continue;
    }

    /* blockquote */
    if (/^\s*>/.test(line)) {
      var quoted = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push("<blockquote><p>" +
               inline(quoted.join("\n").trim()).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, " ") +
               "</p></blockquote>");
      continue;
    }

    /* list */
    var bullet = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      var result = renderList(lines, i, store);
      out.push(result.html);
      i = result.next;
      continue;
    }

    /* paragraph */
    var para = [];
    while (i < lines.length && !isBlank(lines[i]) &&
           !/^(#{1,6})\s/.test(lines[i]) &&
           !/^\s*>/.test(lines[i]) &&
           !/^\s*([-*+]|\d+[.)])\s/.test(lines[i]) &&
           !/^\s*@@FIGURE:/.test(lines[i]) &&
           !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push("<p>" + inline(para.join("\n").trim()).replace(/\n/g, " ") + "</p>");
  }

  return restore(out.join("\n"), store);
}

/* nested lists, by leading indent */
function renderList(lines, start, store) {
  var first = lines[start].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  var indent = first[1].length;
  var ordered = /\d/.test(first[2]);
  var items = [];
  var i = start;

  while (i < lines.length) {
    var m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!m) {
      if (!lines[i].trim()) {
        /* a blank line only continues the list if an item follows */
        var look = i + 1;
        if (look < lines.length && /^\s*([-*+]|\d+[.)])\s/.test(lines[look]) &&
            lines[look].match(/^(\s*)/)[1].length >= indent) { i++; continue; }
      }
      if (lines[i].trim() && lines[i].match(/^(\s*)/)[1].length > indent) {
        items[items.length - 1].push(lines[i].trim());
        i++;
        continue;
      }
      break;
    }
    if (m[1].length < indent) break;
    if (m[1].length > indent) {
      var sub = renderList(lines, i, store);
      items[items.length - 1].push(SENT_NEST + sub.html);
      i = sub.next;
      continue;
    }
    items.push([m[3]]);
    i++;
  }

  var tag = ordered ? "ol" : "ul";
  var html = "<" + tag + ">";
  items.forEach(function (chunks) {
    var nested = "";
    var body = [];
    chunks.forEach(function (c) {
      if (c[0] === SENT_NEST) nested += c.slice(1);
      else body.push(c);
    });
    html += "<li>" + inline(body.join(" ")) + nested + "</li>";
  });
  return { html: html + "</" + tag + ">", next: i };
}

/* ------------------------------------------------------------------ KaTeX */
function typeset(root) {
  if (!window.renderMathInElement) return;
  try {
    window.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false }
      ],
      macros: window.BOARD_MACROS || {},
      throwOnError: false,
      errorColor: "#9a2020",
      strict: false,
      trust: true
    });
  } catch (e) { /* a bad formula must never blank the board */ }
}

/* ------------------------------------------------------------------ render */
var KIND_LABEL = {
  lesson: "lesson",
  question: "your move",
  correct: "correct",
  wrong: "not quite",
  review: "review",
  note: "aside",
  recap: "recap"
};

/* Which kinds are a reply to a piece of working, as opposed to new teaching.

   `note` is in here, and leaving it out was most of why folding did nothing on a
   real lesson: an evening on one exercise produced five `note` cards -- "no, and
   it is a name collision", "the symbol is fixed, which element is h?" -- every
   one of them an answer to something the student had just written, and every one
   of them left open. A `lesson` or a `recap` is material that stands on its own
   and is never folded. */
var REPLY_KIND = { wrong: 1, correct: 1, review: 1, note: 1 };

function timeLabel(t) {
  var d = new Date(t * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}


/* Nodes inserted by the last reconcile, so only they get typeset. */
var freshNodes = [];

/* Keyed, and **in place**. A node that is already where it belongs is not
   touched at all -- not moved, not re-appended, not re-inserted.

   This used to collect every kept node into a fragment and append the fragment,
   which detaches and re-inserts the entire lesson on every payload. The DOM is
   happy with that; CSS is not. Taking a node out of the document and putting it
   back restarts its animations, and every `.card` carried an entry animation, so
   each frame slid the whole board up from half a rem and faded it back in --
   read from a chair as the board glitching, shifting, and snapping back to where
   it already was. Payloads arrive for reasons that have nothing to do with the
   lesson (a slate save, a figure finishing, the uncommitted count changing), so
   it happened while nothing on screen had changed at all.

   It also threw away work: re-inserting a subtree forces style, layout and paint
   for the whole lesson, and re-inserting a canvas costs a fresh compositor
   layer. Moving only what actually moved is both correct and most of the fix. */
function reconcile(host, wanted) {
  var have = Object.create(null);
  var i, node, key;

  for (i = 0; i < host.childNodes.length; i++) {
    node = host.childNodes[i];
    key = node.dataset && node.dataset.key;
    if (key) have[key] = node;
  }

  var cursor = host.firstChild;
  for (i = 0; i < wanted.length; i++) {
    /* Either a node just built, or a key saying "the one already on screen is
       still right". */
    key = wanted[i].key;
    node = wanted[i].node;
    var kept = have[key];
    /* The writing surface lives among these nodes and has no key of its own;
       `placeWriter` owns where it sits, so step over it rather than matching
       against it. */
    while (cursor && !(cursor.dataset && cursor.dataset.key)) {
      cursor = cursor.nextSibling;
    }
    if (kept) {
      delete have[key];
      if (kept === cursor) {
        cursor = cursor.nextSibling;      /* already in place: leave it alone */
        continue;
      }
      host.insertBefore(kept, cursor);
    } else if (node) {
      host.insertBefore(node, cursor);
      freshNodes.push(node);
    }
  }

  /* Anything left in `have` is a node the payload no longer contains. */
  for (key in have) {
    if (have[key].parentNode === host) host.removeChild(have[key]);
  }
}

function render(data) {
  /* A live frame that arrives while a past lesson is open is kept, not shown.
     Being yanked out of what you are reading because the tutor wrote something
     is worse than finding it when you come back. */
  if (!data.archived) {
    lastLive = data;
    if (!pagesLoaded) { pagesLoaded = true; loadPages(); }
    document.getElementById("btn-history").hidden = !(data.history > 0);
    if (reading) { els.jump.hidden = false; return; }
  }
  var state = data.state || {};
  els.course.textContent = state.course || "board";
  /* A review's label is "Test review — Ch 1, Ch 7", which the strip underneath
     already says in full and in the course's own words. Repeating it here costs
     the bar the width that the chapter line exists to have, and the bar is the
     one row on this page that cannot grow. The label still goes into the state,
     because a filed lesson needs a name in the history. */
  var reviewing = (state.session || "") === "review";
  els.chapter.textContent = (state.chapter && !reviewing) ? "· " + state.chapter : "";
  document.title = (state.course || "Board") + (state.chapter ? " · " + state.chapter : "");

  /* The lesson is one transcript: the tutor's cards and the student's answers
     in the order they happened, the answer directly under the question it
     answers. A revised answer keeps its original place -- it supersedes what
     was there rather than being appended to the end -- which is why the sort
     runs on when the turn STARTED, not when it was last edited. */
  /* Order by position in the lesson, not by clock. Cards are numbered in the
     order they were written, and that number is what fixes their place: sorting
     them by mtime meant that correcting a typo in card three moved it to the end
     of the transcript, after everything the student had since answered. A turn
     sits immediately after the card it answers; a turn that answers nothing --
     the opening "begin" -- falls back to where its time puts it. */
  var ordered = (data.cards || []).slice().sort(function (a, b) {
    return (a.id || "").localeCompare(b.id || "");
  });
  var at = Object.create(null);
  var isQuestion = Object.create(null);
  ordered.forEach(function (c, n) {
    at[c.id] = n;
    if (c.kind === "question") isQuestion[c.id] = true;
  });
  /* A filed lesson and a past one are read-only: no surface is built for either,
     so the frozen picture is the only record there is and it stays. */
  var live = !data.archived && !reading;

  /* Whether a written answer already has a board carrying the same ink.

     The transcript froze every ink answer into a picture at the moment it was
     sent -- which was right when the slate was one surface that got written
     over, because then the picture was the only copy of what had been handed in.
     It is not one surface any more: every question owns a page, nothing is ever
     wiped, and that page is still under the board at the end of the question's
     run. So the picture and the board are two copies of the same ink, one of
     them dead, and going back up the lesson to an earlier answer found the dead
     one. The board is the answer.

     The rule already existed for the newest unanswered turn, a few lines below,
     for exactly this reason. This is that rule, now that every question can keep
     one. The picture comes back the moment there is no board to replace it:
     a filed lesson, a past one, a browser that has never held this question's
     page -- the mapping is local to the device that wrote it -- or a surface
     that has not been built yet. */
  function onABoard(m) {
    if (!(live && !!writer && m.kind === "ink" && !!m.png
          && !!m.answers && !!isQuestion[m.answers])) return false;
    var found = false;
    slotsOf(m.answers).forEach(function (k) {
      if (boardPage[k].p !== undefined) found = true;
    });
    return found;
  }

  /* Feedback supersedes feedback. An answer is versioned and only its newest
     revision is rendered -- three goes at Exercise 1.3 show as one attempt --
     but the cards that replied to the first two were never versioned, so they
     stayed open beside the third. Three "not quite" cards then sat in a row
     under a single piece of working, and the reading order said they were
     three live objections to what is on screen now, when two of them were
     about ink that had already been rewritten. It is the reply, not the
     lesson, that has been replaced: only the newest reply to the open question
     stays open. The ones it replaced fold to their heading, one line each, and
     open again on a tap -- a transcript keeps both halves and this removes
     nothing. */
  var superseded = Object.create(null);
  /* Per question, not merely after the newest one. A question stays open for as
     long as it takes -- one exercise ran to eleven cards and two hours -- and
     the rule was "replies after the NEWEST question card", so for all of that
     time there was no newest question after them and nothing folded at all. A
     reply belongs to the question it follows, and it is superseded by the next
     reply to that same question. */
  var runs = [];
  ordered.forEach(function (c, n) {
    if (c.kind === "question" || !runs.length) runs.push([]);
    if (REPLY_KIND[c.kind]) runs[runs.length - 1].push(c.id);
  });
  runs.forEach(function (run) {
    run.slice(0, -1).forEach(function (id) { superseded[id] = true; });
  });

  var items = [];
  ordered.forEach(function (c, n) {
    items.push({ pos: n, sub: 0, t: c.mtime, key: "card:" + c.id, card: c });
  });
  (data.turns || []).forEach(function (t) {
    var when = t.t0 || t.t;
    var pos;
    if (t.answers && at[t.answers] !== undefined) {
      pos = at[t.answers];
    } else {
      pos = -1;
      ordered.forEach(function (c, n) { if (c.mtime <= when) pos = n; });
    }
    items.push({ pos: pos, sub: 1, t: when, key: "turn:" + t.id, turn: t });
  });
  items.sort(function (a, b) {
    return (a.pos - b.pos) || (a.sub - b.sub) || (a.t - b.t);
  });

  /* An answer that has been sent and not yet answered is not rendered into the
     transcript: the ink is still on the writing surface directly below, and
     showing a frozen copy of it immediately above that surface is the same thing
     twice. It appears in its proper place the moment the tutor replies, which is
     when it stops being "what I am looking at" and becomes "what was handed in".
   */
  awaitingReply = null;
  var lastItem = items[items.length - 1];
  if (lastItem && lastItem.turn && lastItem.turn.kind !== "text") {
    awaitingReply = lastItem.turn;
    items.pop();
  }

  var wasFollowing = following();
  /* What is on screen already, by key. A payload arrives for all sorts of
     reasons that have nothing to do with the lesson -- the tutor's heartbeat
     lands every thirty seconds while it writes, the uncommitted count changes, a
     figure finishes compiling -- and every one of them used to re-parse the
     markdown of every card, rebuild its DOM, and hand the lot to a reconcile
     that threw all of it away because the keys had not changed. On a tablet
     holding a long lesson that is the whole cost of a frame, spent on nothing.
     Build only what is genuinely new. */
  var onScreen = Object.create(null);
  for (var ex = 0; ex < els.cards.childNodes.length; ex++) {
    var exNode = els.cards.childNodes[ex];
    var exKey = exNode.dataset && exNode.dataset.key;
    if (exKey) onScreen[exKey] = true;
  }
  var wanted = [];
  var anythingNew = false;

  items.forEach(function (item) {
    var stamp = item.key + (item.turn ? ":r" + (item.turn.rev || 1) : "");
    var fresh = !firstPaint && !seenIds[stamp];
    if (fresh) anythingNew = true;
    seenIds[stamp] = true;

    /* The key is identity plus version: a card edited in place, or a turn
       revised, changes its key and is rebuilt; everything else is reused.
       Whether the answer is showing as a picture or standing aside for its board
       is part of that identity -- the surface is built a frame after the first
       payment, and without this the turn keeps the picture it was born with. */
    var onBoard = !!item.turn && onABoard(item.turn);
    var wantKey = stamp + (item.card ? ":m" + Math.round(item.card.mtime)
                                     : (onBoard ? ":b" : ""));
    if (onScreen[wantKey]) {
      wanted.push({ key: wantKey, node: null });     /* keep what is there */
      return;
    }
    var node = document.createElement(item.card ? "article" : "div");
    node.dataset.key = wantKey;
    if (item.card) {
      var c = item.card;
      node.className = "card" + (fresh ? " fresh" : "");
      node.dataset.kind = c.kind;
      node.dataset.card = c.id;      /* what an annotation is anchored to */
      var head = "";
      if (c.kind !== "lesson" || c.title) {
        head = '<div class="card-head">' +
               '<span class="kind">' + (KIND_LABEL[c.kind] || c.kind) + "</span>" +
               (c.title ? '<span class="card-title"></span>' : "") +
               '<span class="card-num">' + c.id + "</span></div>";
      }
      node.innerHTML = head + '<div class="body"></div>';
      if (c.title) node.querySelector(".card-title").textContent = c.title;
      node.querySelector(".body").innerHTML = renderMarkdown(c.body || "");
    } else {
      var m = item.turn;
      node.className = "mine" + (fresh ? " fresh" : "");
      node.dataset.turn = m.id;
      if (m.answers) node.dataset.answers = m.answers;
      node.innerHTML = '<span class="when"></span><span class="text"></span>';
      var when = "you · " + timeLabel(m.t);
      if (m.kind === "annotation") {
        when += " · wrote on card " + (m.answers || "?");
        if (m.where) when += " " + m.where;
      }
      if ((m.rev || 1) > 1) when += " · revised";
      node.querySelector(".when").textContent = when;
      if (m.signal) {
        var chip = document.createElement("span");
        chip.className = "signal";
        chip.dataset.signal = m.signal;
        chip.textContent = SIGNAL_LABEL[m.signal] || m.signal;
        node.querySelector(".when").after(chip);
      }
      node.querySelector(".text").innerHTML = renderMarkdown(m.text || "");
      if (m.png && onBoard) {
        /* The working is on the board under this question's run -- below the
           feedback, which is where a correction wants it. One line here, so the
           transcript still says an answer was sent and when, and a tap goes to
           it rather than making anyone hunt. */
        var toBoard = document.createElement("button");
        toBoard.type = "button";
        toBoard.className = "to-board";
        toBoard.textContent = "on the board below ↓";
        toBoard.addEventListener("click", function () { showBoardFor(m.answers); });
        node.appendChild(toBoard);
      } else if (m.png) {
        /* Frozen at the moment it was sent, so it is what was handed in and
           not whatever the slate says now. The revision is in the URL, so
           there is nothing stale for the browser to hold on to. */
        var shotWrap = document.createElement("a");
        shotWrap.href = m.png;
        shotWrap.className = "slate-shot";
        shotWrap.addEventListener("click", function (e) {
          e.preventDefault();
          openViewer(m.png, "your answer · " + (m.iso || ""));
        });
        var shot = document.createElement("img");
        shot.src = m.png;
        shot.loading = "lazy";
        shot.alt = "what you wrote";
        shotWrap.appendChild(shot);
        node.appendChild(shotWrap);
      }
      if (m.files && m.files.length) {
        var box = document.createElement("div");
        box.className = "files";
        node.appendChild(box);
        m.files.forEach(function (f) {
          var a = document.createElement("a");
          a.href = "/uploads/" + encodeURIComponent(f);
          a.target = "_blank";
          a.rel = "noopener";
          if (/\.(png|jpe?g|gif|webp|heic)$/i.test(f)) {
            var img = document.createElement("img");
            img.src = a.href;
            a.appendChild(img);
          } else {
            a.textContent = f;
          }
          box.appendChild(a);
        });
      }
    }
    wanted.push({ key: wantKey, node: node });
  });

  /* Reconcile rather than rebuild. Every payload used to blow the lesson away
     and construct it again: every card's markdown re-parsed, every formula
     re-typeset by KaTeX, every compiled figure re-fetched and re-decoded. That
     cost grows with the length of the lesson and is paid on every keystroke of
     the tutor's, on an iPad, for cards that did not change. Nodes are keyed by
     card id and revision, so an unchanged card is left exactly where it is --
     which also keeps its scroll position and any selection inside it. */
  reconcile(els.cards, wanted);
  paintSuperseded(superseded);

  /* The way out stays open until the tutor has actually said something. Keyed on
     CARDS, not on the transcript: asking makes the transcript non-empty, so
     keying on that retired the only control on the page the moment it was used
     -- and if nothing was listening, there was no way to ask again and no text
     box in maths to ask with. A board the tutor has never written on is still a
     board waiting to start. */
  var started = (data.cards || []).length > 0;
  els.empty.hidden = started || linkDead;

  paintSession(state, data.push, data.agent, data.export);
  paintHomework(data.hw);
  paintReview(state, data.review);
  if (!started) paintWaiting(data);
  seedTextDrafts(data);
  paintNotesSend();
  paintSent();
  paintSave(data.unsaved);
  if (data.sets) knownSets = data.sets;
  if (data.contents) contents = data.contents;
  pastCount = data.history || 0;

  var codeMode = (state.mode || "math") === "code";
  document.body.dataset.mode2 = state.mode || "math";
  /* The signals -- ready to check, help, confused -- are pace control for a code
     project. They ride above the answer panel, which every course has now. */
  els.composer.hidden = !codeMode;

  var lastQuestion = 0, lastSent = 0, newestQ = null;
  (data.cards || []).forEach(function (c) {
    if (c.kind === "question" && c.mtime > lastQuestion) {
      lastQuestion = c.mtime;
      newestQ = c.id;
    }
  });
  (data.turns || []).forEach(function (m) { if (m.t > lastSent) lastSent = m.t; });
  var settled = false;
  (data.cards || []).forEach(function (c) {
    if (c.kind === "correct" && c.mtime >= lastQuestion) settled = true;
  });
  var owed = !!newestQ && !settled;

  lastNewestQ = newestQ || "";
  if (workingOn && workingOnAt !== (newestQ || "")) {
    workingOn = null;
    workingOnAt = null;
  }
  if (reopenedFor !== null && reopenedFor !== (newestQ || "")) reopenedFor = null;
  if (reopenedFor !== null && !data.archived) owed = true;

  pinnedTo = owed ? newestQ : null;

  /* A sent answer keeps the block open, because the tutor's next move is usually
     to point at a mistake in it. A declined one does the opposite: the whole
     point of skipping is that the prompt goes away. */
  var skipped = !!newestQ && (data.turns || []).some(function (t) {
    return t.signal === "skip" && t.answers === newestQ;
  });
  if (skipped) {
    pinnedTo = null;
    owed = false;
  }

  /* Which answer the panel is editing. An ink turn already sent against the
     current question is the one to correct; anything else starts a new one. */
  /* Which question is being answered. Usually the newest one; whichever the
     student picked, if they went back to an earlier one. A question that has
     scrolled off the top of the transcript is still a question, and going back
     to add a line to the proof under it is ordinary work, not an edge case. */
  var qids = ordered.filter(function (c) { return c.kind === "question"; })
                    .map(function (c) { return c.id; });

  /* Where each question's run ends: the last card written before the next
     question was asked. The newest board of a question sits there, because an
     answer belongs under the feedback it is answering. */
  var runEndOf = Object.create(null);
  var openQ = null;
  ordered.forEach(function (c) {
    if (c.kind === "question") { openQ = c.id; runEndOf[c.id] = c.id; return; }
    if (openQ) runEndOf[openQ] = c.id;
  });

  /* Before anything reads the mapping: bring the chain of boards up to date with
     the transcript, and let the surface -- which may know more about where this
     lesson's working actually is than this browser does -- correct it. */
  lastTurns = data.turns || [];
  syncSlots(qids, runEndOf, lastTurns);
  repairPages();
  slotOrder = [];
  qids.forEach(function (q) {
    slotsOf(q).forEach(function (k) { slotOrder.push(k); });
  });

  /* Which BOARD is being written on. Usually the attempt in hand on the newest
     question; whichever they picked, if they went back to an earlier one. A
     board that has scrolled off the top of the transcript is still a board, and
     going back to add a line to the proof on it is ordinary work. */
  if (workingOn && (!boardPage[workingOn]
                    || qids.indexOf(slotQ(workingOn)) === -1)) workingOn = null;
  var liveKey = workingOn || (newestQ ? newestSlot(newestQ) : null);
  var onQ = liveKey ? slotQ(liveKey) : newestQ;

  var mine = (data.turns || []).filter(function (t) {
    return t.kind === "ink" && t.answers === onQ;
  });
  var latestMine = (data.turns || []).filter(function (t) {
    return t.answers === onQ;
  });
  answering = {
    question: onQ,
    turn: mine.length ? mine[mine.length - 1] : null,
    /* The newest turn of any kind, so an old question can reopen on the surface
       it was answered with and carry the answer back for correction. */
    latest: latestMine.length ? latestMine[latestMine.length - 1] : null,
  };
  if (workingOn) owed = !data.archived;

  /* The writing surface goes at the END of the transcript, under whatever the
     last thing in it is. That is what makes a correction work the way a person
     expects: the tutor's feedback arrives, and the surface to fix the answer on
     is beneath the feedback rather than scrolled off above it.

     While an answer is waiting to be read there is nothing to put under, so the
     surface stays where it is and says so underneath itself -- see paintSent.
     What it must never do is sit under a frozen copy of the very ink still
     showing on the surface: that is the same thing twice, one above the other. */
  /* The surface goes where the BOARD it is standing in for goes -- the attempt
     in hand at the end of the question's own run, or, if they went back, exactly
     where that earlier attempt was written. For the newest question the end of
     the run is the end of the transcript, which is where the surface has always
     gone; for an earlier one it is directly under the feedback that question
     got, which is the same rule and the same reason. */
  var runEnd = (liveKey && boardPage[liveKey] && boardPage[liveKey].a)
             || runEndOf[onQ] || null;
  var qNode = runEnd
    ? els.cards.querySelector('[data-card="' + runEnd + '"]')
    : null;
  if (!qNode) {
    var kids = els.cards.children;
    for (var q = kids.length - 1; q >= 0; q--) {
      if (kids[q] !== els.writer && kids[q].dataset && kids[q].dataset.key) {
        qNode = kids[q];
        break;
      }
    }
  }
  /* A past lesson is read only: no pen, no box, nothing to send into a session
     that has already been filed. */
  liveSlot = liveKey;
  placeWriter(owed && !data.archived, qNode, live);
  /* The boards do not come and go with the answer panel.

     They used to: the whole set was torn down the moment nothing was owed, which
     is the moment the tutor writes a `correct` card. So getting an exercise
     RIGHT deleted every board on the page, and scrolling back up through the
     lesson found nothing but the frozen pictures of what had been sent -- which
     is a record of the answer, not a place to carry on working. Reported from
     the device, in exactly those words: "I want the actual writing board
     containing my response".

     The one board that is not drawn is the one the LIVE surface is standing in
     for, because that one is really there. With the panel shut there is no such
     board, and every one of them gets its picture. */
  paintBoards(qids, els.writer.hidden ? null : liveKey, !live);
  /* Offered exactly when there is no surface to write on: the tutor has written
     something, and nothing is owed. */
  if (els.reopen) {
    els.reopen.hidden = !!data.archived || !!reading
                        || !(data.cards || []).length
                        || !els.writer.hidden;
  }
  paintComposer(codeMode && !data.archived, data);
  paintBusy(data);
  /* KaTeX walks the DOM it is handed. Handing it the whole lesson every frame
     re-renders mathematics that was already rendered; hand it only what was
     just inserted. */
  freshNodes.forEach(typeset);
  freshNodes.length = 0;

  /* The ink layer is per card and idempotent: reconciled nodes keep the layer
     they already had, new ones get one. Then the saved marks are laid back
     over, without disturbing anything being drawn at this moment. */
  if (window.Annotate) {
    Array.prototype.forEach.call(els.cards.querySelectorAll("[data-card]"),
                                 window.Annotate.attach);
    window.Annotate.load(data.notes);
    /* Which of those the tutor has already been given. Without this, marks
       restored after a reload all read as undelivered, and the follow-up offer
       came back for ink that had gone days ago. */
    window.Annotate.loadSent(data.notes_sent);
  }
  renderScratch(data.uploads || []);

  if (firstPaint) {
    firstPaint = false;
    revealNewest(false);
    /* Mathematics is typeset and answer images decode after this frame, and
       both change the height of everything above the newest card -- so the
       place we just scrolled to is not where that card ends up. Land on it
       again once the page has settled, unless a hand has since intervened. */
    window.requestAnimationFrame(function () { if (!handledAt) revealNewest(false); });
    setTimeout(function () { if (!handledAt) revealNewest(false); }, 400);
  } else if (!anythingNew) {
    /* NOTHING ARRIVED. Do not move the page.

       A payload lands for all sorts of reasons that are not a card: the tutor's
       heartbeat every thirty seconds, the uncommitted count changing, a figure
       finishing. The old rule was "if they were at the bottom, scroll to the
       bottom", which on a board already at the bottom is a no-op -- so this was
       invisible for as long as the destination was the bottom. The moment the
       destination became the newest card's first line, every heartbeat yanked
       the page a screenful while nobody was doing anything at all. */
  } else if (wasFollowing && !penBusy()) {
    revealNewest(true);
  } else {
    els.jump.hidden = false;
  }
}

/* Where to be after pressing Send: looking at the foot of the writing surface.

   Send is the one moment in a sitting when the interesting thing is BELOW the
   working rather than above it. The receipt that says it arrived sits under the
   surface, and "the tutor is writing" sits under that -- and both of them are
   the answer to the question a person actually has after pressing the button,
   which is whether anything is happening. Landing anywhere above the working
   answers a question nobody asked and hides the two lines that matter.

   The foot of the surface goes a little above the middle of the window, so what
   is under it is on screen with room to spare and the last thing written is
   still visible above it. */
function revealSent() {
  if (!els.writer || els.writer.hidden) return;
  var r = els.writer.getBoundingClientRect();
  var top = r.bottom + window.scrollY - window.innerHeight * 0.62;
  if (top < 0) top = 0;
  window.scrollTo({ top: top, behavior: "smooth" });
}

/* And again once the payload the send provoked has landed: the receipt appears,
   the tutor's chip changes, and both of them move the thing we were aiming at.
   Not if a hand has intervened -- at that point the person has said where they
   want to be, which outranks anything here. */
function revealSentSettling() {
  var at = Date.now();
  revealSent();
  [300, 900].forEach(function (ms) {
    setTimeout(function () { if (handledAt <= at) revealSent(); }, ms);
  });
}

/* A hand mid-answer is not to be moved. The tutor writing a second card while
   the student is still writing on the first is ordinary, and scrolling the page
   out from under a pen is not a thing to do to somebody drawing a diagram --
   they get the button instead, and take it when they are ready. */
function penBusy() {
  return !!(writer && writer.busy && writer.busy());
}

/* The end-of-session offer, and the outcome of the last push. Both belong on
   the board rather than in a terminal: the person who has to answer, and the
   person who needs to know a push failed, is holding an iPad. */
var pushDismissed = 0;

/* Five minutes of "nothing is happening" is how a person concludes the thing is
   broken and taps the button again -- which wakes the tutor a second time and
   gets two opening cards written. A turn in progress is knowable, so say it. */
function paintWaiting(data) {
  /* Leave the just-tapped label alone for a moment, or the payload the tap
     itself provokes overwrites it before it has been read. */
  if (Date.now() - sentAt < 4000) return;
  var asked = (data.turns || []).some(function (t) { return t.signal === "begin"; });

  if (working) {
    els.emptyLead.textContent = "The tutor is writing…";
    els.begin.textContent = "the tutor is working";
    els.begin.disabled = true;          /* asking again now writes a second card */
    return;
  }
  els.emptyLead.textContent = asked ? "The tutor has not written anything yet."
                                    : "Nothing on the board yet.";
  els.begin.textContent = asked ? "ask again" : "ask the tutor to begin";
  els.begin.disabled = false;
}

/* A homework sitting produces a document, and the state of that document lives
   in a .tex file nobody on an iPad can see. Which set, how much of it is written
   up, and whether the last compile passed -- with the LaTeX error itself when it
   did not, because "the build failed" without the reason is a message that
   sends someone to a laptop. */
function paintHomework(hw) {
  currentSet = hw && hw.name ? hw.name : null;
  if (!hw) { els.hwbar.hidden = true; return; }
  els.hwbar.hidden = false;

  if (!hw.name) {
    els.hwSet.textContent = "homework";
    els.hwCount.textContent = hw.ambiguous && hw.ambiguous.length
      ? "which set? the tutor has not said" : "no problem set found";
    els.hwBuild.textContent = "";
    els.hwBuild.removeAttribute("data-ok");
    return;
  }

  els.hwSet.textContent = hw.name;
  if (!hw.total) {
    els.hwCount.textContent = "no problems transcribed yet";
  } else {
    var left = hw.total - hw.written;
    els.hwCount.textContent = hw.written + " of " + hw.total + " written up" +
      (left ? " · " + left + " to go" : " · complete");
  }

  var b = hw.build;
  if (!b) {
    els.hwBuild.textContent = "not compiled yet";
    els.hwBuild.removeAttribute("data-ok");
    return;
  }
  els.hwBuild.dataset.ok = b.ok ? "yes" : "no";
  els.hwBuild.textContent = b.ok
    ? "compiled " + (b.iso || "").slice(11, 16)
    : lastLine(b.detail || "") || "compile failed";
}

/* A LaTeX log ends with the thing that went wrong; the hundred lines above it
   are font declarations. */
function lastLine(text) {
  var lines = text.split("\n").filter(function (l) { return l.trim(); });
  for (var i = lines.length - 1; i >= 0; i--) {
    if (/^!|error|Error|ERROR/.test(lines[i])) return lines[i].trim().slice(0, 160);
  }
  return lines.length ? lines[lines.length - 1].trim().slice(0, 160) : "";
}

function paintSession(state, push, agent, exported) {
  /* Whether an assistant is attached, and whether it is thinking. Without this
     the page looks identical when nothing is listening at all. */
  /* Never hidden. A blank space where this belongs reads as "fine", and it is
     the opposite of fine: it means anything sent goes into an inbox nobody is
     reading. Somebody tapped "ask the tutor to begin", got a green connection
     dot, and waited on a session that did not exist. */
  els.agent.hidden = false;
  /* Only a record the server has judged stale means nobody is there. "Working"
     is emphatically attached: a turn in progress is the tutor doing its job, and
     a five-minute turn used to read on the iPad as a death. */
  /* "reattaching" counts as attached: a daemon being bounced onto new code is
     coming back in seconds, and telling somebody mid-lesson that nothing is
     reading the board is both wrong and alarming. */
  attached = !!agent && agent.state !== "stale";
  working = !!agent && agent.state === "working";
  /* And say it where somebody about to tap is actually looking, not only in the
     chrome. An empty board with nothing attached is a dead end, and the person
     holding the iPad cannot be expected to infer that from a missing chip. */
  els.noTutor.hidden = attached;
  if (!agent) {
    els.agent.dataset.state = "none";
    els.agent.textContent = "no tutor attached";
  } else {
    els.agent.dataset.state = agent.state || "stale";
    els.agent.textContent =
      agent.state === "working" ? (agent.agent || "assistant") + " is working"
    : agent.state === "listening" ? (agent.agent || "assistant") + " listening"
      /* An interactive assistant is not listening to the board -- it is sitting
         in a terminal waiting for its person. "Attached" is the true word, and
         the useful one: somebody is on the other end. */
    : agent.state === "attached" ? (agent.agent || "assistant") + " attached"
      /* Bounced onto new code, not dead. It comes back on its own. */
    : agent.state === "reattaching" ? (agent.agent || "assistant") + " reattaching…"
      /* Only reached when the record exists but nothing recognises its state --
         a daemon whose process is gone. Say what that means for them. */
    : "tutor stopped — nothing is reading the board";
  }
  var kind = state.session || "lecture";
  sittingKind = kind;
  els.session.hidden = false;
  /* "review", not "test review": the badge sits in a bar that is already at
     capacity, and eleven uppercase letters at this letter-spacing pushed the
     chapter label to "Tes…" and the tutor chip to "no". The strip underneath
     carries the full name, so the bar does not have to. */
  els.session.textContent = kind;
  els.session.dataset.kind = kind;
  els.session.title = "tap to switch between lecture, homework and test review";
  if (leavingTo) return;              /* a decision is in front of the student */
  if (state.finished) {
    els.finishLead.textContent = "Session finished.";
    els.finishSub.textContent = "Save this work and push it to GitHub?";
    els.finishYes.textContent = "Push";
    els.finishNo.textContent = "Not now";
    els.finishLeave.hidden = true;
    els.finish.hidden = false;
  } else if (els.finish.hidden !== false || !savePrompted()) {
    /* Leave a prompt the student raised themselves standing. */
    if (!savePrompted()) els.finish.hidden = true;
  }

  /* One banner, two things that can land in it. A push and an export are both
     "something slow happened, here is how it went", and the newer one is the
     one the person is waiting on -- an export triggers a payload the moment it
     finishes, and without this that payload would repaint the banner with a
     push from an hour ago. */
  var last = push;
  if (exported && (!push || (exported.at || 0) > (push.at || 0))) last = exported;
  if (!last || last.at <= pushDismissed) {
    els.pushed.hidden = true;
    return;
  }
  els.pushed.hidden = false;
  els.pushed.className = "pushed " + (last.ok ? "ok" : "bad");
  els.pushedIcon.textContent = last.ok ? "✓" : "✕";
  if (last === exported) {
    els.pushedText.textContent = last.ok
      ? (last.pdf || last.tex) + " — saved in the repository, and staged for "
        + "the next save"
      : "Export failed — "
        + ((last.detail || "no detail").split("\n")[0] || "no detail");
  } else if (last.ok) {
    var first = (last.detail || "").split("\n").filter(function (l) { return l.trim(); });
    els.pushedText.textContent = (first[first.length - 1] || "pushed") + " · " + last.iso;
  } else {
    els.pushedText.textContent = "Push failed — " + (last.detail || "no detail");
  }
}

/* The whole conversation as one document.

   Asked for from the device: something to show a professor. A print of the
   board is a screenshot of a scroll; this is the lesson typeset -- the tutor's
   cards and the pages that were handed in, in the order they happened -- kept
   in the repository under a numbered name, because "which one is the latest"
   should not mean reading a timestamp. */
function doExport(scope) {
  els.pushed.hidden = false;
  els.pushed.className = "pushed";
  els.pushedIcon.textContent = "…";
  els.pushedText.textContent = scope === "all"
    ? "building the whole course — LaTeX takes a moment…"
    : "building this lesson as a PDF…";
  return fetch("/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: scope || "lesson" })
  }).then(function (r) { return r.json(); })
    .then(function (rec) { paintSession({}, null, null, rec); })
    .catch(function () {
      els.pushed.className = "pushed bad";
      els.pushedIcon.textContent = "✕";
      els.pushedText.textContent = "Export failed — could not reach the board";
    });
}

/* Is the standing prompt one the student raised, rather than the end of a
   session? Then a payload arriving must not sweep it away mid-decision. */
function savePrompted() {
  return !els.finish.hidden && /^Save this work/.test(els.finishLead.textContent || "");
}

function doPush() {
  els.finish.hidden = true;
  els.finishLeave.hidden = true;
  els.pushed.hidden = false;
  els.pushed.className = "pushed";
  els.pushedIcon.textContent = "…";
  els.pushedText.textContent = "saving and pushing…";
  return fetch("/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  }).then(function (r) { return r.json(); })
    .then(function (rec) { paintSession({}, rec, null, null); })
    .catch(function () {
      els.pushed.className = "pushed bad";
      els.pushedIcon.textContent = "✕";
      els.pushedText.textContent = "Push failed — could not reach the board";
    });
}

/* Pushing from the leaving flow goes on to leave; from anywhere else it just
   pushes and the lesson carries on. */
els.finishYes.onclick = function () {
  var go = !!leavingTo;
  var done = doPush();
  if (go && done && done.then) done.then(goLeave, goLeave);
};

/* Saving must not depend on the tutor. Sessions end by being abandoned -- a lid
   closes, an allocation expires, somebody puts the iPad down -- and until now
   the only way to the push was a prompt that only `board finish` could raise.
   Work that is not committed is one bad night's sleep from gone. */
els.save.onclick = function () {
  els.finishLead.textContent = "Save this work?";
  els.finishSub.textContent = "Commit everything so far and push it to GitHub. "
                            + "The lesson stays open.";
  els.finish.hidden = false;
};
els.finishNo.onclick = function () {
  els.finish.hidden = true;
  els.finishLeave.hidden = true;
  leavingTo = null;
  fetch("/dismiss-finish", { method: "POST" }).catch(function () {});
};
document.getElementById("pushed-close").onclick = function () {
  els.pushed.hidden = true;
  pushDismissed = Date.now() / 1000;
};

function nearBottom() {
  return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
}

/* The newest thing the tutor has written. Not the newest thing on the page: the
   writing surface is the last element in the transcript, by design, because a
   correction is written under the feedback it answers. */
function newestCardNode() {
  var all = els.cards.querySelectorAll("[data-card]");
  return all.length ? all[all.length - 1] : null;
}

/* Where the eye should land when a card arrives: the TOP of that card, tucked
   under the bar. It used to be the bottom of the document, which is the bottom
   of the writing surface -- so the reply that had just been waited for was
   pushed off the top of the screen and what arrived instead was a blank slate.
   The first line of the new feedback is the thing to read first. */
function revealNewest(smooth) {
  var node = newestCardNode();
  var top;
  if (node) {
    var bar = document.getElementById("bar");
    var under = bar ? bar.getBoundingClientRect().height : 0;
    top = node.getBoundingClientRect().top + window.scrollY - under - 10;
    if (top < 0) top = 0;
  } else {
    top = document.body.scrollHeight;
  }
  if (smooth) window.scrollTo({ top: top, behavior: "smooth" });
  else window.scrollTo(0, top);
}

/* "Was the lesson still being read when this arrived." Near the bottom counts,
   and so does having the newest card anywhere on screen -- because the board
   now parks that card at the TOP of the window, which on a long lesson is
   nowhere near the bottom of the document. Judging by the bottom alone would
   call that scrolled-away and offer a jump button for the card being read. */
function following() {
  if (nearBottom()) return true;
  var node = newestCardNode();
  if (!node) return false;
  var r = node.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
}

/* Applied after the reconcile rather than folded into a card's key. A card
   becomes superseded when the NEXT one is written, and rebuilding a card --
   re-parsing its markdown, re-typesetting its mathematics, dropping the ink
   layer drawn on it -- because something after it arrived is exactly the work
   the keyed reconcile exists to avoid. */
function paintSuperseded(set) {
  Array.prototype.forEach.call(els.cards.querySelectorAll("[data-card]"),
                               function (node) {
    var old = !!set[node.dataset.card];
    node.classList.toggle("superseded", old);
    if (!old) node.classList.remove("open");
    var head = node.querySelector(".card-head");
    if (!head) return;
    var tag = head.querySelector(".card-older");
    if (old && !tag) {
      tag = document.createElement("span");
      tag.className = "card-older";
      head.appendChild(tag);
    } else if (!old && tag) {
      tag.remove();
    }
    if (tag) tag.textContent = node.classList.contains("open") ? "fold" : "replaced";
    if (old && !head._foldable) {
      head._foldable = true;
      head.addEventListener("click", function () {
        if (!node.classList.contains("superseded")) return;
        node.classList.toggle("open");
        var t = head.querySelector(".card-older");
        if (t) t.textContent = node.classList.contains("open") ? "fold" : "replaced";
      });
    }
  });
}

/* Photos and PDFs only. Sent pages used to land here too, which is why answers
   appeared as a pile of thumbnails at the bottom of the screen with nothing to
   say which question they belonged to. They are part of the lesson now. */
function renderScratch(uploads) {
  els.scratchList.innerHTML = "";
  if (!uploads.length) {
    els.scratchList.innerHTML = '<p class="name">nothing dropped yet. '
      + 'What you write goes into the lesson itself.</p>';
    return;
  }

  function tile(url, label, bust) {
    var a = document.createElement("a");
    a.href = url;
    /* Never a new context. Installed to the home screen there is no browser
       chrome, so a raw image opened this way has no back button and no way out
       of it short of killing the app. Images open in a viewer this page owns
       and can close; anything else is left to the system. */
    var isImage = /\.(png|jpe?g|gif|webp|heic)(\?|$)/i.test(url);
    if (isImage) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        openViewer(bust ? url + "?t=" + Math.round(bust) : url, label);
      });
    } else {
      a.target = "_blank";
      a.rel = "noopener";
    }
    if (isImage) {
      var img = document.createElement("img");
      img.src = bust ? url + "?t=" + Math.round(bust) : url;
      img.loading = "lazy";
      a.appendChild(img);
    }
    var name = document.createElement("span");
    name.className = "name";
    name.textContent = label;
    a.appendChild(name);
    els.scratchList.appendChild(a);
  }

  uploads.slice().reverse().forEach(function (u) {
    tile(u.url, u.name);
  });
}

/* ------------------------------------------------------------ past lessons */
/* Reading an old lesson is reading the same transcript, so it goes through the
   same renderer. The live stream is what is suspended, not the page: whatever
   arrives while you are reading is still there when you come back. */
var reading = null;
var lastLive = null;

function openHistory() {
  var panel = document.getElementById("history");
  var list = document.getElementById("history-list");
  panel.hidden = false;
  list.innerHTML = '<p class="name">looking…</p>';
  fetch("/archive").then(function (r) { return r.json(); }).then(function (d) {
    var sessions = d.sessions || [];
    if (!sessions.length) {
      list.innerHTML = '<p class="name">no finished lessons yet.</p>';
      return;
    }
    list.innerHTML = "";
    sessions.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "session-row";
      b.innerHTML = '<span class="session-name"></span>'
                  + '<span class="session-sub"></span>';
      b.querySelector(".session-name").textContent =
        s.chapter || s.course || s.id;
      b.querySelector(".session-sub").textContent =
        [s.session, s.opened, s.cards + " cards",
         s.turns + " of yours"].filter(Boolean).join(" · ");
      b.addEventListener("click", function () { showSession(s.id); });
      list.appendChild(b);
    });
  }).catch(function () {
    list.innerHTML = '<p class="name">could not read the archive.</p>';
  });
}

function showSession(id) {
  fetch("/archive/" + encodeURIComponent(id))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || d.ok === false) return;
      document.getElementById("history").hidden = true;
      reading = id;
      seenIds = {};
      firstPaint = true;
      var bar = document.getElementById("reading");
      bar.hidden = false;
      document.getElementById("reading-what").textContent =
        (d.state && (d.state.chapter || d.state.course)) || id;
      render({ state: d.state || {}, cards: d.cards || [], turns: d.turns || [],
               uploads: [], messages: [], archived: true });
    })
    .catch(function () { /* stay where we are */ });
}

function backToLesson() {
  reading = null;
  seenIds = {};
  firstPaint = true;
  document.getElementById("reading").hidden = true;
  if (lastLive) render(lastLive);
}

/* ------------------------------------------------------------- the viewer */
/* Built once, on first use, and closed by three separate gestures, because the
   thing being fixed here is being stuck. */
var viewer = null;

function buildViewer() {
  viewer = document.createElement("div");
  viewer.id = "viewer";
  viewer.hidden = true;
  viewer.innerHTML = '<button id="viewer-close" type="button" title="close">✕</button>'
                   + '<figure><img alt=""><figcaption></figcaption></figure>';
  document.body.appendChild(viewer);
  viewer.addEventListener("click", function (e) {
    if (e.target === viewer || e.target.id === "viewer-close") closeViewer();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeViewer();
  });
}

function openViewer(url, label) {
  if (!viewer) buildViewer();
  viewer.querySelector("img").src = url;
  viewer.querySelector("figcaption").textContent = label || "";
  viewer.hidden = false;
  document.body.classList.add("viewing");
  viewer.querySelector("#viewer-close").focus();
}

function closeViewer() {
  if (!viewer || viewer.hidden) return;
  viewer.hidden = true;
  viewer.querySelector("img").src = "";
  document.body.classList.remove("viewing");
}


/* ------------------------------------------------------- annotating a card */
/* Marks over the tutor's own words. They save themselves shortly after the pen
   lifts, so a reload never costs them, and they are sent as their own kind of
   turn -- anchored to the card they sit on, because that is the question they
   are asking about. */
var noteSaveTimer = null;

function saveNotes(send) {
  if (!window.Annotate) return Promise.resolve([]);
  /* Sending re-sent every mark on the board, so a card marked up yesterday and
     already delivered came back to the tutor as a fresh turn every time
     anything else was sent. Send what has not been sent. */
  var ids = send ? window.Annotate.unsent() : window.Annotate.unsaved();
  if (!ids.length) return Promise.resolve([]);
  return Promise.all(ids.map(function (id) {
    var body = window.Annotate.payload(id, send);
    return fetch("/annotate/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function () {
      window.Annotate.clean(id);
      if (send) window.Annotate.sent(id);
    });
  }));
}

function queueNoteSave() {
  if (noteSaveTimer) clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(function () { saveNotes(false); }, 900);
}

if (window.Annotate) {
  window.Annotate.onChange(function () {
    queueNoteSave();
    paintAnnTools();
    paintNotesSend();
  });
  /* A closing tab must not take the last stroke with it -- or the last sentence
     still being typed. */
  window.addEventListener("pagehide", function () { saveNotes(false); });
  window.addEventListener("pagehide", function () { flushTextDraft(); });
}

function setAnnotating(next) {
  if (!window.Annotate) return;
  window.Annotate.setOn(next);
  els.annbar.hidden = !next;
  els.annotate.setAttribute("aria-pressed", next ? "true" : "false");
  els.annotate.title = next ? "stop writing on the lesson"
                            : "write on the lesson itself";
  paintAnnTools();
}

els.annotate.onclick = function () {
  setAnnotating(!window.Annotate.isOn());
};

/* The tools are only meaningful while the mode is on, and a control that looks
   available but does nothing is worse than one that is plainly disabled. */
function paintAnnTools() {
  if (!window.Annotate) return;
  var erasing = window.Annotate.tool() === "erase";
  els.annPen.classList.toggle("on", !erasing);
  els.annErase.classList.toggle("on", erasing);
  els.annUndo.disabled = !window.Annotate.canUndo();
  els.annRedo.disabled = !window.Annotate.canRedo();
  els.annClear.disabled = !window.Annotate.marked().length;
  Array.prototype.forEach.call(document.querySelectorAll(".ann-ink"), function (b) {
    b.style.background = b.dataset.ink;
    b.classList.toggle("on", b.dataset.ink === window.Annotate.colour());
  });
}

els.annPen.onclick = function () { window.Annotate.setTool("pen"); paintAnnTools(); };
els.annErase.onclick = function () { window.Annotate.setTool("erase"); paintAnnTools(); };
els.annUndo.onclick = function () { window.Annotate.undo(); paintAnnTools(); };
els.annRedo.onclick = function () { window.Annotate.redo(); paintAnnTools(); };
els.annClear.onclick = function () { window.Annotate.clearCurrent(); paintAnnTools(); };
els.annDone.onclick = function () { setAnnotating(false); };
Array.prototype.forEach.call(document.querySelectorAll(".ann-ink"), function (b) {
  b.onclick = function () {
    window.Annotate.setPen(b.dataset.ink);
    window.Annotate.setTool("pen");
    paintAnnTools();
  };
});

/* ------------------------------------------------------------ send chooser */
/* Only asked when there is genuinely a choice: working on the slate AND marks
   on the lesson. One of the two alone just sends. */

function haveNotes() {
  return !!(window.Annotate && window.Annotate.unsent().length);
}

/* What Send does, and what it must never do.

   It used to ask first: with marks anywhere on the board, tapping Send on the
   writing surface issued no request at all and raised a "Send what?" bar
   instead, and the answer only went out on a second tap. That is a Send button
   that does nothing, and it cost a real answer -- an evening's working sat in
   live/slate/ for two days while the student believed they had handed it in,
   and the board's own receipt never appeared because the code that writes it
   was never reached. Nothing on the surface said a decision was outstanding.

   So the working goes first, unconditionally. The button sits on the surface
   holding the working; that is what it means. Marks on the lesson are then
   offered as a follow-up, which cannot lose anything, because by then the
   working is already gone.

   The one exception is an empty surface: with nothing written and marks that
   have not been sent, the marks ARE the answer, and handing the tutor a blank
   sheet alongside them is noise. */
function askWhatToSend(sendWork) {
  var marks = haveNotes();
  var written = !writer || writer.strokes() > 0;
  if (!written && marks) {
    saveNotes(true).then(function () { paintNotesSend(); toastSent(); });
    return;
  }
  sendWork();
  if (marks && !notesOff()) els.sendwhat.hidden = false;
}

/* Whether the student has said "no, and don't ask again". Persisted, so it
   survives the app being put down, and re-armed from the ⋯ menu when they change
   their mind and want to hand the marks over after all. */
var NOTES_OFF = "notes-off";

function notesOff() {
  try { return localStorage.getItem(NOTES_OFF) === "1"; } catch (e) { return false; }
}

function setNotesOff(v) {
  try {
    if (v) localStorage.setItem(NOTES_OFF, "1");
    else localStorage.removeItem(NOTES_OFF);
  } catch (e) {}
  paintNotesSend();
}

function closeChooser() {
  els.sendwhat.hidden = true;
}

els.sendNotes.onclick = function () {
  closeChooser();
  saveNotes(true).then(function () { paintNotesSend(); toastSent(); });
};
els.sendCancel.onclick = closeChooser;
els.sendNoAsk.onclick = function () {
  closeChooser();
  setNotesOff(true);
};

if (els.notesAgain) {
  els.notesAgain.onclick = function () {
    setNotesOff(false);
    paintNotesSend();
  };
}

els.notesend.onclick = function () {
  els.notesend.disabled = true;
  saveNotes(true).then(function () {
    els.notesend.disabled = false;
    paintNotesSend();
    toastSent();
  }, function () { els.notesend.disabled = false; });
};

window.askWhatToSend = askWhatToSend;


/* Marks can be made at any time -- on a card from ten minutes ago, with no
   question owed and therefore no writing surface and no Send button anywhere on
   the page. Without this they would sit there unsendable, which is the same dead
   end the cold start had. */
function paintNotesSend() {
  var any = haveNotes();
  var owedSurface = !els.writer.hidden;
  els.notesend.hidden = !(any && !owedSurface && !notesOff());
  /* The re-arm control is only meaningful while the offer is actually off, and
     only if there are marks to hand over. */
  if (els.notesAgain) {
    els.notesAgain.hidden = !(notesOff() && any);
  }
}


/* --------------------------------------------------- something to save yet? */
/* Leaving is silent. An app is swiped away, a lid closes, a lesson is put down
   mid-thought -- and none of those raise anything. So the state of the working
   tree is on the board: if there is uncommitted work, the save says so before
   you go, and if you come back to a session you left with work outstanding, the
   offer is put in front of you once rather than waiting to be found. */
var unsaved = 0;
var offeredOnReturn = false;
var lastUnsavedKnown = false;

function paintSave(n) {
  lastUnsavedKnown = (typeof n === "number");
  unsaved = lastUnsavedKnown ? n : 0;
  var has = unsaved > 0;
  els.save.classList.toggle("dirty", has);
  els.save.textContent = has ? "⤓ save " + unsaved : "⤓ save";
  els.save.title = has
    ? unsaved + " file(s) not yet committed — tap to save and push"
    : "everything here is committed";
}

function offerSaveOnReturn() {
  /* Only when there is genuinely something to lose, only once per return, and
     never on top of a decision already in front of the student. */
  if (!unsaved || offeredOnReturn || !els.finish.hidden) return;
  offeredOnReturn = true;
  els.finishLead.textContent = "Save this work?";
  els.finishSub.textContent = "You left with " + unsaved
    + " file(s) uncommitted. Commit and push them now — the lesson stays open.";
  els.finish.hidden = false;
}

document.addEventListener("visibilitychange", function () {
  if (document.hidden) offeredOnReturn = false;    /* arm it for the next return */
  else setTimeout(offerSaveOnReturn, 600);         /* after the first payload lands */
});


/* ------------------------------------------------------------ leaving here */
/* The back arrow is the ordinary way out of a lesson, and walking out of a
   lesson is exactly when uncommitted work gets left behind. The session itself
   is safe -- cards, turns and answers are files, and they are still here when
   you come back -- but what is on disk is not what is pushed. So the way out
   asks, every time, rather than only when the board happens to know something is
   outstanding. */
var leavingTo = null;

function askBeforeLeaving(href) {
  /* Nothing outstanding, nothing to ask about. A prompt that appears every time
     regardless is a prompt that gets dismissed without being read, which is how
     the one time it mattered gets dismissed too. `unsaved` is unknown (null) in
     a directory that is not a repository at all -- ask then, rather than assume.
   */
  if (unsaved === 0 && lastUnsavedKnown) { window.location.href = href; return; }
  leavingTo = href;
  els.finishLead.textContent = "Leaving this lesson.";
  els.finishSub.textContent = (unsaved > 0
      ? unsaved + " file(s) are not committed. "
      : "Everything here is already committed. ")
    + "The lesson is kept either way — it is still here when you come back.";
  els.finishYes.textContent = unsaved > 0 ? "Save and push" : "Push anyway";
  els.finishNo.textContent = "Stay";
  els.finishLeave.hidden = false;
  els.finish.hidden = false;
}

function goLeave() {
  var to = leavingTo || "/";
  leavingTo = null;
  els.finish.hidden = true;
  els.finishLeave.hidden = true;
  /* Announced before the page tears down: anything that needs a last word --
     an autosave of ink in progress, and whatever comes later -- gets it here
     rather than racing the navigation. */
  try {
    window.dispatchEvent(new CustomEvent("board:leave", { detail: { to: to } }));
  } catch (e) { /* an old engine without CustomEvent still leaves */ }
  saveNotes(false);
  window.location.href = to;
}

els.home.addEventListener("click", function (e) {
  e.preventDefault();
  askBeforeLeaving(els.home.getAttribute("href") || "/");
});

els.finishLeave.onclick = goLeave;


/* ------------------------------------------------------- lecture or homework */
/* Which kind of sitting this is was a terminal-only decision, so a student who
   wanted help with a problem set had to find a keyboard to say so. The badge in
   the title bar already names the kind; making it the control is the whole
   change. The sets offered are the ones the repository actually has -- nothing
   is typed, so nothing invented can reach the filesystem. */
var knownSets = [];
var sittingKind = "lecture";

function paintKindChooser() {
  els.kindLecture.classList.toggle("on", sittingKind === "lecture");
  els.kindReview.classList.toggle("on", sittingKind === "review");
  /* Offered only where there is something to review. A repository with no
     chapters and no parts would open a picker with nothing in it. */
  els.kindReview.hidden = !(reviewInfo && (reviewInfo.units || []).length);
  els.kindSets.innerHTML = "";
  if (!knownSets.length) {
    var none = document.createElement("span");
    none.className = "muted";
    none.textContent = "no problem sets in this course";
    els.kindSets.appendChild(none);
    return;
  }
  knownSets.forEach(function (name) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    if (sittingKind === "homework" && currentSet === name) b.classList.add("on");
    b.onclick = function () { setSitting("homework", name); };
    els.kindSets.appendChild(b);
  });
}

var currentSet = null;

function setSitting(kind, name, chapter) {
  els.kind.hidden = true;
  fetch("/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: kind, hw: name || null, chapter: chapter || null })
  }).catch(function () { /* the payload will say what actually happened */ });
}

els.session.onclick = function () {
  paintKindChooser();
  els.kind.hidden = false;
};
els.kindLecture.onclick = function () { setSitting("lecture"); };
els.kindReview.onclick = function () { els.kind.hidden = true; openReview(); };
els.kindCancel.onclick = function () { els.kind.hidden = true; };


/* ----------------------------------------------------------- test review */
/* Revision for a test, and the one sitting whose scope is the student's to
   choose: they know what is on the paper and the tutor does not. So it cannot
   start from a single tap the way a lecture does -- it asks what it covers
   first, from a list of what this repository actually has.

   Everything offered is discovered: the course's chapters, or, in a project with
   none, the project's own top-level parts. A tick is a name from that list and
   nothing else, so nothing typed can reach the filesystem and nothing invented
   can reach the tutor's prompt.

   The picks are held here rather than sent one at a time: a review over four
   chapters is one decision, and sending it four times would archive the lesson
   four times over. */
var reviewInfo = null;              /* what the payload says can be reviewed */
var reviewPick = [];                /* names ticked but not yet started */

function paintReview(state, info) {
  reviewInfo = info || null;
  var on = (state.session || "lecture") === "review";
  var scope = (info && info.scope) || [];
  els.rvbar.hidden = !on;
  if (!on) return;
  var by = {};
  ((info && info.units) || []).forEach(function (u) { by[u.name] = u; });
  els.rvScope.textContent = scope.length
    ? scope.map(function (n) { return (by[n] && by[n].label) || n; }).join(" · ")
    /* Reachable from a terminal, not from this page. Say what is missing rather
       than showing an empty strip that reads as "nothing to see". */
    : "nothing chosen yet — tap change";
}

function reviewNoun(info) {
  return (info && info.of) === "parts" ? "parts of the project" : "chapters";
}

function paintReviewPicker() {
  var host = els.reviewList;
  host.innerHTML = "";
  var units = (reviewInfo && reviewInfo.units) || [];
  els.reviewTitle.textContent = "Which " + reviewNoun(reviewInfo) + " is the test over?";

  if (!units.length) {
    var p = document.createElement("p");
    p.className = "none";
    p.textContent = "There is nothing here to review: this repository has no "
      + "chapters and no parts to ask over.";
    host.appendChild(p);
    els.reviewStart.disabled = true;
    els.reviewCount.textContent = "";
    return;
  }

  units.forEach(function (u) {
    var b = document.createElement("button");
    b.type = "button";
    b.innerHTML = '<span class="tick">✓</span><span class="what"></span>';
    b.querySelector(".what").textContent = u.label;
    if (reviewPick.indexOf(u.name) >= 0) b.classList.add("on");
    b.onclick = function () {
      var at = reviewPick.indexOf(u.name);
      if (at >= 0) reviewPick.splice(at, 1); else reviewPick.push(u.name);
      paintReviewPicker();
    };
    host.appendChild(b);
  });

  els.reviewCount.textContent = reviewPick.length
    ? reviewPick.length + " of " + units.length + " chosen"
    : "nothing chosen yet";
  els.reviewAll.textContent = reviewPick.length === units.length
    ? "clear" : "select all";
  /* A review over nothing is not a sitting, and starting one would file the
     lesson they are in away for no reason. */
  els.reviewStart.disabled = reviewPick.length === 0;
}

function openReview() {
  /* Reopening starts from what the sitting already covers, so "change" is an
     edit rather than a fresh decision. */
  reviewPick = ((reviewInfo && reviewInfo.scope) || []).slice();
  paintReviewPicker();
  els.review.hidden = false;
}

els.reviewAll.onclick = function () {
  var units = (reviewInfo && reviewInfo.units) || [];
  reviewPick = reviewPick.length === units.length
    ? [] : units.map(function (u) { return u.name; });
  paintReviewPicker();
};

els.reviewStart.onclick = function () {
  if (!reviewPick.length) return;
  els.review.hidden = true;
  fetch("/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: "review", over: reviewPick })
  }).catch(function () { /* the payload will say what actually happened */ });
};

els.rvChange.onclick = openReview;
document.getElementById("btn-review-close").onclick = function () {
  els.review.hidden = true;
};


/* --------------------------------------------------------------- contents */
/* A course is chapters and problem sets, and until now the board showed neither:
   the only way to a different chapter was somebody typing `board open` in a
   terminal. Everything listed here is discovered from the repository itself, so
   there is no index to keep in step and nothing that can go stale.

   Opening one files the current lesson away whole -- cards, turns and answers
   together -- so what is being left stays readable under the history button
   rather than being written over by what comes next. */
var contents = { chapters: [], sets: [] };
var pastCount = 0;

function row(label, sub, current, go) {
  var b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (sub) {
    var s2 = document.createElement("span");
    s2.className = "sub";
    s2.textContent = "  " + sub;
    b.appendChild(s2);
  }
  if (current) b.classList.add("here");
  b.onclick = go;
  return b;
}

function group(title) {
  var d = document.createElement("div");
  d.className = "group";
  d.textContent = title;
  return d;
}

function openContents() {
  var host = els.contentsList;
  host.innerHTML = "";
  var codeMode = document.body.dataset.mode2 === "code";
  var here = (lastLive && lastLive.state && lastLive.state.chapter) || "";

  if (contents.chapters.length) {
    host.appendChild(group("Chapters"));
    contents.chapters.forEach(function (c) {
      host.appendChild(row(c.label, "", c.label === here, function () {
        els.contents.hidden = true;
        setSitting("lecture", null, c.label);
      }));
    });
  }

  if (contents.sets.length) {
    host.appendChild(group("Problem sets"));
    contents.sets.forEach(function (x) {
      host.appendChild(row(x.name, x.rel, currentSet === x.name, function () {
        els.contents.hidden = true;
        setSitting("homework", x.name);
      }));
    });
  }

  if (!contents.chapters.length && !contents.sets.length) {
    /* A code repository has neither, and gets its sections as it goes: a
       section there is a piece of work that got committed, which is what
       `board push` marks. */
    host.appendChild(group(codeMode ? "Sections" : "This course"));
    var p = document.createElement("p");
    p.className = "none";
    p.textContent = codeMode
      ? "Sections here are made as you go: each piece of work that gets committed "
        + "is filed as one, and stays readable under ◷."
      : "No chapters or problem sets found in this repository.";
    host.appendChild(p);
  }

  /* A test review is a way around the course too -- it is just one that covers
     several chapters at once instead of opening one. */
  if (reviewInfo && (reviewInfo.units || []).length) {
    host.appendChild(group("Test review"));
    var scope = reviewInfo.scope || [];
    host.appendChild(row(
      scope.length ? "change what this review covers" : "revise for a test",
      scope.length ? scope.length + " chosen"
                   : reviewInfo.units.length + " " + reviewNoun(reviewInfo),
      sittingKind === "review",
      function () { els.contents.hidden = true; openReview(); }));
  }

  host.appendChild(group("Past lessons"));
  if (pastCount > 0) {
    host.appendChild(row("open the history", pastCount + " filed", false, function () {
      els.contents.hidden = true;
      openHistory();
    }));
  } else {
    var q = document.createElement("p");
    q.className = "none";
    q.textContent = "Nothing filed yet.";
    host.appendChild(q);
  }

  els.contents.hidden = false;
}

document.getElementById("btn-contents").onclick = function () {
  if (els.contents.hidden) openContents(); else els.contents.hidden = true;
};
document.getElementById("btn-contents-close").onclick = function () {
  els.contents.hidden = true;
};


/* The overflow menu. Closing on any choice matters more than it looks: on a
   tablet a menu that stays open after a tap is a menu that swallows the next
   one. */
document.getElementById("btn-more").onclick = function (e) {
  e.stopPropagation();
  els.barmenu.hidden = !els.barmenu.hidden;
};
Array.prototype.forEach.call(els.barmenu.querySelectorAll("button"), function (b) {
  b.addEventListener("click", function () { els.barmenu.hidden = true; });
});
document.addEventListener("click", function (e) {
  if (els.barmenu.hidden) return;
  if (!els.barmenu.contains(e.target)) els.barmenu.hidden = true;
});


/* What happened to the thing I just sent. Silence after sending is what makes a
   person tap Send again, or wonder whether the pen even worked. */
function paintSent() {
  if (!awaitingReply) { els.sent.hidden = true; return; }
  els.sent.hidden = false;
  var when = timeLabel(awaitingReply.t);
  var state = attached ? (working ? "working" : "waiting") : "none";
  els.sent.dataset.state = state;
  els.sentText.textContent =
      state === "working" ? "sent at " + when + " — the tutor is reading it"
    : state === "waiting" ? "sent at " + when + " — waiting for the tutor"
    : "sent at " + when + " — no tutor is attached to read it yet";
}

/* ------------------------------------------------------------------ stream */
var source = null;
var linkDead = false;
var everGotData = false;
var attached = false;      /* is there a tutor on the other end at all */
var awaitingReply = null;  /* an answer sent and not yet replied to */
var working = false;       /* and is it in the middle of a turn right now */
var sentAt = 0;            /* when begin was last tapped, so its label survives a frame */

/* An unreachable board used to be indistinguishable from an empty one: the shell
   comes out of the service worker's cache, the payload never arrives, and the
   page says "Nothing on the board yet" — which reads as "the tutor has not
   written", not as "you are looking at nothing live". The only signal that the
   link was down was a 0.55rem dot. So say it where the lesson would be. */
function paintLink(dead) {
  linkDead = dead;
  els.dot.className = dead ? "dot dead" : "dot live";
  els.dot.title = dead ? "not connected to the board" : "connected to the board";
  /* Never seen a payload: the page has nothing true on it, so this replaces the
     empty state. Seen one: keep the lesson readable and warn above it. */
  els.offline.hidden = !(dead && !everGotData);
  els.linkbad.hidden = !(dead && everGotData);
  if (dead && !everGotData) els.empty.hidden = true;
}

function connect() {
  if (source) source.close();
  source = new EventSource("/events");
  source.onopen = function () { paintLink(false); };
  source.onerror = function () { paintLink(true); };
  source.onmessage = function (ev) {
    if (!ev.data) return;
    everGotData = true;
    paintLink(false);
    try { render(JSON.parse(ev.data)); } catch (e) { /* ignore a torn frame */ }
  };
}

/* ------------------------------------------------------- the answer block */
/* The board is part of the lesson, not something laid over it: after each
   render it is moved into the card flow directly beneath the question it
   answers. Moving the node keeps the component alive; the strokes are redrawn
   from data afterwards, so nothing is lost even if the bitmap is not. */
var writer = null;
var pinnedTo = null;
/* Which question is open and which of my turns answers it, so Send knows
   whether it is starting an answer or correcting one. */
var answering = { question: null, turn: null, latest: null };
var loadedTurn = null;
/* Which question the student asked for the surface back on, or null for "not
   asked". Empty string means "asked, on a lesson with no open question". */
var reopenedFor = null;
/* The newest question as of the last render. The button below used to walk the
   card list itself and take the last question in payload order, while `render`
   takes the newest by mtime -- two answers to one question, and the request
   expiring the instant it was made if they ever disagreed. */
var lastNewestQ = "";
/* Which question they are answering, if they went back to an earlier one, and
   which question was newest when they went. Going back is a deliberate excursion
   and the tutor asking something NEW ends it -- the same rule `reopenedFor` has
   had from the start, and for the same reason: a request must not outlive what
   it was made for.

   Without the second half of that, going back to an earlier board pinned the
   live surface there for the rest of the sitting. A new question then arrived to
   find the surface parked several cards above it and no page of its own, so it
   got no board at all -- a question posed with nowhere to answer it, which is
   the worst state this board has. Reported from the device the evening the
   boards became reachable enough for anyone to hit it. */
var workingOn = null;
var workingOnAt = null;
/* The board the surface is standing in for, as `render` last worked it out.
   `workingOn` is a request; this is the answer to it, and it is what
   `restoreAnswer` puts under the pen. */
var liveSlot = null;
/* Which slate page belongs to which board.

   A question is not one board. It is a CHAIN of them, and that is what an
   exercise actually looks like: you write, you hand it in, the tutor answers
   underneath, and the next attempt carries on below the answer. Each of those
   attempts is a board of its own -- it stays where it was written, it keeps what
   was on it, and it can still be written on, because going back up an exercise
   to add a line to an earlier attempt is ordinary work.

   It used to be one page per question, and the single board slid down the run to
   sit under the newest card. So the earlier attempts did not persist: there was
   never more than one board per question to persist. Reported from a Galois
   sitting, in these words: "the previous board for this same question that I
   have not yet completed doesn't persist... I want ALL boards to persist and to
   operate independently of each other."

   Independently is the load-bearing word, and it is why a new attempt opens on a
   COPY of the one before it rather than on the same sheet. The working carries
   forward -- what is under the pen is everything written so far, which is what
   a correction needs -- and the board above keeps what it had, for ever, because
   they are two pages from the moment the copy is taken.

   No page is ever destroyed. The surface used to be cleared whenever a new
   question arrived -- with the reasoning that the next answer should not start
   on top of the last one, which is true, and with the consequence that a page of
   somebody's proof was deleted because the tutor asked something else, which is
   not acceptable. Two hours of Exercise 1.3 went that way.

   The record is one entry per BOARD, kept per course because the pages are:

       "<question>#<attempt>": { p: <page index>, a: <card it sits under> }

   `p` is missing on a board nobody has written on yet -- it is cut the moment
   somebody touches it, so a question the student never reached does not leave a
   sheet behind. `a` is where the board sits: the newest board of a question
   floats to the end of that question's run, because an answer belongs under the
   feedback it is answering, and it stops floating the moment it is frozen. */
var PAGES_KEY = "board.pages";
var boardPage = {};
var pagesLoaded = false;

function pagesKey() {
  var st = (lastLive && lastLive.state) || {};
  return PAGES_KEY + ":" + (st.course || "?") + ":" + (st.chapter || "-");
}

function loadPages() {
  var raw = {};
  try { raw = JSON.parse(localStorage.getItem(pagesKey()) || "{}") || {}; }
  catch (e) { raw = {}; }
  boardPage = {};
  for (var k in raw) {
    var v = raw[k];
    /* Before a question could have more than one board, the record was the page
       number alone under the question's own id. That is its first attempt, and
       where it sits is worked out on the next render. */
    if (typeof v === "number") boardPage[slotKey(k, 0)] = { p: v, a: null };
    else if (v && typeof v === "object") {
      boardPage[k.indexOf("#") === -1 ? slotKey(k, 0) : k] =
        { p: typeof v.p === "number" ? v.p : undefined, a: v.a || null };
    }
  }
}

function savePages() {
  try { localStorage.setItem(pagesKey(), JSON.stringify(boardPage)); } catch (e) {}
}

/* A board's name is its question and which attempt it is. */
function slotKey(q, n) { return q + "#" + n; }
function slotQ(key) { return key.slice(0, key.lastIndexOf("#")); }
function slotN(key) {
  var n = parseInt(key.slice(key.lastIndexOf("#") + 1), 10);
  return isNaN(n) ? 0 : n;
}

/* Every board in the lesson, in reading order, as of the last render. What
   "the board before this one" means, which is the whole of the carry-over. */
var slotOrder = [];

/* The last board before this one that somebody has actually written on.

   A follow-up question is a new question, so it gets a board of its own and that
   board is blank -- right for a new exercise, wrong three cards into one, where
   the proof being asked about is on the board above and the answer belongs with
   it. The board cannot tell those two apart (a question card is a question card)
   and guessing would be worse than asking: a new exercise opened on a copy of
   the last one is somebody else's proof under your pen, and every board after it
   carries every stroke of the evening. So the working is brought forward by the
   person who knows, in one tap. */
function prevInkSlot(key) {
  if (!writer || !writer.inkOn) return null;
  var i = slotOrder.indexOf(key);
  if (i < 0) i = slotOrder.length;
  for (var n = i - 1; n >= 0; n--) {
    var p = pageOf(slotOrder[n]);
    if (p !== undefined && writer.inkOn(p) > 0) return slotOrder[n];
  }
  return null;
}

/* Bring that working onto this board, as a copy of it.

   A copy, not the same sheet: from here the two go their own ways, which is the
   rule every board on this page follows. Never over ink -- a board with anything
   on it is somebody's work, and this would replace it. */
function carryOver(key) {
  if (!writer || !writer.clone) return;
  var rec = boardPage[key];
  if (!rec || (rec.p !== undefined && writer.inkOn(rec.p) > 0)) return;
  var from = prevInkSlot(key);
  var src = pageOf(from);
  if (src === undefined) return;
  rec.p = writer.clone(src);
  savePages();
  loadedTurn = null;
  if (lastLive) render(lastLive);
}

/* Come back to this in a moment, when the hand is off the glass. A payload is
   not due for thirty seconds and the board must not wait that long to catch up
   with itself. */
var soonTimer = null;
function renderSoon(ms) {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(function () {
    if (lastLive) render(lastLive);
  }, ms || 1200);
}

/* Every board a question has, oldest attempt first. */
function slotsOf(q) {
  var out = [];
  for (var k in boardPage) { if (slotQ(k) === q) out.push(k); }
  out.sort(function (a, b) { return slotN(a) - slotN(b); });
  return out;
}

/* The one an answer goes on now: the last attempt of the question. */
function newestSlot(q) {
  var all = slotsOf(q);
  return all.length ? all[all.length - 1] : null;
}

function pageOf(key) {
  var rec = key && boardPage[key];
  return rec ? rec.p : undefined;
}

/* Does any OTHER board already own this page?

   One board per page is the rule and nothing enforced it. The slate hands back a
   trailing blank page rather than cutting a new one every time -- right, or
   every board leaves an empty sheet behind it -- but two boards that reach it
   before either is written on both get the same index. From then on they are the
   same sheet: writing on the earlier one changes the later one, which is what it
   looks like from the outside and is exactly what it is. The slate cannot know;
   it deals in ink, not in questions. */
function pageOwnedByOther(n, key) {
  if (n === undefined || n < 0) return false;
  for (var k in boardPage) {
    if (k !== key && boardPage[k].p === n) return true;
  }
  return false;
}

/* The chain of boards, brought up to date with the transcript.

   A board is frozen -- left exactly where it is, with what is on it -- as soon
   as two things are true of it: what it holds has been handed in, and the tutor
   has written something since. The next attempt then opens on a copy, so the
   working carries forward and the two go their own ways from there.

   Both halves are needed. Freezing on the send alone would cut a board every
   time somebody pressed Send to check their working, and freezing on the
   tutor's card alone would cut one for a hint about working that has not been
   handed in yet. It is the reply to an answer that ends an attempt. */
function syncSlots(qids, runEndOf, turns) {
  var changed = false;
  var handedIn = {};                  /* question -> the page its answer came off */
  (turns || []).forEach(function (t) {
    if (!t || t.kind !== "ink" || !t.answers) return;
    if (typeof t.page === "number") handedIn[t.answers] = t.page - 1;
  });
  var ready = !!(writer && writer.ready && writer.ready());
  qids.forEach(function (q) {
    var end = runEndOf[q] || q;
    var key = newestSlot(q);
    if (!key) {
      /* A question nobody has reached yet still has a board: it says the
         question can be answered here, and touching it cuts the page. */
      boardPage[slotKey(q, 0)] = { p: undefined, a: end };
      changed = true;
      return;
    }
    var rec = boardPage[key];
    var sent = rec.p !== undefined && handedIn[q] === rec.p;
    if (sent && rec.a && rec.a !== end) {
      /* Handed in, and answered underneath. This attempt is finished with:
         freeze it here and open the next one on a copy of it. */
      if (!ready) return;             /* the pages are not knowable yet; next render */
      /* But never under a pen that is down. Cutting the next attempt moves the
         page, and a page that moves mid-word takes the rest of the word with
         it. There is nothing about this that has to happen in this particular
         second. */
      if (writer.writing && writer.writing()) { renderSoon(); return; }
      boardPage[slotKey(q, slotN(key) + 1)] = { p: writer.clone(rec.p), a: end };
      changed = true;
    } else if (!sent || !rec.a) {
      /* Still the attempt in progress, so it follows the end of the run: the
         place to answer is under the last thing the tutor said. */
      if (rec.a !== end) { rec.a = end; changed = true; }
    }
  });
  if (changed) savePages();
}

/* The turns this lesson has, kept so the page mapping can be repaired against
   them from wherever it is read. */
var lastTurns = [];

/* The answer each question actually handed in, newest revision of it. */
function sentAnswers() {
  var out = {};
  (lastTurns || []).forEach(function (t) {
    if (!t || t.kind !== "ink" || !t.answers || !t.png) return;
    var have = out[t.answers];
    if (!have || (t.t || 0) >= (have.t || 0)) out[t.answers] = t;
  });
  return out;
}

/* Has the page this board points at stopped being the answer that came off it?

   Fewer strokes than were handed in is the test, and it is the honest one: a
   page can only lose strokes by being cleared, reused or cloned over, and any of
   those means it is somebody else's sheet now. MORE strokes is the ordinary case
   of carrying on writing after sending, and the live page is then the better
   picture -- it holds the answer and the work since.

   Returns the answer that came off it, which is the thing to show and the thing
   to put back. */
function lostAnswer(key, share) {
  if (!writer || !writer.pages) return null;
  var answer = sentAnswers()[slotQ(key)];
  if (!answer) return null;
  var page = pageOf(key);
  if (page === undefined || page >= writer.pages()) return answer;
  if (typeof answer.strokes === "number" && writer.inkOn
      && writer.inkOn(page) < answer.strokes * (share === undefined ? 1 : share)) {
    return answer;
  }
  return null;
}

/* The frozen strokes of an answer, by the URL the turn carries.

   `live/answers/<turn>.json` is written once, beside the picture, and never
   touched again -- so unlike the slate page it came off, it cannot move. It is
   what a past board is DRAWN from, and what comes back under the pen when the
   sheet it was written on has been reused since.

   Fetched once per URL. A failure is remembered as a failure rather than
   retried, because the board falls back to the picture and a board that re-asks
   for a file that is not there on every render is a board that spends the
   evening asking. */
var frozenInk = {};
function frozenFor(url) {
  if (!url) return null;
  if (Object.prototype.hasOwnProperty.call(frozenInk, url)) {
    var have = frozenInk[url];
    return have === "asking" ? null : have;
  }
  frozenInk[url] = "asking";
  fetch(url).then(function (r) { return r.json(); }).then(function (d) {
    frozenInk[url] = (d && d.strokes && d.strokes.length) ? d : null;
    if (lastLive) render(lastLive);
  }).catch(function () { frozenInk[url] = null; });
  return null;
}

/* A board whose sheet no longer holds what was handed in off it, given that
   answer back on a page of its own.

   Without this, touching such a board opened the sheet as it is NOW -- cleared,
   or reused by a later question -- so the working vanished and the pen landed on
   what read as a brand new surface. Reported from the iPad: the boards whose
   colour was wrong were the same boards that "clear everything to be a new
   writing surface" when you write on them, and they are the same boards for the
   same reason: both halves were the frozen answer being shown by a picture
   drawn for somebody else, over a page that had moved on.

   Once per board per sitting, and never over ink: `adoptInk` cuts a new page, so
   the sheet that had been reused keeps whatever is on it and belongs to whoever
   is using it now. */
var reclaimed = {};
function reclaimAnswer(key) {
  if (!writer || !writer.adoptInk || reclaimed[key]) return;
  /* A HALF of what was handed in, where showing the frozen picture asks only for
     one stroke fewer -- and the difference is deliberate. Showing a picture is
     reversible and costs nothing when it is wrong. Moving the page under the pen
     is neither: somebody who sends an answer and then rubs two lines out of it
     is on that sheet, editing it, and cutting a fresh copy from the send would
     orphan the very edit they are making. A cleared or reused sheet holds a
     handful of strokes out of hundreds; an edited one holds nearly all of them.
     Only the first is a board whose answer has gone. */
  var answer = lostAnswer(key, 0.5);
  if (!answer || !answer.ink) return;
  var ink = frozenFor(answer.ink);
  if (!ink) return;                 /* the fetch renders again when it lands */
  if (writer.writing && writer.writing()) { renderSoon(); return; }
  reclaimed[key] = true;
  boardPage[key].p = writer.adoptInk(ink);
  savePages();
  loadedTurn = null;
}

/* Which page a question sits on, taken back from the record when the record in
   this browser has rotted.

   `boardPage` lives in localStorage and there is nothing in a browser that
   can tell a stale entry from a live one -- the pattern this repository keeps
   relearning, one more time: a record with no way to expire. And it CAN rot: an
   evening where the surface was told its page count too early was an evening
   where question after question was refiled against a page it was never written
   on, and the entry outlived the reload that made it.

   The server knows better, and always did. Every answer handed in carries the
   page it was sent from, so for any question that has been sent at all there is
   an authority for where its working is, on disk, surviving this browser
   entirely.

   It is applied conservatively, because the record is not the whole truth: a
   board written on and never sent has no record at all, and a page CLONED out of
   a shared sheet has moved since the send that named it. So the record is taken
   only where the entry in hand is already untrustworthy -- absent, past the end
   of the pages, sharing a sheet with another board, or pointing at a blank page
   when the record points at a written-on one. A healthy mapping is left exactly
   as it is.

   Which board of a question the record is about is not in doubt: an answer is
   versioned rather than re-sent, so a question has one turn and its page is the
   page of the attempt in hand. If any board of that question already holds it --
   they went back and handed in an earlier attempt -- there is nothing to repair
   and nothing to move. */
function repairPages() {
  if (!writer || !writer.ready || !writer.ready()) return;
  var n = writer.pages();
  var sentOn = {};
  lastTurns.forEach(function (t) {
    if (!t || t.kind !== "ink" || !t.answers) return;
    if (typeof t.page !== "number") return;
    var page = t.page - 1;                 /* the record is one-based */
    if (page < 0 || page >= n) return;
    var have = sentOn[t.answers];
    if (!have || (t.t || 0) >= have.t) sentOn[t.answers] = { t: t.t || 0, page: page };
  });
  /* Which question the RECORD says each page was sent for. A board sitting on a
     page that belongs to somebody else's question is wrong on evidence, not on
     suspicion -- and it is the one kind of wrong the conservative tests above
     cannot see, because such an entry looks perfectly healthy: the page exists,
     no other board claims it in this browser, and there is ink on it. It is just
     somebody else's ink.

     Reported from the board, looking back over a lesson: "their recordings are
     out of wack. My writing from one section is wrong and came from a later
     section, vice versa." Both halves of that are this: two boards swapped, each
     looking fine on its own. */
  var pageOwner = {};
  for (var qq in sentOn) {
    var owned = sentOn[qq].page;
    if (pageOwner[owned] === undefined) pageOwner[owned] = qq;
    else if (pageOwner[owned] !== qq) pageOwner[owned] = null;   /* shared: no claim */
  }

  var changed = false;
  for (var q in sentOn) {
    var want = sentOn[q].page;
    var keys = slotsOf(q);
    if (!keys.length) continue;            /* nothing to repair onto yet */
    var held = false;
    keys.forEach(function (k) { if (boardPage[k].p === want) held = true; });
    if (held) continue;
    var key = keys[keys.length - 1];
    var now = boardPage[key].p;
    var rotten = now === undefined
              || now >= n
              || pageOwnedByOther(now, key)
              || (writer.inkOn && writer.inkOn(now) === 0 && writer.inkOn(want) > 0)
              || (pageOwner[now] && pageOwner[now] !== q);
    if (!rotten) continue;
    boardPage[key].p = want;
    changed = true;
  }
  if (changed) savePages();
}

/* Every question has a board under it, and one of them is real.

   The board wanted, in the words it was asked for: it should LOOK like there
   are several live infinite canvases on the page. It cannot be several -- a live
   surface is two canvases at device resolution, about seventeen megabytes an
   iPad, and iPadOS answers an exceeded canvas budget with blank canvases or a
   reloaded tab. A dozen of those is not a slow board, it is a board that loses
   your working.

   So there is one live surface and the rest are photographs of themselves,
   drawn by the same paint code with the same paper and the same ink, at CSS
   resolution because nothing is going to be zoomed into them. Touch one and it
   becomes the live one -- including under a pen already coming down, which is
   handed straight through so its first stroke is not eaten by the swap. The
   difference is invisible until you write, which is exactly when it stops
   existing. */
function boardSlot(key, qid) {
  var slot = els.cards.querySelector('[data-slot="' + key + '"]');
  if (slot) return slot;
  slot = document.createElement("section");
  slot.className = "board";
  /* The board's own name, and the question it belongs to. Both, because a
     question has several boards and everything outside this function -- the
     transcript's way back to the working, the tests -- asks about a question. */
  slot.dataset.slot = key;
  slot.dataset.board = qid;
  slot.innerHTML =
    '<div class="board-head">'
    + '<span class="board-label">Your answer</span>'
    + '<span class="board-hint"></span>'
    + '<button type="button" class="board-carry" hidden></button>'
    + '<button type="button" class="board-send">Send</button>'
    + "</div>"
    + '<img class="board-shot" alt="what you have written here"'
    + ' decoding="async" loading="lazy">';

  var goLive = function (ev, andSend) {
    if (workingOn === key && !els.writer.hidden) return;
    /* Touching a board is asking to write on THAT board -- this attempt, not
       merely this question -- and `workingOn` is already the whole of that ask:
       an answer is owed wherever it points, so this opens the panel on a lesson
       the tutor has marked right without needing a second flag to say so. */
    workingOn = key;
    workingOnAt = lastNewestQ;
    reopenedFor = null;
    if (lastLive) render(lastLive);
    if (!writer) return;
    /* Lay the real canvas out now rather than on the next frame: a pen is
       already on the glass and its first sample is converted against the
       canvas's rectangle. */
    writer.relayout();
    if (ev && writer.sheet) handOnStroke(ev, writer.sheet());
    if (andSend) writer.save(true);
  };

  slot.addEventListener("pointerdown", function (ev) {
    if (ev.target.closest
        && ev.target.closest(".board-send, .board-carry")) return;
    goLive(ev, false);
  });
  slot.querySelector(".board-send").onclick = function () { goLive(null, true); };
  slot.querySelector(".board-carry").onclick = function (ev) {
    ev.stopPropagation();
    carryOver(key);
    workingOn = key;                 /* carrying it over is asking to write here */
    workingOnAt = lastNewestQ;
    if (lastLive) render(lastLive);
  };
  return slot;
}

/* Go to the board that carries a question's working, wherever it is on the page:
   the picture of it, or the live surface if that question is the one open. A
   question has a chain of boards; the one meant here is the attempt in hand,
   which is the last of them. */
function showBoardFor(qid) {
  var all = els.cards.querySelectorAll('[data-board="' + qid + '"]');
  var n = all.length ? all[all.length - 1] : null;
  if (!n && !els.writer.hidden && answering.question === qid) n = els.writer;
  if (n && n.scrollIntoView) n.scrollIntoView({ block: "center", behavior: "smooth" });
}

/* A stroke that landed on a picture, given to the canvas that replaced it.
   Without this the first mark on a dormant board is always lost -- and a first
   mark that does nothing is indistinguishable from a broken pen. */
function handOnStroke(ev, sheet) {
  if (!sheet || !sheet.dispatchEvent) return;
  var Ctor = window.PointerEvent || window.MouseEvent;
  var copy;
  try {
    copy = new Ctor("pointerdown", {
      bubbles: true, cancelable: true,
      clientX: ev.clientX, clientY: ev.clientY,
      pointerId: ev.pointerId, pointerType: ev.pointerType || "pen",
      pressure: ev.pressure || 0.5, isPrimary: true,
    });
  } catch (e) { return; }
  sheet.dispatchEvent(copy);
}

/* Every board this lesson has, each under the card it was written beneath, and
   the live surface swapped in for whichever one is being written on. */
/* Offered on a board with nothing on it, when there is working behind it, and
   never anywhere else. Named with the question it would come from, because
   "carry it over" means nothing without saying over from where. */
function paintCarry(btn, key) {
  if (!btn) return;
  var rec = key && boardPage[key];
  var blank = !!rec && (rec.p === undefined
                        || !writer || !writer.inkOn || writer.inkOn(rec.p) === 0);
  var from = blank ? prevInkSlot(key) : null;
  btn.hidden = !from;
  if (from) {
    btn.textContent = "↴ carry over from question " + slotQ(from);
    btn.title = "copy that board's working onto this one, to carry on with it";
  }
}

function paintBoards(qids, liveKey, off) {
  /* The answer each question actually handed in, newest revision.

     A past board used to be a picture of a SLATE PAGE, taken now -- and a slate
     page is live. It gets written on again, cleared, cloned, reused. So a board
     under an old question showed whatever had happened to that sheet since,
     which from the iPad is: "their recordings are out of wack. My writing from
     one section is wrong and came from a later section" and later "the very
     latest few are just repeats of my earliest".

     Measured on this lesson rather than guessed: the answer to question 6 was
     handed in off page 7 with 279 strokes, and page 7 now holds one; question
     7's came off page 9 with 279, and page 9 now holds a different 228. Pages 4
     and 12 are byte-identical. Every FROZEN answer was correct and distinct the
     whole time -- nothing was ever lost -- and the boards were pointing at a
     moving target.

     What was handed in cannot move: it is written once, into live/answers/, and
     never touched again. So a board whose page no longer holds the answer that
     came off it shows the answer instead. */
  var sentInk = sentAnswers();
  /* Every photograph is keyed by the paper it was taken on as well as by what is
     on it. The paper is a device setting -- one tap turns the whole sitting from
     slate to white -- and without it in the key the pictures kept the old scheme
     until something else happened to change them. */
  var skin = writer && writer.paper ? writer.paper() : "";
  /* And the box each picture sits in is painted the same colour as the paper.
     It was #101114 in the stylesheet -- the slate's own black -- which is right
     until somebody chooses white paper, and then every board that has nothing on
     it yet is a black rectangle in a run of white ones. */
  if (skin && window.Slate && window.Slate.paperBg) {
    document.documentElement.style.setProperty(
      "--shot-bg", window.Slate.paperBg(skin.split("/")[0]));
  }

  /* Every board in the lesson, in reading order, with which attempt of its
     question it is. */
  var all = [];
  qids.forEach(function (qid) {
    var attempts = slotsOf(qid);
    attempts.forEach(function (key, i) {
      all.push({ key: key, qid: qid, n: i + 1, of: attempts.length });
    });
  });
  var live = {};
  all.forEach(function (it) { live[it.key] = true; });

  Array.prototype.forEach.call(els.cards.querySelectorAll("[data-slot]"),
                               function (node) {
    /* The board being written on has the real surface, so its picture goes --
       leaving it would show the board twice, once alive and once as a
       photograph of a moment ago. */
    if (off || !live[node.dataset.slot] || node.dataset.slot === liveKey) {
      node.remove();
    }
  });
  if (off || !writer) return;

  all.forEach(function (it) {
    if (it.key === liveKey) return;                /* the real one goes here */
    var rec = boardPage[it.key];
    var anchor = els.cards.querySelector('[data-card="' + rec.a + '"]');
    if (!anchor || !anchor.parentNode) return;
    var slot = boardSlot(it.key, it.qid);
    if (anchor.nextSibling !== slot) {
      anchor.parentNode.insertBefore(slot, anchor.nextSibling);
    }
    slot.hidden = false;
    /* Which attempt this is, but only once there is more than one -- on a
       question answered in one go the number is noise. */
    var which = it.of > 1
      ? "question " + it.qid + " · attempt " + it.n + " of " + it.of
      : "question " + it.qid;
    slot.querySelector(".board-hint").textContent = which + " · tap to write";
    var page = rec.p;

    var answer = lostAnswer(it.key);
    if (answer) {
      slot.querySelector(".board-hint").textContent = which + " · as it was handed in";
      var frozen = slot.querySelector(".board-shot");
      /* Drawn from the frozen STROKES, by the slate, on the paper in hand.

         It used to be the answer's own PNG, and that file is written for a
         different reader: always dark ink on white, cropped to the writing,
         because its job is to be legible to whatever agent opens it. Among the
         boards it read as exactly what it is -- a white sheet in a run of black
         ones, at a magnification of its own. "The color is inverted", from the
         iPad, mid-proof. The strokes were on disk beside it the whole time, so
         a past board can be drawn by the same code as a live one and is then
         indistinguishable from it, which is the rule every board here follows.

         The picture stays as the fallback for an answer with no frozen strokes
         -- one handed in before they were kept -- because an inverted board
         still shows the working, and a blank one does not. */
      var ink = frozenFor(answer.ink);
      var mark = "frozen:" + (answer.ink || answer.png) + ":" + skin
               + ":" + (ink ? "ink" : "png");
      if (slot.dataset.shot !== mark) {
        var drawn = "";
        if (ink && writer.previewInk) {
          var fb = slot.getBoundingClientRect();
          drawn = writer.previewInk(ink,
                                    Math.round(fb.width) || 900,
                                    Math.round(frozen.getBoundingClientRect().height) || 420);
        }
        /* Nothing to show yet: the strokes are on their way. Leave the board as
           it is rather than flashing the inverted picture up and swapping it a
           moment later. */
        if (drawn || !ink) {
          frozen.src = drawn || answer.png;
          frozen.alt = "the answer handed in for question " + it.qid;
          slot.dataset.shot = mark;
        }
      }
      paintCarry(slot.querySelector(".board-carry"), it.key);
      return;
    }

    if (page === undefined) {
      /* Never written on, so there is no picture to take -- but a blank board is
         still a board. It says the question can be answered here, and touching it
         cuts the page. It used to show nothing at all, which is fine exactly as
         long as the live surface happens to be under that question, and is a
         question posed with nowhere to answer it the moment anything parks the
         surface somewhere else. Something did. */
      /* And it has to SAY it is blank. An empty board with the same caption as
         a full one reads as a board whose working has gone missing, which is
         how it was read the first evening it existed -- by someone whose ink
         was on disk the whole time. A board is allowed to be empty; it is not
         allowed to be ambiguous about it. */
      slot.querySelector(".board-hint").textContent =
        which + " · nothing written here yet · tap to write";
      var blank = slot.querySelector(".board-shot");
      if (slot.dataset.shot !== "blank") {
        blank.removeAttribute("src");
        blank.alt = "";                   /* no broken-image text on a blank sheet */
        slot.dataset.shot = "blank";
      }
      paintCarry(slot.querySelector(".board-carry"), it.key);
      return;
    }
    paintCarry(slot.querySelector(".board-carry"), it.key);
    /* Redrawn only when the page it is a picture of has actually changed. */
    var mark = page + ":" + (writer.inkOn ? writer.inkOn(page) : 0) + ":" + skin;
    if (slot.dataset.shot === mark) return;
    var shot = slot.querySelector(".board-shot");
    var box = slot.getBoundingClientRect();
    var w = Math.round(box.width) || 900;
    var h = Math.round(shot.getBoundingClientRect().height) || 420;
    var url = writer.preview ? writer.preview(page, w, h) : "";
    if (!url) return;
    shot.src = url;
    slot.dataset.shot = mark;
  });
}

var SIGNAL_LABEL = { done: "ready to check", help: "needs help", confused: "confused",
                     begin: "asked the tutor to begin", skip: "skipped this one" };

/* The answer block for a code project.

   The three signals are pace control -- ready to check, I need help, I'm
   confused -- and not one of them is "here is my answer". The text row is shut
   until help or confused is picked. So a card that asked the student to decide
   something gave them nowhere to say what they had decided, and the only route
   was a terminal, which is the ceremony this whole tool exists to remove.

   Two ways, because the question decides which is easier: write on the card
   itself, which is how you answer *about a place* in it, or type, which is how
   you answer in sentences. */
/* A card is a file, and the lesson shows nothing until that file exists. So the
   minute a tutor spends writing one is a minute of a blank screen with no way to
   tell it apart from a tutor that has died -- and the difference used to be a dot
   in the title bar the size of a full stop. Say it where the card is going to
   appear, and count, because a wait you can see the length of is a different
   experience from one you cannot. */
var busySince = 0;
var busyTurn = -1;
var busyFrom = 0;
var busyTimer = null;

/* The newest card's mtime -- a correction to an existing card counts as much as
   a new one, since either way something appeared for them to read. */
function newestCard(data) {
  var newest = 0;
  (data.cards || []).forEach(function (c) {
    if (c.mtime > newest) newest = c.mtime;
  });
  return newest;
}

function paintBusy(data) {
  if (!els.busy) return;
  var st = data.agent || null;
  var working = !!st && st.state === "working" && !data.archived;
  if (!working) {
    els.busy.hidden = true;
    busySince = 0;
    busyTurn = -1;
    if (busyTimer) { clearInterval(busyTimer); busyTimer = null; }
    return;
  }
  /* A new turn restarts the clock; the same turn continuing does not. */
  var turn = st.turns || 0;
  if (busyTurn !== turn || !busySince) {
    busyTurn = turn;
    busySince = Date.now();
    busyFrom = newestCard(data);
  }

  /* The card is what they are waiting for, and a turn does not end when the card
     lands -- the tutor goes on to verify, file, and write the handoff, and the
     daemon says "working" for all of it. So this counted on for minutes after
     the answer was already on screen, which is how a 34-second card came to look
     like a four-minute wait. Once something new is on the board, stop talking. */
  if (newestCard(data) > busyFrom) {
    els.busy.hidden = true;
    if (busyTimer) { clearInterval(busyTimer); busyTimer = null; }
    return;
  }
  /* Deliberately NOT inside #cards. That container is reconciled -- keyed nodes
     are matched and moved in place -- and an unkeyed element sitting among them
     is stepped over by the cursor walk, so cards get inserted on the wrong side
     of it and the answer block stops sitting under its own question. It lives
     immediately after the lesson instead, which puts it in the same place on
     screen and out of the way of everything. */
  els.busy.hidden = false;
  tickBusy();
  if (!busyTimer) busyTimer = setInterval(tickBusy, 1000);
}

function tickBusy() {
  if (!els.busy || els.busy.hidden || !busySince) return;
  var secs = Math.max(0, Math.round((Date.now() - busySince) / 1000));
  els.busySince.textContent = secs < 60 ? secs + "s"
    : Math.floor(secs / 60) + "m " + (secs % 60) + "s";
  /* Past a couple of minutes, silence stops being reassuring. Say that this one
     is long rather than letting the number say it alone. */
  els.busyText.textContent = secs > 150
    ? "the tutor is still writing — this one is taking a while"
    : "the tutor is writing";
}

/* The writing surface used to be capped against the visual viewport here, so
   that pinch-zooming the page could not make it swallow the glass. The cap
   worked and was still wrong: it was a fraction of what could be SEEN, so it
   shrank by exactly the factor the page was magnified by -- and zooming in on
   the writing therefore did nothing at all, because the block got smaller as
   fast as the page got bigger. A surface for reading handwriting that cannot be
   zoomed into is worse than one you can occasionally get lost in.

   The button is the answer instead. It rides on the visual viewport, so it
   cannot be zoomed off the glass, and one tap puts the magnification back. That
   makes zooming safe without making it useless, which is the trade the cap had
   backwards. What is left in the layout is `--gap` on `#writer`: the strip of
   page down each side that is there to put a thumb on. */

function placeWriter(owed, questionNode, live) {
  els.writer.hidden = !owed;
  /* The surface's re-centre exists while the surface does, and not otherwise:
     a button offering to find writing on a board that is not on screen is a
     button that does nothing, which is worse than no button. */
  if (els.findink) {
    var wasHidden = els.findink.hidden;
    els.findink.hidden = !owed;
    if (wasHidden !== els.findink.hidden) { findSize = null; panicSoon(); }
  }
  /* The tool bar is fixed to the bottom of the window, so the page has to give
     up the height it occupies or the last card sits underneath it. */
  document.body.classList.toggle("tools-out", !!owed);
  paintPanel();
  if (!owed) {
    /* The panel is shut and the pages behind it are still the lesson's: every
       dormant board is a picture drawn from them, so with no surface built there
       is nothing to draw and the transcript comes back as photographs of sent
       answers alone. Build it anyway on a live lesson -- hidden, unlaid-out and
       costing what one surface has always cost -- and re-render once, now that
       there is something to take pictures with. A filed lesson and a past one
       build nothing: there is no writing to be done in either. */
    if (live) makeWriter(function () { if (lastLive) render(lastLive); });
    return;
  }

  /* The anchor is looked up by card id now, so it can be any node in the lesson
     rather than only the last child -- which means checking it is actually IN
     the lesson before inserting beside it. */
  var host = questionNode && questionNode.parentNode;
  if (host && questionNode.nextSibling !== els.writer) {
    host.insertBefore(els.writer, questionNode.nextSibling);
  } else if (!host && els.writer.parentNode !== els.cards) {
    els.cards.appendChild(els.writer);
  }

  if (!makeWriter(restoreAnswer) && writer) {
    requestAnimationFrame(writer.relayout);
    restoreAnswer();
  }
}

/* The one place the surface is built. Returns whether it started building one --
   `false` means there is already one, or this browser has no Slate at all. */
function makeWriter(then) {
  if (writer || !window.Slate) return false;
  {
    requestAnimationFrame(function () {
      writer = window.Slate.create({
        root: document.getElementById("slate"),
        bar: document.getElementById("drawbar"),
        compact: true,
        context: function () {
          return { turn: answering.turn ? answering.turn.id : null,
                   answers: answering.question };
        },
        onSend: function (res) {
          /* The ink that was just sent is already on the surface -- it is what
             was sent. Without this, the payload that follows carries a turn one
             revision newer than the one `restoreAnswer` has loaded, so it fetches
             the answer back off the server and hands it to `load`, which re-fits
             the page: the working visibly jumps and the zoom you were writing at
             is thrown away, every single time Send is pressed. */
          if (res && res.turn && res.rev) loadedTurn = res.turn + ":r" + res.rev;
          toastSent();
          revealSentSettling();
        },
        /* Marks on the lesson are a second thing that can be sent. Ask which,
           but only when both actually exist. */
        beforeSend: askWhatToSend,
        /* The saved pages have arrived and the count can be believed. Everything
           about which question sits on which page was deferred until now. */
        onPages: function () {
          restoreAnswer();
          if (lastLive) render(lastLive);
        },
        /* The paper is a device setting and every board on the page is drawn
           with it, so one tap has to repaint the photographs too -- otherwise
           the live surface turns white and a dozen dormant boards stay on
           slate. */
        onPaper: function () { if (lastLive) render(lastLive); },
      });
      window.__writerDebug = writer.debug;
      if (then) then();
    });
  }
  return true;
}

/* Put the right page under the pen for whichever question is being answered, and
   put a previously sent answer back on it when the tutor has commented.
 
   Nothing is ever wiped. Each question gets a page of its own, and a page that
   has been written on stays written on for the life of the sitting -- the ⋯ menu
   walks them, and going back to an earlier question comes back here and returns
   to its page with the working still on it. */
function restoreAnswer() {
  if (!writer) return;
  /* Not until the surface knows what its pages actually are.

     It is usable before the network answers -- one blank sheet, so a stroke made
     in the first half-second is not thrown away -- and for that half-second the
     page count is a lie. Acting on it did two kinds of damage, both silent.
     A question recorded against a page past the end of that lie was ruled gone,
     given a fresh page, and WRITTEN DOWN there: a reload refiled question after
     question onto page 0, and an evening's working ended up on one sheet with
     the mapping to it destroyed. And loading a sent answer onto the stand-in
     page put strokes on it, which is exactly the condition under which the saved
     pages are then refused adoption -- so the real working never arrived at all.

     Waiting costs nothing: `onPages` calls this the moment the count is real. */
  if (!writer.ready || !writer.ready()) return;
  /* The pages have only just become knowable, and this is the first thing to
     read the mapping when they do. */
  repairPages();

  /* Before anything decides which page goes under the pen: if this board's sheet
     no longer holds the answer that came off it, the answer comes back first. */
  if (liveSlot && boardPage[liveSlot]) reclaimAnswer(liveSlot);

  if (liveSlot && boardPage[liveSlot] && writer.fresh) {
    var rec = boardPage[liveSlot];
    var want = rec.p;
    if (want === undefined || want >= writer.pages()) {
      /* Nobody has written on this board yet. A blank page at the end, unless
         the page in hand is still blank -- in which case it is already the right
         one, and adding another would leave an empty page behind on every board.
         That reuse is right only while the blank page belongs to nobody: hand it
         to a second board and the two share a sheet, which is one board changing
         when you write on another. */
      want = writer.fresh(pageOwnedByOther(writer.pages() - 1, liveSlot));
      rec.p = want;
      savePages();
    } else if (pageOwnedByOther(want, liveSlot)) {
      /* Already sharing. Give this one its own copy: the working stays where it
         is on screen -- nothing disappears out from under anybody -- and from
         here the two boards go their own ways. Repaired when the board is opened
         rather than in a sweep, because that is when the copy becomes the page in
         hand and the ordinary save carries it to disk. */
      want = writer.clone(want);
      rec.p = want;
      savePages();
      loadedTurn = null;
    } else if (want !== writer.at()) {
      writer.go(want);
      /* A different page is a different answer: whatever was loaded is not on
         this one. */
      loadedTurn = null;
    }
  }

  var id = answering.turn ? answering.turn.id + ":r" + answering.turn.rev : null;
  if (id === loadedTurn) return;
  if (!answering.turn) {
    /* Nothing sent against this question yet. The page is either blank or holds
       working in progress, and both are right -- there is nothing to restore and
       nothing to destroy. */
    loadedTurn = null;
    return;
  }
  /* And only when the page is empty. Once there is ink on this question's page
     it IS the answer, newer than anything the server can hand back, and
     replacing it would throw away everything written since the last send. */
  if (writer.inkOn && writer.inkOn() > 0) {
    loadedTurn = id;
    return;
  }
  var mark = id;
  fetch(answering.turn.ink).then(function (r) { return r.json(); })
    .then(function (data) {
      if (mark !== (answering.turn && answering.turn.id + ":r" + answering.turn.rev)) return;
      writer.load(data);
      loadedTurn = mark;
    })
    .catch(function () { /* offline: leave whatever is on the surface */ });
}

/* Confirm, and get out of the way. Closing the panel here is what made a
   correction impossible: the ink was gone from under you the moment it went. */
var hintWas = null, hintTimer = null;

function toastSent() {
  var hint = document.getElementById("writer-hint");
  if (!hint) return;
  if (hintWas === null) hintWas = hint.textContent;
  hint.textContent = "sent — keep writing, Send again to update it";
  hint.classList.add("just-sent");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(function () {
    hint.textContent = hintWas;
    hint.classList.remove("just-sent");
  }, 2600);
}

/* ------------------------------------------------------------------ input */
/* What comes back from the board depends on the mode. In a mathematics course
   there is no text box at all -- answering means writing on the slate. In a code
   course a sentence is usually the right unit ("look at what I just wrote"), so
   the box is there and the slate is one tap away for sketching. */
/* --------------------------------------- one answer panel, two surfaces */
/* The student writes on the slate or types, whichever they used last. A typed
   draft is kept per question the way the slate keeps a page per question, so
   flipping between the two does not lose either half. */

var ANSWER_KIND = "answer-kind";
var pendingSignal = null;       /* a code signal waiting on its sentence */
var textDrafts = {};            /* question id -> typed draft */
var textDraftsSeeded = false;
var lastTextQuestion = null;
var textSaveTimer = null;

function answerKind() {
  try {
    if (localStorage.getItem(ANSWER_KIND) === "type") return "type";
  } catch (e) {}
  return "write";
}

function setAnswerKind(kind) {
  try { localStorage.setItem(ANSWER_KIND, kind); } catch (e) {}
}

function seedTextDrafts(data) {
  if (textDraftsSeeded) return;
  textDraftsSeeded = true;
  var d = data.text_drafts || {};
  Object.keys(d).forEach(function (q) { textDrafts[q] = d[q]; });
}

function flushTextDraft() {
  clearTimeout(textSaveTimer);
  textSaveTimer = null;
  if (!lastTextQuestion) return;
  fetch("/text/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: lastTextQuestion,
                           text: textDrafts[lastTextQuestion] || "" })
  }).catch(function () {});
}

function saveTextDraft() {
  if (!answering.question) return;
  var q = answering.question;
  textDrafts[q] = els.saybox.value;
  clearTimeout(textSaveTimer);
  textSaveTimer = setTimeout(function () {
    fetch("/text/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, text: textDrafts[q] || "" })
    }).catch(function () {});
  }, 800);
}

function restoreTextDraft() {
  if (!answering.question) { els.saybox.value = ""; return; }
  if (lastTextQuestion === answering.question) return;
  if (lastTextQuestion !== null) flushTextDraft();
  lastTextQuestion = answering.question;
  loadedTextTurn = null;    /* a different question is a different answer */
  els.saybox.value = textDrafts[answering.question] || "";
  autosize();
}

/* Which surface a question opens on: what the person actually asked for on THIS
   question, else the one it was answered with, else the remembered choice.

   The order matters and it was wrong. A question already answered in ink
   returned "write" from its history whatever the tabs were told, so pressing
   *type* on a question you had written an answer to did nothing at all -- it set
   the remembered kind, repainted, and the history overruled it again on the way
   back. Which is every question worth typing about: you write the proof, the
   tutor asks what you meant by a line of it, and the answer to that is a
   sentence.

   Same shape as `chosen.json` on the other side of the wire: a decision
   outranks an inference drawn from what happens to be on disk, and the decision
   is the one thing the files cannot tell you. */
var pickedKind = {};

function panelKind() {
  var q = answering.question;
  if (q && pickedKind[q]) return pickedKind[q];
  var t = answering.latest;
  if (t) {
    if (t.kind === "ink" || t.kind === "annotation") return "write";
    if (t.kind === "text" && !t.signal) return "type";
  }
  return answerKind();
}

/* A tab press, recorded against the question it was pressed on. */
function pickKind(kind) {
  if (answering.question) pickedKind[answering.question] = kind;
  setAnswerKind(kind);
  paintPanel();
}

/* The write half or the type half, decided by the question's own history and the
   remembered kind. */
function paintPanel() {
  var open = !els.writer.hidden;
  /* The live board gets the same offer the dormant ones get, in the same words:
     this is where the person actually is when a follow-up question lands them on
     a blank sheet. */
  paintCarry(els.carry, open ? liveSlot : null);
  var typing = open && panelKind() === "type";
  els.typebox.hidden = !typing;
  var slate = document.getElementById("slate");
  if (slate) slate.hidden = typing;
  document.getElementById("drawbar").hidden = !(open && !typing);
  els.tabWrite.classList.toggle("on", !typing);
  els.tabType.classList.toggle("on", typing);
  if (typing) { restoreTextDraft(); restoreTextAnswer(); }
  else if (writer) requestAnimationFrame(writer.relayout);
}

/* The typed answer already sent against this question, brought back for
   correction -- the typed counterpart of the slate restoring its page of ink.
   Guarded like the ink: the turn just sent is not loaded back over the empty
   box, and newer local typing wins. */
var loadedTextTurn = null;

function restoreTextAnswer() {
  var t = answering.latest;
  if (!t || t.kind !== "text" || t.signal || !t.text) return;
  var id = t.id + ":r" + (t.rev || 1);
  if (id === loadedTextTurn) return;
  if (els.saybox.value.trim()) return;
  loadedTextTurn = id;
  els.saybox.value = t.text;
  autosize();
}

function autosize() {
  els.saybox.style.height = "auto";
  els.saybox.style.height = Math.min(els.saybox.scrollHeight, 9 * 16) + "px";
}

function say(signal) {
  var text = els.saybox.value.trim();
  if (!text && !signal) return;
  els.saybox.value = "";
  if (answering.question) { textDrafts[answering.question] = ""; }
  autosize();
  /* Revising an existing typed answer keeps its place in the transcript; a fresh
     one starts a turn. Signals always start fresh. */
  var revise = null;
  if (!signal && answering.latest && answering.latest.kind === "text"
      && !answering.latest.signal) {
    revise = answering.latest.id;
  }
  return fetch("/say", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text, signal: signal || null,
                           answers: answering.question, turn: revise })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (data && data.turn) loadedTextTurn = data.turn + ":r" + (data.rev || 1);
    els.sendType.classList.add("sent");
    setTimeout(function () { els.sendType.classList.remove("sent"); }, 900);
  });
}

els.tabWrite.onclick = function () { pickKind("write"); };
els.tabType.onclick = function () { pickKind("type"); };

function sendTyped() {
  var sig = pendingSignal;
  pendingSignal = null;
  var text = els.saybox.value.trim();
  if (!text && !sig) return;
  say(sig).then(function () {
    /* A typed answer can still have marks sitting on the lesson, and those are
       worth offering too -- the same follow-up the slate send raises. */
    if (haveNotes() && !notesOff()) els.sendwhat.hidden = false;
  });
}

els.sendType.onclick = sendTyped;

els.saybox.addEventListener("input", function () { autosize(); saveTextDraft(); });
els.saybox.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    sendTyped();
  }
});

/* In a code course the answer is in the editor on the real machine, so the
   board carries the three things worth saying about it. "Ready to check" is one
   tap. The other two open the panel's typing half, because "I need help" is only
   useful with a sentence after it -- and that is the moment a keyboard should
   appear, not before. */
function paintComposer(codeMode, data) {
  els.composer.hidden = !codeMode;
  if (!codeMode) return;
  var last = (data.turns || []).filter(function (t) { return t.signal; }).pop();
  Array.prototype.forEach.call(document.querySelectorAll(".sig"), function (b) {
    b.classList.toggle("on", !!last && last.signal === b.dataset.signal);
  });
}

function openComposer(signal) {
  pendingSignal = signal;
  setAnswerKind("type");
  paintPanel();
  els.saybox.placeholder = signal === "confused"
    ? "what is not making sense?" : "what is going wrong?";
  els.saybox.focus();          /* the keyboard, at the moment it is wanted */
}

Array.prototype.forEach.call(document.querySelectorAll(".sig"), function (b) {
  b.addEventListener("click", function () {
    var signal = b.dataset.signal;
    /* "Ready to check" needs no sentence. The other two are useless without
       one, so they open the typing half rather than sending a bare flag. */
    if (signal === "done") { say("done"); return; }
    openComposer(signal);
  });
});

function upload(files) {
  if (!files || !files.length) return;
  var form = new FormData();
  for (var i = 0; i < files.length; i++) form.append("f" + i, files[i], files[i].name);
  fetch("/upload", { method: "POST", body: form }).catch(function () {});
}

els.file.addEventListener("change", function () { upload(els.file.files); els.file.value = ""; });

/* paste an image straight from the iPad clipboard */
document.addEventListener("paste", function (e) {
  if (!e.clipboardData || !e.clipboardData.files || !e.clipboardData.files.length) return;
  upload(e.clipboardData.files);
});

/* drag and drop anywhere.

   Two things make this need more care than the usual depth counter. iPadOS
   raises dragenter for gestures that are not file drags at all -- the
   app-switcher swipe among them -- and it does not reliably raise the matching
   dragleave when the gesture ends outside the page. Left alone, the overlay
   sticks on and covers the lesson.

   So: only open it for a drag that actually carries files, close it on every
   event that means the drag is over, and keep a watchdog for the times none of
   those arrive. The overlay is pointer-events: none as well, so even a stuck
   one is cosmetic rather than a wall across the board. */
var dragDepth = 0;
var dragWatchdog = null;

function carriesFiles(e) {
  var dt = e.dataTransfer;
  if (!dt) return false;
  if (dt.types) {
    for (var i = 0; i < dt.types.length; i++) {
      if (dt.types[i] === "Files") return true;
    }
  }
  return false;
}

function showDrop() {
  els.drop.hidden = false;
  clearTimeout(dragWatchdog);
  dragWatchdog = setTimeout(hideDrop, 1500);
}

function hideDrop() {
  dragDepth = 0;
  clearTimeout(dragWatchdog);
  els.drop.hidden = true;
}

window.addEventListener("dragenter", function (e) {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  showDrop();
});
window.addEventListener("dragover", function (e) {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  showDrop();
});
window.addEventListener("dragleave", function (e) {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) hideDrop();
});
window.addEventListener("drop", function (e) {
  /* Always prevent the default: a dropped link would otherwise navigate the
     board away to whatever was dragged. */
  e.preventDefault();
  hideDrop();
  upload(e.dataTransfer && e.dataTransfer.files);
});
window.addEventListener("dragend", hideDrop);

/* Coming back to the app, or touching anything, means no drag is in progress. */
["blur", "focus", "pageshow", "touchstart", "pointerdown", "scroll"].forEach(function (t) {
  window.addEventListener(t, function () {
    if (!els.drop.hidden) hideDrop();
  }, { passive: true });
});
document.addEventListener("visibilitychange", function () { hideDrop(); });

/* ------------------------------------------------------------------ chrome */
var FS_KEY = "board.fontsize";
var THEME_KEY = "board.theme";

function setFontSize(px) {
  px = Math.max(14, Math.min(30, px));
  document.documentElement.style.setProperty("--fs", px + "px");
  try { localStorage.setItem(FS_KEY, String(px)); } catch (e) {}
}
function currentFontSize() {
  var v = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--fs"), 10);
  return isNaN(v) ? 18 : v;
}
function applyTheme(mode) {
  document.body.dataset.mode = mode;
  syncSystemTheme();
  try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
}
function syncSystemTheme() {
  var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.body.classList.toggle("sys-dark", dark);
}

document.getElementById("btn-bigger").onclick = function () { setFontSize(currentFontSize() + 1); };
document.getElementById("btn-smaller").onclick = function () { setFontSize(currentFontSize() - 1); };
document.getElementById("btn-theme").onclick = function () {
  var order = ["auto", "light", "dark"];
  var next = order[(order.indexOf(document.body.dataset.mode) + 1) % 3];
  applyTheme(next);
};
document.getElementById("btn-print").onclick = function () { window.print(); };
document.getElementById("btn-export").onclick = function () { doExport("lesson"); };
document.getElementById("btn-export-all").onclick = function () { doExport("all"); };
document.getElementById("btn-reload").onclick = function () { location.reload(); };
/* Nothing live has ever arrived, so the shell itself may be a cached one --
   reload rather than merely re-open the stream. */
document.getElementById("offline-retry").onclick = function () { location.reload(); };
document.getElementById("linkbad-retry").onclick = function () { connect(); };

/* The first turn of a session, from the device. Sending it makes the board
   non-empty, so the empty state (and this button with it) goes away on the next
   frame -- but disable it immediately, because a tutor woken four times writes
   four opening cards. */
/* Declining the prompt is still a turn: it is in the transcript, and it wakes the
   tutor the same way an answer does, because the tutor has to carry on. */
if (els.carry) {
  els.carry.onclick = function () { carryOver(liveSlot); };
}
els.skip.onclick = function () {
  els.skip.disabled = true;
  say("skip").then(function () {
    els.skip.disabled = false;
  }, function () {
    els.skip.disabled = false;
  });
};

els.begin.onclick = function () {
  els.begin.disabled = true;
  /* Do not claim it is being waited on when nothing is there to wait. The turn
     is still sent -- the inbox keeps it, and whoever attaches next reads it --
     but "waiting for the tutor" when no tutor exists is the board lying. */
  els.begin.textContent = attached ? "asked — waiting for the tutor"
                                   : "sent, but no tutor is attached to read it";
  sentAt = Date.now();
  say("begin").catch(function () {
    els.begin.disabled = false;
    els.begin.textContent = "ask the tutor to begin";
  });
};
if (els.reopen) {
  els.reopen.onclick = function () {
    reopenedFor = lastNewestQ;
    workingOn = null;
    workingOnAt = null;
    els.reopen.hidden = true;
    if (lastLive) render(lastLive);
    /* Straight to it: the button was pressed because there was something to
       write, and hunting for the surface that just appeared is not part of it. */
    setTimeout(function () {
      if (!els.writer.hidden && els.writer.scrollIntoView) {
        els.writer.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 60);
  };
}

if (els.addFile) {
  els.addFile.onclick = function () { els.file.click(); };
}

document.getElementById("btn-scratch").onclick = function () { els.scratch.hidden = !els.scratch.hidden; };
document.getElementById("btn-scratch-close").onclick = function () { els.scratch.hidden = true; };
document.getElementById("btn-history").onclick = openHistory;
document.getElementById("btn-history-close").onclick = function () {
  document.getElementById("history").hidden = true;
};
document.getElementById("reading-back").onclick = backToLesson;
els.jump.onclick = function () {
  revealNewest(true);
  els.jump.hidden = true;
};

/* --------------------------------------------------------- the way back ----

   A pinch-zoomed page has no reverse gear that can be relied on: the writing
   surface is as wide as the glass by design, so at any real magnification it
   covers everything there was to pinch on, and it swallows touches because a
   pen stroke is a touch. The first answer was to cap the surface against what
   could be seen, and that made zooming into the writing pointless -- the block
   shrank as fast as the page grew. So the surface is left alone and this is the
   way back instead: one tap puts the magnification where it started.

   Two things about it are not ordinary.

   It is placed from here rather than from CSS. `position: fixed` is fixed to
   the LAYOUT viewport, and pinching moves the visual one, so a control placed
   by CSS alone slides off the glass exactly when it is wanted. Its position is
   kept as a fraction of what can be SEEN, re-applied on every visual-viewport
   event, and counter-scaled so it stays the same size under a thumb.

   And it moves. A control that is always on top is a control that is sooner or
   later on top of the one line you are trying to read, and where that is
   depends on the hand holding the tablet. A press and hold picks it up; a tap
   does the thing. The distinction is time, not distance, because a tap on a
   tablet always travels a little. */
var PANIC_KEY = "board.panic";
/* Hard against the right edge, just under the bar: clear of the 46rem prose
   measure, and high enough that it is not over the writing surface or the tools.
   Wherever it lands it is in somebody's way eventually, which is what the press
   and hold is for. */
var panicAt = { x: .975, y: .1 };      /* of the visible window, its centre */
var panicHold = null;

/* Coalesced to one placement per frame, and its own size measured only when
   something could have changed it.

   This is hung off every scroll and every visual-viewport event, which during a
   flick on a tablet is every frame -- and it was reading two offsets and writing
   a transform each time. A forced layout per scroll event is how a page that is
   merely scrolling starts to stutter, and a control that stutters while
   everything else moves smoothly reads as the whole screen misbehaving. */
var panicFrame = 0;
var panicSize = null;
var findSize = null;

function panicSoon() {
  if (panicFrame) return;
  panicFrame = window.requestAnimationFrame(function () {
    panicFrame = 0;
    panicPlace();
  });
}

function panicPlace() {
  if (!els.panic || els.panic.hidden) return;
  var vv = window.visualViewport;
  var w = vv ? vv.width : window.innerWidth;
  var h = vv ? vv.height : window.innerHeight;
  var ox = vv ? vv.offsetLeft : 0;
  var oy = vv ? vv.offsetTop : 0;
  var k = (vv && vv.scale) ? vv.scale : 1;
  /* The button is drawn at 1/k, so the room it takes in the page's own units is
     its CSS size divided by the magnification. */
  if (!panicSize || !panicSize.w) {
    panicSize = { w: els.panic.offsetWidth || 108, h: els.panic.offsetHeight || 32 };
  }
  var bw = panicSize.w / k;
  var bh = panicSize.h / k;
  var pad = 6 / k;
  var x = ox + panicAt.x * w - bw / 2;
  var y = oy + panicAt.y * h - bh / 2;
  x = Math.min(Math.max(x, ox + pad), ox + w - bw - pad);
  y = Math.min(Math.max(y, oy + pad), oy + h - bh - pad);
  els.panic.style.transform =
    "translate(" + x + "px," + y + "px) scale(" + (1 / k) + ")";

  /* The surface's own re-centre rides directly under it: one thing to move, one
     place to look. Placed here rather than by CSS for the same reason the first
     one is -- `position: fixed` is fixed to the layout viewport, and a control
     that pans off the glass when you pinch is missing at precisely the moment
     being lost makes you want it. */
  if (els.findink && !els.findink.hidden) {
    if (!findSize || !findSize.w) {
      findSize = { w: els.findink.offsetWidth || 108,
                   h: els.findink.offsetHeight || 32 };
    }
    var fw = findSize.w / k;
    var fh = findSize.h / k;
    var fx = ox + panicAt.x * w - fw / 2;
    var fy = y + bh + 8 / k;
    fx = Math.min(Math.max(fx, ox + pad), ox + w - fw - pad);
    fy = Math.min(Math.max(fy, oy + pad), oy + h - fh - pad);
    els.findink.style.transform =
      "translate(" + fx + "px," + fy + "px) scale(" + (1 / k) + ")";
  }
}

/* There is no way to set the page's magnification directly -- it is the user's,
   and rightly so. What a browser does honour is a change to the viewport
   declaration: clamping the maximum scale to 1 makes it zoom out to fit. The
   clamp is lifted again a moment later, or the page could never be zoomed in
   again, which would be a cure worse than the disease. Best effort: on anything
   that ignores it the scroll still happens, which is most of the value. */
var panicViewport = null;      /* the declaration to put back, if any */

function panicRestore() {
  if (!panicViewport) return;
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute("content", panicViewport);
  panicViewport = null;
}

function panicUnzoom() {
  var meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  var was = meta.getAttribute("content") || "";
  if (/maximum-scale/.test(was)) return;         /* a reset is already running */
  panicViewport = was;
  meta.setAttribute("content", was + ", maximum-scale=1");
  /* Put it back, and mean it. A clamp left in place is a page that can never be
     zoomed again -- a worse state than the one this exists to leave, and one
     with no button of its own. So the restore hangs off everything that could
     plausibly happen next, not off a single timer that a backgrounded app is
     free to drop on the floor. */
  setTimeout(panicRestore, 450);
  window.addEventListener("pointerdown", panicRestore, { once: true });
  document.addEventListener("visibilitychange", panicRestore, { once: true });
}

/* Magnification only. It does NOT move the lesson.

   It did at first, and that was a misreading of what "lost" means here: being
   zoomed too far into the writing is not the same as being in the wrong part of
   the transcript, and answering the first with the second takes the page away
   from somebody who was looking at exactly the right thing. The zoom is the
   thing that cannot be undone by hand once the surface fills the glass; the
   scrolling never needed help. */
function panicRecentre() {
  panicUnzoom();
  els.panic.classList.add("hit");
  setTimeout(function () { els.panic.classList.remove("hit"); }, 420);
  /* The magnification settles over the next few frames, and every one of them
     changes what "the visible window" means. */
  [0, 120, 300, 500].forEach(function (ms) { setTimeout(panicPlace, ms); });
  panicSize = null;
}

if (els.panic) {
  try {
    var saved = JSON.parse(localStorage.getItem(PANIC_KEY) || "null");
    if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
      panicAt = { x: saved.x, y: saved.y };
    }
  } catch (e) { /* a corrupt preference is not worth a broken board */ }

  els.panic.addEventListener("pointerdown", function (ev) {
    ev.preventDefault();
    try { els.panic.setPointerCapture(ev.pointerId); } catch (e) {}
    panicHold = {
      id: ev.pointerId, x: ev.clientX, y: ev.clientY, drag: false,
      timer: setTimeout(function () {
        if (!panicHold) return;
        panicHold.drag = true;
        els.panic.classList.add("holding");
        if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
      }, 380),
    };
  });

  els.panic.addEventListener("pointermove", function (ev) {
    if (!panicHold || ev.pointerId !== panicHold.id || !panicHold.drag) return;
    var vv = window.visualViewport;
    var w = vv ? vv.width : window.innerWidth;
    var h = vv ? vv.height : window.innerHeight;
    var ox = vv ? vv.offsetLeft : 0;
    var oy = vv ? vv.offsetTop : 0;
    /* clientX is in the layout viewport's units, which is what the offsets
       convert out of. */
    panicAt.x = Math.min(Math.max((ev.clientX - ox) / w, 0), 1);
    panicAt.y = Math.min(Math.max((ev.clientY - oy) / h, 0), 1);
    panicPlace();
  });

  var panicRelease = function (ev) {
    if (!panicHold || ev.pointerId !== panicHold.id) return;
    clearTimeout(panicHold.timer);
    var dragged = panicHold.drag;
    panicHold = null;
    els.panic.classList.remove("holding");
    if (dragged) {
      try { localStorage.setItem(PANIC_KEY, JSON.stringify(panicAt)); } catch (e) {}
      return;
    }
    if (ev.type !== "pointercancel") panicRecentre();
  };
  els.panic.addEventListener("pointerup", panicRelease);
  els.panic.addEventListener("pointercancel", panicRelease);

  /* No press-and-hold of its own: it is parked against the button above it, so
     moving that one moves this one. A tap is all it does. */
  if (els.findink) {
    els.findink.addEventListener("click", function () {
      if (!writer || !writer.fitInk) return;
      writer.fitInk();
      els.findink.classList.add("hit");
      setTimeout(function () { els.findink.classList.remove("hit"); }, 420);
    });
  }

  ["resize", "scroll"].forEach(function (ev) {
    if (window.visualViewport) window.visualViewport.addEventListener(ev, panicSoon);
    window.addEventListener(ev, panicSoon, { passive: true });
  });
  window.addEventListener("resize", function () { panicSize = null; });
  window.addEventListener("orientationchange", function () {
    panicSize = null;
    setTimeout(panicPlace, 120);
  });
  panicPlace();
}
window.addEventListener("scroll", function () {
  /* `following` reads a rectangle, which forces layout, and this fires for
     every frame of a flick. It is only ever asked while there is a button to
     put away. */
  if (els.jump.hidden) return;
  if (following()) els.jump.hidden = true;
});
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncSystemTheme);
}

try {
  var savedFs = localStorage.getItem(FS_KEY);
  if (savedFs) setFontSize(parseInt(savedFs, 10));
  applyTheme(localStorage.getItem(THEME_KEY) || "auto");
} catch (e) { applyTheme("auto"); }

connect();

/* the browser drops SSE when a phone sleeps; reconnect on wake */
document.addEventListener("visibilitychange", function () {
  if (!document.hidden && (!source || source.readyState === 2)) connect();
});

/* ------------------------------------------------------------------ PWA */
/* Registering needs a secure context. Over Tailscale HTTPS or on localhost
   this installs the app shell; over plain HTTP it is skipped and everything
   still works, just without offline start-up. */
if ("serviceWorker" in navigator && window.isSecureContext) {
  /* Swiping out of an installed iOS app and back in RESUMES it -- the document
     is restored from memory and never re-executes. Without an explicit check,
     a fixed bug stays on screen until the app is force-quit, which is not
     something anyone should have to know. So: ask for an update every time the
     app comes back to the foreground, and reload when a new worker takes over. */
  var hadController = !!navigator.serviceWorker.controller;
  var reloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!hadController || reloading) return;   /* not the first install */
    reloading = true;
    location.reload();
  });

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function (reg) {
      function check() {
        if (!document.hidden) { try { reg.update(); } catch (e) {} }
      }
      document.addEventListener("visibilitychange", check);
      window.addEventListener("pageshow", check);
      window.addEventListener("focus", check);
    }).catch(function () {});
  });
}

})();
