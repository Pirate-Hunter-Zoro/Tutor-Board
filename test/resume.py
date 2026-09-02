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

from tutorboard import machine, paths, processes

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
# The record of what a person chose is one file with one reader, in boardlib --
# the launcher writes it, the board writes it when the hub is tapped, and the
# always-on host's proxy follows it. Point that one place at the sandbox.
paths.CONFIG_DIR = conf
paths.CHOSEN = os.path.join(conf, "chosen.json")
tutor.CHOSEN = paths.CHOSEN


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
    # What kind of machine this is decides which rule applies, and the real
    # answer depends on whether the machine running the tests happens to have a
    # `follow` block of its own. Pin it: everything below is the cluster rule,
    # and the always-on rule gets its own case at the end.
    machine.machine_shape = lambda: "compute node"

    def reset():
        for k in calls:
            calls[k] = []

    # --- the node named in the record is still alive: leave it alone --------
    machine.slurm_nodes = lambda: {"compute999", "compute301"}
    processes.board_is_running = lambda pid, root: False
    reset()
    tutor.cmd_resume(cfg, ["Newer", "--quiet"])
    check("a board on a node that is still yours is left where it is",
          not calls["start"])

    # --- ...and once that allocation has ended, take it over ----------------
    machine.slurm_nodes = lambda: {"compute301"}
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
    processes.board_is_running = lambda pid, root: True
    make_course("Here", node="compute301", pid=33, when=9500)
    reset()
    tutor.cmd_resume(cfg, ["--quiet"])
    check("a board already running here is not restarted", not calls["start"])
    check("but the tailnet name is still checked, since another board moves it",
          calls["link"] == ["Here"])
    check("and it is still caught up first, so a warm board never goes stale",
          calls["sync"] == ["Here"])

    # --- a board that DIED, on a machine nobody is sitting at ---------------
    #
    # `board stop` removes the record. A crash, an OOM or a reboot leaves one
    # behind naming a pid that is gone -- and nothing ever looked. This command
    # restores the course last worked in, which is exactly one of them, so any
    # other board that fell over stayed down until a person noticed and said so.
    # On the always-on host that is precisely backwards: its whole purpose is
    # that nobody has to be here, and from the iPad it is a course in the hub
    # that will not open on a machine that is otherwise perfectly healthy.
    machine.machine_shape = lambda: "always-on host"
    machine.slurm_nodes = lambda: None
    make_course("Crashed", node="compute301", pid=44, when=200)
    processes.board_is_running = lambda pid, root: pid != 44
    reset()
    tutor.cmd_resume(cfg, ["--quiet"])
    check("a board whose process is gone is started again, without being asked",
          "Crashed" in calls["start"])
    check("a course nobody has ever opened is not started by a timer",
          "NeverRan" not in calls["start"])
    check("and neither is a board recorded on another machine",
          "Newer" not in calls["start"] and "Older" not in calls["start"])

    # A board that is up is not restarted, which is the case that runs every
    # three minutes for ever and must therefore cost nothing.
    processes.board_is_running = lambda pid, root: True
    reset()
    tutor.cmd_resume(cfg, ["--quiet"])
    check("and a machine with nothing wrong with it starts nothing at all",
          not calls["start"])

    # On a compute node this must not happen: `resume` runs from a login hook
    # there, a board belongs to an allocation, and a login node is shared.
    machine.machine_shape = lambda: "compute node"
    processes.board_is_running = lambda pid, root: pid != 44
    reset()
    tutor.cmd_resume(cfg, ["--quiet"])
    check("but a login on a compute node does not start everything with a record",
          "Crashed" not in calls["start"])
    shutil.rmtree(os.path.join(tmp, "Crashed"), ignore_errors=True)
    processes.board_is_running = lambda pid, root: pid == 33

    # --- no squeue at all is not the same as no allocations -----------------
    # The cases above swept these records, which is what they are supposed to do
    # -- a run of `resume` clears records from nodes that no longer exist. Lay
    # them down again for what follows.
    make_course("Newer", node="compute999", pid=22, when=9000)
    machine.slurm_nodes = lambda: None
    # `Here` is a board running here, which is what its name means. It matters
    # from now on: a machine that is not a compute node also restarts boards of
    # its own that have died, so a course whose record names this host and whose
    # pid is gone is a start, and every "nothing was started" case below would be
    # asserting about that instead of about the node's board.
    processes.board_is_running = lambda pid, root: pid == 33
    reset()
    tutor.cmd_resume(cfg, ["Newer", "--quiet"])
    check("with no Slurm to ask, another node's board is left alone",
          not calls["start"])
    reset()
    tutor.cmd_resume(cfg, ["Newer", "--quiet", "--force"])
    check("and --force is how you move it anyway", calls["start"] == ["Newer"])

    # --- the always-on host hosts what it holds -----------------------------
    # A course cloned on the Mac is taught on the Mac. That machine does not
    # share a filesystem with the compute node, so a record naming the node is
    # not something it can check -- and the rule above, written for two cluster
    # nodes on one home directory, left the machine that never sleeps and holds
    # the repository permanently unable to host it. It does not stop the other
    # board: the proxy asks that one to hand its tutor over as the address moves.
    machine.machine_shape = lambda: "always-on host"
    reset()
    tutor.cmd_resume(cfg, ["Newer", "--quiet"])
    check("the always-on host brings up a course it holds, whatever a record "
          "from the compute node says", calls["start"] == ["Newer"])
    check("and points the one address the iPad has at it", calls["link"] == ["Newer"])
    check("and attaches a tutor, or there is a board with nobody on it",
          calls["agent"] == ["Newer"])
    machine.machine_shape = lambda: "compute node"

    # --- a login node is not a machine to start a board on ------------------
    # This runs from a login hook, so it gets invited to try on every machine
    # you touch. A login node is shared, is not yours, and is where a
    # long-running process goes to be killed.
    machine.slurm_nodes = lambda: {"compute999"}
    processes.board_is_running = lambda pid, root: False
    tutor.this_host = lambda: "login1"
    reset()
    tutor.cmd_resume(cfg, ["Newer", "--quiet", "--force"])
    check("--force still moves it, since that is a person asking",
          calls["start"] == ["Newer"])
    reset()
    machine.slurm_nodes = lambda: {"compute301"}
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
    machine.slurm_nodes = lambda: {"compute301"}
    tutor.prune_dead_records(cfg, "compute301")
    check("a record from a node that is gone is swept",
          not os.path.exists(ghost_rec))

    lay_ghost("compute301")
    tutor.prune_dead_records(cfg, "compute301")
    check("a record from THIS machine is never swept, whatever it says",
          os.path.exists(ghost_rec))

    lay_ghost("compute999")
    machine.slurm_nodes = lambda: None
    tutor.prune_dead_records(cfg, "compute301")
    check("and with no Slurm to ask, nothing is swept — unknown is not gone",
          os.path.exists(ghost_rec))

    lay_ghost("compute301")
    machine.slurm_nodes = lambda: {"compute301", "compute999"}
    lay_ghost("compute999")
    tutor.prune_dead_records(cfg, "compute301")
    check("nor is a record from a node that is still yours",
          os.path.exists(ghost_rec))
    shutil.rmtree(ghost)


    # --- the board catches ITSELF up ---------------------------------------
    # `sync` above pulls a course. Nothing pulled the board, on the one machine
    # where nothing else could: `--tool-pull` refuses to install a timer on a
    # compute node, because a timer on a machine that ceases to exist is not a
    # plan. So a fix shipped from the Mac sat on GitHub until somebody pulled it
    # by hand -- and remembering by hand is precisely the thing this repository
    # keeps failing at. The login hook is the only moment a node gets, and
    # `tutor resume` is what the hook runs.
    import contextlib  # noqa: E402
    import io as _io   # noqa: E402
    import subprocess as _sp  # noqa: E402

    def git(where, *args):
        return _sp.run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
                        "-c", "commit.gpgsign=false"] + list(args), cwd=where,
                       stdout=_sp.PIPE, stderr=_sp.STDOUT, timeout=60)

    gits = tempfile.mkdtemp(prefix="tutor-toolpull-")
    try:
        origin = os.path.join(gits, "origin")
        os.makedirs(origin)
        git(origin, "init", "-q", "-b", "main")
        open(os.path.join(origin, "serve.py"), "w").write("one\n")
        git(origin, "add", "-A")
        git(origin, "commit", "-qm", "one")

        clone = os.path.join(gits, "clone")
        git(gits, "clone", "-q", origin, clone)

        check("a clone that is already current says nothing at all",
              tutor.tool_pull(clone) == (False, None))

        open(os.path.join(origin, "serve.py"), "w").write("two\n")
        git(origin, "add", "-A")
        git(origin, "commit", "-qm", "two")

        moved, msg = tutor.tool_pull(clone)
        check("a commit pushed from the other machine is pulled here",
              moved and open(os.path.join(clone, "serve.py")).read() == "two\n")
        check("and it says which two commits, because a log is read afterwards",
              bool(msg) and "->" in msg)

        # Never fatal, in every way a pull can fail. Somebody is holding an iPad
        # and cannot resolve a merge; a launcher that refuses to launch is worse
        # than a launcher one commit behind.
        open(os.path.join(clone, "serve.py"), "w").write("mine\n")
        git(clone, "add", "-A")
        git(clone, "commit", "-qm", "diverged")
        open(os.path.join(origin, "serve.py"), "w").write("theirs\n")
        git(origin, "add", "-A")
        git(origin, "commit", "-qm", "theirs")
        moved, msg = tutor.tool_pull(clone)
        check("a diverged branch is reported and left alone, never resolved",
              moved is False and msg and "did not update" in msg)

        lone = os.path.join(gits, "lone")
        os.makedirs(lone)
        git(lone, "init", "-q", "-b", "main")
        open(os.path.join(lone, "x"), "w").write("x\n")
        git(lone, "add", "-A")
        git(lone, "commit", "-qm", "x")
        check("a clone with no remote is not a failure, it is a machine",
              tutor.tool_pull(lone) == (False, None))
        check("and neither is a directory that is not a repository at all",
              tutor.tool_pull(gits) == (False, None))
    finally:
        shutil.rmtree(gits, ignore_errors=True)

    # The half that matters more than the pull. A board read `serve.py` when it
    # started, a tutor read `bin/tutor`, and the proxy read `bin/follow`: a pull
    # that bounces nothing leaves the fix on disk and out of the lesson, which is
    # the most expensive misunderstanding this repository has produced. And the
    # launcher itself is one of those processes, so it re-execs -- otherwise the
    # code reporting what it did would be the code that was just replaced.
    ran = {"pull": 0, "exec": 0, "restart": []}
    real_pull, real_exec, real_restart = tutor.tool_pull, tutor.tool_reexec, tutor.cmd_restart
    try:
        def fake_pull(root=None):
            ran["pull"] += 1
            return ran["answer"]

        def fake_exec():
            ran["exec"] += 1
            return False        # the real one does not return; this one has to

        tutor.tool_pull = fake_pull
        tutor.tool_reexec = fake_exec
        tutor.cmd_restart = lambda cfg, args: ran["restart"].append(list(args)) or 0

        def sync_with(stage, answer, quiet=False):
            for k in ("pull", "exec"):
                ran[k] = 0
            ran["restart"] = []
            ran["answer"] = answer
            os.environ.pop(tutor.TOOL_SYNC, None)
            if stage:
                os.environ[tutor.TOOL_SYNC] = stage
            said = _io.StringIO()
            with contextlib.redirect_stdout(said):
                tutor.tool_sync(cfg, quiet=quiet)
            return said.getvalue()

        said = sync_with(None, (False, None))
        check("a pull that moves nothing restarts nothing and says nothing",
              ran["pull"] == 1 and not ran["exec"] and not ran["restart"] and not said)

        said = sync_with(None, (True, "  pulled the board: aaaaaaaa -> bbbbbbbb"))
        check("a pull that moves HEAD re-execs, so the rest runs the new code",
              ran["exec"] == 1)
        check("and says so even under --quiet, because a lesson just changed",
              "pulled the board" in sync_with(None, (True, "  pulled the board: a -> b"),
                                              quiet=True))

        said = sync_with("moved", (False, None))
        check("on the other side of the re-exec it does not pull again",
              ran["pull"] == 0)
        check("and puts the boards, the tutors and the proxy on the new code",
              ran["restart"] == [["--tutors"]])

        said = sync_with("done", (True, "  pulled"))
        check("and once a process tree has pulled, nothing pulls again",
              ran["pull"] == 0 and not ran["restart"] and not said)

        said = sync_with(None, (False, "  the board could not reach its remote"), quiet=True)
        check("no network on a login is silent — the hook runs on every shell",
              not said)
        said = sync_with(None, (False, "  the board could not reach its remote"))
        check("...and is said out loud when a person is watching",
              "could not reach" in said)
    finally:
        tutor.tool_pull, tutor.tool_reexec, tutor.cmd_restart = real_pull, real_exec, real_restart
        os.environ.pop(tutor.TOOL_SYNC, None)

    # The re-exec, for real, because a stub cannot prove it. A real launcher, in
    # a real clone, with a real commit waiting on its remote: it must come out the
    # other side running the code that arrived, and it must still be able to say
    # so. The first version could not -- `execve` throws away whatever is sitting
    # in this process's buffers, and stdout is a pipe or a log file every time
    # this runs for real, so the one line explaining why the board changed under
    # somebody's lesson was dropped on the way.
    real = tempfile.mkdtemp(prefix="tutor-reexec-")
    try:
        up = os.path.join(real, "origin")
        # The launcher and the package it imports. A fake tool repository with
        # half a package in it fails at the import and never reaches the pull,
        # which is the thing under test.
        for rel in ("bin/tutor", "bin/board"):
            dest = os.path.join(up, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy(os.path.join(ROOT, rel), dest)
        shutil.copytree(os.path.join(ROOT, "tutorboard"),
                        os.path.join(up, "tutorboard"),
                        ignore=shutil.ignore_patterns("__pycache__"))
        git(up, "init", "-q", "-b", "main")
        git(up, "add", "-A")
        git(up, "commit", "-qm", "the tool")

        down = os.path.join(real, "clone")
        git(real, "clone", "-q", up, down)

        with open(os.path.join(up, "shipped.txt"), "w") as fh:
            fh.write("a fix written on the other machine\n")
        git(up, "add", "-A")
        git(up, "commit", "-qm", "a fix")

        conf2 = os.path.join(real, "conf", "tutor-board")
        os.makedirs(conf2)
        with open(os.path.join(conf2, "config.json"), "w", encoding="utf-8") as fh:
            json.dump({"courses_dir": os.path.join(real, "courses"),
                       "default_agent": "free"}, fh)
        os.makedirs(os.path.join(real, "courses"))

        env = dict(os.environ, XDG_CONFIG_HOME=os.path.join(real, "conf"))
        env.pop(tutor.TOOL_SYNC, None)
        run = _sp.run([sys.executable, os.path.join(down, "bin", "tutor")], env=env,
                      stdout=_sp.PIPE, stderr=_sp.STDOUT, timeout=180)
        said = run.stdout.decode("utf-8", "replace")
        check("a real launcher pulls the fix waiting on its remote",
              os.path.exists(os.path.join(down, "shipped.txt")))
        check("and the line saying so survives the re-exec into it",
              "pulled the board" in said)
        check("and what was holding the old code is bounced on the other side",
              "no boards were running" in said)
    finally:
        shutil.rmtree(real, ignore_errors=True)

    # And the wiring, which is the part that was missing rather than wrong: the
    # login hook runs `tutor resume --quiet`, so unless the dispatch calls this
    # before the course is chosen the node goes on running whatever it was
    # cloned with.
    order = []
    real_sync, real_resume = tutor.tool_sync, tutor.cmd_resume
    real_cfg = tutor.load_config
    try:
        tutor.load_config = lambda: cfg
        tutor.tool_sync = lambda c, quiet=False: order.append(("sync", quiet))
        tutor.cmd_resume = lambda c, a: order.append(("resume", list(a))) or 0
        tutor.main(["resume", "--quiet"])
        check("`tutor resume` catches the board up before it resumes anything",
              order == [("sync", True), ("resume", ["--quiet"])])
        order[:] = []
        tutor.main(["resume", "galois"])
        check("and without --quiet it is allowed to say why it did nothing",
              order and order[0] == ("sync", False))
    finally:
        tutor.tool_sync, tutor.cmd_resume, tutor.load_config = real_sync, real_resume, real_cfg

    # The launcher must not pull inside `tutor restart`: `ship.sh` calls that
    # immediately after its own push, and a second fetch there finds nothing,
    # takes a network round trip, and prints a line about it.
    body = open(os.path.join(ROOT, "bin", "tutor"), encoding="utf-8").read()
    after_restart = body.split('if args and args[0] in ("restart"')[1]
    check("`tutor restart` does not pull; the ship it follows just pushed",
          "tool_sync" not in after_restart.split("\n\n")[0])

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
# A restart must survive a broken agent record.
#
# `os.kill(None, ...)` raises TypeError, not OSError, so a half-written
# `agent.json` -- which is what a daemon killed with its state directory pulled
# out from under it leaves -- took the whole restart down, every course after it
# included. Found by wiping the boards while one was running.
src_t = open(os.path.join(ROOT, "bin", "tutor"), encoding="utf-8").read()
check("a restart skips a record with no pid rather than dying on it",
      "if not was:" in src_t and '"%s (no pid in its record)"' in src_t)

# One command to put a machine right.
#
# The Mac mini cannot be reached from the compute node's session, so every fix
# shipped from over there sits on its disk until something restarts the processes
# holding the old code -- three kinds of process and two kinds of repository, and
# remembering that list is not somebody's job.
script = os.path.join(ROOT, "scripts", "catch-up.sh")
check("there is a script that catches a machine up in one command",
      os.path.isfile(script))
src_c = open(script, encoding="utf-8").read()
check("it pulls the tool first and re-runs itself on what arrived, since "
      "everything below it reads this repository",
      "git -C \"$HERE\" pull --ff-only" in src_c and "exec bash" in src_c)
check("it never treats the tool as a course, whatever the path is spelled like "
      "-- this one holds an AI_INSTRUCTIONS.md like every course does",
      'pwd -P' in src_c and "continue" in src_c)
check("a course whose history diverged is TAGGED before it is reset, so nothing "
      "is destroyed that was not already pushed",
      'tag -f "$tag"' in src_c and 'reset --hard "origin/$branch"' in src_c)
check("and only the board's own scratch is cleaned, never a person's untracked "
      "work elsewhere in a course",
      "clean -fdq -- live" in src_c)
check("it restarts the boards, the tutors and the follower",
      'restart --tutors' in src_c)
check("and then says what is actually true: what is running, how to reach each "
      "board directly, and what the hub will offer",
      "/hosts.json" in src_c and "how to reach each of them" in src_c)
check("with a --report mode that changes nothing",
      "--report) REPORT=1" in src_c)

print("%d FAILURES" % len(fails) if fails
      else "a new node takes the board over, and leaves a live one alone")
sys.exit(1 if fails else 0)
