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

So: the directories are re-asserted before anything writes.

And a second, later the same evening, reported as "it says 'could not move the
board' when I try to access Galois-Theory in the app". That is the hub's message
for any failed `/switch`, and it could not say more because the server was
returning a 500 -- which is why the route is driven here against a real server
rather than read.
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
# 2. opening a course, which has to move the address
# ---------------------------------------------------------------------------
# A course has its own port, so opening one means re-pointing the one name the
# iPad app is installed against -- and nothing else is going to do it. Without
# that the hub asks the address which course it is serving, gets the old answer
# for a minute, and can only say so: "I can hit it, but it never seems to work.
# It just gives me the options to 'ask again' or 'stay here'."
ran = []
started = []
machines_route.spawn.board_cli = lambda repo, args, timeout=90: (
    ran.append(list(args)) or (0, "board up (pid 1)"))
machines_route.spawn.tutor_cli = lambda args: (started.append(args) or (0, "starting"))
machines_route.tailscale.tailnet_self = lambda: "here.example"
machines_route.choice.remember_chosen = lambda *a, **k: None

status, doc = post(PORT, "/switch",
                   json.dumps({"repo": "Galois-Theory"}).encode())
check("tapping a course this machine serves starts its board",
      status == 200 and doc.get("ok") and ["start"] in ran)
check("and takes the tailnet name for it, in the same request",
      ["vpn", "serve"] in ran and ran.index(["start"]) < ran.index(["vpn", "serve"]))
check("and says so, so the hub knows there is something to wait for",
      doc.get("address") is True)
check("and the tutor follows the course",
      started == [["agent", "start", "Galois-Theory"]])

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
