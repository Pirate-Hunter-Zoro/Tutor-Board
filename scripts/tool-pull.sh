#!/usr/bin/env bash
# ===========================================================================
#  tool-pull.sh -- keep this repository, and the proxy running out of it,
#  current on a machine that is always on.
#
#  The pull on its own was not enough. `bin/follow` is a long-lived process that
#  read its code once, when launchd started it, so pulling a fix to the proxy put
#  the new file on disk beside an old process and changed nothing at all -- the
#  same way a board holds the `serve.py` it started with. That is invisible from
#  the outside and it is exactly the shape of bug this repository keeps relearning.
#
#  So: pull, and if the pull actually moved HEAD, restart the follower.
#
#  Boards are deliberately NOT restarted here. A board is somebody's lesson, and
#  bouncing one because a commit landed on another machine is a decision for
#  `tutor restart`, made by a person who knows whether anybody is mid-proof.
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

# The follower is the half that has to match the other machine: it derives the
# ports a course serves on and reads the choice a board publishes, so a stale one
# looks for boards where they are no longer and quietly serves the local warm
# board instead of the compute node.
if [ "$(uname -s)" = "Darwin" ]; then
  LABEL="com.tutorboard.follow"
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/$LABEL" \
      && echo "  restarted $LABEL on the new code" \
      || echo "  could not restart $LABEL; it is still on the old code" >&2
  fi
fi
