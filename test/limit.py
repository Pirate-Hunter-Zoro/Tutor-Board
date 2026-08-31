#!/usr/bin/env python3
"""An allowance that has run out moves the lesson, and moves it back.

The Mac mini is the default host for any course it has cloned: it is always
awake, it holds the repository, and it does not take an allocation with it when
it dies. None of that helps when the tutor there has been told it has no quota
left. The board answers, the machine is healthy, and nothing can be taught.

So there is an order, and this file holds it:

    the Mac on the paid tutor  ->  a compute node  ->  the Mac on a free model

The first step is the proxy's: a board publishes its machine's limit in
`/health`, and the follower passes over a preferred machine that has none. The
last step is the tutor's own: when nobody took the lesson over, it falls back to
whatever this machine can run for nothing, because a free answer beats a board
where nobody is home.

Two rules underneath, and both are here because getting either wrong is silent:

  - out of allowance still beats being down. A machine with no quota is the
    second-worst outcome; an address pointing at nothing is the worst;
  - the limit expires by itself, and a turn that goes through clears it. A
    limit that has to be cleared by hand outlives itself and quietly demotes a
    machine for days.
"""

import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile
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


# A state directory of our own. BOARD_STATE_DIR exists for exactly this: a test
# that wrote the real one would take this machine out of service.
box = tempfile.mkdtemp()
os.environ["BOARD_STATE_DIR"] = box
os.environ["BOARD_NODE_NAME"] = "test-node"

import boardlib                                              # noqa: E402

boardlib.STATE_DIR = box
boardlib.LIMIT_RECORD = os.path.join(box, "limited.json")
boardlib.CONFIG = os.path.join(box, "config.json")           # no user config

spec = importlib.util.spec_from_loader(
    "followcli",
    importlib.machinery.SourceFileLoader("followcli", os.path.join(ROOT, "bin", "follow")))
follow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(follow)

# ---- reading a failed turn -------------------------------------------------
#
# The agent said why it failed; the only question is whether we listened. What a
# limit LOOKS like is configuration, for the same reason the egress probe is --
# the board is not allowed to know which assistant is driving it.

now = 1_700_000_000.0

check("the reset time a provider names is believed over any window we'd guess",
      abs(boardlib.reads_as_usage_limit(
          "Claude AI usage limit reached|%d" % int(now + 7200), now) - (now + 7200)) < 2)
check("a limit with no time on it gets the ordinary window",
      boardlib.reads_as_usage_limit("Claude AI usage limit reached", now)
      == now + boardlib.DEFAULT_LIMIT_WINDOW)
check("the five-hour form is a limit too",
      boardlib.reads_as_usage_limit("5-hour limit reached ∙ resets 3pm", now))
check("and so is the API's own word for it",
      boardlib.reads_as_usage_limit('{"type":"rate_limit_error"}', now))

check("an ordinary broken turn is not a limit, and must not demote the machine",
      boardlib.reads_as_usage_limit("Error: ENOENT no such file", now) is None)
check("nor is a turn that said nothing at all",
      boardlib.reads_as_usage_limit("", now) is None)

# A reset time in the past, or absurdly far away, is a misread rather than news.
check("a reset time already gone falls back to the window",
      boardlib.reads_as_usage_limit("usage limit reached|100", now)
      == now + boardlib.DEFAULT_LIMIT_WINDOW)
check("and one a year out does not take the machine out for a year",
      boardlib.reads_as_usage_limit("usage limit reached|%d" % int(now + 400 * 86400), now)
      == now + boardlib.DEFAULT_LIMIT_WINDOW)

# ---- the record ------------------------------------------------------------

check("with nothing written, the machine has its allowance", boardlib.limited_until() == 0)
boardlib.mark_limited(time.time() + 900, agent="claude")
check("a limit reads back", boardlib.limited_until() > time.time())
check("and says which tutor ran out", boardlib.limit_record().get("agent") == "claude")

boardlib.mark_limited(time.time() - 60, agent="claude")
check("a limit that has expired is no limit; it does not need clearing by hand",
      boardlib.limited_until() == 0)

# The home directory is shared between compute nodes. A limit hit by the
# allocation that ended yesterday is not this machine's news.
with open(boardlib.LIMIT_RECORD, "w", encoding="utf-8") as fh:
    json.dump({"until": time.time() + 900, "node": "some-other-node"}, fh)
check("a limit written by another machine is not this machine's",
      boardlib.limited_until() == 0)

with open(boardlib.LIMIT_RECORD, "w", encoding="utf-8") as fh:
    fh.write("{not json")
check("a corrupt record is an allowance, not a crash", boardlib.limited_until() == 0)

boardlib.mark_limited(time.time() + 900, agent="claude")
boardlib.clear_limited()
check("and a turn going through clears it", boardlib.limited_until() == 0)

# ---- the order, which is the whole feature ---------------------------------

GAL = "/x/Galois-Theory"
GAL_PORT = boardlib.default_port("Galois-Theory")
CANDS = [{"dir": "Galois-Theory", "root": GAL}]
HERE_, NODE_ = "127.0.0.1", "node"

anywhere = {}


def fake_probe(host, port, timeout=2.0):
    return anywhere.get((host, int(port)))


follow.probe = fake_probe
follow.active_course = lambda cands: (cands[0] if cands else None)
follow.local_port = lambda c: GAL_PORT


def board(limited=0):
    """A board's /health. `limited` is when its machine's allowance returns."""
    doc = {"ok": True, "root": GAL, "dir": "Galois-Theory"}
    if limited:
        doc["limited"] = limited
    return doc


SOON, GONE = time.time() + 900, time.time() - 900

# 1. Nothing is exhausted: the machine holding the repository teaches, exactly
#    as before. This is the ordinary day and it must not have changed.
anywhere = {(HERE_, GAL_PORT): board(), (NODE_, GAL_PORT): board()}
check("with allowances everywhere, the machine holding the repository still wins",
      follow.choose_target(NODE_, CANDS, "local")[0] == (HERE_, GAL_PORT))

# 2. This machine has run out and the node has not: the node takes over.
anywhere = {(HERE_, GAL_PORT): board(limited=SOON), (NODE_, GAL_PORT): board()}
check("a preferred machine with no allowance hands the lesson to the compute node",
      follow.choose_target(NODE_, CANDS, "local")[0] == (NODE_, GAL_PORT))

# 3. Both have run out. The address comes back here, where the tutor has by now
#    fallen back to something free -- there is nothing better anywhere.
anywhere = {(HERE_, GAL_PORT): board(limited=SOON),
            (NODE_, GAL_PORT): board(limited=SOON)}
check("with nothing left anywhere the address stays on the preferred machine",
      follow.choose_target(NODE_, CANDS, "local")[0] == (HERE_, GAL_PORT))

# 4. Out of allowance is still miles better than nothing listening.
anywhere = {(HERE_, GAL_PORT): board(limited=SOON)}
check("a board with no allowance still beats an address pointing at nothing",
      follow.choose_target(NODE_, CANDS, "local")[0] == (HERE_, GAL_PORT))
anywhere = {(NODE_, GAL_PORT): board(limited=SOON)}
check("and so does the node's, when it is the only board up",
      follow.choose_target(NODE_, CANDS, "local")[0] == (NODE_, GAL_PORT))

# 5. The limit expires on its own, and the address comes home without anybody
#    doing anything. This is why the record carries a time rather than a flag.
anywhere = {(HERE_, GAL_PORT): board(limited=GONE), (NODE_, GAL_PORT): board()}
check("a limit that has passed is not a limit, and the lesson comes back",
      follow.choose_target(NODE_, CANDS, "local")[0] == (HERE_, GAL_PORT))

# 6. An older board does not publish the field at all. Silence is an allowance;
#    the alternative is every un-upgraded machine looking exhausted.
anywhere = {(HERE_, GAL_PORT): {"ok": True, "root": GAL, "dir": "Galois-Theory"},
            (NODE_, GAL_PORT): board()}
check("a board too old to publish an allowance is not assumed to have none",
      follow.choose_target(NODE_, CANDS, "local")[0] == (HERE_, GAL_PORT))
anywhere = {(NODE_, GAL_PORT): {"ok": True, "root": GAL, "dir": "Galois-Theory",
                                "limited": "soon"}}
check("and a junk value is read as no limit rather than crashing the proxy",
      not follow.limited(NODE_, GAL_PORT))
check("as is a machine that is not answering at all -- it is down, not exhausted",
      not follow.limited(HERE_, GAL_PORT))

# 7. The rule points both ways. `prefer: node` is one word of configuration and
#    a node with no allowance loses the address to this machine just the same.
anywhere = {(HERE_, GAL_PORT): board(), (NODE_, GAL_PORT): board(limited=SOON)}
check("the rule is not about which machine is which: a preferred NODE yields too",
      follow.choose_target(NODE_, CANDS, "node")[0] == (HERE_, GAL_PORT))
anywhere = {(HERE_, GAL_PORT): board(), (NODE_, GAL_PORT): board()}
check("and with both well, `prefer: node` is still obeyed",
      follow.choose_target(NODE_, CANDS, "node")[0] == (NODE_, GAL_PORT))

# ---- the last step down, which is the tutor's and not the proxy's ----------

src = open(os.path.join(ROOT, "bin", "tutor"), encoding="utf-8").read()

check("a limit is asked about before the network is blamed",
      src.index("reads_as_usage_limit") < src.index("boardlib.egress_ok()"))
check("the machine is marked, which is what /health then publishes",
      "boardlib.mark_limited(until, agent=agent_name)" in src)
check("the message whose turn was lost is carried, not dropped",
      "pending = out" in src)
check("the tutor waits for a node to take the lesson before answering itself",
      "wait_for_takeover(running, cfg.get(\"takeover_grace\", 45))" in src)
check("and stops when one did, rather than teaching a lesson nobody can reach",
      "another machine has taken the lesson over" in src)
check("only then does it fall back to what this machine runs for free",
      src.index("wait_for_takeover") < src.index("fallback_agent(cfg, agent_name)"))
check("the fallback is a name in the config like every other agent",
      'cfg.get("fallback_agent")' in src)
check("and it is free by default", '"fallback_agent": "free"' in src)
check("a fallback this machine cannot run is not a fallback",
      "missing_command(spec.get(\"headless\"))" in src)
check("the allowance coming back climbs the tutor home again",
      "the allowance is back" in src)
check("and a turn that goes through is what proves it",
      "boardlib.clear_limited()" in src)
check("the handoff is written by whoever still can, so continuity survives",
      "has no allowance left for the handoff" in src)

health = open(os.path.join(ROOT, "serve.py"), encoding="utf-8").read()
check("a board publishes its machine's allowance, because only it can know",
      '"limited": boardlib.limited_until()' in health)

print("\n%d FAILURES" % len(errors) if errors
      else "\nthe lesson goes where there is an allowance to teach it")
sys.exit(1 if errors else 0)
