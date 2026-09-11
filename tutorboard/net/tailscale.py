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
    compute nodes on a shared home. A second machine that is up at the same time
    needs its own name, or the two fight over one identity. Set once with `board
    vpn up --hostname <name>`.
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



_TS_CACHE = [0.0, None]
TS_CACHE_TTL = 3.0


def _ts_status():
    """The netmap, as `tailscale status --json` gives it.

    Cached for a few seconds: who this machine is and what it is called are
    asked more than once in a breath, and neither can meaningfully change in
    between.
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


def tailnet_addresses():
    """This machine's own tailscale addresses, if it is on a tailnet.

    A board binds these as well as loopback: the tailnet is the trust boundary
    the iPad already crosses, and without them another machine cannot see this
    one's boards at all -- so a course served here can only ever be found from
    here.
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
    on the compute node, which is exactly the machine that has to be reachable.

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
