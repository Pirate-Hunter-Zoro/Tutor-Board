#!/usr/bin/env python3
"""A chapter is its own thing, and so is its tutor.

Reported an hour into Chapter 3, in these words: "I also want a separate tutor
instance for each chapter. I just started chapter 3 and the tutor is telling me
that problems from chapter 1 are still incomplete. I don't like that."

Two things carried Chapter 1 across, and only one of them was a file:

  - `HANDOFF.md`, which is the only continuity a session has and lives at the
    root of the course. The Chapter 3 tutor read it, found a section headed
    *Left unfinished in Chapter 1*, and offered to go back for an exercise the
    student had closed.
  - the assistant's own conversation, which is long-lived on purpose -- one that
    survives being left still has the lesson in its head when you come back --
    and which no file on disk can correct.

So a handoff is stamped with the chapter it is about, parked under that chapter's
name when another one is opened, and brought back if that chapter is reopened;
and opening a chapter from the board gets a new tutor. What a chapter does NOT
get is the last chapter's unfinished business.
"""

import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

errors = []


def ok(m):
    print("ok   " + m)


def fail(m):
    errors.append(m)
    print("FAIL " + m)


def check(m, cond):
    ok(m) if cond else fail(m)


box = tempfile.mkdtemp()
os.environ["BOARD_STATE_DIR"] = box
os.environ["BOARD_NODE_NAME"] = "test-node"

from tutorboard import handoff


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def course(chapter="Ch 01 — Groups"):
    root = tempfile.mkdtemp(prefix="tb-chapter-")
    os.makedirs(os.path.join(root, "live", "cards"), exist_ok=True)
    with open(os.path.join(root, "live", "state.json"), "w", encoding="utf-8") as fh:
        json.dump({"course": "Galois Theory", "chapter": chapter,
                   "session": "lecture"}, fh)
    return root


def write_handoff(root, text):
    with open(os.path.join(root, "HANDOFF.md"), "w", encoding="utf-8") as fh:
        fh.write(text)


def board(root, *args):
    p = subprocess.run([sys.executable, os.path.join(ROOT, "bin", "board")] + list(args),
                       cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       timeout=60)
    return p.returncode, p.stdout.decode("utf-8", "replace")


# --- the stamp ---------------------------------------------------------------
print("-- a handoff says which chapter it is about --")

root = course()
write_handoff(root, "# HANDOFF\n\nLeft unfinished in Chapter 1: exercise 1.7.\n")
handoff.stamp_handoff(root, "Ch 01 — Groups")
text, about = handoff.read_handoff(root)
check("the stamp names the chapter", about == "Ch 01 — Groups")
check("and the handoff itself is untouched under it", "exercise 1.7" in text)

handoff.stamp_handoff(root, "Ch 01 — Groups")
check("stamping twice does not stack two stamps",
      handoff.read_handoff(root)[0].count("<!-- chapter:") == 1)

check("a handoff about the chapter that is open is read",
      handoff.handoff_applies(root, "Ch 01 — Groups"))

# --- and one about another chapter is not ------------------------------------
print("\n-- a chapter does not inherit the last one's unfinished business --")

check("a handoff about a chapter that has been closed is not read",
      not handoff.handoff_applies(root, "Ch 03 — Rings"))
check("and reading it is what puts it away, since the daemon that wrote it may "
      "have been writing while the next chapter was opening",
      not os.path.exists(os.path.join(root, "HANDOFF.md")))
check("parked under the chapter it belongs to",
      os.path.exists(handoff.parked_handoff(root, "Ch 01 — Groups")))

# An unstamped handoff is not evidence of anything: it predates the stamp, or a
# model wrote the file itself. A course with no chapters at all is the same case.
root2 = course(chapter="")
write_handoff(root2, "# HANDOFF\n\nwhere the project got to\n")
check("an unstamped handoff still applies, and a course with no chapters is "
      "unaffected by any of this",
      handoff.handoff_applies(root2, ""))

# --- board open ---------------------------------------------------------------
print("\n-- opening a chapter files the last one's handoff away --")

root3 = course()
write_handoff(root3, "# HANDOFF\n\nChapter 1, and 1.7 is unfinished.\n")
code, out = board(root3, "open", "Galois Theory", "Ch 03 — Rings")
check("the open succeeds", code == 0)
check("the handoff of the chapter being left is parked",
      not os.path.exists(os.path.join(root3, "HANDOFF.md"))
      and os.path.exists(handoff.parked_handoff(root3, "Ch 01 — Groups")))
check("and it says so, rather than the file merely vanishing",
      "parked" in out)

# Back to chapter 1: its own handoff comes with it.
code, out = board(root3, "open", "Galois Theory", "Ch 01 — Groups")
back = ""
if os.path.exists(os.path.join(root3, "HANDOFF.md")):
    with open(os.path.join(root3, "HANDOFF.md"), encoding="utf-8") as fh:
        back = fh.read()
check("reopening a chapter brings its own handoff back", "1.7 is unfinished" in back)

# Opening the SAME chapter again is not a chapter change and must not disturb it.
code, out = board(root3, "open", "Galois Theory", "Ch 01 — Groups")
check("reopening the same chapter leaves the handoff exactly where it is",
      os.path.exists(os.path.join(root3, "HANDOFF.md")))

# --- what the tutor is told ---------------------------------------------------
print("\n-- and the tutor is told there is none, rather than left to hunt --")

tutor = load("tutor_launcher", os.path.join(ROOT, "bin", "tutor"))
root4 = course(chapter="Ch 03 — Rings")
write_handoff(root4, "# HANDOFF\n\nChapter 1 leftovers.\n")
handoff.stamp_handoff(root4, "Ch 01 — Groups")
clause = tutor.handoff_clause(root4)
check("a tutor opening a chapter with no handoff of its own is told so",
      clause == tutor.NO_HANDOFF_CLAUSE)
check("and told not to go looking for the last chapter's",
      "not in `live/archive/`" in clause)

handoff.restore_handoff(root4, "Ch 01 — Groups")   # put it back, wrong chapter
os.replace(handoff.parked_handoff(root4, "Ch 01 — Groups")
           if os.path.exists(handoff.parked_handoff(root4, "Ch 01 — Groups"))
           else os.path.join(root4, "HANDOFF.md"),
           os.path.join(root4, "HANDOFF.md"))
handoff.stamp_handoff(root4, "Ch 03 — Rings")
check("and a tutor whose chapter DOES have one is told to read it",
      tutor.handoff_clause(root4) == tutor.HANDOFF_CLAUSE)

check("the brief has somewhere to put whichever of the two it is",
      "%(handoff)s" in tutor.BRIEF)
check("and so does the first prompt of a headless session",
      "%(handoff)s" in tutor.HEADLESS_FIRST_PROMPT)

# --- a new tutor for the new chapter ------------------------------------------
print("\n-- a chapter gets its own tutor --")

def source(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


# The route asks for it; how it is done belongs with the other ways the board
# runs its own commands.
check("opening a chapter from the board starts a fresh assistant",
      "spawn.fresh_tutor(repo.root, course)"
      in source("tutorboard", "server", "routes", "lesson.py"))
check("by stopping the old one and waiting for it, so the two never overlap",
      '"agent", "stop", course, "--wait"'
      in source("tutorboard", "server", "spawn.py"))
check("and it happens off the request, because a wrap-up is a model call and "
      "nobody taps a chapter to wait a minute for it",
      "threading.Thread(target=run, daemon=True).start()"
      in source("tutorboard", "server", "spawn.py"))

print()
if errors:
    print("%d check(s) failed" % len(errors))
    sys.exit(1)
print("a chapter is its own thing, and so is its tutor")
