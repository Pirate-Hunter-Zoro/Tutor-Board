#!/usr/bin/env python3
"""What a headless course costs to run, in tokens.

Not a speed test. A tutor billed by the token pays for every character it is
told to read, and it pays again for every round trip inside a turn, because each
one resends the whole conversation. Two things follow, and this file guards both:

- **A resumed turn must not be told to re-read what it already holds.** The
  single prompt this replaced told every turn to read AI_INSTRUCTIONS.md,
  TEACHING.md, BRIEF.md, HANDOFF.md and every card in live/cards/ -- roughly
  fourteen thousand tokens of documents the agent was already carrying, plus one
  round trip per card.
- **A lesson is read back in one call.** `board recap` is that call. Reading a
  twelve-card lesson card by card is twelve round trips for what fits in one.
"""

import importlib.machinery
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BOARD = os.path.join(ROOT, "bin", "board")

loader = importlib.machinery.SourceFileLoader("tutor", os.path.join(ROOT, "bin", "tutor"))
spec = importlib.util.spec_from_loader("tutor", loader)
tutor = importlib.util.module_from_spec(spec)
loader.exec_module(tutor)

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


# --- the prompts ----------------------------------------------------------
first = tutor.HEADLESS_FIRST_PROMPT
resume = tutor.HEADLESS_RESUME_PROMPT

check("a cold turn is told to read the contract and the method",
      "AI_INSTRUCTIONS.md" in first and "TEACHING.md" in first)
check("and to read the lesson back in one call",
      "board recap" in first and "file by file" in first)
check("a resumed turn is told NOT to re-read the contract",
      "Do not re-read" in resume and "AI_INSTRUCTIONS.md" in resume)
for doc in ("live/TEACHING.md", "live/BRIEF.md", "HANDOFF.md", "live/cards/"):
    check("a resumed turn is told not to re-read %s" % doc,
          doc in resume.split("Do not re-read", 1)[1].split("\n\n", 1)[0])

# The wait output IS the inbox, already marked read. Telling the agent to run
# `board inbox` as well bought an empty round trip on every single turn.
for name, p in (("cold", first), ("resumed", resume)):
    check("a %s turn is not sent to `board inbox` for what it already has" % name,
          "do not run `board inbox`" in p.lower())

check("the handoff is capped, because it is read on every future session",
      "350 words" in tutor.HANDOFF_PROMPT)
check("and the handoff turn is not told to re-read the lesson it just taught",
      "Do not re-read" in tutor.HANDOFF_PROMPT)
check("the handoff is not a documentation review either",
      "Do not review" in tutor.HANDOFF_PROMPT)

# --- which session a turn runs in -----------------------------------------
spec_claude = {"headless_first": ["claude", "-p", "{prompt}"],
               "headless": ["claude", "-p", "{prompt}", "--continue"]}

use, template, fresh = tutor.turn_plan(spec_claude, 0, 12)
check("with nothing to resume, a turn opens a session",
      fresh and "--continue" not in use and template is first)

use, template, fresh = tutor.turn_plan(spec_claude, 1, 12)
check("with a session in hand it is resumed",
      not fresh and "--continue" in use and template is resume)

use, template, fresh = tutor.turn_plan(spec_claude, 11, 12)
check("and stays resumed up to the limit", not fresh)

use, template, fresh = tutor.turn_plan(spec_claude, 12, 12)
check("at the limit it starts fresh rather than carry twelve turns of history",
      fresh and "--continue" not in use and template is first)

use, template, fresh = tutor.turn_plan(spec_claude, 99, 0)
check("session_turns 0 resumes for ever, which is what a flat rate wants",
      not fresh)

# An agent with no separate opening recipe must still work, and must not be
# handed a resume prompt on a session it never opened.
use, template, fresh = tutor.turn_plan({"headless": ["codex", "exec", "{prompt}"]}, 0, 12)
check("an agent with one recipe still gets the cold prompt on its first turn",
      fresh and template is first)

check("the config carries a session length", "session_turns" in tutor.DEFAULT_CONFIG)

# --- the stance a repository declares --------------------------------------
# `stance: do` is what a repository sets when it wants the work done rather than
# taught. It is never guessed: writing the code for somebody who wanted to learn
# it is the one mistake here the next card cannot undo.
#
# It is the ONLY thing a repository still says about how it is taught. A `mode`
# of `math` or `code` used to sit beside it and carry a whole second method --
# `code_sense` -- and a whole second interface. A stance is a paragraph appended
# to the one method, which is why it is a line of configuration and not a mode.
import importlib.machinery as _m  # noqa: E402
import importlib.util as _u       # noqa: E402

from tutorboard import sense as serve_mod                    # noqa: E402

check("teaching is the default, and it adds nothing to the method",
      serve_mod.stance_sense("teach") == ""
      and serve_mod.stance_sense(None) == ""
      and serve_mod.stance_sense("code") == "")
do = serve_mod.stance_sense("do")
check("a doing repository is told to write the code",
      "you write the code" in do.lower())
check("and to run what needs running", "run what needs running" in do)
check("but still one card, and still first",
      "one card" in do.lower() and "before the rest" in do)
check("and to say what it did not actually verify", "did NOT verify" in do)
check("and no subject is read anywhere in the config",
      "mode" not in serve_mod.config.DEFAULT_CONFIG)

# --- board recap ----------------------------------------------------------
tmp = tempfile.mkdtemp(prefix="tutor-tokens-")
try:
    with open(os.path.join(tmp, "tutorboard.json"), "w", encoding="utf-8") as fh:
        json.dump({"name": "Test Course", "mode": "math"}, fh)
    live = os.path.join(tmp, "live")
    cards = os.path.join(live, "cards")
    os.makedirs(cards)
    with open(os.path.join(live, "state.json"), "w", encoding="utf-8") as fh:
        json.dump({"course": "Test Course", "session": "lecture",
                   "chapter": "Ch 1 - Groups"}, fh)

    # A lesson of a realistic length, each card a realistic size.
    body = "Some teaching prose about cosets. " * 60
    for n in range(1, 13):
        kind = "question" if n % 3 == 0 else "lesson"
        with open(os.path.join(cards, "%04d-card-%d.md" % (n, n)), "w",
                  encoding="utf-8") as fh:
            fh.write("---\nkind: %s\ntitle: Card %d\n---\n\n%s\n" % (kind, n, body))
    total = sum(os.path.getsize(os.path.join(cards, n)) for n in os.listdir(cards))

    with open(os.path.join(live, "turns.jsonl"), "w", encoding="utf-8") as fh:
        fh.write(json.dumps({"id": "t0001", "rev": 1, "t": 1.0,
                             "iso": "2026-08-27 10:00:00", "from": "student",
                             "answers": "0003", "kind": "ink",
                             "text": "", "png": "/answers/t0001-r1.png"}) + "\n")
        fh.write(json.dumps({"id": "t0002", "rev": 1, "t": 2.0,
                             "iso": "2026-08-27 10:20:00", "from": "student",
                             "answers": "0006", "kind": "text",
                             "text": "I think the index is 2"}) + "\n")
        # A correction supersedes in place; the old revision is not the lesson.
        fh.write(json.dumps({"id": "t0002", "rev": 2, "t": 3.0,
                             "iso": "2026-08-27 10:25:00", "from": "student",
                             "answers": "0006", "kind": "text",
                             "text": "the two cosets are H and its complement"}) + "\n")

    p = subprocess.run([sys.executable, BOARD, "recap"], cwd=tmp,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
    out = p.stdout.decode("utf-8", "replace")
    check("recap runs", p.returncode == 0)
    check("it names the session", "Test Course" in out and "Ch 1 - Groups" in out)
    check("every card is there as a line", all("Card %d" % n in out for n in range(1, 13)))
    check("the newest card is there in full", body.strip()[:40] in out)
    check("it says which question is still open", "OPEN" in out)
    # 0003 and 0006 were answered; 0009 and 0012 were not.
    answered_lines = [l for l in out.splitlines()
                      if l.strip().startswith(("0003", "0006"))]
    check("an answered question is marked answered, not open",
          answered_lines and all("answered" in l and "OPEN" not in l
                                 for l in answered_lines))
    check("and the ones still owed are the only open ones",
          out.count("OPEN") == 2)
    check("their turns are listed", "10:00:00" in out and "10:20:00" not in out
          or "the two cosets" in out)
    check("only the newest revision of a turn is shown",
          "I think the index is 2" not in out)
    check("their latest turn is shown in full", "the two cosets" in out)

    # The whole point: one call, and a fraction of the lesson's own size.
    check("recap is a fraction of the cost of reading the lesson (%d vs %d bytes)"
          % (len(out), total), len(out) < total / 2.0)

    # --all is there for the rare case, and is honestly bigger.
    p2 = subprocess.run([sys.executable, BOARD, "recap", "--all"], cwd=tmp,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
    check("--all prints the lesson in full when that is genuinely wanted",
          len(p2.stdout) > total)

    # An empty lesson says so rather than printing nothing.
    for n in os.listdir(cards):
        os.remove(os.path.join(cards, n))
    p3 = subprocess.run([sys.executable, BOARD, "recap"], cwd=tmp,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
    check("an empty lesson says so", b"no cards yet" in p3.stdout)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print()
print("%d FAILURES" % len(fails) if fails
      else "a turn pays for what it needs and not for what it already has")
sys.exit(1 if fails else 0)
