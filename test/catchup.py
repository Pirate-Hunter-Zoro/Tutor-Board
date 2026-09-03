#!/usr/bin/env python3
"""Putting a machine right does not take somebody's afternoon with it.

`scripts/catch-up.sh` resets a course repository onto origin so that what the
board shows is what was pushed. Until 2026-09-03 it decided to do that on one
condition -- diverged OR dirty -- and the dirty half was a bug with teeth. A
repository sitting exactly on origin with uncommitted work in the tree took the
reset branch: the tag it wrote first was placed at HEAD, which already was
origin, so it preserved nothing, and the reset then threw the work away to move
the repository nowhere. It did that to two research repositories in one
afternoon, four times, before anybody worked out what was doing it.

Three cases are guarded here, and they are the three the old single condition
ran together. Each is exercised against real git repositories in a temporary
tree, through the real script, because the value of this file is that it runs
what ships rather than a description of it.
"""

import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPT = os.path.join(ROOT, "scripts", "catch-up.sh")

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


def git(root, *args, **kw):
    """Run one git command in a repository and return its stdout.

    Args:
        root (str): Repository working tree.
        *args (str): Arguments after `git`.

    Returns:
        str: Standard output, stripped.
    """
    p = subprocess.run(["git", "-C", root] + list(args), capture_output=True,
                       text=True, **kw)
    return p.stdout.strip()


def make_course(courses, name):
    """Build a course with an origin of its own, so the cases cannot cross-talk.

    Each case gets a private bare remote. Sharing one made the outcome of a case
    depend on which case ran before it, which is the sort of test that passes
    for the wrong reason.

    Args:
        courses (str): The directory standing in for the home folder.
        name (str): Course directory name.

    Returns:
        tuple[str, str]: The course working tree, and a seed clone of the same
            origin standing in for the other machine.
    """
    origin = os.path.join(courses, ".remotes", name + ".git")
    os.makedirs(os.path.dirname(origin), exist_ok=True)
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", origin], check=True)

    seed = os.path.join(courses, ".seeds", name)
    os.makedirs(os.path.dirname(seed), exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", "main", seed], check=True)
    git(seed, "config", "user.email", "t@t")
    git(seed, "config", "user.name", "t")
    open(os.path.join(seed, "README.md"), "w").write("seed\n")
    open(os.path.join(seed, "tutorboard.json"), "w").write("{}\n")
    git(seed, "add", "-A")
    git(seed, "commit", "-qm", "seed")
    git(seed, "remote", "add", "origin", origin)
    git(seed, "push", "-q", "origin", "main")

    root = os.path.join(courses, name)
    subprocess.run(["git", "clone", "-q", origin, root], check=True)
    git(root, "config", "user.email", "t@t")
    git(root, "config", "user.name", "t")
    return root, seed


def run(courses):
    """Run the course loop of the real script against a temporary tree.

    Args:
        courses (str): The directory standing in for the home folder.

    Returns:
        str: Combined output.
    """
    env = dict(os.environ, TUTORBOARD_COURSES=courses,
               TUTORBOARD_CATCHUP_LOG=os.path.join(courses, "catch-up.log"))
    p = subprocess.run(["bash", SCRIPT, "--courses-only"], capture_output=True,
                       text=True, env=env)
    return p.stdout + p.stderr


check("the command ships with the tool", os.path.isfile(SCRIPT))
src = open(SCRIPT, encoding="utf-8").read() if os.path.isfile(SCRIPT) else ""

check("a course is put right by stashing, then tagging, then resetting",
      "stash push -u" in src and "tag -f" in src)
check("and the board's own scratch does not count as somebody's work",
      "grep -v '^.. live/'" in src)
check("what ran it is recorded, because working that out took longer than "
      "fixing what it did",
      "CATCHUP_LOG" in src and "ps -o args=" in src)

work = tempfile.mkdtemp(prefix="catchup-")
try:
    courses = os.path.join(work, "home")
    os.makedirs(os.path.join(courses, "Tutor-Board"))   # the sibling it skips

    # CASE 1 -- current, and dirty. The one that used to destroy work.
    current, _ = make_course(courses, "Current")
    open(os.path.join(current, "afternoon.md"), "w").write("hours of it\n")
    open(os.path.join(current, "README.md"), "a").write("edited\n")

    # CASE 2 -- behind, and dirty. It has to move, so the work goes to the stash.
    behind, behind_seed = make_course(courses, "Behind")
    open(os.path.join(behind_seed, "landed.md"), "w").write("from the other machine\n")
    git(behind_seed, "add", "-A")
    git(behind_seed, "commit", "-qm", "landed elsewhere")
    git(behind_seed, "push", "-q", "origin", "main")
    open(os.path.join(behind, "afternoon.md"), "w").write("hours of it\n")

    # CASE 3 -- holding a commit origin does not have. The tag earns its keep.
    ahead, _ = make_course(courses, "Ahead")
    open(os.path.join(ahead, "local.md"), "w").write("never pushed\n")
    git(ahead, "add", "-A")
    git(ahead, "commit", "-qm", "only here")
    ahead_head = git(ahead, "rev-parse", "HEAD")

    # A board's scratch churning is not somebody's work and must not move a thing.
    scratch, _ = make_course(courses, "Scratch")
    os.makedirs(os.path.join(scratch, "live"))
    open(os.path.join(scratch, "live", "board.json"), "w").write("{}\n")
    scratch_head = git(scratch, "rev-parse", "HEAD")

    out = run(courses)

    check("a repository already on origin is left alone, uncommitted work and all",
          os.path.isfile(os.path.join(current, "afternoon.md"))
          and "edited" in open(os.path.join(current, "README.md")).read())
    check("and it says so rather than saying nothing",
          "Current: current, with uncommitted work left where it is" in out)
    check("nothing was stashed from it either, because nothing touched it",
          git(current, "stash", "list") == "")

    check("a repository that has to move is fast-forwarded",
          os.path.isfile(os.path.join(behind, "landed.md")))
    check("and its uncommitted work is in the stash, not gone",
          git(behind, "stash", "list") != "")
    check("which the output names, so nobody has to guess where it went",
          "stash pop" in out)
    git(behind, "stash", "pop")
    check("and popping it brings the work back",
          os.path.isfile(os.path.join(behind, "afternoon.md")))

    check("a repository holding commits origin lacks is reset onto origin",
          git(ahead, "rev-parse", "HEAD") == git(ahead, "rev-parse", "origin/main"))
    check("with those commits kept as a tag that actually names them",
          any(git(ahead, "rev-parse", t) == ahead_head
              for t in git(ahead, "tag", "--list", "before-catch-up-*").split()))

    check("a churning live/ directory is not mistaken for somebody's work",
          git(scratch, "rev-parse", "HEAD") == scratch_head
          and os.path.isfile(os.path.join(scratch, "live", "board.json")))

    log = os.path.join(courses, "catch-up.log")
    check("and the run recorded what invoked it",
          os.path.isfile(log) and "host=" in open(log).read())
finally:
    shutil.rmtree(work, ignore_errors=True)

print()
if fails:
    print("%d failed" % len(fails))
    sys.exit(1)
print("all good")
