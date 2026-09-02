"""A course's port is a pure function of its directory name.

That is what lets the always-on host find a board on the compute node without
being able to read its filesystem: both machines derive the same number from
the same name, so nothing has to be published anywhere for a course to be
findable.
"""

import os


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
