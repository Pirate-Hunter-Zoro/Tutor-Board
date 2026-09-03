#!/usr/bin/env bash
# ===========================================================================
#  catch-up.sh -- put THIS machine right, in one command, and then say what is
#  actually true rather than what should be.
#
#      bash scripts/catch-up.sh              catch up and restart
#      bash scripts/catch-up.sh --tidy       ...and stop boards for courses
#                                            with nothing in them
#      bash scripts/catch-up.sh --report     change nothing; just say where
#                                            everything is
#
#  Written for the Mac mini, which is the machine that cannot be reached from
#  the compute node's session -- so every fix shipped from over there sits on
#  disk here until something restarts the processes holding the old code. That
#  is three kinds of process and two kinds of repository, and remembering the
#  list is not somebody's job:
#
#    1. the tool, which every process reads once at startup;
#    2. the course repositories, which hold the lessons;
#    3. the boards, the tutors and the follower, which are long-lived.
#
#  It is machine-agnostic on purpose. Run it on either host; it works out what
#  this one is.
#
#  Nothing here destroys work that is not already pushed, and as of 2026-09-03
#  that is true rather than merely intended:
#
#    * A repository already sitting on origin is LEFT ALONE, uncommitted work
#      and all. It has nothing to catch up to, so there is nothing to put right.
#    * A repository that does have to move gets its uncommitted work STASHED
#      first -- `git stash list` names it, `git stash pop` is the way back.
#    * A repository holding commits origin does not have is TAGGED before it is
#      reset, so `git reset --hard <tag>` brings those commits back.
#
#  The three used to be one branch, and it reset anything DIRTY. A repository
#  sitting exactly on origin with somebody's afternoon in the working tree took
#  that branch: the tag was placed at HEAD, which already was origin, so it
#  preserved nothing, and the reset threw the afternoon away to move the
#  repository nowhere. That is what these three cases exist to keep apart.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The courses are this repository's siblings. TUTORBOARD_COURSES overrides that
# for the test, which needs a tree of its own: what the course loop DOES to a
# repository is the part of this script worth testing, and it cannot be tested
# against the real home without doing it to the real home.
COURSES="${TUTORBOARD_COURSES:-$(dirname "$HERE")}"
TUTOR="$HERE/bin/tutor"
BOARD="$HERE/bin/board"

TIDY=0
REPORT=0
COURSES_ONLY=0
for a in "$@"; do
  case "$a" in
    --tidy)   TIDY=1 ;;
    --report) REPORT=1 ;;
    # Just the course loop: no pulling the tool, no restarting anything. The
    # test uses it; a person has no reason to.
    --courses-only) COURSES_ONLY=1 ;;
    -h|--help) sed -n '3,12p' "${BASH_SOURCE[0]}" | sed 's/^#  \{0,1\}//'; exit 0 ;;
  esac
done

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
line() { printf '   %s\n' "$*"; }

# ------------------------------------------------------------------ the log
# What ran this, and where from. It exists because a round of this script reset
# two repositories that nobody present could account for, and working out what
# had invoked it took longer than fixing what it did. One block per run,
# appended, naming the host and the whole parent chain.
CATCHUP_LOG="${TUTORBOARD_CATCHUP_LOG:-$HOME/.tutorboard-catch-up.log}"
{
  printf '%s  host=%s  pid=%s  args=%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$(hostname -s 2>/dev/null)" "$$" "${*:-none}"
  _p="${PPID:-0}"
  while [ "${_p:-0}" -gt 1 ]; do
    printf '    <- %-8s %s\n' "$_p" "$(ps -o args= -p "$_p" 2>/dev/null | head -c 200)"
    _p="$(ps -o ppid= -p "$_p" 2>/dev/null | tr -d ' ')"
  done
} >> "$CATCHUP_LOG" 2>/dev/null

# ---------------------------------------------------------------- the tool
if [ "$REPORT" -eq 0 ] && [ "$COURSES_ONLY" -eq 0 ]; then
  say "the tool"
  before="$(git -C "$HERE" rev-parse HEAD 2>/dev/null)"
  if out="$(git -C "$HERE" pull --ff-only 2>&1)"; then
    after="$(git -C "$HERE" rev-parse HEAD 2>/dev/null)"
    if [ "$before" != "$after" ]; then
      line "pulled $(git -C "$HERE" rev-list --count "$before".."$after") commit(s)"
      # Everything below reads this repository, so run it again on what arrived.
      line "re-running on the code that just landed"
      exec bash "$HERE/scripts/catch-up.sh" "$@"
    fi
    line "already current"
  else
    line "COULD NOT PULL THE TOOL — fix this first, everything else depends on it:"
    printf '%s\n' "$out" | sed 's/^/     /'
    exit 1
  fi
fi

# --------------------------------------------------------- the course repos
if [ "$REPORT" -eq 0 ]; then
  say "the courses"
  for dir in "$COURSES"/*/; do
    root="${dir%/}"
    [ -d "$root/.git" ] || continue
    # Never this repository. It holds an AI_INSTRUCTIONS.md like every course
    # does, so the test below would happily have taken it for one and reset it --
    # over the top of whatever was being worked on. Compared by realpath, because
    # this home is reachable under two names and a string comparison misses.
    if [ "$(cd "$root" && pwd -P)" = "$(cd "$HERE" && pwd -P)" ]; then
      continue
    fi
    # A course repository, by the same test the board uses.
    if [ ! -f "$root/tutorboard.json" ] && [ ! -f "$root/AI_INSTRUCTIONS.md" ] \
       && [ ! -d "$root/live" ]; then
      continue
    fi
    name="$(basename "$root")"
    git -C "$root" fetch --quiet origin 2>/dev/null
    branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    [ -z "$branch" ] && { line "$name: no branch checked out, skipped"; continue; }
    if ! git -C "$root" rev-parse --verify --quiet "origin/$branch" >/dev/null; then
      line "$name: no origin/$branch, left alone"
      continue
    fi
    # What is actually dirty, not counting the board's own scratch. A running
    # board writes into `live/` continuously and none of it is work anybody
    # meant to keep, so counting it made every course with a board on it look
    # like it needed rescuing.
    dirty="$(git -C "$root" status --porcelain 2>/dev/null | grep -v '^.. live/' || true)"

    # Two ancestry questions, asked once and named, because the old single
    # condition conflated "has work in the tree" with "is in the wrong place".
    ahead=0; behind=0
    git -C "$root" merge-base --is-ancestor HEAD "origin/$branch" 2>/dev/null || ahead=1
    git -C "$root" merge-base --is-ancestor "origin/$branch" HEAD 2>/dev/null || behind=1

    # CASE 1: nothing to catch up to. This is the one that used to destroy
    # work. A repository sitting exactly on origin is already right, and there
    # is no version of putting a machine right that involves deleting work from
    # a machine that is already right.
    if [ "$ahead" -eq 0 ] && [ "$behind" -eq 0 ]; then
      if [ -n "$dirty" ]; then
        line "$name: current, with uncommitted work left where it is"
      else
        line "$name: current"
      fi
      continue
    fi

    # It has to move, so the working tree is about to be walked over. Uncommitted
    # work goes into the stash BEFORE anything touches it -- the same promise
    # `stay-current.sh` already keeps for the tool itself. If it will not stash,
    # nothing else happens to this repository: an unmoved course is a nuisance,
    # and a deleted afternoon is not.
    if [ -n "$dirty" ]; then
      if git -C "$root" stash push -u -m "catch-up $(date '+%Y-%m-%d %H:%M:%S')" >/dev/null 2>&1; then
        line "$name: uncommitted work stashed — \`git -C $root stash pop\` is the way back"
      else
        line "$name: HAS UNCOMMITTED WORK THAT WOULD NOT STASH — left alone"
        continue
      fi
    fi

    # CASE 2: this machine holds commits origin does not. Now the tag preserves
    # something, which is the only case in which it ever did.
    if [ "$ahead" -eq 1 ]; then
      tag="before-catch-up-$(date +%Y%m%d-%H%M%S)"
      git -C "$root" tag -f "$tag" >/dev/null 2>&1
      git -C "$root" reset --hard "origin/$branch" >/dev/null 2>&1 \
        && line "$name: diverged, reset to origin/$branch (its commits kept as tag $tag)" \
        || line "$name: COULD NOT RESET — look at it by hand"
      # Only the board's own scratch. A course may hold untracked work of the
      # person's -- a downloaded paper, a draft -- and this is not the command
      # that gets to decide about that.
      git -C "$root" clean -fdq -- live 2>/dev/null
    # CASE 3: simply behind. Fast-forward, which is what the stash above made
    # possible.
    else
      git -C "$root" merge --ff-only "origin/$branch" >/dev/null 2>&1 \
        && line "$name: fast-forwarded" \
        || line "$name: could not fast-forward, left alone"
    fi
  done
fi

# ------------------------------------------------------------- the processes
if [ "$REPORT" -eq 0 ] && [ "$COURSES_ONLY" -eq 0 ]; then
  say "the boards, the tutors and the follower"
  # `tutor restart --tutors` owns what is safe to touch: boards answering on this
  # machine, the follower, and daemons that are not mid-turn. A board that comes
  # back on the current code publishes itself on the tailnet, which is what makes
  # the other machine able to see it at all.
  "$TUTOR" restart --tutors 2>&1 | sed 's/^/   /'
fi

# ------------------------------------------------------- stop the empty ones
if [ "$TIDY" -eq 1 ]; then
  say "boards with nothing in them"
  for dir in "$COURSES"/*/; do
    root="${dir%/}"
    [ -d "$root/live/cards" ] || continue
    [ -f "$root/live/.board.json" ] || continue
    n="$(find "$root/live/cards" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]-*' 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$n" = "0" ]; then
      ( cd "$root" && "$BOARD" stop >/dev/null 2>&1 ) \
        && line "$(basename "$root"): stopped (no lesson in it)"
    fi
  done
fi

# ------------------------------------------------------------------ the truth
say "what is actually running here"
"$TUTOR" where 2>&1 | sed 's/^/   /'

say "how to reach each of them"
python3 - "$COURSES" "$HERE" <<'PY'
import json, os, sys
sys.path.insert(0, sys.argv[2])
from tutorboard import machine, processes
from tutorboard.net import tailscale

courses, tool = sys.argv[1], sys.argv[2]
me = tailscale.tailnet_self() or machine.node_name()
for name in sorted(os.listdir(courses)):
    root = os.path.join(courses, name)
    rec = os.path.join(root, "live", ".board.json")
    if not os.path.isfile(rec):
        continue
    try:
        with open(rec, encoding="utf-8") as fh:
            info = json.load(fh)
    except (OSError, ValueError):
        continue
    if not processes.board_is_running(info.get("pid"), root):
        continue
    port = info.get("port")
    print("   %-24s http://%s:%s/" % (name, me, port))
print()
print("   the installed app's address is served by the follower, which points at")
print("   whichever course was last chosen. The URLs above reach one board each,")
print("   directly, whatever the follower is doing.")
PY

say "what the hub will offer"
python3 - "$COURSES" "$HERE" <<'PY'
import json, os, sys
sys.path.insert(0, sys.argv[2])
from tutorboard import processes
from tutorboard.net import boards

courses, tool = sys.argv[1], sys.argv[2]
# Any board here will answer for the whole machine and for its neighbours.
port = None
for name in sorted(os.listdir(courses)):
    rec = os.path.join(courses, name, "live", ".board.json")
    try:
        with open(rec, encoding="utf-8") as fh:
            info = json.load(fh)
    except (OSError, ValueError):
        continue
    if processes.board_is_running(info.get("pid"), os.path.join(courses, name)):
        port = info.get("port")
        break
if not port:
    print("   no board is running here, so there is nothing to ask")
    raise SystemExit(0)
doc = boards.board_json("127.0.0.1", port, "/hosts.json", timeout=30) or {}
hosts = doc.get("hosts") or []
if len(hosts) < 2:
    print("   only this machine is answering; the other one is off, asleep, or")
    print("   has not been caught up yet. Run this script there too.")
for h in hosts:
    live = [c["repo"] for c in (h.get("courses") or []) if c.get("running")]
    print("   %-32s %d course(s)%s"
          % ((h.get("name") or "this machine").split(".")[0],
             len(h.get("courses") or []),
             ("  live: " + ", ".join(live)) if live else ""))
PY

printf '\n'
say "if the app still opens the wrong course"
line "That is the follower's decision, and it writes down which board it chose"
line "and why, every tick:"
line ""
line "    tail -20 ~/Library/Logs/tutor-follow.log"
line ""
line "One line from that says more than anything else can, because the follower is"
line "the only thing that can move the installed app's address."
