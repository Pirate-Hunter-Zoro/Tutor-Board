#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# install-autostart.sh -- bring the board back by itself, on a cluster node.
#
#   bash scripts/install-autostart.sh --login-hook
#   bash scripts/install-autostart.sh --uninstall
#
# A supervisor is the wrong shape here. One brings a service back after a machine
# reboots; a compute node does not reboot, it ceases to be yours -- the
# allocation ends and takes the board, the tutor and tailscaled with it, on a
# machine you will never be given back. There is no process left to notice, and
# no way for the iPad to ask, because asking requires something already
# listening.
#
# The only moment a compute node gets is the moment you log in to it, so that is
# where the hook goes -- and `salloc` hands you a shell on the LOGIN node, so it
# goes on every interactive shell rather than only on the ones you open on the
# node itself. `tutor resume` decides what to do from there.
#
# No sudo. It runs as you, which is what you want -- the daemon needs your
# tailnet, your git credentials and your agent's own auth.
# ---------------------------------------------------------------------------
set -uo pipefail

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
# Catch this machine up on the board and take it over, if it should be taken
# over. A login is the only moment a compute node gets: nothing here survives the
# allocation, and no timer can keep the tool current on a machine that ceases to
# exist -- so \`tutor resume\` pulls this repository as well as the course, and
# bounces whatever is still holding the old code.
# This fires on a LOGIN NODE too, and that is the point of it being on every
# shell: \`salloc\` hands you a shell here while the machine you were given is
# over there with nobody on it, so the resume is handed to that node instead.
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
  exit 0
fi

echo "usage: $0 --login-hook      the only thing this installs"
echo "       $0 --uninstall"
echo
echo "A compute node cannot be supervised: it does not come back, it stops"
echo "being yours. Nothing here registers a service."
exit 1
