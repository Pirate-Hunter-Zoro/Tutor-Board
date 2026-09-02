"""review.py -- what a test review is held over.

A test review is revision. The student says what the test covers, and the tutor
asks questions over exactly that, in the shape a homework problem is taught in:
state it, they write it out by hand, it comes back reviewed. So the only thing
this module owns is the list of things that can be named, and the rule that a
name arriving from the board is checked against that list before it reaches
anything -- the same discipline `homework.py` applies to a set name.

Two kinds of repository, two lists, and neither of them is invented:

    a course      its chapters -- `chapters.tsv` or `chapters/chNN-*/`, via syllabus
    a project     its own top-level parts, which is what a project has instead

A code repository has no chapters and is not told it is broken. What you revise
there is a part of the repository, and the repository already says what its parts
are by being made of them. Nothing is registered in either case.

The scope is a *list*, because a test is not one chapter. Everything downstream
of that -- the strip on the board, the sitting label, the line the tutor is woken
with -- takes the list and never a single name.

Standard library only, like everything else.
"""

import os

from . import syllabus

# What is not a part of a project. Build output, dependencies, the board's own
# working directory, and anything hidden: none of them is a thing to be asked
# questions about, and offering them is offering a choice nobody would make.
IGNORE = {
    "live", "node_modules", "__pycache__", "build", "dist", "target",
    "venv", ".venv", "env", "site-packages", "archive", "uploads",
    "answers", "logs", "tmp", "out", "coverage", "vendor", "textbook",
}

# A test is not held over forty things, and a picker on a tablet is not a
# scrolling list of them either.
MAX_UNITS = 60


def parts(root):
    """The top-level pieces of a project, in the order a directory listing gives.

    Directories first, because that is what "part of the project" means in
    anything organised at all. A flat repository -- a handful of scripts and no
    folders -- falls back to its own top-level source files rather than offering
    nothing, because a review over nothing is not a sitting.
    """
    out = []
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return out
    for name in names:
        if name.startswith(".") or name in IGNORE:
            continue
        if os.path.isdir(os.path.join(root, name)):
            out.append({"name": name, "label": name + "/", "short": name,
                        "kind": "part"})
    if out:
        return out[:MAX_UNITS]
    for name in names:
        if name.startswith(".") or name in IGNORE:
            continue
        path = os.path.join(root, name)
        if os.path.isfile(path) and not name.endswith((".md", ".txt", ".json",
                                                       ".lock", ".log")):
            out.append({"name": name, "label": name, "short": name,
                        "kind": "part"})
    return out[:MAX_UNITS]


def chapters(root):
    """The course's own chapters, as things a review can be held over."""
    out = []
    for c in syllabus.chapters(root):
        full = syllabus.label(c)
        if not full:
            continue
        num = str(c.get("num") or "").strip()
        out.append({"name": full, "label": full,
                    "short": ("Ch %s" % num) if num else full,
                    "kind": "chapter"})
    return out[:MAX_UNITS]


def units(root):
    """Everything this repository can be reviewed over.

    Chapters if it is a book, its own parts if it is a project. The same
    discovery rule as everywhere else: whichever the repository actually has,
    and never both, because a course whose chapters are sitting right there
    should not be offered its `latex/` directory as a thing to revise.
    """
    return chapters(root) or parts(root)


def kind(root):
    """`chapters`, `parts`, or nothing at all to review."""
    every = units(root)
    return every[0]["kind"] + "s" if every else ""


def resolve(root, wanted):
    """Match names from a request against what this repository actually has.

    Returns (chosen, unknown). A name that matches nothing is returned rather
    than dropped: silently reviewing three chapters when four were asked for is
    a worse answer than saying which one was not recognised.

    A chapter is matched on its full label, on its short form (`Ch 7`), or on
    its bare number, because the board sends labels and a person at a terminal
    types `ch07` or `7`.
    """
    every = units(root)
    index = {}
    for u in every:
        index.setdefault(u["name"].lower(), u)
        index.setdefault(u["short"].lower(), u)
        index.setdefault(u["label"].lower().rstrip("/"), u)
        if u["kind"] == "chapter" and u["short"].lower().startswith("ch "):
            # `chapters.tsv` writes 07 and the chapter directories write 7, so a
            # course's own two ways of numbering the same chapter both have to
            # find it -- and so does a person typing the bare number.
            num = u["short"][3:].strip().lower()
            forms = {num, "ch" + num}
            if num.isdigit():
                for form in ("%d" % int(num), "%02d" % int(num)):
                    forms.add(form)
                    forms.add("ch" + form)
            for form in forms:
                index.setdefault(form, u)
    chosen, unknown, seen = [], [], set()
    for name in wanted or []:
        key = str(name).strip().lower()
        u = index.get(key)
        if not u:
            unknown.append(name)
            continue
        if u["name"] in seen:
            continue
        seen.add(u["name"])
        chosen.append(u)
    # Back into the repository's own order, not the order they were tapped in:
    # a review runs through a course forwards.
    order = {u["name"]: i for i, u in enumerate(every)}
    chosen.sort(key=lambda u: order.get(u["name"], 0))
    return chosen, unknown


def scope(root, state):
    """What the sitting in front of us is a review of, checked again on the way out.

    Re-resolved rather than trusted: a chapter can be renamed or a directory
    deleted between the sitting being opened and the board asking what it covers,
    and a scope naming something that is no longer there would send the tutor to
    read a file that does not exist.
    """
    chosen, _ = resolve(root, (state or {}).get("review") or [])
    return chosen


def noun(of, n):
    """`3 chapters`, `1 chapter`. A count and a plural that disagree read as a bug."""
    of = of or "chapters"
    return "%d %s" % (n, of[:-1] if n == 1 and of.endswith("s") else of)


def sitting_label(chosen, of="chapters"):
    """What `board open` files this sitting under, and what the badge line reads.

    Short names, because it goes in a title bar next to a course name. Past three
    it stops naming them and counts them instead -- a label is an identifier, not
    the scope itself, and the scope is on the strip underneath.
    """
    if not chosen:
        return "Test review"
    if len(chosen) <= 3:
        return "Test review — " + ", ".join(u["short"] for u in chosen)
    return "Test review — " + noun(of, len(chosen))


def status(root, state):
    """What the board shows, and what the command line prints.

    None when there is nothing in this repository to review at all -- no
    chapters and no parts -- which is a real answer and not an empty list.
    """
    every = units(root)
    if not every:
        return None
    chosen = scope(root, state)
    of = kind(root)
    return {
        "of": of,
        "units": every,
        "scope": [u["name"] for u in chosen],
        "chosen": chosen,
        "total": len(every),
        "label": sitting_label(chosen, of or "chapters"),
    }
