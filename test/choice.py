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


def health(name, root, chosen=None, chosen_port=None):
    doc = {"ok": True, "root": root, "dir": name}
    if chosen:
        doc["chosen"] = {"dir": chosen, "port": chosen_port}
    return doc


# Both boards up, Probability chosen: the proxy must move even though Galois
# answers first and always will.
boards = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Probability", chosen_port=PRB_PORT),
    PRB_PORT: health("Probability", PRB, chosen="Probability", chosen_port=PRB_PORT),
}
check("a chosen course is served even when another answers first",
      follow.remote_target("node", CANDS) == ("node", PRB_PORT))

# The choice is the current course: nothing moves.
boards = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Galois-Theory", chosen_port=GAL_PORT),
    PRB_PORT: health("Probability", PRB, chosen="Galois-Theory", chosen_port=GAL_PORT),
}
check("and when the first to answer is the chosen one, it keeps the address",
      follow.remote_target("node", CANDS) == ("node", GAL_PORT))

# Chosen course named, but its board is not up. Serve what there is rather than
# nothing -- an unreachable address is worse than the wrong lesson, because the
# wrong lesson can be tapped out of.
boards = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Probability", chosen_port=PRB_PORT),
}
check("a chosen course that is not running falls back to a board that is",
      follow.remote_target("node", CANDS) == ("node", GAL_PORT))

# Nobody has chosen anything yet.
boards = {GAL_PORT: health("Galois-Theory", GAL)}
check("with no choice recorded, whatever is up is served",
      follow.remote_target("node", CANDS) == ("node", GAL_PORT))

# Nothing is up at all.
boards = {}
check("and with nothing up, the compute node is not claimed",
      follow.remote_target("node", CANDS) is None)

# ---- identity, so a wrong number cannot become a wrong lesson --------------

# A board answering on a port that is not its own. Believing the number here is
# how somebody opens a Galois proof and is shown a probability problem set.
boards = {
    GAL_PORT: health("Probability", PRB, chosen="Probability", chosen_port=PRB_PORT),
    PRB_PORT: health("Probability", PRB, chosen="Probability", chosen_port=PRB_PORT),
}
check("a board on somebody else's port is not mistaken for them",
      follow.remote_target("node", CANDS) == ("node", PRB_PORT))

# The chosen course moved off its usual port -- a start that found it busy walks
# the sequence. The record on the serving machine knows; the proxy is told.
moved = boardlib.port_sequence("Probability")[1]
boards = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Probability", chosen_port=moved),
    moved: health("Probability", PRB, chosen="Probability", chosen_port=moved),
}
check("a course that had to move ports is still found, because it is named not guessed",
      follow.remote_target("node", CANDS) == ("node", moved))

# And if the published port is wrong, the sequence is walked rather than trusted.
boards = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Probability", chosen_port=54321),
    moved: health("Probability", PRB, chosen="Probability", chosen_port=54321),
}
check("a published port that is wrong is checked, not believed",
      follow.remote_target("node", CANDS) == ("node", moved))

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

print("\n%d FAILURES" % len(errors) if errors else "\nthe address follows the choice")
sys.exit(1 if errors else 0)
