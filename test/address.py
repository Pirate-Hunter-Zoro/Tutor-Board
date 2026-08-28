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

    def ts(*args, **kwargs):
        if args[:2] == ("serve", "status"):
            return 0, status
        calls.append(args)
        return 0, "serving"
    board.ts = ts


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

print("\n%d FAILURES" % len(errors) if errors else "\nthe address stays with the course")
sys.exit(1 if errors else 0)
