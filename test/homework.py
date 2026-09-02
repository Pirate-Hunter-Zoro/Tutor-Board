#!/usr/bin/env python3
"""A homework sitting is producing a document, and the board has to know which one.

Two shapes of problem set exist in the courses this drives, and neither is more
correct than the other:

    homework/hw04/hw04.tex                        numbered by assignment
    chapters/ch07-*/homework/ch07-homework.tex     numbered by chapter

So the set is discovered, not assumed, and the problem labels are opaque strings
because one course numbers problems 1, 2, 3 and the other numbers them 7.1, 7.2.

What is guarded here is the reading, not the writing: the assistant edits the
.tex with its own tools, and this only has to report which problems are still
empty and never point a compile or a page of handwriting at the wrong set.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tutorboard import tex
from tutorboard.course import homework  # noqa: E402

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


SET = r"""\documentclass[11pt]{article}
\begin{document}
\begin{problem}{%(a)s}
  A statement that has been transcribed.
\end{problem}
%% ===== SOLUTION %(a)s =====
Let $D$ be finite. The map is injective, hence onto.
%% ===== END SOLUTION %(a)s =====

\begin{problem}{%(b)s}
  A statement transcribed, but not yet worked.
\end{problem}
%% ===== SOLUTION %(b)s =====
%% TODO(mferguson): your work goes here.
%% ===== END SOLUTION %(b)s =====

\begin{problem}{%(c)s}
  \todo{statement not yet transcribed}
\end{problem}
%% ===== SOLUTION %(c)s =====
%% TODO(mferguson): your work goes here.
%% ===== END SOLUTION %(c)s =====
\end{document}
"""


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


tmp = tempfile.mkdtemp(prefix="tutor-hw-")
try:
    # --- the assignment-numbered shape ---------------------------------------
    prob = os.path.join(tmp, "byset")
    write(os.path.join(prob, "tutorboard.json"), '{"name": "P", "mode": "math"}')
    write(os.path.join(prob, "homework", "hw04", "hw04.tex"), SET % {"a": "1", "b": "2", "c": "3"})
    write(os.path.join(prob, "homework", "hw05", "hw05.tex"), SET % {"a": "1", "b": "2", "c": "3"})
    # A build directory is output, not a problem set.
    write(os.path.join(prob, "homework", "hw04", "build", "hw04.tex"), "junk")

    names = [s["name"] for s in homework.sets(prob)]
    check("assignment-numbered sets are found", names == ["hw04", "hw05"])
    check("a build directory is not mistaken for a set",
          all("build" not in s["rel"] for s in homework.sets(prob)))

    # --- the chapter-numbered shape ------------------------------------------
    gal = os.path.join(tmp, "bychapter")
    write(os.path.join(gal, "tutorboard.json"), '{"name": "G", "mode": "math"}')
    write(os.path.join(gal, "chapters", "ch07-splitting-fields", "homework",
                       "ch07-homework.tex"), SET % {"a": "7.1", "b": "7.2", "c": "7.3"})
    write(os.path.join(gal, "chapters", "ch07-splitting-fields", "notes",
                       "ch07-notes.tex"), "notes are not homework")

    names = [s["name"] for s in homework.sets(gal)]
    check("chapter-numbered sets are found", names == ["ch07"])
    check("a chapter's notes file is not its homework",
          all("notes" not in s["rel"] for s in homework.sets(gal)))

    # --- which set is this sitting -------------------------------------------
    check("the session label picks the set out",
          (homework.find(prob, {"chapter": "Homework 5"}) or {}).get("name") == "hw05")
    check("and does so for a chapter-numbered course",
          (homework.find(gal, {"chapter": "Ch 7 — splitting fields"}) or {}).get("name")
          == "ch07")
    check("a pinned set beats the label",
          (homework.find(prob, {"chapter": "Homework 5",
                                "hw": "homework/hw04/hw04.tex"}) or {}).get("name") == "hw04")
    check("a sole set needs no label at all",
          (homework.find(gal, {}) or {}).get("name") == "ch07")
    # Guessing wrong here compiles the wrong document or files handwriting into
    # someone else's problem, so an unresolvable guess is no answer.
    check("an ambiguous sitting resolves to nothing rather than to a guess",
          homework.find(prob, {}) is None)
    check("and says what there was to choose from",
          homework.status(prob, {})["ambiguous"] == ["hw04", "hw05"])

    # --- how much of it is done ----------------------------------------------
    st = homework.status(prob, {"chapter": "Homework 4"})
    check("every problem is counted", st["total"] == 3)
    check("a filled region counts as written up", st["written"] == 1)
    check("a region holding only the placeholder comment does not",
          st["problems"][1]["written"] is False)
    check("a transcribed statement with an empty region is the to-do state",
          st["problems"][1]["stated"] is True and st["problems"][1]["written"] is False)
    check("an untranscribed statement is visible as such",
          st["problems"][0]["stated"] is True and st["problems"][2]["stated"] is False)
    check("problems keep the order they appear in",
          [p["label"] for p in st["problems"]] == ["1", "2", "3"])

    # --- what is still owed, which is what a skip leaves behind ---------------
    #
    # A student may work an assigned sheet in any order they like: skipping is
    # theirs, and it means "not now" rather than "never". The assistant then has
    # to come back, and "come back" has to survive two hours, a restart and a
    # different tutor -- so it is read off the DOCUMENT, where an unanswered
    # problem is an empty region sitting in the sheet's own order, and not off
    # anybody's memory of the conversation.
    check("what is still to write up is named, in the sheet's order",
          st["outstanding"] == ["2", "3"])
    check("and the next agreed answer has a region waiting for it",
          st["next"] == "2")
    check("a written-up problem is not outstanding",
          "1" not in st["outstanding"])

    # Answered out of order: problem 3 done while 2 is still empty. The document
    # is written in the sheet's order regardless, so 2 is still the next one --
    # its region sits above 3's and stays empty until it is filled.
    jumbled = os.path.join(tmp, "jumbled")
    write(os.path.join(jumbled, "tutorboard.json"), '{"name": "J", "mode": "math"}')
    body = SET % {"a": "1", "b": "2", "c": "3"}
    body = body.replace(
        "% TODO(mferguson): your work goes here.\n% ===== END SOLUTION 3 =====",
        "By Boole's inequality the union is at most the sum.\n% ===== END SOLUTION 3 =====")
    write(os.path.join(jumbled, "homework", "hw06", "hw06.tex"), body)
    stj = homework.status(jumbled, {"chapter": "Homework 6"})
    check("a problem answered out of turn is written up where the sheet puts it",
          [p["label"] for p in stj["problems"]] == ["1", "2", "3"]
          and stj["problems"][2]["written"] is True)
    check("and the one skipped over is still the next one owed",
          stj["outstanding"] == ["2"] and stj["next"] == "2")

    # The degenerate case the person asked about: skip the only one left and it
    # comes straight back, because there is nothing else to carry on with.
    last = homework.outstanding([{"label": "9", "written": False}])
    check("skipping the last problem leaves exactly one thing owed: that problem",
          last == ["9"])
    check("and a finished sheet owes nothing",
          homework.outstanding([{"label": "9", "written": True}]) == [])

    # The real templates use one comment marker; a doubled one is an ordinary
    # thing for a person to write and opens no less real a region.
    dbl = os.path.join(tmp, "doubled")
    write(os.path.join(dbl, "tutorboard.json"), '{"name": "D", "mode": "math"}')
    write(os.path.join(dbl, "homework", "hw01", "hw01.tex"),
          SET.replace("%%", "%%%%") % {"a": "1", "b": "2", "c": "3"})
    dst = homework.status(dbl, {})
    check("a doubled comment marker still opens a solution region",
          dst["total"] == 3 and dst["written"] == 1)

    gst = homework.status(gal, {})
    check("dotted problem labels survive",
          [p["label"] for p in gst["problems"]] == ["7.1", "7.2", "7.3"])

    # --- the command line ----------------------------------------------------
    board = os.path.join(ROOT, "bin", "board")

    def run(cwd, *args):
        p = subprocess.run([sys.executable, board] + list(args), cwd=cwd,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
        return p.returncode, p.stdout.decode("utf-8", "replace")

    code, out = run(prob, "open", "P", "Homework 4", "--homework")
    check("opening a homework sitting binds it to a set", code == 0 and "hw04" in out)
    with open(os.path.join(prob, "live", "state.json"), encoding="utf-8") as fh:
        state = json.load(fh)
    check("and records which one", state.get("hw") == "homework/hw04/hw04.tex")
    check("and that it is homework", state.get("session") == "homework")

    code, out = run(prob, "hw")
    check("status reports the set and what is empty",
          code == 0 and "hw04" in out and "EMPTY" in out and "1 of 3" in out)

    code, out = run(prob, "hw", "use", "hw05")
    check("a set can be pinned by name", code == 0)
    code, out = run(prob, "hw")
    check("and the pin takes effect", "hw05" in out)

    code, out = run(prob, "hw", "use", "hw99")
    check("pinning a set that does not exist fails loudly", code != 0)

    # Filing handwriting: the frozen answer, never the live slate page.
    os.makedirs(os.path.join(prob, "live", "answers"), exist_ok=True)
    with open(os.path.join(prob, "live", "answers", "t0001-r1.png"), "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
    with open(os.path.join(prob, "live", "turns.jsonl"), "w", encoding="utf-8") as fh:
        json.dump({"id": "t0001", "rev": 1, "kind": "ink", "answers": "0001",
                   "t": 1.0, "png": "/answers/t0001-r1.png"}, fh)
    code, out = run(prob, "hw", "file", "2")
    filed = os.path.join(prob, "homework", "hw05", "handwritten", "hw05-2.png")
    check("a sent page files into the set it belongs to",
          code == 0 and os.path.isfile(filed))

    code, out = run(prob, "hw", "file", "../../etc/passwd")
    check("a label cannot escape the handwritten directory",
          not os.path.exists(os.path.join(tmp, "passwd")))

    code, out = run(gal, "hw", "list")
    check("list works without a session being open", code == 0 and "ch07" in out)

    # ---- the write-up is part of the commit ------------------------------
    #
    # An exercise is finished when it is typeset, not when it is agreed: the point
    # of the hour is the piece of mathematics. Compiling it was a step the tutor
    # had to remember at the end of a turn that had already delivered its card,
    # and a session ends by being abandoned far more often than it ends tidily.
    # What got pushed was then a `.tex` carrying tonight's proof beside a `.pdf`
    # from last week that does not -- which is worse than no PDF at all, because
    # it looks finished and is silently missing the exercise.
    tex_path = os.path.join(prob, "homework", "hw05", "hw05.tex")
    pdf = os.path.splitext(tex_path)[0] + ".pdf"

    # Stand in for LaTeX: a build script is honoured before the built-in path,
    # and this test is about WHEN a build happens, not about compiling TeX.
    scripts = os.path.join(prob, "scripts")
    os.makedirs(scripts, exist_ok=True)
    with open(os.path.join(scripts, "build.sh"), "w", encoding="utf-8") as fh:
        fh.write('#!/usr/bin/env bash\necho "pretending to compile $1"\n'
                 'printf %%s "%%PDF-1.4" > "${1%%.tex}.pdf"\n')
    # And a push that does not touch the network.
    with open(os.path.join(scripts, "save-and-push.sh"), "w", encoding="utf-8") as fh:
        fh.write('#!/usr/bin/env bash\necho "pushed: $1"\n')

    check("a set with no PDF at all is out of date", not os.path.exists(pdf))
    code, out = run(prob, "push", "an agreed exercise")
    check("pushing compiles the write-up first",
          code == 0 and "compiling" in out and os.path.exists(pdf))
    check("and says which set it built", "hw05" in out)
    check("and then actually pushes", "pushed:" in out)

    # A second push with nothing changed must not rebuild: an ordinary save in
    # the middle of a lesson should cost nothing.
    stamp = os.path.getmtime(pdf)
    code, out = run(prob, "push", "again")
    check("a push with the PDF already current does not rebuild",
          code == 0 and "compiling" not in out and os.path.getmtime(pdf) == stamp)

    # Write to the source, and it is out of date again.
    with open(tex_path, "a", encoding="utf-8") as fh:
        fh.write("\n%% one more agreed exercise\n")
    os.utime(tex_path, (stamp + 10, stamp + 10))
    code, out = run(prob, "push", "and another")
    check("touching the write-up makes the next push rebuild it",
          code == 0 and "compiling" in out)

    # A LaTeX error must not eat the source. The `.tex` is the record.
    with open(os.path.join(scripts, "build.sh"), "w", encoding="utf-8") as fh:
        fh.write('#!/usr/bin/env bash\necho "! Undefined control sequence."\nexit 1\n')
    with open(tex_path, "a", encoding="utf-8") as fh:
        fh.write("\n%% broken\n")
    code, out = run(prob, "push", "with a broken write-up")
    check("a build that fails still pushes the source, which is the record",
          code == 0 and "pushed:" in out)
    check("and says so loudly rather than shipping a stale PDF in silence",
          "BUILD FAILED" in out)

    # ---- the compiler has to be findable, wherever it is installed --------
    #
    # A course's build.sh knows where TeX lives on the machine it was written on
    # and nowhere else -- Probability's prepends TinyTeX's Linux directory,
    # which on the Mac does not exist. So a board started by a login agent, with
    # a PATH of /usr/bin:/bin and nothing more, ran that script, could not find
    # pdflatex, and reported the failure as the document's. An evening's
    # homework was written up and could not be typeset, and the source was
    # fine the whole time.
    with open(os.path.join(scripts, "build.sh"), "w", encoding="utf-8") as fh:
        fh.write('#!/usr/bin/env bash\n'
                 'printf %s "$PATH" > "$(dirname "$0")/../seen-path"\n'
                 'printf %s "${TEXINPUTS:-}" > "$(dirname "$0")/../seen-inputs"\n'
                 'printf %%s "%%PDF-1.4" > "${1%%.tex}.pdf"\n')
    code, out = run(prob, "hw", "build")
    seen_path = open(os.path.join(prob, "seen-path"), encoding="utf-8").read()
    seen_inputs = open(os.path.join(prob, "seen-inputs"), encoding="utf-8").read()
    check("the course's build script runs with TeX on its PATH",
          all(d in seen_path.split(os.pathsep) for d in tex.tex_bin_dirs()))
    check("and with the board's own macros where LaTeX will look for them",
          os.path.join(ROOT, "tex") in seen_inputs.split(os.pathsep))

    # "FAILED" on its own is what sends somebody to a laptop to discover that
    # nothing was wrong with their mathematics. Whatever the reason -- no
    # compiler on this machine, or a script that discards its own output -- the
    # board has to carry one.
    with open(os.path.join(scripts, "build.sh"), "w", encoding="utf-8") as fh:
        fh.write('#!/usr/bin/env bash\nexit 1\n')
    code, out = run(prob, "hw", "build")
    check("a build that fails silently is still given a reason",
          code != 0 and len(out.strip()) > 40)
    rec = json.load(open(os.path.join(prob, "live", "hw.json"), encoding="utf-8"))
    check("and the reason is recorded for the board to show",
          rec["ok"] is False and len(rec["detail"].strip()) > 40)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print()
print("%d FAILURES" % len(fails) if fails else "the board knows which problem set this is")
sys.exit(1 if fails else 0)
