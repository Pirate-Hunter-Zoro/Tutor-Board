#!/usr/bin/env python3
"""A lesson becomes a document, and the document is both halves of it.

Asked for from the device: "export the ENTIRE tutoring conversation as a .pdf --
the whole tutor/user conversation as one master scrolled .pdf that I can show to
my professor", tracked in git, and numbered by version rather than stamped with
the time, because a folder of timestamps is an eyesore that still does not say
which one is the latest.

`board export` used to write the tutor's cards alone into a directory git
ignores, named with the second it happened. Every clause of that is what this
suite exists to keep fixed.

The PDF itself is only compiled when this machine has LaTeX; everything else is
checked either way, because the failure this catches most often is a preamble
that only breaks against a real course's own macros.
"""

import base64
import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.dirname(HERE)
sys.path.insert(0, TOOL)

from tutorboard import tex
from tutorboard.course import document              # noqa: E402

fails = []


def ok(msg):
    print("ok   " + msg)


def bad(msg):
    fails.append(msg)
    print("FAIL " + msg)


# A real 1x1 PNG, so `includegraphics` has something that actually decodes.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM"
    "IQAAAABJRU5ErkJggg==")


def card(folder, idx, kind, title, body):
    with open(os.path.join(folder, "%04d-%s.md" % (idx, kind)), "w",
              encoding="utf-8") as fh:
        fh.write("---\nkind: %s\ntitle: %s\n---\n\n%s\n" % (kind, title, body))


def turn(path, rec):
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")


def course(root):
    """A course with one filed lesson and one still open, both with answers."""
    live = os.path.join(root, "live")
    for d in ("cards", "answers", "archive"):
        os.makedirs(os.path.join(live, d), exist_ok=True)
    with open(os.path.join(live, "state.json"), "w", encoding="utf-8") as fh:
        json.dump({"course": "Galois Theory", "chapter": "Ch 3 -- Splitting fields",
                   "session": "lecture", "opened": "2026-09-01 18:00"}, fh)

    # The lesson still open: a question, two attempts at it, and a reply.
    card(os.path.join(live, "cards"), 1, "question", "Exercise 3.2",
         "Show that $\\QQ(\\sqrt[3]{2})$ is not normal over $\\QQ$.\n\n"
         "Watch the save button (⤓) and mind that α ≤ β.")
    card(os.path.join(live, "cards"), 2, "note", "nearly",
         "The third line does not follow -- say why the other root is missing.")
    card(os.path.join(live, "cards"), 3, "correct", "that is the proof", "Good.")
    for rev in (1, 2):
        with open(os.path.join(live, "answers", "t0001-r%d.png" % rev), "wb") as fh:
            fh.write(PNG)
        turn(os.path.join(live, "turns.jsonl"),
             {"id": "t0001", "rev": rev, "kind": "ink", "answers": "0001",
              "t": 1788000000 + rev * 100, "iso": "2026-09-01 18:0%d:00" % rev,
              "from": "student", "page": rev, "strokes": 12,
              "png": "/answers/t0001-r%d.png" % rev,
              "ink": "/answers/t0001-r%d.json" % rev})
    turn(os.path.join(live, "turns.jsonl"),
         {"id": "t0002", "rev": 1, "kind": "text", "answers": "0001",
          "t": 1788000350, "iso": "2026-09-01 18:05:50", "from": "student",
          "text": "I think the other root is complex.", "signal": "done"})

    # And one that was filed earlier.
    filed = os.path.join(live, "archive", "20260826-193000-ch-2-fields")
    os.makedirs(os.path.join(filed, "answers"), exist_ok=True)
    with open(os.path.join(filed, "state.json"), "w", encoding="utf-8") as fh:
        json.dump({"course": "Galois Theory", "chapter": "Ch 2 -- Fields",
                   "session": "homework", "opened": "2026-08-26 19:00"}, fh)
    card(filed, 1, "question", "Exercise 2.1", "Compute $[\\QQ(\\sqrt2):\\QQ]$.")
    with open(os.path.join(filed, "answers", "t0001-r1.png"), "wb") as fh:
        fh.write(PNG)
    turn(os.path.join(filed, "turns.jsonl"),
         {"id": "t0001", "rev": 1, "kind": "ink", "answers": "0001",
          "t": 1787900000, "iso": "2026-08-26 19:20:00", "from": "student",
          "page": 1, "strokes": 4, "png": "/answers/t0001-r1.png",
          "ink": "/answers/t0001-r1.json"})

    subprocess.run(["git", "init", "-q", "."], cwd=root,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["git", "config", "user.email", "t@example.com"], cwd=root,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["git", "config", "user.name", "A Student"], cwd=root,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return live


def staged(root):
    p = subprocess.run(["git", "diff", "--cached", "--name-only"], cwd=root,
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    return p.stdout.decode("utf-8", "replace").split()


def main():
    tmp = tempfile.mkdtemp(prefix="tb-doc-")
    root = os.path.join(tmp, "Galois-Theory")
    os.makedirs(root)
    course(root)

    # ---------------------------------------------------------- both halves
    rec = document.build(root, scope="lesson", make_pdf=False)
    tex_src = open(os.path.join(root, rec["tex"]), encoding="utf-8").read()

    if "Exercise 3.2" in tex_src and "nearly" in tex_src:
        ok("the tutor's cards are in the document")
    else:
        bad("the tutor's cards are missing from the export")

    if tex_src.count("includegraphics") == 2:
        ok("and so is every page the student handed in, one picture each")
    else:
        bad("the student's own working is not in the document (%d pictures) -- "
            "which is a record of half a conversation"
            % tex_src.count("includegraphics"))

    if "attempt 1 of 3" in tex_src and "attempt 2 of 3" in tex_src:
        ok("every revision is kept, and says which attempt it is")
    else:
        bad("the attempts are collapsed or unlabelled, so the document does not "
            "show the work happening")

    if "I think the other root is complex." in tex_src:
        ok("a typed answer is in it too")
    else:
        bad("typed answers are dropped from the export")

    if "live/answers/t0001-r1.png" in tex_src:
        ok("the pictures are named relative to the repository, so the .tex "
           "still builds on another machine")
    else:
        bad("the export names images by an absolute path")

    # Reading order: the answers sit under the question they answer, above the
    # card that replies to them.
    q, a, reply = (tex_src.find("Exercise 3.2"), tex_src.find("You wrote"),
                   tex_src.find("nearly"))
    if -1 not in (q, a, reply) and q < a < reply:
        ok("and it reads in the order it happened: question, working, reply")
    else:
        bad("the conversation is out of order (%d, %d, %d)" % (q, a, reply))

    # ------------------------------------------------------------- the name
    if rec["name"] == "ch-3-splitting-fields-v1":
        ok("the first export of a lesson is v1")
    else:
        bad("the export is not named for its lesson and version: " + rec["name"])

    two = document.build(root, scope="lesson", make_pdf=False)
    three = document.build(root, scope="lesson", make_pdf=False)
    if (two["version"], three["version"]) == (2, 3):
        ok("and exporting it again counts up, rather than overwriting it")
    else:
        bad("versions do not count up: %r then %r" % (two["version"], three["version"]))

    import re
    if not re.search(r"\d{6,}", three["name"]):
        ok("with no timestamp in the name, which was the whole complaint")
    else:
        bad("the name is stamped with the time: " + three["name"])

    # --------------------------------------------------------- tracked in git
    files = staged(root)
    if any(f.endswith("ch-3-splitting-fields-v3.tex") for f in files):
        ok("an export is staged in git, so the next save carries it")
    else:
        bad("the export is not tracked by git at all: %r" % files)

    if rec["tex"].startswith("transcripts/"):
        ok("and it goes somewhere git can see -- not into live/, which is ignored")
    else:
        bad("the export lands in " + rec["tex"])

    # ------------------------------------------------------- the whole course
    every = document.build(root, scope="all", make_pdf=False)
    alltex = open(os.path.join(root, every["tex"]), encoding="utf-8").read()
    if "Exercise 2.1" in alltex and "Exercise 3.2" in alltex:
        ok("the whole course exports as one document, filed lessons and all")
    else:
        bad("the master document is missing a lesson")
    if "\\tableofcontents" in alltex and alltex.count("\\section{") == 2:
        ok("with a contents page and a section per sitting")
    else:
        bad("the master document has no way to navigate it")
    if "Ch 2 -- Fields -- homework (2026-08-26 19:30)" in alltex \
            and "(in progress)" in alltex:
        ok("each sitting named by when it was filed, and the open one saying so")
    else:
        bad("two sittings on one chapter cannot be told apart in the contents")
    if every["name"] == "galois-theory-complete-v1":
        ok("and it is numbered on its own, not muddled in with the lessons")
    else:
        bad("the master document is called " + every["name"])

    # ------------------------------------------------------------- Unicode
    if "⤓" not in tex_src and "α" not in tex_src and "\\alpha" in tex_src:
        ok("characters pdflatex cannot read are mapped or dropped, never left "
           "in to kill the build")
    else:
        bad("raw Unicode reaches LaTeX, which is a fatal error and not a warning")

    # ------------------------------------------------------- and it compiles
    if tex.have_tex():
        built = document.build(root, scope="lesson", make_pdf=True)
        if built.get("ok") and built.get("pdf"):
            ok("and LaTeX agrees: the document compiles")
        else:
            bad("the export does not compile: " + (built.get("detail") or "?"))
        if built.get("pdf") and not os.path.exists(
                os.path.join(root, built["pdf"].replace(".pdf", ".aux"))):
            ok("leaving no scratch files behind for git to pick up")
        else:
            bad("the build leaves .aux files in a tracked directory")
    else:
        print("skip  no LaTeX on this machine, so the compile is not checked")

    print()
    if fails:
        print("%d FAILURES" % len(fails))
        return 1
    print("a lesson exports as the whole conversation, numbered and tracked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
