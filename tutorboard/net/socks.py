"""Reaching the tailnet from a machine that has no interface on it.

A machine without administrator rights runs tailscaled in userspace mode,
where the address exists and nothing carries it. The daemon offers a SOCKS5
proxy instead, and this is the half of every request that goes through it.
"""

import json
import os
import socket
import struct


def socks_proxy():
    """(host, port) of this machine's tailscale SOCKS proxy, if it has one.

    A machine running tailscaled in userspace mode cannot open a tailnet
    connection at all through the ordinary socket API -- there is no interface to
    route it -- and that is not only about being reached, it is about reaching:
    from the compute node, `curl https://board.tail0c6c62.ts.net/` fails to
    resolve and `curl http://100.79.20.10:9098/` has no route. The launcher
    starts tailscaled with `--socks5-server=localhost:1055` precisely so there is
    a way out; nothing used it.
    """
    for line in _proc_cmdlines():
        if "tailscaled" not in line or "--socks5-server" not in line:
            continue
        for word in line.split():
            if word.startswith("--socks5-server="):
                spec = word.split("=", 1)[1]
                host, _, port = spec.rpartition(":")
                try:
                    return ((host or "127.0.0.1").replace("localhost", "127.0.0.1"),
                            int(port))
                except ValueError:
                    return None
    return None


def _proc_cmdlines():
    out = []
    try:
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                with open("/proc/%s/cmdline" % pid, "rb") as fh:
                    out.append(fh.read().replace(b"\x00", b" ").decode("utf-8", "replace"))
            except OSError:
                continue
    except OSError:
        pass
    return out


def _socks_open(host, port, proxy, timeout):
    """A TCP connection to host:port through a SOCKS5 proxy, or None."""
    import socket
    import struct
    try:
        sock = socket.create_connection(proxy, timeout)
    except OSError:
        return None
    try:
        sock.settimeout(timeout)
        sock.sendall(b"\x05\x01\x00")
        if sock.recv(2) != b"\x05\x00":
            sock.close()
            return None
        name = host.encode("idna") if not host[0].isdigit() else host.encode()
        sock.sendall(b"\x05\x01\x00\x03" + bytes([len(name)]) + name
                     + struct.pack("!H", port))
        head = sock.recv(4)
        if len(head) < 4 or head[1] != 0:
            sock.close()
            return None
        if head[3] == 1:
            sock.recv(6)
        elif head[3] == 3:
            sock.recv(sock.recv(1)[0] + 2)
        elif head[3] == 4:
            sock.recv(18)
        return sock
    except (OSError, IndexError):
        try:
            sock.close()
        except OSError:
            pass
        return None


def _http_get_json(sock, path, timeout):
    try:
        sock.settimeout(timeout)
        sock.sendall(("GET %s HTTP/1.0\r\nHost: board\r\nConnection: close\r\n\r\n"
                      % path).encode())
        buf = b""
        while len(buf) < 65536:
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
    head, _, body = buf.partition(b"\r\n\r\n")
    if b" 200 " not in head.split(b"\r\n")[0]:
        return None
    try:
        return json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        return None
