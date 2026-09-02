#!/usr/bin/env python3
"""Which machines are worth knocking on, and why the answer must be short.

The follower cannot see the other machine's filesystem, so it finds a lesson by
knocking: a course's ports are a pure function of its name, so it walks the
tailnet and asks each machine whether it is serving the course that was chosen.
That walk is the only way a board on the compute node is ever found, and it is
also the most expensive thing the follower does -- four ports per machine, a
socket timeout each, and again through the SOCKS proxy.

So the list it walks is a correctness question, not a tidiness one, and it has
been wrong twice in the same direction.

  - Three iPads on this tailnet turned one tick into a minute of waiting. A
    phone does not run boards; the fix was to skip them by `OS`.
  - Then a Mullvad exit-node subscription put its entire fleet in the netmap as
    online peers -- 544 of them -- carrying no `OS` at all, so the phone filter
    waved every one through. Measured here: 6.1s to knock on one exit node, so
    55 minutes for a single walk, while the follower is bounced every fifteen.
    Not one tick ever finished. The address kept whatever course was seeded at
    startup, a tap in the hub could not move it, and every board was healthy the
    whole time -- because they were. Only the deciding was dead.

The second one is why this file exists, and why there is a ceiling as well as a
filter: the filters are a list of surprises that have already happened, and the
next one should cost a slow tick rather than a follower that never decides
again.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from tutorboard.net import boards, tailscale

fails = []


def check(m, cond):
    if cond:
        print("ok   " + m)
    else:
        fails.append(m)
        print("FAIL " + m)


def peer(name, online=True, os_=None, tags=None, ips=None):
    """One entry as `tailscale status --json` writes it."""
    doc = {"Online": online, "DNSName": name + "." if name else ""}
    if os_ is not None:
        doc["OS"] = os_
    if tags is not None:
        doc["Tags"] = tags
    if ips is not None:
        doc["TailscaleIPs"] = ips
    return doc


def status(*peers):
    return {"Peer": dict(enumerate(peers))}


# ---- the machine a lesson might actually be on -----------------------------

check("an ordinary machine on the tailnet is somewhere to look",
      tailscale.tailnet_peers(status(peer("compute-node.ts.net", os_="linux")))
      == ["compute-node.ts.net"])
check("a machine that is not online is not somewhere to look",
      tailscale.tailnet_peers(
          status(peer("compute-node.ts.net", online=False, os_="linux"))) == [])
check("and a peer with no name is reached at its address rather than skipped",
      tailscale.tailnet_peers(
          status(peer("", os_="linux", ips=["100.64.0.9"]))) == ["100.64.0.9"])

# ---- the two fleets that must not be walked --------------------------------

check("a phone is not a machine that runs boards",
      tailscale.tailnet_peers(status(peer("ipad.ts.net", os_="iOS"))) == [])
check("nor is a tagged device, whatever it says its OS is",
      tailscale.tailnet_peers(
          status(peer("se-sto-wg-001.mullvad.ts.net", os_="",
                      tags=["tag:mullvad-exit-node"]))) == [])
check("which is the whole of the 55-minute walk: a fleet of them costs nothing",
      tailscale.tailnet_peers(status(*[
          peer("wg-%03d.mullvad.ts.net" % i, os_="", tags=["tag:mullvad-exit-node"])
          for i in range(544)])) == [])
check("and the machine teaching the lesson is still found in among them",
      tailscale.tailnet_peers(status(*(
          [peer("wg-%03d.mullvad.ts.net" % i, os_="", tags=["tag:mullvad-exit-node"])
           for i in range(544)]
          + [peer("compute-node.ts.net", os_="linux")])))
      == ["compute-node.ts.net"])

# A person's own machine may advertise itself as an exit node and still be the
# machine the lesson is on. Tags are what separates infrastructure from a desk;
# being an exit node is not.
check("a machine of one's own that offers to be an exit node is not infrastructure",
      tailscale.tailnet_peers(status(
          dict(peer("compute-node.ts.net", os_="linux"), ExitNodeOption=True)))
      == ["compute-node.ts.net"])

# ---- the ceiling -----------------------------------------------------------

many = tailscale.tailnet_peers(status(*[
    peer("machine-%03d.ts.net" % i, os_="linux") for i in range(200)]))
check("a netmap that grows without warning cannot freeze the follower again",
      len(many) == tailscale.PEER_WALK_LIMIT)
check("and the ceiling is a handful of machines, not a fleet",
      2 <= tailscale.PEER_WALK_LIMIT <= 24)

# ---- and the machine that has gone home ------------------------------------
#
# `tailnet_peers` only offers machines that are up, but the configured node is a
# name out of a config file and outlives the machine being awake. Knocking on it
# is the most expensive way to learn nothing -- four ports, a socket timeout
# each, then the SOCKS proxy, measured at 6.1s against this tailnet's sleeping
# compute node -- and the follower does that walk three times a tick. A tap paid
# for all of it: 18 seconds to move the address to a course on THIS machine,
# because the answer had to come back from a node that was not there.

up = status(peer("compute-node.ts.net", os_="linux"))
down = status(peer("compute-node.ts.net", online=False, os_="linux"))

check("a machine the tailnet says is up is knocked on",
      tailscale.peer_is_down("compute-node.ts.net", up) is False)
check("a machine the tailnet says is off is not",
      tailscale.peer_is_down("compute-node.ts.net", down) is True)
check("and the short name is the same machine as the long one",
      tailscale.peer_is_down("compute-node", down) is True)
check("as is the same name shouted",
      tailscale.peer_is_down("COMPUTE-NODE", down) is True)
check("an address is a machine too",
      tailscale.peer_is_down("100.64.0.9", status(
          peer("", online=False, os_="linux", ips=["100.64.0.9"]))) is True)

# The one that must not become a rule. "I cannot tell" has to mean "knock
# anyway": a machine wrongly written off is a lesson that cannot be reached from
# anywhere, which is a far worse failure than a slow tick.
check("a machine the tailnet has never heard of is not written off",
      tailscale.peer_is_down("somewhere-else", up) is None)
check("nor is anything at all when there is no netmap to read",
      tailscale.peer_is_down("compute-node", {}) is None)
check("and a nameless host is nobody, rather than somebody who is up",
      tailscale.peer_is_down("", up) is None)

check("the follower treats a node that has gone home as no node at all",
      "if node and tailscale.peer_is_down(node):"
      in open(os.path.join(ROOT, "bin", "follow"), encoding="utf-8").read())
check("and a course is not looked for on a machine that is not there",
      "if tailscale.peer_is_down(host):"
      in open(os.path.join(ROOT, "tutorboard", "net", "boards.py"), encoding="utf-8").read())

# ---- the escape hatch, which the suite depends on --------------------------

os.environ["BOARD_NO_TAILNET"] = "1"
try:
    check("a suite that says so reaches no tailnet at all",
          tailscale.tailnet_peers(status(peer("compute-node.ts.net", os_="linux")))
          == [])
finally:
    del os.environ["BOARD_NO_TAILNET"]

# `test/limit.py` reasons about which board wins by stubbing `follow.probe`. That
# is not the only way out: `choose_target` also reaches the network through
# `boards.locate_course`, and with the exit-node fleet in the netmap that made
# `bash test/all.sh` stop dead on a unit test about arithmetic over `/health`
# documents. The hatch above is the fix; this is what keeps it there.
limit_src = open(os.path.join(HERE, "limit.py"), encoding="utf-8").read()
check("and the suite that walks the tailnet by accident says so",
      'os.environ["BOARD_NO_TAILNET"]' in limit_src)

print()
print("%d FAILURES" % len(fails) if fails
      else "only a machine somebody could be teaching on is knocked on")
sys.exit(1 if fails else 0)
