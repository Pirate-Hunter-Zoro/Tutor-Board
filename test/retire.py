#!/usr/bin/env python3
"""Taking the board off a machine, from a machine that cannot reach it.

`scripts/retire-host.sh` is the only thing in this repository that deletes
somebody's files, and it runs unattended out of a timer on every machine that
pulls the repository. So two things have to be true and neither is negotiable:

- it does NOTHING, silently, on every machine but the one it is written for --
  the gate is three conditions wide and any one of them failing is an exit;
- on that machine everything reaches origin before anything is deleted -- on a
  branch of its own, because a machine being retired has been teaching the same
  courses as another one and its history does not merge: two transcript beats
  committing the same `live/slate/page-06.png` is a conflict in a binary file and
  a repository whose push fails for ever. A clone is not a backup and none of
  this is reversible;
- and it leaves nothing at all behind, not even an account of itself. A receipt
  is one more file somebody has to find and delete later.

Everything below runs against a sandbox: a fake HOME, a fake `PATH` with no
`squeue` on it and a `uname` that answers Darwin, and course repositories with a
real local origin to push to. Nothing here touches the machine running it, and
the test refuses to run at all if HOME is not the sandbox.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPT = os.path.join(ROOT, "scripts", "retire-host.sh")

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


def git(where, *args):
    return subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t",
         "-c", "commit.gpgsign=false", "-C", where] + list(args),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)


# --- a PATH with the tools the script needs, and nothing else --------------
#
# `squeue` on the path is one of the three things that makes this machine the
# wrong machine, and the machine running the tests has one. So the sandbox gets
# a PATH of its own, with symlinks to what the script actually calls.
REAL = ["bash", "sh", "date", "mktemp", "cp", "rm", "mv", "ls", "cat", "git",
        "python3", "grep", "sed", "head", "tail", "id", "basename", "dirname",
        "printf", "env", "cut", "tr"]


def sandbox(marker=True, courses=None, darwin=True, slurm=False):
    """A fake machine. Returns (home, bin, tool)."""
    home = tempfile.mkdtemp(prefix="retire-home-")
    fake = os.path.join(home, "fakebin")
    os.makedirs(fake)
    for name in REAL:
        found = shutil.which(name)
        if found:
            try:
                os.symlink(found, os.path.join(fake, name))
            except OSError:
                pass

    def stub(name, body):
        p = os.path.join(fake, name)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("#!/bin/sh\n" + body + "\n")
        os.chmod(p, 0o755)

    stub("uname", 'echo %s' % ("Darwin" if darwin else "Linux"))
    stub("launchctl", 'exit 1')            # nothing is loaded
    stub("pgrep", 'exit 1')                # nothing is running
    stub("pkill", 'exit 0')
    stub("tailscale", 'exit 0')
    if slurm:
        stub("squeue", 'exit 0')

    # The tool's own clone, with a remote that names it.
    tool = os.path.join(home, "Tutor-Board")
    os.makedirs(os.path.join(tool, "scripts"))
    os.makedirs(os.path.join(tool, "bin"))
    for c in ("board", "tutor"):
        with open(os.path.join(tool, "bin", c), "w") as fh:
            fh.write("#!/bin/sh\n")
    shutil.copy(SCRIPT, os.path.join(tool, "scripts", "retire-host.sh"))
    subprocess.run(["git", "init", "-q", tool], stdout=subprocess.DEVNULL)
    git(tool, "remote", "add", "origin", "https://github.com/somebody/Tutor-Board.git")

    if marker:
        agents = os.path.join(home, "Library", "LaunchAgents")
        os.makedirs(agents)
        with open(os.path.join(agents, "com.tutorboard.current.plist"), "w") as fh:
            fh.write("<plist/>\n")

    # What `install.sh` leaves on the path, and what a round leaves lying about.
    localbin = os.path.join(home, ".local", "bin")
    os.makedirs(localbin)
    for c in ("board", "tutor"):
        os.symlink(os.path.join(tool, "bin", c), os.path.join(localbin, c))
    logs = os.path.join(home, "Library", "Logs")
    os.makedirs(logs, exist_ok=True)
    for f in ("tutor-current.log", "tutor-follow.log"):
        with open(os.path.join(logs, f), "w") as fh:
            fh.write("a round\n")
    with open(os.path.join(home, ".tutor-current.json"), "w") as fh:
        fh.write("{}\n")

    cfgdir = os.path.join(home, ".config", "tutor-board")
    os.makedirs(cfgdir)
    with open(os.path.join(cfgdir, "config.json"), "w", encoding="utf-8") as fh:
        json.dump({"courses_dir": courses if courses is not None
                   else os.path.join(home, "Learning")}, fh)
    return home, fake, tool


def course(home, name, ahead=1):
    """A course clone under ~/Learning with `ahead` commits origin has not got."""
    learning = os.path.join(home, "Learning")
    os.makedirs(learning, exist_ok=True)
    origin = os.path.join(home, "origins", name + ".git")
    os.makedirs(os.path.dirname(origin), exist_ok=True)
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", origin],
                   stdout=subprocess.DEVNULL)
    root = os.path.join(learning, name)
    subprocess.run(["git", "init", "-q", "-b", "main", root], stdout=subprocess.DEVNULL)
    git(root, "remote", "add", "origin", origin)
    with open(os.path.join(root, "HANDOFF.md"), "w", encoding="utf-8") as fh:
        fh.write("where the student got to\n")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "first")
    git(root, "push", "-q", "-u", "origin", "main")
    for i in range(ahead):
        with open(os.path.join(root, "HANDOFF.md"), "a", encoding="utf-8") as fh:
            fh.write("and then this\n")
        git(root, "add", "-A")
        git(root, "commit", "-qm", "later %d" % i)
    return root, origin


def run(home, fake, tool, *args):
    # A cluster login environment carries `BASH_ENV` pointing at a module
    # system's init file, which every non-interactive bash then sources -- and
    # with the sandbox's stripped PATH that file complains on stderr. That is
    # this machine talking, not the script, and it would read here as output
    # the script must not have produced.
    env = dict((k, v) for k, v in os.environ.items()
               if k != "BASH_ENV" and not k.startswith("BASH_FUNC_"))
    env["HOME"] = home
    env["PATH"] = fake
    env["TMPDIR"] = os.path.join(home, "tmp")
    os.makedirs(env["TMPDIR"], exist_ok=True)
    p = subprocess.run(["bash", os.path.join(tool, "scripts", "retire-host.sh")]
                       + list(args), env=env, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, timeout=120)
    return p.returncode, p.stdout.decode("utf-8", "replace")


trash = []
try:
    # --- the machine it is written for --------------------------------------
    home, fake, tool = sandbox()
    trash.append(home)
    root, origin = course(home, "Galois-Theory", ahead=2)
    # A working tree nobody committed, and a merge left half-finished: both are
    # what a machine that has been teaching alongside another one looks like.
    with open(os.path.join(root, "HANDOFF.md"), "a", encoding="utf-8") as fh:
        fh.write("and this was never committed\n")
    with open(os.path.join(root, ".git", "MERGE_HEAD"), "w") as fh:
        fh.write(git(root, "rev-parse", "HEAD").stdout.decode().strip() + "\n")
    code, out = run(home, fake, tool)
    check("it runs on the machine it is written for, and says so in its exit "
          "code, because a round that carried on would put the timer back",
          code == 9)
    branches = git(origin, "branch", "--format=%(refname:short)").stdout.decode()
    check("everything it had goes to origin, on a branch of its own rather than "
          "into a merge that cannot be resolved",
          "retired/" in branches and "Galois-Theory" in branches)
    kept = git(origin, "log", "-1", "--pretty=%s",
               [b for b in branches.split() if b.startswith("retired/")][0]
               if any(b.startswith("retired/") for b in branches.split()) else "HEAD")
    check("including the working tree as it stood, which is the one thing a "
          "clone cannot get back",
          b"as it stood" in kept.stdout)
    check("and the half-finished merge was abandoned rather than fought with",
          "outstanding" in out)
    check("the courses directory is gone",
          not os.path.exists(os.path.join(home, "Learning")))
    check("and so is the clone it was running out of", not os.path.exists(tool))
    check("and the tool's own config, which is what named this machine",
          not os.path.exists(os.path.join(home, ".config", "tutor-board")))
    check("the launch agent is removed, not merely stopped",
          not os.path.exists(os.path.join(home, "Library", "LaunchAgents",
                                          "com.tutorboard.current.plist")))
    check("the two commands it put on the path are gone with it",
          not os.path.lexists(os.path.join(home, ".local", "bin", "board"))
          and not os.path.lexists(os.path.join(home, ".local", "bin", "tutor")))
    check("and the logs, including the one it was just writing into",
          not os.path.exists(os.path.join(home, "Library", "Logs",
                                          "tutor-current.log"))
          and not os.path.exists(os.path.join(home, ".tutor-current.json")))
    # No account of itself anywhere. Whatever it said went to the caller's log,
    # and the caller's log is on the list.
    left = sorted(n for n in os.listdir(home)
                  if n not in ("fakebin", "tmp", "origins", "Documents"))
    check("and it leaves NOTHING with its name on it: %s" % (left or "nothing",),
          not [n for n in left if "tutor" in n.lower() or "board" in n.lower()])

    # --- every other machine ------------------------------------------------
    # This is the half that matters. It runs from a timer on every machine that
    # pulls this repository, and on all of them it must be a silent no-op.
    for what, kw in (("a machine with no board host registered", {"marker": False}),
                     ("Linux", {"darwin": False}),
                     ("a cluster node, where Slurm answers", {"slurm": True})):
        home, fake, tool = sandbox(**kw)
        trash.append(home)
        course(home, "Probability")
        code, out = run(home, fake, tool)
        check("%s is left completely alone" % what,
              code == 0 and not out.strip()
              and os.path.isdir(os.path.join(home, "Learning"))
              and os.path.isdir(tool))

    # --- and the escape hatch ----------------------------------------------
    home, fake, tool = sandbox()
    trash.append(home)
    course(home, "Probability")
    code, out = run(home, fake, tool, "--report")
    check("--report says what it would do and deletes nothing",
          code == 0 and "retiring this machine" in out
          and os.path.isdir(os.path.join(home, "Learning"))
          and os.path.isdir(tool)
          and not os.path.exists(os.path.join(home, "tutor-board-removed.log")))

    # --- a courses_dir that would mean the home directory -------------------
    #
    # `rm -rf $courses_dir` with a courses_dir of `~` is the worst thing in this
    # file, so the guard is tested rather than trusted: nothing outside HOME, and
    # never HOME itself.
    home, fake, tool = sandbox(courses=None)
    trash.append(home)
    with open(os.path.join(home, ".config", "tutor-board", "config.json"),
              "w", encoding="utf-8") as fh:
        json.dump({"courses_dir": home}, fh)
    keep = os.path.join(home, "Documents")
    os.makedirs(keep)
    code, out = run(home, fake, tool)
    check("a courses_dir of the home directory is refused, not obeyed",
          os.path.isdir(home) and os.path.isdir(keep) and "REFUSED" in out)

    # --- a clone that is not this tool -------------------------------------
    home, fake, tool = sandbox()
    trash.append(home)
    git(tool, "remote", "set-url", "origin", "https://github.com/somebody/Notes.git")
    code, out = run(home, fake, tool)
    check("a directory that is not a Tutor-Board clone is left where it is",
          os.path.isdir(tool) and "not a Tutor-Board clone" in out)
finally:
    for d in trash:
        shutil.rmtree(d, ignore_errors=True)

# And the caller stops when it is told to. A round that went on would re-assert
# a timer for a script that has just been deleted and walk a courses directory
# that is gone.
_round = open(os.path.join(ROOT, "scripts", "stay-current.sh"), encoding="utf-8").read()
check("the round that calls it stops when it retired the machine",
      'if [ "${PIPESTATUS[0]}" = "9" ]; then' in _round)

# Two ways in, because an instruction that can only arrive by one route is an
# instruction that does not arrive: the periodic round, and the periodic resume.
# Both are things a machine nobody logs in to runs on a timer.
_tutor = open(os.path.join(ROOT, "bin", "tutor"), encoding="utf-8").read()
check("and `tutor resume` asks the same question, out of the same one script",
      "def retire_host():" in _tutor
      and '"scripts", "retire-host.sh"' in _tutor
      and "if retire_host():" in _tutor)
check("after the pull, so the question is asked of the code that just landed",
      _tutor.index('tool_sync(cfg, quiet="--quiet" in rest)')
      < _tutor.index("if retire_host():"))
check("and it reads the exit code rather than the output",
      "return p.returncode == 9" in _tutor)

print()
if fails:
    print("%d FAILURES" % len(fails))
    sys.exit(1)
print("it retires the one machine and no other")
