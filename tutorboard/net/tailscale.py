"""Tailscale: who is up, what this machine is called on the tailnet, and how a
board makes itself reachable from the other machine.

Binding the tailnet address directly is the obvious way and it fails on the
one machine that matters, so `publish_board` uses `tailscale serve --tcp`,
which works in userspace mode too.
"""

import json
import os
import shutil
import subprocess
import time

from .. import paths


# ---------------------------------------------------------------------------
# Tailscale
# ---------------------------------------------------------------------------
# BOARD_STATE_DIR exists so a test can be run without writing the real thing.
# It is not a convenience: a bootstrap test once set this machine's tailnet name
# to the name of a different machine, which silently moved the address the iPad
# app was installed against. State that a test can reach is state a test will
# eventually corrupt.
TS_DIR = os.environ.get("BOARD_STATE_DIR") or os.path.join(paths.HOME, ".local", "state", "tailscale")
TS_SOCK = os.path.join(TS_DIR, "tailscaled.sock")

# Where a system-managed Tailscale keeps its CLI when it is not simply on PATH.
SYSTEM_TS = [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",     # the Mac App Store build
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/bin/tailscale",
]


TS_NAME_FILE = os.path.join(TS_DIR, "hostname")


def tailnet_hostname():
    """What this machine calls itself on the tailnet.

    Defaults to `board`, which is what makes the address survive moving between
    compute nodes on a shared home. A second machine -- an always-on Mac beside
    an occasional cluster node -- needs its own name, or the two fight over one
    identity. Set once with `board vpn up --hostname <name>`.
    """
    env = os.environ.get("BOARD_TAILNET_NAME")
    if env:
        return env
    try:
        with open(TS_NAME_FILE, "r", encoding="utf-8") as fh:
            name = fh.read().strip()
            if name:
                return name
    except OSError:
        pass
    return "board"


def set_tailnet_hostname(name):
    os.makedirs(TS_DIR, exist_ok=True)
    with open(TS_NAME_FILE, "w", encoding="utf-8") as fh:
        fh.write(name.strip() + "\n")


# How many other machines one walk of the tailnet may knock on. A person teaches
# on a handful of machines; anything past this is a fleet that arrived in the
# netmap by itself, and the walk costs four ports and a socket timeout each. See
# `tailnet_peers` for the evening this ceiling is here to prevent.
PEER_WALK_LIMIT = 12

_TS_CACHE = [0.0, None]
TS_CACHE_TTL = 3.0


def _ts_status():
    """The netmap, as `tailscale status --json` gives it.

    Cached for a few seconds. One tick of the follower asks who is up, who the
    node is, and what this machine is called; that was three subprocesses for
    one answer that cannot meaningfully change in between.
    """
    now = time.time()
    if _TS_CACHE[1] is not None and now - _TS_CACHE[0] < TS_CACHE_TTL:
        return _TS_CACHE[1]
    prefix, _ = tailscale_cli()
    if not prefix:
        return {}
    import subprocess
    try:
        p = subprocess.run(prefix + ["status", "--json"], stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, timeout=20)
        st = json.loads(p.stdout.decode("utf-8", "replace")) or {}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}
    _TS_CACHE[0], _TS_CACHE[1] = now, st
    return st


def peer_is_down(name, status=None):
    """Does the tailnet say this machine is off? True, False, or None for "no idea".

    Asked before knocking, because knocking on a machine that is not there is
    the most expensive way to learn nothing: four ports, a socket timeout each,
    and again through the SOCKS proxy -- 6.1s measured against this tailnet's
    compute node while it was asleep. The follower does that walk three times a
    tick, so a node that had gone home turned every re-decision into twenty
    seconds, and a tap on the iPad waited all of it.

    Tailscale already knows. It is the one question it can answer instantly.

    None rather than True when the answer is not known -- an empty netmap, no
    tailscale, a name that is not a peer -- because "I cannot tell" must mean
    "knock anyway". A machine wrongly assumed down is a lesson that cannot be
    reached, which is far worse than a slow tick.
    """
    if not name:
        return None
    st = status if status is not None else _ts_status()
    peers = st.get("Peer") or {}
    if not peers:
        return None
    want = str(name).split(".")[0].lower()
    for peer in peers.values():
        label = (peer.get("DNSName") or "").rstrip(".").split(".")[0].lower()
        if label == want or str(name) in (peer.get("TailscaleIPs") or []):
            return not peer.get("Online")
    return None


def tailnet_addresses():
    """This machine's own tailscale addresses, if it is on a tailnet.

    A board binds these as well as loopback: the tailnet is the trust boundary
    the iPad already crosses, and without them the other machine cannot see this
    one's boards at all -- which is a follower that can only ever point the
    address at itself.
    """
    prefix, _ = tailscale_cli()
    if not prefix:
        return []
    import subprocess
    try:
        p = subprocess.run(prefix + ["ip"], stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, timeout=10)
        out = p.stdout.decode("utf-8", "replace").split()
    except (OSError, subprocess.SubprocessError):
        return []
    # IPv4 only: the second socket is a convenience, and a v6 bind that fails on
    # a machine with no v6 route is noise in a log nobody reads.
    return [a for a in out if a.count(".") == 3]


def tailnet_self(status=None):
    """This machine's own tailnet name, which is not its hostname.

    A compute node is `compute302` to slurm and `compute-node` on the tailnet,
    and only the second one is reachable from anywhere else.
    """
    st = status if status is not None else _ts_status()
    name = ((st.get("Self") or {}).get("DNSName") or "").rstrip(".")
    return name


def publish_board(port, timeout=20):
    """Let the other machines on this tailnet reach this board.

    Binding the tailnet address directly is the obvious way and it does not work
    where it is most needed: a machine with no administrator rights runs
    tailscaled in USERSPACE mode, where the address exists but no interface
    carries it, and `bind()` returns "cannot assign requested address". Measured
    on the compute node, which is exactly the machine the always-on host has to
    be able to see.

    `tailscale serve --tcp` is the mechanism that works in both modes: tailscaled
    itself accepts the connection on the tailnet and forwards it to loopback. One
    per board, on the board's own port, so a course is reachable from the other
    machine at the same number it uses here -- which is what makes
    `locate_course` work without anything being published anywhere.
    """
    prefix, _ = tailscale_cli()
    if not prefix:
        return False
    import subprocess
    try:
        p = subprocess.run(prefix + ["serve", "--bg", "--tcp", str(port),
                                     "tcp://127.0.0.1:%d" % port],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout)
        return p.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def unpublish_board(port, timeout=20):
    """Take it off the tailnet again, so a stopped board leaves nothing behind."""
    prefix, _ = tailscale_cli()
    if not prefix:
        return False
    import subprocess
    try:
        p = subprocess.run(prefix + ["serve", "--tcp=%d" % port, "off"],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout)
        return p.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def tailnet_peers(status=None):
    """Every machine on this tailnet that is online, as something to knock on.

    The follower used to look for the compute node at ONE hostname, out of the
    config. A compute node's hostname is an allocation -- it was `compute302`
    today and something else last week -- so that name goes stale, and when it
    does the follower can see no board anywhere but its own. From the iPad that
    is: "Galois Theory is the only option, and when I tap Probability I can't
    switch", for ever, because the only machine it can find is the one it is on.

    So the configured name is a hint, not the answer. If it does not lead
    anywhere, ask the tailnet who is up and knock on all of them; a course's
    ports are derived from its name, so nothing needs to be published for this to
    work.
    """
    # A suite that is reasoning about which board wins must not reach the real
    # tailnet, where the answer depends on what is running tonight.
    if os.environ.get("BOARD_NO_TAILNET"):
        return []
    st = status if status is not None else _ts_status()
    out = []
    for peer in (st.get("Peer") or {}).values():
        if not peer.get("Online"):
            continue
        # A phone is not a machine that runs boards, and knocking on one costs a
        # timeout per port: three iPads on this tailnet turned a follower tick
        # into a minute of waiting. Ask the ones that could plausibly answer.
        if (peer.get("OS") or "").lower() in ("ios", "android", "tvos", "watchos"):
            continue
        # Nor is a tagged device. That is the same lesson as the iPads, at a
        # scale that stops being a slow tick and becomes a follower that never
        # decides anything again: a Mullvad exit-node subscription puts its whole
        # fleet in the netmap as online peers -- 544 of them here -- and they
        # carry no `OS`, so the filter above waved every one of them through.
        # Measured on this machine: 6.1s to knock on one exit node across the
        # four ports, so 55 minutes for one walk, while the follower is bounced
        # every fifteen. Not one tick ever finished. The address kept whatever
        # course was seeded at startup, a tap in the hub could not move it, and
        # the board looked healthy throughout -- because it was. Only the
        # deciding was dead.
        #
        # Tags are the right test rather than `ExitNodeOption`: a person's own
        # machine may advertise itself as an exit node and still be the machine
        # the lesson is on, whereas a tagged node belongs to infrastructure and
        # nobody teaches on it.
        if peer.get("Tags"):
            continue
        name = (peer.get("DNSName") or "").rstrip(".")
        if not name:
            ips = peer.get("TailscaleIPs") or []
            name = ips[0] if ips else ""
        if name:
            out.append(name)
    # And a ceiling, because the filters above are a list of surprises that have
    # already happened and the next one should cost a slow tick rather than a
    # follower that never decides again.
    return out[:PEER_WALK_LIMIT]


def tailscale_cli():
    """(argv_prefix, kind) for talking to whichever tailscale this machine has.

    Two shapes exist. On a machine with no administrator rights we run our own
    `tailscaled` in userspace mode and talk to it over a socket in the home
    directory. On a machine where Tailscale is already installed and running --
    a Mac, most obviously -- there is nothing to start and no socket to name;
    the system CLI is already connected and we should not fight it.
    """
    if os.path.exists(TS_SOCK):
        return (["tailscale", "--socket", TS_SOCK], "userspace")
    found = shutil.which("tailscale")
    if found:
        return ([found], "system")
    for p in SYSTEM_TS:
        if os.path.exists(p):
            return ([p], "system")
    return (None, "missing")


def tailscale_download_hint():
    """The right static build to fetch, for a machine that needs its own."""
    import platform
    sysname = platform.system().lower()
    machine = platform.machine().lower()
    if sysname == "darwin":
        return ("Tailscale on macOS is an application, not a static binary.\n"
                "Install it from the App Store or tailscale.com/download and sign in;\n"
                "there is no daemon for the board to start.")
    arch = {"x86_64": "amd64", "amd64": "amd64",
            "aarch64": "arm64", "arm64": "arm64"}.get(machine, "amd64")
    return ("mkdir -p ~/.local/opt/tailscale\n"
            "curl -L https://pkgs.tailscale.com/stable/tailscale_1.102.3_%s.tgz \\\n"
            "  | tar xz --strip-components=1 -C ~/.local/opt/tailscale\n"
            "ln -s ~/.local/opt/tailscale/tailscale{,d} ~/.local/bin/" % arch)
