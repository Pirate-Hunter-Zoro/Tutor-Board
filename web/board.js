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
  jump: document.getElementById("jump"),
  scratch: document.getElementById("scratch"),
  scratchList: document.getElementById("scratch-list"),
  writer: document.getElementById("writer"),
  session: document.getElementById("session"),
  agent: document.getElementById("agent"),
  finish: document.getElementById("finish"),
  pushed: document.getElementById("pushed"),
  pushedIcon: document.getElementById("pushed-icon"),
  pushedText: document.getElementById("pushed-text"),
  composer: document.getElementById("composer"),
  composerRow: document.getElementById("composer-row"),
  say: document.getElementById("say"),
  send: document.getElementById("send"),
  file: document.getElementById("file"),
  drop: document.getElementById("drop")
};

var seenIds = Object.create(null);
var firstPaint = true;

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

function timeLabel(t) {
  var d = new Date(t * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  var items = [];
  (data.cards || []).forEach(function (c) {
    items.push({ t: c.mtime, key: "card:" + c.id, card: c });
  });
  (data.turns || []).forEach(function (t) {
    items.push({ t: t.t0 || t.t, key: "turn:" + t.id, turn: t });
  });
  items.sort(function (a, b) { return a.t - b.t; });

  var atBottom = nearBottom();
  var frag = document.createDocumentFragment();
  var anythingNew = false;

  items.forEach(function (item) {
    var stamp = item.key + (item.turn ? ":r" + (item.turn.rev || 1) : "");
    var fresh = !firstPaint && !seenIds[stamp];
    if (fresh) anythingNew = true;
    seenIds[stamp] = true;

    var node = document.createElement(item.card ? "article" : "div");
    if (item.card) {
      var c = item.card;
      node.className = "card" + (fresh ? " fresh" : "");
      node.dataset.kind = c.kind;
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
    frag.appendChild(node);
  });

  els.cards.innerHTML = "";
  els.cards.appendChild(frag);
  els.empty.hidden = items.length > 0;

  paintSession(state, data.push, data.agent);

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
  if (pinnedTo && pinnedTo !== newestQ) pinnedTo = null;
  var owed = !codeMode && !!(lastQuestion && lastQuestion > lastSent);
  if (owed) pinnedTo = newestQ;
  owed = owed || (!codeMode && !!pinnedTo && pinnedTo === newestQ);

  /* Which answer the panel is editing. An ink turn already sent against the
     current question is the one to correct; anything else starts a new one. */
  var mine = (data.turns || []).filter(function (t) {
    return t.kind === "ink" && t.answers === newestQ;
  });
  answering = { question: newestQ, turn: mine.length ? mine[mine.length - 1] : null };

  /* The panel goes after the question AND after anything already sent for it,
     so the order reads question, what you handed in, the surface to correct it
     on. Sliding it in above your own answer put the two out of order. */
  var qNode = null;
  var nodes = els.cards.querySelectorAll('.card[data-kind="question"]');
  if (nodes.length) qNode = nodes[nodes.length - 1];
  if (qNode && newestQ) {
    var mineNodes = els.cards.querySelectorAll('.mine[data-answers="' + newestQ + '"]');
    if (mineNodes.length) qNode = mineNodes[mineNodes.length - 1];
  }
  /* A past lesson is read only: no pen, no box, nothing to send into a session
     that has already been filed. */
  placeWriter(owed && !data.archived, qNode);
  paintComposer(codeMode && !data.archived, data);
  typeset(els.cards);
  renderScratch(data.uploads || []);

  if (firstPaint) {
    firstPaint = false;
    window.scrollTo(0, document.body.scrollHeight);
  } else if (atBottom) {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  } else if (anythingNew) {
    els.jump.hidden = false;
  }
}

/* The end-of-session offer, and the outcome of the last push. Both belong on
   the board rather than in a terminal: the person who has to answer, and the
   person who needs to know a push failed, is holding an iPad. */
var pushDismissed = 0;

function paintSession(state, push, agent) {
  /* Whether an assistant is attached, and whether it is thinking. Without this
     the page looks identical when nothing is listening at all. */
  els.agent.hidden = !agent;
  if (agent) {
    els.agent.dataset.state = agent.state || "stale";
    els.agent.textContent =
      agent.state === "working" ? (agent.agent || "assistant") + " is working"
    : agent.state === "listening" ? (agent.agent || "assistant") + " listening"
    : "assistant not responding";
  }
  var kind = state.session;
  els.session.hidden = !kind;
  if (kind) {
    els.session.textContent = kind;
    els.session.dataset.kind = kind;
  }
  els.finish.hidden = !state.finished;

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

function doPush() {
  els.finish.hidden = true;
  els.pushed.hidden = false;
  els.pushed.className = "pushed";
  els.pushedIcon.textContent = "…";
  els.pushedText.textContent = "saving and pushing…";
  fetch("/push", {
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

document.getElementById("finish-yes").onclick = doPush;
document.getElementById("finish-no").onclick = function () {
  els.finish.hidden = true;
  fetch("/dismiss-finish", { method: "POST" }).catch(function () {});
};
document.getElementById("pushed-close").onclick = function () {
  els.pushed.hidden = true;
  pushDismissed = Date.now() / 1000;
};

function nearBottom() {
  return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
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

/* ------------------------------------------------------------------ stream */
var source = null;

function connect() {
  if (source) source.close();
  source = new EventSource("/events");
  source.onopen = function () { els.dot.className = "dot live"; };
  source.onerror = function () { els.dot.className = "dot dead"; };
  source.onmessage = function (ev) {
    if (!ev.data) return;
    els.dot.className = "dot live";
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

var SIGNAL_LABEL = { done: "ready to check", help: "needs help", confused: "confused" };

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
        onSend: function () { toastSent(); },
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
document.getElementById("btn-scratch").onclick = function () { els.scratch.hidden = !els.scratch.hidden; };
document.getElementById("btn-scratch-close").onclick = function () { els.scratch.hidden = true; };
document.getElementById("btn-history").onclick = openHistory;
document.getElementById("btn-history-close").onclick = function () {
  document.getElementById("history").hidden = true;
};
document.getElementById("reading-back").onclick = backToLesson;
els.jump.onclick = function () {
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  els.jump.hidden = true;
};
window.addEventListener("scroll", function () {
  if (nearBottom()) els.jump.hidden = true;
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
