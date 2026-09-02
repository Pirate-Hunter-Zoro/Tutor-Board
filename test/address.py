#!/usr/bin/env python3
"""The tailnet address belongs to a course, and a deploy must not move it.

The installed iPad app has exactly one URL baked into it. Which lesson that URL
opens is decided by what the HTTPS name proxies to -- and starting a board used
to claim that name unconditionally. `tutor restart` restarts every board on the
machine, one after another, so a deploy handed the address to whichever course
came last in the list. Somebody halfway through a Galois proof was dropped into
a completely different course by a push, with no way to say which one they meant.

The rule this file holds: a name already pointing at a board that is up and
answering is that board's. A start does not take it. What takes it is the name
pointing at nothing, or an explicit `board vpn serve` -- a person saying which
course they mean.
"""

import importlib.machinery
import importlib.util
import os
import socket
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

errors = []


def ok(m):
    print("ok   " + m)


def fail(m):
    errors.append(m)
    print("FAIL " + m)


sys.path.insert(0, ROOT)
spec = importlib.util.spec_from_loader(
    "boardcli", importlib.machinery.SourceFileLoader("boardcli", os.path.join(ROOT, "bin", "board")))
board = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(board)
except Exception as exc:                                   # noqa: BLE001
    print("FAIL bin/board did not import: %s" % exc)
    sys.exit(1)
ok("bin/board imports without running")

STATUS = ("Available within your tailnet:\n\n"
          "https://board.tail0c6c62.ts.net/\n"
          "|-- proxy http://127.0.0.1:8787\n")

if board.served_port(STATUS) == 8787:
    ok("the port the name points at can be read back")
else:
    fail("served_port read %r out of a real serve status" % board.served_port(STATUS))

if board.served_port("nothing here") is None:
    ok("and a status with no proxy in it reads as nobody holding the name")
else:
    fail("served_port invented a port out of an empty status")

# `ts` folds stderr into stdout, and a client/daemon version skew prints a
# warning there -- so a real `status --json` can open with prose, not the JSON
# object. ts_info must still find the object rather than bail on the warning.
def _ts_warned(*a, **k):
    return 0, ("Warning: client version mismatch\n"
               '{"Self":{"DNSName":"board.tail0c6c62.ts.net.",'
               '"TailscaleIPs":["100.0.0.1","fd7a::1"]}}')

board.ts = _ts_warned
v4, name = board.ts_info()
if name == "board.tail0c6c62.ts.net" and v4 == "100.0.0.1":
    ok("ts_info reads the JSON behind a folded warning line")
else:
    fail("ts_info got %r / %r out of a status carrying a warning" % (v4, name))

# A real listener, so port_answers is tested against a socket and not a mock.
srv = socket.socket()
srv.bind(("127.0.0.1", 0))
srv.listen(1)
live_port = srv.getsockname()[1]

if board.port_answers(live_port):
    ok("a port with something listening on it answers")
else:
    fail("port_answers said no to a socket that is listening")

srv.close()
if board.port_answers(live_port):
    fail("port_answers said yes to a closed port")
else:
    ok("and a closed one does not")

# ---- the rule itself -------------------------------------------------------
#
# Drive ts_repoint with the tailnet stubbed out, and watch whether it issues the
# command that moves the address.

calls = []


def install(status, held_alive):
    """Stand in for the tailscale daemon: what the name points at, and whether
    the board it points at is still answering."""
    calls[:] = []
    board.ts_daemon_running = lambda *a, **k: True
    board.ts_info = lambda *a, **k: ("100.0.0.1", "board.tail0c6c62.ts.net")
    board.port_answers = lambda p: held_alive
    # serve_target branches on machine shape, which reads the real config. A test
    # must not depend on whatever that file happens to say, so pin it: these
    # cases are about a machine that points the name at its own board.
    board.machine.machine_shape = lambda: "standalone"

    def ts(*args, **kwargs):
        if args[:2] == ("serve", "status"):
            return 0, status
        calls.append(args)
        return 0, "serving"
    board.ts = ts


# serve_target is the one place the always-on host differs: it points the name
# at the follower proxy, never at a board port directly.
board.machine.follow_config = lambda: {"listen": "127.0.0.1:8844"}
board.machine.machine_shape = lambda: "always-on host"
if board.serve_target(8787) == "http://127.0.0.1:8844":
    ok("on an always-on host the name points at the follower proxy")
else:
    fail("serve_target on an always-on host did not point at the proxy")

board.machine.machine_shape = lambda: "standalone"
if board.serve_target(8787) == "http://127.0.0.1:8787":
    ok("and anywhere else it points at the board's own port")
else:
    fail("serve_target off the always-on host did not point at the board")


held = ("https://board.tail0c6c62.ts.net/\n|-- proxy http://127.0.0.1:8787\n")

install(held, held_alive=True)
board.ts_repoint(8812)
if calls:
    fail("starting another course took the address from a board that is still "
         "answering — this is the deploy that moved somebody mid-proof")
else:
    ok("a board that is up keeps the address when another course starts")

install(held, held_alive=False)
board.ts_repoint(8812)
if calls:
    ok("but a name pointing at a board that has gone is picked up")
else:
    fail("the address was left pointing at a dead board, which is a blank screen")

install(held, held_alive=True)
board.ts_repoint(8812, force=True)
if calls:
    ok("and `board vpn serve` still takes it, because that is a person asking")
else:
    fail("nothing can move the address deliberately any more")

install(held, held_alive=True)
board.ts_repoint(8787)
if calls:
    fail("the board already holding the address re-pointed it at itself")
else:
    ok("and re-pointing at where it already points does nothing at all")

# A board has to be REACHABLE from the other machine, or none of the above can
# happen at all.
#
# Boards bound 127.0.0.1 and nothing else, deliberately -- there is no
# authentication here. The consequence went unseen for a week: the always-on
# host's follower probes the compute node's ports to decide where the address
# should point, and every one of those probes was refused by a loopback socket.
# So the address could only ever land on a board the Mac itself was running, and
# switching course could not work no matter how correct the arbitration was.
src_serve = open(os.path.join(ROOT, "tutorboard", "server", "app.py"),
                 encoding="utf-8").read()
(ok if "for addr in tailscale.tailnet_addresses():" in src_serve else fail)(
    "a board listens on this machine's tailnet address as well as loopback")
(ok if "for a in tailnet]" in src_serve else fail)(
    "and says so in its record, so the far side knows where to knock")
(ok if "tailscale.publish_board(port)" in src_serve else fail)(
    "and where binding is impossible -- userspace tailscaled, which is every "
    "machine without administrator rights -- tailscaled forwards for it instead")
src_board = open(os.path.join(ROOT, "bin", "board"), encoding="utf-8").read()
(ok if "tailscale.unpublish_board(" in src_board else fail)(
    "and a stopped board takes its forwarding rule with it, rather than leaving "
    "one that points at a port nothing answers on")
(ok if 'if host == "0.0.0.0"' in src_serve else fail)(
    "but not on the LAN unless somebody asked for that")

src_follow = open(os.path.join(ROOT, "bin", "follow"), encoding="utf-8").read()
(ok if "boards.locate_course(want, skip_local=True" in src_follow else fail)(
    "and the follower finds a course wherever it is, rather than only at a "
    "hostname out of a config file that a new allocation invalidates")

# Reaching, as well as being reached.
#
# A machine running tailscaled in userspace mode cannot open a tailnet
# connection through the ordinary socket API either: from the compute node,
# `curl https://board.tail0c6c62.ts.net/` does not resolve and
# `curl http://100.79.20.10:9098/` has no route. Measured, both. The launcher has
# always started tailscaled with `--socks5-server=localhost:1055`, and nothing
# used it -- so every question the node asked about the other machine came back
# "nobody is there", which is how a second board and a second tutor for one
# course get started.
src_lib = open(os.path.join(ROOT, "tutorboard", "net", "socks.py"), encoding="utf-8").read()
src_ts = open(os.path.join(ROOT, "tutorboard", "net", "tailscale.py"), encoding="utf-8").read()
src_boards = open(os.path.join(ROOT, "tutorboard", "net", "boards.py"), encoding="utf-8").read()
(ok if "def socks_proxy(" in src_lib and "--socks5-server=" in src_lib else fail)(
    "the SOCKS proxy tailscaled is already running is found rather than assumed")
(ok if "proxy = socks.socks_proxy()" in src_boards else fail)(
    "and a health probe falls back to it when the ordinary socket cannot route, "
    "which on a machine with no administrator rights is always")
(ok if "def _proc_cmdlines(" in src_lib else fail)(
    "found by reading what is actually running, not by assuming a port number")

print("\n%d FAILURES" % len(errors) if errors else "\nthe address stays with the course")
sys.exit(1 if errors else 0)
