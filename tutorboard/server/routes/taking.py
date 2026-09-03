"""Taking a document off the board and onto the device it is being read on.

Everything here already exists in the repository and is tracked in git -- that
is the archival copy and none of it changes. This is the other half, asked for
from the iPad:

    "when we save the .pdf, we should also have the option to download it
    locally on the iPad so I can save it to files in my iCloud, get it on my
    phone, and email it to my prof, lickety split. Also, I want the ability to
    do this with the written up work too."

A repository on a compute node is not a place an iPad can reach, and neither is
a tailnet path a person can hand to a professor. A download is.

THE CLIENT NEVER NAMES A PATH. It names a KIND -- the lesson, or the written-up
homework -- and this resolves that to a file through the records the board
already keeps: `live/export.json` for a lesson, `live/hw.json` for a set. A
query parameter carrying a repo-relative path would be a directory traversal
waiting to be written, and there is nothing it would buy: there are two
documents, and the board knows where both of them are.
"""

import json
import os
import re

from . import NOT_MINE


def _record(repo, name):
    try:
        with open(os.path.join(repo.live, name), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _slug(text):
    text = re.sub(r"[^A-Za-z0-9]+", "-", (text or "").strip()).strip("-")
    return text or "lesson"


def _pdf_in(repo, rel):
    """A repo-relative path from one of our own records, resolved and checked.

    Checked even though it came from a file this board wrote: a record is on
    disk, disk is editable, and "it was ours a moment ago" is not a property
    that survives. It has to be a .pdf, it has to exist, and it has to be inside
    the repository.
    """
    if not rel or not str(rel).endswith(".pdf"):
        return None
    root = os.path.realpath(repo.root)
    target = os.path.realpath(os.path.join(root, str(rel)))
    if target != root and not target.startswith(root + os.sep):
        return None
    return target if os.path.isfile(target) else None


def _named(repo, stem):
    """What the file should be called once it is off the board.

    The course goes in front, because in a Files app or an inbox this sits
    beside everything else a person owns and `ch07-homework.pdf` is not enough
    to tell whose it is or what it is from.
    """
    st = repo.state() or {}
    course = _slug(st.get("course") or os.path.basename(repo.root))
    stem = _slug(stem)
    return stem if stem.lower().startswith(course.lower()) else course + "-" + stem


def get(h, repo, path):
    if path == "/download/lesson":
        rec = _record(repo, "export.json")
        target = _pdf_in(repo, (rec or {}).get("pdf"))
        if not target:
            return h.send_bytes(
                b"There is no exported lesson PDF yet. Export it first.",
                "text/plain", status=404)
        return h.send_file(
            target, download=_named(repo, os.path.splitext(os.path.basename(target))[0]) + ".pdf")

    if path == "/download/homework":
        rec = _record(repo, "hw.json")
        target = _pdf_in(repo, (rec or {}).get("pdf"))
        if not target:
            return h.send_bytes(
                b"There is no compiled homework PDF yet. Build it first.",
                "text/plain", status=404)
        # The SET's name rather than the file's: a course numbers its homework
        # `ch07-homework.tex` in one place and `hw04.tex` in another, and the
        # set is what a person calls it either way.
        stem = (rec or {}).get("set") or os.path.splitext(os.path.basename(target))[0]
        return h.send_file(target, download=_named(repo, stem) + ".pdf")

    return NOT_MINE
