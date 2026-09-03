"""A tutor coming up says so, and nothing handed in is ever answered by silence.

Three reports, one evening, from an iPad in the middle of a Galois proof:

  "The tutor was sluggish to start up... But the tutor was just marked as dead
   or not available or not listening in the app. If the tutor is 'waking' up, I
   should be told that. It seemed to tell me the tutor was dead which put me in
   'send again' mode leading to massive confusion."

  "The tutor also appears to be very non responsive. Now it's just hanging. I
   need you to make the tutor way more robust. I don't ever want to be left
   hanging."

Both are the same defect wearing two faces: the board had words for exactly two
states -- attached and dead -- and a start takes seconds while a failed turn
takes none, so everything in between was reported as one of those two, wrongly.

What this asserts is the vocabulary and the plumbing behind it, on the server
side, where the truth is. `test/hanging.js` asserts that the board says it.
"""

import json
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tutorboard import processes                                # noqa: E402
from tutorboard.lesson import notes, slate, state               # noqa: E402

fails = []


def check(label, cond):
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        fails.append(label)


class Repo(object):
    """Just enough of a repository for the readers under test."""

    def __init__(self, root):
        self.root = root
        self.live = os.path.join(root, "live")
        self.slate = os.path.join(self.live, "slate")
        self.inbox = os.path.join(self.live, "inbox")
        self.messages_path = os.path.join(self.inbox, "messages.jsonl")
        for d in (self.live, self.slate, self.inbox):
            os.makedirs(d, exist_ok=True)

    def agent(self, **kw):
        with open(os.path.join(self.live, "agent.json"), "w", encoding="utf-8") as fh:
            json.dump(kw, fh)


HERE = processes  # readability below

# --------------------------------------------------------------- waking up
print("-- a tutor on its way up is not a tutor that died --")

box = tempfile.mkdtemp(prefix="waking-")
repo = Repo(box)
host = __import__("tutorboard.machine", fromlist=["x"]).node_name()

# What the launcher writes BEFORE it forks: no pid, because there is no process
# yet. This is the whole of the gap the board used to fill with "tutor stopped".
repo.agent(host=host, agent="claude", pid=None, state="waking",
           waking_at=time.time())
got = state.load_agent(repo)
check("a start with no pid yet is reported, not judged",
      got is not None and got.get("state") == "waking")
check("and it counts as attached, so nothing says the board is unread",
      processes.agent_is_attached({"host": host, "state": "waking",
                                   "waking_at": time.time()}, host))

# Once the daemon has rewritten the record with its own pid, a start that DIED
# is knowable at once rather than having to wait out the grace -- a board that
# goes on promising a tutor for five minutes is its own kind of lie.
check("and once there is a pid, a start that died is noticed immediately",
      not processes.agent_is_attached(
          {"host": host, "state": "waking", "waking_at": time.time(),
           "pid": 999999}, host))
check("while the daemon that is really there is believed",
      processes.agent_is_attached(
          {"host": host, "state": "waking", "waking_at": time.time(),
           "pid": os.getpid()}, host))

# It expires. A start that fell over must not go on claiming to be in progress.
repo.agent(host=host, agent="claude", pid=None, state="waking",
           waking_at=time.time() - processes.WAKING_GRACE - 5)
got = state.load_agent(repo)
check("a start that never landed stops claiming to be in progress",
      got is not None and got.get("state") == "stale")

# And a record from another node is still not ours, waking or otherwise: the
# home directory is shared and a pid from a finished allocation is a stranger's.
repo.agent(host="some-other-node", agent="claude", pid=None, state="waking",
           waking_at=time.time())
check("a start on another machine is not this board's tutor",
      not processes.agent_is_attached(
          {"host": "some-other-node", "state": "waking",
           "waking_at": time.time()}, host))

# ------------------------------------------------- a turn that fell over
print()
print("-- a failed turn reaches the person whose work it was --")

repo.agent(host=host, agent="claude", pid=os.getpid(), state="listening",
           last_error="timed out", failed_at=time.time())
got = state.load_agent(repo)
check("a turn that failed is handed to the board, not only to the log",
      got and got.get("failure") and got["failure"]["error"] == "timed out")

repo.agent(host=host, agent="claude", pid=os.getpid(), state="listening",
           last_error="timed out",
           failed_at=time.time() - state.FAILURE_FRESH - 10)
got = state.load_agent(repo)
check("and a failure from an hour ago is history rather than news",
      got and not got.get("failure"))

repo.agent(host=host, agent="claude", pid=os.getpid(), state="listening",
           last_error=None, failed_at=0)
got = state.load_agent(repo)
check("a turn that then succeeded clears it",
      got and not got.get("failure"))

# ------------------------------------------- work nobody has picked up
print()
print("-- and the board can always say whether anything took it --")

check("an empty inbox is nothing waiting", notes.waiting(repo) is None)

with open(repo.messages_path, "w", encoding="utf-8") as fh:
    fh.write(json.dumps({"t": time.time() - 90, "text": "[slate] t0001 rev 1",
                         "read": True}) + "\n")
check("and so is an inbox the tutor has read", notes.waiting(repo) is None)

sent_at = time.time() - 120
with open(repo.messages_path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({"t": sent_at, "text": "[slate] t0002 rev 1",
                         "read": False}) + "\n")
    fh.write(json.dumps({"t": time.time() - 30, "text": "[slate] t0003 rev 1",
                         "read": False}) + "\n")
w = notes.waiting(repo)
check("two things handed in and nothing taken is reported as two",
      w and w["count"] == 2)
check("timed from the OLDEST, which is the one somebody has been waiting on",
      w and abs(w["since"] - sent_at) < 1)

# The point of it being on disk: a reload cannot lose it, and neither can the
# tutor being restarted underneath it. Nothing in the browser is consulted.
check("and it is read off disk, so a reload still knows",
      notes.waiting(Repo(box)) is not None)

# -------------------------------------------- a page is its number
print()
print("-- a slate page is named by its number, never by its position --")

# The exact shape of the Galois directory: page 1 was never saved, and neither
# were 6, 8 or 10. Read as a dense array, index 4 is `page-07` -- and the next
# stroke on it was written to `page-05`.
for n in (2, 3, 4, 5, 7, 9, 11, 12):
    with open(os.path.join(repo.slate, "page-%02d.json" % n), "w",
              encoding="utf-8") as fh:
        json.dump({"page": n, "w": 1130, "h": 1514,
                   "strokes": [{"c": "#eee", "w": 3, "pts": [[n, n], [n * 2, n * 2]]}]},
                  fh)
pages = slate.read_slate_pages(repo)
check("every page carries the number it is saved under",
      [p["page"] for p in pages] == [2, 3, 4, 5, 7, 9, 11, 12])
check("and a gap is a gap rather than a page sliding down into it",
      pages[4]["page"] == 7)

# A field inside the file that disagrees with the filename loses: the field was
# written by whichever client saved it, and a client that had already slid is a
# client whose field is wrong too. The filename is what the next save addresses.
with open(os.path.join(repo.slate, "page-04.json"), "w", encoding="utf-8") as fh:
    json.dump({"page": 99, "w": 1130, "h": 1514, "strokes": []}, fh)
pages = slate.read_slate_pages(repo)
check("the filename wins over a number written inside the file",
      [p["page"] for p in pages] == [2, 3, 4, 5, 7, 9, 11, 12])

# Three figures. `%02d` means `page-100` sorts BEFORE `page-99` by name, so a
# sitting that ran past a hundred pages came back with its last hundred first.
for n in (99, 100, 101):
    with open(os.path.join(repo.slate, "page-%02d.json" % n), "w",
              encoding="utf-8") as fh:
        json.dump({"page": n, "w": 1130, "h": 1514, "strokes": []}, fh)
pages = slate.read_slate_pages(repo)
check("and past a hundred pages the order is still the order",
      [p["page"] for p in pages][-3:] == [99, 100, 101])

# ------------------------------------------------- the launcher's own order
print()
print("-- and the launcher says so before it does anything slow --")

src = open(os.path.join(ROOT, "bin", "tutor"), encoding="utf-8").read()
i = src.index("def agent_start(")
start = src[i:src.index("def agent_stop(", i)]
check("`agent_start` marks the course waking", "mark_waking(" in start)
check("and it does so before it forks anything",
      start.index("mark_waking(") < start.index("subprocess.Popen"))
check("and the catch-up no longer happens inside the request that asked",
      "sync(root, quiet=True)" not in start)

j = src.index("def headless(")
head = src[j:j + 4000]
check("the daemon marks itself waking too, for a start nobody routed",
      "mark_waking(" in head)
check("before the link, the board and the sitting, which are the slow part",
      head.index("mark_waking(") < head.index('board(root, "start")'))
check("and the catch-up moved here, where nobody is holding a request open",
      "sync(root, quiet=True)" in head)

# The other half of never hanging: work handed in with nothing reading the board
# starts a tutor. It used to go into the inbox and stay there for ever, because
# `board wait` only ever returns to a daemon that is already running.
for mod in ("writing", "lesson"):
    routes = open(os.path.join(ROOT, "tutorboard", "server", "routes",
                               mod + ".py"), encoding="utf-8").read()
    check("handing work in through %s.py wakes a tutor" % mod,
          "spawn.wake_tutor(repo)" in routes)

print()
print(("%d FAILURES" % len(fails)) if fails
      else "a tutor says when it is waking, and silence is never the answer")
sys.exit(1 if fails else 0)
