"""Taking a document off the board, and reading one ON the board.

Everything here already exists in the repository and is tracked in git -- that
is the archival copy and none of it changes. This is the other half, asked for
from the iPad:

    "when we save the .pdf, we should also have the option to download it
    locally on the iPad so I can save it to files in my iCloud, get it on my
    phone, and email it to my prof, lickety split. Also, I want the ability to
    do this with the written up work too."

A repository on a compute node is not a place an iPad can reach, and neither is
a tailnet path a person can hand to a professor. A download is.

AND READING IT IS NOT THE SAME AS SAVING IT, which is the second report:

    "It compiles the homework, but it's not letting me view the compiled .pdf or
    save it anywhere locally on the iPad."

*Save a copy* raises the share sheet, and a share sheet is somewhere to put a
document rather than somewhere to read one. `/view/<kind>` is the reading half:
the pages come back as PNGs, drawn by the machine that has the PDF, because a
PDF handed to a frame on iOS is one unscrollable page and a PDF navigated to in
a standalone web app is a lesson nobody can get back to. `course/paper.py` says
the whole of why.

THE CLIENT NEVER NAMES A PATH. It names a KIND -- the lesson, or the written-up
homework -- and this resolves that to a file through the records the board
already keeps: `live/export.json` for a lesson, `live/hw.json` for a set. A
query parameter carrying a repo-relative path would be a directory traversal
waiting to be written, and there is nothing it would buy: there are two
documents, and the board knows where both of them are.
"""

import os
import re

from . import NOT_MINE
from ...course import paper


# The download route's own helpers moved into `course/paper.py`, because the
# payload and the viewer need the same answers. These names are kept because
# they are what `test/document.py` asserts against, and because a caller here
# reads better for them.
_pdf_in = paper.pdf_in
_named = paper.named


def get(h, repo, path):
    if path in ("/download/lesson", "/download/homework"):
        kind = path.rsplit("/", 1)[1]
        target, filename = paper.resolve(repo, kind)
        if not target:
            return h.send_bytes(_nothing_yet(kind), "text/plain", status=404)
        return h.send_file(target, download=filename)

    if path in ("/view/lesson", "/view/homework"):
        # The pages, rendered here. It is a POST-shaped amount of work behind a
        # GET, and deliberately: the request is idempotent, the result is a
        # cache keyed on the PDF's own modification time, and a second open of
        # the same document is a directory listing.
        kind = path.rsplit("/", 1)[1]
        return h.send_json(paper.pages(repo, kind))

    if path.startswith("/paper/"):
        name = os.path.basename(path[len("/paper/"):])
        # Content-addressed by construction -- the digest in the name carries
        # the PDF's modification time -- so it can be cached hard, and a
        # rebuilt document is a different name rather than a stale picture.
        if not re.match(r"^[0-9a-f]{6,}-\d+\.png$", name):
            return h.send_bytes(b"not found", "text/plain", status=404)
        return h.send_file(os.path.join(paper.cache_dir(repo), name), cache=True)

    return NOT_MINE


def _nothing_yet(kind):
    if kind == "homework":
        return (b"There is no compiled homework PDF yet. Build it first "
                b"(the menu: export the written-up homework).")
    return (b"There is no exported lesson PDF yet. Export it first "
            b"(the menu: export this lesson).")
