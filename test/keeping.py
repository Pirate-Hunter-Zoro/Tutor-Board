#!/usr/bin/env python3
"""A board keeps the lesson it is holding: the tutor, and the directories.

Two defects from one minute on 7 September 2026, both on a Galois board with a
person writing on it. Reported as "Galois-Theory tutor session up and crashed".

  18:09:09  the student types into the answer box.  Every keystroke's autosave
            comes back 500, with a FileNotFoundError for `live/text/0070.txt`
            in the log.  `live/text/` had been removed by a git pull -- the
            other machine's transcript beat committed the deletion of the last
            draft in it, and git removes a directory when it removes the last
            tracked file in it.  The board had made that directory once, when
            the process started, and went on holding the path.

  18:09:25  `/handover` arrives from another machine and stops the tutor.  The
            student is reading this board at its own tailnet name, which is what
            the app on the iPad is installed against, and nothing about it had
            changed.  The daemon answered the turn already in flight, wrote its
            handoff and left -- "stopped after 1 turn(s)", mid-exercise.

So: the directories are re-asserted before anything writes, and a handover is
refused while somebody is being taught -- and refused in a way the caller comes
back from, because it used to be asked exactly once and a no was final.

And a third, later the same evening, reported as "it says 'could not move the
board' when I try to access Galois-Theory on the compute node in the app". That
is the hub's message for any failed `/switch`, and it could not say more because
the server was returning a 500: `for h in machines.known_hosts(...)` rebound
`h`, which is the REQUEST HANDLER, so `h.server` and `h.send_json` after the
loop were being called on a host dictionary. It sits in the branch taken when
the chosen course is on the OTHER machine -- which is every tap that moves the
board between machines, and nothing else.
"""

import importlib.machinery
import importlib.util
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tutorboard.course import repo as course_repo                 # noqa: E402
from tutorboard.server import spawn                               # noqa: E402
from tutorboard.server.handler import Handler                     # noqa: E402
from tutorboard.server.hub import Hub                             # noqa: E402
from tutorboard.server.tikz import TikzWorker                     # noqa: E402
from tutorboard.server.routes import machines as machines_route   # noqa: E402
from tutorboard import machine, machines as machines_mod          # noqa: E402

fails = []


def check(label, cond):
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        fails.append(label)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def post(port, path, body=b"", headers=None):
    """(status, document) for a POST to the board under test."""
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path),
                                 data=body, method="POST",
                                 headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, {"raw": raw}


# ---------------------------------------------------------------------------
# a real board, on a real socket, over a real course directory
# ---------------------------------------------------------------------------
TMP = tempfile.mkdtemp(prefix="keeping-")
COURSE = os.path.join(TMP, "Galois-Theory")
os.makedirs(COURSE)
with open(os.path.join(COURSE, "tutorboard.json"), "w", encoding="utf-8") as fh:
    json.dump({"name": "Galois Theory"}, fh)

repo = course_repo.Repo(COURSE)
worker = TikzWorker(repo)
hub = Hub(repo, worker)
hub.payload = json.dumps({})
PORT = free_port()
httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
httpd.daemon_threads = True
httpd.repo = repo
httpd.hub = hub
threading.Thread(target=httpd.serve_forever, daemon=True).start()


# ---------------------------------------------------------------------------
# 1. the directory a pull took away
# ---------------------------------------------------------------------------
check("the board makes its directories when it starts", os.path.isdir(repo.text))

# What the pull did: the last tracked file in `live/text/` was deleted on the
# other machine, so git removed the directory here. Nothing told the board.
shutil.rmtree(repo.text)
check("a pull can leave the board holding a directory that is gone",
      not os.path.isdir(repo.text))

status, doc = post(PORT, "/text/save",
                   json.dumps({"question": "0070", "text": "all of Q"}).encode())
check("a typed answer still saves", status == 200 and doc.get("ok"))
check("and the draft is on disk where the panel will look for it",
      os.path.isfile(os.path.join(repo.text, "0070.txt")))

# It is every one of them, not just the one that happened to be reported: all
# of these are tracked, all routinely go empty, and all are written to by a
# request that arrives whenever the student acts.
for name in ("answers", "notes", "slate", "uploads", "cards"):
    d = getattr(repo, name)
    shutil.rmtree(d, ignore_errors=True)
repo.ensure_dirs()
check("and every directory the board writes into comes back, not only `text`",
      all(os.path.isdir(getattr(repo, n))
          for n in ("answers", "notes", "slate", "uploads", "cards", "text")))

src = open(os.path.join(ROOT, "tutorboard", "server", "handler.py"),
           encoding="utf-8").read()
check("the re-assertion happens before any route writes, not inside one",
      "repo.ensure_dirs()" in src.split("def do_POST")[1].split("for mod")[0])


# ---------------------------------------------------------------------------
# 2. the handover that stopped a lesson
# ---------------------------------------------------------------------------
SECRET = "s3cret"
machines_mod.handover_secret = lambda: SECRET
machines_route.machines.handover_secret = lambda: SECRET

stopped = []
machines_route.spawn.tutor_cli = lambda args: (stopped.append(args) or (0, "wrapping up"))


def quiet():
    """A board nobody has touched for an hour: the orphan case."""
    stopped[:] = []
    old = time.time() - 3600
    with open(os.path.join(repo.live, "agent.json"), "w", encoding="utf-8") as fh:
        json.dump({"host": "nowhere", "agent": "claude", "pid": 1,
                   "state": "listening", "last_seen": old}, fh)
    for d in (repo.slate, repo.answers):
        for e in os.listdir(d):
            os.remove(os.path.join(d, e))
    for p in (repo.turns_path, repo.messages_path):
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("")
        os.utime(p, (old, old))


quiet()
status, doc = post(PORT, "/handover", headers={"X-Handover": "wrong"})
check("a handover without the shared secret is refused",
      status == 403 and not stopped)

quiet()
status, doc = post(PORT, "/handover", headers={"X-Handover": SECRET})
check("a board nobody is using hands over at once -- the orphan case it is for",
      status == 200 and doc.get("ok") and stopped == [["agent", "stop", "Galois-Theory"]])

# Mid-turn. The guard `tutor restart --tutors` has always applied and this
# never did: bouncing a tutor that is writing loses the card, and the student
# is the one who pays for it.
quiet()
# A record that really is this machine's, with a pid that really is alive --
# `load_agent` calls a record from another host or a dead process stale, and a
# stale record is not a tutor mid-turn.
with open(os.path.join(repo.live, "agent.json"), "w", encoding="utf-8") as fh:
    json.dump({"host": machine.node_name(), "agent": "claude", "pid": os.getpid(),
               "state": "working", "last_seen": time.time()}, fh)
status, doc = post(PORT, "/handover", headers={"X-Handover": SECRET})
check("a tutor in the middle of a turn is not stood down",
      status == 409 and not stopped)
check("and it says which of the two reasons it was",
      "mid-turn" in (doc.get("detail") or ""))

# The report itself: the student sent their working eight seconds before the
# handover arrived.
quiet()
with open(repo.messages_path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({"t": time.time(), "text": "all rational numbers"}) + "\n")
status, doc = post(PORT, "/handover", headers={"X-Handover": SECRET})
check("a board somebody sent to eight seconds ago keeps its tutor",
      status == 409 and not stopped)

# And working without sending yet counts, which is most of a proof. The slate
# writes OVER the page being drawn on, so the directory's own mtime never
# moves -- it has to be the files.
quiet()
page = os.path.join(repo.slate, "page-07.json")
with open(page, "w", encoding="utf-8") as fh:
    fh.write("{}")
os.utime(page, None)
status, doc = post(PORT, "/handover", headers={"X-Handover": SECRET})
check("so does writing on the slate without having sent anything",
      status == 409 and not stopped)

# Old work does not hold a board for ever: a student who really has moved to
# the other machine leaves a tutor that should be wrapped up.
quiet()
old = time.time() - (machines_route.IN_USE_FOR + 60)
page = os.path.join(repo.slate, "page-07.json")
with open(page, "w", encoding="utf-8") as fh:
    fh.write("{}")
os.utime(page, (old, old))
status, doc = post(PORT, "/handover", headers={"X-Handover": SECRET})
check("but a sitting that ended long enough ago does hand over",
      status == 200 and stopped)

check("and thinking time is measured in minutes, not seconds",
      machines_route.IN_USE_FOR >= 300)


# ---------------------------------------------------------------------------
# 2b. and a person can still say which machine owns the course
# ---------------------------------------------------------------------------
# The guard is aimed at machinery. Somebody deciding "this machine is not the
# owner" is the one caller it was never meant to argue with -- the same
# distinction Rule 0 in `choose_target` makes, where a host picked in the hub is
# the answer rather than a preference to be weighed. It cost an evening to find
# that out with no way to act on it: the other machine was a Mac with Remote
# Login off, so its board was the only door it opened and `/handover` was the
# only thing behind it.
quiet()
with open(repo.messages_path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({"t": time.time(), "text": "still working"}) + "\n")
status, doc = post(PORT, "/handover",
                   headers={"X-Handover": SECRET, "X-Handover-Force": "1"})
check("a person naming the machine gets the tutor stood down anyway",
      status == 200 and stopped == [["agent", "stop", "Galois-Theory"]])

quiet()
status, doc = post(PORT, "/handover", headers={"X-Handover-Force": "1"})
check("but the override is not a way past the shared secret",
      status == 403 and not stopped)

tsrc = open(os.path.join(ROOT, "bin", "tutor"), encoding="utf-8").read()
check("`tutor agent stop <course> --on <host>` is what does send it",
      "X-Handover-Force" in tsrc and 'where = _flag(args, "--on")' in tsrc)
check("and it reaches a peer the way everything else does, proxy included",
      "socks._socks_open" in tsrc.split("def agent_stop_elsewhere")[1])


# ---------------------------------------------------------------------------
# 2c. switching to a course on the other machine
# ---------------------------------------------------------------------------
# The hub says "could not move the board" for any failed `/switch` and cannot
# say more, so the server has to not fail. Everything the cross-machine branch
# reaches out to is stubbed -- the point is the branch running to its own
# `send_json` at all, which it could not do while the loop in the middle of it
# was rebinding the request handler.
asked_start = []
machines_route.tailscale.tailnet_self = lambda: "here.example"
machines_route.choice.remember_chosen = lambda *a, **k: None
machines_route.machines.announce_later = lambda *a, **k: None
machines_route.machines.known_hosts = lambda repo: {
    "hosts": [{"host": "here.example", "port": 1},
              {"host": "elsewhere.example", "port": 4242}]}
machines_route.boards.board_post = lambda host, port, path, body, timeout=60: (
    asked_start.append((host, port, path)) or {"ok": True})

status, doc = post(PORT, "/switch",
                   json.dumps({"repo": "Galois-Theory",
                               "host": "elsewhere.example"}).encode())
check("tapping a course on the other machine answers at all",
      status == 200 and doc.get("ok"))
check("and says which machine is bringing it up",
      "elsewhere" in (doc.get("detail") or ""))
check("having asked that machine's own board to start it, on its own port",
      asked_start == [("elsewhere.example", 4242, "/start")])

# ---------------------------------------------------------------------------
# 2d. switching to a course on THIS machine, which has to move the address
# ---------------------------------------------------------------------------
# A course has its own port, so opening one means re-pointing the one name the
# iPad app is installed against -- and nothing else is going to do it. Without
# that the hub asks the address which course it is serving, gets the old answer
# for a minute, and can only say so: "I can hit it, but it never seems to work.
# It just gives me the options to 'ask again' or 'stay here'."
ran = []
machines_route.spawn.board_cli = lambda repo, args, timeout=90: (
    ran.append(list(args)) or (0, "board up (pid 1)"))
machines_route.boards.locate_course = lambda name, skip_local=True, timeout=1.5: None
machines_route.processes.board_is_running = lambda pid, root: False

status, doc = post(PORT, "/switch",
                   json.dumps({"repo": "Galois-Theory",
                               "host": "here.example"}).encode())
check("tapping a course this machine serves starts its board",
      status == 200 and doc.get("ok") and ["start"] in ran)
check("and takes the tailnet name for it, in the same request",
      ["vpn", "serve"] in ran and ran.index(["start"]) < ran.index(["vpn", "serve"]))
check("and says so, so the hub knows there is something to wait for",
      doc.get("address") is True)

# And the machine that is offered but not there. The hub now lists a machine it
# has merely SEEN before -- deliberately, because a machine missing from the row
# is a machine nobody can reach -- so the tap is where the honest answer about
# it has to come from. Recording a choice for a machine with no board on it
# moves nothing, and reads on the iPad as a tap that did nothing.
asked_start[:] = []
machines_route.machines.known_hosts = lambda repo: {
    "hosts": [{"host": "here.example", "port": 1},
              {"host": "gone.example", "port": None}]}
machines_route.machines.reach_host = lambda repo, host: None
recorded_far = []
machines_route.choice.remember_chosen = lambda *a, **k: recorded_far.append(a)

status, doc = post(PORT, "/switch",
                   json.dumps({"repo": "Galois-Theory",
                               "host": "gone.example"}).encode())
check("a course on a machine with no board answering is refused, in words that "
      "say what to do about it",
      status == 503 and not doc.get("ok")
      and "no board answering" in (doc.get("error") or ""))
check("and nothing is recorded, so nothing is left chasing a machine that "
      "cannot answer",
      recorded_far == [] and asked_start == [])

msrc = open(os.path.join(ROOT, "tutorboard", "server", "routes", "machines.py"),
            encoding="utf-8").read()
check("the request handler is never used as a loop variable",
      not [ln for ln in msrc.splitlines()
           if ln.strip().startswith(("for h in ", "for h,"))])


# ---------------------------------------------------------------------------
# 3c. a server has no standard input
# ---------------------------------------------------------------------------
# A board asked to hand its tutor over recorded an interpreter crash where a
# wrap-up should have been: "can't initialize sys standard streams", "OSError:
# [Errno 9] Bad file descriptor". A board detached by `board start` has fd 0
# closed and every child python3 inherited it.
import subprocess as _sub                                        # noqa: E402

_probe = os.path.join(TMP, "probe.py")
with open(_probe, "w", encoding="utf-8") as fh:
    fh.write("print('RAN')\n")
_devnull = os.open(os.devnull, os.O_RDONLY)
_closed = os.dup(_devnull)
os.close(_devnull)
os.close(_closed)          # a descriptor number that is now closed
try:
    _p = _sub.run([sys.executable, _probe], stdin=_sub.DEVNULL,
                  stdout=_sub.PIPE, stderr=_sub.STDOUT, timeout=60)
    check("a child given DEVNULL for stdin starts even where the parent has none",
          _p.returncode == 0 and b"RAN" in _p.stdout)
except OSError:
    check("a child given DEVNULL for stdin starts even where the parent has none",
          False)

for mod, why in (("server/spawn.py", "the hub's own commands"),
                 ("lesson/git.py", "building the homework from the board")):
    src = open(os.path.join(ROOT, "tutorboard", mod), encoding="utf-8").read()
    spawns = [ln for ln in src.splitlines() if "sys.executable" in ln]
    check("%s spawns python and says so (%s)" % (mod, why), bool(spawns))
    check("and every one of them is handed a stdin (%s)" % why,
          all("stdin" in src.split(ln)[1].split(")")[0] or "stdin" in ln
              for ln in spawns))



shutil.rmtree(TMP, ignore_errors=True)
print()
if fails:
    print("%d FAILED" % len(fails))
    sys.exit(1)
print("all good")
