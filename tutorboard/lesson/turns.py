"""A turn is the student's half of the conversation.

Numbered, revisable, and written down: an answer that is corrected supersedes
the one before it rather than appending to a pile.
"""

import json
import os
import re
import time

from . import cards, notes



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
    for rec in notes.load_messages(repo, limit=10 ** 9):
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
    for rec in notes.load_messages(repo, limit=10 ** 9):
        if rec.get("id") == tid:
            rev = max(rev, rec.get("rev", 1))
    return rev + 1


# A signal is a tap, not a sentence, so it has to carry its own meaning into the
# inbox -- see /say. "begin" is the one that has to be unmistakable, because it
def newest_question(repo):
    """The card a turn sent now is answering."""
    newest = None
    try:
        names = sorted(os.listdir(repo.cards))
    except OSError:
        return None
    for name in names:
        m = cards.CARD_RE.match(name)
        if not m:
            continue
        try:
            with open(os.path.join(repo.cards, name), "r", encoding="utf-8") as fh:
                meta, _ = cards.parse_front_matter(fh.read())
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
