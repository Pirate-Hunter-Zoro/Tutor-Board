"""Is that process still there, and is it ours?

The home directory is shared across compute nodes, so a pid out of a record
may well be alive here and belong to a stranger. Every liveness test compares
the machine before it trusts the number.
"""

import os
import time

from . import paths

# How long a tutor is allowed to be waking up before the board stops believing
# it. Generous, because the slow part is a `git pull` against a remote and a
# tailnet coming back after an allocation ended, and neither is quick on a
# compute node; short enough that a start which died leaves a board that says so.
WAKING_GRACE = 300


def waking_now(record):
    """Is this `waking` record still plausibly a start in flight?"""
    try:
        since = time.time() - float(record.get("waking_at") or 0)
    except (TypeError, ValueError):
        return False
    return 0 <= since <= WAKING_GRACE


def board_is_running(pid, root):
    """Is this pid genuinely our board for this repository?

    A pid alone proves nothing: it may have been recycled, and on a shared
    filesystem the record may have been written by a different machine
    altogether. Check that the process is actually serving this directory --
    by the directory it IS, not by the name this caller happens to use for it.
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
    if "serve.py" not in args:
        return False
    parts = args.split()
    for n, word in enumerate(parts):
        if word == "--root" and n + 1 < len(parts):
            return paths.same_dir(parts[n + 1], root)
    return os.path.abspath(root) in args


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
    # A TUTOR ON ITS WAY UP IS NOT A TUTOR THAT DIED.
    #
    # Starting one is not instant and never was: the launcher brings the tailnet
    # link up, starts the board, opens the sitting, reads the addresses back and
    # catches the repository up from the remote before the daemon exists to have
    # a pid. All of that happens with the board ALREADY SERVING the iPad, so for
    # the whole of it the only record on disk was the last run's -- whose pid is
    # gone, which read as `stale`, which the board says out loud as "tutor
    # stopped -- nothing is reading the board".
    #
    # Reported from the iPad on a relaunch, and the consequence is the damage
    # rather than the wording: "It seemed to tell me the tutor was dead which
    # put me in 'send again' mode leading to massive confusion." The one thing
    # that must never happen here is the board saying nothing is listening while
    # something is in the middle of arriving.
    #
    # So a start writes `waking` before it does any of the slow work, and a
    # waking record is attached without a pid -- there is nothing to check yet.
    # It expires, because a start that fell over must not go on claiming to be
    # in progress for the rest of the evening; `WAKING_GRACE` is that window.
    if record.get("state") == "waking":
        # The launcher writes this before it forks, so there is nothing to check
        # but the clock. The daemon then rewrites it with its own pid, and from
        # that moment a start that DIED is knowable immediately rather than
        # having to wait out the grace -- which matters, because a board that
        # goes on promising a tutor for five minutes is its own kind of lie.
        if not waking_now(record):
            return False
        return pid_alive(record["pid"]) if record.get("pid") else True
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
