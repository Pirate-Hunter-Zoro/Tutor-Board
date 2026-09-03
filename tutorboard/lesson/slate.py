"""What is on the writing surface, and what was handed in from it.
"""

import json
import os
import re


# A PAGE IS ITS NUMBER, NOT ITS POSITION IN THIS LIST.
#
# This used to hand back the files that happen to exist, in name order, and the
# surface took that list as its pages array -- so the page at index i was
# addressed on the next save as `page-(i+1)`. That is the same page only for as
# long as the numbers on disk are gapless, and they never are: a file is written
# when a page is SAVED, so a page cut and never written on leaves no file. One
# such gap and the whole list slides down by one.
#
# Measured on a Galois sitting: `page-01`, `-06`, `-08` and `-10` had never been
# saved, so after a reload index 5 was `page-09` and the next stroke on it was
# written to `page-06`. The fingerprint is all over that directory --
# `page-13`/`page-14` byte-identical, `page-21`/`page-22`, `page-34`/`page-35`,
# `page-41`/`-42`/`-43` -- each one a page written back out under its
# neighbour's number. Nothing showed an error; the board simply came back with
# every board pointing at somebody else's sheet, which from the iPad is
# "none of the boards have my preserved written work on them".
#
# So the number is carried, and it comes from the FILENAME rather than from the
# field inside the file: the field was written by whichever client saved it and
# a client that had already slid is a client whose field is wrong too. The
# filename is what the next save will address, which makes it the only thing
# either side can agree on.
_PAGE_RE = re.compile(r"^page-(\d+)\.json$")


def page_number(name):
    m = _PAGE_RE.match(name)
    return int(m.group(1)) if m else None


def read_slate_pages(repo):
    """Full stroke data, so the slate resumes where it left off on any device.

    Each page carries its own number. Ordered BY that number, not by name: the
    format is `%02d` and pages run to 999, so `page-100` sorts before `page-99`
    and a sitting that reached three figures came back with its last hundred
    pages at the front.
    """
    pages = []
    try:
        names = [n for n in os.listdir(repo.slate) if _PAGE_RE.match(n)]
    except OSError:
        names = []
    for name in sorted(names, key=page_number):
        try:
            with open(os.path.join(repo.slate, name), "r", encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        if not isinstance(rec, dict):
            continue
        rec["page"] = page_number(name)
        pages.append(rec)
    return pages


def load_slate(repo, limit=40):
    """Saved slate pages, newest last. Only the metadata -- the strokes stay on
    disk until the slate itself asks for them."""
    out = []
    try:
        names = [n for n in os.listdir(repo.slate)
                 if re.match(r"^page-\d+\.png$", n)]
    except OSError:
        names = []
    # By number, for the same reason as above: `page-100` sorts before `page-99`.
    names.sort(key=lambda n: int(n[5:-4]))
    for name in names[-limit:]:
        path = os.path.join(repo.slate, name)
        out.append({
            "name": name,
            "page": int(name[5:-4]),
            "url": "/slate/" + name,
            "mtime": os.path.getmtime(path),
            "size": os.path.getsize(path),
        })
    return out
