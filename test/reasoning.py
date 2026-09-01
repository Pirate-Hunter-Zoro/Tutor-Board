#!/usr/bin/env python3
"""A model's thinking never reaches the board.

Every model on the free chain deliberates before it answers, and the deliberation
is written in the first person about the student: "they are confusing the fixed
field with the subgroup, so I should probably...". Providers are supposed to keep
that out of `message.content`. Several of the free ones do not -- some wrap it in
`<think>` tags, some emit the harmony channel markers, some just forward whatever
the model produced.

On this board that is the worst leak there is, because the card IS the lesson,
and there is no undo: it is written to disk, pushed to every device the student
has open, and committed to the transcript.

It happened once, on the always-on host, to somebody in the middle of a Galois
proof. Two things had to be wrong at the same time and both are guarded here:

  - the reply came off the wire with the thinking still in it, and nothing
    looked;
  - the front-matter parser was anchored at position zero, so a reply with
    anything at all in front of the opening `---` fell through to the branch
    that makes the WHOLE reply the body -- which is how the thought became the
    card rather than merely preceding it.

And the last rule, which is the one a later change is most likely to break: a
lesson that is ABOUT reasoning models may say the word in earnest. The gate at
`board write` strips only what a card opens with, and never edits prose.
"""

import importlib.machinery
import importlib.util
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

errors = []


def ok(m):
    print("ok   " + m)


def fail(m):
    errors.append(m)
    print("FAIL " + m)


def check(m, cond):
    ok(m) if cond else fail(m)


box = tempfile.mkdtemp()
os.environ["BOARD_STATE_DIR"] = box
os.environ["BOARD_NODE_NAME"] = "test-node"

import boardlib  # noqa: E402


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


free = load("free_tutor", os.path.join(ROOT, "bin", "free"))


# --- what thinking looks like, in every dialect the chain speaks -------------
print("\n-- the shapes a leak arrives in --")

CARD = "---\nkind: question\ntitle: Which subfield is fixed?\n---\n\nTake $L = \\QQ(\\omega)$."

check("a <think> block before the card is gone",
      boardlib.strip_reasoning(
          "<think>They confused the fixed field with the subgroup. I should "
          "ask again.</think>\n\n" + CARD) == CARD)

check("an unclosed <think> leaves nothing behind, rather than everything",
      boardlib.strip_reasoning(
          "<think>the budget ran out halfway through this thought") == "")

check("a close tag with no open takes what came before it",
      boardlib.strip_reasoning("deliberating away</think>\n\n" + CARD) == CARD)

check("the harmony channels keep only the final one",
      boardlib.strip_reasoning(
          "<|channel|>analysis<|message|>working it out<|end|>"
          "<|start|>assistant<|channel|>final<|message|>" + CARD + "<|return|>") == CARD)

check("an analysis channel with no final channel leaves no markers",
      "<|" not in boardlib.strip_reasoning(
          "<|channel|>analysis<|message|>only ever thought<|end|>" + CARD))

check("the bracket form is caught too",
      boardlib.strip_reasoning("[THINKING]hm[/THINKING]\n\n" + CARD) == CARD)

check("a card with nothing to strip is returned unchanged",
      boardlib.strip_reasoning(CARD) == CARD)

check("a mismatched close does not swallow the card",
      CARD in boardlib.strip_reasoning("<think>a</thought>\n\n" + CARD))


# --- the rule that keeps a lesson a lesson ----------------------------------
print("\n-- a lesson about thinking is still a lesson --")

PROSE = ("A reasoning model wraps its working in a <think> block, and the "
         "provider is supposed to strip it.\n\nWhy does that matter here?")

check("leading_only leaves prose that merely mentions the tag alone",
      boardlib.strip_reasoning(PROSE, leading_only=True) == PROSE)

check("leading_only still strips a block the card opens with",
      boardlib.strip_reasoning("<think>hm</think>\n\n" + CARD,
                               leading_only=True) == CARD)

check("the thorough pass is the one that edits mid-text, and only the wire uses it",
      boardlib.strip_reasoning(PROSE) != PROSE)


# --- the parser that turned a preamble into the card ------------------------
print("\n-- front matter is found wherever it starts --")

kind, title, body = free.card_markdown(
    "Here is the card:\n\n---\nkind: question\ntitle: Which subfield?\n---\n\n"
    "Take $L = \\QQ(\\omega)$.")
check("front matter after a preamble is still front matter", kind == "question")
check("and the preamble is not the body", "Here is the card" not in body)
check("the body is the card", body == "Take $L = \\QQ(\\omega)$.")

kind, title, body = free.card_markdown(
    "---\nkind: wrong\ntitle: Not the fixed field\n---\n\nThe break is here.\n\n"
    "---\n\nAnd a rule under it.")
check("a horizontal rule in the body is not read as a second front matter",
      title == "Not the fixed field" and "And a rule under it." in body)

kind, title, body = free.card_markdown("No front matter at all, just prose.")
check("a reply with no front matter is still a lesson card",
      kind == "lesson" and body == "No front matter at all, just prose.")


# --- the gate at the board itself -------------------------------------------
print("\n-- board write refuses to write a thought --")

course = tempfile.mkdtemp()
os.makedirs(os.path.join(course, "live", "cards"), exist_ok=True)


def write_card(text):
    p = subprocess.run(
        [sys.executable, os.path.join(ROOT, "bin", "board"), "write", "question", "T"],
        cwd=course, input=text.encode("utf-8"),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    path = p.stdout.decode().strip().splitlines()[-1] if p.stdout.strip() else ""
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


written = write_card("<think>they are stuck on the index</think>\n\nWhich subgroup is it?")
check("a card handed a leading thought is written without it",
      "they are stuck" not in written and "Which subgroup is it?" in written)

written = write_card(PROSE)
check("a card whose prose mentions the tag is written exactly as given",
      "<think>" in written)


print()
if errors:
    print("%d check(s) failed" % len(errors))
    sys.exit(1)
print("a model's thinking stays the model's")
