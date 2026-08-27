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
