"""The course a person last asked for.

A decision, not a derivation. Resuming a course touches its files, so "most
recently used" is self-reinforcing and cannot stand in for this.
"""

import json
import os
import time

from . import paths


def chosen_course():
    """The course a PERSON last asked for, or {} if nobody ever has.

    A decision, not a derivation. `tutor <course>` writes it and so does a tap in
    the hub, and it is what the always-on host follows -- otherwise the proxy
    picks whichever board happens to answer first, which is alphabetical order
    wearing a disguise.
    """
    try:
        with open(paths.CHOSEN, "r", encoding="utf-8") as fh:
            return json.load(fh) or {}
    except (OSError, ValueError):
        return {}


def remember_chosen(name, root, host=None, at=None):
    """Record that this course was asked for. A note, never a requirement.

    `host` is the machine it was asked for ON, when the person picked one. Which
    courses exist is a property of a machine -- they are whatever is cloned next
    to the board -- so "Probability" can mean two different clones, and until the
    hub could offer the choice the answer was whichever machine won an argument.
    Empty means "wherever it is", which is the old behaviour and the right one
    when nobody has said.

    `at` is for a RELAYED record -- one tap, copied to every machine that can
    hear it -- and it is the originator's timestamp, kept rather than restamped.
    That matters more than it looks: the follower compares these times across
    machines to find the person's latest word, and two machines' clocks are not
    the same clock. One tap that lands as one identical record everywhere has
    nothing left to disagree about.
    """
    try:
        os.makedirs(paths.CONFIG_DIR, exist_ok=True)
        tmp = paths.CHOSEN + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"dir": name, "root": root, "at": float(at or time.time()),
                       "host": host or ""}, fh)
        os.replace(tmp, paths.CHOSEN)
        return True
    except (OSError, TypeError, ValueError):
        return False
