"""What a repository says it is.

A course declares its own subject and whether it is taught or worked on. The
mode is guessed only when nothing declares it, and the guess is deliberately
conservative: teaching a project as though it were a book is the failure this
exists to prevent.
"""

import glob
import json
import os


DEFAULT_CONFIG = {"name": None, "mode": None, "subtitle": "", "stance": "teach"}


def read_config(root):
    """A course declares itself in tutorboard.json at its root.

    Everything is optional. What is not declared is guessed, and the guess is
    only ever about how the board behaves, never about whether it works.
    """
    cfg = dict(DEFAULT_CONFIG)
    try:
        with open(os.path.join(root, "tutorboard.json"), "r", encoding="utf-8") as fh:
            cfg.update(json.load(fh) or {})
    except (OSError, ValueError):
        pass

    if not cfg.get("name"):
        cfg["name"] = os.path.basename(os.path.abspath(root)).replace("-", " ")

    mode = (cfg.get("mode") or "").lower()
    if mode not in ("math", "code"):
        mode = guess_mode(root)
    cfg["mode"] = mode

    stance = (cfg.get("stance") or "").lower()
    # Never guessed. Writing the code for somebody who wanted to learn it is the
    # one failure here that cannot be undone by the next card, so it is only ever
    # done because a repository asked for it in writing.
    cfg["stance"] = "do" if stance == "do" else "teach"
    return cfg


def guess_mode(root):
    """LaTeX in the repository means mathematics; otherwise assume code.

    Only a fallback. A repository that cares should say so in tutorboard.json --
    the guess is cheap to get wrong and free to override.
    """
    if os.path.isdir(os.path.join(root, "latex")):
        return "math"
    for base, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs
                   if d not in (".git", "live", "node_modules", "build", "__pycache__")]
        if any(n.endswith(".tex") for n in names):
            return "math"
        if base.count(os.sep) - root.count(os.sep) > 2:
            dirs[:] = []
    return "code"
