"""
boardlib.py -- the handful of things that differ between machines.

Both the server and the command line need to find a TeX installation and a
working `tailscale`, and neither should care whether it is running on a Linux
compute node, a Mac, or something else. Keeping the platform knowledge here means
there is one place to correct when it turns out to be wrong.

Standard library only, like everything else.
"""

import glob
import json
import os
import re
import shutil
import time

HOME = os.path.expanduser("~")

CONFIG_DIR = os.path.join(
    os.environ.get("XDG_CONFIG_HOME", os.path.join(HOME, ".config")),
    "tutor-board")
CONFIG = os.path.join(CONFIG_DIR, "config.json")
CHOSEN = os.path.join(CONFIG_DIR, "chosen.json")

# Ports are a pure function of the directory name, so the same course answers on
# the same port on every machine -- which is what lets the always-on host find a
# board on the compute node without being able to read its filesystem.
PORT_BASE = 8780
PORT_SPAN = 512
PORT_TRIES = 4


def port_sequence(name):
    """The ports this course will try to bind, in order.

    A hash cannot promise distinct ports for distinct names, and it did not: two
    of these courses landed on the same number and the second one to start simply
    failed to come up. So a name maps to a short SEQUENCE rather than to one port,
    and a start walks it until something is free.

    It stays a pure function of the name -- no knowledge of what other courses
    exist -- because the two machines have different repositories cloned, and a
    rule that depended on the local listing would have them disagree about where
    a course lives.
    """
    h = 2166136261
    for ch in os.path.basename(name):
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return [PORT_BASE + (h + k * 97) % PORT_SPAN for k in range(PORT_TRIES)]


def default_port(name):
    """Where this course serves when nothing is in its way."""
    return port_sequence(name)[0]


def chosen_course():
    """The course a PERSON last asked for, or {} if nobody ever has.

    A decision, not a derivation. `tutor <course>` writes it and so does a tap in
    the hub, and it is what the always-on host follows -- otherwise the proxy
    picks whichever board happens to answer first, which is alphabetical order
    wearing a disguise.
    """
    try:
        with open(CHOSEN, "r", encoding="utf-8") as fh:
            return json.load(fh) or {}
    except (OSError, ValueError):
        return {}


def remember_chosen(name, root):
    """Record that this course was asked for. A note, never a requirement."""
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        tmp = CHOSEN + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"dir": name, "root": root, "at": time.time()}, fh)
        os.replace(tmp, CHOSEN)
        return True
    except OSError:
        return False


def tex_bin_dirs():
    """Every plausible TeX binary directory on this machine, in preference order.

    TinyTeX puts its binaries under an architecture-named directory whose name
    nobody should have to know: `x86_64-linux`, `aarch64-linux`,
    `universal-darwin`, and so on. Glob for it rather than guessing.
    """
    candidates = []
    for root in (os.path.join(HOME, ".TinyTeX"),
                 os.path.join(HOME, "Library", "TinyTeX"),      # TinyTeX on macOS
                 os.path.join(HOME, ".local", "TinyTeX")):
        candidates.extend(sorted(glob.glob(os.path.join(root, "bin", "*"))))
    candidates.append("/Library/TeX/texbin")                    # MacTeX
    candidates.extend(sorted(glob.glob("/usr/local/texlive/*/bin/*")))
    candidates.append("/opt/homebrew/bin")                      # Apple silicon brew
    return [d for d in candidates if os.path.isdir(d)]


def tex_env(extra_inputs=(), env=None):
    """A copy of the environment with TeX on PATH and TEXINPUTS set."""
    env = dict(env or os.environ)
    dirs = tex_bin_dirs()
    if dirs:
        env["PATH"] = os.pathsep.join(dirs + [env.get("PATH", "")])
    inputs = [p for p in extra_inputs if p]
    if inputs:
        env["TEXINPUTS"] = os.pathsep.join(inputs + [env.get("TEXINPUTS", "")])
    return env


def have_tex(env=None):
    env = env or tex_env()
    path = env.get("PATH", "")
    return all(shutil.which(x, path=path) for x in ("latex", "pdflatex", "dvisvgm"))


def slurm_nodes():
    """Nodes where this user currently holds an allocation, or None if unknown.

    Platform knowledge, so it lives here: `board` uses it to decide whether a
    lock belongs to a job that has ended, and `tutor resume` uses it to decide
    whether the node named in a record is a machine that still exists. Where
    there is no `squeue` the answer is None -- unknown, not empty -- and every
    caller must treat those differently, because "no allocations" and "not a
    cluster" lead to opposite decisions.
    """
    import re
    import subprocess
    try:
        p = subprocess.run(["squeue", "-h", "-u", os.environ.get("USER", ""), "-o", "%N"],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
        if p.returncode != 0:
            return None
        out = p.stdout.decode("utf-8", "replace")
        nodes = set()
        for tok in re.findall(r"compute\[?([0-9,\-]+)\]?", out):
            for part in tok.split(","):
                if "-" in part:
                    a, b = part.split("-", 1)
                    for n in range(int(a), int(b) + 1):
                        nodes.add("compute%d" % n)
                else:
                    nodes.add("compute" + part)
        return nodes
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None


def board_is_running(pid, root):
    """Is this pid genuinely our board for this repository?

    A pid alone proves nothing: it may have been recycled, and on a shared
    filesystem the record may have been written by a different machine
    altogether. Check that the process is actually serving this directory.
    """
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
    except (OSError, TypeError, ValueError):
        return False
    args = _cmdline(pid)
    if args is None:
        return True          # cannot tell; the pid is alive, so believe it
    return "serve.py" in args and os.path.abspath(root) in args


def pid_alive(pid, needle=None):
    """Is this pid alive here, and does it still look like what was recorded?

    Pids are recycled, so a bare signal-0 check will eventually report a
    stranger's process as ours. Where the command line can be read, the recorded
    command has to still be in it.
    """
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
    except (OSError, TypeError, ValueError):
        return False
    if not needle:
        return True
    args = _cmdline(pid)
    if args is None:
        return True          # cannot tell; the pid is alive, so believe it
    return os.path.basename(str(needle)) in args


def agent_is_attached(record, host):
    """Is the assistant this record describes still there?

    Two kinds of record, and they expire for different reasons. A headless daemon
    writes a heartbeat as it works, so two minutes of silence means it died. An
    interactive assistant sits idle for exactly as long as the person in front of
    it is thinking, and a heartbeat there would call a perfectly healthy session
    dead the moment somebody went to make tea -- so the process itself is the
    answer, and its pid is what gets checked.

    Either way the host is compared first: the home directory is shared across
    compute nodes, and a pid from a node whose allocation has ended is very
    likely alive here and belonging to a stranger.
    """
    if not record:
        return False
    if record.get("host") and record["host"] != host:
        return False
    if record.get("mode") == "interactive":
        return pid_alive(record.get("pid"), record.get("cmd"))
    # A daemon records its own pid, and a process either exists or it does not --
    # which is a better answer than a heartbeat and cannot go stale mid-thought.
    # The heartbeat used to be the only test, and since it is written at turn
    # boundaries, any turn longer than the window reported a daemon busy teaching
    # as dead. A teaching turn routinely takes longer than two minutes.
    if record.get("pid"):
        return pid_alive(record["pid"])
    return (time.time() - record.get("last_seen", 0)) <= 120


def _cmdline(pid):
    proc = "/proc/%s/cmdline" % pid
    if os.path.exists(proc):
        try:
            with open(proc, "rb") as fh:
                return fh.read().replace(b"\x00", b" ").decode("utf-8", "replace")
        except OSError:
            return None
    try:
        import subprocess
        out = subprocess.run(["ps", "-p", str(pid), "-o", "args="],
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
        return out.stdout.decode("utf-8", "replace") if out.returncode == 0 else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# What this machine calls itself
# ---------------------------------------------------------------------------
# Every record that crosses `live/` carries this name, and every liveness check
# compares it before trusting a pid. So if it moves, a machine stops recognising
# its own boards: `tutor restart` skips them as another node's, the hub says they
# are running somewhere else, and a board that is answering perfectly well
# becomes impossible to bounce onto new code. That is not hypothetical -- it
# happened here, and it cost an evening of wondering why a shipped fix had not
# landed.
#
# It moved because nothing had pinned it. A Mac with no `HostName` set derives
# its name from the network, so Tailscale's DNS renamed this machine from
# `mac-mini` to `board` between one board starting and the next command asking
# who was running it. Worse, the name was being *derived* in four places in four
# files -- `os.uname()` in the launcher, `socket.gethostname()` in the board and
# the server -- which can disagree with each other on the same machine.
#
# So: one function, and a pinned answer. The board is not entitled to a stable
# machine name from the operating system, so it keeps its own.
STATE_DIR = os.environ.get("BOARD_STATE_DIR") or \
    os.path.join(HOME, ".local", "state", "tutor-board")
NODE_NAME_FILE = os.path.join(STATE_DIR, "nodename")


def _normal_node(name):
    """One form for one machine.

    First label, lowercased: `board.tail0c6c62.ts.net` and `Mac-mini` and
    `mac-mini` must not be three machines, because a record written under one
    spelling has to be believed under another.
    """
    return (name or "").strip().split(".")[0].lower() or "unknown"


def system_node_name():
    """Whatever the operating system says today. Not to be trusted alone."""
    return _normal_node(os.uname().nodename)


def node_name():
    """What this machine calls itself. The only place that decides.

    Most explicit first: the environment (for a test, or a one-off), then the
    pinned file, then -- only when nothing has ever pinned one -- the system.
    """
    env = os.environ.get("BOARD_NODE_NAME")
    if env and env.strip():
        return _normal_node(env)
    try:
        with open(NODE_NAME_FILE, "r", encoding="utf-8") as fh:
            name = fh.read().strip()
            if name:
                return _normal_node(name)
    except OSError:
        pass
    return system_node_name()


def node_name_pinned():
    """The pinned name, or None if this machine is still trusting the network."""
    try:
        with open(NODE_NAME_FILE, "r", encoding="utf-8") as fh:
            return _normal_node(fh.read()) or None
    except OSError:
        return None


def should_pin_node_name():
    """Is this a machine whose name is worth freezing?

    Not on a cluster. There the name changes between allocations because it is
    genuinely a different machine each time, and that is load-bearing: every
    liveness check asks Slurm whether the node in a record is still one you hold.
    Pin `compute301` and the next allocation calls itself `compute301` while
    Slurm says you have `compute309`, so `tutor resume` refuses to start a board
    on a machine it thinks is not yours, and a record from a node that really has
    gone looks alive for ever.

    The instability this fixes is a different one: a Mac with no `HostName` set
    taking its name from whatever DNS answers that day, which is not a change of
    machine at all.
    """
    return slurm_nodes() is None


def pin_node_name(name=None):
    """Freeze this machine's name so the network cannot change it underneath us.

    With no argument it pins whatever the machine is called right now, which is
    the right move the first time: it freezes a name that already matches the
    records sitting on disk. Returns the name pinned.

    Callers that pin automatically must ask `should_pin_node_name()` first; a
    person naming one explicitly is always obeyed.
    """
    name = _normal_node(name) if name else system_node_name()
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = NODE_NAME_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(name + "\n")
    os.replace(tmp, NODE_NAME_FILE)
    return name


# ---------------------------------------------------------------------------
# Tailscale
# ---------------------------------------------------------------------------
# BOARD_STATE_DIR exists so a test can be run without writing the real thing.
# It is not a convenience: a bootstrap test once set this machine's tailnet name
# to the name of a different machine, which silently moved the address the iPad
# app was installed against. State that a test can reach is state a test will
# eventually corrupt.
TS_DIR = os.environ.get("BOARD_STATE_DIR") or os.path.join(HOME, ".local", "state", "tailscale")
TS_SOCK = os.path.join(TS_DIR, "tailscaled.sock")

# Where a system-managed Tailscale keeps its CLI when it is not simply on PATH.
SYSTEM_TS = [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",     # the Mac App Store build
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/bin/tailscale",
]


TS_NAME_FILE = os.path.join(TS_DIR, "hostname")


def tailnet_hostname():
    """What this machine calls itself on the tailnet.

    Defaults to `board`, which is what makes the address survive moving between
    compute nodes on a shared home. A second machine -- an always-on Mac beside
    an occasional cluster node -- needs its own name, or the two fight over one
    identity. Set once with `board vpn up --hostname <name>`.
    """
    env = os.environ.get("BOARD_TAILNET_NAME")
    if env:
        return env
    try:
        with open(TS_NAME_FILE, "r", encoding="utf-8") as fh:
            name = fh.read().strip()
            if name:
                return name
    except OSError:
        pass
    return "board"


def set_tailnet_hostname(name):
    os.makedirs(TS_DIR, exist_ok=True)
    with open(TS_NAME_FILE, "w", encoding="utf-8") as fh:
        fh.write(name.strip() + "\n")


# ---------------------------------------------------------------------------
# Exit nodes, and whether a turn can actually leave the building
# ---------------------------------------------------------------------------
# An exit node routes ALL of this machine's outbound traffic through somewhere
# else. Tailnet traffic is untouched, so the iPad reaches the board exactly as
# before and nothing about serving a lesson notices -- but every request the
# tutor makes to its provider now egresses from another country, and commercial
# VPN egress is precisely the sort of address a provider geo-blocks, rate-limits
# or challenges. The failure is total and looks like nothing: turns fail, the
# board shows a tutor listening, and the log fills with errors nobody reads.
#
# WHICH endpoints a turn needs is configuration, not code. The board is not
# allowed to know which assistant is driving it -- that is the same rule that
# makes a model a command recipe rather than a field -- so this is a list of URLs
# in the config with a default that happens to suit the default agent. Point it
# somewhere else and nothing here changes.
DEFAULT_EGRESS_PROBE = ("https://api.anthropic.com/v1/messages",)

# Exit nodes known to have carried a real turn. Tried first on a rotation,
# because the only evidence that an exit node works is that it once did.
EGRESS_KNOWN_GOOD = os.path.join(STATE_DIR, "egress-ok.json")


def egress_probe_urls():
    try:
        with open(CONFIG, "r", encoding="utf-8") as fh:
            cfg = json.load(fh) or {}
    except (OSError, ValueError):
        cfg = {}
    urls = cfg.get("egress_probe")
    if isinstance(urls, str):
        urls = [urls]
    return tuple(urls) if urls else DEFAULT_EGRESS_PROBE


def egress_ok(timeout=12):
    """Can a turn reach what it needs from here?

    ANY http answer counts, including 401 and 405. We are asking whether the
    packets arrive, not whether we are allowed in -- an unauthenticated probe
    that gets a 401 has proved the whole path. Only a connection failure, a DNS
    failure or a timeout means the egress is broken, which is exactly the shape a
    bad exit node produces.
    """
    import urllib.error
    import urllib.request
    for url in egress_probe_urls():
        req = urllib.request.Request(url, data=b"{}", method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=timeout)
            return True
        except urllib.error.HTTPError:
            return True                      # it answered; that is the question
        except (urllib.error.URLError, OSError):
            continue
    return False


def _ts_status():
    prefix, _ = tailscale_cli()
    if not prefix:
        return {}
    import subprocess
    try:
        p = subprocess.run(prefix + ["status", "--json"], stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, timeout=20)
        return json.loads(p.stdout.decode("utf-8", "replace")) or {}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}


def exit_node(status=None):
    """The exit node this machine is using, or None. Name and address."""
    st = status if status is not None else _ts_status()
    for peer in (st.get("Peer") or {}).values():
        if peer.get("ExitNode"):
            ips = peer.get("TailscaleIPs") or []
            return {"name": peer.get("HostName") or peer.get("DNSName", "").split(".")[0],
                    "ip": ips[0] if ips else None}
    return None


def exit_node_options(status=None):
    """Every peer offering to be an exit node, as name and address.

    The address is what matters: `tailscale set --exit-node` refuses a bare
    hostname it does not recognise, and an IP is never ambiguous.
    """
    st = status if status is not None else _ts_status()
    out = []
    for peer in (st.get("Peer") or {}).values():
        if not peer.get("ExitNodeOption"):
            continue
        ips = peer.get("TailscaleIPs") or []
        if not ips:
            continue
        out.append({"name": peer.get("HostName") or peer.get("DNSName", "").split(".")[0],
                    "ip": ips[0], "online": bool(peer.get("Online"))})
    return sorted(out, key=lambda p: p["name"])


def set_exit_node(ip):
    """Point this machine's egress at one exit node. Never turns one off.

    Disabling would be the obvious repair and it is the wrong one: somebody
    running everything through an exit node is doing it on purpose, and silently
    dropping back to the bare connection would expose the address they arranged
    not to expose in order to fix a tutoring session. If nothing works, the
    original is put back and the fault is reported.
    """
    prefix, _ = tailscale_cli()
    if not prefix or not ip:
        return False
    import subprocess
    try:
        p = subprocess.run(prefix + ["set", "--exit-node=" + ip],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=40)
        return p.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _known_good():
    try:
        with open(EGRESS_KNOWN_GOOD, "r", encoding="utf-8") as fh:
            got = json.load(fh)
        return [x for x in got if isinstance(x, str)] if isinstance(got, list) else []
    except (OSError, ValueError):
        return []


def remember_good_exit_node(ip):
    if not ip:
        return
    seen = [x for x in _known_good() if x != ip]
    seen.insert(0, ip)
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        tmp = EGRESS_KNOWN_GOOD + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(seen[:12], fh)
        os.replace(tmp, EGRESS_KNOWN_GOOD)
    except OSError:
        pass


def rotate_exit_node(tries=4, log=None, settle=4.0):
    """Find an exit node a turn can actually get out through.

    Returns (ok, detail). Only ever called when egress is already broken, so the
    machine starts in a state nobody wants to keep.

    Order: exit nodes that have carried a turn before, then the rest. Each one is
    tried and then PROVED, because the only way to know whether a provider
    answers from a given country is to ask from it. Bounded, because a rotation
    that walks four hundred Mullvad endpoints is an outage of its own.

    If nothing works the original is restored: a machine on a broken exit node
    the person chose is a better place to leave them than a machine on a random
    one they did not.
    """
    import time as _t

    def note(msg):
        if log:
            log(msg)

    status = _ts_status()
    was = exit_node(status)
    if not was:
        note("no exit node in use; the egress fault is not one this can repair")
        return False, "no exit node"

    options = [o for o in exit_node_options(status)
               if o["online"] and o["ip"] != was["ip"]]
    if not options:
        return False, "no other exit node is available"

    good = _known_good()
    options.sort(key=lambda o: good.index(o["ip"]) if o["ip"] in good else len(good))

    for cand in options[:max(1, tries)]:
        note("egress: trying exit node %s" % cand["name"])
        if not set_exit_node(cand["ip"]):
            continue
        _t.sleep(settle)                  # the route does not move instantly
        if egress_ok():
            remember_good_exit_node(cand["ip"])
            note("egress: %s works; staying there" % cand["name"])
            return True, cand["name"]

    set_exit_node(was["ip"])
    note("egress: no exit node tried could reach it; put %s back" % was["name"])
    return False, "tried %d, none worked" % min(len(options), max(1, tries))


# ---------------------------------------------------------------------------
# When the provider says no more, and until when
# ---------------------------------------------------------------------------
# A usage limit is not a broken turn and must not be treated as one. Nothing
# about the machine is wrong: the network is fine, the agent is installed, the
# recipe is right, and the same turn will succeed later without a thing being
# changed. What has run out is an allowance, it belongs to an account rather
# than to a course, and it ends at a time the provider usually names.
#
# So it is recorded once per MACHINE -- every board here is equally unable to
# teach -- and it carries an expiry, because a limit that has to be cleared by
# hand is a limit that outlives itself and quietly demotes a machine for days.
#
# WHAT a limit looks like is configuration, not code, for the same reason the
# egress probe is: the board is not allowed to know which assistant is driving
# it. These are the phrases the default agent uses; point `usage_limit_says` at
# other ones and nothing here changes.
DEFAULT_USAGE_LIMIT_SAYS = (
    # Claude Code says this, and names the epoch second the allowance returns --
    # which is worth far more than any window we could guess.
    r"usage limit reached\s*\|\s*(\d{9,})",
    r"usage limit reached",
    r"limit reached[^\n]{0,40}resets",
    r"\brate[ _-]?limit(?:_?error)?\b",
    r"\bquota (?:exceeded|exhausted)\b",
    r"\binsufficient[_ ]quota\b",
)

# How long a limit lasts when the provider did not say. Long enough not to
# thrash -- every expiry costs one more failed turn to rediscover -- and short
# enough that an allowance which came back is picked up the same evening.
DEFAULT_LIMIT_WINDOW = 3600

# A day is the most we will believe from a reset time we were handed. A parse
# that goes wrong on a stray long number must not take the machine out for a
# year.
LIMIT_CEILING = 24 * 3600

LIMIT_RECORD = os.path.join(STATE_DIR, "limited.json")


def usage_limit_says():
    try:
        with open(CONFIG, "r", encoding="utf-8") as fh:
            cfg = json.load(fh) or {}
    except (OSError, ValueError):
        cfg = {}
    says = cfg.get("usage_limit_says")
    if isinstance(says, str):
        says = [says]
    return tuple(says) if says else DEFAULT_USAGE_LIMIT_SAYS


def limit_window():
    try:
        with open(CONFIG, "r", encoding="utf-8") as fh:
            cfg = json.load(fh) or {}
    except (OSError, ValueError):
        cfg = {}
    try:
        return max(60, int(cfg.get("usage_limit_window") or DEFAULT_LIMIT_WINDOW))
    except (TypeError, ValueError):
        return DEFAULT_LIMIT_WINDOW


def reads_as_usage_limit(text, now=None):
    """Did this failed turn fail because the allowance ran out? Until when?

    Returns the epoch second the allowance is expected back, or None if this does
    not look like a limit at all. A pattern that captures a number is believed to
    have captured the reset time -- that is the whole reason the epoch form is
    first in the list -- and anything outside a day from now is treated as a
    misread and replaced with the ordinary window.

    Only ever asked of a turn that has ALREADY failed. Reading every successful
    turn's output for phrases about limits would find them in the lesson: a
    course on queueing theory says "rate limit" in earnest.
    """
    import re
    if not text:
        return None
    now = now or time.time()
    for pattern in usage_limit_says():
        try:
            m = re.search(pattern, text, re.IGNORECASE)
        except re.error:
            continue                 # a bad pattern in the config is not a crash
        if not m:
            continue
        when = None
        if m.groups() and m.group(1):
            try:
                when = float(m.group(1))
            except (TypeError, ValueError):
                when = None
        if when is None or not (now < when <= now + LIMIT_CEILING):
            when = now + limit_window()
        return when
    return None


def mark_limited(until, agent=None, node=None):
    """Write down that this machine's tutor has nothing left to spend.

    The node name goes in because the home directory is shared between compute
    nodes: a limit hit on the allocation that ended yesterday is not this
    machine's news, and a record that outlives its writer would demote a node
    that never had a turn fail.
    """
    rec = {"until": float(until), "agent": agent,
           "node": node or node_name(), "at": time.time()}
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = LIMIT_RECORD + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(rec, fh, indent=2)
    os.replace(tmp, LIMIT_RECORD)
    return rec


def limit_record(now=None):
    """The live limit on THIS machine, or {}. Expired and foreign ones are gone."""
    try:
        with open(LIMIT_RECORD, "r", encoding="utf-8") as fh:
            rec = json.load(fh) or {}
    except (OSError, ValueError):
        return {}
    if not isinstance(rec, dict):
        return {}
    if rec.get("node") and rec["node"] != node_name():
        return {}
    try:
        until = float(rec.get("until") or 0)
    except (TypeError, ValueError):
        return {}
    return rec if until > (now or time.time()) else {}


def limited_until(now=None):
    """When this machine's allowance comes back, or 0 if it never went."""
    rec = limit_record(now)
    return float(rec.get("until") or 0) if rec else 0.0


def clear_limited():
    """Forget the limit -- because a turn just succeeded, or a person said so."""
    try:
        os.remove(LIMIT_RECORD)
        return True
    except OSError:
        return False


# ---------------------------------------------------------------------------
# What a model thought, and what it said
# ---------------------------------------------------------------------------
# A reasoning model answers in two registers. There is the answer, and there is
# the working it did to reach the answer -- "the user is asking about Galois
# correspondence, let me first recall...", several hundred words of it, in the
# first person, addressed to nobody. Providers are supposed to keep the second
# out of `message.content` and hand it back separately. Many do not: some wrap it
# in `<think>` tags inside the content, some emit the OpenAI harmony channel
# markers, and some free endpoints simply forward whatever the model produced.
#
# On a board that is the worst possible leak, because the card IS the lesson.
# A student reading a tutor's private deliberation about them is not reading a
# lesson at all, and there is no undo: the card is written to disk, pushed to
# every device, and committed to the transcript.
#
# So the rule is that nothing anywhere trusts a model to have kept its thinking
# to itself. This is the one place that knows what thinking looks like; the
# tutor strips it as it comes off the wire, and `board write` strips it again on
# the way in, because the second gate catches an agent this repository has never
# heard of.
REASONING_TAGS = ("think", "thinking", "thought", "thoughts", "reason",
                  "reasoning", "reflection", "scratchpad", "analysis",
                  "internal", "monologue")

_TAGS = "|".join(REASONING_TAGS)

# A whole block, opened and closed. The backreference matters: `<think>...</see>`
# is not a reasoning block and must not swallow the card behind it.
_PAIRED = re.compile(r"<\s*(%s)\b[^>]*>.*?<\s*/\s*\1\s*>" % _TAGS,
                     re.DOTALL | re.IGNORECASE)
# An opening tag with no close: the thinking ran into the token ceiling and there
# is no answer after it, so everything from the tag on is thought.
_UNCLOSED = re.compile(r"<\s*(?:%s)\b[^>]*>.*\Z" % _TAGS, re.DOTALL | re.IGNORECASE)
# A close with no open, which is what a provider that strips the opening tag and
# nothing else leaves behind. Everything before it was the thinking.
_ORPHAN_CLOSE = re.compile(r"^.*<\s*/\s*(?:%s)\s*>" % _TAGS, re.DOTALL | re.IGNORECASE)
# The bracket form, for the models that write markers rather than tags.
_BRACKETED = re.compile(r"\[\s*(%s)\s*\].*?\[\s*/\s*\1\s*\]" % _TAGS,
                        re.DOTALL | re.IGNORECASE)

# OpenAI's harmony format, which gpt-oss speaks: the reply is a sequence of
# channels and only the `final` one is for the reader.
_HARMONY_FINAL = re.compile(r"<\|channel\|>\s*final\s*<\|message\|>", re.IGNORECASE)
_HARMONY_OTHER = re.compile(
    r"<\|channel\|>\s*(?:analysis|commentary|critic)[^<]*<\|message\|>"
    r".*?(?=<\|(?:start|end|return|channel)\|>|\Z)", re.DOTALL | re.IGNORECASE)
_HARMONY_TOKEN = re.compile(r"<\|[a-z_]+\|>", re.IGNORECASE)


def _starts_with_reasoning(text):
    """Does this reply OPEN with thinking? Cheap, and the only question the
    second gate is allowed to ask -- a card about reasoning models may say the
    word `<think>` in the middle of a sentence, and a lesson is not ours to edit."""
    head = (text or "").lstrip()
    if not head:
        return False
    for rx in (_PAIRED, _UNCLOSED, _BRACKETED):
        m = rx.match(head)
        if m:
            return True
    return bool(_HARMONY_FINAL.match(head) or _HARMONY_OTHER.match(head)
                or head.startswith("<|"))


def strip_reasoning(text, leading_only=False):
    """The answer, with the model's private working taken out of it.

    `leading_only` strips a block the reply OPENS with and leaves the rest of the
    text exactly as written. That is the right setting anywhere the text might be
    a lesson somebody wrote on purpose; the wire is the place for the thorough
    pass.

    Returns "" when the reply was nothing but thinking, which is a real outcome
    -- the model spent its whole budget deliberating -- and the caller's job is
    to retry rather than to write an empty card.
    """
    t = text or ""
    if not t.strip():
        return ""
    if leading_only and not _starts_with_reasoning(t):
        return t

    if _HARMONY_FINAL.search(t):
        t = t[_HARMONY_FINAL.search(t).end():]
        for stop in ("<|return|>", "<|end|>"):
            if stop in t:
                t = t.split(stop)[0]
    else:
        t = _HARMONY_OTHER.sub("", t)
    t = _HARMONY_TOKEN.sub("", t)

    t = _PAIRED.sub("", t)
    t = _BRACKETED.sub("", t)
    # Order matters: an orphan close is only orphaned once the paired blocks are
    # gone, and an unclosed open is only unclosed once we have looked for a close
    # after it.
    if _ORPHAN_CLOSE.search(t):
        t = _ORPHAN_CLOSE.sub("", t, count=1)
    t = _UNCLOSED.sub("", t)
    return t.strip()


def tailscale_cli():
    """(argv_prefix, kind) for talking to whichever tailscale this machine has.

    Two shapes exist. On a machine with no administrator rights we run our own
    `tailscaled` in userspace mode and talk to it over a socket in the home
    directory. On a machine where Tailscale is already installed and running --
    a Mac, most obviously -- there is nothing to start and no socket to name;
    the system CLI is already connected and we should not fight it.
    """
    if os.path.exists(TS_SOCK):
        return (["tailscale", "--socket", TS_SOCK], "userspace")
    found = shutil.which("tailscale")
    if found:
        return ([found], "system")
    for p in SYSTEM_TS:
        if os.path.exists(p):
            return ([p], "system")
    return (None, "missing")


def follow_config():
    """The `follow` block of the config, or {} when there is none.

    The block is what marks a machine as the always-on host, so both the server
    and the launcher read it through this one place.
    """
    try:
        with open(CONFIG, "r", encoding="utf-8") as fh:
            cfg = json.load(fh) or {}
    except (OSError, ValueError):
        return {}
    return cfg.get("follow") or {}


def machine_shape():
    """What this machine is for: always-on host, compute node, or standalone.

    Guessing this from the hostname is how it gets subtly wrong, so it is
    decided from what is actually true: an always-on host is configured to
    follow, a compute node is where Slurm answers, and everything else is a
    standalone machine.
    """
    if follow_config():
        return "always-on host"
    if slurm_nodes() is not None:
        return "compute node"
    return "standalone"


def tailscale_download_hint():
    """The right static build to fetch, for a machine that needs its own."""
    import platform
    sysname = platform.system().lower()
    machine = platform.machine().lower()
    if sysname == "darwin":
        return ("Tailscale on macOS is an application, not a static binary.\n"
                "Install it from the App Store or tailscale.com/download and sign in;\n"
                "there is no daemon for the board to start.")
    arch = {"x86_64": "amd64", "amd64": "amd64",
            "aarch64": "arm64", "arm64": "arm64"}.get(machine, "amd64")
    return ("mkdir -p ~/.local/opt/tailscale\n"
            "curl -L https://pkgs.tailscale.com/stable/tailscale_1.102.3_%s.tgz \\\n"
            "  | tar xz --strip-components=1 -C ~/.local/opt/tailscale\n"
            "ln -s ~/.local/opt/tailscale/tailscale{,d} ~/.local/bin/" % arch)
