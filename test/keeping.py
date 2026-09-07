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

  18:09:25  `/handover` arrives from the always-on host, which has just moved
            `board.<tailnet>.ts.net` somewhere else, and stops the tutor.  The
            student is not reading the board through that address: this node
            publishes its own, `compute-node.<tailnet>.ts.net`, which is what
            the app on the iPad is installed against and which did not move.
            The daemon answered the turn already in flight, wrote its handoff
            and left -- "stopped after 1 turn(s)", mid-exercise.

So: the directories are re-asserted before anything writes, and a handover is
refused while somebody is being taught -- and refused in a way the caller comes
back from, because it used to be asked exactly once and a no was final.
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
# 3. the caller comes back
# ---------------------------------------------------------------------------
# A refusal is only useful if it is asked again. `handover` was called once, at
# the instant the address moved, so a board that said no was a board that was
# never asked a second time -- and its tutor was orphaned for good, which is
# the outcome the handover exists to prevent.
spec = importlib.util.spec_from_loader(
    "followcli_keeping",
    importlib.machinery.SourceFileLoader(
        "followcli_keeping", os.path.join(ROOT, "bin", "follow")))
follow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(follow)

replies = {"code": 409}


class Stub(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.dumps({"ok": replies["code"] == 200,
                           "detail": "somebody was working here 8 seconds ago"
                           if replies["code"] == 409 else "wrapping up"}).encode()
        self.send_response(replies["code"])
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


SPORT = free_port()
stub = ThreadingHTTPServer(("127.0.0.1", SPORT), Stub)
stub.daemon_threads = True
threading.Thread(target=stub.serve_forever, daemon=True).start()
follow.probe = lambda host, port, timeout=2.0: {"ok": True}

said = []
check("a board that says it is in use is not treated as done with",
      follow.handover("127.0.0.1", SPORT, SECRET, said.append) is False)
check("and the reason is written to the log rather than swallowed",
      any("keeps its tutor" in m for m in said))

replies["code"] = 200
check("a board that wraps up is done with",
      follow.handover("127.0.0.1", SPORT, SECRET, said.append) is True)

follow.probe = lambda host, port, timeout=2.0: None
check("and a machine that is not answering has no tutor to wrap up",
      follow.handover("127.0.0.1", SPORT, SECRET, said.append) is True)

fsrc = open(os.path.join(ROOT, "bin", "follow"), encoding="utf-8").read()
loop = fsrc.split("def follower(")[1]
check("the follower carries a machine it still owes a wrap-up to",
      "owed = None" in loop and "owed = (was[0], was[1])" in loop)
check("and asks it again on the ticks after the address moved",
      "if handover(owed[0], owed[1], secret, log):" in loop)
check("while an address that comes back to it cancels the obligation",
      "# The address came back to it. Nothing to stand down." in loop)


shutil.rmtree(TMP, ignore_errors=True)
print()
if fails:
    print("%d FAILED" % len(fails))
    sys.exit(1)
print("all good")
