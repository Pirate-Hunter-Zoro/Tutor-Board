"""What is on the writing surface, and what was handed in from it.
"""

import json
import os
import re


def read_slate_pages(repo):
    """Full stroke data, so the slate resumes where it left off on any device."""
    pages = []
    try:
        names = sorted(n for n in os.listdir(repo.slate) if re.match(r"^page-\d+\.json$", n))
    except OSError:
        names = []
    for name in names:
        try:
            with open(os.path.join(repo.slate, name), "r", encoding="utf-8") as fh:
                pages.append(json.load(fh))
        except (OSError, ValueError):
            pass
    return pages


def load_slate(repo, limit=40):
    """Saved slate pages, newest last. Only the metadata -- the strokes stay on
    disk until the slate itself asks for them."""
    out = []
    try:
        names = sorted(n for n in os.listdir(repo.slate) if re.match(r"^page-\d+\.png$", n))
    except OSError:
        names = []
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
