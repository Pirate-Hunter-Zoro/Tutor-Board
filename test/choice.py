#!/usr/bin/env python3
"""The address follows the course a person chose, not the one sorted first.

The always-on host proxies the one address the iPad has installed to whichever
machine is serving. It used to decide which board that was by knocking on every
course's port in sorted order and taking the first that answered -- which is not
a decision, it is the alphabet. With a Galois board and a Probability board both
up, tapping Probability in the hub did all the right things and changed nothing
anybody could see: the switch worked, the board started, and the proxy went on
serving Galois for ever, because G sorts before P.

Two rules, and this file holds both:

  - a board publishes the choice, since only the serving machine can read the
    record of it, and the proxy believes the choice over its own port scan;
  - a board says who it is, and nothing is served without that answer matching --
    a port is derived from a name, and derivation is not proof.

It also holds the port rule underneath them: two courses must not land on one
number. `Mathematical-Modeling` and `Research-Journey` did, and the second to
start simply failed to come up.
"""

import importlib.machinery
import importlib.util
import json
import os
import sys
import time

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


# This suite reasons about which board wins, so it must not reach the real
# tailnet, where the answer depends on what happens to be running tonight.
os.environ["BOARD_NO_TAILNET"] = "1"

import boardlib                                              # noqa: E402

spec = importlib.util.spec_from_loader(
    "followcli",
    importlib.machinery.SourceFileLoader("followcli", os.path.join(ROOT, "bin", "follow")))
follow = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(follow)
except Exception as exc:                                     # noqa: BLE001
    print("FAIL bin/follow did not import: %s" % exc)
    sys.exit(1)
ok("bin/follow imports without running")

# ---- ports -----------------------------------------------------------------

NAMES = ["Algo-Solutions", "Galois-Theory", "Lean-Theorem-Proving",
         "Mathematical-Modeling", "PSYCH-ASR", "Probability", "Research-Journey",
         "TRD-EHR", "Tutor-Board", "libr-local-llm"]

seen = {}
for n in NAMES:
    seen.setdefault(boardlib.default_port(n), []).append(n)
clashes = dict((p, v) for p, v in seen.items() if len(v) > 1)
check("no two courses on this machine derive the same port", not clashes)
if clashes:
    print("     " + repr(clashes))

check("Mathematical-Modeling and Research-Journey are no longer the same board",
      boardlib.default_port("Mathematical-Modeling")
      != boardlib.default_port("Research-Journey"))

seq = boardlib.port_sequence("Galois-Theory")
check("a name maps to a sequence, so a busy port is not a dead end", len(seq) > 1)
check("and the sequence has no repeats in it", len(set(seq)) == len(seq))
check("the first of the sequence is the ordinary port",
      seq[0] == boardlib.default_port("Galois-Theory"))
check("the same name gives the same sequence every time",
      boardlib.port_sequence("Galois-Theory") == seq)
check("every port in it is a real one", all(1024 < p < 65536 for p in seq))

# bin/board must agree with boardlib, or the two machines disagree about where a
# course lives -- which is the whole failure this design exists to prevent.
bspec = importlib.util.spec_from_loader(
    "boardcli",
    importlib.machinery.SourceFileLoader("boardcli", os.path.join(ROOT, "bin", "board")))
board = importlib.util.module_from_spec(bspec)
bspec.loader.exec_module(board)
check("bin/board and bin/follow derive the same port for a course",
      board.default_port("/somewhere/Probability")
      == follow.default_port("/elsewhere/Probability"))

# ---- the proxy follows the decision ---------------------------------------
#
# Stand in for the tailnet: a table of port -> what /health says there.

GAL = "/home/x/Galois-Theory"
PRB = "/home/x/Probability"
CANDS = [{"dir": "Galois-Theory", "root": GAL},
         {"dir": "Probability", "root": PRB}]
GAL_PORT = boardlib.default_port("Galois-Theory")
PRB_PORT = boardlib.default_port("Probability")

check("the fixture matches the real sort order this bug depended on",
      "Galois-Theory" < "Probability")

boards = {}


def fake_probe(host, port, timeout=2.0):
    return boards.get(int(port))


follow.probe = fake_probe


def health(name, root, chosen=None, chosen_port=None, at=None):
    doc = {"ok": True, "root": root, "dir": name}
    if chosen:
        doc["chosen"] = {"dir": chosen, "port": chosen_port}
        if at is not None:
            doc["chosen"]["at"] = at
    return doc


# Both boards up, Probability chosen: the proxy must move even though Galois
# answers first and always will.
boards = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Probability", chosen_port=PRB_PORT),
    PRB_PORT: health("Probability", PRB, chosen="Probability", chosen_port=PRB_PORT),
}
want = "Probability"
check("a chosen course is served even when another answers first",
      follow.remote_target("node", CANDS, want)[:2] == ("node", PRB_PORT))

# The choice is the current course: nothing moves.
boards = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Galois-Theory", chosen_port=GAL_PORT),
    PRB_PORT: health("Probability", PRB, chosen="Galois-Theory", chosen_port=GAL_PORT),
}
want = "Galois-Theory"
check("and when the first to answer is the chosen one, it keeps the address",
      follow.remote_target("node", CANDS, want)[:2] == ("node", GAL_PORT))

# Chosen course named, but its board is not up. Serve what there is rather than
# nothing -- an unreachable address is worse than the wrong lesson, because the
# wrong lesson can be tapped out of.
boards = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Probability", chosen_port=PRB_PORT),
}
want = "Probability"
check("a chosen course that is not running falls back to a board that is",
      follow.remote_target("node", CANDS, want)[:2] == ("node", GAL_PORT))

# Nobody has chosen anything yet.
boards = {GAL_PORT: health("Galois-Theory", GAL)}
want = None
check("with no choice recorded, whatever is up is served",
      follow.remote_target("node", CANDS, want)[:2] == ("node", GAL_PORT))

# Nothing is up at all.
boards = {}
want = None
check("and with nothing up, the compute node is not claimed",
      follow.remote_target("node", CANDS, want) is None)

# ---- identity, so a wrong number cannot become a wrong lesson --------------

# A board answering on a port that is not its own. Believing the number here is
# how somebody opens a Galois proof and is shown a probability problem set.
boards = {
    GAL_PORT: health("Probability", PRB, chosen="Probability", chosen_port=PRB_PORT),
    PRB_PORT: health("Probability", PRB, chosen="Probability", chosen_port=PRB_PORT),
}
want = "Probability"
check("a board on somebody else's port is not mistaken for them",
      follow.remote_target("node", CANDS, want)[:2] == ("node", PRB_PORT))

# The chosen course moved off its usual port -- a start that found it busy walks
# the sequence. The record on the serving machine knows; the proxy is told.
moved = boardlib.port_sequence("Probability")[1]
boards = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Probability", chosen_port=moved),
    moved: health("Probability", PRB, chosen="Probability", chosen_port=moved),
}
want = "Probability"
check("a course that had to move ports is still found, because it is named not guessed",
      follow.remote_target("node", CANDS, want)[:2] == ("node", moved))

# And if the published port is wrong, the sequence is walked rather than trusted.
boards = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Probability", chosen_port=54321),
    moved: health("Probability", PRB, chosen="Probability", chosen_port=54321),
}
want = "Probability"
check("a published port that is wrong is checked, not believed",
      follow.remote_target("node", CANDS, want)[:2] == ("node", moved))

check("and a port with a stranger on it is never handed the address",
      not follow.identifies_as({"ok": True, "dir": "Something-Else"}, "Probability"))
check("a health document with no identity in it identifies as nobody",
      not follow.identifies_as(None, "Probability"))

# ---- a course cloned here is taught here -----------------------------------
#
# The compute node used to win whenever it was serving, because that is where the
# data and the hardware are. It is not where the tutor is any more, so the rule is
# inverted: the machine that never sleeps and holds the repository hosts it, and
# the node is for a course this machine has not got. What must NOT follow from
# that is an address pointing at nothing -- preference settles a tie between two
# live boards and decides nothing else.
#
# Both sides are probed now, so the fixture has to tell them apart.

anywhere = {}


def two_sided_probe(host, port, timeout=2.0):
    return anywhere.get((host, int(port)))


follow.probe = two_sided_probe
follow.active_course = lambda cands: (cands[0] if cands else None)
follow.local_port = lambda c: boardlib.default_port(c["dir"])

HERE_ = "127.0.0.1"
NODE_ = "node"
LOCAL = [{"dir": "Galois-Theory", "root": GAL}]

# Both machines have a board for it. This is the whole feature.
anywhere = {(HERE_, GAL_PORT): health("Galois-Theory", GAL),
            (NODE_, GAL_PORT): health("Galois-Theory", GAL)}
check("with a board on both machines, the one holding the repository serves it",
      follow.choose_target(NODE_, LOCAL, "local")[0] == (HERE_, GAL_PORT))
check("and the old arrangement is still one word in the config",
      follow.choose_target(NODE_, LOCAL, "node")[0] == (NODE_, GAL_PORT))

# Preference is not a promise to serve nothing.
anywhere = {(NODE_, GAL_PORT): health("Galois-Theory", GAL)}
check("a preference for this machine never beats a board that is actually up",
      follow.choose_target(NODE_, LOCAL, "local")[0] == (NODE_, GAL_PORT))

anywhere = {(HERE_, GAL_PORT): health("Galois-Theory", GAL)}
check("and with only a local board, it is served whatever the preference says",
      follow.choose_target(NODE_, LOCAL, "node")[0] == (HERE_, GAL_PORT))

# Nothing anywhere: name the local port so the resume about to start a board
# there lands on a live address instead of waiting to be noticed.
anywhere = {}
check("with nothing up anywhere the address still points where one will come up",
      follow.choose_target(NODE_, LOCAL, "local")[0] == (HERE_, GAL_PORT))
check("and with no courses at all it points nowhere rather than somewhere wrong",
      follow.choose_target(NODE_, [], "local")[0] is None)

# A stranger on the local port is not this course, here any more than there.
anywhere = {(HERE_, GAL_PORT): health("Probability", PRB),
            (NODE_, GAL_PORT): health("Galois-Theory", GAL)}
check("a local board that is not this course does not win on being local",
      follow.choose_target(NODE_, LOCAL, "local")[0] == (NODE_, GAL_PORT))

# ---- a board nobody chose has no claim on the address -----------------------
#
# The one that cost a lesson. Somebody was mid-proof in Galois on the machine
# holding the repository, and an unrelated Probability board -- up on the other
# machine, teaching nobody -- took the address away from them. A refresh landed
# in the wrong course and the hub could not get them out.
#
# Nothing about that was a tie for `prefer` to break. A board that is merely
# running has no claim at all, and the fix is a rule ABOVE preference and above
# the allowance: a board serving the course that was chosen beats one that is
# not, on either machine.

import tempfile as _tf                                       # noqa: E402

_box = _tf.mkdtemp()
boardlib.CHOSEN = os.path.join(_box, "chosen.json")
boardlib.CONFIG_DIR = _box

BOTH = [{"dir": "Galois-Theory", "root": GAL}, {"dir": "Probability", "root": PRB}]

boardlib.remember_chosen("Galois-Theory", GAL)         # a person, just now
anywhere = {(HERE_, GAL_PORT): health("Galois-Theory", GAL),
            (NODE_, PRB_PORT): health("Probability", PRB,
                                      chosen="Probability", chosen_port=PRB_PORT)}
check("a course nobody chose does not take the address off the lesson",
      follow.choose_target(NODE_, BOTH, "local")[0] == (HERE_, GAL_PORT))
check("and it does not take it even on the machine the config prefers",
      follow.choose_target(NODE_, BOTH, "node")[0] == (HERE_, GAL_PORT))

# The same board, once it IS the chosen course: preference decides again, which
# is all preference was ever for.
boardlib.remember_chosen("Probability", PRB)
check("and the moment it is chosen, it is served",
      follow.choose_target(NODE_, BOTH, "local")[0] == (NODE_, PRB_PORT))

# ---- a course can be tapped from either machine -----------------------------
#
# The record is written wherever the hub was served from, so there are two of
# them and they disagree by design. The follower used to read only its own, so a
# course tapped in a hub served by the OTHER machine was recorded over there and
# never seen here: the tap started the board, moved nothing, and looked broken.
# Both records are read now and the newer one is the person's latest word.

boardlib.remember_chosen("Galois-Theory", GAL)
anywhere = {(HERE_, GAL_PORT): health("Galois-Theory", GAL),
            (NODE_, PRB_PORT): health("Probability", PRB, chosen="Probability",
                                      chosen_port=PRB_PORT, at=time.time() + 60)}
check("a course tapped on the other machine moves the address to it",
      follow.choose_target(NODE_, BOTH, "local")[0] == (NODE_, PRB_PORT))

anywhere[(NODE_, PRB_PORT)] = health("Probability", PRB, chosen="Probability",
                                     chosen_port=PRB_PORT, at=time.time() - 3600)
check("and an older choice over there never outranks this machine's own",
      follow.choose_target(NODE_, BOTH, "local")[0] == (HERE_, GAL_PORT))

check("a node too old to publish when it was chosen reads as ancient, not as now",
      follow.wanted_course({"dir": "Probability", "port": PRB_PORT}) == "Galois-Theory")

# And the last resort is unchanged: with no choice anywhere, whatever is up wins,
# because an address with nothing behind it is worse than the wrong lesson.
os.remove(boardlib.CHOSEN)
anywhere = {(NODE_, PRB_PORT): health("Probability", PRB)}
check("with nobody having chosen anything, a live board still gets the address",
      follow.choose_target(NODE_, BOTH, "local")[0] == (NODE_, PRB_PORT))

# ---- the machine being left is asked to wrap up ----------------------------
#
# Moving the address off the node used to happen only when the node had died,
# and a dead machine needs no telling. A policy that moves it off a node that is
# alive and teaching strands the tutor there: still waiting, still writing into a
# copy nobody can reach, and never given the one turn that writes HANDOFF.md.
# `/handover` existed for this and had no caller until now.

asked = []
follow.handover = lambda host, port, secret, log: asked.append((host, port, secret))

src = open(os.path.join(ROOT, "bin", "follow"), encoding="utf-8").read()
check("the follower only acts when the target actually changes",
      "if now and now != was" in src)
check("and asks the machine it is leaving to hand over",
      "handover(was[0], was[1], secret, log)" in src)
check("whenever the address leaves one machine for another, in either direction",
      "was[0] != now[0]" in src)
check("and a machine that is not answering is not asked at all",
      "if not probe(host, port, timeout=2.0):" in src)
check("the handover is a POST that carries the shared secret",
      '"X-Handover": secret' in src and 'method="POST"' in src)
check("and a machine that cannot be asked does not block the address moving",
      "could not ask %s to hand over" in src)
check("an unconfigured secret is said out loud rather than silently skipped",
      "no handover_secret configured" in src)

# The preference is configuration, like everything else that differs by machine.
check("which machine is preferred is configuration, not code",
      '"prefer"' in src and 'follow.get("prefer")' in src)
check("and it defaults to this one", 'or "local"' in src)

# ---- the record itself -----------------------------------------------------

import tempfile                                              # noqa: E402

box = tempfile.mkdtemp()
boardlib.CHOSEN = os.path.join(box, "chosen.json")
boardlib.CONFIG_DIR = box
check("with nothing recorded, nobody has chosen anything", boardlib.chosen_course() == {})
boardlib.remember_chosen("Probability", "/home/x/Probability")
rec = boardlib.chosen_course()
check("a choice is recorded and reads back", rec.get("dir") == "Probability")
check("and it carries when, so an old name cannot outrank an afternoon's work",
      isinstance(rec.get("at"), float))

with open(boardlib.CHOSEN, "w", encoding="utf-8") as fh:
    fh.write("{not json")
check("a corrupt record is nobody's choice rather than a crash",
      boardlib.chosen_course() == {})

# ---- who is allowed to record a choice -------------------------------------
# The record is a DECISION, and the whole reason it exists is that it cannot be
# derived from the filesystem: resuming a course touches its files, so "most
# recently used" is self-reinforcing. That protection was quietly lost, not by
# changing the record, but by letting machinery write it.
#
# `agent_start` spawns `tutor headless <course>`, and that command recorded a
# choice. Its callers are all timers -- a login hook, the periodic tool pull, a
# restart after a ship -- and `cmd_restart` calls it in a LOOP over the courses
# on the machine. So every tick handed the address to whichever course the loop
# happened to finish on, and because `tutor resume` READS that record to decide
# what to bring back, the wrong course then re-elected itself for ever. A person
# tapping the right one in the hub was overwritten by the next tick, which is
# what "clicking Galois does nothing" looked like from an iPad.
#
# The rule now: machinery marks its spawn `--respawn` and records nothing; the
# entry points that are a person naming a course do the recording themselves.
print()

import subprocess                                            # noqa: E402

src_tutor = open(os.path.join(ROOT, "bin", "tutor"), encoding="utf-8").read()
i = src_tutor.index("def agent_start(")
check("every daemon machinery starts is marked as a respawn",
      '"--respawn"' in src_tutor[i:i + 2000])

home = tempfile.mkdtemp()
courses_dir = os.path.join(home, "courses")
for name in ("Galois-Theory", "Probability"):
    os.makedirs(os.path.join(courses_dir, name, "live"), exist_ok=True)
    open(os.path.join(courses_dir, name, "tutorboard.json"), "w").write("{}")

cfg_dir = os.path.join(home, "config", "tutor-board")
os.makedirs(cfg_dir, exist_ok=True)
with open(os.path.join(cfg_dir, "config.json"), "w", encoding="utf-8") as fh:
    json.dump({"courses_dir": courses_dir}, fh)
chosen = os.path.join(cfg_dir, "chosen.json")

env = dict(os.environ, XDG_CONFIG_HOME=os.path.join(home, "config"),
           BOARD_STATE_DIR=os.path.join(home, "state"))


def run_headless(*extra):
    subprocess.run([sys.executable, os.path.join(ROOT, "bin", "tutor"), "headless",
                    "Probability", "--agent", "nosuchagent"] + list(extra),
                   env=env, cwd=home, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, timeout=120)


def recorded():
    try:
        with open(chosen, encoding="utf-8") as fh:
            return (json.load(fh) or {}).get("dir")
    except (OSError, ValueError):
        return None


boardlib.remember_chosen.__doc__      # (the record under test is the file, not this process)
with open(chosen, "w", encoding="utf-8") as fh:
    json.dump({"dir": "Galois-Theory", "root": os.path.join(courses_dir, "Galois-Theory"),
               "at": 1.0}, fh)

run_headless("--respawn")
check("a daemon put back by machinery does not touch the person's choice",
      recorded() == "Galois-Theory")

run_headless()
check("and a person naming a course on the command line still records it",
      recorded() == "Probability")

check("the flag is a flag: the parser knows it, so it is never taken for a course",
      'elif a == "--respawn":' in src_tutor)

# The other half of the rule: the entry points that ARE a person still record.
i = src_tutor.index('if sub == "start":')
check("tutor agent start records the course somebody named",
      "remember_course(course)" in src_tutor[i:i + 1200])
check("and so does a tap in the hub",
      "remember_chosen" in open(os.path.join(ROOT, "serve.py"), encoding="utf-8").read())

# --- one course, one place ---------------------------------------------------
print("\n-- a tap does not start a second board, or a second tutor --")

serve_src = open(os.path.join(ROOT, "serve.py"), encoding="utf-8").read()
follow_src = open(os.path.join(ROOT, "bin", "follow"), encoding="utf-8").read()

check("the choice is recorded whatever else the tap does",
      'boardlib.remember_chosen(match["repo"], target)' in serve_src)
check("but a second board is only started when nothing else is serving that "
      "course -- asked over the tailnet, not assumed from the machine's role",
      "elsewhere = None if mine else boardlib.locate_course(" in serve_src
      and "if mine or not elsewhere:" in serve_src)
check("the tailnet name is only taken by a machine that owns it -- otherwise the "
      "follower and the tap re-point it at each other, every tick",
      'if shape == "standalone":' in serve_src)
check("and a tutor is started only where the course is actually served, so one "
      "lesson never gets two",
      serve_src.count('tutor_cli(["agent", "start", match["repo"]])') == 1
      and "is serving this course; the address follows" in serve_src)

check("a board listens on the tailnet as well as loopback, or the other machine "
      "can never see it and the address can only ever point at home",
      "boardlib.tailnet_addresses()" in serve_src
      and "second.serve_forever" in serve_src)
# The half that was missed the first time, and missing it made the rest useless.
#
# The follower found the other machine's BOARD through the peer walk and then
# asked the CONFIGURED hostname what had been chosen -- so a tap on the far
# machine was recorded, published in its `/health`, correct in every way, and
# invisible. The address stayed where it was while both machines said plainly
# that somebody had asked for the other course. Reproduced by hand: `chosen` read
# `Galois-Theory` on both sides for a full minute while the address served
# Probability.
check("the choice is read from whoever answers, not from a configured hostname",
      "hosts += [h for h in boardlib.tailnet_peers() if h != node]" in follow_src)
check("and one probe implementation for both machines, so the machine that needs "
      "the SOCKS proxy is not the one asking without it",
      "return boardlib.board_health(host, port, timeout=timeout)" in follow_src)
check("the walk covers every course, because the other machine is running the "
      "ones it is running and not the four this one lists first",
      "for c in cands:" in follow_src and "cands[:4]" not in follow_src)
check("and an ordinary tick is one request, because whoever answered last is "
      "asked first",
      "if _ASKED[0] and _ASKED[1]:" in follow_src)

# The follower does not decide from its own filesystem alone.
#
# It reads the record off disk, and it is not always reading the same disk view a
# board is: this process is started by launchd with whatever environment launchd
# gives it, the boards are started from a session, and when those disagree the
# follower is deciding from a file nobody writes to. Found the hard way -- the
# address served Probability for ten minutes while every board on both machines
# published `chosen: Galois-Theory`.
check("the choice is also taken from a board on this machine, which is the same "
      "record read by something that definitely wrote it",
      "def local_choice(" in follow_src
      and "want = wanted_course(remote_choice, local_choice(cands))" in follow_src)
check("and the newest of the three wins, whoever is reporting it",
      "for rec in (boardlib.chosen_course(), local_published, remote_choice):"
      in follow_src)
check("and phones are not knocked on at all",
      '"ios", "android"' in open(os.path.join(ROOT, "boardlib.py"), encoding="utf-8").read())

check("a board publishes whether it has a tutor at all",
      '"tutor": agent.get("state") or None' in serve_src)
check("and the follower prefers a board with one over an empty room",
      "def has_tutor(" in follow_src and "withtutor" in follow_src)

print("\n%d FAILURES" % len(errors) if errors else "\nthe address follows the choice")
sys.exit(1 if errors else 0)
