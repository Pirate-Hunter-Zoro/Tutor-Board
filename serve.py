#!/usr/bin/env python3
"""The board, as a process.

    python3 serve.py --root <course> --port <n>

This file is four lines of dispatch on purpose. It used to be the whole board --
two thousand eight hundred lines of repository paths, card parsing, turn
bookkeeping, prompts, machine discovery, a TikZ compiler, an SSE hub and nine
hundred lines of HTTP routing, in one module. It is now `tutorboard/`, and this
is the entry point.

It keeps its name and its command line because a board is a long-lived process
identified BY that command line: `board_is_running` matches it, `tutor restart`
looks for it, and the record in `live/.board.json` points at it. Renaming this
file would orphan every board already running.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))

from tutorboard.server.app import main            # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
