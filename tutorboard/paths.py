"""Where this machine keeps what it knows about itself.

One directory, a few files in it, and the rule for telling two spellings of
one directory apart. Everything else reads its state through these names, so
a test can move the lot by assigning to them.
"""

import os


HOME = os.path.expanduser("~")

# The tool itself: where web/, tex/ and the scripts live. Derived from this
# file's location so it is right however the package was reached -- this home is
# spelled two different ways depending on which mount you arrived by, and a
# constant typed out anywhere else would eventually be the wrong one.
TOOL = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
WEB = os.path.join(TOOL, "web")

CONFIG_DIR = os.path.join(
    os.environ.get("XDG_CONFIG_HOME", os.path.join(HOME, ".config")),
    "tutor-board")
CONFIG = os.path.join(CONFIG_DIR, "config.json")
CHOSEN = os.path.join(CONFIG_DIR, "chosen.json")

def same_dir(a, b):
    """Are these two paths the same directory, whatever they are spelled like?

    They are, far more often than anything here assumed. This home directory is
    reachable as both `/home/<user>/…` and `/mnt/dell_storage/homefolders/<user>/…`,
    and which one you get depends on how you arrived: a board records the path it
    was started with, and a command run from the other spelling then compares
    strings, finds no match, and concludes the board is not running. The hub
    showed every course as idle while one was answering on its port, and
    `board start` would happily have begun a second board for a course that
    already had one.
    """
    if not a or not b:
        return False
    try:
        return os.path.realpath(a) == os.path.realpath(b)
    except OSError:
        return os.path.abspath(a) == os.path.abspath(b)


# Where this machine keeps what it has worked out about itself: its pinned name,
# the exit node that was known to work, the record of a usage limit. Separate
# from the config directory because none of it is anybody's to edit.
#
# BOARD_STATE_DIR exists so a test can run without writing the real thing. That
# is not a convenience: a bootstrap test once set this machine's tailnet name to
# another machine's, which silently moved the address the iPad app is installed
# against. State a test can reach is state a test will eventually corrupt.
STATE_DIR = os.environ.get("BOARD_STATE_DIR") or \
    os.path.join(HOME, ".local", "state", "tutor-board")
