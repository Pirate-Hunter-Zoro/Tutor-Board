#!/usr/bin/env python3
"""What this machine calls itself, and why it must not be asked twice.

Every record that crosses `live/` carries this name -- board records, agent
records -- and every liveness check compares it before trusting a pid. So the
name is not cosmetic: if it moves, a machine stops recognising its own boards.
`tutor restart` skips them as another node's, the hub reports them running
somewhere else, and a board that is answering perfectly well becomes impossible
to bounce onto new code. A shipped fix then appears not to have landed, which is
the most expensive kind of bug this repository has.

It moved. A Mac with no `HostName` set derives its name from the network, and
Tailscale's DNS renamed this machine from `mac-mini` to `board` between one board
starting and the next command asking who was running it.

And it was being derived four ways in four files -- `os.uname()` in the launcher,
`socket.gethostname()` in the board and the server -- which are not required to
agree on one machine.

So: one function, a pinned answer, and no caller allowed to ask the system
directly.
"""

import importlib.machinery
import importlib.util
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


# A state directory of its own. BOARD_STATE_DIR exists precisely so a test can
# never write the real one -- a bootstrap test once renamed the live machine on
# the tailnet, which silently moved the address the iPad app was installed
# against.
sandbox = tempfile.mkdtemp(prefix="tutor-node-")
os.environ["BOARD_STATE_DIR"] = sandbox
os.environ.pop("BOARD_NODE_NAME", None)
sys.path.insert(0, ROOT)
from tutorboard import machine, paths


def reload_lib():
    importlib.reload(paths)          # STATE_DIR is read from the environment
    importlib.reload(machine)


reload_lib()

# --- one form for one machine ----------------------------------------------
check("a fully qualified name is just the first label",
      machine._normal_node("board.tail0c6c62.ts.net") == "board")
check("and case is not an identity: Mac-mini and mac-mini are one machine",
      machine._normal_node("Mac-mini") == machine._normal_node("mac-mini") == "mac-mini")
check("and nothing at all is not an empty string in a record",
      machine._normal_node("") == "unknown")

# --- pinning ----------------------------------------------------------------
check("nothing is pinned to start with", machine.node_name_pinned() is None)
check("so the name is whatever the system says",
      machine.node_name() == machine.system_node_name())

machine.pin_node_name("mac-mini")
check("a pinned name reads back", machine.node_name_pinned() == "mac-mini")
check("and it is what the machine is called from then on",
      machine.node_name() == "mac-mini")

# The whole point: the system name moving must not move ours.
real = machine.system_node_name
machine.system_node_name = lambda: "something-the-network-decided"
check("the network renaming the machine does not rename the board's idea of it",
      machine.node_name() == "mac-mini")
machine.system_node_name = real

check("pinning normalises, so a careless capital cannot fork a machine in two",
      machine.pin_node_name("Mac-Mini") == "mac-mini" and
      machine.node_name() == "mac-mini")

os.environ["BOARD_NODE_NAME"] = "override"
check("the environment still wins, for a test or a one-off",
      machine.node_name() == "override")
os.environ.pop("BOARD_NODE_NAME")
check("and removing it falls back to the pin, not to the system",
      machine.node_name() == "mac-mini")

# --- nobody derives it for themselves ---------------------------------------
# This is the half that actually broke. Two files asked `socket.gethostname()`
# and one asked `os.uname()`; on a Mac those are allowed to differ, and either
# can follow the network.
import ast  # noqa: E402


def asks_the_system(path):
    """Names of system calls this file makes to find out the hostname.

    Parsed, not grepped. A rule about what the code does must not be broken by
    prose describing it -- the docstring on `this_node` says the words
    `socket.gethostname()` precisely to record what it stopped doing.
    """
    tree = ast.parse(open(path, encoding="utf-8").read())
    found = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", None)
        if name in ("gethostname", "uname"):
            found.add(name)
    return found


for rel in ("bin/board", "bin/tutor", "bin/follow", "serve.py"):
    check("%s does not ask the system for the hostname itself" % rel,
          not asks_the_system(os.path.join(ROOT, rel)))

check("tutorboard/machine.py is the one place that may",
      asks_the_system(os.path.join(ROOT, "tutorboard", "machine.py")) == {"uname"})

board_src = open(os.path.join(ROOT, "bin", "board"), encoding="utf-8").read()
start_body = board_src[board_src.index("def cmd_start("):]
start_body = start_body[:start_body.index("\ndef ", 1)]
check("starting a board pins the name before any record carries it",
      "pin_node_name()" in start_body and
      start_body.index("pin_node_name()") < start_body.index("install_teaching(live)"))
check("and a name already pinned is never quietly repinned",
      "if not pinned:" in board_src)
check("doctor says whether the name is pinned, since an unpinned one is the bug",
      "NOT pinned" in board_src)
check("and there is a command to correct a wrong one",
      "def cmd_node(" in board_src and '"node": cmd_node' in board_src)
check("which warns that a board under the old name needs bouncing by hand",
      "bounce it once by hand" in board_src)

# --- the launcher and the board must agree ----------------------------------
loader = importlib.machinery.SourceFileLoader("tutorcli", os.path.join(ROOT, "bin", "tutor"))
spec = importlib.util.spec_from_loader("tutorcli", loader)
tutor = importlib.util.module_from_spec(spec)
loader.exec_module(tutor)

bloader = importlib.machinery.SourceFileLoader("boardcli", os.path.join(ROOT, "bin", "board"))
bspec = importlib.util.spec_from_loader("boardcli", bloader)
board = importlib.util.module_from_spec(bspec)
bloader.exec_module(board)

check("the launcher and the board call this machine the same thing",
      tutor.this_host() == board.this_node() == machine.node_name())
check("and the server's own record would agree with both",
      board.socket_hostname() == machine.node_name())

# --- setting a compute node up ----------------------------------------------
# `scripts/setup-node.sh` is the thing a person is told to run there, so its
# effect on that machine's config has to be exercised rather than read. The block
# is extracted from the script itself, not copied: a test holding its own copy of
# the logic proves only that the copy works.

setup_src = open(os.path.join(ROOT, "scripts", "setup-node.sh"), encoding="utf-8").read()
check("the setup script refuses to run on the always-on host",
      'This script is for the compute node. Nothing has been changed.' in setup_src)
def script_code(text):
    """The script's lines with comments and printed prose dropped.

    A rule about what the script *does* must not be satisfied or broken by the
    header explaining what it deliberately does not do -- which is exactly how
    this check first passed and then failed for the wrong reason.
    """
    out = []
    for line in text.splitlines():
        bare = line.split("#", 1)[0].strip()
        if not bare or bare.startswith(("say ", "good ", "warn ", "print(")):
            continue
        out.append(bare)
    return "\n".join(out)


setup_code = script_code(setup_src)
check("and never pins a name on a cluster, where the machine really does change",
      "machine.pin_node_name(" not in setup_code)
check("and never re-registers the tailnet name, which is the iPad's one address",
      "vpn" not in setup_code and "board vpn up --hostname" in setup_src)
check("and restarts what is running, since a board holds the code it started with",
      "restart --tutors" in setup_src)

# The documentation a node session actually reads. It told one to pin the
# machine's name for a while after that had become the wrong thing to do there --
# a doc that instructs the harmful action is worse than no doc, because it will
# be followed.
for doc in ("README.md", "AI_INSTRUCTIONS.md"):
    text = open(os.path.join(ROOT, doc), encoding="utf-8").read()
    check("%s tells a compute node to run the setup script" % doc,
          "setup-node.sh" in text)
    node_bits = [ln for ln in text.splitlines()
                 if "board node" in ln and "--unpin" not in ln]
    check("%s never tells a compute node to pin its name" % doc,
          not any("node-name" in ln or "<name>" in ln for ln in node_bits)
          or "Do not pin the machine's name" in text)

blocks = setup_src.split("python3 - <<'PY'")
check("the setup script has a config block to test", len(blocks) >= 3)
config_block = blocks[2].split("\nPY\n")[0]


def run_setup(start, secret):
    """Run the script's own config block against a throwaway config."""
    box = tempfile.mkdtemp(prefix="tutor-setup-")
    path = os.path.join(box, "config.json")
    if start is not None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(start, fh)
    env = dict(os.environ, TB_CFG=path, TB_SECRET=secret or "", TB_TSNAME="")
    p = subprocess.run([sys.executable, "-c", config_block], env=env,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
    out = p.stdout.decode("utf-8", "replace")
    try:
        with open(path, encoding="utf-8") as fh:
            got = json.load(fh)
    except (OSError, ValueError):
        got = None
    shutil.rmtree(box, ignore_errors=True)
    return got, out


import json  # noqa: E402
import subprocess  # noqa: E402

# Which tutor is right here is a property of this machine, not of the test.
expected_agent = "claude" if shutil.which("claude") else "free"

got, out = run_setup(None, "s3cret")
check("a node with no config at all comes out with one",
      got and got.get("handover_secret") == "s3cret")
check("and with the tutor this machine can actually run",
      got and got.get("default_agent") == expected_agent)

got, out = run_setup({"handover_secret": "s3cret", "default_agent": expected_agent}, "s3cret")
check("a matching secret is left exactly as it was",
      got and got.get("handover_secret") == "s3cret")

got, out = run_setup({"handover_secret": "stale-and-wrong"}, "s3cret")
check("a secret that does not match the Mac's is replaced, since denied is silent",
      got and got.get("handover_secret") == "s3cret")

got, out = run_setup({"handover_secret": "already-here"}, None)
check("with nothing passed to check against, an existing secret is not clobbered",
      got and got.get("handover_secret") == "already-here")
check("but it is said out loud that nothing verified it",
      "nothing was passed to check it against" in out)

got, out = run_setup(None, None)
check("and a node with no secret at all is told what that costs",
      "strand the tutor" in out)

# The block that must never be on a compute node.
got, out = run_setup({"follow": {"node": "somewhere"}, "handover_secret": "s"}, "s")
check("a `follow` block on a compute node is removed, not left to proxy to itself",
      got is not None and "follow" not in got)
check("and the removal is reported rather than done quietly",
      "removed a `follow` block" in out)

shutil.rmtree(sandbox, ignore_errors=True)
print()
print("%d FAILURES" % len(fails) if fails else "a machine knows its own name")
sys.exit(1 if fails else 0)
