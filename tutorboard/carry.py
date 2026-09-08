"""What one turn tells the next, when there is no conversation between them.

A turn is its own session. Nothing the tutor was thinking survives it unless it
is written down, and `board recap` cannot carry that part: the recap says what
was asked and what came back, not that the student is reading a ∃ as a ∀, that
this is the third attempt at the same line, or that the ladder is aimed at the
witness rather than at the algebra.

That is what this file holds, and it is deliberately tiny. It is read at the
start of every turn, so a long one is a cost paid over and over -- the same
mistake `HANDOFF.md` made when nothing capped it and it reached 3,824 words
against a documented cap of 350.
"""

import os
import re


# Two sentences and a bit. Long enough for the misreading and the plan, short
# enough that reading it on every turn costs nothing worth counting. A tutor
# that needs more than this is describing the lesson, and the lesson is already
# on disk under `board recap`.
NOTE_WORDS = 120


def note_path(root):
    return os.path.join(root, "live", "NEXT.md")


def read_note(root):
    """What the last turn left for this one, or "" if it left nothing.

    Never an error. The first turn of a lesson has no predecessor, a machine
    that has just taken a course over has no note (the note lives in `live/`,
    which is not tracked -- `HANDOFF.md` is what crosses a machine), and a turn
    that failed before it wrote one leaves the previous note in place, which is
    the right answer rather than a gap.
    """
    try:
        with open(note_path(root), "r", encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def word_count(text):
    return len(re.findall(r"\S+", text or ""))


def write_note(root, text, words=NOTE_WORDS):
    """Replace the carry-forward note. Returns (kept, count, over).

    The cap is refused rather than trimmed. Cutting the tail off a note is the
    worst of the three options: the plan is at the end, so a truncated note
    keeps the description and loses the instruction, and nothing says it
    happened. `over` is True and nothing is written -- the caller says so and
    the turn writes a shorter one, which costs one round trip against a document
    that would otherwise be read for the rest of the course.
    """
    text = (text or "").strip()
    n = word_count(text)
    if n > words:
        return "", n, True
    path = note_path(root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not text:
        try:
            os.remove(path)
        except OSError:
            pass
        return "", 0, False
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text + "\n")
    os.replace(tmp, path)
    return text, n, False


def clear_note(root):
    """Forget it -- a new chapter, or a lesson that has been archived.

    A note is about the turn that just happened. Carried into a chapter the
    student has closed it is the same defect the chapter-stamped handoff was
    written to fix: last week's unfinished business offered as though it were
    this morning's.
    """
    try:
        os.remove(note_path(root))
        return True
    except OSError:
        return False
