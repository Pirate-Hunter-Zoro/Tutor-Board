"""The cards on the board, which are files.

A card appears the instant its file exists, so everything here is about
reading them back cheaply: what is on the board, in order, with the TikZ in
them handed off to be drawn.
"""

import hashlib
import os
import re
import time

from .. import reasoning


POLL_SECONDS = 0.25
CARD_RE = re.compile(r"^(\d{4})[-_.](.*)\.(md|markdown|tex)$")

# ---------------------------------------------------------------------------
# card parsing
# ---------------------------------------------------------------------------
def parse_front_matter(text):
    """Minimal `key: value` front matter between --- fences. No YAML dependency."""
    meta = {}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            head = text[3:end]
            body = text[end + 4:]
            if body.startswith("\n"):
                body = body[1:]
            for line in head.splitlines():
                line = line.strip()
                if not line or line.startswith("#") or ":" not in line:
                    continue
                k, v = line.split(":", 1)
                meta[k.strip().lower()] = v.strip().strip('"').strip("'")
    return meta, body


TIKZ_BLOCK = re.compile(
    r"^[ \t]*```[ \t]*(tikz|tikzcd|latex)[ \t]*\n(.*?)^[ \t]*```[ \t]*$",
    re.DOTALL | re.MULTILINE,
)


def extract_tikz(body, jobs, repo):
    """Replace fenced tikz blocks with a placeholder token the client turns into
    an <img>. Queue anything not already cached for compilation."""
    def sub(match):
        kind = match.group(1)
        src = match.group(2)
        digest = hashlib.sha1((kind + "\x00" + src).encode("utf-8")).hexdigest()[:16]
        svg = os.path.join(repo.tikz, digest + ".svg")
        if os.path.exists(svg):
            status = "ready"
        elif os.path.exists(os.path.join(repo.tikz, digest + ".err")):
            status = "error"
        else:
            status = "pending"
            jobs.append((digest, kind, src))
        return "\n\n@@FIGURE:%s:%s@@\n\n" % (digest, status)

    return TIKZ_BLOCK.sub(sub, body)


# Parsed cards, keyed by path, valid while (mtime, size) hold. The poll runs four
# times a second and this home directory is a shared network filesystem, so
# re-reading and re-parsing every card in the lesson on every tick is real cost
# for files that have not changed -- and it grows with the length of the lesson.
_CARD_CACHE = {}


def load_cards(repo, jobs):
    cards = []
    try:
        names = sorted(os.listdir(repo.cards))
    except OSError:
        names = []
    seen = set()
    for name in names:
        m = CARD_RE.match(name)
        if not m:
            continue
        path = os.path.join(repo.cards, name)
        seen.add(path)
        try:
            st = os.stat(path)
        except OSError:
            continue
        stamp = (st.st_mtime, st.st_size)
        hit = _CARD_CACHE.get(path)
        if hit and hit[0] == stamp:
            # The figure placeholders carry compile status, which changes when a
            # diagram finishes -- so the body is re-scanned even on a hit. It is
            # a regex over a string already in memory, not a read and a parse.
            card = dict(hit[1])
            card["body"] = extract_tikz(hit[2], jobs, repo)
            cards.append(card)
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.read()
        except OSError:
            continue
        meta, rawbody = parse_front_matter(raw)
        # Whoever wrote this file. `board write` refuses a card that is the
        # model deliberating, but an interactive tutor writes the file itself --
        # the brief tells it to -- and that door has no gate on it.
        rawbody = reasoning.card_body(rawbody)
        body = extract_tikz(rawbody, jobs, repo)
        cards.append({
            "id": m.group(1),
            "slug": m.group(2),
            "kind": (meta.get("kind") or "lesson").lower(),
            "title": meta.get("title", ""),
            "tag": meta.get("tag", ""),
            "body": body,
            "mtime": st.st_mtime,
        })
        _CARD_CACHE[path] = (stamp, dict(cards[-1]), rawbody)
    for gone in [k for k in _CARD_CACHE if k not in seen and k.startswith(repo.cards)]:
        del _CARD_CACHE[gone]
    return cards
