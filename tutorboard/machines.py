"""What this machine can teach, and which course was chosen on it.

Which courses exist is a property of a MACHINE -- they are whatever is cloned
next to the board -- so the list the hub draws is a directory listing, built
when it is asked for and never written down anywhere.
"""

import json
import os
import subprocess
import time

from . import choice, machine, paths, ports
from .course import config
from .lesson import cards


_SLURM = {"at": 0.0, "nodes": None}


def held_nodes():
    """Nodes this user still holds, cached for a few seconds.

    `sibling_courses` asks once per course and the hub asks often, so without a
    cache this is a `squeue` per repository per poll.
    """
    now = time.time()
    if now - _SLURM["at"] > 15.0:
        _SLURM["nodes"] = machine.slurm_nodes()
        _SLURM["at"] = now
    return _SLURM["nodes"]


def board_port(repo):
    """The port THIS board is listening on, off its own record."""
    rec = read_board_record(repo.root) or {}
    port = rec.get("port")
    try:
        return int(port) if port else ports.default_port(os.path.basename(repo.root))
    except (TypeError, ValueError):
        return ports.default_port(os.path.basename(repo.root))


def sibling_courses(repo):
    """Course repositories sitting alongside this one.

    A repository counts if it holds AI_INSTRUCTIONS.md or a live/ directory. The
    parent directory is the whole search -- there is no configuration and no
    registry to keep in step with reality.

    This is also the answer to "which subjects can I open from here", and it is
    the right answer by construction: it lists what the machine SERVING the board
    actually has on disk. A host with half the repositories cloned offers half
    the subjects, and no list anywhere has to be edited to say so.
    """
    parent = os.path.dirname(repo.root)
    out = []
    try:
        names = sorted(os.listdir(parent))
    except OSError:
        return out
    for name in names:
        root = os.path.join(parent, name)
        if not os.path.isdir(root):
            continue
        if not (os.path.isfile(os.path.join(root, "tutorboard.json")) or
                os.path.isfile(os.path.join(root, "AI_INSTRUCTIONS.md")) or
                os.path.isdir(os.path.join(root, "live"))):
            continue
        if os.path.abspath(root) == paths.TOOL:
            continue          # the tool is not one of the courses
        live = os.path.join(root, "live")
        cfg = config.read_config(root)
        entry = {
            "repo": name,
            # By the directory it is, not by the name this caller spells it
            # with: the same home is reachable under two paths here.
            "current": paths.same_dir(root, repo.root),
            "course": cfg["name"],
            "chapter": "",
            "cards": 0,
            "running": False,
            "node": None,
        }
        try:
            with open(os.path.join(live, "state.json"), "r", encoding="utf-8") as fh:
                st = json.load(fh)
            entry["course"] = st.get("course") or entry["course"]
            entry["chapter"] = st.get("chapter") or ""
        except (OSError, ValueError):
            pass
        try:
            entry["cards"] = len([n for n in os.listdir(os.path.join(live, "cards"))
                                  if cards.CARD_RE.match(n)])
        except OSError:
            pass
        try:
            with open(os.path.join(live, ".board.json"), "r", encoding="utf-8") as fh:
                info = json.load(fh)
            entry["node"] = info.get("node")
            if info.get("node") == machine.node_name():
                try:
                    os.kill(info.get("pid", -1), 0)
                    entry["running"] = True
                except OSError:
                    pass
            else:
                # A record naming another node proves nothing: the home
                # directory is shared, so a board that died with an allocation
                # leaves one behind that looks exactly like a live board. The
                # hub said "live on compute304" for hours after compute304
                # stopped being a machine this user had. Ask Slurm; `None` means
                # there is no Slurm to ask, which is unknown rather than gone.
                held = held_nodes()
                entry["running"] = held is None or info["node"] in held
                if not entry["running"]:
                    entry["node"] = None
        except (OSError, ValueError):
            pass
        out.append(entry)
    return out


def read_board_record(root):
    """A course's `.board.json`, or None. Which machine, which pid, which port."""
    try:
        with open(os.path.join(root, "live", ".board.json"), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def chosen_target():
    """The course a person last asked for, and the port it is actually serving on.

    Another machine cannot read this one's filesystem, so it cannot know either
    of these things -- it can only knock on ports and take whichever answers
    first, which is alphabetical order pretending to be a decision. So every
    board publishes the answer: the choice comes from `chosen.json`, and the port
    comes from that course's own board record, which is the only place the truth
    lives once a port collision has moved a board off its usual number.
    """
    rec = choice.chosen_course()
    name = rec.get("dir")
    if not name:
        return None
    root = rec.get("root") or os.path.join(os.path.dirname(paths.TOOL), name)
    port = None
    try:
        with open(os.path.join(root, "live", ".board.json"), "r", encoding="utf-8") as fh:
            port = (json.load(fh) or {}).get("port")
    except (OSError, ValueError):
        port = None
    # `at` so another machine can tell this record from its OWN. The choice is
    # written on whichever machine was serving the hub when the course was
    # tapped, so there can be two records of it and only the times can say which
    # is the person's latest word -- without that, a course tapped on one machine
    # was invisible to another reading only its own file, and the tap did every
    # correct thing while the address stayed put.
    # And the HOST, because the hub can ask for a course ON a named machine. A
    # record that did not publish one arrived with the host silently blank, and
    # the machine the person actually picked could not be honoured.
    return {"dir": name, "port": port or ports.default_port(name),
            "at": rec.get("at") or 0, "host": rec.get("host") or ""}


# ---------------------------------------------------------------------------
# TikZ -> SVG worker
# ---------------------------------------------------------------------------
# The course's own macros load first and win; board-macros.tex is all
# \providecommand, so it only fills in whatever the course did not define. Without
# it a command that renders fine in the prose fails inside a tikz fence, which is
# the most confusing way for a diagram to break.
