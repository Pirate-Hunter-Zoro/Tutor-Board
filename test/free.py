#!/usr/bin/env python3
"""Teaching for nothing: the chain that finds its own models, and the machine
that is not allowed to spend.

Two things are guarded here and they are the same thing twice.

**A model name is not a fact.** `bin/free` used to name five OpenRouter models in
a tuple. On 7 September 2026 two of them answered *"this model is unavailable for
free; the paid version is available now"* -- and the file went on naming them, the
chain was quietly three deep, and nothing anywhere said so. A free tier's
catalogue moves every few weeks. Anything that writes one down goes stale, and a
stale chain is a board that stops teaching for a reason nobody at the board can
see.

**A machine's spending is not a course's business.** The Mac mini is awake all
day and answers every time the iPad is picked up; the compute node holds the
allowance. Three separate things can name a paid agent from further away than the
Mac -- a course's `tutorboard.json`, which arrives by `git pull`; the `hosts`
table; and a `--agent` typed by somebody who forgot which machine they were on --
so `free_only` sits outside the resolution order rather than inside it.
"""

import importlib.machinery
import importlib.util
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

# Nothing in this file may touch the network or this machine's real state. The
# chain is discovered from a catalogue, and a suite that fetched the real one
# would pass or fail on somebody else's deployment schedule.
STATE = tempfile.mkdtemp(prefix="tutor-free-state-")
os.environ["BOARD_STATE_DIR"] = STATE
os.environ["BOARD_OFFLINE"] = "1"

from tutorboard import freechain, paths                     # noqa: E402
freechain.CACHE = os.path.join(STATE, "free-models.json")
freechain.DEAD = os.path.join(STATE, "free-models-dead.json")


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


tutor = load("tutor", os.path.join(ROOT, "bin", "tutor"))

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


# ---------------------------------------------------------------------------
# The chain is discovered, not declared
# ---------------------------------------------------------------------------
src_free = open(os.path.join(ROOT, "bin", "free"), encoding="utf-8").read()

check("bin/free no longer carries a list of model names",
      "PROVIDERS = (" not in src_free and "VISION_MODEL" not in src_free)
check("it asks freechain for the chain instead",
      "freechain.text_chain()" in src_free and "freechain.vision_chain()" in src_free)

# The paid vision model is the one that would have been invisible: handwriting is
# how nearly every answer arrives, and a tutor that exists in order to cost
# nothing was reading every page on a credit balance.
def literals(source):
    """Every string the file would actually USE, docstrings and comments aside.

    Grep is the wrong tool for this one question: the paid vision model is still
    named in `bin/free`, on purpose, in the note explaining why it went -- and
    that note is the most useful line in the function. What must not survive is
    the name being a value.
    """
    import ast as _ast
    tree = _ast.parse(source)
    docs = set()
    for node in _ast.walk(tree):
        if isinstance(node, (_ast.Module, _ast.FunctionDef, _ast.AsyncFunctionDef,
                             _ast.ClassDef)):
            body = getattr(node, "body", None) or []
            if body and isinstance(body[0], _ast.Expr) and \
                    isinstance(body[0].value, _ast.Constant) and \
                    isinstance(body[0].value.value, str):
                docs.add(id(body[0].value))
    return [n.value for n in _ast.walk(tree)
            if isinstance(n, _ast.Constant) and isinstance(n.value, str)
            and id(n) not in docs]


check("and reads handwriting on a free model rather than a billed one",
      not any("qwen" in lit for lit in literals(src_free)))

# Every model on this chain thinks before it answers, and on these providers the
# thinking is spent out of `max_tokens`. An 800-token cap on a 550B reasoner is a
# cap the model can spend entirely on deliberation, returning an empty `content`
# -- which reads from here as "the model returned nothing" and writes the turn
# off. The budget is not a length limit and must not be set like one.
check("a card's token budget leaves room for the model to think first",
      "CARD_LIMIT = 2400" in src_free)
check("and so does the one for reading a page", "OCR_LIMIT = 3000" in src_free)


# ---------------------------------------------------------------------------
# Ranking a catalogue
# ---------------------------------------------------------------------------
def catalogue(**providers):
    """Pretend both providers answered with these models."""
    doc = {}
    for name, entries in providers.items():
        doc[name] = [e if isinstance(e, dict)
                     else {"id": e, "context": 0, "modalities": ["text"]}
                     for e in entries]
    with open(freechain.CACHE, "w", encoding="utf-8") as fh:
        json.dump({"at": 9e9, "providers": doc}, fh)     # far future: never stale


# Keys are read off disk, so the suite needs its own.
KEYDIR = tempfile.mkdtemp(prefix="tutor-free-keys-")
for k in ("openrouter_key", "groq_key"):
    with open(os.path.join(KEYDIR, k), "w", encoding="utf-8") as fh:
        fh.write("test-key")
freechain.KEYS = KEYDIR

catalogue(
    openrouter=["tinylab/pocket-1b:free",
                "nvidia/nemotron-3-super-120b-a12b:free",
                "someone/brand-new-model-nobody-has-heard-of:free",
                "nvidia/nemotron-3.5-content-safety:free",
                "nvidia/nemotron-3-ultra-550b-a55b:free"],
    groq=["openai/gpt-oss-120b", "whisper-large-v3",
          "meta-llama/llama-prompt-guard-2-22m"])

chain = [c["model"] for c in freechain.text_chain(depth=None)]

check("a model we have seen teach leads the chain",
      chain[0] == "nvidia/nemotron-3-ultra-550b-a55b:free")
check("and the preference order among them is kept",
      chain.index("nvidia/nemotron-3-ultra-550b-a55b:free")
      < chain.index("openai/gpt-oss-120b")
      < chain.index("nvidia/nemotron-3-super-120b-a12b:free"))

# The distinction the whole file turns on. A model nobody here has heard of is
# still IN the chain -- behind the known ones -- because the alternative is a
# chain that empties itself every time a provider retires a favourite, which is
# precisely the failure being fixed.
check("a model published after this code was written is still in the chain",
      "someone/brand-new-model-nobody-has-heard-of:free" in chain)
check("behind the ones we have actually seen teach",
      chain.index("someone/brand-new-model-nobody-has-heard-of:free")
      > chain.index("nvidia/nemotron-3-super-120b-a12b:free"))
check("and a very small model is behind it in turn",
      chain.index("tinylab/pocket-1b:free")
      > chain.index("someone/brand-new-model-nobody-has-heard-of:free"))

# Excluded by SHAPE, not by quality: each of these is a good model that cannot
# hold a tutoring conversation, and a catalogue calls them all chat completions.
check("a safety classifier is not offered a lesson",
      not any("content-safety" in m for m in chain))
check("nor is a transcription model", "whisper-large-v3" not in chain)
check("nor a prompt guard", not any("prompt-guard" in m for m in chain))

# ---------------------------------------------------------------------------
# Both pools survive the cut
# ---------------------------------------------------------------------------
# Two providers are here because a daily cap on one must not starve the tutor.
# Ranking them into one list and then keeping the best six can keep six models
# from one pool -- and then a provider having a bad day takes the tutor down with
# it while the other pool is answering perfectly well.
catalogue(openrouter=["nvidia/nemotron-3-ultra-550b-a55b:free",
                      "nvidia/nemotron-3-super-120b-a12b:free",
                      "dots-studio/dots-3-note-preview:free",
                      "google/gemma-4-31b-it:free",
                      "google/gemma-4-26b-a4b-it:free",
                      "thinkingmachines/inkling:free",
                      "cohere/north-mini-code:free"],
           groq=["openai/gpt-oss-20b"])
cut = freechain.text_chain(depth=3)
check("the chain always keeps a model from every provider it has a key for",
      len({c["provider"] for c in cut}) == 2)
check("without giving up the best one to do it",
      cut[0]["model"] == "nvidia/nemotron-3-ultra-550b-a55b:free")

# ---------------------------------------------------------------------------
# Reading a page
# ---------------------------------------------------------------------------
catalogue(openrouter=[{"id": "text-only/model:free", "context": 0,
                       "modalities": ["text"]},
                      {"id": "sees/things:free", "context": 0,
                       "modalities": ["text", "image"]}],
          groq=[])
eyes = [c["model"] for c in freechain.vision_chain()]
check("only a model that takes images is asked to read handwriting",
      eyes == ["sees/things:free"])

# ---------------------------------------------------------------------------
# What has died stays dead, until the catalogue says otherwise
# ---------------------------------------------------------------------------
check("a 404 naming the model is a retirement",
      bool(freechain.reads_as_dead(404, "No endpoints found for model")))
check("so is the sentence a free tier actually sends",
      bool(freechain.reads_as_dead(
          400, "This model is unavailable for free. The paid version is "
               "available now - use this slug instead: minimax/minimax-m3")))
# The distinction that keeps the chain from emptying itself on a busy evening: a
# rate limit is a model that is fine and will answer in a minute.
check("a rate limit is not", not freechain.reads_as_dead(429, "rate-limited upstream"))
check("nor is a server having a bad day",
      not freechain.reads_as_dead(503, "upstream error"))

catalogue(openrouter=["a/one:free", "a/two:free"], groq=[])
freechain.bury("openrouter", "a/one:free")
check("a model recorded as retired is skipped, without a round trip to find out",
      [c["model"] for c in freechain.text_chain()] == ["a/two:free"])

# The provider is the authority and our note was a guess from one failed request.
# Without this, a model buried on a bad night stays buried for a week even after
# the catalogue lists it again.
catalogue(openrouter=["a/one:free", "a/two:free"], groq=[])
freechain.catalogue(refresh=False)          # re-reads the cache, prunes nothing
freechain._save(freechain.CACHE, {"at": 9e9, "providers": {
    "openrouter": [{"id": "a/one:free", "context": 0, "modalities": ["text"]},
                   {"id": "a/two:free", "context": 0, "modalities": ["text"]}]}})
check("but it is only ever skipped, never removed from the record it came from",
      "openrouter/a/one:free" in freechain.dead_models())
freechain.exhume()
check("and a person can forget the lot", not freechain.dead_models())

# ---------------------------------------------------------------------------
# A machine with no key has no chain, and says so rather than sitting there
# ---------------------------------------------------------------------------
freechain.KEYS = os.path.join(STATE, "no-keys-here")
check("a machine with no provider key has no free tutor at all",
      freechain.text_chain() == [])
check("and names the files a person would have to create",
      all(p.endswith(("openrouter_key", "groq_key"))
          for p in freechain.missing_keys()))
freechain.KEYS = KEYDIR


# ---------------------------------------------------------------------------
# free_only: the machine that may not spend
# ---------------------------------------------------------------------------
def cfg(**over):
    base = {
        "default_agent": "claude",
        "fallback_agent": "free",
        "free_only": True,
        "hosts": {},
        "agents": {
            "claude": {"cmd": ["claude"], "cost": "paid",
                       "headless": ["claude", "-p", "{prompt}"]},
            "opencode": {"cmd": ["opencode"], "cost": "paid",
                         "headless": ["opencode", "run", "{prompt}"]},
            "free": {"cmd": ["opencode"], "cost": "free", "cmd_cost": "paid",
                     "headless": [sys.executable,
                                  os.path.join(ROOT, "bin", "free"), "{prompt}"]},
        },
    }
    base.update(over)
    return base


quiet = lambda m: None                                        # noqa: E731

check("a free-only machine refuses the paid default and teaches anyway",
      tutor.resolve_agent(cfg(), {}, say=quiet) == "free")

# Each of these reaches this machine from somewhere else, which is the entire
# reason the check is outside the resolution order rather than another layer in
# it. A course repository is a clone: a line in one is a sentence about a
# different machine that arrives here with the next `git pull`.
check("a course repository cannot make it spend",
      tutor.resolve_agent(cfg(), {"agent": "claude"}, say=quiet) == "free")
check("nor can the hosts table",
      tutor.resolve_agent(cfg(hosts={tutor.this_host(): "claude"}), {},
                          say=quiet) == "free")
check("nor can a --agent typed on the wrong machine",
      tutor.resolve_agent(cfg(), {}, "claude", say=quiet) == "free")

# And it is a refusal, not a ban: the machine that IS allowed to spend is
# unaffected, which is the whole shape of the arrangement.
check("a machine that may spend still does what it is told",
      tutor.resolve_agent(cfg(free_only=False), {}, "claude", say=quiet) == "claude")

# An agent somebody adds to their own config with no `cost` on it is assumed to
# cost. The other default bills a person who never asked to be billed.
check("an agent that does not say what it costs is assumed to cost",
      tutor.costs_money(cfg(agents=dict(cfg()["agents"],
                                        mine={"cmd": ["mine"]})), "mine"))

# `free` runs every turn for nothing and hands a person opencode when they want
# to sit in front of one -- and opencode is billed. Refusing the terminal while
# still running the turns is the honest answer to both.
check("the free tutor's headless turns cost nothing",
      not tutor.costs_money(cfg(), "free"))
check("but its interactive session is known to be billed",
      tutor.costs_money(cfg(), "free", interactive=True))
check("so a free-only machine declines to open one",
      tutor.resolve_agent(cfg(), {}, interactive=True, say=quiet) is None)

# A fallback that costs money is not a fallback on a machine that may not spend.
# Obeying it would be the one configuration mistake that silently undoes all of
# the above.
check("a paid fallback is refused rather than obeyed",
      tutor.free_agent(cfg(fallback_agent="claude")) is None)
check("and with nothing free to run, the machine says so instead of spending",
      tutor.resolve_agent(cfg(fallback_agent="claude"), {}, say=quiet) is None)

# What the machine actually says. A refusal nobody can see is a machine that
# teaches worse for a fortnight before anybody asks why.
said = []
tutor.resolve_agent(cfg(), {"agent": "claude"}, say=said.append)
check("and it says out loud that it swapped the agent",
      any("free_only" in m and "claude" in m for m in said))

# ---------------------------------------------------------------------------
# Adjusting one field of a built-in recipe must not delete the rest of it
# ---------------------------------------------------------------------------
# A machine saying that the opencode installed on IT is pointed at free models
# writes the obvious thing -- `"agents": {"free": {"cmd_cost": "free"}}` -- and
# with a plain dict update that replaces the whole recipe: the command, the
# headless turn, the handoff, gone. The machine is then left with an agent called
# `free` that cannot run anything and, on a free-only machine, no tutor at all.
# Found by doing exactly this to this machine's own config.
cfgdir = tempfile.mkdtemp(prefix="tutor-free-cfg-")
was_config = tutor.CONFIG
try:
    tutor.CONFIG = os.path.join(cfgdir, "config.json")
    with open(tutor.CONFIG, "w", encoding="utf-8") as fh:
        json.dump({"agents": {"free": {"cmd_cost": "free"},
                              "mine": {"cmd": ["mine"], "cost": "free",
                                       "headless": ["mine", "{prompt}"]}}}, fh)
    loaded = tutor.load_config()
    check("adjusting one field of a built-in recipe keeps the rest of it",
          bool(loaded["agents"]["free"].get("headless"))
          and loaded["agents"]["free"].get("raw_prompt") is True)
    check("and the field being adjusted actually takes",
          loaded["agents"]["free"]["cmd_cost"] == "free")
    check("so a machine can say its own opencode is free without losing the tutor",
          not tutor.costs_money(loaded, "free", interactive=True))
    check("an agent the defaults have never heard of still arrives whole",
          loaded["agents"]["mine"]["cmd"] == ["mine"])

    # Replacing a recipe outright is still possible; it is now something you have
    # to mean, rather than what happens when you add one key.
    with open(tutor.CONFIG, "w", encoding="utf-8") as fh:
        json.dump({"agents": {"free": {"cmd": ["something-else"],
                                       "replace": True}}}, fh)
    check("and a recipe can still be replaced outright, on purpose",
          tutor.load_config()["agents"]["free"].get("headless") is None)
finally:
    tutor.CONFIG = was_config
    shutil.rmtree(cfgdir, ignore_errors=True)

# ---------------------------------------------------------------------------
# A failed turn says why, in words
# ---------------------------------------------------------------------------
# `exit 1` is what the iPad used to be shown, and it is a dead end: true, the
# same for every cause, and nothing a person holding the board can act on except
# by finding somebody who can read a log. The turn has almost always already said
# something better one line further up.
LOG = """
=== 19:04:11 turn 3 ===
free tutor: openrouter/nvidia/x:free -- retired from the free tier
free tutor: every model on the chain deliberated instead of writing a card; nothing written
"""
check("a failed turn is reported by what it said, not by what it exited with",
      tutor.failure_reason(LOG, "exit 1").startswith(
          "every model on the chain deliberated"))
check("and the exit code is kept for whoever does open the log",
      "(exit 1)" in tutor.failure_reason(LOG, "exit 1"))
check("a turn that said nothing at all still reports something",
      tutor.failure_reason("\n\n", "timed out") == "timed out")
# Otherwise the reason for one turn's failure is the previous turn's exit code,
# quoted back with a fresh timestamp on it.
check("and the marker line this file writes itself is not mistaken for a reason",
      tutor.failure_reason("!! exit 1\n", "exit 1") == "exit 1")

# ---------------------------------------------------------------------------
# The two machines are set up by two scripts, and neither undoes the other
# ---------------------------------------------------------------------------
mac = open(os.path.join(ROOT, "scripts", "setup-mac.sh"), encoding="utf-8").read()
node = open(os.path.join(ROOT, "scripts", "setup-node.sh"), encoding="utf-8").read()
check("the Mac's script turns free_only on", 'cfg["free_only"] = True' in mac)
check("and proves the machine can teach before it says it is done",
      "bin/free" in mac and "--check" in mac)
check("the node's script takes free_only off, so the allowance is used",
      'cfg.pop("free_only", None)' in node)
check("and each refuses to run on the other's machine",
      "This script is for the compute node" in node
      and "setup-node.sh" in mac and "Nothing has been changed" in mac)

shutil.rmtree(STATE, ignore_errors=True)
shutil.rmtree(KEYDIR, ignore_errors=True)

print()
if fails:
    print("%d FAILED" % len(fails))
    for f in fails:
        print("  " + f)
    sys.exit(1)
print("the tutor teaches for nothing, and finds its own models to do it with")
