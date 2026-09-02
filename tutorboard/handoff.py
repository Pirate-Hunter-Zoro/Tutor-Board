"""The handoff belongs to its chapter.

HANDOFF.md is the only continuity a session has. A chapter is its own thing,
so what was left unfinished in an earlier one is not this chapter's business.
"""

import json
import os
import re
import time


# ---------------------------------------------------------------------------
# the handoff belongs to its chapter
# ---------------------------------------------------------------------------
# `HANDOFF.md` is the only continuity a session has: the last tutor writes where
# the student got to, what they got wrong, and what not to re-teach, and the next
# one reads it before its first card. It is written at the root of the course,
# once per session, and that was fine for as long as a course was one long
# conversation.
#
# It is not fine across a chapter. Reported on 1 September 2026, an hour into
# Chapter 3: "the tutor is telling me that problems from chapter 1 are still
# incomplete. I don't like that." The handoff had a section headed *Left
# unfinished in Chapter 1*, the new chapter's tutor read it, and it duly offered
# to go back for an exercise from a chapter the student had closed.
#
# So a handoff is stamped with the chapter it is about, and a chapter that is not
# the one now open does not get read: it is parked under `live/handoffs/`, named
# for its chapter, and comes back if that chapter is ever reopened. A chapter
# starts as its own thing, which is what a person means by starting a chapter.
_HANDOFF_STAMP = re.compile(r"^<!--\s*chapter:\s*(.*?)\s*-->\s*\n?", re.IGNORECASE)


def handoff_path(root):
    return os.path.join(root, "HANDOFF.md")


def parked_handoff(root, chapter):
    """Where a chapter's own handoff waits while another chapter is open."""
    slug = re.sub(r"[^A-Za-z0-9]+", "-", (chapter or "").strip().lower()).strip("-")
    return os.path.join(root, "live", "handoffs", (slug or "unlabelled") + ".md")


def read_handoff(root):
    """(text, the chapter it is about or None). Unstamped is not an error: it
    predates the stamp, or a model wrote the file itself."""
    try:
        with open(handoff_path(root), "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return "", None
    m = _HANDOFF_STAMP.match(text)
    return text, (m.group(1) if m else None)


def stamp_handoff(root, chapter):
    """Say which chapter the handoff at the root is about.

    Written by whoever produced it, at the moment it is produced, because that is
    the only moment anything knows: by the time it is read the board may be two
    chapters further on. The stamp is an HTML comment, so it is invisible
    wherever the file is rendered and harmless wherever it is not.
    """
    text, _ = read_handoff(root)
    if not text.strip():
        return False
    body = _HANDOFF_STAMP.sub("", text, count=1).lstrip("\n")
    try:
        with open(handoff_path(root), "w", encoding="utf-8") as fh:
            fh.write("<!-- chapter: %s -->\n%s" % ((chapter or "").strip(), body))
    except OSError:
        return False
    return True


def park_handoff(root, chapter):
    """Put a handoff away under the chapter it belongs to. Returns where."""
    text, _ = read_handoff(root)
    if not text.strip():
        return None
    dest = parked_handoff(root, chapter)
    try:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        os.replace(handoff_path(root), dest)
    except OSError:
        return None
    return dest


def restore_handoff(root, chapter):
    """Bring a chapter's own handoff back, if it has one waiting."""
    src = parked_handoff(root, chapter)
    if not os.path.exists(src) or os.path.exists(handoff_path(root)):
        return None
    try:
        os.replace(src, handoff_path(root))
    except OSError:
        return None
    return handoff_path(root)


def handoff_applies(root, chapter):
    """Is the handoff at the root about the chapter that is open?

    A stale one is parked as a side effect: it is the reader that discovers this,
    because the daemon that wrote it may well have been writing while the board
    was already opening the next chapter -- the wrap-up turn is a model call and
    it takes as long as it takes.
    """
    text, about = read_handoff(root)
    if not text.strip():
        return False
    if about is None or not (chapter or "").strip():
        return True                     # unstamped, or a course with no chapters
    if about.strip() == (chapter or "").strip():
        return True
    park_handoff(root, about)
    return False
