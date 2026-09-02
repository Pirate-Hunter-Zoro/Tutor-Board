"""Handwriting, both what is on the surface and what was handed in.

The slate saves constantly and sends deliberately, and the difference
between those two is most of what these routes are about.
"""

import re
import shutil
import time
import json
import os

from . import NOT_MINE
from .. import multipart
from ...lesson import slate
from ...lesson import turns


def get(h, repo, path):
    if path == "/slate/state":
        return h.send_json({"pages": slate.read_slate_pages(repo)})
    return NOT_MINE


def post(h, repo, path):
    if path == "/annotate/save":
        # Marks written over the tutor's own cards. Saving keeps them across
        # a reload; sending makes them a turn. They are anchored to a card,
        # in that card's own coordinates, so changing the type size or the
        # reading face moves the ink with the words instead of leaving it
        # stranded where the words used to be.
        try:
            payload = json.loads(h.read_body().decode("utf-8"))
        except Exception:
            return h.send_json({"ok": False, "error": "bad json"}, status=400)
        card = str(payload.get("card") or "")
        if not re.match(r"^\d{1,4}$", card):
            return h.send_json({"ok": False, "error": "bad card"}, status=400)
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
        h.note("annotate card %s: %d strokes, %s"
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
            h.server.hub.worker.dirty.set()
            return h.send_json({"ok": True, "card": card})

        tid = payload.get("turn") or turns.next_turn_id(repo)
        rev = turns.turn_revision(repo, tid)
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
        turns.write_turn(repo, record)
        msg = dict(record)
        # The tutor wrote this card and can read it back off disk, so what it
        # needs from here is which card was marked, roughly where, and the
        # ink itself.
        # Marks on the card that is currently asking are an answer, and the
        # tutor has to be told that rather than left to infer it -- a card
        # that asked the student to decide something gets marks back, and
        # "they wrote on your card" reads like a passing note.
        answering_now = (card == turns.newest_question(repo))
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
        h.server.hub.worker.dirty.set()
        return h.send_json({"ok": True, "card": card, "turn": tid, "rev": rev})

    if path == "/slate/save":
        try:
            payload = json.loads(h.read_body().decode("utf-8"))
        except Exception:
            return h.send_json({"ok": False, "error": "bad json"}, status=400)
        n = int(payload.get("page") or 1)
        if not (1 <= n <= 999):
            return h.send_json({"ok": False, "error": "bad page"}, status=400)
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
            tid = payload.get("turn") or turns.next_turn_id(repo)
            rev = turns.turn_revision(repo, tid)
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
                "answers": payload.get("answers") or turns.newest_question(repo),
                "t": time.time(),
                "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
                "from": "student",
                "page": n, "strokes": len(strokes),
                "png": "/answers/" + base + ".png",
                "ink": "/answers/" + base + ".json",
                "read": False,
            }
            turns.write_turn(repo, record)
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
            h.server.hub.worker.dirty.set()
            h.note("slate page %d: %d strokes, SENT as %s rev %d answering %s"
                      % (n, len(strokes), tid, rev, record["answers"] or "-"))
            return h.send_json({"ok": True, "page": n, "turn": tid, "rev": rev})
        h.server.hub.worker.dirty.set()
        h.note("slate page %d: %d strokes, saved only (not sent)"
                  % (n, len(payload.get("strokes") or [])))
        return h.send_json({"ok": True, "page": n})

    if path == "/upload":
        ctype = h.headers.get("Content-Type", "")
        m = re.search(r"boundary=([^;]+)", ctype)
        if not m:
            return h.send_json({"ok": False, "error": "no boundary"}, status=400)
        boundary = m.group(1).strip('"').encode("utf-8")
        parts = multipart.parse_multipart(h.read_body(), boundary)
        saved = []
        stamp = time.strftime("%Y%m%d-%H%M%S")
        for i, part in enumerate(parts):
            if not part["filename"]:
                continue
            name = "%s-%02d-%s" % (stamp, i, multipart.safe_filename(part["filename"]))
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
        h.server.hub.worker.dirty.set()
        return h.send_json({"ok": True, "saved": saved})
    return NOT_MINE
