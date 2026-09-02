"""Committing the lesson, and exporting it as something to hand to somebody.
"""

import time
import json
import os

from . import NOT_MINE
from ...course import document
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
