"""Tutor-Board: a live board for tutoring sessions.

The package is organised by WHAT A THING IS ABOUT, because that is the question
somebody actually has when they arrive: not "where does this function live" but
"where is the code that decides which machine serves the address".

    paths, ports, choice        what this machine knows about itself
    machine, processes, tex     what this machine IS, and what is alive on it
    net/                        reaching the other machine: tailscale, socks,
                                asking a board what it is, getting out to a model
    limits, reasoning, handoff  what a model said, what it may not say, and what
                                it leaves behind
    course/                     a course on disk: its config, its documents,
                                its homework, its chapters
    lesson/                     what is on the board right now: cards, turns,
                                answers, the slate, the archive
    server/                     the HTTP board itself, and its routes
    cli/                        the commands: board, tutor, follow, free

Standard library only, everywhere. A board runs on a compute node with no
package manager and no right to install one.
"""

__all__ = []
