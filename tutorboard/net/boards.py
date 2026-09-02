"""Asking a board what it is.

/health is the honest test, and identity is asked rather than assumed: a port
is derived from a name and derivation is not proof.
"""

import json
import os
import urllib.request

from .. import ports
from . import socks, tailscale


def board_health(host, port, timeout=2.0):
    """What is answering on this host:port, or None. `/health` is the honest test.

    Here rather than in the follower because both machines need it now: the
    follower asks "where is this course", and a board asks "is anybody else
    already serving it" before it starts a second one.

    Two ways of asking, because the two machines are not alike. An ordinary
    socket, first, which is what a machine with a real tailscale interface uses;
    then the SOCKS proxy, which is the only way OUT of a machine running
    tailscaled in userspace mode. Without the second one the compute node cannot
    see the Mac at all, and every question it asks about the other machine gets
    the answer "nobody is there" -- which is how a second board and a second
    tutor for one course get started.
    """
    import urllib.request
    try:
        with urllib.request.urlopen("http://%s:%d/health" % (host, port),
                                    timeout=timeout) as resp:
            if resp.status != 200:
                return None
            doc = json.loads(resp.read(4096).decode("utf-8", "replace"))
            return doc if isinstance(doc, dict) and doc.get("ok") else None
    except Exception:                                            # noqa: BLE001
        pass
    # Never for loopback: a connection to this machine either works or there is
    # nothing there, and a proxy cannot change that. It also keeps a test's
    # make-believe world of ports on 127.0.0.1 from leaking onto the real
    # tailnet, where a course it believes is down may genuinely be up.
    if host in ("127.0.0.1", "::1", "localhost"):
        return None
    proxy = socks.socks_proxy()
    if not proxy:
        return None
    sock = socks._socks_open(host, port, proxy, timeout)
    if not sock:
        return None
    doc = socks._http_get_json(sock, "/health", timeout)
    return doc if isinstance(doc, dict) and doc.get("ok") else None


def board_is(health, name):
    """Is this board really the course we went looking for?

    Ports are derived from names, and derivation is not proof.
    """
    if not health:
        return False
    who = health.get("dir") or os.path.basename(health.get("root") or "")
    return who == name


def board_json(host, port, path, timeout=2.0):
    """Any JSON document off a board, by the same two routes `board_health` uses."""
    import urllib.request
    url = "http://%s:%d%s" % (host, port, path)
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            return json.loads(resp.read(1 << 20).decode("utf-8", "replace"))
    except Exception:                                            # noqa: BLE001
        pass
    if host in ("127.0.0.1", "::1", "localhost"):
        return None
    proxy = socks.socks_proxy()
    if not proxy:
        return None
    sock = socks._socks_open(host, port, proxy, timeout)
    if not sock:
        return None
    return socks._http_get_json(sock, path, timeout)


def board_post(host, port, path, payload, timeout=20.0):
    """POST JSON to a board, over whichever route this machine has."""
    import urllib.request
    body = json.dumps(payload or {}).encode()
    url = "http://%s:%d%s" % (host, port, path)
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read(1 << 20).decode("utf-8", "replace"))
    except Exception:                                            # noqa: BLE001
        pass
    if host in ("127.0.0.1", "::1", "localhost"):
        return None
    proxy = socks.socks_proxy()
    if not proxy:
        return None
    sock = socks._socks_open(host, port, proxy, timeout)
    if not sock:
        return None
    try:
        sock.settimeout(timeout)
        head = ("POST %s HTTP/1.0\r\nHost: board\r\nContent-Type: application/json\r\n"
                "Content-Length: %d\r\nConnection: close\r\n\r\n" % (path, len(body)))
        sock.sendall(head.encode() + body)
        buf = b""
        while len(buf) < (1 << 20):
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
    except OSError:
        return None
    finally:
        try:
            sock.close()
        except OSError:
            pass
    if b"\r\n\r\n" not in buf:
        return None
    try:
        return json.loads(buf.partition(b"\r\n\r\n")[2].decode("utf-8", "replace"))
    except ValueError:
        return None


def find_board(host, name, timeout=2.0):
    """The port this course is answering on at this host, or None."""
    for port in ports.port_sequence(name):
        health = board_health(host, port, timeout=timeout)
        if board_is(health, name):
            return port
        if health:
            break            # somebody else's board; the rest of the run is theirs
    return None


def locate_course(name, skip_local=False, hosts=(), timeout=2.0):
    """(host, port) of a board serving this course, anywhere this machine can see.

    Local first -- it is free and it is the common case -- then whatever hosts
    the caller names, then every online peer on the tailnet.
    """
    if not skip_local:
        port = find_board("127.0.0.1", name, timeout=1.0)
        if port:
            return ("127.0.0.1", port)
    seen = set(["127.0.0.1", "localhost"])
    for host in list(hosts) + tailscale.tailnet_peers():
        if not host or host in seen:
            continue
        seen.add(host)
        # `tailnet_peers` only offers machines that are up, but a host named by
        # the caller comes out of a config file and may have gone home.
        if tailscale.peer_is_down(host):
            continue
        port = find_board(host, name, timeout=timeout)
        if port:
            return (host, port)
    return None
