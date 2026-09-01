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
#  Nothing here destroys work that is not already pushed: a course whose history
#  has diverged is TAGGED before it is reset, so `git tag` still names the old
#  state and `git reset --hard <tag>` brings it back.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COURSES="$(dirname "$HERE")"
TUTOR="$HERE/bin/tutor"
BOARD="$HERE/bin/board"

TIDY=0
REPORT=0
for a in "$@"; do
  case "$a" in
    --tidy)   TIDY=1 ;;
    --report) REPORT=1 ;;
    -h|--help) sed -n '3,12p' "${BASH_SOURCE[0]}" | sed 's/^#  \{0,1\}//'; exit 0 ;;
  esac
done

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
line() { printf '   %s\n' "$*"; }

# ---------------------------------------------------------------- the tool
if [ "$REPORT" -eq 0 ]; then
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
    if git -C "$root" merge-base --is-ancestor HEAD "origin/$branch" 2>/dev/null; then
      if git -C "$root" merge-base --is-ancestor "origin/$branch" HEAD 2>/dev/null \
         && [ -z "$(git -C "$root" status --porcelain)" ]; then
        line "$name: current"
        continue
      fi
    fi
    # Diverged, or dirty. The board writes into `live/` constantly, so this is
    # ordinary rather than alarming -- but it means a fast-forward will refuse,
    # and the whole point of running this is that the machine ends up matching
    # what was pushed. Tag first: nothing is lost, it is just no longer checked
    # out, and `git reset --hard <tag>` is the way back.
    tag="before-catch-up-$(date +%Y%m%d-%H%M%S)"
    if [ -n "$(git -C "$root" status --porcelain)" ] || \
       ! git -C "$root" merge-base --is-ancestor HEAD "origin/$branch" 2>/dev/null; then
      git -C "$root" tag -f "$tag" >/dev/null 2>&1
      git -C "$root" reset --hard "origin/$branch" >/dev/null 2>&1 \
        && line "$name: reset to origin/$branch (old state kept as tag $tag)" \
        || line "$name: COULD NOT RESET — look at it by hand"
      # Only the board's own scratch. A course may hold untracked work of the
      # person's -- a downloaded paper, a draft -- and this is not the command
      # that gets to decide about that.
      git -C "$root" clean -fdq -- live 2>/dev/null
    else
      git -C "$root" merge --ff-only "origin/$branch" >/dev/null 2>&1 \
        && line "$name: fast-forwarded" \
        || line "$name: could not fast-forward, left alone"
    fi
  done
fi

# ------------------------------------------------------------- the processes
if [ "$REPORT" -eq 0 ]; then
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
import boardlib

courses, tool = sys.argv[1], sys.argv[2]
me = boardlib.tailnet_self() or boardlib.node_name()
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
    if not boardlib.board_is_running(info.get("pid"), root):
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
import boardlib

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
    if boardlib.board_is_running(info.get("pid"), os.path.join(courses, name)):
        port = info.get("port")
        break
if not port:
    print("   no board is running here, so there is nothing to ask")
    raise SystemExit(0)
doc = boardlib.board_json("127.0.0.1", port, "/hosts.json", timeout=30) or {}
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
