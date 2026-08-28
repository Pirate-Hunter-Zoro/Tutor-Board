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
    ("Write the card before", "the card lands before the turn's other work"),
    ("board hw", "an agreed answer is typeset into the course's own file"),
    ("board finish", "the session ends by offering the push"),
    ("assignment sheet", "a homework sitting reads the sheet it was set"),
    ("not yours", "and does not choose its own problems there"),
    ("no exception to this", "and nothing outranks getting the card up first"),
    ("Never label a question", "a question is answered, not graded"),
    ("do not know how to start", "and not knowing where to start is a real answer"),
    ("has not produced", "no solution is invented for the student"),
    # A concept that has only been read is not one the student can use, and the
    # exercise is a bad place to discover that. Found the hard way: a card taught
    # cosets, the index and normality, then went straight to the exercise.
    ("hand-check", "every concept is worked by the student before the exercise"),
    ("One concept per check", "one concept per check, not three in one card"),
    ("Tiny", "a check is small enough to answer at once"),
    ("can be skipped", "and a check can be declined like any other prompt"),
    # A code repository is a project, and the method used to be fifteen lines
    # bolted onto a document about books. So a first card on a project with no
    # chapters opened with "Which chapter this is", invented an order out of the
    # README's headings, and taught a lesson nobody asked for while the actual
    # task list sat unread in another repository.
    ("not a course", "a code repository is a project, not a course"),
    ("Do not manufacture a curriculum", "and no curriculum is invented for it"),
    ("where the work is planned", "the README says where the work is planned"),
    ("follow that pointer", "and the tutor follows that pointer for what is next"),
    ("do not choose an agenda", "and asks rather than choosing its own work"),
    ("goes with a commit", "and finishing work includes writing it down"),
    # Not every project wants a tutor. One line of configuration, and the tutor
    # does the work instead of setting it -- without any of the rest of a turn
    # changing, which is why it is a line of configuration and not a mode.
    ('"stance": "do"', "a repository can ask for the work to be done, not taught"),
    ("declared, never inferred", "and that is never guessed at"),
    ("still one card, still short", "a doing turn is still one short card first"),
    ("say what you did not verify", "and says what it has not actually run"),
]:
    check("the method states: " + why, phrase.lower() in text.lower())

# Front-loading is the failure it exists to prevent.
check("and it forbids the survey-then-ask shape outright",
      "front-load" in text.lower() or "Front-loading" in text)

# --- delivery -----------------------------------------------------------------
tmp = tempfile.mkdtemp(prefix="tutor-teaching-")
try:
    import json  # noqa: E402
    with open(os.path.join(tmp, "tutorboard.json"), "w", encoding="utf-8") as fh:
        json.dump({"name": "T", "mode": "code"}, fh)
    live = boardcli.Live(tmp)
    dest = boardcli.install_teaching(live)
    check("starting a board puts it in the course's live/", bool(dest) and os.path.isfile(dest))

    # It is a filter, never a rewrite. A maths course has no use for the project
    # method and a project has no use for the homework rules, and every session
    # pays to read whichever half does not apply -- but a hand-written summary
    # would drift, which is the whole reason this file lives in one place.
    maths = boardcli.for_mode(text, "math")
    code = boardcli.for_mode(text, "code")

    def sections(doc):
        out, cur = {}, None
        for line in doc.splitlines(True):
            if line.strip().startswith("<!-- mode:"):
                continue          # delivery plumbing, not one of the words
            if line.startswith("## "):
                cur = line.strip()
                out[cur] = ""
            elif cur:
                out[cur] += line
        return out

    src_s, math_s, code_s = sections(text), sections(maths), sections(code)
    check("every section of the method is delivered to somebody",
          all(h in math_s or h in code_s for h in src_s))
    check("and every delivered section is the source's own words, not a summary",
          all(math_s[h] == src_s[h] for h in math_s)
          and all(code_s[h] == src_s[h] for h in code_s))
    check("a maths course gets the section method and not the project one",
          "A section, from start to finish" in maths
          and "A project, from where you are" not in maths)
    check("a code project gets the project method and not the homework rules",
          "A project, from where you are" in code
          and "A homework sitting" not in code)
    check("and both get the rules that belong to neither in particular",
          "Write the card before you do anything else" in maths
          and "Write the card before you do anything else" in code)
    marker_line = lambda doc: any(l.strip().startswith("<!-- mode:")
                                  and l.strip().endswith("-->")
                                  and len(l.strip()) < 24
                                  for l in doc.splitlines())
    check("the mode markers themselves never reach a course",
          not marker_line(maths) and not marker_line(code))
    check("a course whose mode is unknown gets the whole document, not half",
          boardcli.for_mode(text, None) == text)
    check("the code delivery is genuinely smaller, which is the point",
          len(code) < len(text) * 0.75)
    check("and what lands in live/ is the delivery for this course",
          bool(dest) and open(dest, encoding="utf-8").read() == code)

    # It is a delivery, not an edit to the course: live/ is ignored by git.
    check("it lands under live/, which no course commits",
          bool(dest) and os.path.basename(os.path.dirname(dest)) == "live")

    # Delivered again on the next start, so a stale copy cannot survive an edit.
    open(dest, "w", encoding="utf-8").write("something older")
    boardcli.install_teaching(live)
    check("a stale copy is replaced on the next start",
          open(dest, encoding="utf-8").read() == code)
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
