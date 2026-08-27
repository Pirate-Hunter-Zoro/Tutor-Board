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
import serve  # noqa: E402

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


tmp = tempfile.mkdtemp(prefix="tutor-ann-")
json.dump({"name": "T", "mode": "math"}, open(os.path.join(tmp, "tutorboard.json"), "w"))
repo = serve.Repo(tmp)
open(os.path.join(repo.cards, "0003-a-card.md"), "w", encoding="utf-8").write(
    "---\nkind: lesson\ntitle: A card\n---\n\nSomething to mark up.\n")

worker = serve.TikzWorker(repo)
worker.start()
hub = serve.Hub(repo, worker)
hub.payload = json.dumps(hub.build())

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()
httpd = serve.ThreadingHTTPServer(("127.0.0.1", port), serve.Handler)
httpd.daemon_threads = True
httpd.repo = repo
httpd.hub = hub
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
    check("no turn is created by merely saving", not serve.load_turns(repo))

    notes = serve.load_notes(repo)
    check("and the board gets it back on the next payload",
          notes.get("0003") and notes["0003"][0]["p"][0] == 0.1)
    check("coordinates are the card's own, not the page's — so a reflow moves "
          "the ink with the words",
          all(0.0 <= v <= 1.0 for v in notes["0003"][0]["p"]))

    # --- sending --------------------------------------------------------------
    status, body = post("/annotate/save", {"card": "0003", "strokes": strokes,
                                           "png": PNG, "send": True,
                                           "where": "near the top"})
    check("sending is accepted", status == 200 and body.get("turn"))
    turns = serve.load_turns(repo)
    check("it becomes a turn in the transcript", len(turns) == 1)
    t = turns[0]
    check("of its own kind, distinct from a page of working", t["kind"] == "annotation")
    check("anchored to the card it was written on", t["answers"] == "0003")
    check("carrying the ink as an image the tutor can open", t["png"].endswith(".png"))
    check("and the image is really on disk",
          os.path.isfile(os.path.join(repo.answers, os.path.basename(t["png"]))))
    check("frozen, like every other answer — the card can be marked again later",
          "/answers/" in t["png"])

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
    turns = serve.load_turns(repo)
    check("marking the same card again revises that turn", len(turns) == 1)
    check("and the revision is recorded", turns[0]["rev"] == 2)

    # --- saving mid-session must not end the session --------------------------
    # `board push` from a terminal archives a code session, because a commit is
    # what "we got this working" means there. The board's own save is a
    # different act: somebody putting the iPad down and wanting their work
    # committed. It must leave the lesson exactly where it was.
    before_cards = sorted(os.listdir(repo.cards))
    before_turns = len(serve.load_turns(repo))
    serve.run_push(repo, "a mid-session save")
    check("a board save leaves the cards where they are",
          sorted(os.listdir(repo.cards)) == before_cards)
    check("and the transcript intact", len(serve.load_turns(repo)) == before_turns)
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

    sense = serve.session_sense(repo)
    check("the tutor is pointed at the assignment sheet itself",
          "sheet.pdf" in sense)
    check("and told the problems are not its to choose",
          "not yours to choose" in sense)
    check("and told to do all of them, in order", "all of them, in order" in sense)
    check("and not told to pick a manageable few, which is a lecture behaviour",
          "manageable few" not in sense)

    status, _ = post("/session", {"session": "homework", "hw": "hw99"})
    check("a set this course does not have is refused", status == 400)
    status, _ = post("/session", {"session": "seminar"})
    check("and so is a kind that does not exist", status == 400)

    status, body = post("/session", {"session": "lecture"})
    check("switching back to a lecture unbinds the set",
          status == 200 and not repo.state().get("hw"))

    # --- rubbish is refused ---------------------------------------------------
    status, _ = post("/annotate/save", {"card": "../../etc/passwd", "strokes": []})
    check("a card id cannot escape the annotations directory", status == 400)
    status, _ = post("/annotate/save", {"strokes": []})
    check("a mark with no card is refused", status == 400)
finally:
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

print()
print("%d FAILURES" % len(fails) if fails else "marks are anchored to the card they are about")
sys.exit(1 if fails else 0)
