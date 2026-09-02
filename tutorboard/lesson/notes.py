"""Typed messages, in both directions, and the drafts behind them.
"""

import json
import os
import re


def load_messages(repo, limit=60):
    out = []
    try:
        with open(repo.messages_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return out[-limit:]


def load_notes_sent(repo):
    """Which cards' marks have already been handed to the tutor.

    Kept beside `load_notes` rather than folded into it because the shape of
    `notes` is a contract with `Annotate.load`, and widening it there would mean
    every mark on the board arriving in a new shape for the sake of one boolean.
    """
    out = {}
    try:
        names = sorted(os.listdir(repo.notes))
    except OSError:
        return out
    for name in names:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(repo.notes, name), "r", encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        if rec.get("card"):
            out[rec["card"]] = bool(rec.get("sent"))
    return out


def load_notes(repo):
    """Every card's annotations, so a reload does not lose what was marked up."""
    out = {}
    try:
        names = sorted(os.listdir(repo.notes))
    except OSError:
        return out
    for name in names:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(repo.notes, name), "r", encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        if rec.get("card"):
            out[rec["card"]] = rec.get("strokes") or []
    return out


def load_text_drafts(repo):
    """Typed answers in progress, keyed by the question they answer.

    The slate keeps a page per question so going back to an earlier one does not
    lose the working on it. A typed answer needs the same: the sentence you were
    half way through when the tutor asked something else is still yours.
    """
    out = {}
    try:
        names = sorted(os.listdir(repo.text))
    except OSError:
        return out
    for name in names:
        if not name.endswith(".txt"):
            continue
        qid = name[:-4]
        if not re.match(r"^\d{1,4}$", qid):
            continue
        try:
            with open(os.path.join(repo.text, name), "r", encoding="utf-8") as fh:
                out[qid] = fh.read()
        except OSError:
            continue
    return out


# Whether this repository has work that is not committed. Asked on every poll,
# answered from a cache: `git status` on a network filesystem is not something to
# run four times a second, and the answer does not change that fast.
