#!/usr/bin/env python3
"""The one address opens the course a person chose, not the one sorted first.

The iPad app has one origin baked into it, and which lesson that origin opens is
a decision: a tap in the hub records the course, the board serving it takes the
tailnet name, and everything else follows from those two. What it must never be
is a race -- with a Galois board and a Probability board both up, "whichever
answers first" is alphabetical order wearing a disguise, and tapping Probability
did every correct thing while the address went on opening Galois for ever.

Three rules, and this file holds them:

  - the choice is a record a PERSON wrote, never a derivation. Resuming a course
    touches its files, so "most recently used" is self-reinforcing;
  - a board says who it is, and nothing is served without that answer matching --
    a port is derived from a name, and derivation is not proof;
  - and the machine that starts a board is the machine that moves the address to
    it, in the same request, because nothing else is going to.

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
from tutorboard.net import tailscale
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
check("bin/board and boardlib derive the same port for a course",
      board.default_port("/somewhere/Probability")
      == ports.default_port("Probability"))

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

check("the choice is recorded whatever else the tap does",
      'choice.remember_chosen(match["repo"], target,' in serve_src)
check("the machine that starts the board takes the tailnet name for it, in the "
      "same request -- the tap is a person naming the course they want, and "
      "nothing else is going to move the address for them",
      'spawn.board_cli(target, ["vpn", "serve"])' in serve_src
      and '"address": vcode == 0' in serve_src)
check("and the tutor follows the course, so one lesson never gets two",
      serve_src.count('tutor_cli(["agent", "start", match["repo"]])') == 1)

check("a board listens on the tailnet as well as loopback, or the app can only "
      "reach it from the machine it is running on",
      "tailscale.tailnet_addresses()" in serve_src
      and "second.serve_forever" in serve_src)

check("a board publishes whether it has a tutor at all",
      '"tutor": agent.get("state") or None' in serve_src)

# ---- and the hub waits for the address to actually move ---------------------
#
# The most direct of it: the page fired /switch, waited 700ms and reloaded.
# Nothing had moved the address yet, so the reload landed on the board being
# tapped AWAY from -- which is indistinguishable from a tap that did nothing. So
# you tap it again. Ten times.
home_src = open(os.path.join(ROOT, "web", "home.js"), encoding="utf-8").read()
check("the hub no longer reloads on a timer and hopes",
      "setTimeout(function () { location.href" not in home_src)
check("it waits until the address serves what was asked for",
      "function waitForAddress(" in home_src and "h.dir === repo" in home_src)
check("and a board says which machine it is, so a client can tell what it "
      "reached", '"host": tailscale.tailnet_self() or ""' in serve_src)
check("a second tap while one is in flight is not a second switch",
      "if (moving) return;" in home_src)
# And it asks the person nothing. "ask again" / "stay here" was a dead end
# wearing the clothes of a choice: reported as "I can hit it, but it never seems
# to work. It just gives me the options to 'ask again' or 'stay here'".
check("and it never ends in a question, because the switch has already happened",
      "busy-again" not in home_src and "busy-stay" not in home_src
      and "still on the old board" not in home_src)
# There is one machine, and the hub is a list of what it has. A row of machines
# to choose between was a choice about where a lesson lives, and there is
# nowhere else for one to live.
check("the hub offers no machine to pick, because there is one",
      "hosts" not in home_src
      and not any("hosts" in ln for ln in
                  open(os.path.join(ROOT, "web", "home.html"),
                       encoding="utf-8").read().splitlines()))
sw_src = open(os.path.join(ROOT, "web", "sw.js"), encoding="utf-8").read()
check("the health check is never answered out of the cache",
      "health" in sw_src.split("var LIVE")[1].split("\n")[0])

print("\n%d FAILURES" % len(errors) if errors
      else "\nthe address opens the course somebody chose")
sys.exit(1 if errors else 0)
