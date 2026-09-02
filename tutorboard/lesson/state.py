"""What the board says about itself right now: the tutor, the write-up, the
review scope, the contents.
"""

import json
import os
import time

from .. import machine, processes
from ..course import homework, review, syllabus
from . import cards


def load_agent(repo):
    """Is an assistant attached, and is it working or waiting?

    An assistant nobody can see is worse than none. How that is decided depends
    on which kind it is: a headless daemon has a heartbeat and goes stale after
    two minutes of silence, while an interactive one is idle for as long as the
    person is thinking and is judged by whether its process is still there.
    Applying the heartbeat rule to both is why this indicator never once turned
    green in an ordinary `tutor` session.
    """
    try:
        with open(os.path.join(repo.live, "agent.json"), "r", encoding="utf-8") as fh:
            st = json.load(fh)
    except (OSError, ValueError):
        return None
    if not processes.agent_is_attached(st, machine.node_name()):
        # A daemon being BOUNCED is not a daemon that died, and the board is the
        # only place anybody finds out which it was. A restart marks the record
        # on its way out, so the gap between the old process going and the new
        # one writing its first heartbeat says "reattaching" rather than "no
        # tutor attached" -- which is what a course that never had one says, and
        # is a dead end in the middle of a lesson.
        st["state"] = "reattaching" if _reattaching(st) else "stale"
    return st


# How long a restart is given before the board stops calling it a restart. Long
# enough for a daemon to write its handoff turn and come back; short enough that
# a bounce that genuinely failed does not go on claiming to be in progress.
REATTACH_GRACE = 180


def _reattaching(st):
    """Was this record left behind by a restart that is still in flight?"""
    if not st.get("restarting"):
        return False
    try:
        since = time.time() - float(st.get("stopped_at") or 0)
    except (TypeError, ValueError):
        return False
    return 0 <= since <= REATTACH_GRACE


def load_hw(repo):
    """This sitting's problem set, and how much of it is written up.

    Parsed from the .tex on every build so the board tells the truth as the
    assistant fills it in, with the last compile's outcome bolted on from
    `live/hw.json` -- a failed compile has to reach the person holding the iPad
    the same way a failed push does.
    """
    try:
        st = homework.status(repo.root, repo.state())
    except Exception:
        return None
    if not st:
        return None
    st["ambiguous"] = st.get("ambiguous", [])[:8]
    st["sets"] = [x["name"] for x in homework.sets(repo.root)][:40]
    st.pop("dir", None)          # an absolute path on this machine is no use to a browser
    try:
        with open(os.path.join(repo.live, "hw.json"), "r", encoding="utf-8") as fh:
            st["build"] = json.load(fh)
    except (OSError, ValueError):
        st["build"] = None
    return st


def load_review(repo):
    """What this test review covers, so the board can say so and paint the picker.

    Cheap and always sent: it is a directory listing behind a lookup the payload
    already does, and the picker needs the list of things to pick from before a
    review sitting exists. The scope is re-resolved on every build rather than
    echoed back from `state.json` -- a chapter renamed out from under a sitting
    would otherwise stay on the strip for ever.
    """
    try:
        st = review.status(repo.root, repo.state())
    except Exception:                                        # noqa: BLE001
        return None
    if not st:
        return None
    st.pop("chosen", None)     # the names are enough; the board paints from units
    return st


def load_contents(repo):
    """What this course is made of, so the board can offer a way around it.

    Everything here is discovered, not registered: the chapter table or the
    chapter directories, the problem sets, and the lessons already filed. A
    course that is not a book simply has no chapters, and says so by returning
    none rather than by inventing a chapter one.
    """
    try:
        chapters = [{"num": c.get("num"), "label": syllabus.label(c)}
                    for c in syllabus.chapters(repo.root)][:60]
    except Exception:
        chapters = []
    try:
        sets = [{"name": x["name"], "rel": x["rel"]}
                for x in homework.sets(repo.root)][:60]
    except Exception:
        sets = []
    return {"chapters": chapters, "sets": sets}


def load_push(repo):
    """The outcome of the last push, so the iPad can see it without a terminal."""
    try:
        with open(os.path.join(repo.live, "push.json"), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def load_export(repo):
    """The outcome of the last export, for the same reason.

    A LaTeX run is a minute of somebody staring at an iPad, and the answer to
    "did that work" cannot be a line in a terminal nobody is looking at. It also
    has to survive the payload that lands the moment it finishes, which is why
    it is a file rather than a message.
    """
    try:
        with open(os.path.join(repo.live, "export.json"), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None
