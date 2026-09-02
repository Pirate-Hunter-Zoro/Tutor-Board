"""Starting a board: parse the arguments, open the sockets, write the record.

Everything a board DOES lives in the package. This is the part that only
happens once, and the reason it is a module of its own is that a board is a
long-lived process identified by its command line -- `serve.py --root X --port
N` is what `board_is_running` matches and what `tutor restart` looks for, so the
entry point keeps its name and its shape.
"""

import json
import os
import socket
import sys
import threading
import time
from http.server import ThreadingHTTPServer

from .. import machine, paths
from ..course import repo as course_repo
from ..net import tailscale
from .handler import Handler
from .hub import Hub
from .tikz import TikzWorker


def lan_addresses():
    addrs = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        addrs.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return addrs


def main(argv):
    root = os.getcwd()
    port = 8778
    # Loopback by default. There is no authentication of any kind here, so
    # listening on every interface has to be a decision somebody made on purpose.
    # Tailscale reaches the board through 127.0.0.1 either way.
    host = "127.0.0.1"
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--root", "-r"):
            i += 1
            root = argv[i]
        elif a in ("--port", "-p"):
            i += 1
            port = int(argv[i])
        elif a == "--lan":
            host = "0.0.0.0"
        elif a == "--local":
            host = "127.0.0.1"
        i += 1

    repo = course_repo.Repo(root)
    worker = TikzWorker(repo)
    worker.start()
    hub = Hub(repo, worker)
    hub.payload = json.dumps(hub.build())

    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    httpd.repo = repo
    httpd.hub = hub

    t = threading.Thread(target=hub.poll_loop, daemon=True)
    t.start()

    # And a second door, on the tailnet address and nowhere else.
    #
    # A board listens on loopback, deliberately: there is no authentication here
    # and the university LAN is not somewhere to put an unauthenticated page. The
    # consequence went unnoticed for a week -- the OTHER machine could never see
    # this one's boards. The always-on host's follower probes a course's ports on
    # the compute node to decide where the address should point, every one of
    # those probes was refused by a socket bound to 127.0.0.1, and so the address
    # could only ever land on a board the Mac itself was running. From the iPad:
    # "Galois Theory is the only option, and when I tap Probability I can't
    # switch" -- and, when the Mac's own boards changed, the same sentence with
    # the courses the other way round.
    #
    # The tailscale address is not the LAN: it is reachable only by machines on
    # this tailnet, which is the same trust boundary the iPad already crosses to
    # read the lesson. So bind that one too, and only that one.
    tailnet = []
    for addr in tailscale.tailnet_addresses():
        try:
            second = ThreadingHTTPServer((addr, port), Handler)
        except OSError as exc:
            sys.stderr.write("not listening on %s: %s\n" % (addr, exc))
            continue
        second.daemon_threads = True
        second.repo = repo
        second.hub = hub
        threading.Thread(target=second.serve_forever, daemon=True).start()
        tailnet.append(addr)
    # And the way that works where binding does not: on a machine running
    # tailscaled in userspace mode the address exists but no interface carries
    # it, so `bind()` fails and the board would be invisible to the other machine
    # -- which is the machine that decides where the address points. tailscaled
    # accepts the connection itself and forwards it to loopback.
    if not tailnet and tailscale.publish_board(port):
        # The tailnet name, not the hostname: this machine is `compute302` to
        # slurm and `compute-node` on the tailnet, and only the second one is
        # reachable from the machine that needs to reach it.
        tailnet.append(tailscale.tailnet_self() or machine.node_name())

    info = {
        "pid": os.getpid(),
        "port": port,
        "bind": host,
        # The home directory is shared across compute nodes, so a pid on its own
        # says nothing -- the same number is very likely alive on this node and
        # belong to something else entirely.
        "node": machine.node_name(),
        "root": repo.root,
        # Only advertise what is actually listening.
        "urls": (["http://127.0.0.1:%d/" % port] +
                 ["http://%s:%d/" % (a, port) for a in tailnet] +
                 (["http://%s:%d/" % (a, port) for a in lan_addresses()]
                  if host == "0.0.0.0" else [])),
        "started": time.time(),
    }
    with open(os.path.join(repo.live, ".board.json"), "w", encoding="utf-8") as fh:
        json.dump(info, fh, indent=2)
    sys.stderr.write("board listening on %s\n" % ", ".join(info["urls"]))
    sys.stderr.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
