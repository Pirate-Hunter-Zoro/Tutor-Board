#!/usr/bin/env python3
"""Taking the board over on the machine you have just logged in to.

Nothing on a compute node outlives its allocation -- not the board, not the
tutor, not `tailscaled`. Arrive on a new node and the tailnet name the iPad has
baked into it points at a machine that no longer exists, and there is no way to
ask the new node to take over, because being asked requires something already
listening and that is exactly what died. Logging in is the only moment a compute
node gets, so `tutor resume` is what a login hook calls.

Two things have to be right or it does harm rather than good:

- it must do NOTHING, quickly and quietly, when there is nothing to do, because
  it runs on every interactive shell;
- it must not take a board away from a machine that is still alive, because a
  record on a shared filesystem says nothing about whether its node still
  exists -- that is what Slurm is asked.
"""

import importlib.machinery
import importlib.util
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

loader = importlib.machinery.SourceFileLoader("tutor", os.path.join(ROOT, "bin", "tutor"))
spec = importlib.util.spec_from_loader("tutor", loader)
tutor = importlib.util.module_from_spec(spec)
loader.exec_module(tutor)

import boardlib  # noqa: E402

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


tmp = tempfile.mkdtemp(prefix="tutor-resume-")
calls = {"start": [], "link": [], "agent": [], "sync": []}

# Nothing here may touch the config of whoever is running it. `cmd_resume`
# records a course that was named on the command line, and this file names one
# in nearly every case -- the first version of this test wrote its temporary
# course names into a real ~/.config/tutor-board/chosen.json.
conf = tempfile.mkdtemp(prefix="tutor-resume-conf-")
tutor.CONFIG_DIR = conf
tutor.CHOSEN = os.path.join(conf, "chosen.json")


def make_course(name, node=None, pid=1, when=None):
    root = os.path.join(tmp, name)
    os.makedirs(os.path.join(root, "live"), exist_ok=True)
    with open(os.path.join(root, "tutorboard.json"), "w", encoding="utf-8") as fh:
        json.dump({"name": name, "mode": "math"}, fh)
    if node:
        rec = os.path.join(root, "live", ".board.json")
        with open(rec, "w", encoding="utf-8") as fh:
            json.dump({"node": node, "pid": pid, "port": 8787, "root": root}, fh)
        if when:
            os.utime(rec, (when, when))
    return root


try:
    make_course("Older", node="compute999", pid=11, when=1000)
    make_course("Newer", node="compute999", pid=22, when=9000)
    make_course("NeverRan")

    cfg = {"courses_dir": tmp, "default_agent": "claude",
           "agents": {"claude": {"cmd": ["claude"], "prompt": "argv",
                                 "headless": ["claude", "-p", "{prompt}"]}},
           "hosts": {}}

    # --- what "the course you were last in" means ---------------------------
    picked = tutor.last_board(cfg)
    check("the most recently started board is the one to bring back",
          picked and picked["dir"] == "Newer")

    # `board stop` DELETES .board.json. A course you stopped cleanly is the one
    # you were most likely just using, and looking only at that record made it
    # invisible -- so the next login quietly resumed a different course and took
    # the tailnet name with it. Found by stopping a board and watching the wrong
    # one come back.
    stopped = os.path.join(tmp, "Stopped")
    os.makedirs(os.path.join(stopped, "live", "cards"), exist_ok=True)
    with open(os.path.join(stopped, "tutorboard.json"), "w", encoding="utf-8") as fh:
        json.dump({"name": "Stopped", "mode": "math"}, fh)
    with open(os.path.join(stopped, "live", "state.json"), "w", encoding="utf-8") as fh:
        json.dump({"course": "Stopped", "session": "lecture"}, fh)
    os.utime(os.path.join(stopped, "live", "state.json"), (20000, 20000))
    picked = tutor.last_board(cfg)
    check("a course whose board was stopped cleanly is still the one you were in",
          picked and picked["dir"] == "Stopped")
    shutil.rmtree(stopped)

    # A course nobody has ever opened is not a candidate, whatever else is there.
    check("and a course with nothing in its live/ is never picked",
          tutor.last_used(os.path.join(tmp, "NeverRan")) == 0)

    # Naming a course is a decision, and it has to outrank file times -- because
    # resuming a course TOUCHES its files, so "most recently used" is
    # self-reinforcing. Resume the wrong one once and it goes on being the most
    # recently used one for ever, quietly, taking the tailnet name each time.
    # That is not hypothetical: it happened, twice in a row, on a live board.
    try:
        check("with nothing named, the newest files decide",
              tutor.last_board(cfg)["dir"] == "Newer")
        tutor.remember_course({"dir": "Older", "root": os.path.join(tmp, "Older")})
        check("a course named just now beats one used an hour ago",
              tutor.last_board(cfg)["dir"] == "Older")
        # ...but not for ever: an afternoon in another course is newer than a
        # name given last week.
        import json as _json
        rec = _json.load(open(tutor.CHOSEN))
        rec["at"] = 500
        _json.dump(rec, open(tutor.CHOSEN, "w"))
        check("and an old name does not outrank a course worked in since",
              tutor.last_board(cfg)["dir"] == "Newer")
        # A name pointing at something that is no longer there is ignored.
        _json.dump({"dir": "Deleted", "root": "/nowhere", "at": 9e9},
                   open(tutor.CHOSEN, "w"))
        check("a name pointing at a course that no longer exists is ignored",
              tutor.last_board(cfg)["dir"] == "Newer")
    finally:
        try:
            os.remove(tutor.CHOSEN)      # back to "nothing has been named"
        except OSError:
            pass

    # --- stubs: nothing here may actually start a process -------------------
    def fake_board(root, *args):
        if args[0] == "start":
            calls["start"].append(os.path.basename(root))
            return 0, "board up (pid 1)"
        if args[0] == "net":
            return 0, "  https://board.example.ts.net/\n"
        return 0, ""

    tutor.board = fake_board
    tutor.link = lambda root: calls["link"].append(os.path.basename(root))
    tutor.sync = lambda root, quiet=False: calls["sync"].append(os.path.basename(root))
    tutor.agent_live = lambda root: None
    tutor.agent_start = lambda cfg, course, name: (
        calls["agent"].append(course["dir"]) or (0, "started"))
    tutor.this_host = lambda: "compute301"

    def reset():
        for k in calls:
            calls[k] = []

    # --- the node named in the record is still alive: leave it alone --------
    boardlib.slurm_nodes = lambda: {"compute999", "compute301"}
    boardlib.board_is_running = lambda pid, root: False
    reset()
    tutor.cmd_resume(cfg, ["Newer", "--quiet"])
    check("a board on a node that is still yours is left where it is",
          not calls["start"])

    # --- ...and once that allocation has ended, take it over ----------------
    boardlib.slurm_nodes = lambda: {"compute301"}
    reset()
    tutor.cmd_resume(cfg, ["Newer", "--quiet"])
    check("a board on a node that no longer exists is taken over here",
          calls["start"] == ["Newer"])
    check("and the tailnet name is pointed here as part of it",
          calls["link"] == ["Newer"])
    check("and the course is caught up first, so a handoff is not missed",
          calls["sync"] == ["Newer"])
    check("and a tutor is attached, or the iPad has a board and nobody on it",
          calls["agent"] == ["Newer"])

    # --- --no-agent for someone who drives it from a terminal ---------------
    reset()
    tutor.cmd_resume(cfg, ["Newer", "--quiet", "--no-agent"])
    check("--no-agent brings the board up and leaves the tutor to you",
          calls["start"] == ["Newer"] and not calls["agent"])

    # --- already serving here: the common case, and it must be cheap --------
    # No course named: this is the no-argument path a login hook takes. The
    # cases above named one, and naming one is remembered, so clear it.
    try:
        os.remove(tutor.CHOSEN)
    except OSError:
        pass
    boardlib.board_is_running = lambda pid, root: True
    make_course("Here", node="compute301", pid=33, when=9500)
    reset()
    tutor.cmd_resume(cfg, ["--quiet"])
    check("a board already running here is not restarted", not calls["start"])
    check("but the tailnet name is still checked, since another board moves it",
          calls["link"] == ["Here"])
    check("and it is still caught up first, so a warm board never goes stale",
          calls["sync"] == ["Here"])

    # --- no squeue at all is not the same as no allocations -----------------
    # The cases above swept these records, which is what they are supposed to do
    # -- a run of `resume` clears records from nodes that no longer exist. Lay
    # them down again for what follows.
    make_course("Newer", node="compute999", pid=22, when=9000)
    boardlib.slurm_nodes = lambda: None
    boardlib.board_is_running = lambda pid, root: False
    reset()
    tutor.cmd_resume(cfg, ["Newer", "--quiet"])
    check("with no Slurm to ask, another node's board is left alone",
          not calls["start"])
    reset()
    tutor.cmd_resume(cfg, ["Newer", "--quiet", "--force"])
    check("and --force is how you move it anyway", calls["start"] == ["Newer"])

    # --- a login node is not a machine to start a board on ------------------
    # This runs from a login hook, so it gets invited to try on every machine
    # you touch. A login node is shared, is not yours, and is where a
    # long-running process goes to be killed.
    boardlib.slurm_nodes = lambda: {"compute999"}
    boardlib.board_is_running = lambda pid, root: False
    tutor.this_host = lambda: "login1"
    reset()
    tutor.cmd_resume(cfg, ["Newer", "--quiet", "--force"])
    check("--force still moves it, since that is a person asking",
          calls["start"] == ["Newer"])
    reset()
    boardlib.slurm_nodes = lambda: {"compute301"}
    tutor.cmd_resume(cfg, ["Newer", "--quiet"])
    check("a machine Slurm does not say is yours starts nothing",
          not calls["start"])
    tutor.this_host = lambda: "compute301"

    # --- a machine where nothing has ever run -------------------------------
    empty = tempfile.mkdtemp(prefix="tutor-resume-empty-")
    try:
        os.makedirs(os.path.join(empty, "Fresh", "live"))
        with open(os.path.join(empty, "Fresh", "tutorboard.json"), "w",
                  encoding="utf-8") as fh:
            json.dump({"name": "Fresh", "mode": "math"}, fh)
        reset()
        code = tutor.cmd_resume(dict(cfg, courses_dir=empty), ["--quiet"])
        check("a machine where no board has ever run starts nothing",
              code == 0 and not calls["start"])
    finally:
        shutil.rmtree(empty, ignore_errors=True)
    # --- sweeping records left by machines that no longer exist -------------
    # A board that died with its allocation leaves `live/.board.json` behind, and
    # nothing can tell that from a board that is answering -- so the hub goes on
    # offering "live on compute304" days later, and a tap goes where nothing is
    # listening. Logging in is when we can find out which nodes are real.
    ghost = os.path.join(tmp, "Ghost")
    os.makedirs(os.path.join(ghost, "live"), exist_ok=True)
    with open(os.path.join(ghost, "tutorboard.json"), "w", encoding="utf-8") as fh:
        json.dump({"name": "Ghost", "mode": "math"}, fh)
    ghost_rec = os.path.join(ghost, "live", ".board.json")

    def lay_ghost(node):
        with open(ghost_rec, "w", encoding="utf-8") as fh:
            json.dump({"node": node, "pid": 4242, "root": ghost}, fh)

    lay_ghost("compute999")
    boardlib.slurm_nodes = lambda: {"compute301"}
    tutor.prune_dead_records(cfg, "compute301")
    check("a record from a node that is gone is swept",
          not os.path.exists(ghost_rec))

    lay_ghost("compute301")
    tutor.prune_dead_records(cfg, "compute301")
    check("a record from THIS machine is never swept, whatever it says",
          os.path.exists(ghost_rec))

    lay_ghost("compute999")
    boardlib.slurm_nodes = lambda: None
    tutor.prune_dead_records(cfg, "compute301")
    check("and with no Slurm to ask, nothing is swept — unknown is not gone",
          os.path.exists(ghost_rec))

    lay_ghost("compute301")
    boardlib.slurm_nodes = lambda: {"compute301", "compute999"}
    lay_ghost("compute999")
    tutor.prune_dead_records(cfg, "compute301")
    check("nor is a record from a node that is still yours",
          os.path.exists(ghost_rec))
    shutil.rmtree(ghost)

    # --- the login hook itself ---------------------------------------------
    # It is appended to a file that runs on every shell on every machine, so the
    # ways it can do damage are: printing something (which breaks scp, sftp and
    # git-over-ssh with a remote error nobody can read), blocking a prompt, and
    # being impossible to remove.
    import subprocess  # noqa: E402
    home = tempfile.mkdtemp(prefix="tutor-resume-home-")
    try:
        rc = os.path.join(home, ".bashrc")
        with open(rc, "w", encoding="utf-8") as fh:
            fh.write("# something the user already had\nexport KEEP_ME=1\n")
        env = dict(os.environ, HOME=home)
        script = os.path.join(ROOT, "scripts", "install-autostart.sh")

        run = subprocess.run(["bash", script, "--login-hook"], env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
        body = open(rc, encoding="utf-8").read()
        check("the hook installs",
              run.returncode == 0 and "tutor\" resume --quiet" in body)
        # The block is written through an UNQUOTED heredoc, because it has to
        # interpolate the markers -- so a backtick anywhere in it, comment
        # included, is a command substitution that runs at install time. It did.
        check("and nothing in it was executed while it was being written",
              "already up here" not in body and "$(" not in body)
        check("and leaves what was already there", "KEEP_ME" in body)
        check("and it is valid shell",
              subprocess.run(["bash", "-n", rc], timeout=30).returncode == 0)
        check("and it only runs in an interactive shell", "$- == *i*" in body)
        check("and never blocks the prompt", "&" in body)

        # The one that matters: sourced by a NON-interactive shell it must be
        # silent. A login file that prints is how scp starts failing.
        out = subprocess.run(["bash", "-c", ". %s; echo READY" % rc], env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
        check("and says nothing at all to a non-interactive shell, so scp lives",
              out.stdout.decode().strip() == "READY")

        subprocess.run(["bash", script, "--login-hook"], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        again = open(rc, encoding="utf-8").read()
        check("installing twice does not stack up two of them",
              again.count("resume --quiet") == 1)

        subprocess.run(["bash", script, "--uninstall"], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
        after = open(rc, encoding="utf-8").read()
        check("and it comes out again cleanly", "tutor resume" not in after)
        check("leaving the file otherwise as it was", "KEEP_ME" in after)
    finally:
        shutil.rmtree(home, ignore_errors=True)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(conf, ignore_errors=True)

print()
print("%d FAILURES" % len(fails) if fails
      else "a new node takes the board over, and leaves a live one alone")
sys.exit(1 if fails else 0)
