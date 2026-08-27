#!/usr/bin/env python3
"""The teaching method ships with the board, not with the course.

The same document pasted into a dozen `AI_INSTRUCTIONS.md` files goes out of step
one repository at a time, and the one that drifts is the one you notice last. So
`TEACHING.md` lives here and is copied into every course's `live/` on every
`board start`, and every path that briefs an assistant points at it.

What is guarded is the delivery and the rules that a real sitting turned out to
depend on -- exercises first, a chosen few rather than all of them, one question
per turn, and a skip that is obeyed rather than argued with.
"""

import importlib.machinery
import importlib.util
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

loader = importlib.machinery.SourceFileLoader("boardcli", os.path.join(ROOT, "bin", "board"))
spec = importlib.util.spec_from_loader("boardcli", loader)
boardcli = importlib.util.module_from_spec(spec)
loader.exec_module(boardcli)

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


METHOD = os.path.join(ROOT, "TEACHING.md")
check("the method ships with the board", os.path.isfile(METHOD))
text = open(METHOD, encoding="utf-8").read() if os.path.isfile(METHOD) else ""

# The rules the sitting actually turned on. Each of these was a thing the tutor
# got wrong before it was written down.
for phrase, why in [
    ("exercises", "the lesson is aimed at the section's exercises"),
    ("Not all of them", "a chosen few, not the whole exercise list"),
    ("skip", "a declined prompt is obeyed"),
    ("one question", "one question per turn"),
    ("HANDOFF.md", "the session ends in writing"),
    ("code course", "a code course is a different shape and says so"),
    ("Write the card before", "the card lands before the turn's other work"),
    ("board hw", "an agreed answer is typeset into the course's own file"),
    ("board finish", "the session ends by offering the push"),
    ("assignment sheet", "a homework sitting reads the sheet it was set"),
    ("not yours", "and does not choose its own problems there"),
    ("has not produced", "no solution is invented for the student"),
]:
    check("the method states: " + why, phrase.lower() in text.lower())

# Front-loading is the failure it exists to prevent.
check("and it forbids the survey-then-ask shape outright",
      "front-load" in text.lower() or "Front-loading" in text)

# --- delivery -----------------------------------------------------------------
tmp = tempfile.mkdtemp(prefix="tutor-teaching-")
try:
    live = boardcli.Live(tmp)
    dest = boardcli.install_teaching(live)
    check("starting a board puts it in the course's live/", bool(dest) and os.path.isfile(dest))
    check("and it is the same document, not a summary of it",
          bool(dest) and open(dest, encoding="utf-8").read() == text)

    # It is a delivery, not an edit to the course: live/ is ignored by git.
    check("it lands under live/, which no course commits",
          bool(dest) and os.path.basename(os.path.dirname(dest)) == "live")

    # Delivered again on the next start, so a stale copy cannot survive an edit.
    open(dest, "w", encoding="utf-8").write("something older")
    boardcli.install_teaching(live)
    check("a stale copy is replaced on the next start",
          open(dest, encoding="utf-8").read() == text)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# --- every path that briefs an assistant has to point at it -------------------
tutor_src = open(os.path.join(ROOT, "bin", "tutor"), encoding="utf-8").read()
check("the session brief points at it", "live/TEACHING.md" in tutor_src)
check("the headless prompt points at it too",
      tutor_src.count("TEACHING.md") >= 3)

serve_src = open(os.path.join(ROOT, "serve.py"), encoding="utf-8").read()
# In a headless session the begin line IS the prompt, so it carries the pointer.
check("and so does the cold start, which in headless is the whole prompt",
      "TEACHING.md" in serve_src)

board_src = open(os.path.join(ROOT, "bin", "board"), encoding="utf-8").read()
check("board start installs it rather than assuming it is there",
      "install_teaching(live)" in board_src)

print()
print("%d FAILURES" % len(fails) if fails else "the method ships with the board")
sys.exit(1 if fails else 0)
