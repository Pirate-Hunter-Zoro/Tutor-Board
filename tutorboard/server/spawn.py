"""Running the board's own commands, from inside the board.

The hub can start a course, open a chapter or wake a tutor, and every one of
those is a command that already exists. Shelling out to it keeps one
implementation rather than two that drift.
"""

import os

from .. import paths
import subprocess
import threading
import sys


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
