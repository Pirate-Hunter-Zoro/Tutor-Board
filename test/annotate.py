#!/usr/bin/env python3
"""Marks written over the tutor's own cards.

A question about a lesson is nearly always a question about one place in it, and
sending a separate page of working to ask it is a translation the student should
not have to perform. So the marks are anchored to the card they sit on, stored in
that card's own coordinates, and sent as their own kind of turn.

What the tutor receives is the ink and the card it is on -- it wrote that card and
can read it back off disk, so it does not need a picture of its own words. This
drives the real handler, because the failure being guarded is a mark that is saved
and then cannot be found again.
"""

import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from tutorboard import sense
from tutorboard.course import repo as course_repo
from tutorboard.lesson import archive
from tutorboard.lesson import git
from tutorboard.lesson import notes
from tutorboard.lesson import turns
from tutorboard.server import handler
from tutorboard.server import hub
from tutorboard.server import tikz
from http.server import ThreadingHTTPServer

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


tmp = tempfile.mkdtemp(prefix="tutor-ann-")
json.dump({"name": "T", "mode": "math"}, open(os.path.join(tmp, "tutorboard.json"), "w"))
repo = course_repo.Repo(tmp)
open(os.path.join(repo.cards, "0003-a-card.md"), "w", encoding="utf-8").write(
    "---\nkind: lesson\ntitle: A card\n---\n\nSomething to mark up.\n")

worker = tikz.TikzWorker(repo)
worker.start()
board = hub.Hub(repo, worker)
board.payload = json.dumps(board.build())

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()
httpd = ThreadingHTTPServer(("127.0.0.1", port), handler.Handler)
httpd.daemon_threads = True
httpd.repo = repo
httpd.hub = board
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % port

PNG = ("data:image/png;base64,"
       "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def post(path, body):
    req = urllib.request.Request(BASE + path, method="POST",
                                 data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


try:
    strokes = [{"c": "#e0b45c", "w": 2.2, "p": [0.1, 0.12, 0.4, 0.14, 0.7, 0.11]}]

    # --- saving, which is what a reload depends on ----------------------------
    status, body = post("/annotate/save", {"card": "0003", "strokes": strokes, "png": PNG})
    check("a mark can be saved without being sent", status == 200 and body.get("ok"))
    check("it is stored against the card it sits on",
          os.path.isfile(os.path.join(repo.notes, "0003.json")))
    check("no turn is created by merely saving", not turns.load_turns(repo))

    seen = notes.load_notes(repo)
    check("and the board gets it back on the next payload",
          seen.get("0003") and seen["0003"][0]["p"][0] == 0.1)
    # Saved is not sent, and after a reload the browser has no other way to tell
    # the difference. Marks autosaved and never handed over went on demanding a
    # decision every time anything else was sent, for ever.
    check("a saved-only mark is recorded as not sent",
          notes.load_notes_sent(repo).get("0003") is False)
    check("coordinates are the card's own, not the page's — so a reflow moves "
          "the ink with the words",
          all(0.0 <= v <= 1.0 for v in seen["0003"][0]["p"]))

    # --- sending --------------------------------------------------------------
    status, body = post("/annotate/save", {"card": "0003", "strokes": strokes,
                                           "png": PNG, "send": True,
                                           "where": "near the top"})
    check("sending is accepted", status == 200 and body.get("turn"))
    sent = turns.load_turns(repo)
    check("it becomes a turn in the transcript", len(sent) == 1)
    t = sent[0]
    check("of its own kind, distinct from a page of working", t["kind"] == "annotation")
    check("anchored to the card it was written on", t["answers"] == "0003")
    check("carrying the ink as an image the tutor can open", t["png"].endswith(".png"))
    check("and the image is really on disk",
          os.path.isfile(os.path.join(repo.answers, os.path.basename(t["png"]))))
    check("frozen, like every other answer — the card can be marked again later",
          "/answers/" in t["png"])
    check("and the card is now recorded as delivered",
          notes.load_notes_sent(repo).get("0003") is True)
    check("which the board is told about on the payload",
          board.build().get("notes_sent", {}).get("0003") is True)

    # A later change to the same card puts it back to undelivered, because a
    # plain save only ever arrives for a card that has just been drawn on.
    post("/annotate/save", {"card": "0003", "strokes": strokes + strokes, "png": PNG})
    check("marking it again makes it undelivered once more",
          notes.load_notes_sent(repo).get("0003") is False)

    with open(repo.messages_path, encoding="utf-8") as fh:
        line = json.loads([l for l in fh if l.strip()][-1])
    # In a headless session this line is the prompt the tutor is woken with.
    check("the inbox says which card was marked", "card 0003" in line["text"])
    check("and roughly where on it", "near the top" in line["text"])
    check("and tells the tutor to read it against that card's own text",
          "live/cards/" in line["text"])
    check("the image is named as a file to open", line.get("slate", "").endswith(".png"))

    # --- a second mark on the same card supersedes rather than piling up -------
    status, body = post("/annotate/save", {"card": "0003", "strokes": strokes,
                                           "png": PNG, "send": True,
                                           "turn": t["id"]})
    sent = turns.load_turns(repo)
    check("marking the same card again revises that turn", len(sent) == 1)
    check("and the revision is recorded", sent[0]["rev"] == 2)

    # --- saving mid-session must not end the session --------------------------
    # `board push` from a terminal archives a code session, because a commit is
    # what "we got this working" means there. The board's own save is a
    # different act: somebody putting the iPad down and wanting their work
    # committed. It must leave the lesson exactly where it was.
    before_cards = sorted(os.listdir(repo.cards))
    before_turns = len(turns.load_turns(repo))
    git.run_push(repo, "a mid-session save")
    check("a board save leaves the cards where they are",
          sorted(os.listdir(repo.cards)) == before_cards)
    check("and the transcript intact", len(turns.load_turns(repo)) == before_turns)
    check("and nothing archived out from under the student",
          not os.listdir(repo.archive))
    check("while still recording what happened, pass or fail",
          os.path.isfile(os.path.join(repo.live, "push.json")))

    # --- choosing the kind of sitting from the board --------------------------
    # This was a terminal-only decision, so a student who wanted help with a
    # problem set had to find a keyboard to say so.
    os.makedirs(os.path.join(tmp, "homework", "hw01", "assignment"), exist_ok=True)
    open(os.path.join(tmp, "homework", "hw01", "hw01.tex"), "w").write(
        "\\begin{problem}{1}\nStatement.\n\\end{problem}\n"
        "% ===== SOLUTION 1 =====\n% TODO\n% ===== END SOLUTION 1 =====\n")
    open(os.path.join(tmp, "homework", "hw01", "assignment", "sheet.pdf"), "wb").write(b"%PDF-1.4\n")

    status, body = post("/session", {"session": "homework", "hw": "hw01"})
    check("the sitting can be switched to homework from the board",
          status == 200 and body.get("ok"))
    st = repo.state()
    check("and the set is bound to it", st.get("hw") == "homework/hw01/hw01.tex")
    check("and the badge will read homework", st.get("session") == "homework")

    line = sense.session_sense(repo)
    check("the tutor is pointed at the assignment sheet itself",
          "sheet.pdf" in line)
    check("and told the problems are not its to choose",
          "not yours to choose" in line)
    check("and told to do all of them, in order", "all of them, in order" in line)
    check("and not told to pick a manageable few, which is a lecture behaviour",
          "manageable few" not in line)

    status, _ = post("/session", {"session": "homework", "hw": "hw99"})
    check("a set this course does not have is refused", status == 400)
    status, _ = post("/session", {"session": "seminar"})
    check("and so is a kind that does not exist", status == 400)

    status, body = post("/session", {"session": "lecture"})
    check("switching back to a lecture unbinds the set",
          status == 200 and not repo.state().get("hw"))

    # --- jumping to a chapter -------------------------------------------------
    # Moving to a different chapter is starting a different lesson, so what is
    # being left has to be filed whole rather than written over.
    open(os.path.join(tmp, "chapters.tsv"), "w", encoding="utf-8").write(
        "01\t1\t9\tch01-a\tFirst chapter\n02\t10\t19\tch02-b\tSecond chapter\n")
    open(os.path.join(repo.cards, "0009-mid-lesson.md"), "w", encoding="utf-8").write(
        "---\nkind: lesson\n---\n\nwork in progress\n")

    status, body = post("/session", {"session": "lecture", "chapter": "Ch 02 — Second chapter"})
    check("a chapter can be opened from the board", status == 200 and body.get("ok"))
    check("and the sitting is labelled with it",
          repo.state().get("chapter") == "Ch 02 — Second chapter")
    check("the lesson that was open is filed, not discarded",
          len(archive.list_archive(repo)) >= 1)
    check("and the board starts clean for the new chapter",
          not [n for n in os.listdir(repo.cards) if n.endswith(".md")])

    status, _ = post("/session", {"session": "lecture", "chapter": "Ch 99 — Invented"})
    check("a chapter this course does not have is refused", status == 400)

    # --- the log says what arrived --------------------------------------------
    # board.log used to hold nothing but "listening", so a send that never left
    # the device and a send this server rejected were the same observation.
    import io as _io
    cap = _io.StringIO()
    real_stderr, sys.stderr = sys.stderr, cap
    try:
        post("/annotate/save", {"card": "0003", "strokes": strokes, "png": PNG})
        post("/annotate/save", {"card": "0003", "strokes": strokes, "png": PNG,
                                "send": True, "turn": t["id"]})
    finally:
        sys.stderr = real_stderr
    logged = cap.getvalue()
    check("the log records the request that arrived", "POST /annotate/save" in logged)
    check("with the size of the body, so a truncated upload is visible",
          "bytes in" in logged)
    check("and distinguishes a save from a send, which is the whole point",
          "saved only" in logged and "SENT" in logged)
    check("the poll is not logged, or the one useful line is buried",
          "/board.json" not in logged)

    # --- rubbish is refused ---------------------------------------------------
    status, _ = post("/annotate/save", {"card": "../../etc/passwd", "strokes": []})
    check("a card id cannot escape the annotations directory", status == 400)
    status, _ = post("/annotate/save", {"strokes": []})
    check("a mark with no card is refused", status == 400)
finally:
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

print()
# The controls are controls, not prose.
#
# Reported from the board: "sometimes the word 'Pen' gets highlighted in the
# button that corresponds with the annotation writing options. And that makes the
# annotation experience janky and intermittently stop writing." Press and hold a
# button on a tablet and iOS selects its label; the selection then owns the next
# drag, so the stroke that should have reached the ink layer never does.
#
# `body.annotating #board *` already refused selection over the lesson. The
# annotation bar is fixed-position and sits OUTSIDE #board, so none of it applied
# there -- and the bar is the one part of the screen a hand is on constantly.
import re

css = open(os.path.join(ROOT, "web", "board.css"), encoding="utf-8").read()
# Comments sit inside the selector text once the file is split on braces,
# and a selector with a paragraph in front of it matches nothing.
css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def rule_for(selector):
    """Every declaration that applies to this selector, from every block.

    All of them, not the first: `.annbar` is styled in one block for where it
    sits and another for what it refuses, and reading only the first is how a
    rule that IS there gets reported as missing.
    """
    out = []
    for block in css.split("}"):
        head, _, body = block.partition("{")
        if any(part.strip() == selector for part in head.split(",")):
            out.append(body)
    return "\n".join(out)


for sel in (".annbar", ".annbar *"):
    got = rule_for(sel)
    check("%s refuses selection, so holding a control cannot start one" % sel,
          "user-select: none" in got)
    check("and refuses the callout iOS puts on a long press (%s)" % sel,
          "-webkit-touch-callout: none" in got)
check("and its buttons take a tap without waiting to see if it is a zoom",
      "touch-action: manipulation" in rule_for(".annbar button"))
check("the title bar is held the same way and gets the same rule",
      "user-select: none" in rule_for(".bar-right *"))

print("%d FAILURES" % len(fails) if fails else "marks are anchored to the card they are about")
sys.exit(1 if fails else 0)
