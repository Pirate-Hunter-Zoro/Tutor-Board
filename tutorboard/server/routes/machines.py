"""What this machine can teach, and which course the one address opens.

Nothing here reaches the filesystem from a request: a course named in a
request is matched against what this server already discovered.
"""

import json
import os

from . import NOT_MINE
from ...net import tailscale
from ... import limits
from ... import choice
from .. import spawn
from ... import machines
from ...lesson import state


def get(h, repo, path):
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
        # is. `tutor` because a board with nobody behind it is a lesson that
        # cannot answer, and the hub says so rather than drawing it as ready.
        # `host` so a CLIENT can tell which machine it reached.
        agent = state.load_agent(repo) or {}
        return h.send_json({"ok": True, "root": repo.root,
                               "dir": os.path.basename(repo.root),
                               "host": tailscale.tailnet_self() or "",
                               "chosen": machines.chosen_target(),
                               "tutor": agent.get("state") or None,
                               "limited": limits.limited_until()})
    return NOT_MINE


def post(h, repo, path):
    if path == "/switch":
        try:
            payload = json.loads(h.read_body().decode("utf-8"))
        except Exception:
            return h.send_json({"ok": False, "error": "bad json"}, status=400)
        want = payload.get("repo") or ""

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
        # record is written first and unconditionally, because it is the one
        # thing that survives this board being restarted, and it is what every
        # later question about "which course" is answered from.
        choice.remember_chosen(match["repo"], target,
                                 host=tailscale.tailnet_self() or "")

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
        code, out = spawn.board_cli(target, ["start"])
        if code != 0:
            return h.send_json({"ok": False, "error": out.strip()[-300:]},
                                  status=500)
        vcode, _ = spawn.board_cli(target, ["vpn", "serve"])
        # The assistant follows the course.
        acode, aout = spawn.tutor_cli(["agent", "start", match["repo"]])
        return h.send_json({"ok": True, "repo": match["repo"],
                               "address": vcode == 0,
                               "detail": out.strip(),
                               "agent": aout.strip() if acode == 0 else None,
                               "agent_error": None if acode == 0 else aout.strip()[-300:]})

    return NOT_MINE
