"""A course on disk, and the paths inside it.

Everything the board reads or writes during a lesson hangs off one of these,
so a directory layout that changes changes here and nowhere else.
"""

import json
import os


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
