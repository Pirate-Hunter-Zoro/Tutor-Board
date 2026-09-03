"""The repository underneath a lesson: whether it has anything uncommitted, and
what happens when somebody presses save.

Saving compiles the write-up first, because a LaTeX error found at push time
is found by the student, on the board, at the moment they were trying to
leave.
"""

import glob as _glob
import json
import os
import subprocess
import sys
import time

from .. import paths, worktree
from ..course import homework


_DIRTY = {"at": 0.0, "value": None}
DIRTY_TTL = 8.0


def repo_dirty(repo):
    """How many files are uncommitted here, or None if that cannot be told.

    This exists so the board can show that there is something to save. Leaving a
    session is silent -- a lid closes, an app is swiped away -- and the student
    should be able to see, before they go, that going now loses something.
    """
    now = time.time()
    if _DIRTY["value"] is not None and now - _DIRTY["at"] < DIRTY_TTL:
        return _DIRTY["value"]
    value = None
    if os.path.isdir(os.path.join(repo.root, ".git")):
        try:
            p = subprocess.run(["git", "status", "--porcelain"], cwd=repo.root,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               timeout=10)
            if p.returncode == 0:
                lines = [l for l in p.stdout.decode("utf-8", "replace").splitlines()
                         if l.strip()]
                value = len(lines)
        except (OSError, subprocess.TimeoutExpired):
            value = None
    _DIRTY["at"] = now
    _DIRTY["value"] = value
    return value


def hw_needs_building(repo):
    """The sitting's problem set, if its PDF is missing or older than its source.

    Cheap: two `stat` calls behind a lookup the board already does every payload.
    Returns the set's name, or None when there is nothing to build -- no problem
    sets in this repository, none bound to this sitting, or a PDF already newer
    than the `.tex`.
    """
    try:
        st = homework.status(repo.root, repo.state())
    except Exception:                                        # noqa: BLE001
        return None
    if not st or not st.get("rel") or not st.get("name"):
        return None
    tex_path = os.path.join(repo.root, st["rel"])
    if not os.path.exists(tex_path):
        return None
    pdf = homework.compiled_pdf(repo.root, tex_path)
    if pdf and os.path.getmtime(pdf) >= os.path.getmtime(tex_path):
        return None
    return st["name"]


def run_hw_build(repo):
    """Compile the write-up because somebody asked, and hand back the record.

    `build_before_push` compiles only when the PDF is stale, which is right for
    a push -- there is no reason to spend a minute of LaTeX on a document that is
    already current. This one is a person pressing a button, and it always runs:
    "build it" that quietly does nothing is a button you press twice.

    The record comes back off `hw.json` rather than being reconstructed here, so
    the board is told exactly what the CLI recorded -- including `pdf`, which is
    what a download needs, and the LaTeX tail, which is what a failure needs.
    """
    try:
        st = homework.status(repo.root, repo.state())
    except Exception:                                        # noqa: BLE001
        st = None
    if not st or not st.get("rel") or not st.get("name"):
        return {"ok": False,
                "detail": "no problem set is bound to this sitting, so there is "
                          "nothing to write up. `board hw use <set>` names one."}
    cli = os.path.join(paths.TOOL, "bin", "board")
    if not os.path.exists(cli):
        return {"ok": False, "detail": "the board CLI is not where it should be"}
    try:
        p = subprocess.run([sys.executable, cli, "hw", "build"], cwd=repo.root,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=300)
        out = p.stdout.decode("utf-8", "replace").strip()
    except (subprocess.TimeoutExpired, OSError) as exc:
        return {"ok": False, "set": st.get("name"), "detail": str(exc)}
    try:
        with open(os.path.join(repo.live, "hw.json"), "r", encoding="utf-8") as fh:
            rec = json.load(fh)
    except (OSError, ValueError):
        rec = {"ok": False, "set": st.get("name"), "detail": out[-1600:]}
    rec.setdefault("set", st.get("name"))
    return rec


def build_before_push(repo):
    """Compile the write-up, so what is committed is the document and not just
    its source.

    An exercise is finished when it is typeset, not when it is agreed: the point
    of the hour is the piece of mathematics. Compiling it was a step the tutor had
    to remember at the end of a turn that had already delivered its card -- and
    sessions end by being abandoned far more often than they end tidily. What got
    pushed was then a `.tex` carrying tonight's proof beside a `.pdf` from last
    week that does not, which is worse than no PDF at all: it looks finished and
    is silently missing the exercise the evening was spent on.

    The compile is `board hw build`, the same one the tutor would run, so there is
    one way of building and one `hw.json` -- which the board is already painting,
    so a LaTeX error appears on the iPad rather than in a log nobody is reading.
    """
    name = hw_needs_building(repo)
    if not name:
        return None
    cli = os.path.join(paths.TOOL, "bin", "board")
    if not os.path.exists(cli):
        return None
    try:
        p = subprocess.run([sys.executable, cli, "hw", "build"], cwd=repo.root,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=180)
        out = p.stdout.decode("utf-8", "replace").strip()
        code = p.returncode
    except (subprocess.TimeoutExpired, OSError) as exc:
        out, code = str(exc), 1
    return {"set": name, "ok": code == 0, "detail": out[-800:]}


def run_push(repo, message=None):
    """Commit and push this repository, and record what happened.

    The work is the repository owner's. The script carries no co-author trailer
    and neither does anything here -- history should credit the person who did
    the mathematics and nobody else.

    It commits the whole tree on purpose: **save** means save, and a save that
    left the afternoon's code behind because it was not the lesson would be the
    wrong kind of clever. What it will not do is commit into an operation
    somebody is part-way through. A rebase or a merge outstanding means a
    terminal in this repository has its own plan for the next commit, and a tap
    on an iPad is not an instruction to walk over it -- so the tap says what is
    in the way instead, on the board, where the person who tapped is looking.
    """
    busy = worktree.busy_reason(repo.root)
    if busy:
        record = {
            "ok": False,
            "at": time.time(),
            "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
            "detail": ("nothing was committed: %s in this repository, so a "
                       "commit now would land in the middle of it. Nothing has "
                       "been lost -- finish or abort that in the terminal and "
                       "press save again." % busy),
        }
        with open(os.path.join(repo.live, "push.json"), "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2)
        return record
    # The write-up is part of the work, so it is part of the commit. Only when it
    # is actually out of date, so an ordinary save in the middle of a lesson
    # costs nothing.
    built = build_before_push(repo)

    script = os.path.join(repo.root, "scripts", "save-and-push.sh")
    if os.path.exists(script):
        cmd = ["bash", script]
        if message:
            cmd.append(message)
    else:
        cmd = ["bash", "-c",
               'set -e; export GIT_TERMINAL_PROMPT=0; git add -A; '
               'git diff --cached --quiet || git commit -m "$1"; git push'
               , "_", message or "lesson complete"]
    try:
        p = subprocess.run(cmd, cwd=repo.root, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=180)
        out = p.stdout.decode("utf-8", "replace").strip()
        code = p.returncode
    except subprocess.TimeoutExpired:
        out, code = "timed out after 3 minutes -- is a credential prompt waiting?", 1
    except OSError as exc:
        out, code = str(exc), 1

    record = {
        "ok": code == 0,
        "at": time.time(),
        "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
        "detail": out[-1200:],
    }
    if built:
        # Said on the board, not only in a log. A push that quietly shipped a
        # stale PDF because LaTeX failed is the exact silence this exists to end.
        record["built"] = built["set"]
        record["built_ok"] = built["ok"]
        if not built["ok"]:
            record["detail"] = (
                "the write-up did not compile, so its PDF is behind the source "
                "that was pushed:\n" + built["detail"] + "\n\n" + record["detail"])
    with open(os.path.join(repo.live, "push.json"), "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)
    return record
