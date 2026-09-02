"""What a turn MEANS, in a sentence the assistant can act on.

In a headless session these strings are the whole prompt. The shape of a
lesson is carried here rather than left to be inferred, because a model handed
a chapter and told to teach writes a lecture every time.
"""

import os

from .course import config, homework, review, syllabus


# arrives at a board with nothing on it and an assistant with no other context.
SIGNAL_SENSE = {
    "begin": "there is nothing on the board yet and they are waiting. "
             "Open the session and write the first card.",
    # The lecture and test-review reading. A homework sitting means something
    # different by the same tap and gets its own sentence -- see `skip_sense`.
    "skip": "they are not writing this one out. Do not re-ask it and do not press "
            "them on it; carry on with the lesson. If it was a hand-check, treat "
            "that idea as known and go to the next one -- or, if it was the last "
            "one, straight to the exercise, restated in full.",
    "done": "their work is ready for you to check.",
    "help": "they are stuck and want help.",
    "confused": "something is not making sense to them.",
}


# The method in one paragraph. In a headless session these strings ARE the whole
# prompt, and the shape is the half that goes wrong -- a model handed a chapter
# and told to teach writes a lecture, every time, because that is what teaching
# looks like in everything it was trained on. So the shape is said outright and
# said first: a lesson is exercises, and explanation that is not something the
# student does is not part of it.
METHOD_SENSE = (
    "Follow live/TEACHING.md, and the rule it all follows from: THE LESSON IS "
    "EXERCISES, not explanation. Never write a card that teaches for four "
    "paragraphs and asks at the bottom. Instead: state the exercise in full so "
    "they can see what it is for, then hand them ONE tiny thing to work "
    "themselves -- you supply the concrete objects, they show what those objects "
    "are (is this one an example, which of these three is not, where does this "
    "one fail) -- one per turn, and only for what the exercise actually needs. "
    "When the last of those is answered or skipped, put the exercise back in "
    "front of them RESTATED IN FULL and ask for it; a reference to it is not a "
    "re-pose. EVERY card that poses a problem is self-contained: under the "
    "statement, list every definition, symbol and named result the problem uses, "
    "one line each, including ones from checks they skipped. They are reading on "
    "a tablet and must never have to scroll back up the lesson to find out what "
    "they are being asked to prove. One question per turn, then stop and wait. "
    "The only thing that counts is exercises answered. "
)


def code_sense(label, stance="teach"):
    """Where a code project says what comes next: its README, and what it points at.

    This is the whole prompt in a headless session, so it carries the shape as
    well as the place -- and the shape is the part that was wrong. A project has
    no chapters, no sections and no exercises, and manufacturing them out of the
    README's structure is the specific failure this exists to prevent: those
    headings describe how the system is built, not an order to learn it in.
    """
    where = ("They are working on %r; start there. " % label) if label else ""
    return (
        "Follow live/TEACHING.md, the code-project half of it. This repository is "
        "a PROJECT, not a course: there are no chapters, no sections and no "
        "exercises, and you must not invent any out of the README's headings.\n\n"
        "Read README.md at the root first. It is the entry point, and it says "
        "where the work is planned -- a task list, a planning document, a "
        "companion repository. Follow that pointer and read what it names: that "
        "is what says what comes next, and it outranks anything you would have "
        "chosen yourself. Read HANDOFF.md too if there is one. If the README "
        "names nothing, or what it names is missing, ask them in your first card "
        "rather than picking an agenda of your own.\n\n"
        + where +
        (
            # The repository has said, in writing, that it wants the work done
            # rather than taught. Nothing else about a turn changes: one card,
            # short, card first, and it still stops and waits.
            "This repository's stance is DO, not teach: you write the code "
            "yourself, run what needs running, and commit when it is right. Do "
            "not withhold an implementation and do not ask them to type it. The "
            "card is a report, not an exercise: what you changed, what it does "
            "now, what you ran and what came back, and the one decision or "
            "check you need from them. Still one card, still short, still "
            "written before the rest of the work."
            if stance == "do" else
            "Then write ONE card saying what to change next: the file, what it "
            "has to do, and how they will know it works. They write the code in "
            "their own editor -- you never write it and never put a solution on "
            "the board. One change per turn, then stop and wait for 'ready to "
            "check'."
        )
    )


def review_sense(repo, st, mode):
    """A test review, in a sentence the assistant can act on.

    A review is not a third way of teaching -- it is the homework loop pointed at
    a scope the student chose instead of at a sheet somebody set. So this says
    the two things that are actually different, and leaves the shape of a turn to
    live/TEACHING.md where it belongs: what the scope is, and that it is not the
    assistant's to widen.

    The chapters are NAMED here rather than left to be looked up. In a headless
    session this string is the whole prompt, and a tutor that has to glob the
    repository to find out what it is reviewing pays a round trip for something
    the board already knew.
    """
    chosen = review.scope(repo.root, st)
    of = review.kind(repo.root) or "chapters"
    project = mode == "code"
    what = "parts of this project" if project else "chapters"
    counted = (review.noun("parts", len(chosen)) + " of this project") \
        if project else review.noun("chapters", len(chosen))

    if not chosen:
        # Reachable from `board open --review` with nothing named. The board's
        # own picker cannot produce it, and inferring a scope is exactly the
        # mistake a homework sitting with no sheet is told not to make.
        return ("Follow live/TEACHING.md. This is a TEST REVIEW sitting and "
                "nothing has been chosen for it to cover. Ask in your first card "
                "which %s the test is over, and do not choose them yourself -- "
                "they know what is on it and you do not." % what)

    named = ", ".join(u["label"] for u in chosen)
    where = (
        "Read those parts of the repository before your first card, then ask "
        "about the code that is already there: what a function does, why it is "
        "written that way, what would break if it changed. This is not a sitting "
        "for setting work -- do not assign a change, and do not write code into a "
        "card even where this repository's stance is to do the work, because a "
        "review asks. "
        if project else
        "Draw each question from those chapters' own exercises where there are "
        "some, and write one in the same style where there are not. "
    )
    return (
        METHOD_SENSE +
        "A review is the one sitting that asks COLD: no hand-checks in front of "
        "the question and nothing taught toward it, because you are finding out "
        "what is not solid. Ladder only from a break, once there is one, and "
        "then re-pose the question in full. "
        "This is a TEST REVIEW over %s, "
        "in this order: %s. "
        "The scope is theirs and is not yours to widen or narrow -- ask over "
        "exactly those and nothing else, and spread the questions across all of "
        "them rather than exhausting the first. A review is for finding what is "
        "not solid yet, so a question they answer cleanly is a question you move "
        "on from. %s"
        "Pose them exactly as a homework problem is posed: state the question in "
        "full in a `question` card, stop, and read what comes back -- locate the "
        "break rather than repairing it. "
        "Nothing is being handed in, so there is no write-up: do not transcribe "
        "into a .tex and do not compile anything. The lesson itself is the record. "
        "Say in your first card what this review covers and which one you are "
        "starting on." % (counted, named, where)
    )


def skip_sense(repo):
    """What a skip means, which depends on what kind of sitting this is.

    In a lecture it means *I have this already*: the concept check is pace
    control, and re-asking a question somebody has waved away teaches nothing.
    That reading was applied everywhere, and in a homework sitting it is wrong
    and expensive -- the problems are not the assistant's to drop. A skipped
    homework problem is a lost mark, and the student skipping it means *not now*,
    not *never*. They are entitled to work the sheet in whatever order they like;
    they are not entitled to have the assistant quietly agree the sheet is
    shorter than it is.

    So in homework the tap defers, and the sentence says what is still owed and
    what to come back to. The list is read off the document rather than the
    conversation, which is what makes it survive a restart, a new tutor, and the
    two hours between the skip and the return.
    """
    st = repo.state()
    if (st.get("session") or "lecture") != "homework":
        return SIGNAL_SENSE["skip"]

    line = ("they are not writing this one out NOW. This is a homework sitting, so "
            "the problem is still assigned and still owed: leave it, carry on with "
            "the rest, and come back to it once the others are done. Do not press "
            "them on it in the meantime, and do not treat it as finished. ")
    try:
        st_hw = homework.status(repo.root, st)
    except Exception:
        st_hw = None
    left = (st_hw or {}).get("outstanding") or []
    if len(left) == 1:
        # The degenerate case, and it is not a paradox: skipping the only thing
        # left means it comes straight back, because there is nothing else to go
        # on with and the sheet is not finished. Say so, or an assistant reading
        # "come back to it once the others are done" concludes the others never
        # will be and drops it.
        line += ("It is also the ONLY problem left on the sheet, so there is "
                 "nothing else to carry on with: ask it again. That is not a "
                 "mistake and it is not pressing them -- the sheet is not done "
                 "until it is done. ")
    elif left:
        line += ("Still to write up, in the sheet's order: %s. The next agreed "
                 "answer goes in %s. " % (", ".join(left), left[0]))
    line += ("They may work the sheet in any order; the document is written in "
             "the sheet's order regardless.")
    return line


def session_sense(repo):
    """What this sitting is, in a sentence an assistant can act on.

    `board open` takes a label -- "Ch 1 -- groups, fields and vector spaces" --
    and it is the only thing on the board that says where a cold start should
    start. If nobody set one, say that too, and say where to look instead: a
    course orders itself somewhere, and guessing is how a course gets opened in
    the middle.
    """
    st = repo.state()
    kind = st.get("session") or "lecture"
    chapter = (st.get("chapter") or "").strip()

    # A code repository is a PROJECT, and everything below this is written for a
    # course that follows a book. Without this branch it fell through to the last
    # case, which tells the assistant to "begin at the beginning of the course as
    # the repository itself orders it, and say in your first card which chapter
    # you are opening" -- so it dutifully invented chapters out of the README's
    # section headings and opened "Chapter 1". There are no chapters in a
    # project. There is a README, and the README says where the work is planned.
    cfg_here = config.read_config(repo.root)
    # A test review is the one sitting that reads the same in both kinds of
    # repository, so it is settled before the project branch rather than inside
    # it: a project being revised is being asked questions, not set work, and
    # falling through to code_sense would have told it to go and find the next
    # change instead.
    if kind == "review":
        return review_sense(repo, st, cfg_here.get("mode"))
    if cfg_here.get("mode") == "code":
        return code_sense(chapter, cfg_here.get("stance"))
    # In a headless session this line is the whole prompt, so it has to carry the
    # pointer to the method as well as the pointer to the place.
    how = (METHOD_SENSE if kind == "homework" else
           METHOD_SENSE + "Read the section's exercises before you teach anything "
           "and choose a manageable few -- three to five -- saying which and why "
           "in your first card. ")
    if kind == "homework":
        st_hw = homework.status(repo.root, st)
        if st_hw and st_hw.get("name"):
            sheet = st_hw.get("assignment") or []
            where = ("The assignment sheet is at %s -- read it and do exactly the "
                     "problems it assigns, all of them, in order." % sheet[0]) if sheet else (
                     "No assignment sheet is filed under %s; ask which problems are "
                     "assigned before teaching anything." % os.path.dirname(st_hw["rel"]))
            return (how + "This is a HOMEWORK sitting on %s (%s). The problems are "
                    "assigned, not yours to choose. %s Transcribe each statement "
                    "before you teach it." % (st_hw["name"], st_hw["rel"], where))

    if chapter:
        return (how + "This sitting is labelled %r and it is a %s. Start there."
                % (chapter, kind))
    # A course that follows a book says so on disk. Naming its actual first
    # chapter beats telling an assistant to work it out, which is what produced
    # a Galois course opened at field extensions -- chapter four.
    first = syllabus.opening(repo.root)
    if first:
        every = syllabus.chapters(repo.root)
        return (how + "This sitting is a %s and carries no chapter label. This course "
                "follows a book and orders itself in %d chapters; the first is "
                "%s. Open there unless HANDOFF.md says otherwise, and name the "
                "chapter you are opening in your first card. Do not start from "
                "whatever you consider the foundation of the subject -- start "
                "where the book starts."
                % (kind, len(every), syllabus.label(first)))
    return (how + "This sitting is a %s and carries no chapter label, so nothing here "
            "says where to start. Do not guess from the subject: begin at the "
            "beginning of the course as the repository itself orders it, and say "
            "in your first card which chapter you are opening." % kind)
