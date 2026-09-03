#!/usr/bin/env bash
# ===========================================================================
#  stay-current.sh -- run this once on the always-on host and never go back.
#
#      bash scripts/stay-current.sh              install it, then do a round now
#      bash scripts/stay-current.sh --status     is it installed, when did it run
#      bash scripts/stay-current.sh --run        one round (what the timer calls)
#      bash scripts/stay-current.sh --behind [d]  is this repository waiting on origin
#      bash scripts/stay-current.sh --uninstall
#
#  The problem it exists for. Fixes to this tool are written on the compute
#  node, which cannot reach the Mac -- and the Mac is the machine that holds the
#  address and runs the follower, so until something over there restarts the
#  processes holding the old code, half of every fix is on disk and none of it is
#  in the lesson. `scripts/catch-up.sh` is the command that puts a machine right,
#  and somebody has to be sitting at it to type that.
#
#  So: a timer that runs the catch-up, and that KEEPS ITSELF INSTALLED.
#
#  The second half is the whole point and it is easy to miss. A timer that only
#  runs a script is a timer that has to be re-installed by hand the next time the
#  schedule, the log path, or the set of background jobs changes -- which means
#  going back to the machine, which is the thing being abolished. Every round
#  therefore re-asserts its own launchd definition from the repository it just
#  pulled, and reloads it only if it actually differs. A future commit that
#  changes how this is supervised lands by itself.
#
#  What it deliberately does NOT do is run the catch-up on a schedule. That
#  restarts every board on the machine, and doing that every ten minutes to a
#  person mid-proof would be worse than the problem. A round FETCHES, decides
#  whether anything actually moved -- this repository, or any course -- and only
#  then puts the machine right. Nothing changed is nothing done, and it is
#  silent about it.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The courses are this repository's siblings. TUTORBOARD_COURSES overrides that
# for the test, which must never run a round against somebody's actual home --
# a round can end in `catch-up.sh`, and `catch-up.sh` moves working trees.
COURSES="${TUTORBOARD_COURSES:-$(dirname "$HERE")}"
LABEL="com.tutorboard.current"
LABEL_PULL="com.tutorboard.pull"        # superseded by this; see install()
LABEL_FOLLOW="com.tutorboard.follow"
LABEL_RESUME="com.tutorboard.resume"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/tutor-current.log"
BEAT="$HOME/.tutor-current.json"
UNIT="$HOME/.config/systemd/user/tutor-current"
INTERVAL="${TUTOR_CURRENT_INTERVAL:-600}"
LOG_CAP=$((2 * 1024 * 1024))

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
line() { printf '   %s\n' "$*"; }
stamp() { date '+%Y-%m-%d %H:%M:%S'; }

# --------------------------------------------------------------- the definition
#
# Written to stdout so a round can compare it with what is installed without
# touching anything. That comparison is what makes this self-healing rather than
# merely self-starting.
plist_text() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$(command -v bash)</string>
    <string>$HERE/scripts/stay-current.sh</string>
    <string>--run</string>
  </array>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>GIT_TERMINAL_PROMPT</key><string>0</string>
    <key>GIT_ASKPASS</key><string>/bin/false</string>
  </dict>
</dict></plist>
PLIST
}

unit_text() {
  cat <<UNITEOF
[Unit]
Description=Tutor-Board: keep this machine current

[Service]
Type=oneshot
ExecStart=$(command -v bash) $HERE/scripts/stay-current.sh --run
WorkingDirectory=$HERE
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=GIT_TERMINAL_PROMPT=0
Environment=GIT_ASKPASS=/bin/false
UNITEOF
}

timer_text() {
  cat <<TIMEREOF
[Unit]
Description=Tutor-Board: keep this machine current

[Timer]
OnBootSec=2min
OnUnitActiveSec=${INTERVAL}s
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF
}

loaded() {
  launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1
}

# Write a file only if its content would change, and say whether it did. Every
# reload of the follower costs the address a moment, so nothing is reloaded for
# a file that is already correct.
write_if_changed() {   # write_if_changed <path> <content-on-stdin>
  local path="$1" tmp
  tmp="$(mktemp)"
  cat > "$tmp"
  mkdir -p "$(dirname "$path")"
  if [ -f "$path" ] && cmp -s "$tmp" "$path"; then
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$path"
  return 0
}

# ------------------------------------------------------------------ installing
install_timer() {
  [ -n "${TUTOR_CURRENT_NO_SUPERVISOR:-}" ] && return 0
  case "$(uname -s)" in
  Darwin)
    local changed=0
    plist_text | write_if_changed "$PLIST" && changed=1
    if [ "$changed" -eq 1 ] || ! loaded "$LABEL"; then
      launchctl unload "$PLIST" 2>/dev/null
      launchctl load "$PLIST" 2>/dev/null \
        && line "loaded $LABEL (every $((INTERVAL / 60)) min)" \
        || line "COULD NOT LOAD $PLIST"
    fi
    ;;
  Linux)
    local changed=0
    unit_text  | write_if_changed "$UNIT.service" && changed=1
    timer_text | write_if_changed "$UNIT.timer"   && changed=1
    if [ "$changed" -eq 1 ] || ! systemctl --user is-enabled tutor-current.timer >/dev/null 2>&1; then
      systemctl --user daemon-reload 2>/dev/null
      systemctl --user enable --now tutor-current.timer 2>/dev/null \
        && line "enabled tutor-current.timer (every $((INTERVAL / 60)) min)" \
        || line "COULD NOT ENABLE tutor-current.timer"
    fi
    ;;
  *)
    line "no supervisor known for $(uname -s); run --run from whatever you use"
    return 1 ;;
  esac
}

# The always-on host's other jobs: the follower proxy and the warm-board resume.
# Asserted rather than reinstalled -- `install-autostart.sh --always-on` unloads
# the follower, and the follower is what holds the address, so it is not
# something to do every ten minutes for no reason.
ensure_always_on() {
  [ -n "${TUTOR_CURRENT_NO_SUPERVISOR:-}" ] && return 0
  [ "$(uname -s)" = "Darwin" ] || return 0
  if loaded "$LABEL_FOLLOW" && loaded "$LABEL_RESUME"; then
    return 0
  fi
  line "the follower or the warm board is not registered; installing them"
  bash "$HERE/scripts/install-autostart.sh" --always-on 2>&1 | sed 's/^/   /'
}

# The old pull timer did half of this -- the tool, and none of the courses -- and
# two timers pulling the same repository race each other into confusing logs for
# no gain. This supersedes it.
retire_pull_timer() {
  [ -n "${TUTOR_CURRENT_NO_SUPERVISOR:-}" ] && return 0
  [ "$(uname -s)" = "Darwin" ] || return 0
  local p="$HOME/Library/LaunchAgents/$LABEL_PULL.plist"
  if [ -f "$p" ] || loaded "$LABEL_PULL"; then
    launchctl unload "$p" 2>/dev/null
    rm -f "$p"
    line "retired $LABEL_PULL — this does what it did, and the courses too"
  fi
}

# ---------------------------------------------------------------------- a round
#
# `git fetch` and compare. Nothing here writes to a working tree unless something
# actually arrived, because the act of putting the machine right restarts every
# board on it.
behind() {   # behind <repo-root>  -> 0 when origin has something we have not
  local root="$1" branch
  git -C "$root" fetch --quiet origin 2>/dev/null || return 1
  branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null)" || return 1
  [ -n "$branch" ] || return 1
  git -C "$root" rev-parse --verify --quiet "origin/$branch" >/dev/null || return 1
  # Behind means origin has something we have not -- NOT merely "the two hashes
  # differ". A machine that is AHEAD of origin differs too, and reading that as
  # behind is an infinite loop with a `git pull` in it: the pull succeeds doing
  # nothing, the round hands over to itself, and the round after that finds the
  # same difference. Ancestry is the question; equality is not.
  ! git -C "$root" merge-base --is-ancestor "origin/$branch" HEAD 2>/dev/null
}

trim_log() {
  [ -f "$LOG" ] || return 0
  local size
  size="$(wc -c < "$LOG" 2>/dev/null | tr -d ' ')"
  [ -n "$size" ] || return 0
  if [ "$size" -gt "$LOG_CAP" ]; then
    tail -c $((LOG_CAP / 2)) "$LOG" > "$LOG.trim" 2>/dev/null && mv "$LOG.trim" "$LOG"
  fi
}

beat() {   # beat <what-happened>
  python3 - "$BEAT" "$HERE" "$1" <<'PY' 2>/dev/null || true
import json, os, subprocess, sys, time
path, here, what = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    head = subprocess.run(["git", "-C", here, "rev-parse", "--short", "HEAD"],
                          stdout=subprocess.PIPE).stdout.decode().strip()
except Exception:
    head = ""
try:
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh) or {}
except (OSError, ValueError):
    doc = {}
doc["at"] = time.time()
doc["iso"] = time.strftime("%Y-%m-%d %H:%M:%S")
doc["head"] = head
doc["last"] = what
doc["rounds"] = int(doc.get("rounds") or 0) + 1
if what != "nothing to do":
    doc["changed_at"] = doc["iso"]
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=2)
os.replace(tmp, path)
PY
}

# The tool repository must never be the thing that gets stuck, because a machine
# that cannot fast-forward is a machine somebody has to go and visit -- which is
# the one outcome this script exists to prevent. So it is put right the same way
# `catch-up.sh` puts a course right, and with the same promise: nothing is
# destroyed. Uncommitted work is stashed, the old commit is tagged, and both are
# named in the log. `git stash list` and `git reset --hard <tag>` are the way back.
unstick_tool() {
  local branch tag
  branch="$(git -C "$HERE" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  [ -n "$branch" ] || return 1
  git -C "$HERE" rev-parse --verify --quiet "origin/$branch" >/dev/null || return 1
  tag="before-stay-current-$(date +%Y%m%d-%H%M%S)"
  if [ -n "$(git -C "$HERE" status --porcelain)" ]; then
    git -C "$HERE" stash push -u -m "stay-current $(stamp)" >/dev/null 2>&1 \
      && line "the tool had uncommitted changes; they are in \`git stash list\`"
  fi
  git -C "$HERE" tag -f "$tag" >/dev/null 2>&1
  git -C "$HERE" reset --hard "origin/$branch" >/dev/null 2>&1 \
    && line "the tool could not fast-forward, so it was reset to origin/$branch" \
    && line "the old commit is tag $tag — \`git reset --hard $tag\` is the way back" \
    && return 0
  line "COULD NOT PUT THE TOOL RIGHT — this one does need a person"
  return 1
}

round() {
  trim_log
  local moved=0 why=""

  # 1. This repository. If it moved, hand over to the copy that just landed --
  #    including this function, which a later commit may have changed.
  if behind "$HERE"; then
    local was
    was="$(git -C "$HERE" rev-parse HEAD 2>/dev/null)"
    if git -C "$HERE" pull --ff-only >/dev/null 2>&1 \
       && [ "$was" != "$(git -C "$HERE" rev-parse HEAD 2>/dev/null)" ]; then
      # Hand over to the copy that just landed, including this function: a later
      # commit may have changed what a round does, and a round that carries on
      # with the code it started with is exactly the staleness being fixed. The
      # HEAD check is the loop guard -- exec'ing after a pull that moved nothing
      # would do this again for ever.
      echo "$(stamp) pulled the tool -> $(git -C "$HERE" rev-parse --short HEAD)"
      exec bash "$HERE/scripts/stay-current.sh" --run --after-pull
    fi
    unstick_tool || { beat "the tool is stuck"; return 1; }
    echo "$(stamp) put the tool back on origin"
    exec bash "$HERE/scripts/stay-current.sh" --run --after-pull
  fi

  # 2. The supervision, re-asserted from the repository as it now is. Silent and
  #    free when nothing about it changed, which is almost always.
  install_timer >/dev/null 2>&1
  ensure_always_on >/dev/null 2>&1
  retire_pull_timer >/dev/null 2>&1

  # 3. The courses. A board only shows what is checked out beside it.
  for dir in "$COURSES"/*/; do
    local root="${dir%/}"
    [ -d "$root/.git" ] || continue
    [ "$(cd "$root" && pwd -P)" = "$(cd "$HERE" && pwd -P)" ] && continue
    if [ ! -f "$root/tutorboard.json" ] && [ ! -f "$root/AI_INSTRUCTIONS.md" ] \
       && [ ! -d "$root/live" ]; then
      continue
    fi
    if behind "$root"; then
      moved=1
      why="$why $(basename "$root")"
    fi
  done

  if [ "$moved" -eq 0 ] && [ "${1:-}" != "--after-pull" ]; then
    beat "nothing to do"
    return 0
  fi

  # 4. Something arrived. `catch-up.sh` is the one implementation of putting a
  #    machine right, and it stays the one implementation -- this decides WHEN,
  #    never HOW.
  echo "$(stamp) catching up:${why:- the tool}"
  bash "$HERE/scripts/catch-up.sh"
  beat "caught up:${why:- the tool}"
}

# ------------------------------------------------------------------------ main
case "${1:-}" in
--run)
  shift
  round "${1:-}"
  exit $?
  ;;

--behind)
  # Is this repository waiting on something from origin? Exit 0 for yes.
  #
  # It exists so the rule can be TESTED rather than reimplemented in a test --
  # "behind" is one ancestry question and getting it wrong is an infinite loop
  # with a `git pull` in it, so the suite has to be able to ask the real one. It
  # is also the single most useful thing to run by hand when a machine looks
  # stale and nobody can say why.
  behind "${2:-$HERE}"
  exit $?
  ;;

--status)
  say "the timer"
  case "$(uname -s)" in
    Darwin)
      if loaded "$LABEL"; then
        line "$LABEL is loaded, every $((INTERVAL / 60)) min"
      else
        line "$LABEL is NOT loaded — run: bash $0"
      fi
      for l in "$LABEL_FOLLOW" "$LABEL_RESUME"; do
        loaded "$l" && line "$l is loaded" || line "$l is NOT loaded"
      done
      loaded "$LABEL_PULL" && line "$LABEL_PULL is still loaded (it should have been retired)"
      ;;
    Linux)
      systemctl --user is-active tutor-current.timer >/dev/null 2>&1 \
        && line "tutor-current.timer is active" || line "tutor-current.timer is NOT active"
      ;;
  esac
  say "the last round"
  if [ -f "$BEAT" ]; then
    sed 's/^/   /' "$BEAT"
  else
    line "it has not run yet"
  fi
  say "the log"
  line "$LOG"
  [ -f "$LOG" ] && tail -12 "$LOG" | sed 's/^/   /'
  exit 0
  ;;

--uninstall)
  case "$(uname -s)" in
    Darwin)
      launchctl unload "$PLIST" 2>/dev/null
      rm -f "$PLIST"
      line "removed $LABEL" ;;
    Linux)
      systemctl --user disable --now tutor-current.timer 2>/dev/null
      rm -f "$UNIT.service" "$UNIT.timer"
      systemctl --user daemon-reload 2>/dev/null
      line "removed tutor-current.timer" ;;
  esac
  line "the follower and the warm board were left alone; "
  line "bash scripts/install-autostart.sh --uninstall removes those too"
  exit 0
  ;;

-h|--help)
  sed -n '3,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,2\}//;s/^#$//'
  exit 0
  ;;
esac

# ------------------------------------------------------------------ installing
say "putting this machine on a timer"
ensure_always_on
retire_pull_timer
install_timer || exit 1
line "log:    $LOG"
line "check:  bash $0 --status"
line "stop:   bash $0 --uninstall"

say "and doing a round now, so you can see it work"
round --after-pull
