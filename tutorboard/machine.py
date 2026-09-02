"""What this machine calls itself, and what it is for.

Every record that crosses live/ carries this name and every liveness check
compares it, so if it moves, a machine stops recognising its own work.
"""

import json
import os
import subprocess

from . import paths


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
NODE_NAME_FILE = os.path.join(paths.STATE_DIR, "nodename")


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


def should_pin_node_name():
    """Is this a machine whose name is worth freezing?

    Not on a cluster. There the name changes between allocations because it is
    genuinely a different machine each time, and that is load-bearing: every
    liveness check asks Slurm whether the node in a record is still one you hold.
    Pin `compute301` and the next allocation calls itself `compute301` while
    Slurm says you have `compute309`, so `tutor resume` refuses to start a board
    on a machine it thinks is not yours, and a record from a node that really has
    gone looks alive for ever.

    The instability this fixes is a different one: a Mac with no `HostName` set
    taking its name from whatever DNS answers that day, which is not a change of
    machine at all.
    """
    return slurm_nodes() is None


def pin_node_name(name=None):
    """Freeze this machine's name so the network cannot change it underneath us.

    With no argument it pins whatever the machine is called right now, which is
    the right move the first time: it freezes a name that already matches the
    records sitting on disk. Returns the name pinned.

    Callers that pin automatically must ask `should_pin_node_name()` first; a
    person naming one explicitly is always obeyed.
    """
    name = _normal_node(name) if name else system_node_name()
    os.makedirs(paths.STATE_DIR, exist_ok=True)
    tmp = NODE_NAME_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(name + "\n")
    os.replace(tmp, NODE_NAME_FILE)
    return name


def follow_config():
    """The `follow` block of the config, or {} when there is none.

    The block is what marks a machine as the always-on host, so both the server
    and the launcher read it through this one place.
    """
    try:
        with open(paths.CONFIG, "r", encoding="utf-8") as fh:
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
