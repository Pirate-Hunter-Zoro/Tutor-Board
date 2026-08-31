"""
boardlib.py -- the handful of things that differ between machines.

Both the server and the command line need to find a TeX installation and a
working `tailscale`, and neither should care whether it is running on a Linux
compute node, a Mac, or something else. Keeping the platform knowledge here means
there is one place to correct when it turns out to be wrong.

Standard library only, like everything else.
"""

import glob
import json
import os
import shutil
import time

HOME = os.path.expanduser("~")

CONFIG_DIR = os.path.join(
    os.environ.get("XDG_CONFIG_HOME", os.path.join(HOME, ".config")),
    "tutor-board")
CONFIG = os.path.join(CONFIG_DIR, "config.json")
CHOSEN = os.path.join(CONFIG_DIR, "chosen.json")

# Ports are a pure function of the directory name, so the same course answers on
# the same port on every machine -- which is what lets the always-on host find a
# board on the compute node without being able to read its filesystem.
PORT_BASE = 8780
PORT_SPAN = 512
PORT_TRIES = 4


def port_sequence(name):
    """The ports this course will try to bind, in order.

    A hash cannot promise distinct ports for distinct names, and it did not: two
    of these courses landed on the same number and the second one to start simply
    failed to come up. So a name maps to a short SEQUENCE rather than to one port,
    and a start walks it until something is free.

    It stays a pure function of the name -- no knowledge of what other courses
    exist -- because the two machines have different repositories cloned, and a
    rule that depended on the local listing would have them disagree about where
    a course lives.
    """
    h = 2166136261
    for ch in os.path.basename(name):
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return [PORT_BASE + (h + k * 97) % PORT_SPAN for k in range(PORT_TRIES)]


def default_port(name):
    """Where this course serves when nothing is in its way."""
    return port_sequence(name)[0]


def chosen_course():
    """The course a PERSON last asked for, or {} if nobody ever has.

    A decision, not a derivation. `tutor <course>` writes it and so does a tap in
    the hub, and it is what the always-on host follows -- otherwise the proxy
    picks whichever board happens to answer first, which is alphabetical order
    wearing a disguise.
    """
    try:
        with open(CHOSEN, "r", encoding="utf-8") as fh:
            return json.load(fh) or {}
    except (OSError, ValueError):
        return {}


def remember_chosen(name, root):
    """Record that this course was asked for. A note, never a requirement."""
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        tmp = CHOSEN + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"dir": name, "root": root, "at": time.time()}, fh)
        os.replace(tmp, CHOSEN)
        return True
    except OSError:
        return False


def tex_bin_dirs():
    """Every plausible TeX binary directory on this machine, in preference order.

    TinyTeX puts its binaries under an architecture-named directory whose name
    nobody should have to know: `x86_64-linux`, `aarch64-linux`,
    `universal-darwin`, and so on. Glob for it rather than guessing.
    """
    candidates = []
    for root in (os.path.join(HOME, ".TinyTeX"),
                 os.path.join(HOME, "Library", "TinyTeX"),      # TinyTeX on macOS
                 os.path.join(HOME, ".local", "TinyTeX")):
        candidates.extend(sorted(glob.glob(os.path.join(root, "bin", "*"))))
    candidates.append("/Library/TeX/texbin")                    # MacTeX
    candidates.extend(sorted(glob.glob("/usr/local/texlive/*/bin/*")))
    candidates.append("/opt/homebrew/bin")                      # Apple silicon brew
    return [d for d in candidates if os.path.isdir(d)]


def tex_env(extra_inputs=(), env=None):
    """A copy of the environment with TeX on PATH and TEXINPUTS set."""
    env = dict(env or os.environ)
    dirs = tex_bin_dirs()
    if dirs:
        env["PATH"] = os.pathsep.join(dirs + [env.get("PATH", "")])
    inputs = [p for p in extra_inputs if p]
    if inputs:
        env["TEXINPUTS"] = os.pathsep.join(inputs + [env.get("TEXINPUTS", "")])
    return env


def have_tex(env=None):
    env = env or tex_env()
    path = env.get("PATH", "")
    return all(shutil.which(x, path=path) for x in ("latex", "pdflatex", "dvisvgm"))


def slurm_nodes():
    """Nodes where this user currently holds an allocation, or None if unknown.

    Platform knowledge, so it lives here: `board` uses it to decide whether a
    lock belongs to a job that has ended, and `tutor resume` uses it to decide
    whether the node named in a record is a machine that still exists. Where
    there is no `squeue` the answer is None -- unknown, not empty -- and every
    caller must treat those differently, because "no allocations" and "not a
    cluster" lead to opposite decisions.
    """
    import re
    import subprocess
    try:
        p = subprocess.run(["squeue", "-h", "-u", os.environ.get("USER", ""), "-o", "%N"],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
        if p.returncode != 0:
            return None
        out = p.stdout.decode("utf-8", "replace")
        nodes = set()
        for tok in re.findall(r"compute\[?([0-9,\-]+)\]?", out):
            for part in tok.split(","):
                if "-" in part:
                    a, b = part.split("-", 1)
                    for n in range(int(a), int(b) + 1):
                        nodes.add("compute%d" % n)
                else:
                    nodes.add("compute" + part)
        return nodes
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None


def board_is_running(pid, root):
    """Is this pid genuinely our board for this repository?

    A pid alone proves nothing: it may have been recycled, and on a shared
    filesystem the record may have been written by a different machine
    altogether. Check that the process is actually serving this directory.
    """
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
    except (OSError, TypeError, ValueError):
        return False
    args = _cmdline(pid)
    if args is None:
        return True          # cannot tell; the pid is alive, so believe it
    return "serve.py" in args and os.path.abspath(root) in args


def pid_alive(pid, needle=None):
    """Is this pid alive here, and does it still look like what was recorded?

    Pids are recycled, so a bare signal-0 check will eventually report a
    stranger's process as ours. Where the command line can be read, the recorded
    command has to still be in it.
    """
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
    except (OSError, TypeError, ValueError):
        return False
    if not needle:
        return True
    args = _cmdline(pid)
    if args is None:
        return True          # cannot tell; the pid is alive, so believe it
    return os.path.basename(str(needle)) in args


def agent_is_attached(record, host):
    """Is the assistant this record describes still there?

    Two kinds of record, and they expire for different reasons. A headless daemon
    writes a heartbeat as it works, so two minutes of silence means it died. An
    interactive assistant sits idle for exactly as long as the person in front of
    it is thinking, and a heartbeat there would call a perfectly healthy session
    dead the moment somebody went to make tea -- so the process itself is the
    answer, and its pid is what gets checked.

    Either way the host is compared first: the home directory is shared across
    compute nodes, and a pid from a node whose allocation has ended is very
    likely alive here and belonging to a stranger.
    """
    if not record:
        return False
    if record.get("host") and record["host"] != host:
        return False
    if record.get("mode") == "interactive":
        return pid_alive(record.get("pid"), record.get("cmd"))
    # A daemon records its own pid, and a process either exists or it does not --
    # which is a better answer than a heartbeat and cannot go stale mid-thought.
    # The heartbeat used to be the only test, and since it is written at turn
    # boundaries, any turn longer than the window reported a daemon busy teaching
    # as dead. A teaching turn routinely takes longer than two minutes.
    if record.get("pid"):
        return pid_alive(record["pid"])
    return (time.time() - record.get("last_seen", 0)) <= 120


def _cmdline(pid):
    proc = "/proc/%s/cmdline" % pid
    if os.path.exists(proc):
        try:
            with open(proc, "rb") as fh:
                return fh.read().replace(b"\x00", b" ").decode("utf-8", "replace")
        except OSError:
            return None
    try:
        import subprocess
        out = subprocess.run(["ps", "-p", str(pid), "-o", "args="],
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
        return out.stdout.decode("utf-8", "replace") if out.returncode == 0 else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# What this machine calls itself
# ---------------------------------------------------------------------------
# Every record that crosses `live/` carries this name, and every liveness check
# compares it before trusting a pid. So if it moves, a machine stops recognising
# its own boards: `tutor restart` skips them as another node's, the hub says they
# are running somewhere else, and a board that is answering perfectly well
# becomes impossible to bounce onto new code. That is not hypothetical -- it
# happened here, and it cost an evening of wondering why a shipped fix had not
# landed.
#
# It moved because nothing had pinned it. A Mac with no `HostName` set derives
# its name from the network, so Tailscale's DNS renamed this machine from
# `mac-mini` to `board` between one board starting and the next command asking
# who was running it. Worse, the name was being *derived* in four places in four
# files -- `os.uname()` in the launcher, `socket.gethostname()` in the board and
# the server -- which can disagree with each other on the same machine.
#
# So: one function, and a pinned answer. The board is not entitled to a stable
# machine name from the operating system, so it keeps its own.
STATE_DIR = os.environ.get("BOARD_STATE_DIR") or \
    os.path.join(HOME, ".local", "state", "tutor-board")
NODE_NAME_FILE = os.path.join(STATE_DIR, "nodename")


def _normal_node(name):
    """One form for one machine.

    First label, lowercased: `board.tail0c6c62.ts.net` and `Mac-mini` and
    `mac-mini` must not be three machines, because a record written under one
    spelling has to be believed under another.
    """
    return (name or "").strip().split(".")[0].lower() or "unknown"


def system_node_name():
    """Whatever the operating system says today. Not to be trusted alone."""
    return _normal_node(os.uname().nodename)


def node_name():
    """What this machine calls itself. The only place that decides.

    Most explicit first: the environment (for a test, or a one-off), then the
    pinned file, then -- only when nothing has ever pinned one -- the system.
    """
    env = os.environ.get("BOARD_NODE_NAME")
    if env and env.strip():
        return _normal_node(env)
    try:
        with open(NODE_NAME_FILE, "r", encoding="utf-8") as fh:
            name = fh.read().strip()
            if name:
                return _normal_node(name)
    except OSError:
        pass
    return system_node_name()


def node_name_pinned():
    """The pinned name, or None if this machine is still trusting the network."""
    try:
        with open(NODE_NAME_FILE, "r", encoding="utf-8") as fh:
            return _normal_node(fh.read()) or None
    except OSError:
        return None


def pin_node_name(name=None):
    """Freeze this machine's name so the network cannot change it underneath us.

    With no argument it pins whatever the machine is called right now, which is
    the right move the first time: it freezes a name that already matches the
    records sitting on disk. Returns the name pinned.
    """
    name = _normal_node(name) if name else system_node_name()
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = NODE_NAME_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(name + "\n")
    os.replace(tmp, NODE_NAME_FILE)
    return name


# ---------------------------------------------------------------------------
# Tailscale
# ---------------------------------------------------------------------------
# BOARD_STATE_DIR exists so a test can be run without writing the real thing.
# It is not a convenience: a bootstrap test once set this machine's tailnet name
# to the name of a different machine, which silently moved the address the iPad
# app was installed against. State that a test can reach is state a test will
# eventually corrupt.
TS_DIR = os.environ.get("BOARD_STATE_DIR") or os.path.join(HOME, ".local", "state", "tailscale")
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


def follow_config():
    """The `follow` block of the config, or {} when there is none.

    The block is what marks a machine as the always-on host, so both the server
    and the launcher read it through this one place.
    """
    try:
        with open(CONFIG, "r", encoding="utf-8") as fh:
            cfg = json.load(fh) or {}
    except (OSError, ValueError):
        return {}
    return cfg.get("follow") or {}


def machine_shape():
    """What this machine is for: always-on host, compute node, or standalone.

    Guessing this from the hostname is how it gets subtly wrong, so it is
    decided from what is actually true: an always-on host is configured to
    follow, a compute node is where Slurm answers, and everything else is a
    standalone machine.
    """
    if follow_config():
        return "always-on host"
    if slurm_nodes() is not None:
        return "compute node"
    return "standalone"


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
