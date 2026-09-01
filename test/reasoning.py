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

It happened AGAIN five days later, in the same course, and the second time there
was nothing to strip: the reply carried no tag, no channel and no bracket -- just
eight hundred tokens of "I need to read the student's response... Hmm, wait. Let
me re-read the question... Actually, I think", cut off mid-sentence at the token
ceiling, written to the board as the lesson. Every tag-shaped gate looked through
it, `bin/free`'s two attempts both came back the same way, and the loop wrote
whatever it had at the end.

So there is a second question, asked of voice rather than syntax: is this text
addressed TO the student or about them? `boardlib.reads_as_reasoning` answers it,
the chain passes over a model that deliberates, and both gates REFUSE rather than
edit -- there is nothing to remove when the whole reply is the thought.

And the last rule, which is the one a later change is most likely to break: a
lesson that is ABOUT reasoning models may say the word in earnest, and a tutor
refers to its own cards in the ordinary course of teaching ("dead on your page
instead of in my card" is a real sentence from a real lesson). The gate at
`board write` strips only what a card opens with, never edits prose, and the
refusal is calibrated against every card in every course on the machine it was
written on: one leak caught, no lesson touched.
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


def write_card_forced(text):
    p = subprocess.run(
        [sys.executable, os.path.join(ROOT, "bin", "board"), "write", "question", "T",
         "--force"],
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


# --- thinking with no tag on it ---------------------------------------------
print("\n-- deliberation is refused, and a lesson is not --")

# The card that actually reached the board, at the length it reached it.
LEAK = """I need to read the student's response to card 0035 carefully. They were asked to identify which of the two subgroups contains no 2-cycles, which is not normal, and which they'd bet is normal.

Their answer:
- V4 is listed
- <(1234)> no 2-cycles, not normal in S4

The student correctly identified that <(1234)> contains no 2-cycles (it's generated by a 4-cycle, so its non-identity elements are 4-cycles and a double transposition... wait, let me think. <(1234)> = {e, (1234), (13)(24), (1432)}. So it contains (13)(24), which IS a product of two 2-cycles.

Hmm, wait. The student wrote "no 2-cycles". But <(1234)> contains (13)(24). So this is incorrect.

Actually, I think the question is asking about transpositions. Neither contains a single transposition. So the question might be poorly posed."""

check("untagged deliberation is recognised for what it is",
      boardlib.reads_as_reasoning(LEAK))

check("and there is nothing in it for the strip to remove, which is the point",
      boardlib.strip_reasoning(LEAK) == LEAK)

# Real cards, from real lessons. Each of these is a card somebody was taught
# with, and refusing one mid-lesson is its own kind of damage.
REAL = [
    ("a card that names another card and its own",
     """Two things before the mathematics.

The question on card 0003 is unanswered. You were asked what $x \\in gH$ forces
about $g$, and there is nothing about that on the page.

**The break is one sentence.** Ruling out the other coset does not leave $H$ as the
only candidate. That is the same claim I have rejected twice, so I am not going to
explain it a third time -- you should test it yourself, and then it is dead on your
page instead of in my card."""),
    ("a card that opens by conceding a point",
     """Fair enough -- you proved 1.5, that is done. Frustration noted, and it means I
have been unclear about something.

I keep saying "the relabelling rule" without you knowing what I am pointing at. That
is my fault. Here is what I thought was a shortcut: when you conjugate a
permutation, the cycle structure does not change.

**Tell me exactly which sentence made you stop.** One thing."""),
    ("a card that is mostly mathematics",
     """Take $G = S_4$, and let $H$ be **any** subgroup of order $4$.

**Claim.** There are exactly two subgroups of order $4$ in $S_4$ up to conjugation:
the Klein four-group $V_4$, and the cyclic group $\\gen{(1234)}$.

Before you prove anything: which of these two does *not* contain any 2-cycles?
Which one is *not* normal in $S_4$?"""),
    ("a lesson about how a reasoning model works",
     """A reasoning model deliberates before it answers. The student asks a question,
the model works through it privately, and only then writes. Wait -- that is not
quite the whole picture. Actually, the interesting part is what happens when the
private half is forwarded anyway.

What would you expect to see on the board if it were?"""),
]
for label, text in REAL:
    check(label + " is not mistaken for thinking",
          not boardlib.reads_as_reasoning(text))

check("board write refuses a card that is deliberation",
      write_card(LEAK) == "")

check("and --force is the way through for somebody who means it",
      "I need to read" in write_card_forced(LEAK))

check("a real card still goes straight through",
      "Take $G = S_4$" in write_card(REAL[2][1]))

# The door `board write` is not on. The session brief tells an interactive tutor
# to write its card into `live/cards/` itself, and an agent with file tools does
# exactly that -- so the READER checks as well: the board, the recap the tutor
# reads its own lesson back through, and the exported document.
import document                                                   # noqa: E402

check("a card written straight to disk is not read as a lesson",
      boardlib.card_body(LEAK) == boardlib.THINKING_NOTICE)

check("and what stands in its place says the turn did not land, rather than "
      "leaving a silence the student waits on",
      "not shown" in boardlib.card_body(LEAK))

check("a real card is handed back exactly as written",
      boardlib.card_body(REAL[2][1]) == REAL[2][1])

_cards = tempfile.mkdtemp()
with open(os.path.join(_cards, "0001-leak.md"), "w", encoding="utf-8") as fh:
    fh.write("---\nkind: lesson\n---\n" + LEAK)
check("the export reads through the same gate",
      boardlib.THINKING_NOTICE in document.read_cards(_cards)[0]["body"])


print()
if errors:
    print("%d check(s) failed" % len(errors))
    sys.exit(1)
print("a model's thinking stays the model's")
