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
    # A skip means two different things and reading it the lecture way in a
    # homework sitting quietly shortens the sheet. The problems are assigned:
    # tapping past one chooses an order, and an unanswered one is a lost mark.
    ("not now", "a skipped homework problem is deferred, not dropped"),
    ("come back to it once the others are done",
     "and is returned to when the rest of the sheet is done"),
    ("only one left", "and comes straight back if it is the last one standing"),
    # The student works the sheet in whatever order suits them; the document is
    # not theirs to reorder. Answering 4 before 2 must not put 4 above 2 on the
    # page, which is what appending as you go does.
    ("skeleton in order", "the document's order is fixed before anything fills it"),
    ("order regardless",
     "so the write-up reads in the assignment's order, not the answering order"),
    # Revising for a test inverts the homework rule: the student chose the
    # scope, and inside it the questions are the tutor's. Both halves have to be
    # written down, because the failure in either direction is silent -- a tutor
    # that asks outside the scope wastes the evening, and one that treats the
    # scope as a syllabus teaches it instead of testing it.
    ("test review", "a test review is a sitting of its own"),
    ("Do not widen the scope", "and its scope is not the tutor's to widen"),
    ("Spread the questions", "and the questions are spread across all of it"),
    ("no write-up", "and nothing is transcribed or compiled for a review"),
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
    # And then the half that was missing: the checks are not a supplement to the
    # explaining, they ARE the explaining. A model handed a chapter and told to
    # teach writes a lecture, because that is what teaching looks like in
    # everything it has ever read. So the shape is stated outright and first.
    ("exercises, all the way down", "a lesson is exercises and nothing else"),
    ("no explaining step that", "with no explaining step that stands on its own"),
    ("There is no worked-example card", "and no card that only demonstrates"),
    ("You bring the objects; they do the showing",
     "the tutor supplies the objects and the student shows what they are"),
    ("non-example", "and a non-example is how a definition gets fixed"),
    ("ladder is as short as it can possibly be",
     "only what the exercise needs is taught, and nothing else is"),
    ("Re-pose the exercise", "the exercise comes back after the ladder"),
    ("is not a re-pose", "restated in full, because a reference is not a re-pose"),
    ("measure of a sitting is how many exercises got answered",
     "and a sitting is measured in exercises answered"),
    # A review is the one sitting that must NOT ladder before the question --
    # laddering first would tell you only that they can follow a ladder.
    ("ladder comes after the break", "a review asks cold and ladders from a break"),
    # Asked for from the board, mid-proof: "I don't want to have to scroll back
    # to understand exactly what I'm trying to prove." A statement on its own is
    # not the whole question -- the definitions it leans on are part of it.
    ("self-contained", "a card that poses a problem is self-contained"),
    ("every definition, symbol and named result",
     "and carries every definition the statement uses"),
    ("scroll back", "so nothing has to be hunted for up the transcript"),
    ("Include the ones from the rungs",
     "including the ones from checks that were skipped"),
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
    # A project can be reviewed too, but the method for it rides on the sitting's
    # own prompt rather than on this document -- so a project pays nothing for a
    # feature it may never use, and the maths course is not handed a section
    # about a repository it does not have.
    check("the review method goes to the course, not to the project",
          "A test review" in maths and "A test review" not in code)
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

# The pointer is not enough on its own. In headless the sense line IS the whole
# prompt, and a tutor that reads "teach what the exercise needs" without the
# shape attached writes a lecture and asks at the bottom of it. So every sitting
# carries the shape, and it carries the SAME one -- one paragraph, hoisted.
sys.path.insert(0, ROOT)
loader2 = importlib.machinery.SourceFileLoader("serveapp", os.path.join(ROOT, "serve.py"))
spec2 = importlib.util.spec_from_loader("serveapp", loader2)
serveapp = importlib.util.module_from_spec(spec2)
try:
    loader2.exec_module(serveapp)
except Exception as exc:                      # pragma: no cover - import guard
    serveapp = None
    print("note: serve.py did not import (%s); checking its source instead" % exc)

sense = serveapp.METHOD_SENSE if serveapp else ""
if serveapp:
    for phrase, why in [
        ("LESSON IS", "the sense line says the lesson is exercises"),
        ("EXERCISES", "in the word the tutor cannot read past"),
        ("state the exercise in full", "the exercise is stated in full first"),
        ("ONE tiny thing", "then one small thing at a time"),
        ("RESTATED IN FULL", "and the exercise is restated in full at the end"),
        ("not a re-pose", "a reference to it is not a re-pose"),
        ("self-contained", "every posing card is self-contained"),
        ("scroll back", "so nothing has to be hunted for up the transcript"),
        ("One question per turn", "one question per turn"),
    ]:
        check("the headless prompt " + why, phrase in sense)
    check("and every kind of sitting is given the same shape",
          serve_src.count("METHOD_SENSE") >= 4)
    # A review inverts one thing and only one: it asks before it teaches.
    check("except a review, which asks cold and ladders from the break",
          "asks COLD" in serve_src and "Ladder only from a break" in serve_src)
    # A skipped check is a rung, so the skip has somewhere to go next.
    check("a skipped check moves to the next rung, or to the exercise",
          "hand-check" in serveapp.SIGNAL_SENSE["skip"]
          and "restated in full" in serveapp.SIGNAL_SENSE["skip"])

board_src = open(os.path.join(ROOT, "bin", "board"), encoding="utf-8").read()
check("board start installs it rather than assuming it is there",
      "install_teaching(live)" in board_src)

print()
print("%d FAILURES" % len(fails) if fails else "the method ships with the board")
sys.exit(1 if fails else 0)
