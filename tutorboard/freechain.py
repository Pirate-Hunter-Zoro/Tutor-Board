"""What this machine can teach with for nothing, worked out rather than declared.

`bin/free` used to carry the model names in a tuple at the top of the file. That
tuple is a promise about somebody else's catalogue, and it was wrong within the
week: on 7 September 2026 two of its five OpenRouter models answered 404 --
*"this model is unavailable for free, the paid version is available now"* -- and
the chain had quietly become three models deep with nobody able to see that it
had. A name going stale is not a rare event on a free tier. It is the normal
weather there, and the whole point of this file is that the normal weather must
not require a debugging session.

So the chain is DISCOVERED. Both providers publish what they serve; ask them,
keep the ones that are free and can hold a conversation, and put them in an
order. Three things then hold it together:

  * **A preference list, not a permission list.** Models we have actually seen
    teach well lead. Everything else the provider offers follows, best-guess
    order, rather than being excluded -- so a model published tomorrow is in the
    chain tomorrow, at the back, and the chain never empties just because our
    favourites were retired.

  * **A refusal list that is about SHAPE, not quality.** A safety classifier, a
    transcription model and an embedding model are all "free chat completions"
    to a catalogue and none of them can write a card. Those are excluded by what
    they are.

  * **A memory of what has died.** A model that answers "no such model" is
    written down and skipped for a week, so the same dead name is not retried on
    every turn of every lesson.

And a pinned list underneath all of it, for a machine that cannot reach the
catalogue at the moment it needs to teach. It is a floor, never the plan.

Nothing here knows about tutoring. `bin/free` asks for a chain and walks it;
`board doctor` asks for a chain and probes it. Those are the only two callers,
and they see the same list, which is the property that makes the doctor's answer
worth anything.
"""

import json
import os
import re
import time
import urllib.error
import urllib.request

from . import paths


KEYS = os.path.join(paths.HOME, ".config", "api-keys")

# Groq sits behind a bot check that answers 403 (Cloudflare 1010) to a request
# with no browser User-Agent. Not a workaround anybody enjoys, and it is load
# bearing: without it the entire independent half of the chain is gone and the
# board has one provider and no fallback. Verified again on 7 September 2026 --
# identical request, UA present 200, UA absent 403.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


# ---------------------------------------------------------------------------
# The providers
# ---------------------------------------------------------------------------
# `quiet` is what this provider is asked in order NOT to send the model's
# thinking back inside `message.content`. Every model on this chain deliberates
# before it answers, and reasoning forwarded into the content becomes a card, and
# a card is the lesson. Asking is the cheap half of the defence; the other half
# is `reasoning.strip_reasoning`, which runs on every reply regardless, because a
# free endpoint ignoring a parameter it has never heard of is exactly the shape
# of this bug.
#
# `free_only` marks a catalogue where paid models sit alongside free ones and
# must be told apart by their name. Groq's free tier is the whole account, so
# everything it lists is in scope; OpenRouter bills by the model and only the
# `:free` slugs are.
PROVIDERS = (
    {
        "name": "openrouter",
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "models_url": "https://openrouter.ai/api/v1/models",
        "key": "openrouter_key",
        "key_for_catalogue": False,     # the catalogue is public
        "free_only": True,
        "quiet": {"reasoning": {"exclude": True}},
    },
    {
        "name": "groq",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "models_url": "https://api.groq.com/openai/v1/models",
        "key": "groq_key",
        "key_for_catalogue": True,
        "free_only": False,
        "quiet": {"reasoning_format": "hidden"},
    },
)


# ---------------------------------------------------------------------------
# What cannot write a card, whatever the catalogue calls it
# ---------------------------------------------------------------------------
# By shape, not by quality. Every one of these is a perfectly good model that is
# not a chat model: a safety classifier answers "safe"/"unsafe", a transcription
# model wants audio, an embedding model returns a vector. Handed a tutoring
# prompt they produce something, and that something reaches the board.
NOT_A_TUTOR = re.compile(
    r"guard|safety|safeguard|moderat|whisper|tts|speech|voice|orpheus"
    r"|embed|rerank|classif|ocr-only|image-gen|dall|flux|stable-diffusion",
    re.IGNORECASE)

# Free tiers carry a lot of very small models. A 3B model can hold a
# conversation; it cannot teach Galois theory, and putting one ahead of a 120B
# model wastes the turn the student is waiting through. Small models stay in the
# chain -- last -- because a small answer beats no answer.
TINY = re.compile(r"\b(?:0\.\d|[123])\s*b\b|-(?:0\.\d|[123])b(?:-|$)", re.IGNORECASE)


# ---------------------------------------------------------------------------
# What we have actually seen teach, best first
# ---------------------------------------------------------------------------
# A PREFERENCE, and the distinction matters more than anything else in this file.
# A model matching one of these leads the chain; a model matching none of them is
# still in the chain, behind them. Delete this list entirely and the tutor still
# works -- slightly worse, and entirely by itself, which is the property being
# bought here.
#
# Ordered by what a tutoring turn actually needs: something big enough to do the
# mathematics, that follows a format instruction, and that does not narrate.
PREFERRED = (
    r"nemotron-3-ultra",
    r"gpt-oss-120b",
    r"nemotron-3-super",
    r"dots-3",
    r"gemma-4-31b",
    r"gemma-4-26b",
    r"inkling(?!-small)",
    r"nemotron-3\.5-lightning",
    r"qwen3",
    r"gpt-oss-20b",
    r"inkling-small",
    r"north-mini",
    r"laguna",
)

# Models tied to one subject. Fine at it, wrong for a course about anything else,
# so they go behind the general ones rather than being excluded -- on a night
# when nothing else answers, a finance model that can do algebra is the lesson.
NARROW = re.compile(r"-sante|-fin\b|-med\b|-legal", re.IGNORECASE)


# ---------------------------------------------------------------------------
# The floor
# ---------------------------------------------------------------------------
# Where the chain starts on a machine that cannot reach either catalogue right
# now. Verified answering on 7 September 2026. It is deliberately short: its job
# is to get one card written on a bad night, not to be a second catalogue that
# also goes stale. Discovery replaces it entirely the moment it succeeds.
PINNED = {
    "openrouter": ("nvidia/nemotron-3-ultra-550b-a55b:free",
                   "nvidia/nemotron-3-super-120b-a12b:free",
                   "dots-studio/dots-3-note-preview:free",
                   "cohere/north-mini-code:free"),
    "groq": ("openai/gpt-oss-120b", "openai/gpt-oss-20b"),
}
PINNED_VISION = {
    "openrouter": ("dots-studio/dots-3-note-preview:free",
                   "google/gemma-4-31b-it:free"),
    "groq": (),
}


CACHE = os.path.join(paths.STATE_DIR, "free-models.json")
CACHE_TTL = 6 * 3600            # a catalogue does not move faster than this
DEAD = os.path.join(paths.STATE_DIR, "free-models-dead.json")
DEAD_TTL = 7 * 24 * 3600        # long enough not to retry, short enough to heal


def offline():
    """Set BOARD_OFFLINE=1 to keep this file off the network.

    For tests, and for anybody reasoning about a turn without wondering whether a
    catalogue fetch changed the answer underneath them.
    """
    return bool((os.environ.get("BOARD_OFFLINE") or "").strip())


def read_key(name):
    try:
        with open(os.path.join(KEYS, name), encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def _get_json(url, key=None, timeout=15):
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:   # noqa: S310
        return json.loads(resp.read().decode("utf-8", "replace"))


# ---------------------------------------------------------------------------
# Dead models
# ---------------------------------------------------------------------------
# "This model is unavailable for free. The paid version is available now" is the
# 404 that started this file. It is not a transient failure and it is not worth a
# round trip on every turn for the next month, so it is written down.
DEAD_SAYS = re.compile(
    r"unavailable for free|no (?:such|endpoints? found for) model|model_not_found"
    r"|does not exist|is not a valid model|has been (?:deprecated|decommissioned)"
    r"|no longer (?:available|supported)",
    re.IGNORECASE)


def reads_as_dead(status, text):
    """Did the provider say this model is gone, as opposed to busy or broken?

    A 429 is a model that is fine and rate-limited; retiring it over that would
    empty the chain on a busy evening. Only a refusal that names the MODEL counts.
    """
    if status not in (400, 404):
        return False
    return bool(DEAD_SAYS.search(text or "")) or status == 404


def _load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        return doc if isinstance(doc, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(path, doc):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, path)
    except OSError:
        pass


def dead_models(now=None):
    """{"provider/model": when it was buried}, expired entries dropped."""
    now = now or time.time()
    doc = _load(DEAD)
    return {k: v for k, v in doc.items()
            if isinstance(v, (int, float)) and now - v < DEAD_TTL}


def bury(provider, model, why=""):
    """Remember that this model is gone, so the next turn does not find out again."""
    doc = dead_models()
    doc["%s/%s" % (provider, model)] = time.time()
    _save(DEAD, doc)
    return why


def exhume(provider=None, model=None):
    """Forget what died -- because a person said so, or a catalogue disagreed."""
    if provider is None:
        _save(DEAD, {})
        return
    doc = dead_models()
    doc.pop("%s/%s" % (provider, model), None)
    _save(DEAD, doc)


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------
def _entries(provider, doc):
    """(id, context, modalities) for every model in a catalogue reply.

    Both providers answer OpenAI's shape -- `{"data": [...]}` -- and differ only
    in what they hang off each entry, so one reader does both and simply misses
    what is not there.
    """
    out = []
    for m in (doc or {}).get("data") or []:
        if not isinstance(m, dict):
            continue
        mid = m.get("id") or ""
        if not mid:
            continue
        if provider["free_only"] and not mid.endswith(":free"):
            continue
        arch = m.get("architecture") or {}
        mods = arch.get("input_modalities") or (["text"] if not arch else [])
        try:
            ctx = int(m.get("context_length") or m.get("context_window") or 0)
        except (TypeError, ValueError):
            ctx = 0
        out.append({"id": mid, "context": ctx, "modalities": list(mods)})
    return out


def _rank(mid, ctx):
    """Sort key: preferred first in their own order, then everything else.

    The tail is ordered by context length purely because it is the only quality
    signal a catalogue reliably carries. It is a guess, and it is a guess about
    models nobody here has tried, which is exactly where a guess belongs.
    """
    for i, pat in enumerate(PREFERRED):
        if re.search(pat, mid, re.IGNORECASE):
            return (0, i, 0)
    penalty = (1 if NARROW.search(mid) else 0) + (1 if TINY.search(mid) else 0)
    return (1, penalty, -ctx)


def fetch_catalogue(timeout=15):
    """Ask every provider what it serves. {} for one we could not reach."""
    found = {}
    for p in PROVIDERS:
        if p["key_for_catalogue"] and not read_key(p["key"]):
            continue
        key = read_key(p["key"]) if p["key_for_catalogue"] else None
        try:
            doc = _get_json(p["models_url"], key, timeout=timeout)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError):
            continue
        entries = _entries(p, doc)
        if entries:
            found[p["name"]] = entries
    return found


def catalogue(refresh=None):
    """What each provider serves, cached on disk.

    Refreshed when stale, and the stale copy is used when the refresh fails --
    a catalogue we cannot reach is not a reason to stop teaching, and yesterday's
    list is very nearly today's.
    """
    doc = _load(CACHE)
    fresh = (time.time() - float(doc.get("at") or 0)) < CACHE_TTL
    have = doc.get("providers") or {}
    if refresh is False or (refresh is None and (fresh and have)) or offline():
        return have
    found = fetch_catalogue()
    if not found:
        return have                      # keep the stale one; it is what we have
    _save(CACHE, {"at": time.time(), "providers": found})
    # A model the catalogue lists again is a model that is not dead, whatever we
    # wrote down last week. The provider is the authority; our note was a guess
    # from one failed request.
    live = {"%s/%s" % (name, e["id"]) for name, es in found.items() for e in es}
    buried = dead_models()
    still = {k: v for k, v in buried.items() if k not in live}
    if still != buried:
        _save(DEAD, still)
    return found


def _chain(want_vision, refresh=None):
    """Every free model this machine could use, best first, across all providers.

    Ranked as one list rather than provider by provider. The two catalogues are
    not tiers -- they are two independent free pools, and the reason both are
    here is that a daily cap on one must not starve the tutor. Ordering by
    provider would have put the whole of OpenRouter's list ahead of Groq's, and
    then `DEPTH` would have cut the chain off before it ever reached the second
    pool, which is the one failure this arrangement exists to prevent. Provider
    diversity is guaranteed at the cut instead -- see `_take`.
    """
    known = catalogue(refresh)
    buried = dead_models()
    out = []
    for p in PROVIDERS:
        if not read_key(p["key"]):
            continue
        entries = known.get(p["name"])
        if entries is None:
            pin = (PINNED_VISION if want_vision else PINNED).get(p["name"]) or ()
            entries = [{"id": m, "context": 0,
                        "modalities": ["text", "image"] if want_vision else ["text"]}
                       for m in pin]
        for e in entries:
            mid = e["id"]
            if NOT_A_TUTOR.search(mid):
                continue
            if "%s/%s" % (p["name"], mid) in buried:
                continue
            if want_vision and "image" not in [m.lower() for m in e["modalities"]]:
                continue
            out.append({"provider": p["name"], "url": p["url"], "key": p["key"],
                        "model": mid, "quiet": p["quiet"], "context": e["context"]})
    out.sort(key=lambda c: _rank(c["model"], c["context"]))
    return out


def _take(chain, depth):
    """The first `depth` of a ranked chain, with every provider still in it.

    A cut that keeps only the best N can keep only one pool's models, and then a
    provider having a bad day takes the tutor down with it even though the other
    pool is answering. So each provider present in the chain is guaranteed a
    place: the leaders fill the window, minus one seat held for each pool that
    has not got one yet.
    """
    if not depth or depth >= len(chain):
        return chain
    pools = []
    for c in chain:
        if c["provider"] not in pools:
            pools.append(c["provider"])
    out, seen = [], set()
    for c in chain:
        held = sum(1 for pool in pools if pool not in seen and pool != c["provider"])
        if len(out) + held >= depth and c["provider"] in seen:
            continue
        out.append(c)
        seen.add(c["provider"])
        if len(out) >= depth:
            break
    return out


# How deep the chain is walked on one turn. Not a limit on the catalogue -- a
# limit on how long a student waits while models are tried in turn. Six failures
# is already a minute of somebody sitting in front of a board.
DEPTH = 6


def text_chain(depth=DEPTH, refresh=None):
    """The models to try, in order, for writing a card. Best first."""
    return _take(_chain(False, refresh), depth)


def vision_chain(depth=3, refresh=None):
    """The models to try, in order, for reading handwriting off a page.

    Shallower on purpose: an image is a large request and a page that three
    vision models could not read is not going to be read by a fourth.
    """
    return _take(_chain(True, refresh), depth)


def providers_present():
    """Which providers this machine has a key for. The chain is empty without one."""
    return [p["name"] for p in PROVIDERS if read_key(p["key"])]


def missing_keys():
    """The key files this machine has not got, as paths a person can go and create."""
    return [os.path.join(KEYS, p["key"]) for p in PROVIDERS if not read_key(p["key"])]
