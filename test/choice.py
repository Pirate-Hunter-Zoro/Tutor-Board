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

from tutorboard import choice, paths, ports
from tutorboard.net import boards, tailscale
import tempfile as _tf                                       # noqa: E402

# And it must not read THIS machine's own record either. Every check below about
# which board wins goes through `wanted_host` and `wanted_course`, both of which
# read `chosen.json` -- so with a real one on disk the answers depend on whatever
# course somebody last tapped on the machine running the tests. That is not a
# fixture, it is the evening's state leaking into a suite, and it hid here for a
# while: the preference checks passed while the real record happened to name no
# host, and failed the moment one did. Isolated at the top, before anything
# decides anything, rather than half way down where it used to be.
_ISOLATED = _tf.mkdtemp(prefix="tutor-choice-")
paths.CONFIG_DIR = _ISOLATED
paths.CHOSEN = os.path.join(_ISOLATED, "chosen.json")
check("the suite decides from a fixture, not from this machine's own record",
      choice.chosen_course() == {})

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
    seen.setdefault(ports.default_port(n), []).append(n)
clashes = dict((p, v) for p, v in seen.items() if len(v) > 1)
check("no two courses on this machine derive the same port", not clashes)
if clashes:
    print("     " + repr(clashes))

check("Mathematical-Modeling and Research-Journey are no longer the same board",
      ports.default_port("Mathematical-Modeling")
      != ports.default_port("Research-Journey"))

seq = ports.port_sequence("Galois-Theory")
check("a name maps to a sequence, so a busy port is not a dead end", len(seq) > 1)
check("and the sequence has no repeats in it", len(set(seq)) == len(seq))
check("the first of the sequence is the ordinary port",
      seq[0] == ports.default_port("Galois-Theory"))
check("the same name gives the same sequence every time",
      ports.port_sequence("Galois-Theory") == seq)
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
GAL_PORT = ports.default_port("Galois-Theory")
PRB_PORT = ports.default_port("Probability")

check("the fixture matches the real sort order this bug depended on",
      "Galois-Theory" < "Probability")

answering = {}


def fake_probe(host, port, timeout=2.0):
    return answering.get(int(port))


follow.probe = fake_probe


def health(name, root, chosen=None, chosen_port=None, at=None):
    doc = {"ok": True, "root": root, "dir": name}
    if chosen:
        doc["chosen"] = {"dir": chosen, "port": chosen_port}
        if at is not None:
            doc["chosen"]["at"] = at
    return doc


# Both answering up, Probability chosen: the proxy must move even though Galois
# answers first and always will.
answering = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Probability", chosen_port=PRB_PORT),
    PRB_PORT: health("Probability", PRB, chosen="Probability", chosen_port=PRB_PORT),
}
want = "Probability"
check("a chosen course is served even when another answers first",
      follow.remote_target("node", CANDS, want)[:2] == ("node", PRB_PORT))

# The choice is the current course: nothing moves.
answering = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Galois-Theory", chosen_port=GAL_PORT),
    PRB_PORT: health("Probability", PRB, chosen="Galois-Theory", chosen_port=GAL_PORT),
}
want = "Galois-Theory"
check("and when the first to answer is the chosen one, it keeps the address",
      follow.remote_target("node", CANDS, want)[:2] == ("node", GAL_PORT))

# Chosen course named, but its board is not up. Serve what there is rather than
# nothing -- an unreachable address is worse than the wrong lesson, because the
# wrong lesson can be tapped out of.
answering = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Probability", chosen_port=PRB_PORT),
}
want = "Probability"
check("a chosen course that is not running falls back to a board that is",
      follow.remote_target("node", CANDS, want)[:2] == ("node", GAL_PORT))

# Nobody has chosen anything yet.
answering = {GAL_PORT: health("Galois-Theory", GAL)}
want = None
check("with no choice recorded, whatever is up is served",
      follow.remote_target("node", CANDS, want)[:2] == ("node", GAL_PORT))

# Nothing is up at all.
answering = {}
want = None
check("and with nothing up, the compute node is not claimed",
      follow.remote_target("node", CANDS, want) is None)

# ---- identity, so a wrong number cannot become a wrong lesson --------------

# A board answering on a port that is not its own. Believing the number here is
# how somebody opens a Galois proof and is shown a probability problem set.
answering = {
    GAL_PORT: health("Probability", PRB, chosen="Probability", chosen_port=PRB_PORT),
    PRB_PORT: health("Probability", PRB, chosen="Probability", chosen_port=PRB_PORT),
}
want = "Probability"
check("a board on somebody else's port is not mistaken for them",
      follow.remote_target("node", CANDS, want)[:2] == ("node", PRB_PORT))

# The chosen course moved off its usual port -- a start that found it busy walks
# the sequence. The record on the serving machine knows; the proxy is told.
moved = ports.port_sequence("Probability")[1]
answering = {
    GAL_PORT: health("Galois-Theory", GAL, chosen="Probability", chosen_port=moved),
    moved: health("Probability", PRB, chosen="Probability", chosen_port=moved),
}
want = "Probability"
check("a course that had to move ports is still found, because it is named not guessed",
      follow.remote_target("node", CANDS, want)[:2] == ("node", moved))

# And if the published port is wrong, the sequence is walked rather than trusted.
answering = {
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
# live answering and decides nothing else.
#
# Both sides are probed now, so the fixture has to tell them apart.

anywhere = {}


def two_sided_probe(host, port, timeout=2.0):
    return anywhere.get((host, int(port)))


follow.probe = two_sided_probe
follow.active_course = lambda cands: (cands[0] if cands else None)
follow.local_port = lambda c: ports.default_port(c["dir"])

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

_box = _tf.mkdtemp()
paths.CHOSEN = os.path.join(_box, "chosen.json")
paths.CONFIG_DIR = _box

BOTH = [{"dir": "Galois-Theory", "root": GAL}, {"dir": "Probability", "root": PRB}]

choice.remember_chosen("Galois-Theory", GAL)         # a person, just now
anywhere = {(HERE_, GAL_PORT): health("Galois-Theory", GAL),
            (NODE_, PRB_PORT): health("Probability", PRB,
                                      chosen="Probability", chosen_port=PRB_PORT)}
check("a course nobody chose does not take the address off the lesson",
      follow.choose_target(NODE_, BOTH, "local")[0] == (HERE_, GAL_PORT))
check("and it does not take it even on the machine the config prefers",
      follow.choose_target(NODE_, BOTH, "node")[0] == (HERE_, GAL_PORT))

# The same board, once it IS the chosen course: preference decides again, which
# is all preference was ever for.
choice.remember_chosen("Probability", PRB)
check("and the moment it is chosen, it is served",
      follow.choose_target(NODE_, BOTH, "local")[0] == (NODE_, PRB_PORT))

# ---- a course can be tapped from either machine -----------------------------
#
# The record is written wherever the hub was served from, so there are two of
# them and they disagree by design. The follower used to read only its own, so a
# course tapped in a hub served by the OTHER machine was recorded over there and
# never seen here: the tap started the board, moved nothing, and looked broken.
# Both records are read now and the newer one is the person's latest word.

choice.remember_chosen("Galois-Theory", GAL)
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
os.remove(paths.CHOSEN)
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
paths.CHOSEN = os.path.join(box, "chosen.json")
paths.CONFIG_DIR = box
check("with nothing recorded, nobody has chosen anything", choice.chosen_course() == {})
choice.remember_chosen("Probability", "/home/x/Probability")
rec = choice.chosen_course()
check("a choice is recorded and reads back", rec.get("dir") == "Probability")
check("and it carries when, so an old name cannot outrank an afternoon's work",
      isinstance(rec.get("at"), float))

with open(paths.CHOSEN, "w", encoding="utf-8") as fh:
    fh.write("{not json")
check("a corrupt record is nobody's choice rather than a crash",
      choice.chosen_course() == {})

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
# The whole of `agent_start`, rather than a fixed number of characters from its
# head: a window measured in bytes fails the moment somebody explains something
# in the function, which is not a property worth asserting.
i = src_tutor.index("def agent_start(")
agent_start_src = src_tutor[i:src_tutor.index("def agent_stop(", i)]
check("every daemon machinery starts is marked as a respawn",
      '"--respawn"' in agent_start_src)

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


choice.remember_chosen.__doc__      # (the record under test is the file, not this process)
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
def source(*parts):
    return open(os.path.join(ROOT, *parts), encoding="utf-8").read()


# The board is a package now, so "is this rule written down" and "where is it
# written down" are two different questions and both are worth asking. The
# second one is asked directly, below; the first reads the server as a whole,
# because a rule moving from one module to a better one is not a regression.
SERVER = []
for _dir, _subs, _files in os.walk(os.path.join(ROOT, "tutorboard")):
    _subs[:] = [d for d in _subs if d != "__pycache__"]
    for _f in sorted(_files):
        if _f.endswith(".py"):
            SERVER.append(open(os.path.join(_dir, _f), encoding="utf-8").read())
serve_src = "\n".join(SERVER)

# And where each of them lives, so the organisation is a promise rather than a
# state of affairs. A route that drifts back into a nine-hundred-line handler
# fails here rather than being noticed a year later.
check("the routes are split by what they are about, not piled into one handler",
      'if path == "/switch":' in source("tutorboard", "server", "routes", "machines.py")
      and 'if path == "/slate/save":' in source("tutorboard", "server", "routes", "writing.py")
      and 'if path == "/push":' in source("tutorboard", "server", "routes", "saving.py"))
check("and the handler keeps the plumbing and the table, nothing else",
      "def do_GET" in source("tutorboard", "server", "handler.py")
      and 'if path == "/switch":' not in source("tutorboard", "server", "handler.py"))
check("the entry point is an entry point",
      len(source("serve.py").splitlines()) < 40)

check("and so does a tap in the hub", "remember_chosen" in serve_src)

# --- one course, one place ---------------------------------------------------
print("\n-- a tap does not start a second board, or a second tutor --")

follow_src = open(os.path.join(ROOT, "bin", "follow"), encoding="utf-8").read()

check("the choice is recorded whatever else the tap does",
      'choice.remember_chosen(match["repo"], target,' in serve_src)
check("but a second board is only started when nothing else is serving that "
      "course -- asked over the tailnet, not assumed from the machine's role",
      "elsewhere = None if mine else boards.locate_course(" in serve_src
      and "if mine or not elsewhere:" in serve_src)
check("the tailnet name is only taken by a machine that owns it -- otherwise the "
      "follower and the tap re-point it at each other, every tick",
      'if shape == "standalone":' in serve_src)
check("and a tutor is started only where the course is actually served, so one "
      "lesson never gets two",
      serve_src.count('tutor_cli(["agent", "start", match["repo"]])') == 2
      and "is serving this course; the address follows" in serve_src)

check("a board listens on the tailnet as well as loopback, or the other machine "
      "can never see it and the address can only ever point at home",
      "tailscale.tailnet_addresses()" in serve_src
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
      "hosts += [h for h in tailscale.tailnet_peers() if h != node]" in follow_src)
check("and one probe implementation for both machines, so the machine that needs "
      "the SOCKS proxy is not the one asking without it",
      "health = boards.board_health(host, port, timeout=timeout)" in follow_src)
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
# gives it, the answering are started from a session, and when those disagree the
# follower is deciding from a file nobody writes to. Found the hard way -- the
# address served Probability for ten minutes while every board on both machines
# published `chosen: Galois-Theory`.
check("the choice is also taken from a board on this machine, which is the same "
      "record read by something that definitely wrote it",
      "def local_choice(" in follow_src
      and "published = local_choice(cands)" in follow_src
      and "want = wanted_course(remote_choice, published)" in follow_src)
check("and the newest of the three wins, whoever is reporting it",
      "for rec in (choice.chosen_course(), local_published, remote_choice):"
      in follow_src)
check("and phones are not knocked on at all",
      '"ios", "android"' in open(os.path.join(ROOT, "tutorboard", "net", "tailscale.py"), encoding="utf-8").read())

# The host is a choice, and it is the person's.
#
# Which courses exist is a property of a MACHINE -- they are whatever is cloned
# next to the board -- so a course name can mean two different clones and the
# hub was only ever showing one machine's list. Measured on the pair: the Mac
# has five course repositories, the compute node has nine. "Galois Theory is the
# only option" was that, exactly.
check("the hub can ask what machines are up and what each of them has",
      'if path == "/hosts.json":' in serve_src and "def peer_hosts(" in serve_src)
check("a machine's list comes from a board on that machine, which is the only "
      "thing that knows what is cloned there",
      '"/courses.json", timeout=2.0' in serve_src)
check("the walk happens off the request, so the hub opens now and fills in",
      "_HOSTS" in serve_src and "threading.Thread(target=refresh, daemon=True)" in serve_src)
check("a course can be started on the machine that has it, from a hub on the "
      "other one",
      'if path == "/start":' in serve_src)
check("and choosing a course on a named machine records both",
      'choice.remember_chosen(want, "", host=on_host, at=rec_at)' in serve_src)
check("the record carries the host",
      "def remember_chosen(name, root, host=None, at=None):"
      in open(os.path.join(ROOT, "tutorboard", "choice.py"), encoding="utf-8").read())
# And it is PUBLISHED, which is the half that never left the machine it was
# written on. `wanted_host` reads the host off whichever record is newest,
# including ones it gets by asking a board -- and a board published the course,
# the port and the time and not the host. So a choice made anywhere but the
# follower's own machine arrived with the host blank and rule 0 could not fire:
# the person picked the node, the record said the node, and the address went
# wherever `prefer` liked.
check("and a board publishes the host, or a choice of machine never leaves it",
      '"at": rec.get("at") or 0, "host": rec.get("host") or ""' in serve_src)
check("and a named machine decides the address, above every preference, but "
      "only among answering serving the course that was chosen too",
      "def wanted_host(" in follow_src and "if want_host:" in follow_src)

# A tap that is recorded and then waited on is a tap that did not work. The
# follower re-decides on an interval because asking the other machine costs a
# walk of the tailnet, but noticing that somebody chose something is one `stat`,
# and thirty seconds of nothing happening after a tap is the difference between
# switching courses and wondering whether the board is broken.
check("a tap does not wait out the follower's interval",
      "def _choice_stamp(" in follow_src
      and "if _choice_stamp() != stamp:" in follow_src)
check("and it is the choice being written that breaks the wait, not a timer",
      "os.stat(paths.CHOSEN)" in follow_src)
check("while re-deciding still costs the interval, because asking is not free",
      "while waited < interval:" in follow_src)

# The proxy is bounced with `kickstart -k` on every pulled fix, and a socket in
# TIME_WAIT beat the replacement to the bind: exit 1, launchd again, and the log
# a person reads to find out where the address went filled with tracebacks.
check("the proxy survives its own restart",
      "class Listener(socketserver.ThreadingTCPServer):" in follow_src
      and "allow_reuse_address = True" in follow_src)
check("and a port somebody else holds is one line, not a traceback",
      "leaving the follower that has it alone" in follow_src)

check("a board publishes whether it has a tutor at all",
      '"tutor": agent.get("state") or None' in serve_src)
check("and the follower prefers a board with one over an empty room",
      "def has_tutor(" in follow_src and "withtutor" in follow_src)

# ---- one tap, one record, on every machine at once --------------------------
#
# Reported in these words: "I just had to type Galois Theory ten fucking times
# to switch to it from Probability, and then it just switched back."
#
# Three separate things were behind it and each one is guarded below. The first:
# the record a tap writes is the only thing both machines can read, and each one
# wrote only its own copy. The other side found out by being ASKED, on the
# follower's next tick, up to thirty seconds later -- and the fast wake above
# watches a file that only a local tap ever touches, so a tap on the machine
# that was not holding the address woke nobody. A tap is an event and can simply
# be sent.
check("a tap is relayed to every machine that can hear it, not waited for",
      "def announce_choice(" in serve_src and "def announce_later(" in serve_src)
check("and a board has somewhere to receive one",
      'if path == "/chose":' in serve_src)
check("which records and nothing else -- no board, no tutor, no address",
      "choice.remember_chosen(want, root if os.path.isdir(root) else \"\","
      in serve_src)
check("every path that records a choice relays it: the hub's own machine,",
      serve_src.count("announce_later(") >= 3)
check("and the relay keeps the original time, so two clocks cannot disagree "
      "about one tap",
      "at=rec_at" in serve_src and "def remember_chosen(name, root, host=None, at=None):"
      in open(os.path.join(ROOT, "tutorboard", "choice.py"), encoding="utf-8").read())
check("a relay that says what is already recorded rewrites nothing, because "
      "the file's own mtime is what wakes a follower",
      'if have.get("dir") == want and mine_at >= at:' in serve_src)
check("and a genuinely ancient relay is junk rather than a decision",
      "at < time.time() - machines.RELAY_STALE" in serve_src)
# What is deliberately NOT there: deciding which of two records is newer by
# comparing timestamps that came off two different machines' clocks. A relay is
# sent the instant somebody taps, so arriving at all is the evidence -- and
# rejecting a person's tap because the other machine's clock reads earlier is a
# failure that would be invisible from an iPad.
check("and a tap is never refused for what another machine's clock says",
      "if mine_at > at:" not in serve_src)
check("and a relayed name is a name, never a path",
      "want != multipart.safe_filename(want)" in serve_src)

# The second: the fast wake watched a file this process may not share. The
# follower is started by launchd with launchd's environment; the answering are
# started from a session. When those two disagree the stat never changes and
# every tap waits out the full interval -- which is most of "ten times".
check("and the wake asks a board as well as reading a file, because those are "
      "not always the same answer",
      "def _published_stamp(" in follow_src
      and "if now_pub != published:" in follow_src)
# But an unanswered probe is "I could not ask", never "it changed". Without that
# one refused connection a second is one full re-decision a second, each of them
# a fresh set of tailnet probes and another chance for a timeout to move the
# address -- a wake added to make a tap instant, turning a slow wobble into a
# fast one.
check("and a probe it could not make does not count as a change",
      "if now_pub is None:" in follow_src and "learned it; that is not a change"
      in follow_src)

# The third, and the one that made it switch BACK: a running board writes into
# its own live/ constantly, so the course being LEFT went on touching its
# directory and overtook the recorded choice within seconds of the tap.
_box2 = _tf.mkdtemp()
paths.CHOSEN = os.path.join(_box2, "chosen.json")
paths.CONFIG_DIR = _box2
for _n in ("Galois-Theory", "Probability"):
    os.makedirs(os.path.join(_box2, _n, "live"), exist_ok=True)
PAIR = [{"dir": "Galois-Theory", "root": os.path.join(_box2, "Galois-Theory")},
        {"dir": "Probability", "root": os.path.join(_box2, "Probability")}]
# A fresh copy of the module: the section above replaced `active_course` with a
# stub to keep the preference fixtures honest, and asking a stub what it thinks
# proves nothing.
_spec2 = importlib.util.spec_from_loader(
    "followcli2",
    importlib.machinery.SourceFileLoader("followcli2", os.path.join(ROOT, "bin", "follow")))
follow2 = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(follow2)
choice.remember_chosen("Galois-Theory", PAIR[0]["root"])
# Probability's board goes on writing, as a live board does, every second.
time.sleep(0.02)
with open(os.path.join(PAIR[1]["root"], "live", "state.json"), "w") as fh:
    fh.write("{}")
check("a course that is merely busy does not overtake the one that was chosen",
      follow2.active_course(PAIR)["dir"] == "Galois-Theory")
# And with nobody having chosen anything, the most recently worked course is
# still the honest answer -- it is the only question a modification time can
# actually answer.
os.remove(paths.CHOSEN)
check("and with no choice recorded, the most recently worked one is served",
      follow2.active_course(PAIR)["dir"] == "Probability")

# ---- and the hub waits for the address to actually move ---------------------
#
# The last of it, and the most direct: the page fired /switch, waited 700ms and
# reloaded. The follower had not moved the address yet, so the reload landed on
# the board being tapped AWAY from -- which is indistinguishable from a tap that
# did nothing. So you tap it again. Ten times.
home_src = open(os.path.join(ROOT, "web", "home.js"), encoding="utf-8").read()
check("the hub no longer reloads on a timer and hopes",
      "setTimeout(function () { location.href" not in home_src)
check("it waits until the address serves what was asked for",
      "function waitForAddress(" in home_src and "h.dir === repo" in home_src)
check("on the machine that was asked for, when one was named",
      "sameHost(h.host, host)" in home_src)
check("and a board says which machine it is, so that can be checked",
      '"host": tailscale.tailnet_self() or ""' in serve_src)
check("a second tap while one is in flight is not a second switch",
      "if (moving) return;" in home_src)
check("and when it does not land, it says so instead of reloading",
      "still on the old board" in home_src)
# And a machine, once found, is not lost again between refreshes. The walk that
# finds a peer's board only knows the courses cloned HERE, and the two machines
# are not the same list -- five courses on one of this pair and nine on the
# other -- so a peer whose only board is a course this machine has not got is
# invisible to it. A hub that loses a machine is a machine you cannot switch to.
check("a machine that answered once is asked at that port first",
      "_PEER_PORT" in serve_src and "was = _PEER_PORT.get(host)" in serve_src)

sw_src = open(os.path.join(ROOT, "web", "sw.js"), encoding="utf-8").read()
check("the health check is never answered out of the cache",
      "health" in sw_src.split("var LIVE")[1].split("\n")[0])

# ---- and the address does not flicker ---------------------------------------
#
# Reported from the board, mid-lesson: "The board keeps flickering..." -- and the
# state it was reported in is the fixture below. A Galois board with a tutor on
# the compute node, an empty Galois board on the Mac, both up, both claiming the
# same chosen course. The lesson appeared and vanished on the iPad as the address
# traded between them.
#
# Two causes, and the first is the one worth keeping a test for: deciding asked
# each board over the tailnet THREE separate times -- once to find it, once for
# `has_tutor`, once for `limited` -- and neither of the last two can tell "it
# said no" from "it did not answer". So a board could be alive enough to hold the
# address and, in the same decision, have no tutor, because one probe timed out
# where another did not.

follow._HEALTH.clear()

flaky = {"n": 0}
NODE_HEALTH = health("Galois-Theory", GAL, chosen="Galois-Theory", chosen_port=GAL_PORT)
NODE_HEALTH["tutor"] = "listening"
MAC_HEALTH = health("Galois-Theory", GAL, chosen="Galois-Theory", chosen_port=GAL_PORT)
MAC_HEALTH["tutor"] = None


def flaky_probe(host, port, timeout=2.0):
    """The node answers, except on every second question about it."""
    if host == HERE_:
        return MAC_HEALTH
    flaky["n"] += 1
    return NODE_HEALTH if flaky["n"] % 2 else None


follow.probe = flaky_probe
choice.remember_chosen("Galois-Theory", GAL)
follow.active_course = lambda cands: (cands[0] if cands else None)

# Without a memo, the three questions disagree and the empty board wins. With
# one, every question about a board in one decision gets the same answer.
picked = set()
for _ in range(6):
    flaky["n"] = 0
    got = follow.choose_target(NODE_, LOCAL, "local")[0]
    picked.add(got)
check("one flaky machine cannot make one decision contradict itself",
      len(picked) == 1)

# The memo is inside the real `probe`, and this module's copy has been
# monkeypatched all the way down the file -- so ask the untouched one.
follow2._HEALTH.clear()
asked = {"n": 0}
_real_health = boards.board_health
boards.board_health = lambda host, port, timeout=2.0: (asked.update(n=asked["n"] + 1)
                                                         or NODE_HEALTH)
try:
    follow2.probe("somewhere", 9999)
    follow2.probe("somewhere", 9999)
    follow2.probe("somewhere", 9999)
    check("a board is asked once for one decision, not once per question",
          asked["n"] == 1)
    follow2._HEALTH[("somewhere", 9999)] = (0.0, None)    # older than the memo
    follow2.probe("somewhere", 9999)
    check("and it is a memo, not a cache: the next decision asks again",
          asked["n"] == 2)
finally:
    boards.board_health = _real_health
    follow2._HEALTH.clear()

# The second cause: even a decision that is internally consistent can disagree
# with the last one. A move the CHOICE did not ask for has to say the same thing
# twice, and only while the board holding the address is still answering for the
# course that was chosen -- a tap moves at once, and so does the incumbent dying.
src2 = open(os.path.join(ROOT, "bin", "follow"), encoding="utf-8").read()
check("a move nobody asked for must say the same thing twice",
      "pending" in src2 and "not moving to %s:%d yet" in src2)
check("and that only applies while the choice is unchanged",
      "want == was_want" in src2)
check("and while the board holding the address still answers for it",
      'identifies_as(probe(was[0], was[1]), want or "")' in src2)
check("so a tap is never delayed by it",
      "choose_target" in src2 and "was_want = want" in src2)
check("and the decision says which course it decided for, which is how those "
      "two are told apart",
      "return (t[0], t[1]), w, want" in src2)

print("\n%d FAILURES" % len(errors) if errors else "\nthe address follows the choice")
sys.exit(1 if errors else 0)
