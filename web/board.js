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
  scratch: document.getElementById("scratch"),
  scratchList: document.getElementById("scratch-list"),
  writer: document.getElementById("writer"),
  sent: document.getElementById("sent"),
  sentText: document.getElementById("sent-text"),
  session: document.getElementById("session"),
  kind: document.getElementById("kind"),
  kindLecture: document.getElementById("kind-lecture"),
  kindSets: document.getElementById("kind-sets"),
  kindCancel: document.getElementById("kind-cancel"),
  contents: document.getElementById("contents"),
  contentsList: document.getElementById("contents-list"),
  agent: document.getElementById("agent"),
  finish: document.getElementById("finish"),
  finishLead: document.getElementById("finish-lead"),
  finishSub: document.getElementById("finish-sub"),
  save: document.getElementById("btn-save"),
  barmenu: document.getElementById("barmenu"),
  home: document.getElementById("btn-home"),
  finishLeave: document.getElementById("finish-leave"),
  finishYes: document.getElementById("finish-yes"),
  finishNo: document.getElementById("finish-no"),
  saveDot: null,
  pushed: document.getElementById("pushed"),
  pushedIcon: document.getElementById("pushed-icon"),
  pushedText: document.getElementById("pushed-text"),
  busy: document.getElementById("busy"),
  busyText: document.getElementById("busy-text"),
  busySince: document.getElementById("busy-since"),
  codeanswer: document.getElementById("codeanswer"),
  codeanswerInk: document.getElementById("codeanswer-ink"),
  codeanswerType: document.getElementById("codeanswer-type"),
  codeanswerSkip: document.getElementById("codeanswer-skip"),
  codeanswerHint: document.getElementById("codeanswer-hint"),
  composer: document.getElementById("composer"),
  composerRow: document.getElementById("composer-row"),
  say: document.getElementById("say"),
  send: document.getElementById("send"),
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

/* Which kinds are a reply to a piece of working, as opposed to teaching. A
   lesson, an aside or a recap after a question is new material and stands on
   its own; these three answer something the student handed in, and so are the
   ones that can be made obsolete by a later one. */
var REPLY_KIND = { wrong: 1, correct: 1, review: 1 };

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
    document.getElementById("btn-history").hidden = !(data.history > 0);
    if (reading) { els.jump.hidden = false; return; }
  }
  var state = data.state || {};
  els.course.textContent = state.course || "board";
  els.chapter.textContent = state.chapter ? "· " + state.chapter : "";
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
  ordered.forEach(function (c, n) { at[c.id] = n; });

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
  var afterQ = -1;
  ordered.forEach(function (c, n) { if (c.kind === "question") afterQ = n; });
  var replies = [];
  ordered.forEach(function (c, n) {
    if (n > afterQ && REPLY_KIND[c.kind]) replies.push(c.id);
  });
  replies.slice(0, -1).forEach(function (id) { superseded[id] = true; });

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
       revised, changes its key and is rebuilt; everything else is reused. */
    var wantKey = stamp + (item.card ? ":m" + Math.round(item.card.mtime) : "");
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
      if (m.png) {
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

  paintSession(state, data.push, data.agent);
  paintHomework(data.hw);
  if (!started) paintWaiting(data);
  paintNotesSend();
  paintSent();
  paintSave(data.unsaved);
  if (data.sets) knownSets = data.sets;
  if (data.contents) contents = data.contents;
  pastCount = data.history || 0;

  var codeMode = (state.mode || "math") === "code";
  document.body.dataset.mode2 = state.mode || "math";
  els.composer.hidden = !codeMode;

  /* In maths, offer the slate only while an answer is actually owed: a question
     card with nothing sent after it. A permanent button would be furniture.

     Sending is a checkpoint, not an exit. Once the panel has opened for a
     question it stays open for that question however many times the page is
     sent, because the next thing that happens is usually the tutor pointing at
     a mistake in it. It closes when a *different* question arrives. */
  var lastQuestion = 0, lastSent = 0, newestQ = null;
  (data.cards || []).forEach(function (c) {
    if (c.kind === "question" && c.mtime > lastQuestion) {
      lastQuestion = c.mtime;
      newestQ = c.id;
    }
  });
  (data.turns || []).forEach(function (m) { if (m.t > lastSent) lastSent = m.t; });
  /* A question stays open until it is settled, and what settles it is the tutor
     saying so -- a `correct` card written after it, or another question taking
     its place. Not the clock.

     It used to be "the newest question is newer than your newest send", plus an
     in-memory pin so the surface survived a send. That pin is a variable, and a
     variable does not survive closing the app: reopening a lesson where the
     tutor had replied with anything other than a question left no writing
     surface at all, on a board whose whole purpose is being written on. The
     transcript on disk has to be enough to decide this. */
  var settled = false;
  (data.cards || []).forEach(function (c) {
    if (c.kind === "correct" && c.mtime >= lastQuestion) settled = true;
  });
  var owed = !codeMode && !!newestQ && !settled;
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
  var mine = (data.turns || []).filter(function (t) {
    return t.kind === "ink" && t.answers === newestQ;
  });
  answering = { question: newestQ, turn: mine.length ? mine[mine.length - 1] : null };

  /* The writing surface goes at the END of the transcript, under whatever the
     last thing in it is. That is what makes a correction work the way a person
     expects: the tutor's feedback arrives, and the surface to fix the answer on
     is beneath the feedback rather than scrolled off above it.

     While an answer is waiting to be read there is nothing to put under, so the
     surface stays where it is and says so underneath itself -- see paintSent.
     What it must never do is sit under a frozen copy of the very ink still
     showing on the surface: that is the same thing twice, one above the other. */
  var qNode = null;
  var kids = els.cards.children;
  for (var q = kids.length - 1; q >= 0; q--) {
    if (kids[q] !== els.writer && kids[q].dataset && kids[q].dataset.key) {
      qNode = kids[q];
      break;
    }
  }
  /* A past lesson is read only: no pen, no box, nothing to send into a session
     that has already been filed. */
  placeWriter(owed && !data.archived, qNode);
  /* A question in a code project owes an answer just as much as one in a maths
     course; what differs is how it is given. `owed` stays false there because it
     governs the writing surface, so this is decided separately. */
  placeCodeAnswer(codeMode && !!newestQ && !settled && !skipped && !data.archived,
                  qNode, newestQ);
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

function paintSession(state, push, agent) {
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
      /* Only reached when the record exists but nothing recognises its state --
         a daemon whose process is gone. Say what that means for them. */
    : "tutor stopped — nothing is reading the board";
  }
  var kind = state.session || "lecture";
  sittingKind = kind;
  els.session.hidden = false;
  els.session.textContent = kind;
  els.session.dataset.kind = kind;
  els.session.title = "tap to switch between lecture and homework";
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

  if (!push || push.at <= pushDismissed) {
    els.pushed.hidden = true;
    return;
  }
  els.pushed.hidden = false;
  els.pushed.className = "pushed " + (push.ok ? "ok" : "bad");
  els.pushedIcon.textContent = push.ok ? "✓" : "✕";
  if (push.ok) {
    var first = (push.detail || "").split("\n").filter(function (l) { return l.trim(); });
    els.pushedText.textContent = (first[first.length - 1] || "pushed") + " · " + push.iso;
  } else {
    els.pushedText.textContent = "Push failed — " + (push.detail || "no detail");
  }
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
    .then(function (rec) { paintSession({}, rec); })
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
  /* A closing tab must not take the last stroke with it. */
  window.addEventListener("pagehide", function () { saveNotes(false); });
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
  if (marks) els.sendwhat.hidden = false;
}

function closeChooser() {
  els.sendwhat.hidden = true;
}

els.sendNotes.onclick = function () {
  closeChooser();
  saveNotes(true).then(function () { paintNotesSend(); toastSent(); });
};
els.sendCancel.onclick = closeChooser;

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
  els.notesend.hidden = !(any && !owedSurface);
  /* Marks on the card that is asking are an ANSWER, and the button should say
     so -- otherwise sending them reads like filing a note rather than replying,
     which is exactly the doubt that sends somebody looking for a text box. */
  var answeringNow = els.codeanswer && !els.codeanswer.hidden
                     && window.Annotate
                     && window.Annotate.unsent().indexOf(els.codeanswer.dataset.card) !== -1;
  els.notesend.textContent = answeringNow ? "send my annotations as my answer"
                                          : "send my annotations";
  els.notesend.classList.toggle("answering", !!answeringNow);
}


if (els.codeanswerInk) {
  els.codeanswerInk.onclick = function () {
    if (window.Annotate && !window.Annotate.isOn()) {
      var btn = document.getElementById("btn-annotate");
      if (btn && btn.onclick) btn.onclick();
      else window.Annotate.setOn(true);
    }
    var card = els.codeanswer.dataset.card;
    var node = card && document.querySelector('[data-card="' + card + '"]');
    if (node && node.scrollIntoView) node.scrollIntoView({ block: "start" });
    paintNotesSend();
  };
}

if (els.codeanswerType) {
  els.codeanswerType.onclick = function () {
    /* The row, with no signal attached: this is an answer, not a cry for help. */
    els.composerRow.hidden = false;
    els.composerRow.dataset.signal = "";
    var box = document.getElementById("say");
    if (box) {
      box.placeholder = "your answer";
      box.focus();
    }
  };
}

if (els.codeanswerSkip) {
  els.codeanswerSkip.onclick = function () {
    els.codeanswerSkip.disabled = true;
    say("skip");        /* anchored by `answering.question`, like any turn */
  };
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
els.kindCancel.onclick = function () { els.kind.hidden = true; };


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
var answering = { question: null, turn: null };
var loadedTurn = null;

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

function placeCodeAnswer(owed, questionNode, card) {
  if (!els.codeanswer) return;
  els.codeanswer.hidden = !owed;
  if (!owed) return;
  els.codeanswer.dataset.card = card || "";
  if (questionNode && questionNode.nextSibling !== els.codeanswer) {
    questionNode.parentNode.insertBefore(els.codeanswer, questionNode.nextSibling);
  } else if (!questionNode && els.codeanswer.parentNode !== els.cards) {
    els.cards.appendChild(els.codeanswer);
  }
  paintNotesSend();
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

function placeWriter(owed, questionNode) {
  els.writer.hidden = !owed;
  document.getElementById("drawbar").hidden = !owed;
  /* The tool bar is fixed to the bottom of the window, so the page has to give
     up the height it occupies or the last card sits underneath it. */
  document.body.classList.toggle("tools-out", !!owed);
  if (!owed) return;

  if (questionNode && questionNode.nextSibling !== els.writer) {
    questionNode.parentNode.insertBefore(els.writer, questionNode.nextSibling);
  } else if (!questionNode && els.writer.parentNode !== els.cards) {
    els.cards.appendChild(els.writer);
  }

  if (!writer && window.Slate) {
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
      });
      window.__writerDebug = writer.debug;
      restoreAnswer();
    });
  } else if (writer) {
    requestAnimationFrame(writer.relayout);
    restoreAnswer();
  }
}

/* Put a previously sent answer back under the pen when the tutor has commented
   on it, and clear the surface when a new question arrives so the next answer
   does not start on top of the last one. */
function restoreAnswer() {
  if (!writer) return;
  var id = answering.turn ? answering.turn.id + ":r" + answering.turn.rev : null;
  if (id === loadedTurn) return;
  if (!answering.turn) {
    if (loadedTurn) writer.clear();
    loadedTurn = null;
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
function autosize() {
  els.say.style.height = "auto";
  els.say.style.height = Math.min(els.say.scrollHeight, 9 * 16) + "px";
}

function say(signal) {
  var text = els.say.value.trim();
  if (!text && !signal) return;
  els.say.value = "";
  autosize();
  return fetch("/say", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text, signal: signal || null,
                           answers: answering.question })
  }).then(function () {
    els.send.classList.add("sent");
    setTimeout(function () { els.send.classList.remove("sent"); }, 900);
  });
}

/* In a code course the answer is in the editor on the real machine, so the
   board carries the three things worth saying about it. "Ready to check" is one
   tap. The other two open the box, because "I need help" is only useful with a
   sentence after it -- and that is the moment a keyboard should appear, not
   before. */
function paintComposer(codeMode, data) {
  els.composer.hidden = !codeMode;
  if (!codeMode) {
    if (els.composerRow) els.composerRow.hidden = true;
    return;
  }
  var last = (data.turns || []).filter(function (t) { return t.signal; }).pop();
  Array.prototype.forEach.call(document.querySelectorAll(".sig"), function (b) {
    b.classList.toggle("on", !!last && last.signal === b.dataset.signal);
  });
}

function openComposer(signal) {
  els.composerRow.hidden = false;
  els.composerRow.dataset.signal = signal;
  els.say.placeholder = signal === "confused"
    ? "what is not making sense?" : "what is going wrong?";
  els.say.focus();          /* the keyboard, at the moment it is wanted */
}

els.composer.addEventListener("submit", function (e) {
  e.preventDefault();
  say(els.composerRow.dataset.signal || null);
  els.composerRow.hidden = true;
  els.composerRow.dataset.signal = "";
});

Array.prototype.forEach.call(document.querySelectorAll(".sig"), function (b) {
  b.addEventListener("click", function () {
    var signal = b.dataset.signal;
    /* "Ready to check" needs no sentence. The other two are useless without
       one, so they open the box rather than sending a bare flag. */
    if (signal === "done") { say("done"); els.composerRow.hidden = true; return; }
    openComposer(signal);
  });
});
els.say.addEventListener("input", autosize);
els.say.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); say(); }
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
  var bw = (els.panic.offsetWidth || 108) / k;
  var bh = (els.panic.offsetHeight || 32) / k;
  var pad = 6 / k;
  var x = ox + panicAt.x * w - bw / 2;
  var y = oy + panicAt.y * h - bh / 2;
  x = Math.min(Math.max(x, ox + pad), ox + w - bw - pad);
  y = Math.min(Math.max(y, oy + pad), oy + h - bh - pad);
  els.panic.style.transform =
    "translate(" + x + "px," + y + "px) scale(" + (1 / k) + ")";
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

  ["resize", "scroll"].forEach(function (ev) {
    if (window.visualViewport) window.visualViewport.addEventListener(ev, panicPlace);
    window.addEventListener(ev, panicPlace, { passive: true });
  });
  window.addEventListener("orientationchange", function () {
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
