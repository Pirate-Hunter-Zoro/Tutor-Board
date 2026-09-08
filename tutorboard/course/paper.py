"""The documents a board can hand over, and how to LOOK at one on the device.

Two things live here and they answer two halves of the same report, from the
iPad, about the write-up:

    "I just tried to save a copy of my homework, and it's not working. It
    compiles the homework, but it's not letting me view the compiled .pdf or
    save it anywhere locally on the iPad."

**Resolving and naming** is the saving half, and it was already written -- in
`server/routes/taking.py`, private to the one route that downloads. It is here
now because two other things need the same answer: the payload, which has to say
whether a document exists at all so the controls for it can be offered at any
moment rather than only in the banner of the build that made it, and the viewer
below.

**Rasterising** is the viewing half, and it did not exist. There was no way to
look at the PDF from the board -- the only control was *save a copy*, which
raises the share sheet, and a share sheet is not a document you can read. The
obvious answer, handing the PDF to an `<iframe>`, is the one that does not work:
iOS renders a PDF in a frame as a single unscrollable first page, and navigating
to it in a standalone web app is the trap `web/board.js` was already written to
avoid -- no chrome, no back button, nothing on the glass that returns to the
lesson.

So the pages are turned into PNGs HERE, by the machine that has the PDF, and the
board shows them the way it already shows every other picture: in a viewer this
page owns and can close. That works on any tablet, needs nothing of the browser,
and costs one `pdftoppm` per document rather than per open, because the pages are
cached against the PDF's own modification time.

Nothing here is discarded when it fails. A machine with no rasteriser on it is a
real machine -- a Mac started by launchd has a PATH of `/usr/bin:/bin` and
nothing else -- and it says so, so the board can offer the copy instead of
showing an empty panel.
"""

import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time

from .. import tex


# The two documents. A KIND is what the client names; a path is never one.
# `export.json` is written by both exports -- the typeset transcript and the
# photograph of the glass -- and `hw.json` by `board hw build`, so there is one
# record per document and this is the whole of the mapping.
KINDS = ("lesson", "homework")
_RECORD = {"lesson": "export.json", "homework": "hw.json"}

# What a page comes out as. 1240px is a little over an iPad Pro's own width at
# 2x for the reading column, which is the width the pages are actually looked
# at; going wider costs bytes on a tailnet link and buys nothing legible.
PAGE_WIDTH = 1240

# A whole-course transcript can be a hundred pages and a `--all` export of a
# long course more. Rasterising every one of them is tens of megabytes onto a
# compute node's disk and onto the tablet's, so it stops and says how many it
# stopped at -- a truncated document that says so is readable; one that quietly
# ends at page 40 is a document somebody hands to a professor.
MAX_PAGES = 160

# How many rendered page sets are kept. Both documents share the cache, and a
# rebuilt write-up is a new set rather than an overwritten one, so this is
# "the two documents and a couple of versions of each" and not a guess.
CACHE_SETS = 4


def record(repo, kind):
    """The build record for one kind of document, or None."""
    name = _RECORD.get(kind)
    if not name:
        return None
    try:
        with open(os.path.join(repo.live, name), "r", encoding="utf-8") as fh:
            got = json.load(fh)
    except (OSError, ValueError):
        return None
    return got if isinstance(got, dict) else None


def slug(text):
    text = re.sub(r"[^A-Za-z0-9]+", "-", (text or "").strip()).strip("-")
    return text or "lesson"


def pdf_in(repo, rel):
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


def named(repo, stem):
    """What the file should be called once it is off the board.

    The course goes in front, because in a Files app or an inbox this sits
    beside everything else a person owns and `ch07-homework.pdf` is not enough
    to tell whose it is or what it is from.
    """
    st = repo.state() or {}
    course = slug(st.get("course") or os.path.basename(repo.root))
    stem = slug(stem)
    return stem if stem.lower().startswith(course.lower()) else course + "-" + stem


def resolve(repo, kind):
    """The PDF for one kind of document and the name it leaves under.

    Returns `(path, filename)`, or `(None, None)` when there is no document --
    which is a perfectly ordinary state and not an error: nobody has exported
    this lesson yet, or the write-up has never compiled.
    """
    rec = record(repo, kind)
    target = pdf_in(repo, (rec or {}).get("pdf"))
    if not target:
        return None, None
    if kind == "homework":
        # The SET's name rather than the file's: a course numbers its homework
        # `ch07-homework.tex` in one place and `hw04.tex` in another, and the
        # set is what a person calls it either way.
        stem = (rec or {}).get("set") or os.path.splitext(os.path.basename(target))[0]
    else:
        stem = os.path.splitext(os.path.basename(target))[0]
    return target, named(repo, stem) + ".pdf"


def describe(repo):
    """What can be taken off this board right now, keyed by kind.

    This is why the module exists rather than the download route keeping its
    helpers to itself. The controls for a document used to live in the banner of
    the build that produced it, and that banner is replaced by the next payload
    -- so the write-up somebody had just compiled became unreachable about a
    second after it appeared. A document is not an event. It is a file, and
    whether it is there is a question with an answer at every moment.

    Four `stat` calls behind a payload the board already builds on every change.
    """
    out = {}
    for kind in KINDS:
        target, filename = resolve(repo, kind)
        if not target:
            continue
        rec = record(repo, kind) or {}
        try:
            at = os.path.getmtime(target)
        except OSError:
            at = rec.get("at") or 0
        out[kind] = {
            "name": filename,
            "at": at,
            "size": _size(target),
            "iso": time.strftime("%Y-%m-%d %H:%M", time.localtime(at)),
            "set": rec.get("set") if kind == "homework" else None,
            "scope": rec.get("scope") if kind == "lesson" else None,
        }
    return out


def _size(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


# ---------------------------------------------------------------------------
# turning a PDF into something an iPad can read in place
# ---------------------------------------------------------------------------
def raster_env():
    """The environment a page renderer is looked for in.

    `tex.tex_env` already knows every place a TeX lives on either machine, and
    on a Mac that is where Ghostscript lands too. What it does not cover is
    poppler, which is where `pdftoppm` comes from: Homebrew on Apple silicon,
    `/usr/local/bin` on Intel and for MacTeX's own Ghostscript, MacPorts, and a
    Linux node's `/usr/bin`. A board started by launchd or detached by
    `board start` has a PATH of `/usr/bin:/bin` and nothing more, so none of
    these can be assumed to be on it already -- which is the same reason
    `hw_build` stopped trusting PATH for `pdflatex`.
    """
    env = tex.tex_env()
    extra = [d for d in ("/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin",
                         "/usr/bin", "/bin")
             if os.path.isdir(d)]
    env["PATH"] = os.pathsep.join(extra + [env.get("PATH", "")])
    return env


def renderer(env=None):
    """Which page renderer this machine has, as (name, path), or None.

    Order is quality first and availability second. poppler's two renderers
    scale to a width, which is what is wanted -- a fixed resolution makes A4 and
    US Letter come out different sizes. Ghostscript cannot, so it gets a DPI
    that lands close, and it is here because it is what a Mac with MacTeX on it
    has when it has no poppler.
    """
    env = env or raster_env()
    path = env.get("PATH", "")
    for name in ("pdftoppm", "pdftocairo", "gs"):
        found = shutil.which(name, path=path)
        if found:
            return name, found
    return None


def _digest(pdf_path, width):
    """A name for this exact document at this exact width.

    The modification time is in it, so a rebuilt write-up is a different page
    set rather than a stale one served out of a cache -- which is the same
    mistake as an iPad showing last week's PDF, made one layer down.
    """
    try:
        stamp = os.stat(pdf_path)
        key = "%s|%d|%d|%d" % (os.path.realpath(pdf_path), stamp.st_mtime_ns,
                               stamp.st_size, width)
    except OSError:
        key = "%s|%d" % (os.path.realpath(pdf_path), width)
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def cache_dir(repo):
    """Where rendered pages live, and it ignores itself.

    A course repository's own `.gitignore` is `live/*` with the transcript
    allowlisted back in, so this is ignored there. But the README's minimum for
    a course is "nothing at all" -- make a directory, run `board start` -- and in
    one of those, `git add -A` on the way out of a lesson would commit a few
    megabytes of rendered page images and push them. So the directory carries
    the rule itself, which holds whatever the repository around it says.
    """
    d = os.path.join(repo.live, "paper")
    os.makedirs(d, exist_ok=True)
    guard = os.path.join(d, ".gitignore")
    if not os.path.exists(guard):
        try:
            with open(guard, "w", encoding="utf-8") as fh:
                fh.write("# rendered pages: a cache of the PDFs beside them\n*\n")
        except OSError:
            pass
    return d


def cached(repo, digest):
    """The pages already rendered for this digest, in page order."""
    found = sorted(glob.glob(os.path.join(cache_dir(repo), digest + "-*.png")),
                   key=_page_number)
    return [os.path.basename(p) for p in found]


def _page_number(path):
    m = re.search(r"-(\d+)\.png$", path)
    return int(m.group(1)) if m else 0


def pages(repo, kind, width=PAGE_WIDTH):
    """Every page of one document, as PNGs the board can show in place.

    Cached against the PDF's own modification time, so opening the same document
    twice costs one directory listing. A rebuild changes the digest and renders
    again.
    """
    target, filename = resolve(repo, kind)
    if not target:
        return {"ok": False, "why": "none",
                "detail": ("There is no %s PDF yet."
                           % ("compiled write-up" if kind == "homework" else "exported lesson"))}

    width = max(400, min(2200, int(width or PAGE_WIDTH)))
    digest = _digest(target, width)
    have = cached(repo, digest)
    if have:
        return _manifest(kind, filename, digest, have, target)

    # One render per document at a time. A double-tap on `read it` is two
    # requests, and this server is threaded -- two `pdftoppm` runs writing the
    # same page files is a document read while it is being written under the
    # reader. The second caller comes out of the cache the first one filled.
    with _lock_for(digest):
        have = cached(repo, digest)
        if have:
            return _manifest(kind, filename, digest, have, target)
        return _draw(repo, kind, target, filename, digest, width)


_LOCKS = {}
_LOCKS_GUARD = threading.Lock()


def _lock_for(digest):
    with _LOCKS_GUARD:
        # Bounded: a board that has looked at fifty versions of a document does
        # not need fifty locks kept for the rest of its life.
        if len(_LOCKS) > 32:
            _LOCKS.clear()
        return _LOCKS.setdefault(digest, threading.Lock())


def _draw(repo, kind, target, filename, digest, width):
    env = raster_env()
    tool = renderer(env)
    if not tool:
        return {"ok": False, "why": "no-renderer", "name": filename,
                "detail": ("This machine has no page renderer on it -- pdftoppm, "
                           "pdftocairo and gs are all absent -- so the pages "
                           "cannot be drawn here. The document itself is fine: "
                           "save a copy and read it in Files.")}

    prefix = os.path.join(cache_dir(repo), digest)
    try:
        code, out = _render(tool, target, prefix, width, env)
    except subprocess.TimeoutExpired:
        # Five minutes on one document. Say so rather than letting it reach the
        # handler as a 500: the board would then paint "the board did not
        # answer", which points the reader at the network for a fault that is a
        # document too large to draw.
        _sweep(repo, digest)
        return {"ok": False, "why": "failed", "name": filename,
                "detail": ("%s took longer than five minutes on this document "
                           "and was stopped. Save a copy and read it in Files."
                           % tool[0])}
    except OSError as exc:
        code, out = 1, str(exc)
    made = cached(repo, digest)
    if not made:
        # Leave nothing half-written behind: a partial set would be served as
        # the whole document on the next open, and a document silently missing
        # its last four pages is the worst of the failures available here.
        _sweep(repo, digest)
        return {"ok": False, "why": "failed", "name": filename,
                "detail": ("%s could not draw the pages (exit %d). %s"
                           % (tool[0], code, out[-400:] or "it printed nothing.")).strip()}
    _prune(repo, digest)
    return _manifest(kind, filename, digest, made, target)


def _manifest(kind, filename, digest, files, target):
    return {
        "ok": True,
        "kind": kind,
        "name": filename,
        "digest": digest,
        "n": len(files),
        "truncated": len(files) >= MAX_PAGES,
        "pages": ["/paper/" + f for f in files],
        "size": _size(target),
    }


def _render(tool, pdf_path, prefix, width, env):
    name, _found = tool
    if name in ("pdftoppm", "pdftocairo"):
        cmd = [name, "-png",
               "-scale-to-x", str(width), "-scale-to-y", "-1",
               "-f", "1", "-l", str(MAX_PAGES), pdf_path, prefix]
    else:
        # Ghostscript names its own output and cannot scale to a width, so it
        # gets a resolution that puts A4 within a few percent of the same place.
        cmd = ["gs", "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER",
               "-sDEVICE=png16m", "-r%d" % max(72, int(width / 8.27)),
               "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4",
               "-dFirstPage=1", "-dLastPage=%d" % MAX_PAGES,
               "-sOutputFile=%s-%%d.png" % prefix, pdf_path]
    p = subprocess.run(cmd, env=env, stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       timeout=300)
    return p.returncode, p.stdout.decode("utf-8", "replace").strip()


def _sweep(repo, digest):
    for f in glob.glob(os.path.join(cache_dir(repo), digest + "-*.png")):
        try:
            os.remove(f)
        except OSError:
            pass


def _prune(repo, keep):
    """Old page sets go. A cache that only grows is a disk that fills up.

    By digest rather than by age, and several are kept: the two documents share
    this directory, so "delete everything that is not the set I just made"
    throws away the other one every time somebody looks at both.
    """
    groups = {}
    for f in glob.glob(os.path.join(cache_dir(repo), "*.png")):
        m = re.match(r"^([0-9a-f]{6,})-\d+\.png$", os.path.basename(f))
        if not m:
            continue
        try:
            groups.setdefault(m.group(1), []).append((os.path.getmtime(f), f))
        except OSError:
            pass
    newest = sorted(groups, key=lambda d: max(t for t, _ in groups[d]), reverse=True)
    for digest in newest[CACHE_SETS:]:
        if digest == keep:
            continue
        for _at, f in groups[digest]:
            try:
                os.remove(f)
            except OSError:
                pass
