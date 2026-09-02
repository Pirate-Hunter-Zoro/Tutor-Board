"""A past lesson, kept.

Every section is archived when the next one opens, so there is never a reason
to hurry one to a conclusion. The student's own working is in there too.
"""

import json
import os

from . import cards, turns


def list_archive(repo):
    """Every finished lesson, newest first, as something to pick from."""
    out = []
    try:
        names = sorted(os.listdir(repo.archive), reverse=True)
    except OSError:
        return out
    for name in names:
        folder = os.path.join(repo.archive, name)
        if not os.path.isdir(folder):
            continue
        st = {}
        try:
            with open(os.path.join(folder, "state.json"), "r", encoding="utf-8") as fh:
                st = json.load(fh) or {}
        except (OSError, ValueError):
            pass
        in_it = [n for n in os.listdir(folder) if cards.CARD_RE.match(n)]
        answers = turns.load_turns(repo, os.path.join(folder, "turns.jsonl"))
        out.append({
            "id": name,
            "course": st.get("course") or "",
            "chapter": st.get("chapter") or "",
            "session": st.get("session") or "lecture",
            "opened": st.get("opened") or "",
            "finished": st.get("finished") or "",
            "cards": len(in_it),
            "turns": len(answers),
        })
    return out


def archived_session(repo, name):
    """One past lesson, rendered the same way a live one is."""
    folder = os.path.join(repo.archive, name)
    st = {}
    try:
        with open(os.path.join(folder, "state.json"), "r", encoding="utf-8") as fh:
            st = json.load(fh) or {}
    except (OSError, ValueError):
        pass
    jobs = []
    saved_cards, repo.cards = repo.cards, folder
    try:
        in_it = cards.load_cards(repo, jobs)
    finally:
        repo.cards = saved_cards
    answers = turns.load_turns(repo, os.path.join(folder, "turns.jsonl"))
    # Their frozen ink lives inside the archived folder now, so the transcript
    # keeps working after the live answers directory has moved on.
    for t in answers:
        for key in ("png", "ink"):
            if t.get(key, "").startswith("/answers/"):
                t[key] = "/archive/%s/answers/%s" % (name, t[key][len("/answers/"):])
    return {"id": name, "state": st, "cards": in_it, "turns": answers,
            "archived": True}
