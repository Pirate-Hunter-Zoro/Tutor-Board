#!/usr/bin/env bash
# ===========================================================================
#  tool-pull.sh -- keep this repository, and the processes running out of it,
#  current on a machine that is always on.
#
#  The pull on its own was not enough, twice over.
#
#  `bin/follow` is a long-lived process that read its code once, when launchd
#  started it, so pulling a fix to the proxy put the new file on disk beside an
#  old process and changed nothing at all. That was the first version of this
#  script's discovery, and it is the same one a board makes about `serve.py`.
#
#  The second is that a board makes it too, and this script used to leave boards
#  alone on purpose -- the argument being that bouncing somebody's lesson because
#  a commit landed elsewhere was a person's decision. In practice nobody ever
#  made that decision, so a fix shipped from the compute node reached the Mac's
#  disk and never reached the lesson: the pages are served from disk and look new
#  while the endpoints behind them are the old ones. `scripts/ship.sh` bounces
#  boards and tutors on the machine a change is written on, and the machine that
#  receives the change has to do the same or the change is not shipped, it is
#  merely stored.
#
#  So: pull, and if the pull actually moved HEAD, put this machine on the code
#  that arrived. `tutor restart --tutors` owns what is safe to touch -- only
#  boards answering on this node, the proxy, and never a tutor mid-turn.
#
#      bash scripts/tool-pull.sh
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE" || { echo "cannot enter $HERE" >&2; exit 1; }

before="$(git rev-parse HEAD 2>/dev/null)"

# --ff-only, never fatal: no remote, no network, or a diverged branch says so in
# one line and the machine carries on serving what it has.
if ! out="$(git pull --ff-only 2>&1)"; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') pull did not run: $(printf '%s' "$out" | tail -1)"
  exit 0
fi

after="$(git rev-parse HEAD 2>/dev/null)"
if [ "$before" = "$after" ]; then
  exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') pulled ${before:0:8} -> ${after:0:8}"

# One implementation of "put this machine on the new code", in `bin/tutor`, so
# this script and `tutor resume` cannot drift apart about what gets bounced.
python3 "$HERE/bin/tutor" restart --tutors 2>&1 | sed 's/^/  /'
