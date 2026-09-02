"""One payload, built once, pushed to every browser that has the board open.
"""

import hashlib
import json
import os
import threading
import time

from ..course import config, homework
from ..lesson import archive, cards, git, notes, slate, state, turns, uploads

# How often the worker looks for a change nothing told it about. The board is
# pushed to, not polled, so this is the safety net rather than the mechanism.
POLL_SECONDS = 0.25


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
        on_board = cards.load_cards(self.repo, jobs)
        if jobs:
            self.worker.submit(jobs)
        board_state = self.repo.state()
        cfg = config.read_config(self.repo.root)
        board_state.setdefault("course", cfg["name"])
        board_state["mode"] = cfg["mode"]
        data = {
            "state": board_state,
            "cards": on_board,
            "turns": turns.load_turns(self.repo),
            "messages": notes.load_messages(self.repo),
            "uploads": uploads.load_uploads(self.repo),
            "slate": slate.load_slate(self.repo),
            "notes": notes.load_notes(self.repo),
            "notes_sent": notes.load_notes_sent(self.repo),
            "text_drafts": notes.load_text_drafts(self.repo),
            "unsaved": git.repo_dirty(self.repo),
            "push": state.load_push(self.repo),
            "export": state.load_export(self.repo),
            "agent": state.load_agent(self.repo),
            "history": len(archive.list_archive(self.repo)),
        }
        # Only in a homework sitting, and read from the .tex itself rather than
        # from a record the board keeps: the file is the truth, the assistant
        # edits it directly, and two sources of truth drift.
        # In a homework sitting, always. In a lecture, once a set has been bound
        # to it -- a lecture that works through a section's exercises is writing
        # them up into the same file, and the state of that file is exactly as
        # invisible from an iPad either way.
        if board_state.get("session") == "homework" or board_state.get("hw"):
            data["hw"] = state.load_hw(self.repo)
        # The names alone, always: the board offers them when switching, and a
        # lecture has no `hw` block to carry them in. A glob, not a parse.
        try:
            data["sets"] = [x["name"] for x in homework.sets(self.repo.root)][:40]
        except Exception:
            data["sets"] = []
        data["contents"] = state.load_contents(self.repo)
        # Always, in both kinds of repository: a review is chosen from the board
        # and the chooser needs something to offer before the sitting exists.
        data["review"] = state.load_review(self.repo)
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
