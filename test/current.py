#!/usr/bin/env python3
"""A machine that is not the one you are sitting at keeps itself current.

Fixes to this tool are written on the compute node, which cannot reach the Mac.
The Mac holds the address and runs the follower, so until something over there
restarts the processes holding the old code, half of every fix is on disk and
none of it is in the lesson. `scripts/catch-up.sh` is the command that puts a
machine right and somebody has to be sitting at it to type that.

`scripts/stay-current.sh` is that command on a timer. What is guarded here is
the part that is easy to get wrong and impossible to notice from the other end
of a tailnet:

  - a round only puts the machine right when something ACTUALLY arrived, because
    doing it restarts every board and a person may be mid-proof;
  - "behind" means origin has something we have not, not that two hashes differ
    -- a machine that is AHEAD differs too, and reading that as behind is an
    infinite loop with a `git pull` in it;
  - a round re-asserts its own supervision from the repository it just pulled,
    which is what makes this the LAST time anybody has to visit the machine;
  - and the tool repository can never be the thing that gets stuck, because a
    machine that cannot fast-forward is a machine somebody has to go and visit.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPT = os.path.join(ROOT, "scripts", "stay-current.sh")

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


check("the timer ships with the tool", os.path.isfile(SCRIPT))
src = open(SCRIPT, encoding="utf-8").read() if os.path.isfile(SCRIPT) else ""

check("it is one command to install", "--status" in src and "--uninstall" in src)
check("and it registers itself with the system's own supervisor",
      "LaunchAgents" in src and "StartInterval" in src)
check("on linux too, so the tool is not one machine's script",
      "systemctl --user" in src and "OnUnitActiveSec" in src)

# The half that makes it the last visit.
check("a round re-asserts its own definition from the repository",
      "install_timer" in src and "plist_text | write_if_changed" in src)
check("and reloads only when that definition actually changed, because "
      "reloading the follower costs the address a moment",
      "write_if_changed()" in src and "cmp -s" in src)
check("the follower and the warm board are asserted, not reinstalled",
      "ensure_always_on" in src and 'loaded "$LABEL_FOLLOW"' in src)
check("and the timer this supersedes is retired rather than left racing it",
      "retire_pull_timer" in src and "com.tutorboard.pull" in src)
check("a round hands over to the code it just pulled",
      "exec bash \"$HERE/scripts/stay-current.sh\" --run --after-pull" in src)
check("with a guard, so a pull that moved nothing cannot loop for ever",
      '[ "$was" != "$(git -C "$HERE" rev-parse HEAD 2>/dev/null)" ]' in src)

# The rule that keeps it from being worse than the problem.
check("nothing is restarted unless something arrived",
      'if [ "$moved" -eq 0 ]' in src and "beat \"nothing to do\"" in src)
check("and putting the machine right is still catch-up.sh, not a second copy "
      "of it",
      "scripts/catch-up.sh" in src and src.count("tutor restart") == 0)
check("the tool is never the thing that gets stuck",
      "unstick_tool" in src and "reset --hard" in src)
check("and nothing it does destroys work: stash, then tag, then reset",
      "stash push -u" in src and "tag -f" in src and "way back" in src)
check("a round leaves a heartbeat, so --status can say when it last ran",
      "beat()" in src and "rounds" in src)
check("and the log cannot grow for ever on a machine nobody visits",
      "trim_log" in src and "LOG_CAP" in src)

# --- and then actually drive it ---------------------------------------------
#
# Source reading catches a missing rule; only running it catches a round that
# restarts a machine because a hash differed. Two real repositories, a real
# origin, and a real `--run`.

def git(*args, cwd=None):
    return subprocess.run(["git"] + list(args), cwd=cwd,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def head(root):
    return git("rev-parse", "HEAD", cwd=root).stdout.decode().strip()


box = tempfile.mkdtemp(prefix="tutor-current-")
try:
    origin = os.path.join(box, "origin.git")
    work = os.path.join(box, "work")
    git("init", "--bare", "-b", "main", origin)
    git("clone", origin, work)
    git("config", "user.email", "t@t", cwd=work)
    git("config", "user.name", "t", cwd=work)
    open(os.path.join(work, "a"), "w").write("1")
    git("add", "-A", cwd=work)
    git("commit", "-m", "one", cwd=work)
    git("push", "-u", "origin", "main", cwd=work)

    # A second clone standing in for the machine that is not visited.
    far = os.path.join(box, "far")
    git("clone", origin, far)

    # The REAL rule, asked of the real script. Reimplementing it here would test
    # the reimplementation, and the reimplementation is not what runs at three in
    # the morning on a machine nobody is at.
    def behind(root):
        p = subprocess.run(["bash", SCRIPT, "--behind", root],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=120)
        return p.returncode == 0

    check("a clone level with origin is not behind it", not behind(far))

    open(os.path.join(work, "a"), "w").write("2")
    git("commit", "-am", "two", cwd=work)
    git("push", cwd=work)
    check("a clone with a commit waiting for it is behind", behind(far))

    git("pull", "--ff-only", cwd=far)
    check("and is not, once it has taken it", not behind(far))

    # The loop this cost a rewrite to avoid: a machine AHEAD of origin.
    open(os.path.join(far, "b"), "w").write("local")
    git("config", "user.email", "t@t", cwd=far)
    git("config", "user.name", "t", cwd=far)
    git("add", "-A", cwd=far)
    git("commit", "-m", "local only", cwd=far)
    check("a clone that is AHEAD of origin is not treated as behind it",
          not behind(far))
    check("even though its HEAD differs from origin's, which is what the first "
          "version compared", head(far) != git("rev-parse", "origin/main",
                                               cwd=far).stdout.decode().strip())
finally:
    shutil.rmtree(box, ignore_errors=True)

# A round on a machine with nothing to do must do nothing, and say so. Run the
# real script, with the supervisor stubbed out -- registering a launchd agent
# from a test suite would be a rude thing to do to somebody's machine.
#
# AND WITH THE COURSES POINTED SOMEWHERE ELSE, which is not a nicety. This runs
# the real `--run`, a round can end in `catch-up.sh`, and `catch-up.sh` moves
# working trees. Until 2026-09-03 it ran against the actual home: on a machine
# where the tool was behind, the round exec'd itself `--after-pull`, which
# reaches step 4 unconditionally, and every course beside the tool was caught up
# because somebody ran the test suite. Two research repositories lost their
# uncommitted work four times in an afternoon that way. A test does not get to
# touch anything it did not create.
env = dict(os.environ)
env["TUTOR_CURRENT_NO_SUPERVISOR"] = "1"
env["HOME"] = tempfile.mkdtemp(prefix="tutor-current-home-")
env["TUTORBOARD_COURSES"] = tempfile.mkdtemp(prefix="tutor-current-courses-")
os.makedirs(os.path.join(env["TUTORBOARD_COURSES"], "Tutor-Board"), exist_ok=True)
check("a round can be pointed at courses of its own, so running the tests "
      "cannot move somebody's working tree",
      'TUTORBOARD_COURSES' in open(SCRIPT, encoding="utf-8").read())

# AND FROM A COPY OF THE TOOL, WHICH THE COURSES OVERRIDE ALONE DID NOT COVER.
#
# Step 1 of a round is `git pull --ff-only` on the repository the script lives
# in, and the script lived in this one. On 7 September, while somebody was
# being taught on this machine, running the suite fast-forwarded the working
# copy it was being run from -- and then, because a pull that MOVED hands over
# to the code that landed with `--after-pull`, went on to step 4 and ran
# `catch-up.sh` for real. The Galois board and its tutor were restarted in the
# middle of the evening and a second board for the same course was left
# answering on a port nobody knew about.
#
# `unstick_tool` is the sharper end of the same thing: a pull that cannot
# fast-forward stashes the working tree and hard-resets it, which on a
# developer's checkout is their afternoon.
#
# A local clone, so `behind` is answered against a remote in the temporary
# directory and no part of this reaches the network or the real repository.
tool = os.path.join(tempfile.mkdtemp(prefix="tutor-current-tool-"), "Tutor-Board")
subprocess.run(["git", "clone", "--quiet", "--local", "--no-hardlinks", ROOT, tool],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
copied = os.path.join(tool, "scripts", "stay-current.sh")
check("the round under test is a copy, not the repository being worked in",
      os.path.isfile(copied))
was_head = head(ROOT)
try:
    p = subprocess.run(["bash", copied, "--run"], env=env, cwd=tool,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=300)
    out = p.stdout.decode("utf-8", "replace")
    check("a round runs to completion on a machine with nothing to do",
          p.returncode == 0)
    check("and does not restart anything when nothing arrived",
          "catching up" not in out)
    beat = os.path.join(env["HOME"], ".tutor-current.json")
    doc = {}
    if os.path.isfile(beat):
        doc = json.load(open(beat, encoding="utf-8"))
    check("it leaves a heartbeat saying when it ran and what it found",
          bool(doc.get("iso")) and bool(doc.get("last")))
    check("and the heartbeat names the commit the machine is actually on",
          bool(doc.get("head")))
    check("and a round that catches up says which courses it was for",
          "catching up" not in out or ":" in out)
    check("and the repository the suite is being run from did not move",
          head(ROOT) == was_head)
except subprocess.TimeoutExpired:
    check("a round runs to completion on a machine with nothing to do", False)
finally:
    shutil.rmtree(env["TUTORBOARD_COURSES"], ignore_errors=True)
    shutil.rmtree(env["HOME"], ignore_errors=True)
    shutil.rmtree(os.path.dirname(tool), ignore_errors=True)

# And the last hole the courses override left. `stay-current.sh` and
# `catch-up.sh` both honour it and both then hand the machine to `tutor restart
# --tutors`, which had never heard of it: it asked the configuration, whose
# default is the tool's parent directory, and found the real home. Moving
# `HOME` does not help -- it changes which config is read, and a missing config
# falls back to that same default.
sys.path.insert(0, ROOT)
import importlib.machinery                                        # noqa: E402
import importlib.util                                             # noqa: E402

_tspec = importlib.util.spec_from_loader(
    "tutorcli_current",
    importlib.machinery.SourceFileLoader("tutorcli_current",
                                         os.path.join(ROOT, "bin", "tutor")))
_tutor = importlib.util.module_from_spec(_tspec)
_tspec.loader.exec_module(_tutor)

_box = tempfile.mkdtemp(prefix="tutor-current-only-")
os.makedirs(os.path.join(_box, "Only-This-One", "live"))
open(os.path.join(_box, "Only-This-One", "tutorboard.json"), "w").write("{}")
_was = os.environ.get("TUTORBOARD_COURSES")
os.environ["TUTORBOARD_COURSES"] = _box
try:
    found = [c["dir"] for c in _tutor.courses({"courses_dir": os.path.expanduser("~")})]
    check("`tutor` looks for courses where it is pointed, not where the machine "
          "keeps them -- so a scoped round restarts nothing of the person's",
          found == ["Only-This-One"])
finally:
    if _was is None:
        os.environ.pop("TUTORBOARD_COURSES", None)
    else:
        os.environ["TUTORBOARD_COURSES"] = _was
    shutil.rmtree(_box, ignore_errors=True)

# Everything that briefs a person points at it.
readme = open(os.path.join(ROOT, "README.md"), encoding="utf-8").read()
check("the README says how to make this the last visit",
      "stay-current.sh" in readme)

print()
print("%d FAILURES" % len(fails) if fails else "the machine keeps itself current")
sys.exit(1 if fails else 0)
