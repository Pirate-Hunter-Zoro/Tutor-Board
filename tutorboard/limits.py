"""When the provider says no more, and until when.

A usage limit is not a broken turn and must not be treated as one: nothing
about the machine is wrong, and the lesson should move to a machine that can
still teach rather than retry here.
"""

import json
import os
import re
import time

from . import machine, paths


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

LIMIT_RECORD = os.path.join(paths.STATE_DIR, "limited.json")


def usage_limit_says():
    try:
        with open(paths.CONFIG, "r", encoding="utf-8") as fh:
            cfg = json.load(fh) or {}
    except (OSError, ValueError):
        cfg = {}
    says = cfg.get("usage_limit_says")
    if isinstance(says, str):
        says = [says]
    return tuple(says) if says else DEFAULT_USAGE_LIMIT_SAYS


def limit_window():
    try:
        with open(paths.CONFIG, "r", encoding="utf-8") as fh:
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
           "node": node or machine.node_name(), "at": time.time()}
    os.makedirs(paths.STATE_DIR, exist_ok=True)
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
    if rec.get("node") and rec["node"] != machine.node_name():
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
