"""Everything a cold turn has to know, in one call.

Every turn is a cold turn now, so what a cold start costs is what the course
costs. It used to cost three whole documents: `AI_INSTRUCTIONS.md` (9.1k
tokens in Galois Theory), `live/TEACHING.md` (9.5k) and `HANDOFF.md` (5.4k,
against a documented cap of 350 words), read in three round trips before a word
of teaching was written -- and on a resumed session they then sat in the
conversation for the rest of the evening.

None of that is what a turn actually uses. What it uses is: the method, which
`tutorboard.sense` already states in a paragraph because the board's own
begin-card needs it; the rules of this course that do not bend; where the
student got to; and what the last turn was thinking. That is this file, it is
one round trip, and it is about a tenth the size.

The full documents stay on disk and are named at the bottom of the briefing.
A rule that needs its detail is one grep away, which is the right price for
something a turn needs occasionally and the wrong price for something it needs
never.
"""

import os
import re

from . import carry, handoff
from .course import config


CONTRACT = "AI_INSTRUCTIONS.md"
METHOD = os.path.join("live", "TEACHING.md")

# The one section of a course's contract that every single turn is bound by.
# A contract is a long document written for a person reading it once; this is
# the part of it that decides what a turn may and may not do, and it is the
# only part worth paying for on every turn.
RULES_HEADING = re.compile(r"^(#{1,6})\s*(.*rules that do not bend.*)$",
                           re.IGNORECASE)

# The mechanics of a turn, which changed when a turn became its own session.
# This lives here rather than in `tutorboard.sense` because a turn is the only
# thing that reads the briefing: the method is the same for a person at a
# terminal, the machinery is not.
TURN_SENSE = (
    "This turn is its own session. Nothing you are holding now survives it -- "
    "not the cards, not this briefing, not what you worked out about their "
    "answer. Two things follow.\n"
    "- **Leave a note before you finish**: `board note`, at most 120 words on "
    "stdin, on what you actually READ in their answer and the one thing you are "
    "aiming at next. The lesson is on disk and `board recap` reads it back; your "
    "reading of the lesson is not, and the note is the only place it goes.\n"
    "- **Do not wait, and do not write the handoff.** `board wait` is the "
    "daemon's, not the turn's -- it is already blocked on the student's next "
    "message and will hand it to a fresh turn. `HANDOFF.md` belongs to the "
    "wrap-up turn at the end of the session, which writes it with `board "
    "handoff`; a teaching turn that edits it pays to read it first.\n"
    "Both of those refuse now rather than costing money quietly."
)


def _section(text, pattern):
    """A named section of a markdown document, heading included.

    Ends at the next heading of the same level or shallower, which is what a
    reader means by "that section" and is not what a naive scan to the next `#`
    gives you.
    """
    lines = text.splitlines()
    start = depth = None
    for i, line in enumerate(lines):
        m = pattern.match(line)
        if m:
            start, depth = i, len(m.group(1))
            break
    if start is None:
        return ""
    out = [lines[start]]
    for line in lines[start + 1:]:
        m = re.match(r"^(#{1,6})\s", line)
        if m and len(m.group(1)) <= depth:
            break
        out.append(line)
    return "\n".join(out).strip()


def contract_rules(root):
    """This course's non-negotiables, or "" if it does not name any."""
    try:
        with open(os.path.join(root, CONTRACT), "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return ""
    return _section(text, RULES_HEADING)


def contract_map(root):
    """The contract's top-level sections, one line each.

    Not the contract -- a map of it, so a turn that genuinely needs a rule's
    detail knows which section to open instead of reading the file or grepping
    around in it. Top level only: the `###` headings triple the size of this for
    something a turn reads and does not act on.
    """
    try:
        with open(os.path.join(root, CONTRACT), "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return []
    return [re.sub(r"^##\s+", "", l).strip()
            for l in text.splitlines() if re.match(r"^##\s+\S", l)]


def briefing(repo, sense, chapter=None):
    """The whole cold briefing as one string.

    `sense` is `tutorboard.sense`, passed in rather than imported, because it
    reaches into the course package for the syllabus and the homework sheet and
    this module is imported by things that have already paid for that.
    """
    root = repo.root
    st = repo.state()
    chapter = chapter if chapter is not None else (st.get("chapter") or "")
    out = []

    head = " — ".join(x for x in (st.get("course"), st.get("session"),
                                  st.get("chapter")) if x)
    out.append(head or "no session open")
    if st.get("hw"):
        out.append("homework set: %s" % st["hw"])
    stance = (config.read_config(root).get("stance") or "teach")
    out.append("stance: %s" % stance)

    out.append("\n--- the method, and what this sitting is ---\n"
               + sense.session_sense(repo))

    rules = contract_rules(root)
    if rules:
        out.append("\n--- %s: the rules that do not bend ---\n%s" % (CONTRACT, rules))

    # The handoff, under the same chapter test the cold prompt used to apply.
    # A handoff about a chapter the student has closed is parked as a side
    # effect of asking, which is why this is asked here and not guessed.
    if handoff.handoff_applies(root, chapter):
        text, _ = handoff.read_handoff(root)
        n = carry.word_count(text)
        out.append("\n--- HANDOFF.md, from the last session (%d words) ---\n%s"
                   % (n, text.strip()))
        if n > handoff.HANDOFF_WORDS:
            out.append("\n[this handoff is %d words over its %d-word cap. It is read "
                       "at the start of every turn, so the next one you write with "
                       "`board handoff` must be inside the cap.]"
                       % (n - handoff.HANDOFF_WORDS, handoff.HANDOFF_WORDS))
    else:
        out.append("\n--- HANDOFF.md ---\nThere is no handoff for this chapter, and "
                   "that is deliberate: a chapter is its own thing and what was left "
                   "unfinished in an earlier one is not this chapter's business. Do "
                   "not go looking for it -- not in live/archive/, not in "
                   "live/handoffs/, not in an older chapter's write-up.")

    note = carry.read_note(root)
    if note:
        out.append("\n--- NEXT.md, from the turn just before this one ---\n" + note)
    else:
        out.append("\n--- NEXT.md ---\nnothing left by a previous turn (this is the "
                   "first turn of the lesson, or the last one left no note)")

    out.append("\n--- how a turn works here ---\n" + TURN_SENSE)

    sections = contract_map(root)
    out.append("\n--- if a rule needs its detail ---\n"
               "%s and %s are on disk. Open the ONE section you need; do not read "
               "either file. %s's sections: %s"
               % (CONTRACT, METHOD, CONTRACT,
                  "; ".join(sections) if sections else "(none found)"))
    return "\n".join(out) + "\n"
