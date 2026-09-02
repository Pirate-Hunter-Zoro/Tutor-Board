"""Photographs and PDFs handed to the board.
"""

import json
import os
import urllib.parse


def load_uploads(repo, limit=40):
    out = []
    try:
        names = sorted(os.listdir(repo.uploads))
    except OSError:
        names = []
    for name in names[-limit:]:
        path = os.path.join(repo.uploads, name)
        if not os.path.isfile(path):
            continue
        out.append({
            "name": name,
            "size": os.path.getsize(path),
            "url": "/uploads/" + urllib.parse.quote(name),
            "mtime": os.path.getmtime(path),
        })
    return out


# `stance` is what the tutor is FOR in this repository, and it is a per-course
# decision because the answer genuinely differs. "teach" is the default and the
# original point of the thing: the student writes the code and withholding it is
# the teaching. "do" is for a project where that is not what is wanted -- the
# work has to get done, the tutor writes it, runs it, and the card reports what
# it did and what is next. Everything else about a turn is unchanged either way.
