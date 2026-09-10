"""The repository underneath a lesson, which somebody else may be working in.

A course repository is not the board's private scratch space. The person being
taught in it is the same person who opens a terminal in it and writes code --
and the tutoring machinery runs UNATTENDED, on a ninety-second beat, with
nobody watching what it does to git. Two rules come out of that, and this
module is both of them.

**Never commit what you were not asked to commit.** `git commit` commits the
INDEX, all of it. So the transcript beat -- `git add -A live`, then commit --
also committed whatever somebody had staged in the terminal a moment earlier,
under the message "lesson transcript". Nothing in the beat wanted those files
and nothing in it knew they were there. A commit is made against an explicit
pathspec instead, with `--only`, which takes the named paths and leaves the rest
of the index exactly where it was.

**Never write history into a repository that is mid-operation.** A rebase, a
merge, a cherry-pick, a revert, a bisect or a detached HEAD all mean somebody is
part-way through something that has its own plan for the next commit, and a
commit landing in the middle of it is at best confusing and at worst a lost
branch. The answer is to do nothing this tick and say why: the transcript is
append-only, nothing is lost by waiting, and the next tick is ninety seconds
away.

Standard library only, and no `git` calls: this is read off the files git itself
keeps, so it costs nothing to ask on every beat and cannot hang on a lock.
"""

import os
import time


def git_dir(root):
    """This repository's `.git`, resolved, or None if there is not one.

    `.git` is a directory in an ordinary clone and a FILE holding `gitdir: ...`
    in a linked worktree or a submodule. Reading only the directory case is how
    a guard silently stops guarding for anybody working in a worktree.
    """
    here = os.path.join(root, ".git")
    if os.path.isdir(here):
        return here
    if os.path.isfile(here):
        try:
            with open(here, "r", encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("gitdir:"):
                        path = line.split(":", 1)[1].strip()
                        if not os.path.isabs(path):
                            path = os.path.join(root, path)
                        return os.path.normpath(path)
        except OSError:
            return None
    return None


# What git leaves on disk while an operation it started is unfinished. Each one
# is a name inside the git directory and each one means the same thing here: a
# person is part-way through something and the next commit is theirs.
BUSY_MARKERS = (
    ("rebase-merge", "a rebase is in progress"),
    ("rebase-apply", "a rebase or an `am` is in progress"),
    ("MERGE_HEAD", "a merge is in progress"),
    ("CHERRY_PICK_HEAD", "a cherry-pick is in progress"),
    ("REVERT_HEAD", "a revert is in progress"),
    ("BISECT_LOG", "a bisect is in progress"),
)


def busy_reason(root):
    """Why this repository must be left alone, or None if it is ordinary.

    Called before anything automatic writes git history here. A `None` means
    the repository is on a branch, with no operation outstanding -- which is the
    only state in which an unattended commit is somebody's idea of normal.
    """
    gd = git_dir(root)
    if not gd:
        return None                      # not a repository; nothing to protect
    for name, why in BUSY_MARKERS:
        if os.path.exists(os.path.join(gd, name)):
            return why
    # A detached HEAD is not an error and not necessarily an operation, but it
    # is never somewhere to append a lesson: the commit would be reachable from
    # nothing and the next checkout would lose it without a word.
    try:
        with open(os.path.join(gd, "HEAD"), "r", encoding="utf-8") as fh:
            head = fh.read().strip()
    except OSError:
        return None
    if head and not head.startswith("ref:"):
        return "HEAD is detached, so a commit here would be reachable from nothing"
    return None


# ---------------------------------------------------------------------------
# The lock a killed git leaves behind.
#
# `git add`, `git commit`, `git pull` and an ordinary `git status` all take
# `.git/index.lock` before they touch the index, and release it by renaming it
# over the index when they are done. A git that is KILLED part-way -- and
# everything here runs git under a subprocess timeout, on a network filesystem,
# in a repository whose slate pages are being rewritten every two seconds --
# never gets to that rename. What it leaves is an empty lock file, and from that
# moment every route to a commit in this repository is closed: the transcript
# beat, the board's save button, `board push`, and the person's own terminal.
#
# Measured on Galois Theory, 10 September: a zero-byte `index.lock` at 15:16:32,
# the last transcript commit at 15:14:59, and every save from the iPad after that
# answered with git's own advice -- "remove the file manually to continue" --
# which is not a thing anybody can do from an iPad in the middle of a proof.
#
# A lock is therefore not like a rebase. A rebase means a person is part-way
# through something and the answer is to wait forever. A lock means either that
# git is running RIGHT NOW, which is over in seconds, or that it is not, in which
# case the file is rubbish and holding onto it costs somebody their afternoon.
# Telling those apart is the whole of what follows.
# ---------------------------------------------------------------------------

# How long a lock nobody can be shown to hold has to sit there before it is
# rubbish. Every git call in this tool runs under a timeout well below this, so
# a lock older than this cannot belong to one of ours that is still going.
LOCK_STALE_AFTER = 300.0

# A lock is created and opened in the same breath, so a holder is findable the
# moment it exists. This grace is for the gap between the two, and for a reader
# that arrives in the middle of it.
LOCK_GRACE = 5.0


def index_lock(root):
    """This repository's `.git/index.lock`, or None if there is not one."""
    gd = git_dir(root)
    if not gd:
        return None
    path = os.path.join(gd, "index.lock")
    return path if os.path.exists(path) else None


def _lock_holder(path):
    """Whether a live process holds this file open: True, False, or None.

    `None` means the question could not be asked -- there is no `/proc` on a Mac
    -- and the caller falls back to age alone. Every open file descriptor on
    Linux is a symlink under `/proc/<pid>/fd`, so this is a scan of those and no
    more; other people's processes are unreadable and are skipped, which is
    correct here because a git holding this lock is one of ours.
    """
    if not os.path.isdir("/proc"):
        return None
    try:
        want = os.path.realpath(path)
    except OSError:
        return None
    seen_any = False
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        fd_dir = os.path.join("/proc", pid, "fd")
        try:
            names = os.listdir(fd_dir)
        except OSError:
            continue                     # not ours, or gone between two calls
        seen_any = True
        for name in names:
            try:
                target = os.readlink(os.path.join(fd_dir, name))
            except OSError:
                continue
            if target == want or target == path:
                return True
    return False if seen_any else None


def lock_reason(root):
    """What `.git/index.lock` means here, as (verdict, sentence).

    Verdict is one of:

      `None`   -- there is no lock; carry on.
      `"held"` -- git is running in here this second. Say so and come back.
      `"stale"`-- nobody holds it and nobody is coming for it. Clear it.

    The sentence is for a person reading a board, not for a log: it says what is
    happening in words somebody holding an iPad can act on.
    """
    path = index_lock(root)
    if not path:
        return None, None
    try:
        age = max(0.0, time.time() - os.path.getmtime(path))
    except OSError:
        return None, None                # went away while we were looking
    holder = _lock_holder(path)
    if holder is True:
        return "held", ("a git command is running in this repository right now, "
                        "so the index is locked. Nothing has been lost -- press "
                        "save again in a moment.")
    if holder is False and age > LOCK_GRACE:
        return "stale", ("cleared a lock file a git command left behind when it "
                         "was interrupted %d seconds ago" % int(age))
    if holder is None and age > LOCK_STALE_AFTER:
        # No `/proc` to ask, so age is the only evidence there is. The threshold
        # is above every timeout in this tool, which is what makes it safe: a
        # lock this old cannot belong to one of ours that is still running.
        return "stale", ("cleared a lock file left behind %d minutes ago by a git "
                         "command that did not finish" % int(age / 60))
    if holder is None:
        return "held", ("the git index is locked in this repository, and this "
                        "machine cannot tell whether the command holding it is "
                        "still running. Nothing has been lost -- press save "
                        "again in a few minutes and it will be cleared.")
    return "held", ("a git command is running in this repository right now, so "
                    "the index is locked. Nothing has been lost -- press save "
                    "again in a moment.")


def clear_stale_lock(root):
    """Remove a lock nobody holds, and say what was done, or None if nothing was.

    Called before anything that needs the index. It removes only a lock this
    module has just decided is rubbish, so a git that is genuinely running is
    never pulled out from under itself.
    """
    verdict, sentence = lock_reason(root)
    if verdict != "stale":
        return None
    path = index_lock(root)
    if not path:
        return None
    try:
        os.remove(path)
    except OSError:
        return None
    return sentence
