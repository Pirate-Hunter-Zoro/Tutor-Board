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
#
# `value` starts as None rather than empty, because "nobody has looked yet" and
# "there is nobody there" are different answers and the hub draws them the same.
# The first call fills it from disk.
_HOSTS = {"at": 0.0, "value": None, "busy": False}
HOSTS_FRESH = 25.0


# Machines this board has seen before, remembered on disk: the name, the port a
# board answered on, and what that machine could teach.
#
# Discovery is a walk over ports DERIVED FROM COURSE NAMES, and the two machines
# are not the same list -- five course repositories on the Mac, twelve on the
# compute node. So a walk that knocks on the ports of the courses cloned HERE can
# only find a peer that happens to be running a course this machine also has,
# and on 9 September it was not: the node's one board was PSYCH-ASR, on 9171,
# which the Mac has no clone of and therefore never knocked on. The node
# disappeared out of the hub, the row of machines hid itself because one machine
# is not a choice, and the report was "I don't see any options to go to the
# compute node".
#
# A machine's own course list is the answer to that, and it is already fetched
# every time one is found. Written down, it tells the next walk which ports are
# worth knocking on -- and it gives the hub something to draw for a machine that
# is not answering this minute, which is the difference between "that machine is
# quiet" and "that machine does not exist".
KNOWN = os.path.join(paths.STATE_DIR, "hosts.json")
# Long enough to survive a weekend and a slurm allocation ending; short enough
# that a machine genuinely gone stops being offered.
KNOWN_KEEP = 14 * 86400
# The ceiling on knocking, per machine. Same reasoning as PEER_WALK_LIMIT: a
# socket timeout each, and the follower does this walk on every tick.
PORT_KNOCKS = 8
# One writer at a time. The walk runs on a background thread and `/hello`
# arrives on a request thread, and both read-modify-write this file.
_KNOWN_LOCK = threading.Lock()


def known_peers():
    """Machines seen before, keyed by host. Ancient ones are forgotten on the way out."""
    try:
        with open(KNOWN, "r", encoding="utf-8") as fh:
            doc = json.load(fh) or {}
    except (OSError, ValueError):
        return {}
    now = time.time()
    out = {}
    for entry in (doc.get("hosts") or []) if isinstance(doc, dict) else []:
        if not isinstance(entry, dict):
            continue
        host = (entry.get("host") or "").strip()
        try:
            seen = float(entry.get("seen") or 0)
        except (TypeError, ValueError):
            seen = 0.0
        if not host or now - seen > KNOWN_KEEP:
            continue
        out[host] = {
            "host": host,
            "name": entry.get("name") or host.split(".")[0],
            "port": entry.get("port"),
            "seen": seen,
            "courses": [c for c in (entry.get("courses") or []) if isinstance(c, dict)],
        }
    return out


def remember_peer(host, port=None, courses=None, name=None, seen=None):
    """Write down a machine and how to reach it. Best effort: a lost note costs a walk."""
    if not host:
        return False
    with _KNOWN_LOCK:
        have = known_peers()
        was = have.get(host) or {}
        have[host] = {
            "host": host,
            "name": name or was.get("name") or host.split(".")[0],
            "port": int(port) if port else was.get("port"),
            # A machine that answered but said nothing about its courses keeps
            # whatever it last said, because an empty list would take the ports
            # of the next walk away with it.
            "courses": (courses if courses else was.get("courses")) or [],
            "seen": float(seen or time.time()),
        }
        try:
            os.makedirs(paths.STATE_DIR, exist_ok=True)
            tmp = KNOWN + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump({"hosts": sorted(have.values(),
                                           key=lambda e: -e["seen"])}, fh)
            os.replace(tmp, KNOWN)
            return True
        except (OSError, TypeError, ValueError):
            return False


def candidate_ports(host, ours, remembered=None):
    """Where to knock for a board on `host`, likeliest first.

    In order: the port that answered last, then the ports of the courses that
    machine said it had -- the ones it said were RUNNING first -- and only then
    the courses cloned here. The last of those three used to be the whole list,
    which is why a machine could vanish.
    """
    was = (known_peers() if remembered is None else remembered).get(host) or {}
    out = []

    def add(port):
        try:
            port = int(port)
        except (TypeError, ValueError):
            return
        if port and port not in out:
            out.append(port)

    add(was.get("port"))
    theirs = was.get("courses") or []
    for c in [c for c in theirs if c.get("running")] + \
             [c for c in theirs if not c.get("running")]:
        if c.get("repo"):
            add(ports.default_port(c["repo"]))
    for name in ours:
        add(ports.default_port(name))
    return out[:PORT_KNOCKS]


def reach_host(repo, host):
    """The port a board answers on over there, or None. Knocks if it has to."""
    if not host or tailscale.peer_is_down(host):
        return None
    ours = [c["repo"] for c in sibling_courses(repo)]
    for port in candidate_ports(host, ours):
        if boards.board_health(host, port, timeout=1.5):
            remember_peer(host, port)
            return port
    return None


def this_host_entry(repo):
    """This machine, as the hub sees it."""
    return {
        "host": "",                     # empty means "wherever you are"
        "name": tailscale.tailnet_self() or machine.node_name(),
        "here": True,
        "reachable": True,
        "courses": sibling_courses(repo),
    }


def peer_hosts(repo):
    """Every other machine this board knows of, and what each of them can teach.

    A board serves `/courses.json` for its own machine, so one board is enough to
    learn what a machine has -- the walk exists only to find somebody to ask.

    Two things it does that it used not to. It knocks on the ports of the courses
    the OTHER machine said it had, not only the ones cloned here, because those
    two lists are not the same and the difference is a machine that cannot be
    seen at all (see `KNOWN`). And a machine that has been seen before is still
    listed when it does not answer, marked unreachable, because a hub that hides
    a machine is indistinguishable from that machine not existing.
    """
    out = []
    ours = [c["repo"] for c in sibling_courses(repo)]
    remembered = known_peers()
    me = tailscale.tailnet_self() or ""
    answered = set()
    for host in tailscale.tailnet_peers():
        found = None
        for port in candidate_ports(host, ours, remembered):
            if boards.board_health(host, port, timeout=1.0):
                found = port
                break
        if not found:
            continue
        doc = boards.board_json(host, found, "/courses.json", timeout=2.0) or {}
        courses = doc.get("courses") or []
        for c in courses:
            c["current"] = False        # "current" is about the board you asked
        remember_peer(host, found, courses)
        introduce_later(repo, host, found)
        answered.add(host)
        out.append({"host": host, "name": host.split(".")[0], "here": False,
                    "reachable": True, "port": found, "seen": time.time(),
                    "courses": courses})
    out.extend(quiet_hosts(exclude=answered | {me}))
    return out


def quiet_hosts(exclude=()):
    """Machines seen before that are not answering now, as the hub should draw them.

    Their course list is the last one they gave, with the live flags stripped:
    what is RUNNING over there is the one thing a remembered list cannot still be
    telling the truth about.
    """
    out = []
    for host, entry in sorted(known_peers().items(), key=lambda kv: -kv[1]["seen"]):
        if host in exclude:
            continue
        out.append({
            "host": host, "name": entry["name"], "here": False,
            "reachable": False, "port": entry.get("port"), "seen": entry["seen"],
            "courses": [dict(c, current=False, running=False, node=None)
                        for c in entry["courses"]],
        })
    return out


def announce_self(repo, port):
    """Tell the other machines that this board is here, and what this one teaches.

    The reverse of the walk, and the half that cannot be guessed. A machine finds
    a peer by knocking on ports derived from course names, so a peer whose only
    board is a course it has never heard of is on a port it will never try. One
    POST removes the guess in that direction for good: whoever hears it knows the
    host, the port and the course list, and writes all three down. The reply
    carries the same three things back about the machine that answered, so one
    exchange teaches both sides and neither has to knock again.

    Best effort. A machine that is asleep or running older code simply does not
    get told, and the walk still finds it the slow way.
    """
    me = tailscale.tailnet_self()
    if not me:
        return                          # nothing to announce ourselves as
    mine = sibling_courses(repo)
    payload = {"host": me, "port": port, "courses": mine}
    ours = [c["repo"] for c in mine]
    for peer in tailscale.tailnet_peers():
        if tailscale.peer_is_down(peer):
            continue
        for at in candidate_ports(peer, ours):
            got = boards.board_post(peer, at, "/hello", payload, timeout=3.0)
            if got and got.get("ok"):
                remember_peer(peer, at, got.get("courses"),
                              name=(got.get("host") or peer).split(".")[0])
                break


def announce_self_later(repo, port):
    """`announce_self` off the start-up path. Nothing waits on it."""
    threading.Thread(target=announce_self, args=(repo, port), daemon=True).start()


# When each machine was last told about this one. See `introduce_later`.
_TOLD = {}
TELL_AGAIN = 600.0


def introduce_later(repo, host, port):
    """Having just found a machine, tell it about this one.

    Announcing at start-up alone is not enough, because it depends on the other
    machine already being able to hear it -- and the machine that has just come
    up is usually the one with the news. Finding a peer is proof that it can be
    reached RIGHT NOW, so it is the moment to introduce ourselves: whichever
    machine can see the other teaches it the way back, and the pair recovers
    however they were restarted. One POST per machine per ten minutes.
    """
    if time.time() - _TOLD.get(host, 0) < TELL_AGAIN:
        return
    _TOLD[host] = time.time()

    def tell():
        me = tailscale.tailnet_self()
        mine = board_port(repo)
        if not me or not mine:
            return
        got = boards.board_post(host, port, "/hello",
                                  {"host": me, "port": mine,
                                   "courses": sibling_courses(repo)}, timeout=5.0)
        if not (got and got.get("ok")):
            _TOLD.pop(host, None)       # it did not hear; try again next walk
    threading.Thread(target=tell, daemon=True).start()


def board_port(repo):
    """The port THIS board is listening on, off its own record."""
    rec = read_board_record(repo.root) or {}
    port = rec.get("port")
    try:
        return int(port) if port else ports.default_port(os.path.basename(repo.root))
    except (TypeError, ValueError):
        return ports.default_port(os.path.basename(repo.root))


def known_hosts(repo):
    """This machine first, then every other machine we know of.

    The walk happens in the background, so the first call answers out of the
    remembered file rather than with this machine on its own. That is not a
    nicety: the hub hid a row of one machine, so "nobody has looked yet" was
    drawn as "there is no other machine" on every cold open of the app.
    """
    now = time.time()
    if _HOSTS["value"] is None:
        _HOSTS["value"] = quiet_hosts(exclude={tailscale.tailnet_self() or ""})
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
    # record. Then wherever that machine is known to answer, and only then a
    # handful of ours -- the same order, and for the same reason, as the walk.
    order = [name] + [n for n in names if n != name]
    payload = {"repo": name, "host": host or "", "at": at}
    for peer in tailscale.tailnet_peers():
        if tailscale.peer_is_down(peer):
            continue
        knock = [ports.default_port(name)] + candidate_ports(peer, order[:6])
        seen = set()
        for at_port in [p for p in knock if not (p in seen or seen.add(p))]:
            got = boards.board_post(peer, at_port, "/chose", payload, timeout=3.0)
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
