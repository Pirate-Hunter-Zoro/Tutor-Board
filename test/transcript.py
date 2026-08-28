#!/usr/bin/env python3
"""A lesson is a conversation, and it has to survive being closed.

What the student wrote used to live in exactly one place: the slate, which is a
working surface and gets written over. Sent pages were mailed as thumbnails into
a drawer, unconnected to the question they answered, and the next lesson wiped
them. Half the conversation was unrecorded.

So: a turn is anchored to the card it answers, frozen at the moment it is sent,
versioned so a correction supersedes the original in place, and archived with
the cards when the session ends. This drives the real server -- an in-process
one on a temporary repository -- because the failure being guarded against is
data quietly not being written, which no stub can show.
"""

import io
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import serve  # noqa: E402

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


tmp = tempfile.mkdtemp(prefix="tutor-transcript-")
with open(os.path.join(tmp, "tutorboard.json"), "w", encoding="utf-8") as fh:
    json.dump({"name": "Test Course", "mode": "math"}, fh)
repo = serve.Repo(tmp)

# One question card, the thing a turn will answer.
with open(os.path.join(repo.cards, "0001-q.md"), "w", encoding="utf-8") as fh:
    fh.write("---\nkind: question\ntitle: Which one?\n---\n\nWhich subfield?\n")
with open(os.path.join(repo.cards, "0002-note.md"), "w", encoding="utf-8") as fh:
    fh.write("---\nkind: lesson\n---\n\nA later card that is not a question.\n")

check("the newest question is what a turn answers",
      serve.newest_question(repo) == "0001")

# --- a turn, and then a correction of it ------------------------------------
serve.write_turn(repo, {"id": "t0001", "rev": 1, "kind": "ink", "answers": "0001",
                        "t": 1000.0, "png": "/answers/t0001-r1.png",
                        "ink": "/answers/t0001-r1.json", "strokes": 9})
turns = serve.load_turns(repo)
check("a sent answer is a turn", len(turns) == 1 and turns[0]["id"] == "t0001")
check("a turn records the card it answers", turns[0]["answers"] == "0001")

check("the next turn gets the next id", serve.next_turn_id(repo) == "t0002")
check("revising the same turn bumps its revision",
      serve.turn_revision(repo, "t0001") == 2)

serve.write_turn(repo, {"id": "t0001", "rev": 2, "kind": "ink", "answers": "0001",
                        "t": 9000.0, "png": "/answers/t0001-r2.png",
                        "ink": "/answers/t0001-r2.json", "strokes": 11})
turns = serve.load_turns(repo)
check("a correction supersedes rather than piling up", len(turns) == 1)
check("the newest revision is the one shown", turns[0]["rev"] == 2)
check("but it keeps its place in the transcript", turns[0]["t0"] == 1000.0)

# Every revision is still on disk. The transcript shows the latest; the record
# is the whole thing.
with open(repo.turns_path, "r", encoding="utf-8") as fh:
    lines = [l for l in fh if l.strip()]
check("no revision is ever destroyed", len(lines) == 2)

# --- a second turn, after a different card ----------------------------------
serve.write_turn(repo, {"id": "t0002", "rev": 1, "kind": "text", "answers": "0001",
                        "t": 9500.0, "text": "I am stuck", "signal": "help"})
turns = serve.load_turns(repo)
check("turns come back in the order they started",
      [t["id"] for t in turns] == ["t0001", "t0002"])
check("a typed turn keeps its signal", turns[1].get("signal") == "help")

# --- archiving --------------------------------------------------------------
for name in ("t0001-r1", "t0001-r2"):
    with open(os.path.join(repo.answers, name + ".png"), "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
    with open(os.path.join(repo.answers, name + ".json"), "w", encoding="utf-8") as fh:
        json.dump({"strokes": []}, fh)

with open(repo.state_path, "w", encoding="utf-8") as fh:
    json.dump({"course": "Test Course", "chapter": "Chapter 7",
               "session": "lecture", "opened": "2026-01-01 10:00"}, fh)

rc = os.system("cd %s && python3 %s archive >/dev/null 2>&1"
               % (tmp, os.path.join(ROOT, "bin", "board")))
check("archiving a session succeeds", rc == 0)
check("the live transcript is cleared for the next lesson",
      not os.path.exists(repo.turns_path))
check("no answer files are left behind", not os.listdir(repo.answers))
check("no cards are left behind",
      not [n for n in os.listdir(repo.cards) if n.endswith(".md")])

sessions = serve.list_archive(repo)
check("the finished lesson is listed", len(sessions) == 1)
check("it is listed by chapter, not by folder name",
      sessions[0]["chapter"] == "Chapter 7")
check("it knows how much of it was the student's", sessions[0]["turns"] == 2)
check("and how many cards it held", sessions[0]["cards"] == 2)

past = serve.archived_session(repo, sessions[0]["id"])
check("a past lesson still has its cards", len(past["cards"]) == 2)
check("a past lesson still has the student's working", len(past["turns"]) == 2)
check("the archived answer still shows the newest revision",
      past["turns"][0]["rev"] == 2)
check("its ink is reachable from inside the archive",
      past["turns"][0]["png"].startswith("/archive/"))
frozen = os.path.join(repo.archive, sessions[0]["id"], "answers", "t0001-r2.png")
check("and the file it points at is really there", os.path.isfile(frozen))

# --- a turn id is unique for the life of the course, not of one lesson -------
#
# `board archive` renames turns.jsonl into the archive and leaves messages.jsonl
# where it is, because the inbox is the assistant's mailbox and is never
# rotated. So the id counter used to go back to t0001 the moment a chapter was
# filed, while the inbox still held every id ever issued -- and the next answer
# arrived in the inbox as a second, different `t0001 rev 1`. Two turns, one
# name.
check("the transcript really was rotated away, which is what caused this",
      not os.path.exists(repo.turns_path))
# This lesson issued t0001 and t0002 before being filed.
nxt = serve.next_turn_id(repo)
check("the next turn after an archive does not reuse a filed id",
      nxt not in ("t0001", "t0002"))
check("it continues from the highest id the course has ever issued",
      nxt == "t0003")
check("and the high-water mark is on disk, outside the transcript",
      os.path.isfile(os.path.join(repo.live, serve.TURN_SEQ)))

# It survives the inbox being pruned as well, because it is not stored there --
# messages.jsonl happens never to be rotated, and an invariant that holds by
# accident is one that stops holding without warning.
if os.path.exists(repo.messages_path):
    os.remove(repo.messages_path)
check("nor does pruning the inbox rewind it",
      serve.next_turn_id(repo) == "t0003")

# And it keeps advancing.
serve.write_turn(repo, {"id": "t0003", "rev": 1, "kind": "ink", "answers": "0001",
                        "t": 1.0, "from": "student", "strokes": 1})
check("a new turn advances it", serve.next_turn_id(repo) == "t0004")
check("a fresh id starts at revision 1", serve.turn_revision(repo, "t0004") == 1)
check("and a live turn's next write is a revision, not an overwrite",
      serve.turn_revision(repo, "t0003") == 2)

shutil.rmtree(tmp, ignore_errors=True)
print()
print("%d FAILURES" % len(fails) if fails else "the lesson is a transcript, and it survives")
sys.exit(1 if fails else 0)
