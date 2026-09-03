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
