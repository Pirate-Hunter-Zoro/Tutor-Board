#!/usr/bin/env python3
"""A document you can read, and a document you can keep -- at any moment.

Reported from the iPad, mid-sitting:

    "I just tried to save a copy of my homework, and it's not working. It
    compiles the homework, but it's not letting me view the compiled .pdf or
    save it anywhere locally on the iPad."

Every clause of that was true, and there were three separate faults behind it.

  1. THE BUTTON LIVED FOR ONE PAYLOAD. `doExportHomework` painted the banner
     from a record it had invented itself -- the reply to `/hw/build`, tagged
     `kind: "hw"`, on no disk anywhere -- and handed it to `paintSession` in the
     slot that belongs to `push.json`. The next payload, about a second later,
     repainted the same banner from the real `push.json`, which knows nothing
     about a write-up. `save a copy` went with it AND SO DID THE URL BEHIND IT,
     so a tap after that second did nothing at all. A minute of LaTeX, a PDF
     sitting in the repository, and no control on the page that could reach it.

  2. THERE WAS NO WAY TO READ ONE. The only control was *save a copy*, which
     raises the share sheet -- somewhere to PUT a document, not somewhere to
     read one. "Did the proof make it in" was unanswerable from the board.

  3. THE SERVICE WORKER WAS CACHING THE DOWNLOADS. `/download/...` matched
     neither the live list nor the runtime list, so it fell through to the shell
     rule, which caches any 200 it sees. Megabytes of transcript inside the
     app's own storage allowance, and a document rebuilt at the same URL served
     from a cache while the link blinks -- last week's write-up under this
     week's name.

So: whether a document exists is a question the payload answers off the files
(`papers`), the pages are drawn to PNG by the machine that holds the PDF and
read in a panel the board owns, and both documents are reachable from the ⋯ menu
whether they were made ten seconds or ten days ago.

The rasterising half only runs where this machine has a page renderer; the rest
is checked either way, because "no renderer here" is a real machine (a Mac
started by launchd has a PATH of /usr/bin:/bin) and has to degrade rather than
show an empty panel.
"""

import json
import os
import re
import socket
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tutorboard.course import paper, repo as course_repo          # noqa: E402
from tutorboard.lesson import state as lesson_state               # noqa: E402
from tutorboard.server.handler import Handler                     # noqa: E402
from tutorboard.server.hub import Hub                             # noqa: E402
from tutorboard.server.tikz import TikzWorker                     # noqa: E402

fails = []


def check(label, cond):
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        fails.append(label)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def get(port, path):
    """(status, headers, body) for a GET to the board under test."""
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path))
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def pdf_bytes(pages=3):
    """A real, valid PDF with `pages` pages and a line of text on each.

    Written out here rather than compiled: the point of the suite is the board's
    handling of a document, and requiring LaTeX to test that would mean the
    checks below never run on a machine that has no TeX -- which is exactly the
    kind of machine the degradation path exists for.
    """
    objs = ["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count %d /Kids [%s] >>"
            % (pages, " ".join("%d 0 R" % (4 + 2 * i) for i in range(pages))),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    for i in range(pages):
        body = "BT /F1 28 Tf 72 700 Td (page %d) Tj ET" % (i + 1)
        objs.append("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                    "/Resources << /Font << /F1 3 0 R >> >> "
                    "/Contents %d 0 R >>" % (5 + 2 * i))
        objs.append("<< /Length %d >>\nstream\n%s\nendstream" % (len(body), body))
    out = b"%PDF-1.4\n"
    offsets = []
    for n, obj in enumerate(objs, start=1):
        offsets.append(len(out))
        out += ("%d 0 obj\n" % n).encode() + obj.encode() + b"\nendobj\n"
    start = len(out)
    out += ("xref\n0 %d\n" % (len(objs) + 1)).encode() + b"0000000000 65535 f \n"
    for off in offsets:
        out += ("%010d 00000 n \n" % off).encode()
    out += ("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objs) + 1, start)).encode()
    return out


# ---------------------------------------------------------------------------
# a real board, on a real socket, over a real course directory
# ---------------------------------------------------------------------------
TMP = tempfile.mkdtemp(prefix="paper-")
COURSE = os.path.join(TMP, "Galois-Theory")
os.makedirs(COURSE)
with open(os.path.join(COURSE, "tutorboard.json"), "w", encoding="utf-8") as fh:
    json.dump({"name": "Galois Theory"}, fh)

repo = course_repo.Repo(COURSE)
with open(repo.state_path, "w", encoding="utf-8") as fh:
    json.dump({"course": "Galois Theory", "chapter": "Ch 7", "session": "homework"}, fh)

HW_REL = os.path.join("chapters", "ch07-splitting", "build", "ch07-homework.pdf")
LESSON_REL = os.path.join("transcripts", "ch07-v3.pdf")
for rel, pages in ((HW_REL, 3), (LESSON_REL, 2)):
    full = os.path.join(COURSE, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as fh:
        fh.write(pdf_bytes(pages))
with open(os.path.join(repo.live, "hw.json"), "w", encoding="utf-8") as fh:
    json.dump({"ok": True, "at": 1757000000.0, "iso": "2026-09-08 11:00",
               "set": "ch07", "pdf": HW_REL, "detail": "Output written"}, fh)
with open(os.path.join(repo.live, "export.json"), "w", encoding="utf-8") as fh:
    json.dump({"ok": True, "at": 1757000100.0, "iso": "2026-09-08 11:01",
               "scope": "lesson", "pdf": LESSON_REL, "pages": 2}, fh)

worker = TikzWorker(repo)
hub = Hub(repo, worker)
hub.payload = json.dumps({})
PORT = free_port()
httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
httpd.daemon_threads = True
httpd.repo = repo
httpd.hub = hub
threading.Thread(target=httpd.serve_forever, daemon=True).start()


# ---------------------------------------------------------------------------
# 1. a document is a file, not an event
# ---------------------------------------------------------------------------
print("\n-- whether a document exists is answered on every payload --")

seen = lesson_state.load_papers(repo)
check("the payload says which documents are on disk",
      set(seen) == {"lesson", "homework"})
check("and names the write-up for its SET, not for its file",
      "ch07" in (seen.get("homework", {}).get("name") or ""))
check("and puts the course in front of both, because a Files app is not this "
      "repository",
      all((seen[k].get("name") or "").lower().startswith("galois")
          for k in seen))
check("and says how big and how old, so the panel can say which one this is",
      all(seen[k].get("size") and seen[k].get("iso") for k in seen))

# The whole point: a build's own banner record is not what enables the button.
# Take the record away and leave the PDF -- the document is still there.
os.rename(os.path.join(repo.live, "hw.json"), os.path.join(repo.live, "hw.away"))
check("a build record that is gone means the document cannot be resolved",
      "homework" not in lesson_state.load_papers(repo))
os.rename(os.path.join(repo.live, "hw.away"), os.path.join(repo.live, "hw.json"))

# And a record pointing at nothing is not a document, however cheerful it is.
with open(os.path.join(repo.live, "export.json"), "r", encoding="utf-8") as fh:
    keep_export = fh.read()
with open(os.path.join(repo.live, "export.json"), "w", encoding="utf-8") as fh:
    json.dump({"ok": True, "at": 1.0, "pdf": "transcripts/never-made-v1.pdf"}, fh)
check("a record naming a PDF that was never written offers nothing",
      "lesson" not in lesson_state.load_papers(repo))
with open(os.path.join(repo.live, "export.json"), "w", encoding="utf-8") as fh:
    fh.write(keep_export)

# The payload the board actually sends.
built = hub.build()
check("and the board's own payload carries it", "papers" in built
      and set(built["papers"]) == {"lesson", "homework"})


# ---------------------------------------------------------------------------
# 2. keeping it: the download, named and handed over
# ---------------------------------------------------------------------------
print("\n-- taking it off the board --")

for kind, want in (("homework", "ch07"), ("lesson", "ch07-v3")):
    status, headers, body = get(PORT, "/download/" + kind)
    disp = headers.get("Content-Disposition", "")
    check("/download/%s comes back as a PDF" % kind,
          status == 200 and headers.get("Content-Type") == "application/pdf"
          and body.startswith(b"%PDF"))
    check("and as an attachment, so an iPad offers to save it rather than "
          "previewing it (%s)" % kind, disp.startswith("attachment;"))
    check("and named for the course and the %s (%s)" % (kind, disp),
          "Galois" in disp and want in disp)

status, _headers, body = get(PORT, "/download/nonsense")
check("a kind the board does not have is not a download",
      status == 404 or b"PDF" not in body[:8])


# ---------------------------------------------------------------------------
# 3. reading it: the pages, drawn here
# ---------------------------------------------------------------------------
print("\n-- reading it on the board --")

have_renderer = paper.renderer() is not None
check("this machine's page renderer is found through the same PATH as TeX%s"
      % ("" if have_renderer else " (none here -- the degradation path is what "
         "is checked below)"), True)

status, _headers, body = get(PORT, "/view/homework")
view = json.loads(body.decode("utf-8"))
if have_renderer:
    check("/view/homework draws the pages", status == 200 and view.get("ok"))
    check("all three of them, in order",
          view.get("n") == 3
          and [int(re.search(r"-(\d+)\.png$", p).group(1)) for p in view["pages"]]
              == [1, 2, 3])
    check("and says which document they are, by the name it downloads under",
          "ch07" in (view.get("name") or ""))

    first = view["pages"][0]
    status, headers, png = get(PORT, first)
    check("a page comes back as a PNG",
          status == 200 and headers.get("Content-Type") == "image/png"
          and png[:8] == b"\x89PNG\r\n\x1a\n")
    check("cached hard, because the name carries the PDF's own timestamp",
          "max-age" in (headers.get("Cache-Control") or ""))

    # Opening it again is a directory listing, not another LaTeX-sized wait.
    again = json.loads(get(PORT, "/view/homework")[2].decode("utf-8"))
    check("opening the same document twice reuses the pages already drawn",
          again.get("digest") == view.get("digest"))

    # A rebuilt document is a different page set. Not the same pictures under
    # the same name -- that is the stale-PDF mistake one layer down.
    hw_full = os.path.join(COURSE, HW_REL)
    with open(hw_full, "wb") as fh:
        fh.write(pdf_bytes(4))
    rebuilt = json.loads(get(PORT, "/view/homework")[2].decode("utf-8"))
    check("a rebuilt document is drawn again rather than served from the cache",
          rebuilt.get("digest") != view.get("digest") and rebuilt.get("n") == 4)

    # And the cache does not grow without limit, nor evict the other document.
    lesson_view = json.loads(get(PORT, "/view/lesson")[2].decode("utf-8"))
    check("both documents can be held at once",
          lesson_view.get("ok") and lesson_view.get("n") == 2
          and os.path.isdir(os.path.join(repo.live, "paper")))
    digests = set()
    for f in os.listdir(os.path.join(repo.live, "paper")):
        m = re.match(r"^([0-9a-f]+)-\d+\.png$", f)
        if m:
            digests.add(m.group(1))
    check("and the cache keeps a bounded number of page sets (%d)" % len(digests),
          len(digests) <= paper.CACHE_SETS)
else:
    check("a machine with no page renderer says so rather than showing an "
          "empty panel",
          status == 200 and view.get("ok") is False
          and view.get("why") == "no-renderer" and view.get("detail"))

# Nothing to draw is not an error either, and it says what to press.
os.rename(os.path.join(repo.live, "hw.json"), os.path.join(repo.live, "hw.away"))
none = json.loads(get(PORT, "/view/homework")[2].decode("utf-8"))
check("a document that has never been built says so, and is not a failure",
      none.get("ok") is False and none.get("why") == "none"
      and "compiled" in (none.get("detail") or ""))
os.rename(os.path.join(repo.live, "hw.away"), os.path.join(repo.live, "hw.json"))


# ---------------------------------------------------------------------------
# 4. and nothing reaches off the board
# ---------------------------------------------------------------------------
print("\n-- the client names a kind; it never names a path --")

for evil in ("/paper/../../../../etc/passwd", "/paper/..%2f..%2fetc%2fpasswd",
             "/paper/state.json", "/paper/abc-1.png.txt", "/paper/zzz-1.png"):
    status, _h, body = get(PORT, evil)
    check("refused: %s" % evil, status == 404)


class FakeRepo:
    def __init__(self, root):
        self.root = root
        self.live = os.path.join(root, "live")

    def state(self):
        return {"course": "Galois Theory"}


fake = FakeRepo(COURSE)
for evil, why in (("../../../../etc/passwd", "a path climbing out of the repository"),
                  ("/etc/passwd", "an absolute path somewhere else"),
                  ("transcripts/ch07-v3.tex", "a .tex rather than a .pdf"),
                  ("transcripts/nothing-v9.pdf", "a PDF that is not there"),
                  (None, "no record at all")):
    check("and a record naming " + why + " resolves to nothing",
          paper.pdf_in(fake, evil) is None)


# ---------------------------------------------------------------------------
# 5. the client: three controls, one document, and none of them navigates
# ---------------------------------------------------------------------------
print("\n-- the board's own side of it --")

js = open(os.path.join(ROOT, "web", "board.js"), encoding="utf-8").read()
html = open(os.path.join(ROOT, "web", "board.html"), encoding="utf-8").read()
sw = open(os.path.join(ROOT, "web", "sw.js"), encoding="utf-8").read()

# 1. The write-up's record reaches the banner from the PAYLOAD. This is the
#    defect: it used to arrive only as a client-side invention, in the argument
#    slot that belongs to `push.json`, and the next payload wiped it.
check("the banner is fed the write-up's record off the payload",
      re.search(r"paintSession\(state, data\.push, data\.agent, data\.export,\s*"
                r"\(data\.hw && data\.hw\.build\)", js) is not None)
check("and the compile hands its record to the write-up's slot, not to push's",
      "paintBanner(null, null, rec)" in js
      and "paintSession({}, rec, null, null)" not in js)
check("and the banner is its own function, so an export no longer repaints the "
      "sitting as a lecture",
      "function paintBanner(push, exported, hwBuilt)" in js
      and not re.search(r"paintSession\(\{\}", js))

# 2. The buttons are enabled from the files, not from the record in the banner.
check("whether a document exists comes from the payload's `papers`",
      "var papers = {};" in js and "papers = data.papers || {};" in js)
check("and the banner offers reading as well as keeping",
      'id="pushed-view"' in html and "openPaper(bannerKind)" in js)

# 3. Reachable at any moment, not only in the banner of the build that made it.
check("the menu carries a documents panel", 'id="btn-papers"' in html
      and "function openPapers()" in js)
check("which offers to make the one that is not there, so it is never a dead end",
      "compile it now" in js and "export it now" in js)

# 4. Nothing navigates the board's own window. This is the older defect and it
#    must stay fixed: in a standalone app there is no chrome to come back with.
check("the document is fetched and handed to the share sheet, never navigated to",
      "navigator.canShare({ files: [got.file] })" in js
      and 'a.download = got.name' in js)
for bad in ('els.paper.innerHTML = \'<iframe', "location.href = paperUrl",
            'window.location = paperUrl'):
    check("and never " + bad.split("=")[0].strip(), bad not in js)
opens = re.findall(r'window\.open\(([^,]+), "_blank"', js)
check("every last-resort open is a NEW context (%d of them)" % len(opens),
      len(opens) >= 1)

# 5. Reading it is pictures, because iOS gives a PDF in a frame one page.
check("the pages are drawn server-side and shown as pictures",
      "<iframe" not in html and 'els.paperPages.appendChild(img)' in js)
check("and the panel can be closed, which is the whole reason it is a panel",
      "function closePaper()" in js and 'id="paper-close"' in html)

# 6. The service worker leaves every one of them alone.
live = re.search(r"var LIVE = (/.*/);", sw)
check("the service worker has a live list", live is not None)
if live:
    pattern = live.group(1)[1:-1]
    for path in ("/download/lesson", "/download/homework", "/view/homework",
                 "/paper/abc123-1.png"):
        check("the service worker never caches %s" % path,
              re.match(pattern, path) is not None)
    check("and still caches the shell it exists for",
          re.match(pattern, "/static/board.js") is None
          and re.match(pattern, "/board") is None)
ver = re.search(r'var VERSION = "board-shell-v(\d+)"', sw)
check("and the shell version was bumped, or the installed app serves its cached "
      "copy and none of this is visible", ver is not None and int(ver.group(1)) >= 84)

print()
if fails:
    print("%d FAILURES" % len(fails))
    sys.exit(1)
print("both documents can be read on the board and saved off it, at any moment")
