#!/usr/bin/env python3
"""A course repository is somewhere its owner WORKS, not only where they learn.

The tutoring machinery runs unattended. The transcript beat commits and pushes
every ninety seconds, `sync` fast-forwards a course as a session opens, and the
board's save button commits the whole tree from a tap on an iPad. All of that
happens in a repository that the same person opens a terminal in and writes code
in, with nobody watching what it does to git.

Two defects come out of that, and both are guarded here.

    THE INDEX IS NOT THE BEAT'S TO COMMIT. `git commit` commits the whole index.
    So the beat -- `git add -A live`, then commit -- also committed whatever had
    been staged in a terminal a moment earlier, under the message "lesson
    transcript". Nothing in the beat wanted those files and nothing in it knew
    they were there.

    NOTHING AUTOMATIC WRITES INTO AN OPERATION SOMEBODY STARTED. A rebase, a
    merge, a cherry-pick, a revert, a bisect or a detached HEAD all mean a person
    is part-way through something with its own plan for the next commit.

Everything here runs the code that ships, against real git repositories.
"""

import importlib.machinery
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from tutorboard import worktree                              # noqa: E402
from tutorboard.course import repo as course_repo            # noqa: E402
from tutorboard.lesson import git as lesson_git              # noqa: E402

loader = importlib.machinery.SourceFileLoader(
    "tutorcli", os.path.join(ROOT, "bin", "tutor"))
spec = importlib.util.spec_from_loader("tutorcli", loader)
tutorcli = importlib.util.module_from_spec(spec)
loader.exec_module(tutorcli)

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


def git(root, *args):
    p = subprocess.run(["git", "-C", root] + list(args), capture_output=True,
                       text=True)
    return p.returncode, p.stdout.strip()


def make_repo(where, name="course"):
    """A course with a bare origin of its own, so cases cannot cross-talk."""
    origin = os.path.join(where, name + ".git")
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", origin], check=True)
    root = os.path.join(where, name)
    os.makedirs(os.path.join(root, "live", "slate"))
    os.makedirs(os.path.join(root, "src"))
    subprocess.run(["git", "init", "-q", "-b", "main", root], check=True)
    git(root, "config", "user.email", "t@t")
    git(root, "config", "user.name", "t")
    open(os.path.join(root, "README.md"), "w").write("a course\n")
    open(os.path.join(root, "src", "app.py"), "w").write("x = 1\n")
    open(os.path.join(root, "live", "slate", "page-01.json"), "w").write("{}\n")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "first")
    git(root, "remote", "add", "origin", origin)
    git(root, "push", "-q", "origin", "main")
    return root


def start_conflicted_rebase(root):
    """Leave a REAL interrupted rebase on disk, not a fabricated marker file."""
    git(root, "checkout", "-q", "-b", "side")
    open(os.path.join(root, "README.md"), "w").write("mine\n")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "mine")
    git(root, "checkout", "-q", "main")
    open(os.path.join(root, "README.md"), "w").write("theirs\n")
    git(root, "add", "-A")
    git(root, "commit", "-qm", "theirs")
    git(root, "checkout", "-q", "side")
    git(root, "rebase", "main")          # conflicts, and stops
    return worktree.git_dir(root)


work = tempfile.mkdtemp(prefix="beside-")
try:
    # --- what counts as "somebody is in the middle of something" -------------
    root = make_repo(work, "plain")
    check("an ordinary repository on a branch is left to get on with it",
          worktree.busy_reason(root) is None)
    check("and its git directory is found", worktree.git_dir(root) is not None)

    gd = worktree.git_dir(root)
    for marker, word in [("MERGE_HEAD", "merge"), ("CHERRY_PICK_HEAD", "cherry-pick"),
                         ("REVERT_HEAD", "revert"), ("BISECT_LOG", "bisect")]:
        path = os.path.join(gd, marker)
        open(path, "w").write("x\n")
        why = worktree.busy_reason(root)
        check("a %s in progress is a reason to do nothing" % word,
              bool(why) and word in why)
        os.remove(path)
    check("and with it gone the repository is ordinary again",
          worktree.busy_reason(root) is None)

    head_was = open(os.path.join(gd, "HEAD")).read()
    sha = git(root, "rev-parse", "HEAD")[1]
    open(os.path.join(gd, "HEAD"), "w").write(sha + "\n")
    why = worktree.busy_reason(root)
    check("a detached HEAD is too, because a commit there is reachable from nothing",
          bool(why) and "detached" in why)
    open(os.path.join(gd, "HEAD"), "w").write(head_was)

    # `.git` is a FILE in a linked worktree and in a submodule. Reading only the
    # directory case is how a guard silently stops guarding for anybody using one.
    linked = os.path.join(work, "linked")
    os.makedirs(linked)
    shutil.move(os.path.join(root, ".git"), os.path.join(linked, "realgit"))
    open(os.path.join(root, ".git"), "w").write("gitdir: ../linked/realgit\n")
    check("a worktree whose .git is a file is followed to the real one",
          worktree.git_dir(root) == os.path.normpath(os.path.join(linked, "realgit")))
    open(os.path.join(os.path.join(linked, "realgit"), "MERGE_HEAD"), "w").write("x")
    check("and it is guarded the same way",
          "merge" in (worktree.busy_reason(root) or ""))

    check("somewhere that is not a repository is nobody's business",
          worktree.busy_reason(work) is None)

    # --- the beat commits the transcript, and ONLY the transcript ------------
    beat = make_repo(work, "beat")
    # The person, in a terminal: half a refactor, staged, and something untracked
    # they have not decided about yet.
    open(os.path.join(beat, "src", "app.py"), "w").write("BROKEN MID-EDIT\n")
    git(beat, "add", "src/app.py")
    open(os.path.join(beat, "src", "scratch.py"), "w").write("notes\n")
    # The tutor, meanwhile: a page handed in.
    open(os.path.join(beat, "live", "slate", "page-02.json"), "w").write("{}\n")

    tutorcli.sync_transcript(beat)

    _, files = git(beat, "show", "--name-only", "--format=", "HEAD")
    committed = [f for f in files.splitlines() if f.strip()]
    check("the beat commits the page that was handed in",
          committed == ["live/slate/page-02.json"])
    check("and NOTHING else -- a staged refactor is not the beat's to commit",
          "src/app.py" not in committed)
    _, staged = git(beat, "diff", "--cached", "--name-only")
    check("the terminal's staged file is still staged, exactly as it was",
          staged.strip() == "src/app.py")
    check("and its contents are untouched",
          open(os.path.join(beat, "src", "app.py")).read() == "BROKEN MID-EDIT\n")
    _, status = git(beat, "status", "--porcelain")
    check("the untracked file is still untracked and unmentioned",
          "?? src/scratch.py" in status)
    _, subject = git(beat, "log", "-1", "--format=%s")
    check("the commit says what it is", subject == "lesson transcript")

    # And it is not merely cautious: with nothing of the person's in the way it
    # still does its whole job.
    open(os.path.join(beat, "live", "slate", "page-03.json"), "w").write("{}\n")
    tutorcli.sync_transcript(beat)
    _, files = git(beat, "show", "--name-only", "--format=", "HEAD")
    check("a later beat commits the next page",
          "live/slate/page-03.json" in files)

    # --- and it does nothing at all mid-operation ---------------------------
    busy = make_repo(work, "busy")
    start_conflicted_rebase(busy)
    check("a real interrupted rebase is on disk",
          bool(worktree.busy_reason(busy)))
    _, before = git(busy, "rev-parse", "HEAD")
    open(os.path.join(busy, "live", "slate", "page-02.json"), "w").write("{}\n")

    log_path = os.path.join(work, "beat.log")
    with open(log_path, "w") as fh:
        tutorcli.sync_transcript(busy, log=fh)
    _, after = git(busy, "rev-parse", "HEAD")
    check("the beat writes no commit into a rebase", before == after)
    _, status = git(busy, "status", "--porcelain")
    check("and does not even stage the page; it is left on disk for the next beat",
          "?? live/slate/page-02.json" in status
          and os.path.isfile(os.path.join(busy, "live", "slate", "page-02.json")))
    check("and it says why in the log, rather than going quiet",
          "rebase" in open(log_path).read())

    # `sync`, which fast-forwards a course as a session opens, is the same rule.
    check("opening a session does not fast-forward over an operation either",
          tutorcli.sync(busy, quiet=True) is False)
    _, after = git(busy, "rev-parse", "HEAD")
    check("so HEAD is exactly where the person left it", before == after)

    # --- the save button, and the script behind it --------------------------
    saving = make_repo(work, "saving")
    shutil.copytree(os.path.join(ROOT, "scripts"), os.path.join(saving, "scripts"))
    git(saving, "add", "-A")
    git(saving, "commit", "-qm", "scripts")
    start_conflicted_rebase(saving)
    _, before = git(saving, "rev-parse", "HEAD")
    open(os.path.join(saving, "src", "app.py"), "w").write("mid-edit\n")

    rec = lesson_git.run_push(course_repo.Repo(saving), "lesson complete")
    check("a tap on save refuses rather than committing into a rebase",
          rec.get("ok") is False)
    check("and says what is in the way, on the board where the tap came from",
          "rebase" in (rec.get("detail") or ""))
    check("and says nothing has been lost, because nothing has",
          "nothing has been lost" in (rec.get("detail") or "").lower())
    check("which the board reads off push.json",
          os.path.isfile(os.path.join(saving, "live", "push.json"))
          and json.load(open(os.path.join(saving, "live", "push.json")))["ok"]
          is False)
    _, after = git(saving, "rev-parse", "HEAD")
    check("and no commit was made", before == after)

    p = subprocess.run(["bash", os.path.join(saving, "scripts", "save-and-push.sh"),
                        "by hand"], capture_output=True, text=True, cwd=saving)
    check("the script says the same thing when it is run by hand",
          p.returncode != 0 and "rebase-merge" in (p.stdout + p.stderr))
    _, after = git(saving, "rev-parse", "HEAD")
    check("and it commits nothing either", before == after)

    # --- THE LOCK A KILLED GIT LEAVES BEHIND --------------------------------
    #
    # Everything above runs git under a subprocess timeout. A git killed at its
    # timeout never gets to rename `index.lock` over the index, and what it
    # leaves closes every route to a commit in the repository: the beat, the
    # save button, `board push`, and the person's own terminal. Galois Theory,
    # 10 September: a zero-byte lock at 15:16:32, the last transcript commit at
    # 15:14:59, and seventy minutes of pages sitting uncommitted while the board
    # answered a tap on save with git's advice to remove the file by hand.
    locked = make_repo(work, "locked")
    lock = os.path.join(worktree.git_dir(locked), "index.lock")

    open(lock, "w").close()
    os.utime(lock, (0, 0))               # left behind long ago
    check("a lock is found", worktree.index_lock(locked) == lock)
    verdict, said = worktree.lock_reason(locked)
    check("one nobody holds is rubbish, not an operation to respect",
          verdict == "stale")
    check("and it says so in words, for the board rather than a log",
          bool(said) and "lock" in said)
    check("clearing it says what was done", bool(worktree.clear_stale_lock(locked)))
    check("and the lock is gone", worktree.index_lock(locked) is None)
    check("clearing nothing is not an event",
          worktree.clear_stale_lock(locked) is None
          and worktree.lock_reason(locked) == (None, None))

    # A lock somebody is genuinely holding is a different thing entirely, and it
    # is left exactly where it is. Held open by THIS process, which is the only
    # honest way to test it -- an age test alone cannot tell the two apart.
    held = open(lock, "w")
    try:
        os.utime(lock, (0, 0))           # old AND held: held wins
        verdict, said = worktree.lock_reason(locked)
        check("a lock a live process holds is not cleared, however old it looks",
              verdict == "held")
        check("and the sentence tells somebody to come back rather than to fix it",
              "press save again" in (said or ""))
        check("and it is still on disk", worktree.clear_stale_lock(locked) is None
              and worktree.index_lock(locked) == lock)
    finally:
        held.close()

    # The beat is what comes back every ninety seconds, so the beat is what
    # heals it -- and its own failure is no longer silent.
    beating = make_repo(work, "beating")
    beat_lock = os.path.join(worktree.git_dir(beating), "index.lock")
    open(beat_lock, "w").close()
    os.utime(beat_lock, (0, 0))
    open(os.path.join(beating, "live", "slate", "page-02.json"), "w").write("{}\n")
    log_path = os.path.join(work, "locked-beat.log")
    with open(log_path, "w") as fh:
        tutorcli.sync_transcript(beating, log=fh)
    said = open(log_path).read()
    check("the beat clears a stale lock instead of dying against it",
          not os.path.exists(beat_lock))
    check("and commits the page it came to commit",
          "live/slate/page-02.json" in git(beating, "show", "--name-only",
                                           "--format=", "HEAD")[1])
    check("and says in the log that it cleared one", "lock" in said)

    # And a save from the iPad rescues itself, rather than handing back git's
    # advice to delete a file the person cannot reach.
    tapping = make_repo(work, "tapping")
    shutil.copytree(os.path.join(ROOT, "scripts"), os.path.join(tapping, "scripts"))
    tap_lock = os.path.join(worktree.git_dir(tapping), "index.lock")
    open(tap_lock, "w").close()
    os.utime(tap_lock, (0, 0))
    open(os.path.join(tapping, "src", "app.py"), "w").write("this evening\n")
    rec = lesson_git.run_push(course_repo.Repo(tapping), "saved from the board")
    check("a tap on save gets past a lock a killed git left behind",
          rec.get("ok") is True)
    check("and the work is actually committed",
          "src/app.py" in git(tapping, "show", "--name-only", "--format=", "HEAD")[1])
    check("and the board is told a lock was cleared, not left to wonder",
          rec.get("cleared_lock") is True and "lock" in (rec.get("detail") or ""))

    # The badge is the other half: an ordinary `git status` takes the lock to
    # write back the index it refreshed, every eight seconds, in a repository
    # whose slate pages are being rewritten under it. It must neither create a
    # lock nor go blank because of one.
    watching = make_repo(work, "watching")
    watch_lock = os.path.join(worktree.git_dir(watching), "index.lock")
    open(os.path.join(watching, "src", "app.py"), "w").write("changed\n")
    open(watch_lock, "w").close()
    lesson_git._DIRTY.update({"at": 0.0, "value": None})
    n = lesson_git.repo_dirty(course_repo.Repo(watching))
    check("the save badge still counts the work while the index is locked", n == 1)
    check("and it did not touch the lock", os.path.exists(watch_lock))
    os.remove(watch_lock)
    lesson_git._DIRTY.update({"at": 0.0, "value": None})
    lesson_git.repo_dirty(course_repo.Repo(watching))
    check("and a poll of its own leaves no lock behind",
          not os.path.exists(watch_lock))
finally:
    shutil.rmtree(work, ignore_errors=True)

print()
if fails:
    print("%d FAILURES" % len(fails))
    sys.exit(1)
print("the repository beside the lesson is left to its owner")
