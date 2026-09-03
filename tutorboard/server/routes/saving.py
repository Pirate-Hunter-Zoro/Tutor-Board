"""Committing the lesson, and exporting it as something to hand to somebody.
"""

import time
import json
import os

from . import NOT_MINE
from ...course import document, screenshot
from ...lesson import git


def post(h, repo, path):
    if path == "/push":
        try:
            payload = json.loads(h.read_body().decode("utf-8") or "{}")
        except Exception:
            payload = {}
        record = git.run_push(repo, (payload.get("message") or "").strip() or None)
        git._DIRTY["value"] = None      # ask again now, not in eight seconds
        # Clear the end-of-session offer either way; a failure shows as a
        # banner with the reason rather than as a standing prompt.
        st = repo.state()
        if st.pop("finished", None) is not None:
            with open(repo.state_path, "w", encoding="utf-8") as fh:
                json.dump(st, fh, indent=2)
        h.server.hub.worker.dirty.set()
        return h.send_json(record)

    if path == "/hw/build":
        # THE WRITTEN-UP WORK IS A DOCUMENT TOO.
        #
        # A lesson had a button and a problem set did not, so the only way to
        # compile the thing an evening was actually spent writing was a
        # terminal -- which is the one thing the board exists to abolish, and it
        # was asked for in those terms: "I want an option to export the written
        # up homework as well as the lesson."
        #
        # `board hw build` is the compile, unchanged: the same one the tutor
        # runs, the same one a push runs before it commits a stale PDF, so
        # there is one compiler and one record of what it said. This only
        # presses the button.
        try:
            rec = git.run_hw_build(repo)
        except Exception as e:                       # noqa: BLE001
            rec = {"ok": False, "detail": "build failed: %s" % e}
        git._DIRTY["value"] = None      # a new PDF is uncommitted; say so
        h.server.hub.worker.dirty.set()
        return h.send_json(rec)

    if path == "/export/shot":
        # THE LESSON AS IT WAS ACTUALLY READ.
        #
        # Asked for from the iPad, about the export that already existed: "for
        # the tutor session export, I don't want the latex dump it currently
        # gives; I want it as if it were a screenshot of the entire iPad screen
        # scrolled down over the whole tutoring session."
        #
        # The pixels come from the device because the device is the only thing
        # that knows what the lesson looks like -- there is no headless browser
        # on a compute node and there never will be. What stays here is what a
        # client must not be trusted with and what must not differ between the
        # two exports: where it goes, what it is called, which version it is,
        # and that it is staged for the next commit.
        #
        # It writes `export.json` like the typeset export does, and that is not
        # incidental: `/download/lesson` resolves the document through that
        # record and nothing else, so a photograph that did not write it would
        # be a PDF in the repository with no way to get it off the device.
        try:
            payload = json.loads(h.read_body().decode("utf-8") or "{}")
        except Exception:                            # noqa: BLE001
            payload = {}
        images, why = screenshot.decode(payload)
        if why:
            rec = {"ok": False, "detail": why}
        else:
            box = screenshot.page_box(payload)
            try:
                rec = screenshot.build(repo.root, images, box[0], box[1])
            except Exception as e:                   # noqa: BLE001
                rec = {"ok": False, "detail": "could not write it: %s" % e}
        rec["at"] = time.time()
        rec["iso"] = time.strftime("%Y-%m-%d %H:%M:%S")
        rec.setdefault("scope", "shot")
        with open(os.path.join(repo.live, "export.json"), "w", encoding="utf-8") as fh:
            json.dump(rec, fh, indent=2)
        git._DIRTY["value"] = None      # the new file is uncommitted; say so
        h.server.hub.worker.dirty.set()
        return h.send_json(rec)

    if path == "/export":
        # The whole conversation as one document. It can take a minute of
        # LaTeX, so the board is told what happened rather than left to
        # guess -- and the record it gets back is the same one the CLI
        # prints, because there is one exporter and it lives in document.py.
        try:
            payload = json.loads(h.read_body().decode("utf-8") or "{}")
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
        git._DIRTY["value"] = None      # the new file is uncommitted; say so
        h.server.hub.worker.dirty.set()
        return h.send_json(rec)
    return NOT_MINE
