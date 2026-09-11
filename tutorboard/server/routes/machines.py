"""Which machines are up, what each can teach, and which board the address
should follow.

Nothing here reaches the filesystem from a request: a course named in a
request is matched against what this server already discovered.
"""

import time
import json
import os

from . import NOT_MINE
from ...net import tailscale
from ... import machine
from ...net import boards
from ... import processes
from ... import ports
from ... import limits
from ... import choice
from .. import multipart
from .. import spawn
from ... import machines
from ...lesson import state


def get(h, repo, path):
    if path == "/hosts.json":
        # Every machine that can teach, and what each one has.
        #
        # Which courses exist is a property of the MACHINE -- it is whatever
        # is cloned next to the board -- so "pick a course" was always really
        # "pick a course on whichever machine happens to be serving you". The
        # iPad could not see the other machine's courses at all, let alone
        # choose one. Asked for in those words: "I want to be able to control
        # this at all times on the iPad - whatever hosts are available".
        return h.send_json(machines.known_hosts(repo))

    if path == "/courses.json":
        info = {}
        try:
            with open(os.path.join(repo.live, ".board.json"), "r", encoding="utf-8") as fh:
                info = json.load(fh)
        except (OSError, ValueError):
            pass
        urls = [u for u in info.get("urls", []) if "127.0.0.1" not in u]
        return h.send_json({
            "courses": machines.sibling_courses(repo),
            "where": (urls[0] if urls else "") ,
            "node": info.get("node"),
        })

    if path == "/health":
        # `dir` so a caller can confirm it reached the course it meant --
        # ports are derived from names and derivation is not proof, and the
        # hub checks this before it reloads into a lesson. `chosen` so a
        # decision can be read off a board rather than raced for. `limited`
        # so an allowance can be too: a board answering perfectly well whose
        # tutor has been told it is out of quota is still up, and is still
        # the wrong place to send a lesson. Only the machine serving can know
        # that -- the limit is written by its own tutor into its own state
        # directory -- so it is published here for the same reason the choice
        # is. `tutor` because between a board with a tutor listening and a
        # board with nobody behind it there is no contest: the second one is
        # a lesson that cannot answer. `host` so a CLIENT can tell which
        # machine it reached.
        agent = state.load_agent(repo) or {}
        return h.send_json({"ok": True, "root": repo.root,
                               "dir": os.path.basename(repo.root),
                               "host": tailscale.tailnet_self() or "",
                               "chosen": machines.chosen_target(),
                               "tutor": agent.get("state") or None,
                               "limited": limits.limited_until()})
    return NOT_MINE


def post(h, repo, path):
    if path == "/chose":
        # A choice made on another machine, relayed here the moment it was
        # made. It records and nothing else: no board is started, no address
        # is moved, no tutor is spawned. Knowing what was chosen is the whole
        # of what one machine needs from another.
        try:
            payload = json.loads(h.read_body().decode("utf-8") or "{}")
        except Exception:
            payload = {}
        want = (payload.get("repo") or "").strip()
        # A name, not a path. The record is read back by machinery that
        # joins it to a directory, so a request must never be able to put a
        # traversal in it.
        if not want or want != multipart.safe_filename(want):
            return h.send_json({"ok": False, "error": "bad course"}, status=400)
        try:
            at = float(payload.get("at") or 0)
        except (TypeError, ValueError):
            at = 0.0
        at = at or time.time()
        have = choice.chosen_course()
        try:
            mine_at = float(have.get("at") or 0)
        except (TypeError, ValueError):
            mine_at = 0.0
        # Already recorded: a no-op, and say so rather than rewriting the
        # file, because the file's modification time is a signal in its own
        # right and there is nothing here to signal.
        if have.get("dir") == want and mine_at >= at:
            return h.send_json({"ok": True, "kept": want,
                                   "detail": "already recorded"})
        # A relay carrying a genuinely ancient tap is junk, not a decision.
        # Note what is deliberately NOT here: a comparison of this timestamp
        # against the local record's to decide which is newer. They come off
        # two different clocks, and rejecting a person's tap because the
        # other machine's clock reads earlier is the failure that would be
        # impossible to see from an iPad. A relay is only ever sent the
        # instant somebody tapped, so arriving at all is the evidence.
        if at < time.time() - machines.RELAY_STALE:
            return h.send_json({"ok": False, "error": "stale"}, status=409)
        root = os.path.join(os.path.dirname(repo.root), want)
        choice.remember_chosen(want, root if os.path.isdir(root) else "",
                                 host=payload.get("host") or "", at=at)
        h.server.hub.worker.dirty.set()
        return h.send_json({"ok": True, "repo": want, "at": at})

    if path == "/hello":
        # Another machine saying where it is and what it has. The other half of
        # `machines.announce_self`, and the answer to a machine that cannot be
        # found by guessing: a peer is discovered by knocking on ports derived
        # from COURSE NAMES, so a machine whose only board is a course this one
        # has never heard of sits on a port nobody here will ever try. It said
        # so itself instead, and the reply says the same three things back, so
        # one exchange teaches both machines.
        try:
            payload = json.loads(h.read_body().decode("utf-8") or "{}")
        except Exception:                                        # noqa: BLE001
            payload = {}
        try:
            port = int(payload.get("port") or 0)
        except (TypeError, ValueError):
            port = 0
        # Only a machine this tailnet agrees is there, and spelled the way the
        # netmap spells it: this host goes into a file the board later POSTs to,
        # so it is checked against something that is not the request. A short
        # name matches its own first label, because a machine may introduce
        # itself either way and only the netmap's spelling is routable.
        said = (payload.get("host") or "").strip().lower().rstrip(".")
        host = ""
        for peer in tailscale.tailnet_peers():
            known = peer.lower()
            if said and said in (known, known.split(".")[0]):
                host = peer
                break
        if not host or not 1 <= port <= 65535:
            return h.send_json({"ok": False, "error": "not a machine here"},
                                  status=403)
        courses = []
        for c in (payload.get("courses") or [])[:64]:
            if not isinstance(c, dict):
                continue
            name = c.get("repo") or ""
            # A name, not a path: the hub joins these to a directory and a
            # request must never be able to put a traversal in one.
            if not name or name != multipart.safe_filename(name):
                continue
            try:
                count = int(c.get("cards") or 0)
            except (TypeError, ValueError):
                count = 0
            courses.append({
                "repo": name,
                "course": str(c.get("course") or name)[:120],
                "chapter": str(c.get("chapter") or "")[:200],
                "cards": max(0, count),
                "running": bool(c.get("running")),
                "node": str(c.get("node") or "")[:64] or None,
                "current": False,
            })
        machines.remember_peer(host, port, courses)
        h.server.hub.worker.dirty.set()
        return h.send_json({"ok": True, "host": tailscale.tailnet_self() or "",
                               "port": h.server.server_address[1],
                               "courses": machines.sibling_courses(repo)})

    if path == "/start":
        # Bring a course up ON THIS MACHINE, asked by a hub somewhere else.
        #
        # The hub can now offer the courses of every machine that is up, and
        # a course that is only cloned over there has to be startable from
        # over here or the offer is a lie. Same guard as `/switch`: only a
        # sibling directory this server already discovered, so no path from a
        # request ever reaches the filesystem.
        try:
            payload = json.loads(h.read_body().decode("utf-8") or "{}")
        except Exception:
            payload = {}
        want = payload.get("repo") or ""
        match = None
        for c in machines.sibling_courses(repo):
            if c["repo"] == want:
                match = c
                break
        if not match:
            return h.send_json({"ok": False, "error": "unknown course"}, status=404)
        target = os.path.join(os.path.dirname(repo.root), match["repo"])
        code, out = spawn.board_cli(target, ["start"])
        if code != 0:
            return h.send_json({"ok": False, "error": out.strip()[-300:]},
                                  status=500)
        # The choice belongs to the machine the person is looking at, and it
        # has already been recorded there; this records it here as well, so
        # whichever machine is asked gives the same answer.
        rec_at = time.time()
        choice.remember_chosen(match["repo"], target,
                                 host=payload.get("host") or "", at=rec_at)
        machines.announce_later(repo, match["repo"], payload.get("host") or "", rec_at)
        spawn.tutor_cli(["agent", "start", match["repo"]])
        return h.send_json({"ok": True, "repo": match["repo"],
                               "port": ports.default_port(match["repo"]),
                               "detail": out.strip()[-300:]})

    if path == "/switch":
        try:
            payload = json.loads(h.read_body().decode("utf-8"))
        except Exception:
            return h.send_json({"ok": False, "error": "bad json"}, status=400)
        want = payload.get("repo") or ""
        on_host = (payload.get("host") or "").strip()

        # A course on another machine. The person picked the host in the hub,
        # so this is not a guess to be made here: record the pair and ask that
        # machine to bring the course up. Nothing is started here -- starting a
        # second clone of somebody else's course is the thing that made a mess
        # of an evening -- and nothing about THIS machine's address changes,
        # because an address can only ever point at a board on the machine that
        # holds it. The lesson is then at that machine's own address, which is
        # what the answer says.
        if on_host and on_host != (tailscale.tailnet_self() or ""):
            # Where that machine answers, if it does. The hub can offer a
            # machine it has merely SEEN before -- that is deliberate, a machine
            # missing from the row is a machine nobody can reach -- so the tap
            # is where the honest answer about it belongs. Recording a choice
            # for a machine with no board on it moves nothing and reads as a tap
            # that did nothing, so it is not recorded at all.
            port = None
            for entry in machines.known_hosts(repo)["hosts"]:
                if entry.get("host") == on_host:
                    port = entry.get("port")
                    break
            if not port:
                port = machines.reach_host(repo, on_host)
            if not port:
                return h.send_json({
                    "ok": False,
                    "error": ("%s has no board answering. Bring one up on that "
                              "machine once and it is reachable from here."
                              % on_host.split(".")[0]),
                }, status=503)
            rec_at = time.time()
            choice.remember_chosen(want, "", host=on_host, at=rec_at)
            # Every machine, not only the one being asked to start it: a
            # decision is not the property of the machine that heard it.
            machines.announce_later(repo, want, on_host, rec_at)
            # `entry`, not `h`, in the lookup above. `h` is the REQUEST HANDLER,
            # and a `for h in ...` leaves the loop variable bound after the loop,
            # so every line below it was calling methods on a host dictionary:
            # `h.server` and `h.send_json` both died with "'dict' object has no
            # attribute". This is the branch a tap takes when the course is on
            # the OTHER machine -- the only branch a person switching machines
            # can reach -- so it was a 500 every time and the hub said "could
            # not move the board" without ever being able to say why.
            started = boards.board_post(on_host, port, "/start",
                                          {"repo": want, "host": on_host},
                                          timeout=60)
            h.server.hub.worker.dirty.set()
            # `address: False` is the whole of what the hub needs to know: this
            # address is not going to start serving that course, so waiting for
            # it to would be waiting for ever. The lesson is on that machine, at
            # that machine's own name.
            return h.send_json({
                "ok": True, "repo": want, "host": on_host, "address": False,
                "detail": ("%s is bringing %s up, at its own address"
                           % (on_host.split(".")[0], want))
                if started and started.get("ok")
                else ("asked for %s on %s" % (want, on_host.split(".")[0])),
            })

        # Only a sibling directory this server already discovered. No paths
        # from the request ever reach the filesystem.
        match = None
        for c in machines.sibling_courses(repo):
            if c["repo"] == want:
                match = c
                break
        if not match:
            return h.send_json({"ok": False, "error": "unknown course"}, status=404)
        target = os.path.join(os.path.dirname(repo.root), match["repo"])

        # A tap in the hub is a person saying which course they mean. The
        # record is written first and unconditionally, because it is the only
        # thing another machine can read and the only thing that survives this
        # board being restarted.
        rec_at = time.time()
        choice.remember_chosen(match["repo"], target,
                                 host=tailscale.tailnet_self() or "", at=rec_at)
        machines.announce_later(repo, match["repo"], tailscale.tailnet_self() or "", rec_at)

        # THE ADDRESS IS MOVED HERE, IN THIS REQUEST, BY THE MACHINE SERVING.
        #
        # A course has its own port, so the one name the iPad is installed
        # against has to be re-pointed at the board being opened or the tap
        # lands nowhere: the hub asks the address which course it is serving
        # before it reloads, the answer is still the old one, and after a
        # minute of that the page can only say so. From the iPad that is a
        # switch that cannot be made, reported as "whenever I want to switch
        # courses... I can hit it, but it never seems to work."
        #
        # `board vpn serve` is deliberate about this where `ts_repoint` is
        # careful: a start does not steal a name that a live board is holding,
        # because `tutor restart` walks every course on the machine and would
        # otherwise leave the address wherever the alphabet finished. A tap in
        # the hub is the opposite case -- it is a person naming the course they
        # want -- so it takes the name, and it is the only thing here that does.
        mine = processes.board_is_running(
            (machines.read_board_record(target) or {}).get("pid"), target)
        # Is anybody else already serving it? Asked, not assumed: if that
        # machine cannot be reached, a tap that deferred to it would do nothing
        # at all and the course could not be opened from anywhere. A probe is
        # the honest question, and when it finds nothing the answer is to start
        # it here.
        elsewhere = None if mine else boards.locate_course(
            match["repo"], skip_local=True, timeout=1.5)
        started, moved = "", False
        if mine or not elsewhere:
            code, out = spawn.board_cli(target, ["start"])
            if code != 0:
                return h.send_json({"ok": False, "error": out.strip()[-300:]},
                                      status=500)
            started = out.strip()
            vcode, _ = spawn.board_cli(target, ["vpn", "serve"])
            moved = vcode == 0
            # The assistant follows the course, and only where the course is
            # actually being served. Starting one from a tap on another machine
            # is how a lesson ends up with two.
            acode, aout = spawn.tutor_cli(["agent", "start", match["repo"]])
        else:
            acode, aout = 0, ("%s is serving this course, at its own address"
                              % elsewhere[0])
        return h.send_json({"ok": True, "repo": match["repo"], "address": moved,
                               "detail": started or aout,
                               "agent": aout.strip() if acode == 0 else None,
                               "agent_error": None if acode == 0 else aout.strip()[-300:]})

    if path == "/handover":
        # One machine asks another to wrap up before the course moves off it:
        # the assistant gets its one turn to write the handoff, rather than
        # being cut off mid-lesson. Gated on a shared secret, because a board
        # on the tailnet otherwise has no identity to trust and the iPad must
        # never be able to stop a lesson.
        secret = machines.handover_secret()
        given = h.headers.get("X-Handover") or ""
        if not secret or given != secret:
            return h.send_json({"ok": False, "error": "denied"}, status=403)
        # A PERSON NAMING THE MACHINE IS A DECISION, NOT A WOBBLE.
        #
        # `in_use` exists to stop MACHINERY ending a live sitting: nothing
        # automatic may stand down a board somebody is being taught on. It was
        # never meant to stop the owner of the course saying which machine owns
        # it, and a host picked by a person is an answer rather than a
        # preference to be weighed.
        #
        # It is only reachable with the shared secret, so it is not something
        # the iPad can do. `tutor agent stop <course> --on <host>` is what
        # sends it.
        forced = (h.headers.get("X-Handover-Force") or "").strip() not in ("", "0")
        busy = None if forced else in_use(repo)
        if busy:
            # See `in_use`. The caller is expected to ask again.
            return h.send_json({"ok": False, "error": "busy", "detail": busy},
                               status=409)
        name = os.path.basename(repo.root)
        code, out = spawn.tutor_cli(["agent", "stop", name])
        return h.send_json({"ok": code == 0,
                               "detail": out.strip()[-200:]})
    return NOT_MINE


# HOW LONG A BOARD GOES ON COUNTING AS ONE SOMEBODY IS USING.
#
# Long enough to cover thinking. A student staring at a Galois proof does
# nothing this can see for a quarter of an hour and is still very much in the
# lesson. The cost of being wrong the generous way is a tutor that stays
# listening for another ten minutes on a board nobody is reading, which costs
# nothing -- it is blocked on `board wait`. The cost of being wrong the other
# way is the lesson ending under somebody mid-proof.
IN_USE_FOR = 600


def in_use(repo):
    """Why this board must not be stood down right now, or None.

    A handover assumes the machine it is leaving stops being read, and that is
    not something the asking machine can know. A board publishes its own tailnet
    name, and a reader on that address carries on reading the lesson whatever
    anybody else has decided -- so an automatic handover can stop the tutor of a
    lesson that is running, reachable and being taught. It has: the student sent
    their working, the request arrived eight seconds later, and the daemon
    answered that one turn and left -- "stopped after 1 turn(s)", in the middle
    of exercise 3.11.

    Two questions, both answered off this machine:

      - is the tutor mid-turn? Bouncing it loses the card it is writing. This is
        the guard `tutor restart --tutors` has always applied and `/handover`
        never did;
      - has the student done anything here lately? Sending, handing in a page,
        writing on the slate. All three land on disk, which is what makes this
        survive a reload, a second device and the daemon being restarted.

    A board nobody is using answers None and hands over at once, which is the
    orphan case the handover exists for and the only case it now acts on.
    """
    st = state.load_agent(repo) or {}
    if st.get("state") == "working":
        return "the tutor is mid-turn"
    last = _last_student_act(repo)
    if last and time.time() - last < IN_USE_FOR:
        return ("somebody was working here %d seconds ago"
                % int(time.time() - last))
    return None


def _last_student_act(repo):
    """When the student last did something here, as a timestamp, or None.

    Their contributions, their inbox, and the writing surface -- the tutor's own
    cards are deliberately not among them, because a tutor writing into a board
    nobody can reach is the very thing being stood down.
    """
    newest = None
    for path in (repo.turns_path, repo.messages_path):
        try:
            at = os.path.getmtime(path)
        except OSError:
            continue
        if newest is None or at > newest:
            newest = at
    # A directory's own mtime moves when a file APPEARS in it and not when one
    # is written over, and the slate writes over the page being drawn on for as
    # long as the drawing goes on -- which is the whole of somebody working
    # without sending yet. So the files, not the directory.
    for d in (repo.slate, repo.answers):
        try:
            entries = list(os.scandir(d))
        except OSError:
            continue
        for e in entries:
            try:
                at = e.stat().st_mtime
            except OSError:
                continue
            if newest is None or at > newest:
                newest = at
    return newest
