#!/usr/bin/env python3
"""
serve.py -- the live tutoring board server.

One process per course repository. It watches <repo>/live/cards/ for card files
written by the assistant, renders them to a payload, and pushes that payload to
every connected browser over Server-Sent Events. Any TikZ block inside a card is
compiled to a cached SVG by a background worker.

It also accepts input coming back the other way: text typed into the board from
a phone or iPad, and files (handwritten PDFs, photos of scratch work) dropped
onto the page. Both land in <repo>/live/inbox/ where the assistant reads them.

Python 3.9, standard library only. No pip, no npm, no build step.
"""

import hashlib
import json
import mimetypes
import os
import posixpath
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)
import boardlib
import document
import homework
import review
import syllabus
WEB = os.path.join(HERE, "web")

# The one place a machine-local secret lives, so the always-on host can ask a
# board to hand over politely. Both machines must carry the same value.
CONFIG = os.path.join(
    os.environ.get("XDG_CONFIG_HOME", os.path.join(os.path.expanduser("~"), ".config")),
    "tutor-board", "config.json")

# Python's table predates these; without them fonts go out as octet-stream and
# a strict browser can refuse to load them.
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("application/manifest+json", ".webmanifest")

POLL_SECONDS = 0.25
CARD_RE = re.compile(r"^(\d{4})[-_.](.*)\.(md|markdown|tex)$")


# ---------------------------------------------------------------------------
# repository paths
# ---------------------------------------------------------------------------
class Repo:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.live = os.path.join(self.root, "live")
        self.cards = os.path.join(self.live, "cards")
        self.inbox = os.path.join(self.live, "inbox")
        self.uploads = os.path.join(self.inbox, "uploads")
        self.tikz = os.path.join(self.live, "tikzcache")
        self.archive = os.path.join(self.live, "archive")
        self.slate = os.path.join(self.live, "slate")
        # What the student actually handed in, frozen at the moment they sent
        # it. The slate is a working surface and gets written over; a transcript
        # cannot be built out of a surface that changes underneath it.
        self.answers = os.path.join(self.live, "answers")
        # Marks written on top of the tutor's own cards. Kept per card, because
        # a card is the thing an annotation is about and the only anchor that
        # survives the lesson reflowing at a different type size.
        self.notes = os.path.join(self.live, "annotations")
        # Typed answers, drafted per question the way the slate drafts per page,
        # so switching from typing to writing and back does not lose the sentence.
        self.text = os.path.join(self.live, "text")
        for d in (self.live, self.cards, self.inbox, self.uploads, self.tikz,
                  self.archive, self.slate, self.answers, self.notes, self.text):
            os.makedirs(d, exist_ok=True)

    @property
    def state_path(self):
        return os.path.join(self.live, "state.json")

    @property
    def messages_path(self):
        return os.path.join(self.inbox, "messages.jsonl")

    @property
    def turns_path(self):
        return os.path.join(self.live, "turns.jsonl")

    def state(self):
        try:
            with open(self.state_path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return {}


# ---------------------------------------------------------------------------
# card parsing
# ---------------------------------------------------------------------------
def parse_front_matter(text):
    """Minimal `key: value` front matter between --- fences. No YAML dependency."""
    meta = {}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            head = text[3:end]
            body = text[end + 4:]
            if body.startswith("\n"):
                body = body[1:]
            for line in head.splitlines():
                line = line.strip()
                if not line or line.startswith("#") or ":" not in line:
                    continue
                k, v = line.split(":", 1)
                meta[k.strip().lower()] = v.strip().strip('"').strip("'")
    return meta, body


TIKZ_BLOCK = re.compile(
    r"^[ \t]*```[ \t]*(tikz|tikzcd|latex)[ \t]*\n(.*?)^[ \t]*```[ \t]*$",
    re.DOTALL | re.MULTILINE,
)


def extract_tikz(body, jobs, repo):
    """Replace fenced tikz blocks with a placeholder token the client turns into
    an <img>. Queue anything not already cached for compilation."""
    def sub(match):
        kind = match.group(1)
        src = match.group(2)
        digest = hashlib.sha1((kind + "\x00" + src).encode("utf-8")).hexdigest()[:16]
        svg = os.path.join(repo.tikz, digest + ".svg")
        if os.path.exists(svg):
            status = "ready"
        elif os.path.exists(os.path.join(repo.tikz, digest + ".err")):
            status = "error"
        else:
            status = "pending"
            jobs.append((digest, kind, src))
        return "\n\n@@FIGURE:%s:%s@@\n\n" % (digest, status)

    return TIKZ_BLOCK.sub(sub, body)


# Parsed cards, keyed by path, valid while (mtime, size) hold. The poll runs four
# times a second and this home directory is a shared network filesystem, so
# re-reading and re-parsing every card in the lesson on every tick is real cost
# for files that have not changed -- and it grows with the length of the lesson.
_CARD_CACHE = {}


def load_cards(repo, jobs):
    cards = []
    try:
        names = sorted(os.listdir(repo.cards))
    except OSError:
        names = []
    seen = set()
    for name in names:
        m = CARD_RE.match(name)
        if not m:
            continue
        path = os.path.join(repo.cards, name)
        seen.add(path)
        try:
            st = os.stat(path)
        except OSError:
            continue
        stamp = (st.st_mtime, st.st_size)
        hit = _CARD_CACHE.get(path)
        if hit and hit[0] == stamp:
            # The figure placeholders carry compile status, which changes when a
            # diagram finishes -- so the body is re-scanned even on a hit. It is
            # a regex over a string already in memory, not a read and a parse.
            card = dict(hit[1])
            card["body"] = extract_tikz(hit[2], jobs, repo)
            cards.append(card)
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.read()
        except OSError:
            continue
        meta, rawbody = parse_front_matter(raw)
        # Whoever wrote this file. `board write` refuses a card that is the
        # model deliberating, but an interactive tutor writes the file itself --
        # the brief tells it to -- and that door has no gate on it.
        rawbody = boardlib.card_body(rawbody)
        body = extract_tikz(rawbody, jobs, repo)
        cards.append({
            "id": m.group(1),
            "slug": m.group(2),
            "kind": (meta.get("kind") or "lesson").lower(),
            "title": meta.get("title", ""),
            "tag": meta.get("tag", ""),
            "body": body,
            "mtime": st.st_mtime,
        })
        _CARD_CACHE[path] = (stamp, dict(cards[-1]), rawbody)
    for gone in [k for k in _CARD_CACHE if k not in seen and k.startswith(repo.cards)]:
        del _CARD_CACHE[gone]
    return cards


def load_messages(repo, limit=60):
    out = []
    try:
        with open(repo.messages_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return out[-limit:]


# ---------------------------------------------------------------------------
# turns -- the student's half of the transcript
# ---------------------------------------------------------------------------
# A lesson is a conversation, and half of it was previously being thrown into a
# drawer: sent slate pages appeared as thumbnails at the bottom of the page with
# no connection to the question they answered, and nothing the student wrote
# survived the next lesson.
#
# A turn is one contribution, anchored to the card it answers, and versioned:
# sending again after feedback supersedes the previous revision in place rather
# than adding another thumbnail to a pile. The file is append-only -- the whole
# history is on disk -- and only the newest revision of each turn is shown.

def load_turns(repo, path=None):
    """Newest revision of each turn, in the order the turns first appeared."""
    order, latest = [], {}
    try:
        with open(path or repo.turns_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                tid = rec.get("id")
                if not tid:
                    continue
                if tid not in latest:
                    order.append(tid)
                    rec["t0"] = rec.get("t")
                if rec.get("rev", 1) >= latest.get(tid, {}).get("rev", 0):
                    # A revision keeps the original's place in the transcript.
                    rec["t0"] = latest.get(tid, rec).get("t0", rec.get("t"))
                    latest[tid] = rec
    except OSError:
        return []
    return [latest[t] for t in order]


# A turn id must be unique for the life of the course, and it was only unique
# for the life of one lesson.
#
# `board archive` RENAMES turns.jsonl into the archive folder and leaves
# messages.jsonl exactly where it is -- the inbox is the assistant's mailbox and
# is never rotated. So the moment a chapter was filed, the id counter went back
# to t0001 while the inbox still held every id ever issued, and the next answer
# was written into the inbox as a second, different `t0001 rev 1`. Two turns, one
# name: anything joining an inbox line to a turn joined the wrong one, and
# `turn_revision` reported rev 1 for a card that already had one.
#
# The high-water mark therefore comes from every place that can still name a
# turn, and is remembered in a file the archive does not move.
TURN_SEQ = ".turnseq"
TURN_ID_RE = re.compile(r"^t(\d+)")


def _turn_n(value):
    m = TURN_ID_RE.match(str(value or ""))
    return int(m.group(1)) if m else 0


def turn_hwm(repo):
    """The highest turn number this course has ever issued."""
    n = 0
    try:
        with open(os.path.join(repo.live, TURN_SEQ), "r", encoding="utf-8") as fh:
            n = int((fh.read() or "0").strip() or 0)
    except (OSError, ValueError):
        n = 0
    # The current lesson's transcript.
    for rec in load_turns(repo):
        n = max(n, _turn_n(rec.get("id")))
    # The inbox, which is never rotated and is therefore the real history.
    for rec in load_messages(repo, limit=10 ** 9):
        n = max(n, _turn_n(rec.get("id")))
    # Frozen answers, named <turn>-r<rev>. Belt and braces: a file on disk that
    # a new turn could overwrite is worth one listdir.
    try:
        for name in os.listdir(repo.answers):
            n = max(n, _turn_n(name))
    except OSError:
        pass
    return n


def bump_turn_hwm(repo, tid):
    n = _turn_n(tid)
    if not n:
        return
    try:
        with open(os.path.join(repo.live, TURN_SEQ), "r", encoding="utf-8") as fh:
            have = int((fh.read() or "0").strip() or 0)
    except (OSError, ValueError):
        have = 0
    if n <= have:
        return
    try:
        with open(os.path.join(repo.live, TURN_SEQ), "w", encoding="utf-8") as fh:
            fh.write("%d\n" % n)
    except OSError:
        pass


def next_turn_id(repo):
    return "t%04d" % (turn_hwm(repo) + 1)


def turn_revision(repo, tid):
    """Which revision the next write of `tid` is.

    Read from the transcript AND the inbox: after an archive the transcript no
    longer has the turn, and answering "rev 1" for something already sent is how
    a revision came to overwrite the thing it was revising.
    """
    rev = 0
    for rec in load_turns(repo):
        if rec.get("id") == tid:
            rev = max(rev, rec.get("rev", 1))
    for rec in load_messages(repo, limit=10 ** 9):
        if rec.get("id") == tid:
            rev = max(rev, rec.get("rev", 1))
    return rev + 1


# A signal is a tap, not a sentence, so it has to carry its own meaning into the
# inbox -- see /say. "begin" is the one that has to be unmistakable, because it
# arrives at a board with nothing on it and an assistant with no other context.
SIGNAL_SENSE = {
    "begin": "there is nothing on the board yet and they are waiting. "
             "Open the session and write the first card.",
    # The lecture and test-review reading. A homework sitting means something
    # different by the same tap and gets its own sentence -- see `skip_sense`.
    "skip": "they are not writing this one out. Do not re-ask it and do not press "
            "them on it; carry on with the lesson.",
    "done": "their work is ready for you to check.",
    "help": "they are stuck and want help.",
    "confused": "something is not making sense to them.",
}


def code_sense(label, stance="teach"):
    """Where a code project says what comes next: its README, and what it points at.

    This is the whole prompt in a headless session, so it carries the shape as
    well as the place -- and the shape is the part that was wrong. A project has
    no chapters, no sections and no exercises, and manufacturing them out of the
    README's structure is the specific failure this exists to prevent: those
    headings describe how the system is built, not an order to learn it in.
    """
    where = ("They are working on %r; start there. " % label) if label else ""
    return (
        "Follow live/TEACHING.md, the code-project half of it. This repository is "
        "a PROJECT, not a course: there are no chapters, no sections and no "
        "exercises, and you must not invent any out of the README's headings.\n\n"
        "Read README.md at the root first. It is the entry point, and it says "
        "where the work is planned -- a task list, a planning document, a "
        "companion repository. Follow that pointer and read what it names: that "
        "is what says what comes next, and it outranks anything you would have "
        "chosen yourself. Read HANDOFF.md too if there is one. If the README "
        "names nothing, or what it names is missing, ask them in your first card "
        "rather than picking an agenda of your own.\n\n"
        + where +
        (
            # The repository has said, in writing, that it wants the work done
            # rather than taught. Nothing else about a turn changes: one card,
            # short, card first, and it still stops and waits.
            "This repository's stance is DO, not teach: you write the code "
            "yourself, run what needs running, and commit when it is right. Do "
            "not withhold an implementation and do not ask them to type it. The "
            "card is a report, not an exercise: what you changed, what it does "
            "now, what you ran and what came back, and the one decision or "
            "check you need from them. Still one card, still short, still "
            "written before the rest of the work."
            if stance == "do" else
            "Then write ONE card saying what to change next: the file, what it "
            "has to do, and how they will know it works. They write the code in "
            "their own editor -- you never write it and never put a solution on "
            "the board. One change per turn, then stop and wait for 'ready to "
            "check'."
        )
    )


def review_sense(repo, st, mode):
    """A test review, in a sentence the assistant can act on.

    A review is not a third way of teaching -- it is the homework loop pointed at
    a scope the student chose instead of at a sheet somebody set. So this says
    the two things that are actually different, and leaves the shape of a turn to
    live/TEACHING.md where it belongs: what the scope is, and that it is not the
    assistant's to widen.

    The chapters are NAMED here rather than left to be looked up. In a headless
    session this string is the whole prompt, and a tutor that has to glob the
    repository to find out what it is reviewing pays a round trip for something
    the board already knew.
    """
    chosen = review.scope(repo.root, st)
    of = review.kind(repo.root) or "chapters"
    project = mode == "code"
    what = "parts of this project" if project else "chapters"
    counted = (review.noun("parts", len(chosen)) + " of this project") \
        if project else review.noun("chapters", len(chosen))

    if not chosen:
        # Reachable from `board open --review` with nothing named. The board's
        # own picker cannot produce it, and inferring a scope is exactly the
        # mistake a homework sitting with no sheet is told not to make.
        return ("Follow live/TEACHING.md. This is a TEST REVIEW sitting and "
                "nothing has been chosen for it to cover. Ask in your first card "
                "which %s the test is over, and do not choose them yourself -- "
                "they know what is on it and you do not." % what)

    named = ", ".join(u["label"] for u in chosen)
    where = (
        "Read those parts of the repository before your first card, then ask "
        "about the code that is already there: what a function does, why it is "
        "written that way, what would break if it changed. This is not a sitting "
        "for setting work -- do not assign a change, and do not write code into a "
        "card even where this repository's stance is to do the work, because a "
        "review asks. "
        if project else
        "Draw each question from those chapters' own exercises where there are "
        "some, and write one in the same style where there are not. "
    )
    return (
        "Follow live/TEACHING.md: teach only what the question in front of them "
        "needs, one question per turn, then stop. This is a TEST REVIEW over %s, "
        "in this order: %s. "
        "The scope is theirs and is not yours to widen or narrow -- ask over "
        "exactly those and nothing else, and spread the questions across all of "
        "them rather than exhausting the first. A review is for finding what is "
        "not solid yet, so a question they answer cleanly is a question you move "
        "on from. %s"
        "Pose them exactly as a homework problem is posed: state the question in "
        "full in a `question` card, stop, and read what comes back -- locate the "
        "break rather than repairing it. "
        "Nothing is being handed in, so there is no write-up: do not transcribe "
        "into a .tex and do not compile anything. The lesson itself is the record. "
        "Say in your first card what this review covers and which one you are "
        "starting on." % (counted, named, where)
    )


def skip_sense(repo):
    """What a skip means, which depends on what kind of sitting this is.

    In a lecture it means *I have this already*: the concept check is pace
    control, and re-asking a question somebody has waved away teaches nothing.
    That reading was applied everywhere, and in a homework sitting it is wrong
    and expensive -- the problems are not the assistant's to drop. A skipped
    homework problem is a lost mark, and the student skipping it means *not now*,
    not *never*. They are entitled to work the sheet in whatever order they like;
    they are not entitled to have the assistant quietly agree the sheet is
    shorter than it is.

    So in homework the tap defers, and the sentence says what is still owed and
    what to come back to. The list is read off the document rather than the
    conversation, which is what makes it survive a restart, a new tutor, and the
    two hours between the skip and the return.
    """
    st = repo.state()
    if (st.get("session") or "lecture") != "homework":
        return SIGNAL_SENSE["skip"]

    line = ("they are not writing this one out NOW. This is a homework sitting, so "
            "the problem is still assigned and still owed: leave it, carry on with "
            "the rest, and come back to it once the others are done. Do not press "
            "them on it in the meantime, and do not treat it as finished. ")
    try:
        st_hw = homework.status(repo.root, st)
    except Exception:
        st_hw = None
    left = (st_hw or {}).get("outstanding") or []
    if len(left) == 1:
        # The degenerate case, and it is not a paradox: skipping the only thing
        # left means it comes straight back, because there is nothing else to go
        # on with and the sheet is not finished. Say so, or an assistant reading
        # "come back to it once the others are done" concludes the others never
        # will be and drops it.
        line += ("It is also the ONLY problem left on the sheet, so there is "
                 "nothing else to carry on with: ask it again. That is not a "
                 "mistake and it is not pressing them -- the sheet is not done "
                 "until it is done. ")
    elif left:
        line += ("Still to write up, in the sheet's order: %s. The next agreed "
                 "answer goes in %s. " % (", ".join(left), left[0]))
    line += ("They may work the sheet in any order; the document is written in "
             "the sheet's order regardless.")
    return line


def session_sense(repo):
    """What this sitting is, in a sentence an assistant can act on.

    `board open` takes a label -- "Ch 1 -- groups, fields and vector spaces" --
    and it is the only thing on the board that says where a cold start should
    start. If nobody set one, say that too, and say where to look instead: a
    course orders itself somewhere, and guessing is how a course gets opened in
    the middle.
    """
    st = repo.state()
    kind = st.get("session") or "lecture"
    chapter = (st.get("chapter") or "").strip()

    # A code repository is a PROJECT, and everything below this is written for a
    # course that follows a book. Without this branch it fell through to the last
    # case, which tells the assistant to "begin at the beginning of the course as
    # the repository itself orders it, and say in your first card which chapter
    # you are opening" -- so it dutifully invented chapters out of the README's
    # section headings and opened "Chapter 1". There are no chapters in a
    # project. There is a README, and the README says where the work is planned.
    cfg_here = read_config(repo.root)
    # A test review is the one sitting that reads the same in both kinds of
    # repository, so it is settled before the project branch rather than inside
    # it: a project being revised is being asked questions, not set work, and
    # falling through to code_sense would have told it to go and find the next
    # change instead.
    if kind == "review":
        return review_sense(repo, st, cfg_here.get("mode"))
    if cfg_here.get("mode") == "code":
        return code_sense(chapter, cfg_here.get("stance"))
    # In a headless session this line is the whole prompt, so it has to carry the
    # pointer to the method as well as the pointer to the place.
    how = ("Follow live/TEACHING.md: teach only what the problem in front of them "
           "needs, one question per turn, then stop. "
           if kind == "homework" else
           "Follow live/TEACHING.md: the section's exercises first, a manageable few, "
           "teach only what each needs, one question per turn, then stop. ")
    if kind == "homework":
        st_hw = homework.status(repo.root, st)
        if st_hw and st_hw.get("name"):
            sheet = st_hw.get("assignment") or []
            where = ("The assignment sheet is at %s -- read it and do exactly the "
                     "problems it assigns, all of them, in order." % sheet[0]) if sheet else (
                     "No assignment sheet is filed under %s; ask which problems are "
                     "assigned before teaching anything." % os.path.dirname(st_hw["rel"]))
            return (how + "This is a HOMEWORK sitting on %s (%s). The problems are "
                    "assigned, not yours to choose. %s Transcribe each statement "
                    "before you teach it." % (st_hw["name"], st_hw["rel"], where))

    if chapter:
        return (how + "This sitting is labelled %r and it is a %s. Start there."
                % (chapter, kind))
    # A course that follows a book says so on disk. Naming its actual first
    # chapter beats telling an assistant to work it out, which is what produced
    # a Galois course opened at field extensions -- chapter four.
    first = syllabus.opening(repo.root)
    if first:
        every = syllabus.chapters(repo.root)
        return (how + "This sitting is a %s and carries no chapter label. This course "
                "follows a book and orders itself in %d chapters; the first is "
                "%s. Open there unless HANDOFF.md says otherwise, and name the "
                "chapter you are opening in your first card. Do not start from "
                "whatever you consider the foundation of the subject -- start "
                "where the book starts."
                % (kind, len(every), syllabus.label(first)))
    return (how + "This sitting is a %s and carries no chapter label, so nothing here "
            "says where to start. Do not guess from the subject: begin at the "
            "beginning of the course as the repository itself orders it, and say "
            "in your first card which chapter you are opening." % kind)


def newest_question(repo):
    """The card a turn sent now is answering."""
    newest = None
    try:
        names = sorted(os.listdir(repo.cards))
    except OSError:
        return None
    for name in names:
        m = CARD_RE.match(name)
        if not m:
            continue
        try:
            with open(os.path.join(repo.cards, name), "r", encoding="utf-8") as fh:
                meta, _ = parse_front_matter(fh.read())
        except OSError:
            continue
        if (meta.get("kind") or "lesson").lower() == "question":
            newest = m.group(1)
    return newest


def write_turn(repo, rec):
    with open(repo.turns_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")
    # So the counter survives this lesson being filed away.
    bump_turn_hwm(repo, rec.get("id"))


# ---------------------------------------------------------------------------
# past lessons
# ---------------------------------------------------------------------------
def list_archive(repo):
    """Every finished lesson, newest first, as something to pick from."""
    out = []
    try:
        names = sorted(os.listdir(repo.archive), reverse=True)
    except OSError:
        return out
    for name in names:
        folder = os.path.join(repo.archive, name)
        if not os.path.isdir(folder):
            continue
        st = {}
        try:
            with open(os.path.join(folder, "state.json"), "r", encoding="utf-8") as fh:
                st = json.load(fh) or {}
        except (OSError, ValueError):
            pass
        cards = [n for n in os.listdir(folder) if CARD_RE.match(n)]
        turns = load_turns(repo, os.path.join(folder, "turns.jsonl"))
        out.append({
            "id": name,
            "course": st.get("course") or "",
            "chapter": st.get("chapter") or "",
            "session": st.get("session") or "lecture",
            "opened": st.get("opened") or "",
            "finished": st.get("finished") or "",
            "cards": len(cards),
            "turns": len(turns),
        })
    return out


def archived_session(repo, name):
    """One past lesson, rendered the same way a live one is."""
    folder = os.path.join(repo.archive, name)
    st = {}
    try:
        with open(os.path.join(folder, "state.json"), "r", encoding="utf-8") as fh:
            st = json.load(fh) or {}
    except (OSError, ValueError):
        pass
    jobs = []
    saved_cards, repo.cards = repo.cards, folder
    try:
        cards = load_cards(repo, jobs)
    finally:
        repo.cards = saved_cards
    turns = load_turns(repo, os.path.join(folder, "turns.jsonl"))
    # Their frozen ink lives inside the archived folder now, so the transcript
    # keeps working after the live answers directory has moved on.
    for t in turns:
        for key in ("png", "ink"):
            if t.get(key, "").startswith("/answers/"):
                t[key] = "/archive/%s/answers/%s" % (name, t[key][len("/answers/"):])
    return {"id": name, "state": st, "cards": cards, "turns": turns,
            "archived": True}


def read_slate_pages(repo):
    """Full stroke data, so the slate resumes where it left off on any device."""
    pages = []
    try:
        names = sorted(n for n in os.listdir(repo.slate) if re.match(r"^page-\d+\.json$", n))
    except OSError:
        names = []
    for name in names:
        try:
            with open(os.path.join(repo.slate, name), "r", encoding="utf-8") as fh:
                pages.append(json.load(fh))
        except (OSError, ValueError):
            pass
    return pages


def load_slate(repo, limit=40):
    """Saved slate pages, newest last. Only the metadata -- the strokes stay on
    disk until the slate itself asks for them."""
    out = []
    try:
        names = sorted(n for n in os.listdir(repo.slate) if re.match(r"^page-\d+\.png$", n))
    except OSError:
        names = []
    for name in names[-limit:]:
        path = os.path.join(repo.slate, name)
        out.append({
            "name": name,
            "page": int(name[5:-4]),
            "url": "/slate/" + name,
            "mtime": os.path.getmtime(path),
            "size": os.path.getsize(path),
        })
    return out


def load_agent(repo):
    """Is an assistant attached, and is it working or waiting?

    An assistant nobody can see is worse than none. How that is decided depends
    on which kind it is: a headless daemon has a heartbeat and goes stale after
    two minutes of silence, while an interactive one is idle for as long as the
    person is thinking and is judged by whether its process is still there.
    Applying the heartbeat rule to both is why this indicator never once turned
    green in an ordinary `tutor` session.
    """
    try:
        with open(os.path.join(repo.live, "agent.json"), "r", encoding="utf-8") as fh:
            st = json.load(fh)
    except (OSError, ValueError):
        return None
    if not boardlib.agent_is_attached(st, boardlib.node_name()):
        st["state"] = "stale"
    return st


def load_hw(repo):
    """This sitting's problem set, and how much of it is written up.

    Parsed from the .tex on every build so the board tells the truth as the
    assistant fills it in, with the last compile's outcome bolted on from
    `live/hw.json` -- a failed compile has to reach the person holding the iPad
    the same way a failed push does.
    """
    try:
        st = homework.status(repo.root, repo.state())
    except Exception:
        return None
    if not st:
        return None
    st["ambiguous"] = st.get("ambiguous", [])[:8]
    st["sets"] = [x["name"] for x in homework.sets(repo.root)][:40]
    st.pop("dir", None)          # an absolute path on this machine is no use to a browser
    try:
        with open(os.path.join(repo.live, "hw.json"), "r", encoding="utf-8") as fh:
            st["build"] = json.load(fh)
    except (OSError, ValueError):
        st["build"] = None
    return st


def load_review(repo):
    """What this test review covers, so the board can say so and paint the picker.

    Cheap and always sent: it is a directory listing behind a lookup the payload
    already does, and the picker needs the list of things to pick from before a
    review sitting exists. The scope is re-resolved on every build rather than
    echoed back from `state.json` -- a chapter renamed out from under a sitting
    would otherwise stay on the strip for ever.
    """
    try:
        st = review.status(repo.root, repo.state())
    except Exception:                                        # noqa: BLE001
        return None
    if not st:
        return None
    st.pop("chosen", None)     # the names are enough; the board paints from units
    return st


def load_notes_sent(repo):
    """Which cards' marks have already been handed to the tutor.

    Kept beside `load_notes` rather than folded into it because the shape of
    `notes` is a contract with `Annotate.load`, and widening it there would mean
    every mark on the board arriving in a new shape for the sake of one boolean.
    """
    out = {}
    try:
        names = sorted(os.listdir(repo.notes))
    except OSError:
        return out
    for name in names:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(repo.notes, name), "r", encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        if rec.get("card"):
            out[rec["card"]] = bool(rec.get("sent"))
    return out


def load_notes(repo):
    """Every card's annotations, so a reload does not lose what was marked up."""
    out = {}
    try:
        names = sorted(os.listdir(repo.notes))
    except OSError:
        return out
    for name in names:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(repo.notes, name), "r", encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        if rec.get("card"):
            out[rec["card"]] = rec.get("strokes") or []
    return out


def load_text_drafts(repo):
    """Typed answers in progress, keyed by the question they answer.

    The slate keeps a page per question so going back to an earlier one does not
    lose the working on it. A typed answer needs the same: the sentence you were
    half way through when the tutor asked something else is still yours.
    """
    out = {}
    try:
        names = sorted(os.listdir(repo.text))
    except OSError:
        return out
    for name in names:
        if not name.endswith(".txt"):
            continue
        qid = name[:-4]
        if not re.match(r"^\d{1,4}$", qid):
            continue
        try:
            with open(os.path.join(repo.text, name), "r", encoding="utf-8") as fh:
                out[qid] = fh.read()
        except OSError:
            continue
    return out


# Whether this repository has work that is not committed. Asked on every poll,
# answered from a cache: `git status` on a network filesystem is not something to
# run four times a second, and the answer does not change that fast.
_DIRTY = {"at": 0.0, "value": None}
DIRTY_TTL = 8.0


def repo_dirty(repo):
    """How many files are uncommitted here, or None if that cannot be told.

    This exists so the board can show that there is something to save. Leaving a
    session is silent -- a lid closes, an app is swiped away -- and the student
    should be able to see, before they go, that going now loses something.
    """
    now = time.time()
    if _DIRTY["value"] is not None and now - _DIRTY["at"] < DIRTY_TTL:
        return _DIRTY["value"]
    value = None
    if os.path.isdir(os.path.join(repo.root, ".git")):
        try:
            p = subprocess.run(["git", "status", "--porcelain"], cwd=repo.root,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               timeout=10)
            if p.returncode == 0:
                lines = [l for l in p.stdout.decode("utf-8", "replace").splitlines()
                         if l.strip()]
                value = len(lines)
        except (OSError, subprocess.TimeoutExpired):
            value = None
    _DIRTY["at"] = now
    _DIRTY["value"] = value
    return value


def load_contents(repo):
    """What this course is made of, so the board can offer a way around it.

    Everything here is discovered, not registered: the chapter table or the
    chapter directories, the problem sets, and the lessons already filed. A
    course that is not a book simply has no chapters, and says so by returning
    none rather than by inventing a chapter one.
    """
    try:
        chapters = [{"num": c.get("num"), "label": syllabus.label(c)}
                    for c in syllabus.chapters(repo.root)][:60]
    except Exception:
        chapters = []
    try:
        sets = [{"name": x["name"], "rel": x["rel"]}
                for x in homework.sets(repo.root)][:60]
    except Exception:
        sets = []
    return {"chapters": chapters, "sets": sets}


def load_push(repo):
    """The outcome of the last push, so the iPad can see it without a terminal."""
    try:
        with open(os.path.join(repo.live, "push.json"), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def load_export(repo):
    """The outcome of the last export, for the same reason.

    A LaTeX run is a minute of somebody staring at an iPad, and the answer to
    "did that work" cannot be a line in a terminal nobody is looking at. It also
    has to survive the payload that lands the moment it finishes, which is why
    it is a file rather than a message.
    """
    try:
        with open(os.path.join(repo.live, "export.json"), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def hw_needs_building(repo):
    """The sitting's problem set, if its PDF is missing or older than its source.

    Cheap: two `stat` calls behind a lookup the board already does every payload.
    Returns the set's name, or None when there is nothing to build -- no problem
    sets in this repository, none bound to this sitting, or a PDF already newer
    than the `.tex`.
    """
    try:
        st = homework.status(repo.root, repo.state())
    except Exception:                                        # noqa: BLE001
        return None
    if not st or not st.get("rel") or not st.get("name"):
        return None
    tex = os.path.join(repo.root, st["rel"])
    if not os.path.exists(tex):
        return None
    pdf = os.path.splitext(tex)[0] + ".pdf"
    if not os.path.exists(pdf):
        import glob as _glob
        found = _glob.glob(os.path.join(os.path.dirname(tex), "build", "*.pdf"))
        pdf = found[0] if found else None
    if pdf and os.path.getmtime(pdf) >= os.path.getmtime(tex):
        return None
    return st["name"]


def build_before_push(repo):
    """Compile the write-up, so what is committed is the document and not just
    its source.

    An exercise is finished when it is typeset, not when it is agreed: the point
    of the hour is the piece of mathematics. Compiling it was a step the tutor had
    to remember at the end of a turn that had already delivered its card -- and
    sessions end by being abandoned far more often than they end tidily. What got
    pushed was then a `.tex` carrying tonight's proof beside a `.pdf` from last
    week that does not, which is worse than no PDF at all: it looks finished and
    is silently missing the exercise the evening was spent on.

    The compile is `board hw build`, the same one the tutor would run, so there is
    one way of building and one `hw.json` -- which the board is already painting,
    so a LaTeX error appears on the iPad rather than in a log nobody is reading.
    """
    name = hw_needs_building(repo)
    if not name:
        return None
    cli = os.path.join(HERE, "bin", "board")
    if not os.path.exists(cli):
        return None
    try:
        p = subprocess.run([sys.executable, cli, "hw", "build"], cwd=repo.root,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=180)
        out = p.stdout.decode("utf-8", "replace").strip()
        code = p.returncode
    except (subprocess.TimeoutExpired, OSError) as exc:
        out, code = str(exc), 1
    return {"set": name, "ok": code == 0, "detail": out[-800:]}


def run_push(repo, message=None):
    """Commit and push this repository, and record what happened.

    The work is the repository owner's. The script carries no co-author trailer
    and neither does anything here -- history should credit the person who did
    the mathematics and nobody else.
    """
    # The write-up is part of the work, so it is part of the commit. Only when it
    # is actually out of date, so an ordinary save in the middle of a lesson
    # costs nothing.
    built = build_before_push(repo)

    script = os.path.join(repo.root, "scripts", "save-and-push.sh")
    if os.path.exists(script):
        cmd = ["bash", script]
        if message:
            cmd.append(message)
    else:
        cmd = ["bash", "-c",
               'set -e; export GIT_TERMINAL_PROMPT=0; git add -A; '
               'git diff --cached --quiet || git commit -m "$1"; git push'
               , "_", message or "lesson complete"]
    try:
        p = subprocess.run(cmd, cwd=repo.root, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=180)
        out = p.stdout.decode("utf-8", "replace").strip()
        code = p.returncode
    except subprocess.TimeoutExpired:
        out, code = "timed out after 3 minutes -- is a credential prompt waiting?", 1
    except OSError as exc:
        out, code = str(exc), 1

    record = {
        "ok": code == 0,
        "at": time.time(),
        "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
        "detail": out[-1200:],
    }
    if built:
        # Said on the board, not only in a log. A push that quietly shipped a
        # stale PDF because LaTeX failed is the exact silence this exists to end.
        record["built"] = built["set"]
        record["built_ok"] = built["ok"]
        if not built["ok"]:
            record["detail"] = (
                "the write-up did not compile, so its PDF is behind the source "
                "that was pushed:\n" + built["detail"] + "\n\n" + record["detail"])
    with open(os.path.join(repo.live, "push.json"), "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)
    return record


def load_uploads(repo, limit=40):
    out = []
    try:
        names = sorted(os.listdir(repo.uploads))
    except OSError:
        names = []
    for name in names[-limit:]:
        path = os.path.join(repo.uploads, name)
        if not os.path.isfile(path):
            continue
        out.append({
            "name": name,
            "size": os.path.getsize(path),
            "url": "/uploads/" + urllib.parse.quote(name),
            "mtime": os.path.getmtime(path),
        })
    return out


# `stance` is what the tutor is FOR in this repository, and it is a per-course
# decision because the answer genuinely differs. "teach" is the default and the
# original point of the thing: the student writes the code and withholding it is
# the teaching. "do" is for a project where that is not what is wanted -- the
# work has to get done, the tutor writes it, runs it, and the card reports what
# it did and what is next. Everything else about a turn is unchanged either way.
DEFAULT_CONFIG = {"name": None, "mode": None, "subtitle": "", "stance": "teach"}


def read_config(root):
    """A course declares itself in tutorboard.json at its root.

    Everything is optional. What is not declared is guessed, and the guess is
    only ever about how the board behaves, never about whether it works.
    """
    cfg = dict(DEFAULT_CONFIG)
    try:
        with open(os.path.join(root, "tutorboard.json"), "r", encoding="utf-8") as fh:
            cfg.update(json.load(fh) or {})
    except (OSError, ValueError):
        pass

    if not cfg.get("name"):
        cfg["name"] = os.path.basename(os.path.abspath(root)).replace("-", " ")

    mode = (cfg.get("mode") or "").lower()
    if mode not in ("math", "code"):
        mode = guess_mode(root)
    cfg["mode"] = mode

    stance = (cfg.get("stance") or "").lower()
    # Never guessed. Writing the code for somebody who wanted to learn it is the
    # one failure here that cannot be undone by the next card, so it is only ever
    # done because a repository asked for it in writing.
    cfg["stance"] = "do" if stance == "do" else "teach"
    return cfg


def guess_mode(root):
    """LaTeX in the repository means mathematics; otherwise assume code.

    Only a fallback. A repository that cares should say so in tutorboard.json --
    the guess is cheap to get wrong and free to override.
    """
    if os.path.isdir(os.path.join(root, "latex")):
        return "math"
    for base, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs
                   if d not in (".git", "live", "node_modules", "build", "__pycache__")]
        if any(n.endswith(".tex") for n in names):
            return "math"
        if base.count(os.sep) - root.count(os.sep) > 2:
            dirs[:] = []
    return "code"


_SLURM = {"at": 0.0, "nodes": None}


def held_nodes():
    """Nodes this user still holds, cached for a few seconds.

    `sibling_courses` asks once per course and the hub asks often, so without a
    cache this is a `squeue` per repository per poll.
    """
    now = time.time()
    if now - _SLURM["at"] > 15.0:
        _SLURM["nodes"] = boardlib.slurm_nodes()
        _SLURM["at"] = now
    return _SLURM["nodes"]


# What the other machines are running, and when we last asked. Rebuilt in the
# background rather than while somebody is waiting: it is a walk over the tailnet
# and the hub must open now, with whatever is known, and fill in.
_HOSTS = {"at": 0.0, "value": [], "busy": False}
HOSTS_FRESH = 25.0


def this_host_entry(repo):
    """This machine, as the hub sees it."""
    return {
        "host": "",                     # empty means "wherever you are"
        "name": boardlib.tailnet_self() or boardlib.node_name(),
        "here": True,
        "reachable": True,
        "courses": sibling_courses(repo),
    }


def peer_hosts(repo):
    """Every other machine on the tailnet that is running a board, and its courses.

    A board serves `/courses.json` for its own machine, so one board is enough to
    learn what a machine has -- the walk exists only to find somebody to ask, and
    it knocks on the ports of the courses we know because the two machines are
    clones of the same list far more often than not.
    """
    out = []
    ours = [c["repo"] for c in sibling_courses(repo)]
    for host in boardlib.tailnet_peers():
        found = None
        for name in ours:
            port = boardlib.default_port(name)
            if boardlib.board_health(host, port, timeout=1.0):
                found = port
                break
        if not found:
            continue
        doc = boardlib.board_json(host, found, "/courses.json", timeout=2.0) or {}
        courses = doc.get("courses") or []
        for c in courses:
            c["current"] = False        # "current" is about the board you asked
        out.append({"host": host, "name": host.split(".")[0], "here": False,
                    "reachable": True, "port": found, "courses": courses})
    return out


def known_hosts(repo):
    """This machine first, then whatever else answered when we last looked."""
    now = time.time()
    if now - _HOSTS["at"] > HOSTS_FRESH and not _HOSTS["busy"]:
        _HOSTS["busy"] = True

        def refresh():
            try:
                _HOSTS["value"] = peer_hosts(repo)
                _HOSTS["at"] = time.time()
            finally:
                _HOSTS["busy"] = False
        threading.Thread(target=refresh, daemon=True).start()
    return {"hosts": [this_host_entry(repo)] + list(_HOSTS["value"]),
            "node": boardlib.node_name()}


def sibling_courses(repo):
    """Course repositories sitting alongside this one.

    A repository counts if it holds AI_INSTRUCTIONS.md or a live/ directory. The
    parent directory is the whole search -- there is no configuration and no
    registry to keep in step with reality.

    This is also the answer to "which subjects can I open from here", and it is
    the right answer by construction: it lists what the machine SERVING the board
    actually has on disk. A host with half the repositories cloned offers half
    the subjects, and no list anywhere has to be edited to say so.
    """
    parent = os.path.dirname(repo.root)
    out = []
    try:
        names = sorted(os.listdir(parent))
    except OSError:
        return out
    for name in names:
        root = os.path.join(parent, name)
        if not os.path.isdir(root):
            continue
        if not (os.path.isfile(os.path.join(root, "tutorboard.json")) or
                os.path.isfile(os.path.join(root, "AI_INSTRUCTIONS.md")) or
                os.path.isdir(os.path.join(root, "live"))):
            continue
        if os.path.abspath(root) == HERE:
            continue          # the tool is not one of the courses
        live = os.path.join(root, "live")
        cfg = read_config(root)
        entry = {
            "repo": name,
            "current": os.path.abspath(root) == repo.root,
            "course": cfg["name"],
            "mode": cfg["mode"],
            "chapter": "",
            "cards": 0,
            "running": False,
            "node": None,
        }
        try:
            with open(os.path.join(live, "state.json"), "r", encoding="utf-8") as fh:
                st = json.load(fh)
            entry["course"] = st.get("course") or entry["course"]
            entry["chapter"] = st.get("chapter") or ""
        except (OSError, ValueError):
            pass
        try:
            entry["cards"] = len([n for n in os.listdir(os.path.join(live, "cards"))
                                  if CARD_RE.match(n)])
        except OSError:
            pass
        try:
            with open(os.path.join(live, ".board.json"), "r", encoding="utf-8") as fh:
                info = json.load(fh)
            entry["node"] = info.get("node")
            if info.get("node") == boardlib.node_name():
                try:
                    os.kill(info.get("pid", -1), 0)
                    entry["running"] = True
                except OSError:
                    pass
            else:
                # A record naming another node proves nothing: the home
                # directory is shared, so a board that died with an allocation
                # leaves one behind that looks exactly like a live board. The
                # hub said "live on compute304" for hours after compute304
                # stopped being a machine this user had. Ask Slurm; `None` means
                # there is no Slurm to ask, which is unknown rather than gone.
                held = held_nodes()
                entry["running"] = held is None or info["node"] in held
                if not entry["running"]:
                    entry["node"] = None
        except (OSError, ValueError):
            pass
        out.append(entry)
    return out


def board_cli(repo, args, timeout=90):
    """Drive the board command line from inside the server, for /switch."""
    cli = os.path.join(HERE, "bin", "board")
    try:
        p = subprocess.run([sys.executable, cli] + list(args),
                           cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout)
        return p.returncode, p.stdout.decode("utf-8", "replace")
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)


def fresh_tutor(root, course):
    """Stop this course's assistant and start a new one, out of the way.

    The name is the whole of it: what comes back has read the new chapter's
    lesson and nothing else. `--wait` on the stop, so the two do not overlap;
    a start against a daemon that is still going would be a second one.
    """
    def run():
        tutor_cli(["agent", "stop", course, "--wait"], timeout=180)
        tutor_cli(["agent", "start", course], timeout=120)
    threading.Thread(target=run, daemon=True).start()


def tutor_cli(args, timeout=30):
    """Drive the launcher from inside the server, for the agent handover.

    The assistant belongs to the course, not to this process and not to the
    terminal anyone happens to have open, so switching course has to move it.
    Short timeout deliberately: `tutor agent start` detaches and returns, and
    `stop` only signals -- the wrap-up turn it triggers takes as long as it
    takes and nobody is waiting on it.
    """
    cli = os.path.join(HERE, "bin", "tutor")
    try:
        p = subprocess.run([sys.executable, cli] + list(args),
                           cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout)
        return p.returncode, p.stdout.decode("utf-8", "replace")
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)


def read_board_record(root):
    """A course's `.board.json`, or None. Which machine, which pid, which port."""
    try:
        with open(os.path.join(root, "live", ".board.json"), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def chosen_target():
    """The course a person last asked for, and the port it is actually serving on.

    The always-on host cannot read this machine's filesystem, so it cannot know
    either of these things -- it can only knock on ports and take whichever
    answers first, which is alphabetical order pretending to be a decision. So
    every board publishes the answer: the choice comes from `chosen.json`, and
    the port comes from that course's own board record, which is the only place
    the truth lives once a port collision has moved a board off its usual number.
    """
    rec = boardlib.chosen_course()
    name = rec.get("dir")
    if not name:
        return None
    root = rec.get("root") or os.path.join(os.path.dirname(HERE), name)
    port = None
    try:
        with open(os.path.join(root, "live", ".board.json"), "r", encoding="utf-8") as fh:
            port = (json.load(fh) or {}).get("port")
    except (OSError, ValueError):
        port = None
    # `at` so the always-on host can tell this record from its OWN. The choice is
    # written on whichever machine was serving the hub when the course was
    # tapped, so there are two records of it and only the times can say which is
    # the person's latest word -- without that, a course tapped over here was
    # invisible to a follower reading only its own file, and the tap did every
    # correct thing while the address stayed put.
    return {"dir": name, "port": port or boardlib.default_port(name),
            "at": rec.get("at") or 0}


def handover_secret():
    """The shared secret one machine presents to another to ask it to hand over.

    Unset means the endpoint is closed -- a board that has not been told the
    secret answers denied rather than inventing a trust boundary. Both machines
    carry the same value, top-level, in config.json.
    """
    try:
        with open(CONFIG, "r", encoding="utf-8") as fh:
            cfg = json.load(fh) or {}
    except (OSError, ValueError):
        return None
    return cfg.get("handover_secret") or None


# ---------------------------------------------------------------------------
# TikZ -> SVG worker
# ---------------------------------------------------------------------------
# The course's own macros load first and win; board-macros.tex is all
# \providecommand, so it only fills in whatever the course did not define. Without
# it a command that renders fine in the prose fails inside a tikz fence, which is
# the most confusing way for a diagram to break.
TIKZ_DOC = r"""\documentclass[border=6pt,varwidth=%(width)s]{standalone}
\usepackage{amsmath,amssymb,amsthm,mathtools}
\usepackage{tikz}
\usepackage{tikz-cd}
\usetikzlibrary{arrows.meta,positioning,calc,fit,shapes.geometric}
%(macros)s
\input{board-macros.tex}
\begin{document}
%(body)s
\end{document}
"""


class TikzWorker(threading.Thread):
    daemon = True

    def __init__(self, repo):
        threading.Thread.__init__(self)
        self.repo = repo
        self.queue = []
        self.seen = set()
        self.cv = threading.Condition()
        self.dirty = threading.Event()

    def submit(self, jobs):
        with self.cv:
            for job in jobs:
                if job[0] in self.seen:
                    continue
                self.seen.add(job[0])
                self.queue.append(job)
            if self.queue:
                self.cv.notify()

    def run(self):
        while True:
            with self.cv:
                while not self.queue:
                    self.cv.wait()
                digest, kind, src = self.queue.pop(0)
            try:
                self.compile(digest, kind, src)
            except Exception as exc:  # never let the worker die
                self._fail(digest, str(exc))
            self.dirty.set()

    def _fail(self, digest, msg):
        with open(os.path.join(self.repo.tikz, digest + ".err"), "w", encoding="utf-8") as fh:
            fh.write(msg)

    def compile(self, digest, kind, src):
        # A blank line inside a tikzpicture or tikzcd is a \par and blows up the
        # cell. Markdown fences pick up trailing whitespace, so strip it here.
        src = "\n".join(ln for ln in src.split("\n") if ln.strip()).strip()
        macros = ""
        sty = os.path.join(self.repo.root, "latex", "coursemacros.sty")
        if os.path.exists(sty):
            macros = r"\usepackage{coursemacros}"
        body = src
        if kind == "tikzcd" and "\\begin{tikzcd}" not in src:
            body = "\\begin{tikzcd}\n%s\n\\end{tikzcd}" % src
        elif kind == "tikz" and "\\begin{tikzpicture}" not in src and "\\begin{tikzcd}" not in src:
            body = "\\begin{tikzpicture}\n%s\n\\end{tikzpicture}" % src

        work = os.path.join(self.repo.tikz, "_work-" + digest)
        os.makedirs(work, exist_ok=True)
        tex = os.path.join(work, "fig.tex")
        with open(tex, "w", encoding="utf-8") as fh:
            fh.write(TIKZ_DOC % {"width": "0pt", "macros": macros, "body": body})

        env = boardlib.tex_env([
            os.path.join(self.repo.root, "latex"),
            os.path.join(HERE, "tex"),
        ])

        proc = subprocess.run(
            ["latex", "-interaction=nonstopmode", "-halt-on-error",
             "-output-directory=" + work, tex],
            cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90,
        )
        dvi = os.path.join(work, "fig.dvi")
        if proc.returncode != 0 or not os.path.exists(dvi):
            log = os.path.join(work, "fig.log")
            detail = ""
            if os.path.exists(log):
                with open(log, "r", encoding="utf-8", errors="replace") as fh:
                    lines = [ln for ln in fh if ln.startswith("!") or ".tex:" in ln]
                detail = "".join(lines[:8])
            self._fail(digest, detail or proc.stdout.decode("utf-8", "replace")[-800:])
            shutil.rmtree(work, ignore_errors=True)
            return

        out = os.path.join(self.repo.tikz, digest + ".svg")
        proc = subprocess.run(
            ["dvisvgm", "--no-fonts", "--exact-bbox", "--zoom=1.35",
             "--output=" + out, dvi],
            cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90,
        )
        if proc.returncode != 0 or not os.path.exists(out):
            self._fail(digest, proc.stdout.decode("utf-8", "replace")[-800:])
        shutil.rmtree(work, ignore_errors=True)


# ---------------------------------------------------------------------------
# broadcast hub
# ---------------------------------------------------------------------------
class Hub:
    def __init__(self, repo, worker):
        self.repo = repo
        self.worker = worker
        self.lock = threading.Lock()
        self.clients = []
        self.payload = "{}"
        self.digest = ""
        self.seq = 0

    def subscribe(self):
        q = []
        cv = threading.Condition()
        client = (q, cv)
        with self.lock:
            self.clients.append(client)
        return client

    def unsubscribe(self, client):
        with self.lock:
            if client in self.clients:
                self.clients.remove(client)

    def build(self):
        jobs = []
        cards = load_cards(self.repo, jobs)
        if jobs:
            self.worker.submit(jobs)
        state = self.repo.state()
        cfg = read_config(self.repo.root)
        state.setdefault("course", cfg["name"])
        state["mode"] = cfg["mode"]
        data = {
            "state": state,
            "cards": cards,
            "turns": load_turns(self.repo),
            "messages": load_messages(self.repo),
            "uploads": load_uploads(self.repo),
            "slate": load_slate(self.repo),
            "notes": load_notes(self.repo),
            "notes_sent": load_notes_sent(self.repo),
            "text_drafts": load_text_drafts(self.repo),
            "unsaved": repo_dirty(self.repo),
            "push": load_push(self.repo),
            "export": load_export(self.repo),
            "agent": load_agent(self.repo),
            "history": len(list_archive(self.repo)),
        }
        # Only in a homework sitting, and read from the .tex itself rather than
        # from a record the board keeps: the file is the truth, the assistant
        # edits it directly, and two sources of truth drift.
        # In a homework sitting, always. In a lecture, once a set has been bound
        # to it -- a lecture that works through a section's exercises is writing
        # them up into the same file, and the state of that file is exactly as
        # invisible from an iPad either way.
        if state.get("session") == "homework" or state.get("hw"):
            data["hw"] = load_hw(self.repo)
        # The names alone, always: the board offers them when switching, and a
        # lecture has no `hw` block to carry them in. A glob, not a parse.
        try:
            data["sets"] = [x["name"] for x in homework.sets(self.repo.root)][:40]
        except Exception:
            data["sets"] = []
        data["contents"] = load_contents(self.repo)
        # Always, in both kinds of repository: a review is chosen from the board
        # and the chooser needs something to offer before the sitting exists.
        data["review"] = load_review(self.repo)
        return data

    def poll_loop(self):
        while True:
            try:
                data = self.build()
                # The digest covers content only; seq is stamped afterwards, or
                # every poll would look like a change and loop forever.
                blob = json.dumps(data, sort_keys=True)
                digest = hashlib.sha1(blob.encode("utf-8")).hexdigest()
                if digest != self.digest:
                    self.digest = digest
                    self.seq += 1
                    data["seq"] = self.seq
                    self.payload = json.dumps(data)
                    self.push(self.payload)
            except Exception:
                pass
            if self.worker.dirty.wait(POLL_SECONDS):
                self.worker.dirty.clear()

    def push(self, payload):
        with self.lock:
            targets = list(self.clients)
        for q, cv in targets:
            with cv:
                q.append(payload)
                cv.notify()


# ---------------------------------------------------------------------------
# multipart parsing (hand rolled; cgi.FieldStorage is deprecated)
# ---------------------------------------------------------------------------
def parse_multipart(body, boundary):
    parts = []
    sep = b"--" + boundary
    for chunk in body.split(sep):
        if not chunk or chunk in (b"--\r\n", b"--", b"\r\n"):
            continue
        if chunk.startswith(b"\r\n"):
            chunk = chunk[2:]
        if chunk.endswith(b"\r\n"):
            chunk = chunk[:-2]
        head, _, data = chunk.partition(b"\r\n\r\n")
        if not _:
            continue
        headers = {}
        for line in head.decode("utf-8", "replace").splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        disp = headers.get("content-disposition", "")
        name = None
        filename = None
        m = re.search(r'name="([^"]*)"', disp)
        if m:
            name = m.group(1)
        m = re.search(r'filename="([^"]*)"', disp)
        if m:
            filename = m.group(1)
        parts.append({"name": name, "filename": filename, "data": data})
    return parts


SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(name):
    name = posixpath.basename((name or "").replace("\\", "/"))
    name = SAFE_NAME.sub("-", name).strip("-.") or "drop"
    return name[:120]


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "mathboard"

    def log_message(self, fmt, *args):
        pass

    # A request log, deliberately narrow.
    #
    # `board.log` used to hold nothing but "listening", which made two very
    # different failures the same observation: a send that never left the iPad
    # and a send this server rejected both looked like silence. Diagnosing the
    # first one cost a scratch server and a jsdom probe. Now the file says what
    # arrived.
    #
    # The poll and the stream are left out on purpose. /board.json is asked for
    # several times a second and /events never ends, so logging either buries
    # the one line anybody actually wants -- but a failure is logged whatever
    # the path, because a 500 on the poll is worth knowing about.
    QUIET_GET = re.compile(
        r"^/(events|board\.json|courses\.json|health|static/|figure/|"
        r"icon-\d+\.png|apple-touch-icon\.png|manifest\.webmanifest|sw\.js|"
        r"slate/(page-|state)|answers/|uploads/|notes/|favicon)")

    def log_request(self, code="-", size="-"):
        try:
            status = int(code)
        except (TypeError, ValueError):
            status = 0
        path = (self.path or "").split("?", 1)[0]
        if self.command == "GET" and status < 400 and self.QUIET_GET.match(path):
            return
        length = ""
        try:
            n = int((self.headers or {}).get("Content-Length") or 0)
            if n:
                length = " %d bytes in" % n
        except (TypeError, ValueError):
            pass
        self.note("%s %s -> %s%s" % (self.command, path, code, length))

    def note(self, line):
        """One timestamped line into board.log, which is this process's stderr."""
        try:
            sys.stderr.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), line))
            sys.stderr.flush()
        except (OSError, ValueError):
            pass

    # -- helpers ---------------------------------------------------------
    def send_bytes(self, data, ctype, cache=False, status=200, nosniff=False, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if nosniff:
            self.send_header("X-Content-Type-Options", "nosniff")
        if extra:
            self.send_header(extra[0], extra[1])
        if cache:
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            # The shell must never be held by the browser: an installed app that
            # cannot pick up a fix is an app nobody can repair.
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if getattr(self, "head_only", False):
            return
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_json(self, obj, status=200):
        self.send_bytes(json.dumps(obj).encode("utf-8"), "application/json", status=status)

    # Types that are safe to hand back inline for a file somebody uploaded.
    # Everything else is downloaded rather than rendered -- an uploaded .html or
    # .svg would otherwise run script on this origin.
    INLINE_OK = {"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"}

    def send_file(self, path, cache=False, untrusted=False):
        if not os.path.isfile(path):
            self.send_bytes(b"not found", "text/plain", status=404)
            return
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if path.endswith(".svg") and not untrusted:
            ctype = "image/svg+xml"
        extra = None
        if untrusted and ctype not in self.INLINE_OK:
            ctype = "application/octet-stream"
            extra = ("Content-Disposition",
                     'attachment; filename="%s"' % os.path.basename(path))
        with open(path, "rb") as fh:
            self.send_bytes(fh.read(), ctype, cache=cache, nosniff=untrusted, extra=extra)

    MAX_BODY = 64 * 1024 * 1024   # a slate page is ~200 KB; this is generous

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > self.MAX_BODY:
            raise ValueError("body too large")
        buf = b""
        while len(buf) < length:
            chunk = self.rfile.read(min(65536, length - len(buf)))
            if not chunk:
                break
            buf += chunk
        return buf

    # -- routing ---------------------------------------------------------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        repo = self.server.repo
        hub = self.server.hub

        if path in ("/", "/index.html", "/home"):
            return self.send_file(os.path.join(WEB, "home.html"))
        if path in ("/board", "/board/"):
            return self.send_file(os.path.join(WEB, "board.html"))
        if path == "/hosts.json":
            # Every machine that can teach, and what each one has.
            #
            # Which courses exist is a property of the MACHINE -- it is whatever
            # is cloned next to the board -- so "pick a course" was always really
            # "pick a course on whichever machine happens to be serving you". The
            # iPad could not see the other machine's courses at all, let alone
            # choose one. Asked for in those words: "I want to be able to control
            # this at all times on the iPad - whatever hosts are available".
            return self.send_json(known_hosts(repo))

        if path == "/courses.json":
            info = {}
            try:
                with open(os.path.join(repo.live, ".board.json"), "r", encoding="utf-8") as fh:
                    info = json.load(fh)
            except (OSError, ValueError):
                pass
            urls = [u for u in info.get("urls", []) if "127.0.0.1" not in u]
            return self.send_json({
                "courses": sibling_courses(repo),
                "where": (urls[0] if urls else "") ,
                "node": info.get("node"),
            })
        # Installable-app files must sit at the root: the service worker's scope
        # is its own directory, and iOS looks for /apple-touch-icon.png.
        if path == "/manifest.webmanifest":
            return self.send_bytes(open(os.path.join(WEB, "manifest.webmanifest"), "rb").read(),
                                   "application/manifest+json")
        if path == "/sw.js":
            return self.send_file(os.path.join(WEB, "sw.js"))
        if re.match(r"^/(apple-touch-icon|icon-\d+)\.png$", path):
            return self.send_file(os.path.join(WEB, os.path.basename(path)), cache=True)
        if path in ("/slate", "/slate/"):
            return self.send_file(os.path.join(WEB, "slate.html"))
        if path == "/slate/state":
            return self.send_json({"pages": read_slate_pages(repo)})
        if re.match(r"^/slate/page-\d+\.png$", path):
            return self.send_file(os.path.join(repo.slate, os.path.basename(path)))
        if path == "/events":
            return self.sse(hub)
        if path == "/board.json":
            return self.send_bytes(hub.payload.encode("utf-8"), "application/json")
        if path.startswith("/static/"):
            rel = path[len("/static/"):]
            target = os.path.normpath(os.path.join(WEB, rel))
            if not target.startswith(WEB):
                return self.send_bytes(b"nope", "text/plain", status=403)
            return self.send_file(
                target, cache=rel.startswith("katex/") or rel.startswith("fonts/"))
        if path.startswith("/figure/"):
            digest = safe_filename(path[len("/figure/"):]).replace(".svg", "")
            return self.send_file(os.path.join(repo.tikz, digest + ".svg"), cache=True)
        if path.startswith("/uploads/"):
            name = safe_filename(path[len("/uploads/"):])
            return self.send_file(os.path.join(repo.uploads, name), untrusted=True)
        if path.startswith("/answers/"):
            name = safe_filename(path[len("/answers/"):])
            return self.send_file(os.path.join(repo.answers, name))
        if path.startswith("/archive/"):
            # A past lesson, read only. The transcript is the point of keeping
            # them: a student coming back to a chapter should see what they
            # wrote at the time, not an empty board.
            rel = path[len("/archive/"):].strip("/")
            if not rel:
                return self.send_json({"sessions": list_archive(repo)})
            name = safe_filename(rel.split("/")[0])
            folder = os.path.join(repo.archive, name)
            if not os.path.isdir(folder):
                return self.send_json({"ok": False, "error": "no such session"}, status=404)
            rest = rel.split("/")[1:]
            if rest and rest[0] == "answers" and len(rest) > 1:
                return self.send_file(os.path.join(folder, "answers",
                                                   safe_filename(rest[1])))
            return self.send_json(archived_session(repo, name))
        if path == "/archive":
            return self.send_json({"sessions": list_archive(repo)})
        if path == "/health":
            # `dir` so a caller can confirm it reached the course it meant --
            # ports are derived from names and derivation is not proof. `chosen`
            # so the always-on host can follow a decision instead of a race.
            # `limited` so it can follow an allowance too: a board answering
            # perfectly well whose tutor has been told it is out of quota is
            # still up, and is still the wrong machine to hand a lesson to.
            # Only the machine serving can know that -- the limit is written by
            # its own tutor into its own state directory -- so it is published
            # here for the same reason the choice is.
            # `tutor` so the follower can prefer a board that actually has one.
            # Two machines can end up with a board for the same course -- a tap
            # in a hub used to start one wherever the tap landed -- and between
            # a board with a tutor listening and a board with nobody behind it
            # there is no contest: the second one is a lesson that cannot answer.
            agent = load_agent(repo) or {}
            return self.send_json({"ok": True, "root": repo.root,
                                   "dir": os.path.basename(repo.root),
                                   "chosen": chosen_target(),
                                   "tutor": agent.get("state") or None,
                                   "limited": boardlib.limited_until()})
        return self.send_bytes(b"not found", "text/plain", status=404)

    def do_HEAD(self):
        """Same routing as GET, headers only. Health checks and proxies use it."""
        self.head_only = True
        try:
            self.do_GET()
        finally:
            self.head_only = False

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        repo = self.server.repo

        if path == "/push":
            try:
                payload = json.loads(self.read_body().decode("utf-8") or "{}")
            except Exception:
                payload = {}
            record = run_push(repo, (payload.get("message") or "").strip() or None)
            _DIRTY["value"] = None      # ask again now, not in eight seconds
            # Clear the end-of-session offer either way; a failure shows as a
            # banner with the reason rather than as a standing prompt.
            st = repo.state()
            if st.pop("finished", None) is not None:
                with open(repo.state_path, "w", encoding="utf-8") as fh:
                    json.dump(st, fh, indent=2)
            self.server.hub.worker.dirty.set()
            return self.send_json(record)

        if path == "/export":
            # The whole conversation as one document. It can take a minute of
            # LaTeX, so the board is told what happened rather than left to
            # guess -- and the record it gets back is the same one the CLI
            # prints, because there is one exporter and it lives in document.py.
            try:
                payload = json.loads(self.read_body().decode("utf-8") or "{}")
            except Exception:
                payload = {}
            scope = "all" if payload.get("scope") == "all" else "lesson"
            try:
                rec = document.build(repo.root, scope=scope)
            except Exception as e:                       # noqa: BLE001
                rec = {"ok": False, "detail": "export failed: %s" % e}
            rec["at"] = time.time()
            rec["iso"] = time.strftime("%Y-%m-%d %H:%M:%S")
            with open(os.path.join(repo.live, "export.json"), "w", encoding="utf-8") as fh:
                json.dump(rec, fh, indent=2)
            _DIRTY["value"] = None      # the new file is uncommitted; say so
            self.server.hub.worker.dirty.set()
            return self.send_json(rec)

        if path == "/dismiss-finish":
            st = repo.state()
            st.pop("finished", None)
            with open(repo.state_path, "w", encoding="utf-8") as fh:
                json.dump(st, fh, indent=2)
            self.server.hub.worker.dirty.set()
            return self.send_json({"ok": True})

        if path == "/start":
            # Bring a course up ON THIS MACHINE, asked by a hub somewhere else.
            #
            # The hub can now offer the courses of every machine that is up, and
            # a course that is only cloned over there has to be startable from
            # over here or the offer is a lie. Same guard as `/switch`: only a
            # sibling directory this server already discovered, so no path from a
            # request ever reaches the filesystem.
            try:
                payload = json.loads(self.read_body().decode("utf-8") or "{}")
            except Exception:
                payload = {}
            want = payload.get("repo") or ""
            match = None
            for c in sibling_courses(repo):
                if c["repo"] == want:
                    match = c
                    break
            if not match:
                return self.send_json({"ok": False, "error": "unknown course"}, status=404)
            target = os.path.join(os.path.dirname(repo.root), match["repo"])
            code, out = board_cli(target, ["start"])
            if code != 0:
                return self.send_json({"ok": False, "error": out.strip()[-300:]},
                                      status=500)
            # The choice belongs to the machine the person is looking at, and it
            # has already been recorded there; this records it here as well, so
            # whichever machine the follower asks gets the same answer.
            boardlib.remember_chosen(match["repo"], target,
                                     host=payload.get("host") or "")
            tutor_cli(["agent", "start", match["repo"]])
            return self.send_json({"ok": True, "repo": match["repo"],
                                   "port": boardlib.default_port(match["repo"]),
                                   "detail": out.strip()[-300:]})

        if path == "/switch":
            try:
                payload = json.loads(self.read_body().decode("utf-8"))
            except Exception:
                return self.send_json({"ok": False, "error": "bad json"}, status=400)
            want = payload.get("repo") or ""
            on_host = (payload.get("host") or "").strip()

            # A course on another machine. The person picked the host in the hub,
            # so this is not a guess to be made here: record the pair, ask that
            # machine to bring the course up, and let the follower point the
            # address at it. Nothing is started here -- starting a second clone of
            # somebody else's course is the thing that made a mess of an evening.
            if on_host and on_host != (boardlib.tailnet_self() or ""):
                boardlib.remember_chosen(want, "", host=on_host)
                port = None
                for h in known_hosts(repo)["hosts"]:
                    if h.get("host") == on_host:
                        port = h.get("port")
                        break
                started = None
                if port:
                    started = boardlib.board_post(on_host, port, "/start",
                                                  {"repo": want, "host": on_host},
                                                  timeout=60)
                self.server.hub.worker.dirty.set()
                return self.send_json({
                    "ok": True, "repo": want, "host": on_host,
                    "detail": ("%s is bringing %s up; the address follows"
                               % (on_host.split(".")[0], want))
                    if started and started.get("ok")
                    else ("asked for %s on %s" % (want, on_host.split(".")[0])),
                })

            # Only a sibling directory this server already discovered. No paths
            # from the request ever reach the filesystem.
            match = None
            for c in sibling_courses(repo):
                if c["repo"] == want:
                    match = c
                    break
            if not match:
                return self.send_json({"ok": False, "error": "unknown course"}, status=404)
            target = os.path.join(os.path.dirname(repo.root), match["repo"])

            # A tap in the hub is a person saying which course they mean, and
            # that -- the RECORD -- is the whole of what moves the address. It is
            # written first and unconditionally, because on a pair of machines it
            # is the only thing both of them can read.
            boardlib.remember_chosen(match["repo"], target,
                                     host=boardlib.tailnet_self() or "")

            # What this machine does about it depends on whether this machine is
            # the one that decides.
            #
            # It used to do all of it, everywhere: start the course's board here,
            # take the tailnet name for it here, and start a tutor for it here --
            # whichever machine happened to be serving the hub. On one machine
            # that is exactly right. On two it is the cause of an evening's worth
            # of damage reported on 1 September 2026:
            #
            #   - two boards for one course, one on each machine, so the follower
            #     had a choice to make that should never have existed;
            #   - two TUTORS for one course, both blocked on the same inbox,
            #     both answering every message -- cards contradicting each other,
            #     answers invented, one run archiving the other's chapter
            #     mid-exercise. The handoff of that evening says it plainly:
            #     "Two headless sessions have been firing on the same inbox
            #     messages all evening, and the other one is unreliable";
            #   - and a tug-of-war over the tailnet name, because `vpn serve`
            #     here re-points it here while the always-on host's follower
            #     re-points it there, every tick. From the iPad that is "every
            #     time I tap Probability I get bumped back to Galois Theory".
            #
            # So: on a machine that owns its own name, do the lot. On a machine
            # that does not, record the choice and let the follower place the
            # address -- it reads the record off both machines and points at
            # whichever one is actually serving that course.
            shape = boardlib.machine_shape()
            mine = boardlib.board_is_running(
                (read_board_record(target) or {}).get("pid"), target)
            # Is anybody else already serving it? Asked, not assumed.
            #
            # The first version of this rule went by the machine's ROLE -- a
            # compute node never starts a course, the always-on host decides --
            # and that was wrong in the one way that matters: if the other
            # machine cannot be reached (and until boards listened on the tailnet
            # they never could be), a tap did nothing at all and the course could
            # not be opened from anywhere. A probe is the honest question, and
            # when it finds nothing the answer is to start it here rather than to
            # wait for a machine that may not be listening.
            elsewhere = None if mine else boardlib.locate_course(
                match["repo"], skip_local=True, timeout=1.5)
            started = ""
            if mine or not elsewhere:
                code, out = board_cli(target, ["start"])
                if code != 0:
                    return self.send_json({"ok": False, "error": out.strip()[-300:]},
                                          status=500)
                started = out.strip()
                if shape == "standalone":
                    board_cli(target, ["vpn", "serve"])
                # The assistant follows the course, and only where the course is
                # actually being served. Starting one from a tap on the other
                # machine is how a lesson ends up with two.
                acode, aout = tutor_cli(["agent", "start", match["repo"]])
            else:
                acode, aout = 0, ("%s is serving this course; the address follows the "
                                  "choice rather than starting a second one"
                                  % elsewhere[0])
            return self.send_json({"ok": True, "repo": match["repo"],
                                   "detail": started or aout,
                                   "agent": aout.strip() if acode == 0 else None,
                                   "agent_error": None if acode == 0 else aout.strip()[-300:]})

        if path == "/handover":
            # The always-on host asks an outgoing board to wrap up before it
            # moves the proxy: the assistant gets its one turn to write the
            # handoff, rather than being cut off mid-lesson. Gated on a shared
            # secret, because a board on the tailnet otherwise has no identity
            # to trust and the iPad must never be able to stop a lesson.
            secret = handover_secret()
            given = self.headers.get("X-Handover") or ""
            if not secret or given != secret:
                return self.send_json({"ok": False, "error": "denied"}, status=403)
            name = os.path.basename(repo.root)
            code, out = tutor_cli(["agent", "stop", name])
            return self.send_json({"ok": code == 0,
                                   "detail": out.strip()[-200:]})

        if path == "/session":
            # Which kind of sitting this is, chosen from the board. It was a
            # terminal-only decision, which meant a student who wanted help with
            # a problem set had to find a keyboard to say so.
            try:
                payload = json.loads(self.read_body().decode("utf-8") or "{}")
            except Exception:
                return self.send_json({"ok": False, "error": "bad json"}, status=400)
            kind = (payload.get("session") or "").strip().lower()
            if kind not in ("lecture", "homework", "review"):
                return self.send_json({"ok": False, "error": "bad session"}, status=400)
            want = (payload.get("hw") or "").strip()
            chapter = (payload.get("chapter") or "").strip()

            # A test review is held over a scope the student picks, and a scope is
            # a list: a test is not one chapter. Every name in it is matched
            # against what this repository actually has before anything is
            # written, exactly as a problem set name is -- nothing typed reaches
            # the filesystem and nothing invented reaches the tutor's prompt.
            if kind == "review":
                over = payload.get("over")
                if not isinstance(over, list):
                    over = [over] if over else []
                chosen, unknown = review.resolve(repo.root, [str(x) for x in over])
                if unknown:
                    return self.send_json({"ok": False, "error": "no such chapter",
                                           "unknown": unknown[:8]}, status=400)
                if not chosen:
                    # A review over nothing is not a sitting, and opening one
                    # would archive the lesson they are in to no purpose.
                    return self.send_json({"ok": False, "error": "nothing chosen"},
                                          status=400)
                names = [u["name"] for u in chosen]
                of = review.kind(repo.root) or "chapters"
                course = repo.state().get("course") or read_config(repo.root)["name"] or ""
                args = ["open", course, review.sitting_label(chosen, of), "--review"]
                for n in names:
                    args += ["--over", n]
                board_cli(repo.root, args)
                st = repo.state()
                st["session"] = kind
                st["review"] = names
                st.pop("hw", None)
                with open(repo.state_path, "w", encoding="utf-8") as fh:
                    json.dump(st, fh, indent=2)
                self.server.hub.worker.dirty.set()
                return self.send_json({"ok": True, "session": kind, "review": names})

            # Moving to a different chapter is starting a different lesson, and
            # `board open` is what starts one: it files the current lesson away
            # whole -- cards, turns and answers together -- so the one being left
            # is still readable under the history button rather than being
            # overwritten by the next.
            if chapter:
                known = [syllabus.label(c) for c in syllabus.chapters(repo.root)]
                if chapter not in known:
                    return self.send_json({"ok": False, "error": "no such chapter"},
                                          status=400)
                course = repo.state().get("course") or read_config(repo.root)["name"] or ""
                board_cli(repo.root, ["open", course, chapter,
                                      "--lecture" if kind == "lecture" else "--homework"])
                # A chapter gets its own tutor.
                #
                # An assistant is long-lived on purpose -- one that survives being
                # left still has the lesson in its head when you come back -- and
                # across a chapter that is the wrong thing to have in its head.
                # Reported an hour into Chapter 3: "the tutor is telling me that
                # problems from chapter 1 are still incomplete. I don't like
                # that." Its own conversation held the whole of Chapter 1, and no
                # file on disk could have told it otherwise.
                #
                # On its own thread: stopping is a wrap-up TURN, which is a model
                # call, and the person tapping a chapter is not waiting a minute
                # to see the chapter change. The handoff that turn writes is
                # stamped with the chapter it was teaching, so it is filed under
                # that chapter rather than read as this one's.
                fresh_tutor(repo.root, course)

            st = repo.state()
            st["session"] = kind
            st.pop("review", None)
            if kind == "homework":
                # Only a set this repository actually has. A name from the
                # request never reaches the filesystem.
                every = {x["name"]: x for x in homework.sets(repo.root)}
                chosen = every.get(want)
                if want and not chosen:
                    return self.send_json({"ok": False, "error": "no such set"}, status=400)
                if chosen:
                    if not chapter and st.get("hw") != chosen["rel"]:
                        course = st.get("course") or read_config(repo.root)["name"] or ""
                        board_cli(repo.root, ["open", course, chosen["name"],
                                              "--homework", "--set", chosen["name"]])
                        st = repo.state()
                        st["session"] = kind
                    st["hw"] = chosen["rel"]
                    st["chapter"] = chosen["name"]
            else:
                st.pop("hw", None)
            with open(repo.state_path, "w", encoding="utf-8") as fh:
                json.dump(st, fh, indent=2)
            self.server.hub.worker.dirty.set()
            return self.send_json({"ok": True, "session": kind, "hw": st.get("hw")})

        if path == "/annotate/save":
            # Marks written over the tutor's own cards. Saving keeps them across
            # a reload; sending makes them a turn. They are anchored to a card,
            # in that card's own coordinates, so changing the type size or the
            # reading face moves the ink with the words instead of leaving it
            # stranded where the words used to be.
            try:
                payload = json.loads(self.read_body().decode("utf-8"))
            except Exception:
                return self.send_json({"ok": False, "error": "bad json"}, status=400)
            card = str(payload.get("card") or "")
            if not re.match(r"^\d{1,4}$", card):
                return self.send_json({"ok": False, "error": "bad card"}, status=400)
            strokes = payload.get("strokes") or []
            # Whether these marks have been handed to the tutor, recorded next
            # to them. Without it a reload cannot tell ink that was delivered
            # from ink that was only ever autosaved, so yesterday's forgotten
            # marks went on demanding a decision every time anything was sent.
            # A plain save only ever arrives for a card that just changed, so
            # "not a send" is exactly the right moment to clear the flag.
            sent = bool(payload.get("send"))
            with open(os.path.join(repo.notes, card + ".json"), "w", encoding="utf-8") as fh:
                json.dump({"card": card, "strokes": strokes, "sent": sent}, fh)
            self.note("annotate card %s: %d strokes, %s"
                      % (card, len(strokes), "SENT" if sent else "saved only"))

            png = payload.get("png") or ""
            marker = "base64,"
            saved_png = None
            if marker in png:
                import base64
                try:
                    saved_png = os.path.join(repo.notes, card + ".png")
                    with open(saved_png, "wb") as fh:
                        fh.write(base64.b64decode(png.split(marker, 1)[1]))
                except Exception:
                    saved_png = None

            if not payload.get("send"):
                self.server.hub.worker.dirty.set()
                return self.send_json({"ok": True, "card": card})

            tid = payload.get("turn") or next_turn_id(repo)
            rev = turn_revision(repo, tid)
            base = "%s-r%d" % (tid, rev)
            if saved_png:
                try:
                    shutil.copyfile(saved_png, os.path.join(repo.answers, base + ".png"))
                except OSError:
                    pass
            with open(os.path.join(repo.answers, base + ".json"), "w", encoding="utf-8") as fh:
                json.dump({"card": card, "strokes": strokes}, fh)
            record = {
                "id": tid, "rev": rev, "kind": "annotation",
                "answers": card,
                "t": time.time(),
                "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
                "from": "student",
                "strokes": len(strokes),
                "where": payload.get("where") or "",
                "png": "/answers/" + base + ".png",
                "ink": "/answers/" + base + ".json",
                "read": False,
            }
            write_turn(repo, record)
            msg = dict(record)
            # The tutor wrote this card and can read it back off disk, so what it
            # needs from here is which card was marked, roughly where, and the
            # ink itself.
            # Marks on the card that is currently asking are an answer, and the
            # tutor has to be told that rather than left to infer it -- a card
            # that asked the student to decide something gets marks back, and
            # "they wrote on your card" reads like a passing note.
            answering_now = (card == newest_question(repo))
            msg["text"] = ("[annotation] %s card %s%s. Open the image, read what "
                           "they marked, and answer it against that card's own "
                           "text in live/cards/.%s"
                           % ("this is their ANSWER to your question on"
                              if answering_now else "they wrote on your",
                              card,
                              (", " + record["where"]) if record["where"] else "",
                              " Treat it as the answer to that question."
                              if answering_now else ""))
            msg["slate"] = os.path.join(repo.answers, base + ".png")
            with open(repo.messages_path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(msg) + "\n")
            self.server.hub.worker.dirty.set()
            return self.send_json({"ok": True, "card": card, "turn": tid, "rev": rev})

        if path == "/slate/save":
            try:
                payload = json.loads(self.read_body().decode("utf-8"))
            except Exception:
                return self.send_json({"ok": False, "error": "bad json"}, status=400)
            n = int(payload.get("page") or 1)
            if not (1 <= n <= 999):
                return self.send_json({"ok": False, "error": "bad page"}, status=400)
            stem = os.path.join(repo.slate, "page-%02d" % n)

            with open(stem + ".json", "w", encoding="utf-8") as fh:
                json.dump({"page": n, "w": payload.get("w"), "h": payload.get("h"),
                           "strokes": payload.get("strokes") or []}, fh)

            png = payload.get("png") or ""
            marker = "base64,"
            if marker in png:
                import base64
                try:
                    with open(stem + ".png", "wb") as fh:
                        fh.write(base64.b64decode(png.split(marker, 1)[1]))
                except Exception:
                    pass

            if payload.get("send"):
                strokes = payload.get("strokes") or []
                # Revising an answer supersedes it; a new answer starts a turn.
                tid = payload.get("turn") or next_turn_id(repo)
                rev = turn_revision(repo, tid)
                base = "%s-r%d" % (tid, rev)
                # Frozen, because the slate page it came from will be written
                # over. What was handed in has to stay what was handed in.
                try:
                    shutil.copyfile(stem + ".png", os.path.join(repo.answers, base + ".png"))
                except OSError:
                    pass
                with open(os.path.join(repo.answers, base + ".json"), "w",
                          encoding="utf-8") as fh:
                    json.dump({"w": payload.get("w"), "h": payload.get("h"),
                               "strokes": strokes}, fh)
                record = {
                    "id": tid, "rev": rev, "kind": "ink",
                    "answers": payload.get("answers") or newest_question(repo),
                    "t": time.time(),
                    "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "from": "student",
                    "page": n, "strokes": len(strokes),
                    "png": "/answers/" + base + ".png",
                    "ink": "/answers/" + base + ".json",
                    "read": False,
                }
            write_turn(repo, record)
            msg = dict(record)
            # What arrived is a page, not a verdict. It may be an attempt,
            # a question written in the margin, or "I don't know how to
            # start" -- and reading it as a wrong answer when it is a
            # question is the most discouraging thing this can do.
            msg["text"] = ("[slate] %s rev %d, %d strokes. Open the image and "
                           "read what is actually on it: if there is a question "
                           "anywhere on the page, answer that first, in its own "
                           "card, before assessing any working. Do not mark a "
                           "question wrong."
                           % (tid, rev, len(strokes)))
            msg["slate"] = os.path.join(repo.answers, base + ".png")
            with open(repo.messages_path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(msg) + "\n")
            self.server.hub.worker.dirty.set()
            self.note("slate page %d: %d strokes, SENT as %s rev %d answering %s"
                      % (n, len(strokes), tid, rev, record["answers"] or "-"))
            return self.send_json({"ok": True, "page": n, "turn": tid, "rev": rev})
            self.server.hub.worker.dirty.set()
            self.note("slate page %d: %d strokes, saved only (not sent)"
                      % (n, len(payload.get("strokes") or [])))
            return self.send_json({"ok": True, "page": n})

        if path == "/text/save":
            # A typed answer in progress, kept per question so the panel can flip
            # between writing and typing without losing either.
            try:
                payload = json.loads(self.read_body().decode("utf-8"))
            except Exception:
                return self.send_json({"ok": False, "error": "bad json"}, status=400)
            qid = str(payload.get("question") or "")
            if not re.match(r"^\d{1,4}$", qid):
                return self.send_json({"ok": False, "error": "bad question"}, status=400)
            text = payload.get("text") or ""
            stem = os.path.join(repo.text, qid + ".txt")
            if text.strip():
                with open(stem, "w", encoding="utf-8") as fh:
                    fh.write(text)
            else:
                try:
                    os.remove(stem)
                except OSError:
                    pass
            self.server.hub.worker.dirty.set()
            return self.send_json({"ok": True, "question": qid})

        if path == "/say":
            try:
                payload = json.loads(self.read_body().decode("utf-8"))
            except Exception:
                return self.send_json({"ok": False, "error": "bad json"}, status=400)
            text = (payload.get("text") or "").strip()
            # A signal carries meaning without a sentence: in a code course the
            # useful things to say are mostly "done", "stuck" and "confused",
            # and making someone type those on a tablet is a tax.
            # "begin" is the cold start. On an empty maths board there is no
            # question, so no answer is owed, so the slate never opens and there
            # is no text box either -- which left the iPad with no way to say
            # the first thing of a session. This is that, and it is a signal
            # rather than a composer on purpose.
            signal = (payload.get("signal") or "").strip().lower() or None
            if signal not in (None, "done", "help", "confused", "begin", "skip"):
                return self.send_json({"ok": False, "error": "bad signal"}, status=400)
            if not text and not signal:
                return self.send_json({"ok": False, "error": "empty"}, status=400)

            tid = payload.get("turn") or next_turn_id(repo)
            rev = turn_revision(repo, tid)
            record = {
                "id": tid, "rev": rev, "kind": "text",
                "answers": payload.get("answers") or newest_question(repo),
                "t": time.time(),
                "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
                "from": payload.get("from") or "student",
                "text": text[:8000],
                "signal": signal,
                "read": False,
            }
            write_turn(repo, record)
            # The typed draft for this question is now the answer itself; it has
            # been said and should not come back to haunt the next prompt.
            a = record.get("answers")
            if a:
                try:
                    os.remove(os.path.join(repo.text, str(a) + ".txt"))
                except OSError:
                    pass
            # What lands in the inbox is what `board wait` prints, and in a
            # headless session that string IS the prompt the assistant is woken
            # with. A bare "[begin]" tells it nothing, so a signal sent without a
            # sentence carries its own.
            line = ("[%s] " % signal if signal else "") + text
            if signal and not text:
                line += (skip_sense(repo) if signal == "skip"
                         else SIGNAL_SENSE.get(signal, ""))
            if signal == "begin":
                # Where to begin, not merely that they are waiting. Without this
                # the assistant has a blank board, no handoff, and a signal that
                # says nothing -- so it guesses, and the first guess opened a
                # course at chapter four.
                line += " " + session_sense(repo)
            with open(repo.messages_path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(dict(record, text=line)) + "\n")
            self.server.hub.worker.dirty.set()
            return self.send_json({"ok": True, "turn": tid, "rev": rev})

        if path == "/upload":
            ctype = self.headers.get("Content-Type", "")
            m = re.search(r"boundary=([^;]+)", ctype)
            if not m:
                return self.send_json({"ok": False, "error": "no boundary"}, status=400)
            boundary = m.group(1).strip('"').encode("utf-8")
            parts = parse_multipart(self.read_body(), boundary)
            saved = []
            stamp = time.strftime("%Y%m%d-%H%M%S")
            for i, part in enumerate(parts):
                if not part["filename"]:
                    continue
                name = "%s-%02d-%s" % (stamp, i, safe_filename(part["filename"]))
                with open(os.path.join(repo.uploads, name), "wb") as fh:
                    fh.write(part["data"])
                saved.append(name)
            if saved:
                record = {
                    "t": time.time(),
                    "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "from": "student",
                    # A picture has no sentence in it, so its inbox line has to
                    # carry its own meaning -- the same reason a `begin` signal
                    # spells itself out. A tutor woken by a bare filename has no
                    # reason to think opening it is the next thing to do.
                    "text": ("[uploaded] %s — the student handed this over for you "
                             "to look at. Open the file below and answer what is "
                             "in it." % ", ".join(saved)),
                    "files": saved,
                    "read": False,
                }
                with open(repo.messages_path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(record) + "\n")
            self.server.hub.worker.dirty.set()
            return self.send_json({"ok": True, "saved": saved})

        return self.send_bytes(b"not found", "text/plain", status=404)

    # -- server sent events ---------------------------------------------
    def sse(self, hub):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        q, cv = hub.subscribe()
        try:
            self.wfile.write(b"retry: 1000\n\n")
            self.wfile.write(("data: " + hub.payload + "\n\n").encode("utf-8"))
            self.wfile.flush()
            while True:
                with cv:
                    if not q:
                        cv.wait(15.0)
                    pending = q[:]
                    del q[:]
                if pending:
                    for payload in pending[-1:]:
                        self.wfile.write(("data: " + payload + "\n\n").encode("utf-8"))
                else:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except Exception:
            pass
        finally:
            hub.unsubscribe((q, cv))


def lan_addresses():
    addrs = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        addrs.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return addrs


def main(argv):
    root = os.getcwd()
    port = 8778
    # Loopback by default. There is no authentication of any kind here, so
    # listening on every interface has to be a decision somebody made on purpose.
    # Tailscale reaches the board through 127.0.0.1 either way.
    host = "127.0.0.1"
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--root", "-r"):
            i += 1
            root = argv[i]
        elif a in ("--port", "-p"):
            i += 1
            port = int(argv[i])
        elif a == "--lan":
            host = "0.0.0.0"
        elif a == "--local":
            host = "127.0.0.1"
        i += 1

    repo = Repo(root)
    worker = TikzWorker(repo)
    worker.start()
    hub = Hub(repo, worker)
    hub.payload = json.dumps(hub.build())

    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    httpd.repo = repo
    httpd.hub = hub

    t = threading.Thread(target=hub.poll_loop, daemon=True)
    t.start()

    # And a second door, on the tailnet address and nowhere else.
    #
    # A board listens on loopback, deliberately: there is no authentication here
    # and the university LAN is not somewhere to put an unauthenticated page. The
    # consequence went unnoticed for a week -- the OTHER machine could never see
    # this one's boards. The always-on host's follower probes a course's ports on
    # the compute node to decide where the address should point, every one of
    # those probes was refused by a socket bound to 127.0.0.1, and so the address
    # could only ever land on a board the Mac itself was running. From the iPad:
    # "Galois Theory is the only option, and when I tap Probability I can't
    # switch" -- and, when the Mac's own boards changed, the same sentence with
    # the courses the other way round.
    #
    # The tailscale address is not the LAN: it is reachable only by machines on
    # this tailnet, which is the same trust boundary the iPad already crosses to
    # read the lesson. So bind that one too, and only that one.
    tailnet = []
    for addr in boardlib.tailnet_addresses():
        try:
            second = ThreadingHTTPServer((addr, port), Handler)
        except OSError as exc:
            sys.stderr.write("not listening on %s: %s\n" % (addr, exc))
            continue
        second.daemon_threads = True
        second.repo = repo
        second.hub = hub
        threading.Thread(target=second.serve_forever, daemon=True).start()
        tailnet.append(addr)
    # And the way that works where binding does not: on a machine running
    # tailscaled in userspace mode the address exists but no interface carries
    # it, so `bind()` fails and the board would be invisible to the other machine
    # -- which is the machine that decides where the address points. tailscaled
    # accepts the connection itself and forwards it to loopback.
    if not tailnet and boardlib.publish_board(port):
        # The tailnet name, not the hostname: this machine is `compute302` to
        # slurm and `compute-node` on the tailnet, and only the second one is
        # reachable from the machine that needs to reach it.
        tailnet.append(boardlib.tailnet_self() or boardlib.node_name())

    info = {
        "pid": os.getpid(),
        "port": port,
        "bind": host,
        # The home directory is shared across compute nodes, so a pid on its own
        # says nothing -- the same number is very likely alive on this node and
        # belong to something else entirely.
        "node": boardlib.node_name(),
        "root": repo.root,
        # Only advertise what is actually listening.
        "urls": (["http://127.0.0.1:%d/" % port] +
                 ["http://%s:%d/" % (a, port) for a in tailnet] +
                 (["http://%s:%d/" % (a, port) for a in lan_addresses()]
                  if host == "0.0.0.0" else [])),
        "started": time.time(),
    }
    with open(os.path.join(repo.live, ".board.json"), "w", encoding="utf-8") as fh:
        json.dump(info, fh, indent=2)
    sys.stderr.write("board listening on %s\n" % ", ".join(info["urls"]))
    sys.stderr.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main(sys.argv[1:])
