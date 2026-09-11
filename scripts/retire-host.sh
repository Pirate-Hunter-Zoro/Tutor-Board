#!/usr/bin/env bash
# ===========================================================================
#  retire-host.sh -- take the board off a machine that is not coming back, on
#  a machine nobody can log in to.
#
#      bash scripts/retire-host.sh            do it, if this is that machine
#      bash scripts/retire-host.sh --report    say what it would do, touch
#                                              nothing
#
#  This is the only thing in this repository that deletes somebody's files, so
#  the gate comes before anything else and it is three conditions wide. It acts
#  ONLY on a machine that is:
#
#    * macOS, and
#    * registered as a permanently-supervised board host -- a `follow` block in
#      its own config, or one of the `com.tutorboard.*` launch agents on disk --
#      which is a thing you have to have installed deliberately, and
#    * not a cluster node (Slurm does not answer here).
#
#  Anything else exits 0 having done nothing, silently, because this runs from
#  a timer on every machine that pulls this repository. `TUTOR_NO_RETIRE=1`
#  turns it off outright.
#
#  It exits **9** when it has actually retired the machine, and the caller has to
#  stop there: everything after it in a round would be putting back what this
#  just took away -- a timer pointing at a script that no longer exists, a walk
#  over a courses directory that is gone.
#
#  Why it exists at all: the machine being retired is the one machine that
#  cannot be reached from where this is written -- no remote login, and it is
#  the only thing behind its own address. The one channel that does reach it is
#  the timer that pulls this repository every few minutes, so the instruction
#  has to arrive the same way a fix does. It pushes its committed work first,
#  because a clone is not a backup and this is not reversible.
#
#  It leaves NOTHING behind, including no account of itself. Everything it says
#  goes to the caller's log, and that log is one of the things it deletes -- so
#  the last thing to go is the evidence that any of this was ever here. A
#  receipt would be a file somebody has to find and delete later, which is the
#  thing being abolished.
# ===========================================================================
set -uo pipefail

REPORT=0
[ "${1:-}" = "--report" ] && REPORT=1

HERE="${TUTOR_RETIRE_TOOL:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LABELS="com.tutorboard.current com.tutorboard.follow com.tutorboard.resume
        com.tutorboard.pull com.tutorboard.headless"
AGENTS="$HOME/Library/LaunchAgents"

# --------------------------------------------------------------------- the gate
[ -n "${TUTOR_NO_RETIRE:-}" ] && exit 0
[ "$(uname -s)" = "Darwin" ] || exit 0
command -v squeue >/dev/null 2>&1 && exit 0      # a cluster node is not this

supervised=0
for l in $LABELS; do
  [ -f "$AGENTS/$l.plist" ] && supervised=1
done
if [ "$supervised" -eq 0 ]; then
  python3 - <<'PY' || exit 0
import json, os, sys
p = os.path.expanduser("~/.config/tutor-board/config.json")
try:
    with open(p, encoding="utf-8") as fh:
        cfg = json.load(fh) or {}
except (OSError, ValueError):
    sys.exit(1)
sys.exit(0 if cfg.get("follow") else 1)
PY
fi

# ------------------------------------------------------------------ re-entrancy
#
# It deletes the directory it is running from, and bash reads a script as it
# goes -- so from here on it runs from a copy somewhere else. The environment
# carries where the original was, since that is one of the things to remove.
if [ -z "${TUTOR_RETIRE_DETACHED:-}" ] && [ "$REPORT" -eq 0 ]; then
  tmp="$(mktemp -d)" || exit 0
  cp "${BASH_SOURCE[0]}" "$tmp/retire.sh" || exit 0
  TUTOR_RETIRE_DETACHED=1 TUTOR_RETIRE_TOOL="$HERE" \
    exec bash "$tmp/retire.sh"
fi

# Said to the caller and nowhere else. Whatever is reading this is reading a log
# that is itself on the list below.
say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
doing() { [ "$REPORT" -eq 0 ]; }

say "retiring this machine as a board host"
[ "$REPORT" -eq 1 ] && say "(--report: nothing below is actually done)"

# ------------------------------------------------- the work, before the deleting
#
# Committed work that never reached origin is the only thing here that cannot be
# got back, so it goes first and it is best-effort: a push that fails is
# reported and does not stop the rest, because a machine half-retired is worse
# than one retired with a line in the log about a branch that would not push.
COURSES="$(python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.config/tutor-board/config.json")
try:
    with open(p, encoding="utf-8") as fh:
        cfg = json.load(fh) or {}
except (OSError, ValueError):
    cfg = {}
print(cfg.get("courses_dir") or os.path.expanduser("~/Learning"))
PY
)"
say "courses: $COURSES"
for dir in "$COURSES"/*/ "$HOME"/Learning/*/; do
  root="${dir%/}"
  [ -d "$root/.git" ] || continue
  name="$(basename "$root")"
  branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  [ -n "$branch" ] || continue
  if ! git -C "$root" rev-parse --verify --quiet "origin/$branch" >/dev/null 2>&1; then
    say "  $name: no origin/$branch — nothing to push to"
    continue
  fi
  ahead="$(git -C "$root" rev-list --count "origin/$branch..HEAD" 2>/dev/null)"
  dirty="$(git -C "$root" status --porcelain 2>/dev/null | head -1)"
  if [ "${ahead:-0}" = "0" ]; then
    say "  $name: already on origin${dirty:+ (uncommitted changes are NOT kept)}"
    continue
  fi
  if doing && git -C "$root" push --quiet origin "$branch" 2>/dev/null; then
    say "  $name: pushed $ahead commit(s)"
  else
    say "  $name: COULD NOT PUSH $ahead commit(s) — they go with the directory"
  fi
done

# ------------------------------------------------------------- stop the machinery
say "the launch agents"
for l in $LABELS; do
  p="$AGENTS/$l.plist"
  if [ -f "$p" ] || launchctl print "gui/$(id -u)/$l" >/dev/null 2>&1; then
    say "  $l"
    if doing; then
      launchctl bootout "gui/$(id -u)/$l" >/dev/null 2>&1
      launchctl unload "$p" >/dev/null 2>&1
      rm -f "$p"
    fi
  fi
done

say "the processes"
for pat in "serve.py --root" "bin/tutor headless" "bin/follow" "tutorboard"; do
  if pgrep -f -u "$(id -u)" "$pat" >/dev/null 2>&1; then
    say "  $pat"
    doing && pkill -f -u "$(id -u)" "$pat" >/dev/null 2>&1
  fi
done

# The tailnet name this machine was serving the board on. Only the board's own
# HTTPS proxy is taken down; whether this machine stays on the tailnet at all is
# not a question a script gets to answer.
if command -v tailscale >/dev/null 2>&1; then
  say "the board's tailscale serve"
  doing && tailscale serve --https=443 off >/dev/null 2>&1
fi

# The two commands `install.sh` put on the path. `-ef` rather than a name match:
# the question is whether the link points at THIS clone's command, and it has to
# be asked while the clone is still there for it to point at. Something else
# called `board` on somebody's path is not ours to remove.
say "the commands"
for c in board tutor; do
  link="$HOME/.local/bin/$c"
  if [ -L "$link" ] && [ "$link" -ef "$HERE/bin/$c" ]; then
    say "  $link"
    doing && rm -f "$link"
  fi
done

# ------------------------------------------------------------------ the deleting
rm_safe() {   # rm_safe <path> <why>
  local path="$1" why="$2" real
  [ -e "$path" ] || return 0
  real="$(cd "$path" 2>/dev/null && pwd -P)" || real=""
  # Never the home directory itself, never anything outside it, never the root
  # of anything. A courses_dir of "~" would otherwise read as "delete $HOME".
  case "$real" in
    "$HOME"/?*) : ;;
    *) say "  REFUSED $path ($why): not a directory inside $HOME"; return 0 ;;
  esac
  say "  $path ($why)"
  doing && rm -rf "$path"
}

say "the directories"
rm_safe "$HOME/Learning" "the courses"
[ "$COURSES" != "$HOME/Learning" ] && rm_safe "$COURSES" "the courses directory"
# The clone this script came out of, last: a git repository with the tool's own
# remote, and nothing else.
if git -C "$HERE" remote get-url origin 2>/dev/null | grep -qi 'tutor-board'; then
  rm_safe "$HERE" "the tool"
else
  say "  left $HERE alone: it is not a Tutor-Board clone"
fi
rm_safe "$HOME/.config/tutor-board" "the tool's config"
rm_safe "$HOME/.local/state/tutor-board" "the tool's state"

# And every account of any of it, this script's own included. Last, so that
# everything above it has somewhere to be said while it is happening.
say "the logs, and anything that ever said this machine was a board host"
if doing; then
  rm -f "$HOME"/Library/Logs/tutor-*.log "$HOME/.tutor-current.json" \
        "$HOME/.tutor-resume.log" "$HOME/tutor-board-removed.log" \
        "$HOME/.tutor-resume."*.lock 2>/dev/null
fi

if doing; then
  say "done. This machine no longer runs a board."
  # 9, not 0: the caller must stop rather than carry on re-asserting a timer for
  # a machine that has just stopped being a board host.
  exit 9
fi
say "that is what it would do. Nothing was changed."
exit 0
