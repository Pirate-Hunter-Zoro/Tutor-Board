#!/usr/bin/env python3
"""Whether a turn can get out of this machine, and what to do when it cannot.

An exit node routes all of this machine's outbound traffic somewhere else. Every
part of serving a lesson is untouched -- tailnet traffic does not go through it,
so the iPad reaches the board exactly as before -- and every part of *teaching*
one goes through it, because the tutor's provider is on the ordinary internet.
Commercial VPN egress is precisely the address a provider geo-blocks, rate-limits
or challenges, and when that happens the symptom is a tutor which listens, fails
every turn, and says so only in a log nobody opens.

Three rules, and this file holds them:

  - a failed turn is not assumed to be a network fault, it is asked about, and
    only after it has already failed -- probing before every turn would put a
    round trip to the internet in front of every card a student is waiting for;
  - which endpoints matter is CONFIGURATION. The board is not allowed to know
    which assistant is driving it, so this is a list of URLs with a default, the
    same way a model is a command recipe and never a field;
  - a repair never turns the exit node off. Somebody routing everything through
    one is doing it deliberately, and dropping back to the bare connection to fix
    a tutoring session would expose the address they arranged not to expose.
"""

import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


sandbox = tempfile.mkdtemp(prefix="tutor-egress-")
os.environ["BOARD_STATE_DIR"] = sandbox
sys.path.insert(0, ROOT)
from tutorboard.net import egress, tailscale

# --- reading the tailscale picture ------------------------------------------
STATUS = {
    "Peer": {
        "a": {"HostName": "si-lju-wg-001", "TailscaleIPs": ["100.97.155.16"],
              "ExitNode": True, "ExitNodeOption": True, "Online": True},
        "b": {"HostName": "gb-lon-wg-001", "TailscaleIPs": ["100.1.1.1"],
              "ExitNodeOption": True, "Online": True},
        "c": {"HostName": "jp-tyo-wg-001", "TailscaleIPs": ["100.2.2.2"],
              "ExitNodeOption": True, "Online": False},
        "d": {"HostName": "somebodys-laptop", "TailscaleIPs": ["100.3.3.3"],
              "Online": True},
        "e": {"HostName": "us-lax-wg-001", "TailscaleIPs": ["100.4.4.4"],
              "ExitNodeOption": True, "Online": True},
    }
}

node = egress.exit_node(STATUS)
check("the exit node in use is found, by name and address",
      node == {"name": "si-lju-wg-001", "ip": "100.97.155.16"})
check("no exit node reads as none rather than as an error",
      egress.exit_node({"Peer": {"d": STATUS["Peer"]["d"]}}) is None)

opts = egress.exit_node_options(STATUS)
names = [o["name"] for o in opts]
check("every peer offering to be an exit node is an option", len(opts) == 4)
check("and a peer that is not offering is not one", "somebodys-laptop" not in names)
check("each option carries an address, because a bare name is refused by tailscale",
      all(o["ip"] for o in opts))

# --- the probe --------------------------------------------------------------
# ANY answer proves the path. A 401 to an unauthenticated POST is the healthiest
# possible result: the packets arrived, were understood, and were turned away for
# the one reason that says nothing about the network.
import urllib.error  # noqa: E402

calls = []


def fake_urlopen(req, timeout=None):
    calls.append(req.full_url)
    raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)


import urllib.request  # noqa: E402
real_urlopen = urllib.request.urlopen
urllib.request.urlopen = fake_urlopen
check("a 401 means reachable -- we asked whether packets arrive, not whether we may in",
      egress.egress_ok() is True)


def dead(req, timeout=None):
    raise urllib.error.URLError("nope")


urllib.request.urlopen = dead
check("a connection failure means not reachable", egress.egress_ok() is False)
urllib.request.urlopen = real_urlopen

check("the endpoints are configuration with a default, never a fact in the code",
      egress.DEFAULT_EGRESS_PROBE and callable(egress.egress_probe_urls))
lib = open(os.path.join(ROOT, "tutorboard", "net", "egress.py"), encoding="utf-8").read()
check("and the default is the only place a provider is named",
      lib.count("api.anthropic.com") == 1)

# --- rotation ---------------------------------------------------------------
moved = []
tailscale._ts_status = lambda: STATUS
egress.set_exit_node = lambda ip: (moved.append(ip), True)[1]

# Nothing works: the one the person chose has to be put back.
egress.egress_ok = lambda timeout=12: False
ok, detail = egress.rotate_exit_node(tries=2, log=None, settle=0)
check("when nothing works the rotation gives up rather than wandering", not ok)
check("and puts back the exit node the person actually chose",
      moved and moved[-1] == "100.97.155.16")
check("it never turns the exit node off, which would expose the real address",
      None not in moved and "" not in moved)
check("an offline exit node is never tried", "100.2.2.2" not in moved)

# The second one works.
moved[:] = []
tried = {"n": 0}


def works_on_second(timeout=12):
    tried["n"] += 1
    return tried["n"] >= 2


egress.egress_ok = works_on_second
ok, detail = egress.rotate_exit_node(tries=4, log=None, settle=0)
check("a working exit node is found and kept", ok)
check("and it is not the broken one it started on", moved[-1] != "100.97.155.16")
check("and it is remembered, since the only evidence one works is that it did",
      moved[-1] in json.load(open(egress.EGRESS_KNOWN_GOOD)))

# Known-good goes first next time.
moved[:] = []
tried["n"] = 0
egress.egress_ok = lambda timeout=12: True
ok, detail = egress.rotate_exit_node(tries=4, log=None, settle=0)
check("an exit node known to have worked is tried before the rest",
      ok and moved[0] in json.load(open(egress.EGRESS_KNOWN_GOOD)))

# With no exit node at all there is nothing here to repair, and the fault is
# real -- it must not be reported as fixed.
tailscale._ts_status = lambda: {"Peer": {}}
ok, detail = egress.rotate_exit_node(tries=2, log=None, settle=0)
check("with no exit node in use, a broken egress is not claimed to be repaired",
      not ok and "no exit node" in detail)

# --- where it is used -------------------------------------------------------
tutor_src = open(os.path.join(ROOT, "bin", "tutor"), encoding="utf-8").read()
check("the tutor asks about egress only after a turn has actually failed",
      "if err:" in tutor_src and
      tutor_src.index("if err:") < tutor_src.index("egress.egress_ok()"))
check("and rotates when it is the network rather than the tutor",
      "egress.rotate_exit_node(" in tutor_src)
check("and re-answers the message whose turn was lost, rather than waiting",
      "pending = out" in tutor_src and "out, pending = pending, None" in tutor_src)
check("and says plainly when it could not repair it",
      "turns will keep " in tutor_src)

board_src = open(os.path.join(ROOT, "bin", "board"), encoding="utf-8").read()
check("there is a command to ask, and to repair, by hand",
      "def cmd_egress(" in board_src and '"egress": cmd_egress' in board_src)
check("and doctor says so, since an exit node is invisible until it is not",
      "every request a tutor makes leaves from there" in board_src)

shutil.rmtree(sandbox, ignore_errors=True)
print()
print("%d FAILURES" % len(fails) if fails else "a turn can get out, or says why not")
sys.exit(1 if fails else 0)
