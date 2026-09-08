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

check("a cold turn reads the standing rules in one call, not three documents",
      "board brief" in first and "board recap" in first)
check("and is told NOT to read the documents that call replaced",
      "Do not read" in first and "AI_INSTRUCTIONS.md" in first
      and "live/TEACHING.md" in first and "live/BRIEF.md" in first)
check("and not to read the lesson card by card",
      "live/cards/ file by file" in first)
check("a resumed turn is told NOT to re-read the contract",
      "Do not re-read" in resume and "AI_INSTRUCTIONS.md" in resume)
for doc in ("live/TEACHING.md", "live/BRIEF.md", "HANDOFF.md", "live/cards/"):
    check("a resumed turn is told not to re-read %s" % doc,
          doc in resume.split("Do not re-read", 1)[1].split("\n\n", 1)[0])

# --- the two things a turn must not do ------------------------------------
# Both cost real money in a real session and neither could be fixed by asking
# more firmly, so both are refused by the command as well as forbidden here.
for name, p in (("cold", first), ("resumed", resume)):
    check("a %s turn is told not to run `board wait`" % name,
          "Do not run `board wait`" in p)
    check("a %s turn is told not to touch HANDOFF.md" % name,
          "Do not touch `HANDOFF.md`" in p)
    check("a %s turn is told to leave the next one a note" % name,
          "board note" in p and "120 words" in p)

# The wait output IS the inbox, already marked read. Telling the agent to run
# `board inbox` as well bought an empty round trip on every single turn.
for name, p in (("cold", first), ("resumed", resume)):
    check("a %s turn is not sent to `board inbox` for what it already has" % name,
          "do not run `board inbox`" in p.lower())

check("the handoff is capped, because it is read on every future session",
      "350 words" in tutor.HANDOFF_PROMPT)
check("and it is written through the one command that enforces the cap",
      "board handoff" in tutor.HANDOFF_PROMPT)
check("the wrap-up reads the lesson back in one call, holding one turn only",
      "board recap" in tutor.HANDOFF_PROMPT
      and "file by file" in tutor.HANDOFF_PROMPT)
# It used to be told not to re-read the lesson at all, because it ran on a
# session that had taught the whole of it. It does not any more -- a teaching
# turn is its own session, so the wrap-up resumes onto the LAST turn and holds
# one card. So the guarantee changed shape: it reads the lesson back, in one
# call, and still reads none of the documents.
check("the handoff turn reads no document to write itself",
      "do not read ai_instructions.md" in tutor.HANDOFF_PROMPT.lower()
      and "live/TEACHING.md" in tutor.HANDOFF_PROMPT
      and "old HANDOFF.md" in tutor.HANDOFF_PROMPT)
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

# The default, and the whole point of the arrangement: every turn is its own
# session, so what a turn holds does not grow with the lesson.
check("the shipped default is one turn to a session",
      tutor.DEFAULT_CONFIG["session_turns"] == 1)
for carried in (1, 5, 40):
    use, template, fresh = tutor.turn_plan(spec_claude, carried, 1)
    check("with session_turns 1, turn %d is fresh and cold-prompted" % (carried + 1),
          fresh and "--continue" not in use and template is first)

# An agent with no separate opening recipe must still work, and must not be
# handed a resume prompt on a session it never opened.
use, template, fresh = tutor.turn_plan({"headless": ["codex", "exec", "{prompt}"]}, 0, 12)
check("an agent with one recipe still gets the cold prompt on its first turn",
      fresh and template is first)

check("the config carries a session length", "session_turns" in tutor.DEFAULT_CONFIG)
check("and somewhere to say how big an allowance window is, without guessing",
      "quota_tokens" in tutor.DEFAULT_CONFIG
      and tutor.DEFAULT_CONFIG["quota_tokens"] is None)

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

    # The list of card LINES is the one part of the recap that grew with the
    # lesson: 107 cards is 6.4k of titles, read at the start of every turn.
    for n in range(13, 71):
        with open(os.path.join(cards, "%04d-card-%d.md" % (n, n)), "w",
                  encoding="utf-8") as fh:
            fh.write("---\nkind: lesson\ntitle: Card %d\n---\n\n%s\n" % (n, body))
    pbig = subprocess.run([sys.executable, BOARD, "recap"], cwd=tmp,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
    bigout = pbig.stdout.decode("utf-8", "replace")
    check("a long lesson still says how many cards it has", "70 card(s)" in bigout)
    check("but the list of them is bounded rather than growing every turn",
          "Card 70" in bigout and "Card 1\n" not in bigout
          and "earlier card(s) not listed" in bigout)
    check("and it says where the earlier ones went, and how to see them",
          "HANDOFF.md" in bigout and "recap --all" in bigout)
    check("a seventy-card recap is no bigger than a twelve-card one was (%d vs %d)"
          % (len(bigout), len(out)), len(bigout) < len(out) * 3)
    for n in range(13, 71):
        os.remove(os.path.join(cards, "%04d-card-%d.md" % (n, n)))

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

# --- board brief: the cold read, in one call ------------------------------
# The other half of what a turn reads. `recap` above is the lesson; this is the
# standing rules, and it replaced three whole documents read in three round
# trips. What is guarded here is that it says the things a turn acts on AND
# that it is a small fraction of what it replaced -- either one alone is not
# the point.
RULES = """### The rules that do not bend

- **You never make the user transcribe what they already wrote.** Open the PNG.
- **The user never runs a board command.**

## 14. Something after the rules

This paragraph is not part of the rules and must not be printed as though it were.
"""

tmp = tempfile.mkdtemp(prefix="tutor-brief-")
try:
    with open(os.path.join(tmp, "tutorboard.json"), "w", encoding="utf-8") as fh:
        json.dump({"name": "Test Course"}, fh)
    contract = ("# AI_INSTRUCTIONS.md\n\n## 0. Who you are working for\n\n"
                + ("padding that a turn has no reason to pay for. " * 900)
                + "\n\n## 13. The live board\n\n" + RULES)
    with open(os.path.join(tmp, "AI_INSTRUCTIONS.md"), "w", encoding="utf-8") as fh:
        fh.write(contract)
    live = os.path.join(tmp, "live")
    os.makedirs(os.path.join(live, "cards"))
    method = "# TEACHING.md\n\n" + ("the method, at length. " * 1500)
    with open(os.path.join(live, "TEACHING.md"), "w", encoding="utf-8") as fh:
        fh.write(method)
    with open(os.path.join(live, "state.json"), "w", encoding="utf-8") as fh:
        json.dump({"course": "Test Course", "session": "lecture",
                   "chapter": "Ch 1 - Groups"}, fh)
    hand = "<!-- chapter: Ch 1 - Groups -->\n# HANDOFF\n\nthey got cosets.\n"
    with open(os.path.join(tmp, "HANDOFF.md"), "w", encoding="utf-8") as fh:
        fh.write(hand)

    def board(*args, **kw):
        return subprocess.run([sys.executable, BOARD] + list(args), cwd=tmp,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              timeout=60, **kw)

    p = board("brief")
    out = p.stdout.decode("utf-8", "replace")
    check("brief runs", p.returncode == 0)
    check("it says what this sitting is", "Test Course" in out and "Ch 1 - Groups" in out)
    check("it carries the method rather than a pointer to it",
          "THE LESSON IS EXERCISES" in out)
    check("it carries this course's rules that do not bend",
          "never make the user transcribe" in out)
    check("and stops at the end of them",
          "must not be printed as though it were" not in out)
    check("it carries the handoff", "they got cosets" in out)
    check("it says how a turn works now",
          "board note" in out and "board wait" in out and "own session" in out)
    check("it names the documents it replaced, for a rule that needs its detail",
          "AI_INSTRUCTIONS.md" in out and "live/TEACHING.md" in out
          and "13. The live board" in out)
    documents = len(contract) + len(method) + len(hand)
    check("brief is a fraction of the documents it replaced (%d vs %d bytes)"
          % (len(out), documents), len(out) < documents / 8.0)

    # --- the note: what one turn tells the next ---------------------------
    p = board("note", input=b"they read the exists as a for-all. Ask only for the witness.")
    check("a note is written", p.returncode == 0 and b"NEXT.md" in p.stdout)
    check("and comes back in the brief",
          "read the exists as a for-all" in board("brief").stdout.decode())
    p = board("note", input=("word " * 200).encode())
    check("a note over its cap is REFUSED, not trimmed",
          p.returncode == 1 and b"cap is 120" in p.stdout)
    check("and the note that was there is untouched",
          b"witness" in board("note", "--show").stdout)
    check("a note can be cleared", board("note", "--clear").returncode == 0
          and b"no note" in board("note", "--show").stdout)

    # --- the handoff: capped at the door ----------------------------------
    p = board("handoff", input=("word " * 400).encode())
    check("a handoff over 350 words is REFUSED, not trimmed",
          p.returncode == 1 and b"cap is 350" in p.stdout)
    check("and nothing was written over the old one",
          b"they got cosets" in board("handoff", "--show").stdout)
    p = board("handoff", input=b"# HANDOFF\n\nthey got quotient groups.\n")
    check("a handoff inside the cap is written", p.returncode == 0)
    with open(os.path.join(tmp, "HANDOFF.md"), "r", encoding="utf-8") as fh:
        written = fh.read()
    check("and is stamped with the chapter it is about, by the writer",
          written.startswith("<!-- chapter: Ch 1 - Groups -->"))
    check("`--check` says how long it is",
          b"words, cap 350, ok" in board("handoff", "--check").stdout)

    # --- board wait: a turn does not wait ---------------------------------
    # The defect this refuses cost $4.49 in one turn: the agent ran `board wait`
    # at the end of its own turn, held the conversation open while the student
    # thought, and answered their next message inside it.
    import time as _time
    agent = os.path.join(live, "agent.json")

    def record(**kw):
        with open(agent, "w", encoding="utf-8") as fh:
            json.dump(kw, fh)

    from tutorboard import machine                            # noqa: E402
    node = machine.node_name()
    record(host=node, pid=os.getpid(), state="working", turns=3,
           last_seen=_time.time())
    p = board("wait", "--timeout", "1")
    check("a `board wait` from inside a headless turn is refused",
          p.returncode == 0 and b"does not wait" in p.stdout)
    check("and it is told what to do instead", b"board note" in p.stdout)
    p = board("wait", "--timeout", "1", "--force")
    check("the daemon's own waiter gets through with --force",
          p.returncode == 2 and b"nothing sent" in p.stdout)
    record(host=node, pid=os.getpid(), state="listening", last_seen=_time.time())
    check("and a daemon between turns is not its own turn",
          board("wait", "--timeout", "1").returncode == 2)
    record(host=node, pid=os.getpid(), mode="interactive", state="attached",
           cmd="python3", last_seen=_time.time())
    check("a person at a terminal may still wait",
          board("wait", "--timeout", "1").returncode == 2)
    os.remove(agent)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# --- what a turn cost, and that it is measured at all ---------------------
# A design whose whole justification is price has to be measured. These two
# guard the measurement itself: the flag that makes the agent report, and the
# parse of what it reports.
claude = tutor.DEFAULT_CONFIG["agents"]["claude"]
check("the claude recipe says how to ask what a turn cost",
      claude.get("usage") == "claude-json" and claude.get("usage_args"))
check("the flag is appended rather than written into the recipe, so a machine "
      "carrying an old copy of it still reports",
      "--output-format" not in claude["headless"]
      and "--output-format" in tutor.with_usage(claude, claude["headless"]))
check("and appending it twice does not repeat it",
      tutor.with_usage(claude, tutor.with_usage(claude, claude["headless"]))
      == tutor.with_usage(claude, claude["headless"]))
check("an agent that reports nothing is simply not accounted for",
      tutor.with_usage({}, ["free", "{prompt}"]) == ["free", "{prompt}"])

fd, logpath = tempfile.mkstemp(prefix="tutor-cost-", suffix=".log")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("=== 10:00:00 turn 1 ===\nthe student sent a page\n")
        offset = fh.tell()
        # Real stdout: a warning the agent printed, then the result object.
        fh.write("Warning: no stdin data received in 3s, proceeding without it.\n")
        fh.write(json.dumps({
            "type": "result", "subtype": "success", "num_turns": 6,
            "session_id": "abc", "total_cost_usd": 0.372,
            "result": "wrote card 0042",
            "usage": {"input_tokens": 10, "output_tokens": 4291,
                      "cache_creation_input_tokens": 29513,
                      "cache_read_input_tokens": 152020},
            "modelUsage": {"claude-opus-5[1m]": {"costUSD": 0.371},
                           "claude-haiku-4-5-20251001": {"costUSD": 0.001}},
        }) + "\n")
    u = tutor.read_turn_usage(logpath, offset, "claude-json")
    check("a turn's own report is read back out of the log",
          u.get("usd") == 0.372 and u.get("requests") == 6)
    check("and the numbers that matter are the cumulative ones",
          u.get("cache_read") == 152020 and u.get("cache_write") == 29513
          and u.get("out") == 4291)
    # The headline figure, because on a subscription what runs out is a
    # five-hour allowance and that is computed from tokens, not dollars.
    check("and the total a quota is computed from is everything through the model",
          u.get("tokens") == 10 + 4291 + 29513 + 152020)
    check("noise on the same stream does not break the parse",
          u.get("session") == "abc")
    check("an agent that reports nothing yields nothing rather than raising",
          tutor.read_turn_usage(logpath, offset, None) == {})
    check("and a log with no report at all is not an error",
          tutor.read_turn_usage(logpath, 0, "claude-json").get("usd") == 0.372
          and tutor.read_turn_usage(logpath, 10 ** 9, "claude-json") == {})
finally:
    os.unlink(logpath)

print()
print("%d FAILURES" % len(fails) if fails
      else "a turn pays for what it needs and not for what it already has")
sys.exit(1 if fails else 0)
