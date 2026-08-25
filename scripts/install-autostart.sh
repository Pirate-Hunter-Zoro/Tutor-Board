#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# install-autostart.sh -- bring the board back by itself after a reboot.
#
#   bash scripts/install-autostart.sh <course-directory> [agent]
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
# No sudo either way. Both run as you, which is what you want -- the daemon needs
# your ssh keys, your tailnet, and your git credentials.
# ---------------------------------------------------------------------------
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TUTOR="$HERE/bin/tutor"
LABEL="com.tutorboard.headless"

if [ "${1:-}" = "--uninstall" ]; then
  case "$(uname -s)" in
    Darwin)
      launchctl unload "$HOME/Library/LaunchAgents/$LABEL.plist" 2>/dev/null
      rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
      echo "removed the LaunchAgent" ;;
    Linux)
      systemctl --user disable --now tutor-headless.service 2>/dev/null
      rm -f "$HOME/.config/systemd/user/tutor-headless.service"
      systemctl --user daemon-reload 2>/dev/null
      echo "removed the user unit" ;;
  esac
  exit 0
fi

COURSE="${1:-}"
AGENT="${2:-}"
[ -n "$COURSE" ] || { echo "usage: $0 <course-directory> [agent]"; exit 1; }

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
