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


# ---------------------------------------------------------------------------
# Tailscale
# ---------------------------------------------------------------------------
TS_DIR = os.path.join(HOME, ".local", "state", "tailscale")
TS_SOCK = os.path.join(TS_DIR, "tailscaled.sock")

# Where a system-managed Tailscale keeps its CLI when it is not simply on PATH.
SYSTEM_TS = [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",     # the Mac App Store build
    "/usr/local/bin/tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/bin/tailscale",
]


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
