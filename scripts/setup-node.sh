#!/usr/bin/env bash
# ===========================================================================
#  setup-node.sh -- put a compute node right, in one command.
#
#      bash scripts/setup-node.sh [--secret <handover_secret>] [--tailnet-name NAME]
#
#  Everything a compute node needs in order to serve the iPad, in the order it
#  needs it. Run it in a session on the node; run it again whenever you are not
#  sure, because every step is idempotent and says what it found rather than
#  what it assumed.
#
#  Why a script and not a checklist: every item here has been forgotten at least
#  once, and each one fails silently. A stale tailnet registration means the
#  iPad quietly opens the wrong machine. A default agent naming a program this
#  node has not got leaves a daemon that reads as *listening* and fails every
#  turn into a log nobody opens.
#
#  What it deliberately does NOT do:
#    - pin the machine's name. On a cluster the name changes between allocations
#      because it is a different machine, and every ownership check depends on
#      that being true.
#    - register on the tailnet for you. `board vpn up --hostname` moves the one
#      address the iPad app is installed against, so it is reported and left to a
#      person.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE" || { echo "cannot enter $HERE" >&2; exit 1; }

CFG="${XDG_CONFIG_HOME:-$HOME/.config}/tutor-board/config.json"
SECRET=""
TSNAME=""
problems=0

say()  { printf '%s\n' "$*"; }
good() { printf '  ok    %s\n' "$*"; }
warn() { printf '  ----  %s\n' "$*"; problems=$((problems + 1)); }

while [ $# -gt 0 ]; do
  case "$1" in
    --secret)        SECRET="${2:-}"; shift 2 ;;
    --tailnet-name)  TSNAME="${2:-}"; shift 2 ;;
    -h|--help)       sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

say "compute node setup"
say "  $HERE"
say

# --- 0. is this the right kind of machine ----------------------------------
shape="$(python3 -c 'import sys; sys.path.insert(0, "'"$HERE"'"); from tutorboard import machine; print(machine.machine_shape())' 2>/dev/null)"
case "$shape" in
  "compute node") good "shape: compute node (Slurm answers here)" ;;
  *)              warn "shape: $shape — no Slurm here; this may not be the node you meant" ;;
esac

# --- 1. catch up -----------------------------------------------------------
# Nothing pulls this repository on a timer here, because nothing on a compute
# node survives the allocation. So the pull is a step, and it has to come first
# -- everything below is code that arrived in it.
before="$(git rev-parse HEAD 2>/dev/null)"
if out="$(git pull --ff-only 2>&1)"; then
  after="$(git rev-parse HEAD 2>/dev/null)"
  if [ "$before" = "$after" ]; then
    good "already current (${after:0:8})"
  else
    good "pulled ${before:0:8} -> ${after:0:8}"
  fi
else
  warn "pull did not run: $(printf '%s' "$out" | tail -1)"
  say  "        starting from what is on disk; a handoff pushed elsewhere may be missing"
fi

# --- 2. the machine's name -------------------------------------------------
# Reported, never pinned. See the header.
export TB_HERE="$HERE"
python3 - <<'PY'
import os, sys
sys.path.insert(0, os.environ.get("TB_HERE", "."))
from tutorboard import machine
pinned = machine.node_name_pinned()
if pinned and not machine.should_pin_node_name():
    print("  ----  node: '%s' is PINNED on a cluster node, which is wrong here." % pinned)
    print("        the name must change with the allocation, or a record from a node")
    print("        that has gone looks alive for ever.  fix:  board node --unpin")
    sys.exit(3)
print("  ok    node: %s (from the system, which is right on a cluster)"
      % machine.node_name())
PY
[ $? -eq 3 ] && problems=$((problems + 1))

# --- 3. the handover secret ------------------------------------------------
# What `tutor agent stop <course> --on <host>` presents when it asks another
# machine to stand a tutor down. Two machines must carry the same value, which
# on a shared home they do by construction; without one the endpoint answers
# denied and a tutor on the machine you are not sitting at cannot be stopped.
export TB_CFG="$CFG" TB_SECRET="$SECRET" TB_TSNAME="$TSNAME"
python3 - <<'PY'
import json, os, sys

path = os.environ["TB_CFG"]
want = (os.environ.get("TB_SECRET") or "").strip()
try:
    with open(path, encoding="utf-8") as fh:
        cfg = json.load(fh) or {}
except (OSError, ValueError):
    cfg = {}

have = (cfg.get("handover_secret") or "").strip()
changed = False

if want:
    if have == want:
        print("  ok    handover_secret matches the one you passed")
    else:
        cfg["handover_secret"] = want
        changed = True
        print("  ok    handover_secret written" + ("" if not have else " (replacing a different one)"))
elif have:
    print("  ok    handover_secret is set")
else:
    print("  ----  no handover_secret: /handover answers denied, so a tutor on")
    print("        another machine cannot be stood down from here")
    print("        set one:  bash scripts/setup-node.sh --secret <any long value>")

# --- 4. which tutor this machine can actually run ---------------------------
# `claude` is the default now. A node that has not got it must say so here, or
# every turn fails into a log while the board shows an assistant listening.
import shutil
has_claude = bool(shutil.which("claude"))
agent = cfg.get("default_agent")
right = "claude" if has_claude else "free"
if agent == right:
    print("  ok    default_agent: %s" % agent)
else:
    cfg["default_agent"] = right
    changed = True
    if has_claude:
        print("  ok    default_agent: %s (was %s; Claude Code is installed here)"
              % (right, agent or "unset"))
    else:
        print("  ----  default_agent: free (was %s) — no `claude` on the path here."
              % (agent or "unset"))
        print("        install Claude Code and rerun this to teach with it")

# --- 5. this node is the machine that is ALLOWED to spend --------------------
# `free_only` says this machine may not run a billed tutor. On the node that
# holds the allowance that is exactly backwards, and the symptom is a board that
# answers perfectly well and teaches slightly worse for ever.
if cfg.pop("free_only", None):
    changed = True
    print("  ok    free_only: removed — this node has an allowance and should use it")

if changed:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, path)
    print("  ok    wrote %s" % path)
PY

# --- 6. the tailnet name ----------------------------------------------------
# Reported, not changed: this is the one address the iPad app is installed
# against, and a script that moves it silently is the exact failure this
# repository has spent the most time on.
ts_now="$(python3 -c 'import sys; sys.path.insert(0, "'"$HERE"'"); from tutorboard.net import tailscale; print(tailscale.tailnet_hostname())' 2>/dev/null)"
if [ -n "$TSNAME" ] && [ "$ts_now" != "$TSNAME" ]; then
  warn "tailnet name is '$ts_now', you said '$TSNAME'"
  say  "          board vpn up --hostname $TSNAME"
else
  good "tailnet name: $ts_now — this is the address the iPad app is installed against"
fi

# --- 7. put the running processes on the new code ---------------------------
# A board and a tutor read their code once, when they start. The pull above
# changed files on disk and nothing else.
say
if command -v tutor >/dev/null 2>&1; then
  tutor restart --tutors
else
  python3 "$HERE/bin/tutor" restart --tutors
fi

say
python3 "$HERE/bin/tutor" --agents
say
if [ "$problems" -eq 0 ]; then
  say "This node is right. Its tailnet name serves whichever course was last chosen,"
  say "and a tap in the hub moves that name to the course it opens."
else
  say "$problems thing(s) above still need a person. Everything else is done."
fi
exit 0
