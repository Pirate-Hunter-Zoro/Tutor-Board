"""Whether a turn can actually leave the building, and the exit node it leaves
through.

An exit node routes all of this machine's outbound traffic somewhere else.
Tailnet traffic is untouched, so the iPad reaches the board either way -- what
changes is whether the tutor can reach its model.
"""

import json
import os
import subprocess
import time
import urllib.error
import urllib.request

from .. import paths
from . import tailscale


# ---------------------------------------------------------------------------
# Exit nodes, and whether a turn can actually leave the building
# ---------------------------------------------------------------------------
# An exit node routes ALL of this machine's outbound traffic through somewhere
# else. Tailnet traffic is untouched, so the iPad reaches the board exactly as
# before and nothing about serving a lesson notices -- but every request the
# tutor makes to its provider now egresses from another country, and commercial
# VPN egress is precisely the sort of address a provider geo-blocks, rate-limits
# or challenges. The failure is total and looks like nothing: turns fail, the
# board shows a tutor listening, and the log fills with errors nobody reads.
#
# WHICH endpoints a turn needs is configuration, not code. The board is not
# allowed to know which assistant is driving it -- that is the same rule that
# makes a model a command recipe rather than a field -- so this is a list of URLs
# in the config with a default that happens to suit the default agent. Point it
# somewhere else and nothing here changes.
DEFAULT_EGRESS_PROBE = ("https://api.anthropic.com/v1/messages",)

# Exit nodes known to have carried a real turn. Tried first on a rotation,
# because the only evidence that an exit node works is that it once did.
EGRESS_KNOWN_GOOD = os.path.join(paths.STATE_DIR, "egress-ok.json")


def egress_probe_urls():
    try:
        with open(paths.CONFIG, "r", encoding="utf-8") as fh:
            cfg = json.load(fh) or {}
    except (OSError, ValueError):
        cfg = {}
    urls = cfg.get("egress_probe")
    if isinstance(urls, str):
        urls = [urls]
    return tuple(urls) if urls else DEFAULT_EGRESS_PROBE


def egress_ok(timeout=12):
    """Can a turn reach what it needs from here?

    ANY http answer counts, including 401 and 405. We are asking whether the
    packets arrive, not whether we are allowed in -- an unauthenticated probe
    that gets a 401 has proved the whole path. Only a connection failure, a DNS
    failure or a timeout means the egress is broken, which is exactly the shape a
    bad exit node produces.
    """
    import urllib.error
    import urllib.request
    for url in egress_probe_urls():
        req = urllib.request.Request(url, data=b"{}", method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=timeout)
            return True
        except urllib.error.HTTPError:
            return True                      # it answered; that is the question
        except (urllib.error.URLError, OSError):
            continue
    return False



def exit_node(status=None):
    """The exit node this machine is using, or None. Name and address."""
    st = status if status is not None else tailscale._ts_status()
    for peer in (st.get("Peer") or {}).values():
        if peer.get("ExitNode"):
            ips = peer.get("TailscaleIPs") or []
            return {"name": peer.get("HostName") or peer.get("DNSName", "").split(".")[0],
                    "ip": ips[0] if ips else None}
    return None


def exit_node_options(status=None):
    """Every peer offering to be an exit node, as name and address.

    The address is what matters: `tailscale set --exit-node` refuses a bare
    hostname it does not recognise, and an IP is never ambiguous.
    """
    st = status if status is not None else tailscale._ts_status()
    out = []
    for peer in (st.get("Peer") or {}).values():
        if not peer.get("ExitNodeOption"):
            continue
        ips = peer.get("TailscaleIPs") or []
        if not ips:
            continue
        out.append({"name": peer.get("HostName") or peer.get("DNSName", "").split(".")[0],
                    "ip": ips[0], "online": bool(peer.get("Online"))})
    return sorted(out, key=lambda p: p["name"])


def set_exit_node(ip):
    """Point this machine's egress at one exit node. Never turns one off.

    Disabling would be the obvious repair and it is the wrong one: somebody
    running everything through an exit node is doing it on purpose, and silently
    dropping back to the bare connection would expose the address they arranged
    not to expose in order to fix a tutoring session. If nothing works, the
    original is put back and the fault is reported.
    """
    prefix, _ = tailscale.tailscale_cli()
    if not prefix or not ip:
        return False
    import subprocess
    try:
        p = subprocess.run(prefix + ["set", "--exit-node=" + ip],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=40)
        return p.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _known_good():
    try:
        with open(EGRESS_KNOWN_GOOD, "r", encoding="utf-8") as fh:
            got = json.load(fh)
        return [x for x in got if isinstance(x, str)] if isinstance(got, list) else []
    except (OSError, ValueError):
        return []


def remember_good_exit_node(ip):
    if not ip:
        return
    seen = [x for x in _known_good() if x != ip]
    seen.insert(0, ip)
    try:
        os.makedirs(paths.STATE_DIR, exist_ok=True)
        tmp = EGRESS_KNOWN_GOOD + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(seen[:12], fh)
        os.replace(tmp, EGRESS_KNOWN_GOOD)
    except OSError:
        pass


def rotate_exit_node(tries=4, log=None, settle=4.0):
    """Find an exit node a turn can actually get out through.

    Returns (ok, detail). Only ever called when egress is already broken, so the
    machine starts in a state nobody wants to keep.

    Order: exit nodes that have carried a turn before, then the rest. Each one is
    tried and then PROVED, because the only way to know whether a provider
    answers from a given country is to ask from it. Bounded, because a rotation
    that walks four hundred Mullvad endpoints is an outage of its own.

    If nothing works the original is restored: a machine on a broken exit node
    the person chose is a better place to leave them than a machine on a random
    one they did not.
    """
    import time as _t

    def note(msg):
        if log:
            log(msg)

    status = tailscale._ts_status()
    was = exit_node(status)
    if not was:
        note("no exit node in use; the egress fault is not one this can repair")
        return False, "no exit node"

    options = [o for o in exit_node_options(status)
               if o["online"] and o["ip"] != was["ip"]]
    if not options:
        return False, "no other exit node is available"

    good = _known_good()
    options.sort(key=lambda o: good.index(o["ip"]) if o["ip"] in good else len(good))

    for cand in options[:max(1, tries)]:
        note("egress: trying exit node %s" % cand["name"])
        if not set_exit_node(cand["ip"]):
            continue
        _t.sleep(settle)                  # the route does not move instantly
        if egress_ok():
            remember_good_exit_node(cand["ip"])
            note("egress: %s works; staying there" % cand["name"])
            return True, cand["name"]

    set_exit_node(was["ip"])
    note("egress: no exit node tried could reach it; put %s back" % was["name"])
    return False, "tried %d, none worked" % min(len(options), max(1, tries))
