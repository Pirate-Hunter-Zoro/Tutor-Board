#!/usr/bin/env bash
# ===========================================================================
#  setup-mac.sh -- put the always-on host right, and keep it free.
#
#      bash scripts/setup-mac.sh [--secret <handover_secret>] [--node <name>]
#
#  The other half of `setup-node.sh`. That script sets up the machine that has
#  an allowance and teaches with Claude; this one sets up the machine that is
#  awake all the time and teaches for nothing.
#
#  The split is deliberate and it is about who pays. The Mac mini is on all day,
#  holds every course, and answers whenever somebody picks up the iPad -- which
#  is exactly the machine you do not want metered. The compute node is where the
#  allowance lives, and the proxy already prefers it for anything it can serve
#  (`bin/follow`). So: free here, paid there, and the address moves between them
#  without anybody choosing.
#
#  What makes it stick is `free_only` in the config, and the reason that key
#  exists rather than just setting `default_agent: free` is that three separate
#  things can name an agent from further away than this machine -- a course's
#  own `tutorboard.json`, which arrives by `git pull`; the `hosts` table; and a
#  `--agent` typed by somebody who forgot which machine they were on. `free_only`
#  sits outside all of them. See `resolve_agent` in bin/tutor.
#
#  Idempotent, and it says what it found rather than what it assumed. Run it
#  again whenever you are not sure.
# ===========================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE" || { echo "cannot enter $HERE" >&2; exit 1; }

CFG="${XDG_CONFIG_HOME:-$HOME/.config}/tutor-board/config.json"
SECRET=""
NODE=""
problems=0

say()  { printf '%s\n' "$*"; }
good() { printf '  ok    %s\n' "$*"; }
warn() { printf '  ----  %s\n' "$*"; problems=$((problems + 1)); }

while [ $# -gt 0 ]; do
  case "$1" in
    --secret) SECRET="${2:-}"; shift 2 ;;
    --node)   NODE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

say "always-on host setup"
say "  $HERE"
say

# --- 0. is this the right kind of machine ----------------------------------
# Slurm answering means a compute node, and a compute node with a `follow` block
# proxies to itself. Refuse rather than convert one into the other.
shape="$(python3 -c 'import sys; sys.path.insert(0, "'"$HERE"'"); from tutorboard import machine; print(machine.machine_shape())' 2>/dev/null)"
case "$shape" in
  "compute node")
    say "Slurm answers here, which makes this a compute node."
    say "You want scripts/setup-node.sh. Nothing has been changed."
    exit 1 ;;
  "always-on host") good "shape: always-on host (it has a \`follow\` block)" ;;
  *) say "  ....  shape: $shape — no \`follow\` block yet; one is written below" ;;
esac

# --- 1. catch up -----------------------------------------------------------
before="$(git rev-parse HEAD 2>/dev/null)"
if out="$(git pull --ff-only 2>&1)"; then
  after="$(git rev-parse HEAD 2>/dev/null)"
  if [ "$before" = "$after" ]; then good "already current (${after:0:8})"
  else good "pulled ${before:0:8} -> ${after:0:8}"; fi
else
  warn "pull did not run: $(printf '%s' "$out" | tail -1)"
fi

# --- 2. the machine's name -------------------------------------------------
# Pinned here, unlike on a node. A Mac with no HostName takes its name from
# whatever DNS answers that day, and every record under live/ carries it.
python3 - <<PY
import os, sys
sys.path.insert(0, "$HERE")
from tutorboard import machine
pinned = machine.node_name_pinned()
if pinned:
    print("  ok    node: %s (pinned)" % pinned)
elif machine.should_pin_node_name():
    print("  ok    node: %s (pinned now — the network can no longer rename it)"
          % machine.pin_node_name())
else:
    print("  ----  node: %s is NOT pinned and cannot be" % machine.node_name())
PY

# --- 3. the config ---------------------------------------------------------
export TB_CFG="$CFG" TB_SECRET="$SECRET" TB_NODE="$NODE" TB_HERE="$HERE"
python3 - <<'PY'
import json, os, sys
sys.path.insert(0, os.environ["TB_HERE"])

path = os.environ["TB_CFG"]
try:
    with open(path, encoding="utf-8") as fh:
        cfg = json.load(fh) or {}
except (OSError, ValueError):
    cfg = {}
changed = False

# --- this machine teaches for nothing --------------------------------------
if cfg.get("free_only") is True:
    print("  ok    free_only: on — a billed agent asked for here is refused")
else:
    cfg["free_only"] = True
    changed = True
    print("  ok    free_only: on (was %r)" % cfg.get("free_only"))
    print("        every lesson on this machine now runs on the free chain,")
    print("        whatever a course file or a --agent flag asks for")

if cfg.get("fallback_agent") != "free":
    cfg["fallback_agent"] = "free"
    changed = True
    print("  ok    fallback_agent: free")
else:
    print("  ok    fallback_agent: free")

# `default_agent` still matters even under free_only: it is what a compute node
# reading this config would use, and it is what the refusal message names. Set it
# to the truth for THIS machine.
if cfg.get("default_agent") != "free":
    print("  ok    default_agent: free (was %s)" % (cfg.get("default_agent") or "unset"))
    cfg["default_agent"] = "free"
    changed = True
else:
    print("  ok    default_agent: free")

# --- the follow block, which is what makes this the always-on host ----------
follow = cfg.get("follow") or {}
node = (os.environ.get("TB_NODE") or "").strip() or follow.get("node") or "compute-node"
want = {"node": node, "listen": follow.get("listen") or "127.0.0.1:8844",
        "prefer": follow.get("prefer") or "local"}
if follow != want:
    cfg["follow"] = want
    changed = True
    print("  ok    follow: node=%s listen=%s prefer=%s" % (want["node"], want["listen"], want["prefer"]))
else:
    print("  ok    follow: node=%s prefer=%s" % (want["node"], want["prefer"]))

# --- the handover secret ---------------------------------------------------
want_secret = (os.environ.get("TB_SECRET") or "").strip()
have = (cfg.get("handover_secret") or "").strip()
if want_secret:
    if have == want_secret:
        print("  ok    handover_secret matches the one you passed")
    else:
        cfg["handover_secret"] = want_secret
        changed = True
        print("  ok    handover_secret written")
elif have:
    print("  ok    handover_secret is set")
    print("        it must be byte-identical on the node:")
    print("          bash scripts/setup-node.sh --secret %s" % have)
else:
    import secrets
    cfg["handover_secret"] = secrets.token_hex(24)
    changed = True
    print("  ok    handover_secret generated")
    print("          bash scripts/setup-node.sh --secret %s" % cfg["handover_secret"])

if changed:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, path)
    print("  ok    wrote %s" % path)
PY

# --- 4. can it actually teach for nothing ----------------------------------
# The whole arrangement above is a plan. This is the measurement, and it is the
# reason this script exists rather than a paragraph in the README: a machine
# configured to teach for free and unable to teach at all looks, from the iPad,
# exactly like a machine that is working.
say
if ! python3 "$HERE/bin/free" --check; then
  problems=$((problems + 1))
fi

# --- 4b. can a document be READ on the board -------------------------------
# Not fatal, and said here rather than left to be discovered from a panel that
# will not fill. A PDF can always be SAVED to the device; reading one on the
# board needs a page renderer, and a Mac has one only if poppler or Ghostscript
# was installed. `board doctor` says the same thing.
say
if python3 -c 'import sys; sys.path.insert(0, "'"$HERE"'"); from tutorboard.course import paper; sys.exit(0 if paper.renderer() else 1)' 2>/dev/null; then
  good "a PDF can be read on the board here"
else
  warn "no pdftoppm, pdftocairo or gs: the iPad can save a PDF from this"
  warn "  machine but not read one on the board. brew install poppler"
fi

# --- 5. put the running processes on the new code --------------------------
say
if command -v tutor >/dev/null 2>&1; then tutor restart --tutors
else python3 "$HERE/bin/tutor" restart --tutors; fi

say
python3 "$HERE/bin/tutor" --agents
say
if [ "$problems" -eq 0 ]; then
  say "This machine is set up and teaching for nothing. The compute node keeps"
  say "its allowance and gets any course this one has not got; run"
  say "scripts/setup-node.sh there if you have not."
else
  say "$problems thing(s) above still need a person. Everything else is done."
fi
exit 0
