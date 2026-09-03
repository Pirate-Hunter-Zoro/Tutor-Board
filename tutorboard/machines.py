"""The other machines, and what each of them can teach.

Which courses exist is a property of a MACHINE -- they are whatever is cloned
next to the board -- so a course list is always some machine's list, and the
hub has to be able to ask more than one.
"""

import json
import os
import subprocess
import threading
import time

from . import choice, machine, paths, ports
from .course import config
from .lesson import cards
from .net import boards, tailscale


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


# What the other machines are running, and when we last asked. Rebuilt in the
# background rather than while somebody is waiting: it is a walk over the tailnet
# and the hub must open now, with whatever is known, and fill in.
_HOSTS = {"at": 0.0, "value": [], "busy": False}
HOSTS_FRESH = 25.0


def this_host_entry(repo):
    """This machine, as the hub sees it."""
    return {
        "host": "",                     # empty means "wherever you are"
        "name": tailscale.tailnet_self() or machine.node_name(),
        "here": True,
        "reachable": True,
        "courses": sibling_courses(repo),
    }


# The port a peer's board answered on last. See `peer_hosts`.
_PEER_PORT = {}


def peer_hosts(repo):
    """Every other machine on the tailnet that is running a board, and its courses.

    A board serves `/courses.json` for its own machine, so one board is enough to
    learn what a machine has -- the walk exists only to find somebody to ask, and
    it knocks on the ports of the courses we know because the two machines are
    clones of the same list far more often than not.
    """
    out = []
    ours = [c["repo"] for c in sibling_courses(repo)]
    for host in tailscale.tailnet_peers():
        found = None
        # The port that answered for this machine last time, first. The walk
        # below only knows the courses cloned paths.TOOL, and the two machines are not
        # the same list -- this pair has five courses on one and nine on the
        # other. So a peer whose only board is a course this machine has not got
        # is invisible to the walk, and once found it should not have to be
        # found again the hard way: a hub that loses a machine between refreshes
        # is a machine you cannot switch to.
        was = _PEER_PORT.get(host)
        if was and boards.board_health(host, was, timeout=1.0):
            found = was
        for name in ours if not found else []:
            port = ports.default_port(name)
            if boards.board_health(host, port, timeout=1.0):
                found = port
                break
        if not found:
            _PEER_PORT.pop(host, None)
            continue
        _PEER_PORT[host] = found
        doc = boards.board_json(host, found, "/courses.json", timeout=2.0) or {}
        courses = doc.get("courses") or []
        for c in courses:
            c["current"] = False        # "current" is about the board you asked
        out.append({"host": host, "name": host.split(".")[0], "here": False,
                    "reachable": True, "port": found, "courses": courses})
    return out


def known_hosts(repo):
    """This machine first, then whatever else answered when we last looked."""
    now = time.time()
    if now - _HOSTS["at"] > HOSTS_FRESH and not _HOSTS["busy"]:
        _HOSTS["busy"] = True

        def refresh():
            try:
                _HOSTS["value"] = peer_hosts(repo)
                _HOSTS["at"] = time.time()
            finally:
                _HOSTS["busy"] = False
        threading.Thread(target=refresh, daemon=True).start()
    return {"hosts": [this_host_entry(repo)] + list(_HOSTS["value"]),
            "node": machine.node_name()}


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

    The always-on host cannot read this machine's filesystem, so it cannot know
    either of these things -- it can only knock on ports and take whichever
    answers first, which is alphabetical order pretending to be a decision. So
    every board publishes the answer: the choice comes from `chosen.json`, and
    the port comes from that course's own board record, which is the only place
    the truth lives once a port collision has moved a board off its usual number.
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
    # `at` so the always-on host can tell this record from its OWN. The choice is
    # written on whichever machine was serving the hub when the course was
    # tapped, so there are two records of it and only the times can say which is
    # the person's latest word -- without that, a course tapped over here was
    # invisible to a follower reading only its own file, and the tap did every
    # correct thing while the address stayed put.
    # And the HOST, which was the half that never left this machine. The hub can
    # ask for a course ON a named machine, `wanted_host` in bin/follow is the
    # rule that honours it -- and it reads the host off whichever record is
    # newest, including the ones it gets by asking a board. This did not publish
    # one, so a choice made anywhere but the follower's own machine arrived with
    # the host silently blank and rule 0 could never fire: the person picked the
    # node, the record said the node, and the address went to whichever machine
    # `prefer` liked.
    return {"dir": name, "port": port or ports.default_port(name),
            "at": rec.get("at") or 0, "host": rec.get("host") or ""}


# How old a relayed tap may be before it is junk rather than a decision. Ten
# minutes is far longer than a relay can take (one POST, three second timeout)
# and far shorter than the gap between two sittings.
RELAY_STALE = 600


def announce_choice(repo, name, host, at):
    """Tell every machine that can hear it which course was just tapped.

    The record a tap writes is the only thing both machines can read, and until
    now each one wrote only its own copy: the other side found out by being asked
    on the follower's next tick, up to thirty seconds later. From the iPad that
    is a tap that does nothing, so you tap it again, and again -- reported in
    exactly those terms, ten times for one switch.

    Polling harder is the wrong fix. A tap is an event and it can simply be sent:
    one POST per machine, so every `chosen.json` on the tailnet changes within a
    moment of the finger coming off the glass, and every follower's own
    cheap file-watch fires. The relayed record keeps the ORIGINAL timestamp, so
    one tap is one identical record everywhere and there is nothing for two
    clocks to disagree about.

    Best effort by construction. A machine that is asleep, older, or unreachable
    simply does not get told, and the follower's tick still finds the choice the
    slow way -- this makes the common case instant, it does not become something
    the switch depends on.
    """
    names = [c["repo"] for c in sibling_courses(repo)]
    # The chosen course first: it is the one most likely to have a board up, and
    # one board is enough because every board on a machine publishes the same
    # record. Then a handful of others, in case that one is not running there.
    order = [name] + [n for n in names if n != name]
    payload = {"repo": name, "host": host or "", "at": at}
    for peer in tailscale.tailnet_peers():
        if tailscale.peer_is_down(peer):
            continue
        for n in order[:6]:
            got = boards.board_post(peer, ports.default_port(n),
                                      "/chose", payload, timeout=3.0)
            if got and got.get("ok"):
                break


def announce_later(repo, name, host, at):
    """`announce_choice` off the request's thread.

    The person is waiting on the response to their tap, and telling three
    machines is up to three round trips over a tailnet. None of it changes what
    this machine already recorded, so none of it belongs in front of the answer.
    """
    threading.Thread(target=announce_choice, args=(repo, name, host, at),
                     daemon=True).start()


def handover_secret():
    """The shared secret one machine presents to another to ask it to hand over.

    Unset means the endpoint is closed -- a board that has not been told the
    secret answers denied rather than inventing a trust boundary. Both machines
    carry the same value, top-level, in config.json.
    """
    try:
        with open(paths.CONFIG, "r", encoding="utf-8") as fh:
            cfg = json.load(fh) or {}
    except (OSError, ValueError):
        return None
    return cfg.get("handover_secret") or None


# ---------------------------------------------------------------------------
# TikZ -> SVG worker
# ---------------------------------------------------------------------------
# The course's own macros load first and win; board-macros.tex is all
# \providecommand, so it only fills in whatever the course did not define. Without
# it a command that renders fine in the prose fails inside a tikz fence, which is
# the most confusing way for a diagram to break.
