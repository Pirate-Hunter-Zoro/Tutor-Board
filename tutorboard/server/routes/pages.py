"""Files: the app shell, the fonts, a compiled figure, a photograph.

Everything here is bytes off disk, and everything a person handed in is
served with the headers that stop a browser executing it.
"""

import json
import os

from . import NOT_MINE
from .. import multipart
from ... import paths


def get(h, repo, path):
    if path == "/manifest.webmanifest":
        return h.send_bytes(open(os.path.join(paths.WEB, "manifest.webmanifest"), "rb").read(),
                               "application/manifest+json")

    if path == "/sw.js":
        return h.send_file(os.path.join(paths.WEB, "sw.js"))

    if path.startswith("/static/"):
        rel = path[len("/static/"):]
        target = os.path.normpath(os.path.join(paths.WEB, rel))
        if not target.startswith(paths.WEB):
            return h.send_bytes(b"nope", "text/plain", status=403)
        return h.send_file(
            target, cache=rel.startswith("katex/") or rel.startswith("fonts/"))

    if path.startswith("/figure/"):
        digest = multipart.safe_filename(path[len("/figure/"):]).replace(".svg", "")
        return h.send_file(os.path.join(repo.tikz, digest + ".svg"), cache=True)

    if path.startswith("/uploads/"):
        name = multipart.safe_filename(path[len("/uploads/"):])
        return h.send_file(os.path.join(repo.uploads, name), untrusted=True)

    if path.startswith("/answers/"):
        name = multipart.safe_filename(path[len("/answers/"):])
        return h.send_file(os.path.join(repo.answers, name))
    return NOT_MINE
