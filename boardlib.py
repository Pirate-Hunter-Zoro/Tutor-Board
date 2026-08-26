"""
boardlib.py -- the handful of things that differ between machines.

Both the server and the command line need to find a TeX installation and a
working `tailscale`, and neither should care whether it is running on a Linux
compute node, a Mac, or something else. Keeping the platform knowledge here means
there is one place to correct when it turns out to be wrong.

Standard library only, like everything else.
"""

import glob
import os
import shutil

HOME = os.path.expanduser("~")


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
