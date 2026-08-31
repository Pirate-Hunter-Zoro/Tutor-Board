#!/usr/bin/env python3
"""Which assistant tutors which course, on which machine.

Four layers resolve it and the order is the whole feature: a course that names
its own assistant must beat the machine default, and the machine default must
beat the global one, or the same configuration cannot serve a laptop and a
cluster node at once.

Also guards the shared-filesystem rule. `live/agent.json` is visible from every
node, so a record left by a node whose allocation has ended will otherwise look
exactly like a live assistant, and the board will sit waiting for a process that
died hours ago.
"""

import importlib.machinery
import importlib.util
import json
import shutil
import time
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

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


CFG = {
    "default_agent": "claude",
    "hosts": {"mac-mini": "opencode", "compute303": "claude"},
    "agents": {"claude": {"cmd": ["claude"]},
               "opencode": {"cmd": ["opencode"]},
               "codex": {"cmd": ["codex"]}},
}

host = tutor.this_host()
CFG["hosts"][host] = "opencode"          # pretend this machine prefers opencode

check("the command line wins over everything",
      tutor.resolve_agent(CFG, {"agent": "claude"}, "codex") == "codex")

check("a course that names its assistant beats the machine default",
      tutor.resolve_agent(CFG, {"agent": "claude"}) == "claude")

check("the machine default beats the global one",
      tutor.resolve_agent(CFG, {}) == "opencode")

no_host = dict(CFG, hosts={})
check("without a machine entry it falls through to default_agent",
      tutor.resolve_agent(no_host, {}) == "claude")

check("an unknown name resolves to nothing rather than to a wrong agent",
      tutor.resolve_agent(CFG, {"agent": "nonesuch"}) is None)

check("a course with no opinion and no machine entry still resolves",
      tutor.resolve_agent(no_host, None) == "claude")

# --- the default, and where its permissions are NOT written ------------------
# Claude Code is the default tutor. Headless there is nobody to approve anything,
# and a refused tool is not an error -- the agent apologises into a log nobody
# opens and exits 0, which reaches the board as a tutor who answered with
# silence. That is already solved, and solved in one place: `board start` writes
# the course its own `.claude/settings.local.json`. The recipe must not repeat
# it. One policy in two files is one policy that drifts the first time either
# moves, and the committed file is the half a course's owner can actually see.
D = tutor.DEFAULT_CONFIG
claude = D["agents"]["claude"]

check("Claude is the tutor unless something more specific says otherwise",
      D["default_agent"] == "claude")

for kind in ("headless_first", "headless"):
    recipe = " ".join(claude[kind])
    check("the %s recipe does not carry a second copy of the permissions" % kind,
          "acceptEdits" not in recipe and "allowedTools" not in recipe)

check("a resumed turn is still a resumed turn",
      "--continue" in claude["headless"] and "--continue" not in claude["headless_first"])

# The one place it does live, and what it has to cover.
board_src = open(os.path.join(ROOT, "bin", "board"), encoding="utf-8").read()
check("the board is what grants a headless tutor its permissions",
      "TUTOR_PERMISSIONS" in board_src and "def install_permissions(" in board_src)
check("and starting a board is when the course gets them",
      "install_permissions(live)" in board_src)
check("the grant lets it write the card, which is the whole job",
      '"defaultMode": "acceptEdits"' in board_src)
check("and run the board's own command",
      '"Bash(board *)"' in board_src)
check("but it never edits a list a course has built up for itself",
      "if os.path.exists(path):" in board_src)

# The free tutor is not the default any more and is not gone: it is what a
# machine that pays for no model runs, and removing it would leave that machine
# with nothing.
free = D["agents"]["free"]
check("the free tutor is still configured", bool(free.get("headless")))
check("and still runs the free-model script",
      any(a.endswith(os.path.join("bin", "free")) for a in free["headless"]))
check("and still builds its own context from the raw inbox",
      free.get("raw_prompt") is True)
check("and still has its own way to write the handoff", bool(free.get("handoff")))

# An agent is a command, and two machines do not have the same commands. A
# missing one used to start a daemon that showed as listening and then failed
# every turn into a log nobody opens.
check("a command that is not on the path is reported",
      tutor.missing_command(["a-command-no-machine-has"]) == "a-command-no-machine-has")
check("one that is, is not", tutor.missing_command(["sh"]) is None)
check("and a script agent runs under this interpreter, which is always here",
      tutor.missing_command(free["headless"]) is None)

# --- the shared filesystem ---------------------------------------------------
tmp = tempfile.mkdtemp(prefix="tutor-agents-")
live = os.path.join(tmp, "live")
os.makedirs(live)


def write_agent(**kw):
    kw.setdefault("last_seen", time.time())
    with open(os.path.join(live, "agent.json"), "w", encoding="utf-8") as fh:
        json.dump(kw, fh)


check("no record means nothing is listening", tutor.agent_live(tmp) is None)

write_agent(host="some-other-node", pid=1, agent="claude", state="listening")
check("a record from another node is not believed", tutor.agent_live(tmp) is None)

write_agent(host=host, pid=999999, agent="claude", state="listening")
check("a record for a pid that is gone is not believed", tutor.agent_live(tmp) is None)

write_agent(host=host, pid=os.getpid(), agent="claude", state="listening")
st = tutor.agent_live(tmp)
check("a record for a live process on this node is believed",
      bool(st) and st.get("agent") == "claude")

# --- the two kinds of record expire differently ------------------------------
# A headless daemon has a heartbeat, so silence means it died. An interactive
# assistant is idle for exactly as long as the person in front of it is thinking,
# and judging that by a heartbeat is why the board's indicator never once turned
# green in an ordinary `tutor` session: nothing outside headless ever wrote one.

# A daemon records its own pid, and a process either exists or it does not.
# The heartbeat is written at turn boundaries, so a daemon in the middle of a
# long turn goes silent while working perfectly well -- and a teaching turn
# routinely runs past two minutes. That silence used to read as death: the board
# said "assistant not responding" while the tutor was writing the card.
write_agent(host=host, pid=os.getpid(), agent="claude", state="working",
            last_seen=time.time() - 600)
st = tutor.agent_live(tmp)
check("a daemon mid-turn is not declared dead for going quiet",
      bool(st) and st.get("state") == "working")

write_agent(host=host, pid=999999, agent="claude", state="working",
            last_seen=time.time())
check("but a daemon whose process is gone is not believed, heartbeat or not",
      tutor.agent_live(tmp) is None)

# Only a record with no pid at all has nothing better to go on.
write_agent(host=host, agent="claude", state="listening", last_seen=time.time() - 600)
check("a pidless record still expires on its heartbeat",
      tutor.agent_live(tmp) is None)

write_agent(host=host, pid=os.getpid(), agent="claude", state="attached",
            mode="interactive", cmd=sys.executable, last_seen=time.time() - 6000)
st = tutor.agent_live(tmp)
check("an interactive assistant idle for an hour is still attached",
      bool(st) and st.get("state") == "attached")

write_agent(host=host, pid=999999, agent="claude", state="attached",
            mode="interactive", cmd=sys.executable, last_seen=time.time())
check("but one whose process is gone is not",
      tutor.agent_live(tmp) is None)

write_agent(host=host, pid=os.getpid(), agent="claude", state="attached",
            mode="interactive", cmd="a-command-this-process-is-not")
check("and a recycled pid running something else is not either",
      tutor.agent_live(tmp) is None)

# `headless --stop` is for daemons. Someone is sitting in front of an interactive
# session, and killing it is not what anyone typing that meant. This one needs a
# courses_dir of its own, because stopping walks every course it can find.
box = tempfile.mkdtemp(prefix="tutor-courses-")
boxed = os.path.join(box, "fake-course", "live")
os.makedirs(boxed)
with open(os.path.join(boxed, "agent.json"), "w", encoding="utf-8") as fh:
    json.dump({"host": host, "pid": os.getpid(), "agent": "claude",
               "state": "attached", "mode": "interactive", "cmd": sys.executable,
               "last_seen": time.time()}, fh)
tutor.headless_stop({"courses_dir": box, "agents": {}}, [])
check("headless --stop leaves an interactive session alone",
      os.path.exists(os.path.join(boxed, "agent.json")))
shutil.rmtree(box, ignore_errors=True)

write_agent(host=host, pid=os.getpid(), agent="claude", state="listening")

# --- starting ----------------------------------------------------------------
course = {"root": tmp, "dir": "fake-course", "name": "Fake"}
code, msg = tutor.agent_start(CFG, course, "claude")
check("starting is a no-op while one is already listening",
      code == 0 and "already listening" in msg)

os.remove(os.path.join(live, "agent.json"))
code, msg = tutor.agent_start(CFG, course, "claude")
check("an agent with no headless recipe refuses rather than half-starting",
      code == 1 and "headless recipe" in msg)

code, msg = tutor.agent_start(CFG, course, None)
check("an unresolved agent refuses", code == 1 and "no agent resolved" in msg)

ghost = dict(CFG, agents=dict(CFG["agents"],
                              ghost={"cmd": ["a-command-no-machine-has"],
                                     "headless": ["a-command-no-machine-has", "{prompt}"]}))
code, msg = tutor.agent_start(ghost, course, "ghost")
check("an agent whose command this machine lacks refuses rather than "
      "listening and failing every turn",
      code == 1 and "not on the path" in msg)

code, msg = tutor.agent_stop(course)
check("stopping something that is not there is not an error",
      code == 0 and "nothing was listening" in msg)

# --- catching up with another machine ---------------------------------------
# A handoff written on one machine is worth nothing to another that never
# fetched it, so a session starts by pulling. It must never be fatal: someone
# holding an iPad cannot resolve a merge.
import subprocess  # noqa: E402


def git(*args, **kw):
    return subprocess.run(["git"] + list(args), stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, **kw)


check("a directory that is not a repository is left alone",
      tutor.sync(tempfile.mkdtemp(prefix="tutor-plain-")) is None)

sandbox = tempfile.mkdtemp(prefix="tutor-sync-")
up = os.path.join(sandbox, "up")
here = os.path.join(sandbox, "here")
there = os.path.join(sandbox, "there")

git("init", "-q", "--bare", up)
git("symbolic-ref", "HEAD", "refs/heads/main", cwd=up)
git("init", "-q", "-b", "main", here)
for cfg in (("user.email", "t@t"), ("user.name", "T")):
    git("config", cfg[0], cfg[1], cwd=here)
with open(os.path.join(here, "HANDOFF.md"), "w", encoding="utf-8") as fh:
    fh.write("first\n")
git("add", "-A", cwd=here)
git("commit", "-qm", "first", cwd=here)

check("a repository with no remote is left alone", tutor.sync(here, quiet=True) is None)

git("remote", "add", "origin", up, cwd=here)
git("push", "-qu", "origin", "main", cwd=here)
git("clone", "-q", up, there)
for cfg in (("user.email", "t@t"), ("user.name", "T")):
    git("config", cfg[0], cfg[1], cwd=there)
with open(os.path.join(there, "HANDOFF.md"), "w", encoding="utf-8") as fh:
    fh.write("what the other machine taught\n")
git("commit", "-qam", "handoff from elsewhere", cwd=there)
git("push", "-q", cwd=there)

check("a session pulls what another machine pushed", tutor.sync(here, quiet=True) is True)
with open(os.path.join(here, "HANDOFF.md"), encoding="utf-8") as fh:
    check("and the handoff it wrote is the one now on disk",
          fh.read().strip() == "what the other machine taught")

# Diverged: the remote moved and so did this side. A pull cannot fast-forward,
# and the session still has to start.
with open(os.path.join(there, "HANDOFF.md"), "w", encoding="utf-8") as fh:
    fh.write("elsewhere again\n")
git("commit", "-qam", "elsewhere again", cwd=there)
git("push", "-q", cwd=there)
with open(os.path.join(here, "HANDOFF.md"), "w", encoding="utf-8") as fh:
    fh.write("locally, at the same time\n")
git("commit", "-qam", "local work", cwd=here)

check("a diverged branch reports rather than throwing",
      tutor.sync(here, quiet=True) is False)
check("and it does not touch the local work",
      open(os.path.join(here, "HANDOFF.md"), encoding="utf-8").read().strip()
      == "locally, at the same time")

shutil.rmtree(sandbox, ignore_errors=True)

# --- restarting every board on this machine ----------------------------------
# A board read serve.py when it started, so a change to the tool reaches a course
# only when its board comes back. The pages are served from disk and look new
# while the endpoints behind them are the old ones -- invisible from outside.
import subprocess as _sp
tool_src = open(os.path.join(ROOT, "bin", "tutor"), encoding="utf-8").read()
check("there is a command to restart every board here",
      "def cmd_restart(" in tool_src)
check("and it refuses to touch a board belonging to another node",
      'info["node"] != host' in tool_src)
check("and only ones that are genuinely answering",
      "board_is_running" in tool_src)

ship = os.path.join(ROOT, "scripts", "ship.sh")
check("there is one command that ships a change", os.path.isfile(ship))
ship_src = open(ship, encoding="utf-8").read() if os.path.isfile(ship) else ""
check("and it restarts the tutors as well as the boards",
      "--tutors" in ship_src)
check("and restarts nothing when the push failed",
      "nothing has been restarted" in ship_src)
check("a tutor mid-turn is not bounced out of the card it is writing",
      "mid-turn" in tool_src)
check("a restart that did not happen is not reported as one",
      "did not come back" in tool_src and 'now["pid"] != was' in tool_src)
check("and a tutor still writing its handoff is said to be, not claimed restarted",
      "still writing its handoff" in tool_src)
check("and stopping one waits for its handoff to be written",
      "agent_live(c[\"root\"])" in tool_src)

push_src = open(os.path.join(ROOT, "scripts", "save-and-push.sh"), encoding="utf-8").read()
check("pushing the tool restarts the boards it drives", "tutor restart" in push_src)
check("but a course pushing its own work does not",
      'Tutor-Board' in push_src and 'show-toplevel' in push_src)
check("and a failure to restart does not fail the push",
      "|| echo" in push_src)

print()
print("%d FAILURES" % len(fails) if fails else "the assistant follows the course")
sys.exit(1 if fails else 0)
