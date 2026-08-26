#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# bootstrap.sh -- set a new machine up as a tutoring host.
#
#   bash bootstrap.sh [--courses <file>] [--name <tailnet-name>] [--no-clone]
#
# Run it once on the machine that will run the board: an always-on desktop, a
# laptop, a cluster node. It clones the course repositories, puts `tutor` and
# `board` on the path, reports what is missing, and tells you what remains.
#
# It does not use sudo, does not install anything system-wide, and does not
# start anything you did not ask for.
#
# The list of course repositories is deliberately NOT in this repository, which
# is public. Keep it at ~/.config/tutor-board/courses.txt -- one entry per line:
#
#     https://github.com/you/Some-Course.git
#     https://github.com/you/odd-remote-name.git   Nice-Directory-Name
#
# The second field is optional and only needed when the directory you want does
# not match the repository name. Blank lines and # comments are ignored.
# ---------------------------------------------------------------------------
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT="$(dirname "$HERE")"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/tutor-board"
COURSES="$CONFIG_DIR/courses.txt"
NAME=""
CLONE=1

while [ $# -gt 0 ]; do
  case "$1" in
    --courses) shift; COURSES="$1" ;;
    --name)    shift; NAME="$1" ;;
    --no-clone) CLONE=0 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1"; exit 1 ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
good() { printf '  ok    %s\n' "$*"; }
warn() { printf '  ----  %s\n' "$*"; }

say "Tutor-Board bootstrap"
say "  tool:    $HERE"
say "  courses: $PARENT"
say

# --- the tool itself --------------------------------------------------------
bash "$HERE/install.sh" | sed 's/^/  /'
say

# --- the course repositories ------------------------------------------------
if [ "$CLONE" -eq 1 ]; then
  if [ ! -f "$COURSES" ]; then
    warn "no course list at $COURSES"
    say  "        Create it — one git URL per line — then re-run. On a machine that"
    say  "        already has the repositories, this prints the list to copy over:"
    say  "          for d in $PARENT/*/; do git -C \"\$d\" remote get-url origin 2>/dev/null; done"
  else
    say "Cloning courses listed in $COURSES"
    while IFS= read -r line; do
      case "$line" in ''|\#*) continue ;; esac
      url="$(printf '%s' "$line" | awk '{print $1}')"
      name="$(printf '%s' "$line" | awk '{print $2}')"
      [ -n "$name" ] || name="$(basename "$url" .git)"
      dest="$PARENT/$name"
      if [ -d "$dest/.git" ]; then
        good "$name already cloned"
      elif git clone --quiet "$url" "$dest" 2>/dev/null; then
        # `git clone` exits 0 for a repository whose default branch does not
        # exist, leaving an empty working tree. Saying "cloned" there sends
        # someone hunting for a problem in the wrong place.
        if git -C "$dest" rev-parse --verify --quiet HEAD >/dev/null; then
          good "$name cloned"
          # Tracked hooks are per-clone; turn them on so the attribution
          # stripper is live from this machine's first commit.
          if [ -d "$dest/.githooks" ]; then
            git -C "$dest" config core.hooksPath .githooks
          else
            warn "$name has no .githooks — commits here are not protected"
          fi
        else
          warn "$name cloned EMPTY — does its default branch exist on the remote?"
        fi
      else
        warn "$name FAILED to clone from $url"
      fi
    done < "$COURSES"
  fi
  say
fi

# --- tailnet identity -------------------------------------------------------
if [ -n "$NAME" ]; then
  export BOARD_TAILNET_NAME="$NAME"
  # Refuse to rename a machine that already answers to something on the tailnet,
  # unless that is plainly what was meant. Renaming a live node moves the address
  # every installed app points at.
  EXISTING="$(python3 -c "
import sys; sys.path.insert(0, '$HERE')
import boardlib, os
print(boardlib.tailnet_hostname() if os.path.exists(boardlib.TS_NAME_FILE) else '')
" 2>/dev/null)"
  if [ -n "$EXISTING" ] && [ "$EXISTING" != "$NAME" ]; then
    warn "this machine already calls itself '$EXISTING' on the tailnet"
    say  "        Renaming it to '$NAME' would move the address any installed app"
    say  "        points at. If that is what you want:"
    say  "          board vpn up --hostname $NAME"
    NAME=""
  fi
fi

if [ -n "$NAME" ]; then
  python3 -c "
import sys; sys.path.insert(0, '$HERE')
import boardlib; boardlib.set_tailnet_hostname('$NAME')
print('  ok    this machine will call itself \'$NAME\' on the tailnet')
"
else
  say "  ----  no --name given; this machine will call itself 'board'"
  say "        Two hosts cannot both be 'board'. If another machine already"
  say "        holds that name, re-run with --name <something-else>."
fi
say

# --- what is left -----------------------------------------------------------
say "Next:"
say "  board vpn up          link this machine to your tailnet (prints a login URL once)"
say "  board vpn serve       HTTPS on its *.ts.net name, so the iPad app works offline"
say "  tutor --list          confirm it can see the courses"
say "  tutor --agents        point it at the assistant you use here"
say "  tutor galois          start a session"
say
say "  tutor headless galois --agent opencode     run it as a daemon"
say "  bash $HERE/scripts/install-autostart.sh    keep it running across reboots (macOS)"
