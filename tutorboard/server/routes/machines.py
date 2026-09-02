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
        # ports are derived from names and derivation is not proof. `chosen`
        # so the always-on host can follow a decision instead of a race.
        # `limited` so it can follow an allowance too: a board answering
        # perfectly well whose tutor has been told it is out of quota is
        # still up, and is still the wrong machine to hand a lesson to.
        # Only the machine serving can know that -- the limit is written by
        # its own tutor into its own state directory -- so it is published
        # here for the same reason the choice is.
        # `tutor` so the follower can prefer a board that actually has one.
        # Two machines can end up with a board for the same course -- a tap
        # in a hub used to start one wherever the tap landed -- and between
        # a board with a tutor listening and a board with nobody behind it
        # there is no contest: the second one is a lesson that cannot answer.
        # `host` so a CLIENT can tell which machine it reached. The hub
        # waits for a switch to actually land before it reloads, and "the
        # right course" is not the whole question when both machines have a
        # clone of it.
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
        # is moved, no tutor is spawned. The follower does all of that, and
        # the only thing it was ever short of was knowing.
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
        # file, because the file's modification time is what wakes the
        # follower and there is nothing here to wake it for.
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
        # whichever machine the follower asks gets the same answer.
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
        # so this is not a guess to be made here: record the pair, ask that
        # machine to bring the course up, and let the follower point the
        # address at it. Nothing is started here -- starting a second clone of
        # somebody else's course is the thing that made a mess of an evening.
        if on_host and on_host != (tailscale.tailnet_self() or ""):
            rec_at = time.time()
            choice.remember_chosen(want, "", host=on_host, at=rec_at)
            # Every machine, not only the one being asked to start it. The
            # follower lives on whichever machine holds the address, and
            # that is not always either of these two.
            machines.announce_later(repo, want, on_host, rec_at)
            port = None
            for h in machines.known_hosts(repo)["hosts"]:
                if h.get("host") == on_host:
                    port = h.get("port")
                    break
            started = None
            if port:
                started = boards.board_post(on_host, port, "/start",
                                              {"repo": want, "host": on_host},
                                              timeout=60)
            h.server.hub.worker.dirty.set()
            return h.send_json({
                "ok": True, "repo": want, "host": on_host,
                "detail": ("%s is bringing %s up; the address follows"
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

        # A tap in the hub is a person saying which course they mean, and
        # that -- the RECORD -- is the whole of what moves the address. It is
        # written first and unconditionally, because on a pair of machines it
        # is the only thing both of them can read.
        rec_at = time.time()
        choice.remember_chosen(match["repo"], target,
                                 host=tailscale.tailnet_self() or "", at=rec_at)
        machines.announce_later(repo, match["repo"], tailscale.tailnet_self() or "", rec_at)

        # What this machine does about it depends on whether this machine is
        # the one that decides.
        #
        # It used to do all of it, everywhere: start the course's board here,
        # take the tailnet name for it here, and start a tutor for it here --
        # whichever machine happened to be serving the hub. On one machine
        # that is exactly right. On two it is the cause of an evening's worth
        # of damage reported on 1 September 2026:
        #
        #   - two boards for one course, one on each machine, so the follower
        #     had a choice to make that should never have existed;
        #   - two TUTORS for one course, both blocked on the same inbox,
        #     both answering every message -- cards contradicting each other,
        #     answers invented, one run archiving the other's chapter
        #     mid-exercise. The handoff of that evening says it plainly:
        #     "Two headless sessions have been firing on the same inbox
        #     messages all evening, and the other one is unreliable";
        #   - and a tug-of-war over the tailnet name, because `vpn serve`
        #     here re-points it here while the always-on host's follower
        #     re-points it there, every tick. From the iPad that is "every
        #     time I tap Probability I get bumped back to Galois Theory".
        #
        # So: on a machine that owns its own name, do the lot. On a machine
        # that does not, record the choice and let the follower place the
        # address -- it reads the record off both machines and points at
        # whichever one is actually serving that course.
        shape = machine.machine_shape()
        mine = processes.board_is_running(
            (machines.read_board_record(target) or {}).get("pid"), target)
        # Is anybody else already serving it? Asked, not assumed.
        #
        # The first version of this rule went by the machine's ROLE -- a
        # compute node never starts a course, the always-on host decides --
        # and that was wrong in the one way that matters: if the other
        # machine cannot be reached (and until boards listened on the tailnet
        # they never could be), a tap did nothing at all and the course could
        # not be opened from anywhere. A probe is the honest question, and
        # when it finds nothing the answer is to start it here rather than to
        # wait for a machine that may not be listening.
        elsewhere = None if mine else boards.locate_course(
            match["repo"], skip_local=True, timeout=1.5)
        started = ""
        if mine or not elsewhere:
            code, out = spawn.board_cli(target, ["start"])
            if code != 0:
                return h.send_json({"ok": False, "error": out.strip()[-300:]},
                                      status=500)
            started = out.strip()
            if shape == "standalone":
                spawn.board_cli(target, ["vpn", "serve"])
            # The assistant follows the course, and only where the course is
            # actually being served. Starting one from a tap on the other
            # machine is how a lesson ends up with two.
            acode, aout = spawn.tutor_cli(["agent", "start", match["repo"]])
        else:
            acode, aout = 0, ("%s is serving this course; the address follows the "
                              "choice rather than starting a second one"
                              % elsewhere[0])
        return h.send_json({"ok": True, "repo": match["repo"],
                               "detail": started or aout,
                               "agent": aout.strip() if acode == 0 else None,
                               "agent_error": None if acode == 0 else aout.strip()[-300:]})

    if path == "/handover":
        # The always-on host asks an outgoing board to wrap up before it
        # moves the proxy: the assistant gets its one turn to write the
        # handoff, rather than being cut off mid-lesson. Gated on a shared
        # secret, because a board on the tailnet otherwise has no identity
        # to trust and the iPad must never be able to stop a lesson.
        secret = machines.handover_secret()
        given = h.headers.get("X-Handover") or ""
        if not secret or given != secret:
            return h.send_json({"ok": False, "error": "denied"}, status=403)
        name = os.path.basename(repo.root)
        code, out = spawn.tutor_cli(["agent", "stop", name])
        return h.send_json({"ok": code == 0,
                               "detail": out.strip()[-200:]})
    return NOT_MINE
