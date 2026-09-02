"""What a model thought, and what it said.

A reasoning model answers in two registers, and only one of them is a lesson.
The student must never be shown the other.
"""

import re


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


# ---------------------------------------------------------------------------
# thinking with no tag on it
# ---------------------------------------------------------------------------
# Everything above catches thinking that is MARKED as thinking. On 1 September
# 2026 a card arrived that was not marked at all -- eight hundred tokens of
# "I need to read the student's response... Hmm, wait. Let me re-read the
# question... Actually, I think", cut off mid-sentence at the token ceiling,
# written to the board as the lesson. No tags, no channels, no brackets: just a
# model deliberating in plain prose in `content`, on the free chain the Mac falls
# back to when its allowance runs out. Every tag-shaped gate in this file looked
# straight through it.
#
# So there is a second question to ask, and it is about voice rather than syntax:
# is this text ADDRESSED to the student, or is it about them? A card speaks to
# somebody -- "take $G = S_4$", "tell me which is which". Deliberation speaks
# about them in the third person and about itself in the first, and it argues
# with itself as it goes.
#
# The bar is deliberately high, because refusing a real card mid-lesson is its
# own kind of damage. One decisive signal, or two suggestive ones together.
_REASONING_STRONG = (
    re.compile(r"\bthe student\b", re.IGNORECASE),
    re.compile(r"^\s*(?:okay|ok|alright|right|so)[,.]?\s+(?:so\s+)?"
               r"(?:the|i|let|we)\b", re.IGNORECASE),
    re.compile(r"^\s*(?:i (?:need to|should|will|must|have to)\b"
               r"|let me\b|let's (?:see|think)\b|first,? i\b"
               r"|i'?m going to (?:read|look|check|think)\b)", re.IGNORECASE),
    # "my previous reply", not "my card": a tutor refers to its own cards in the
    # ordinary course of teaching -- "instead of in my card" is a real sentence
    # from a real lesson -- and only deliberation looks back at its own last turn.
    re.compile(r"\bmy (?:previous|last|earlier) (?:reply|response|answer|card|turn)\b",
               re.IGNORECASE),
)
_REASONING_HINTS = (
    re.compile(r"\b(?:hmm|wait)\b[,.]", re.IGNORECASE),
    re.compile(r"\blet me (?:think|re-?read|check|reconsider|work)\b", re.IGNORECASE),
    re.compile(r"\bactually,? (?:i|the|it|this)\b", re.IGNORECASE),
    re.compile(r"\b(?:looking|thinking) (?:more )?(?:carefully|about it)\b",
               re.IGNORECASE),
    re.compile(r"\bcard\s+\d{3,4}\b", re.IGNORECASE),
    re.compile(r"\bthey (?:were asked|answered|wrote|said|are asking)\b",
               re.IGNORECASE),
    re.compile(r"\bthe (?:question|card) (?:asked|was asking|is asking)\b",
               re.IGNORECASE),
    re.compile(r"\bso (?:this|that) is (?:incorrect|correct|wrong|right)\b",
               re.IGNORECASE),
)


_ADDRESSES = re.compile(r"\b(?:you|your|yours|you'?re|you'?ll|you'?ve)\b",
                        re.IGNORECASE)


def reads_as_reasoning(text):
    """Is this a model deliberating rather than a card written to the student?

    Untagged thinking is the shape no strip can remove, because there is nothing
    in it to remove -- the whole reply is the thought. What the caller does about
    it is refuse: on the wire, ask again; at `board write`, say so and write
    nothing. A card that never appears is a turn somebody waits for; a monologue
    that does appear is the lesson, and there is no undo.
    """
    t = (text or "").strip()
    if len(t) < 200:
        return False           # too short to be a monologue, and cheap to be wrong about
    # The one thing every card has and no monologue has: somebody it is talking
    # to. A tutor writes "take $G = S_4$" and "tell me which is which"; a model
    # deliberating writes about "the student" and to nobody at all. This is the
    # discriminator that lets a lesson ABOUT reasoning models -- which will say
    # "the student", and "wait", and "actually" -- through untouched, and it is
    # checked over the whole text rather than the opening, because a card can
    # spend a paragraph on the mathematics before it turns to the reader.
    if _ADDRESSES.search(t):
        return False
    head = t[:1200]
    for rx in _REASONING_STRONG:
        if rx.search(head):
            return True
    hits = sum(1 for rx in _REASONING_HINTS if rx.search(head))
    return hits >= 2


# What stands in place of a card that was the model thinking out loud.
#
# The two writing gates refuse such a card, but they are not the only door: the
# session brief tells an interactive tutor to write its card into `live/cards/`
# itself, and an agent with its own file tools does exactly that. So the reader
# checks too -- the board, the recap the tutor reads back, and the exported
# document -- and what it shows is this rather than the monologue. Not silence:
# a card that vanishes is a turn the student waits on for ever, and the tutor
# reading its own lesson back needs to see that the turn did not land.
THINKING_NOTICE = ("*The tutor's own working ended up here instead of a lesson, "
                   "so it is not shown. Ask again — the next turn will be a "
                   "card.*")


def card_body(body):
    """A card body as it should be read, whoever wrote the file."""
    return THINKING_NOTICE if reads_as_reasoning(body) else body
