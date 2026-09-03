"""Running the board's own commands, from inside the board.

The hub can start a course, open a chapter or wake a tutor, and every one of
those is a command that already exists. Shelling out to it keeps one
implementation rather than two that drift.
"""

import os
import subprocess
import sys
import threading
import time

from .. import paths


def board_cli(repo, args, timeout=90):
    """Drive the board command line from inside the server, for /switch."""
    cli = os.path.join(paths.TOOL, "bin", "board")
    try:
        p = subprocess.run([sys.executable, cli] + list(args),
                           cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout)
        return p.returncode, p.stdout.decode("utf-8", "replace")
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)


def fresh_tutor(root, course):
    """Stop this course's assistant and start a new one, out of the way.

    The name is the whole of it: what comes back has read the new chapter's
    lesson and nothing else. `--wait` on the stop, so the two do not overlap;
    a start against a daemon that is still going would be a second one.
    """
    def run():
        tutor_cli(["agent", "stop", course, "--wait"], timeout=180)
        tutor_cli(["agent", "start", course], timeout=120)
    threading.Thread(target=run, daemon=True).start()


def tutor_cli(args, timeout=30):
    """Drive the launcher from inside the server, for the agent handover.

    The assistant belongs to the course, not to this process and not to the
    terminal anyone happens to have open, so switching course has to move it.
    Short timeout deliberately: `tutor agent start` detaches and returns, and
    `stop` only signals -- the wrap-up turn it triggers takes as long as it
    takes and nobody is waiting on it.
    """
    cli = os.path.join(paths.TOOL, "bin", "tutor")
    try:
        p = subprocess.run([sys.executable, cli] + list(args),
                           cwd=paths.TOOL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout)
        return p.returncode, p.stdout.decode("utf-8", "replace")
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)


# ---------------------------------------------------------------------------
# work handed in with nobody to read it
# ---------------------------------------------------------------------------
# A message going into the inbox did not start a tutor, and the inbox is not a
# queue anybody drains: `board wait` only ever returns to a daemon that is
# already running. So a send to a board whose tutor had died, or had never been
# started, or was still coming up when the allocation that held the last one
# ended, went onto disk and stayed there. The board said "listening" or said
# nothing, and the person who had just handed in an hour of working waited.
#
# Reported as: "the tutor was just marked as dead... which put me in 'send
# again' mode", and then "I don't ever want to be left hanging."
#
# So handing work in wakes a tutor. It is the same `tutor agent start` the hub
# tap and the login hook use -- one implementation -- and it is safe to call
# whenever, because that command refuses when a record is already live or
# already waking. The debounce here is for the case it cannot see: several sends
# in the same second, each forking a launcher that has not yet written the
# record the next one would read.
_WOKE = {}
WAKE_DEBOUNCE = 20.0


def wake_tutor(repo):
    """Start this course's tutor if nothing is reading the board. Never blocks.

    Returns whether an attempt was actually made, which is what the caller wants
    for its log line -- not whether a tutor is now up, because nothing that
    takes as long as a start can be reported by the request that triggered it.
    """
    from ..lesson import state

    try:
        agent = state.load_agent(repo)
    except Exception:                                        # noqa: BLE001
        agent = None
    # A record the board would paint as attached, waking, working or
    # reattaching. Only a genuinely dead one gets past here.
    if agent and agent.get("state") not in ("stale", "stopped"):
        return False

    course = os.path.basename(os.path.abspath(repo.root))
    now = time.time()
    if now - _WOKE.get(course, 0) < WAKE_DEBOUNCE:
        return False
    _WOKE[course] = now
    threading.Thread(target=tutor_cli, args=(["agent", "start", course],),
                     kwargs={"timeout": 60}, daemon=True).start()
    return True
