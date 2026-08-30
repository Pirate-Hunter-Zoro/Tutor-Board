#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# install-autostart.sh -- bring the board back by itself after a reboot.
#
#   bash scripts/install-autostart.sh <course-directory> [agent]
#   bash scripts/install-autostart.sh --login-hook      (cluster nodes)
#   bash scripts/install-autostart.sh --tool-pull       (always-on host)
#   bash scripts/install-autostart.sh --uninstall
#
# An always-on machine is only always-on until it isn't: a power cut, a software
# update, a cat. This registers the headless daemon with the system's own
# supervisor so it comes back without anyone logging in to restart it, and gets
# restarted if it dies.
#
# macOS: a LaunchAgent under ~/Library/LaunchAgents.
# Linux with systemd --user: a user unit under ~/.config/systemd/user.
#
# On a cluster node neither of those is the right shape, and `--login-hook` is.
# A supervisor brings a service back after the machine reboots; a compute node
# does not reboot, it ceases to be yours -- the allocation ends and takes the
# board, the tutor and tailscaled with it, on a machine you will never be given
# back. There is no process left to notice, and no way for the iPad to ask,
# because asking requires something already listening. The only moment a compute
# node gets is the moment you log in to it, so that is where the hook goes.
#
# No sudo either way. Both run as you, which is what you want -- the daemon needs
# your ssh keys, your tailnet, and your git credentials.
# ---------------------------------------------------------------------------
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TUTOR="$HERE/bin/tutor"
LABEL="com.tutorboard.headless"
LABEL_PULL="com.tutorboard.pull"

BEGIN_MARK="# >>> tutor-board resume >>>"
END_MARK="# <<< tutor-board resume <<<"
RC="$HOME/.bashrc"

strip_hook() {
  [ -f "$RC" ] || return 0
  grep -qF "$BEGIN_MARK" "$RC" || return 0
  python3 - "$RC" "$BEGIN_MARK" "$END_MARK" <<'PYEOF'
import io, sys
rc, begin, end = sys.argv[1], sys.argv[2], sys.argv[3]
text = io.open(rc, encoding="utf-8").read()
while begin in text and end in text:
    a = text.index(begin)
    b = text.index(end) + len(end)
    text = text[:a].rstrip("\n") + "\n" + text[b:].lstrip("\n")
io.open(rc, "w", encoding="utf-8").write(text)
PYEOF
  echo "removed the login hook from $RC"
}

if [ "${1:-}" = "--login-hook" ]; then
  [ -f "$RC" ] || touch "$RC"
  cp "$RC" "$RC.bak.tutor-board"
  strip_hook
  cat >> "$RC" <<HOOK

$BEGIN_MARK
# Take the board over on whatever machine this is, if it should be taken over.
# Interactive shells only: a login file that writes to stdout breaks scp, sftp
# and git-over-ssh, and that failure is remote and baffling. Backgrounded, so a
# slow network never delays a prompt. The resume command itself decides whether
# there is anything to do -- it is quiet and quick when there is not, it leaves a board
# alone on a node that is still yours, and it refuses to start one on a machine
# Slurm does not say is yours.
if [ -n "\${BASH_VERSION:-}" ] && [[ \$- == *i* ]] && [ -z "\${TUTOR_BOARD_NO_RESUME:-}" ]; then
  (
    if command -v flock >/dev/null 2>&1; then
      flock -n 9 || exit 0            # another shell on this node got there first
    fi
    "\$HOME/.local/bin/tutor" resume --quiet
  ) 9>"/tmp/.tutor-resume.\$USER.lock" >>"\$HOME/.tutor-resume.log" 2>&1 &
  disown 2>/dev/null || true
fi
$END_MARK
HOOK
  echo "added the login hook to $RC  (previous copy at $RC.bak.tutor-board)"
  echo "log:    ~/.tutor-resume.log"
  echo "off:    export TUTOR_BOARD_NO_RESUME=1   (for one shell)"
  echo "remove: bash $0 --uninstall"
  exit 0
fi

if [ "${1:-}" = "--uninstall" ]; then
  strip_hook
  case "$(uname -s)" in
    Darwin)
      launchctl unload "$HOME/Library/LaunchAgents/$LABEL.plist" 2>/dev/null
      rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
      launchctl unload "$HOME/Library/LaunchAgents/$LABEL_PULL.plist" 2>/dev/null
      rm -f "$HOME/Library/LaunchAgents/$LABEL_PULL.plist"
      echo "removed the LaunchAgents" ;;
    Linux)
      systemctl --user disable --now tutor-headless.service 2>/dev/null
      rm -f "$HOME/.config/systemd/user/tutor-headless.service"
      systemctl --user daemon-reload 2>/dev/null
      echo "removed the user unit" ;;
  esac
  exit 0
fi

if [ "${1:-}" = "--tool-pull" ]; then
  # Keep this repository fresh on a machine that is always on. A person ships a
  # board fix from a compute node and comes back to the Mac: the next session
  # here should read the new code without anybody remembering to pull. `--ff-only`
  # so a diverged branch is logged and left, never force-resolved; a session that
  # starts a commit behind is still a session. This does NOT restart a running
  # board -- that is `tutor restart`, and a board holds the code it started with.
  GIT="$(command -v git)"
  case "$(uname -s)" in
    Darwin)
      PLIST="$HOME/Library/LaunchAgents/$LABEL_PULL.plist"
      mkdir -p "$(dirname "$PLIST")"
      {
        echo '<?xml version="1.0" encoding="UTF-8"?>'
        echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
        echo '<plist version="1.0"><dict>'
        echo "  <key>Label</key><string>$LABEL_PULL</string>"
        echo '  <key>ProgramArguments</key><array>'
        printf '    <string>%s</string>\n    <string>-C</string>\n    <string>%s</string>\n    <string>pull</string>\n    <string>--ff-only</string>\n' "$GIT" "$HERE"
        echo '  </array>'
        echo '  <key>StartInterval</key><integer>300</integer>'
        echo '  <key>RunAtLoad</key><true/>'
        echo "  <key>StandardOutPath</key><string>$HOME/Library/Logs/tutor-pull.log</string>"
        echo "  <key>StandardErrorPath</key><string>$HOME/Library/Logs/tutor-pull.log</string>"
        echo '  <key>EnvironmentVariables</key><dict>'
        echo '    <key>GIT_TERMINAL_PROMPT</key><string>0</string>'
        echo '    <key>GIT_ASKPASS</key><string>/bin/false</string>'
        echo '  </dict>'
        echo '</dict></plist>'
      } > "$PLIST"
      launchctl unload "$PLIST" 2>/dev/null
      launchctl load "$PLIST" && echo "loaded $PLIST"
      echo "logs: ~/Library/Logs/tutor-pull.log"
      echo "stop: bash $0 --uninstall"
      ;;
    *)
      echo "a periodic tool pull only makes sense on an always-on host;"
      echo "on a compute node nothing survives, and the AI contract already"
      echo "pulls at the start of every session."
      exit 1 ;;
  esac
  exit 0
fi

COURSE="${1:-}"
AGENT="${2:-}"
[ -n "$COURSE" ] || {
  echo "usage: $0 <course-directory> [agent]"
  echo "       $0 --login-hook      on a cluster node, where nothing survives"
  echo "       $0 --tool-pull       on an always-on host, keep this repo fresh"
  echo "       $0 --uninstall"
  exit 1
}

ARGS=("headless" "$COURSE")
[ -n "$AGENT" ] && ARGS+=("--agent" "$AGENT")

case "$(uname -s)" in
Darwin)
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$(dirname "$PLIST")"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "  <key>Label</key><string>$LABEL</string>"
    echo '  <key>ProgramArguments</key><array>'
    printf '    <string>%s</string>\n' "$(command -v python3)" "$TUTOR" "${ARGS[@]}"
    echo '  </array>'
    echo '  <key>RunAtLoad</key><true/>'
    echo '  <key>KeepAlive</key><true/>'
    echo "  <key>WorkingDirectory</key><string>$HOME</string>"
    echo "  <key>StandardOutPath</key><string>$HOME/Library/Logs/tutor-headless.log</string>"
    echo "  <key>StandardErrorPath</key><string>$HOME/Library/Logs/tutor-headless.log</string>"
    # launchd starts with a minimal PATH; the daemon needs the tools you installed.
    echo '  <key>EnvironmentVariables</key><dict>'
    echo "    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>"
    echo '  </dict>'
    echo '</dict></plist>'
  } > "$PLIST"
  launchctl unload "$PLIST" 2>/dev/null
  launchctl load "$PLIST" && echo "loaded $PLIST"
  echo "logs: ~/Library/Logs/tutor-headless.log"
  echo "stop: bash $0 --uninstall"
  ;;
Linux)
  UNIT="$HOME/.config/systemd/user/tutor-headless.service"
  mkdir -p "$(dirname "$UNIT")"
  {
    echo '[Unit]'
    echo 'Description=Tutor-Board headless assistant'
    echo '[Service]'
    printf 'ExecStart=%s %s' "$(command -v python3)" "$TUTOR"
    printf ' %s' "${ARGS[@]}"
    echo
    echo 'Restart=always'
    echo 'RestartSec=10'
    echo "Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
    echo '[Install]'
    echo 'WantedBy=default.target'
  } > "$UNIT"
  systemctl --user daemon-reload
  systemctl --user enable --now tutor-headless.service && echo "enabled $UNIT"
  echo "logs: journalctl --user -u tutor-headless -f"
  echo "note: needs lingering to survive logout —  loginctl enable-linger \$USER"
  echo "stop: bash $0 --uninstall"
  ;;
*)
  echo "no supervisor known for $(uname -s); run 'tutor headless' under whatever you use"
  exit 1 ;;
esac
