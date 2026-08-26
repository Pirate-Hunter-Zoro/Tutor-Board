"""syllabus.py -- how a course orders itself.

A course that follows a book says so on disk, and it says it in one of two
places: a `chapters.tsv` at the root, or a `chapters/chNN-slug/` directory per
chapter. Both are already there because the course's own scripts need them --
nothing new is being registered, and nothing here has to be kept in step.

This exists because of a cold start that went wrong. A tutor woken on an empty
board with no handoff and no chapter label opened Galois theory at field
extensions -- Garling's chapter four -- because "the floor of the subject" and
"the start of the book" are not the same thing, and nothing on the board said
which was wanted. A course whose chapters are sitting right there should not
have to be guessed at.

Standard library only, like everything else.
"""

import glob
import os
import re

TSV = "chapters.tsv"


def _from_tsv(root):
    """The course's own table, if it keeps one. Columns: num, from, to, slug, title."""
    path = os.path.join(root, TSV)
    out = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.rstrip("\n")
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                cols = [c.strip() for c in line.split("\t") if c.strip() != ""]
                if len(cols) < 2:
                    continue
                num = cols[0]
                title = cols[-1]
                slug = cols[-2] if len(cols) >= 3 else ""
                out.append({"num": num, "slug": slug, "title": title})
    except OSError:
        return []
    return out


def _from_dirs(root):
    """Failing a table, the chapter directories themselves are the order."""
    out = []
    for path in sorted(glob.glob(os.path.join(root, "chapters", "ch*"))):
        if not os.path.isdir(path):
            continue
        name = os.path.basename(path)
        m = re.match(r"ch(\d+)[-_]?(.*)$", name)
        if not m:
            continue
        out.append({"num": m.group(1).lstrip("0") or "0",
                    "slug": name,
                    "title": m.group(2).replace("-", " ").strip()})
    return out


def chapters(root):
    """Every chapter this course has, in the order the course puts them in.

    Empty for a course that is not a book -- a code repository has no chapter
    one, and pretending otherwise would be worse than saying nothing.
    """
    return _from_tsv(root) or _from_dirs(root)


def opening(root):
    """The chapter a course with no other instruction should be opened at."""
    every = chapters(root)
    return every[0] if every else None


def label(chapter):
    """How a chapter is written on the board's own chapter line."""
    if not chapter:
        return ""
    title = (chapter.get("title") or chapter.get("slug") or "").strip()
    num = str(chapter.get("num") or "").strip()
    if num and title:
        return "Ch %s — %s" % (num, title)
    return title or ("Ch %s" % num if num else "")
