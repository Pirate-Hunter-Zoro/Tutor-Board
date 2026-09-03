"""The lesson: what is on the board, what kind of sitting it is, and the
typed half of the conversation.
"""

import re
import time
import json
import os

from . import NOT_MINE
from ...course import syllabus
from ...course import review
from ...course import homework
from .. import multipart
from .. import spawn
from ... import sense
from ...course import config
from ...lesson import archive
from ...lesson import turns


def get(h, repo, path):
    if path == "/events":
        return h.sse(h.server.hub)

    if path == "/board.json":
        return h.send_bytes(h.server.hub.payload.encode("utf-8"), "application/json")

    if path.startswith("/archive/"):
        # A past lesson, read only. The transcript is the point of keeping
        # them: a student coming back to a chapter should see what they
        # wrote at the time, not an empty board.
        rel = path[len("/archive/"):].strip("/")
        if not rel:
            return h.send_json({"sessions": archive.list_archive(repo)})
        name = multipart.safe_filename(rel.split("/")[0])
        folder = os.path.join(repo.archive, name)
        if not os.path.isdir(folder):
            return h.send_json({"ok": False, "error": "no such session"}, status=404)
        rest = rel.split("/")[1:]
        if rest and rest[0] == "answers" and len(rest) > 1:
            return h.send_file(os.path.join(folder, "answers",
                                               multipart.safe_filename(rest[1])))
        return h.send_json(archive.archived_session(repo, name))

    if path == "/archive":
        return h.send_json({"sessions": archive.list_archive(repo)})
    return NOT_MINE


def post(h, repo, path):
    if path == "/dismiss-finish":
        st = repo.state()
        st.pop("finished", None)
        with open(repo.state_path, "w", encoding="utf-8") as fh:
            json.dump(st, fh, indent=2)
        h.server.hub.worker.dirty.set()
        return h.send_json({"ok": True})

    if path == "/session":
        # Which kind of sitting this is, chosen from the board. It was a
        # terminal-only decision, which meant a student who wanted help with
        # a problem set had to find a keyboard to say so.
        try:
            payload = json.loads(h.read_body().decode("utf-8") or "{}")
        except Exception:
            return h.send_json({"ok": False, "error": "bad json"}, status=400)
        kind = (payload.get("session") or "").strip().lower()
        if kind not in ("lecture", "homework", "review"):
            return h.send_json({"ok": False, "error": "bad session"}, status=400)
        want = (payload.get("hw") or "").strip()
        chapter = (payload.get("chapter") or "").strip()

        # A test review is held over a scope the student picks, and a scope is
        # a list: a test is not one chapter. Every name in it is matched
        # against what this repository actually has before anything is
        # written, exactly as a problem set name is -- nothing typed reaches
        # the filesystem and nothing invented reaches the tutor's prompt.
        if kind == "review":
            over = payload.get("over")
            if not isinstance(over, list):
                over = [over] if over else []
            chosen, unknown = review.resolve(repo.root, [str(x) for x in over])
            if unknown:
                return h.send_json({"ok": False, "error": "no such chapter",
                                       "unknown": unknown[:8]}, status=400)
            if not chosen:
                # A review over nothing is not a sitting, and opening one
                # would archive the lesson they are in to no purpose.
                return h.send_json({"ok": False, "error": "nothing chosen"},
                                      status=400)
            names = [u["name"] for u in chosen]
            of = review.kind(repo.root) or "chapters"
            course = repo.state().get("course") or config.read_config(repo.root)["name"] or ""
            args = ["open", course, review.sitting_label(chosen, of), "--review"]
            for n in names:
                args += ["--over", n]
            spawn.board_cli(repo.root, args)
            st = repo.state()
            st["session"] = kind
            st["review"] = names
            st.pop("hw", None)
            with open(repo.state_path, "w", encoding="utf-8") as fh:
                json.dump(st, fh, indent=2)
            h.server.hub.worker.dirty.set()
            return h.send_json({"ok": True, "session": kind, "review": names})

        # Moving to a different chapter is starting a different lesson, and
        # `board open` is what starts one: it files the current lesson away
        # whole -- cards, turns and answers together -- so the one being left
        # is still readable under the history button rather than being
        # overwritten by the next.
        if chapter:
            known = [syllabus.label(c) for c in syllabus.chapters(repo.root)]
            if chapter not in known:
                return h.send_json({"ok": False, "error": "no such chapter"},
                                      status=400)
            course = repo.state().get("course") or config.read_config(repo.root)["name"] or ""
            spawn.board_cli(repo.root, ["open", course, chapter,
                                  "--lecture" if kind == "lecture" else "--homework"])
            # A chapter gets its own tutor.
            #
            # An assistant is long-lived on purpose -- one that survives being
            # left still has the lesson in its head when you come back -- and
            # across a chapter that is the wrong thing to have in its head.
            # Reported an hour into Chapter 3: "the tutor is telling me that
            # problems from chapter 1 are still incomplete. I don't like
            # that." Its own conversation held the whole of Chapter 1, and no
            # file on disk could have told it otherwise.
            #
            # On its own thread: stopping is a wrap-up TURN, which is a model
            # call, and the person tapping a chapter is not waiting a minute
            # to see the chapter change. The handoff that turn writes is
            # stamped with the chapter it was teaching, so it is filed under
            # that chapter rather than read as this one's.
            spawn.fresh_tutor(repo.root, course)

        st = repo.state()
        st["session"] = kind
        st.pop("review", None)
        if kind == "homework":
            # Only a set this repository actually has. A name from the
            # request never reaches the filesystem.
            every = {x["name"]: x for x in homework.sets(repo.root)}
            chosen = every.get(want)
            if want and not chosen:
                return h.send_json({"ok": False, "error": "no such set"}, status=400)
            if chosen:
                if not chapter and st.get("hw") != chosen["rel"]:
                    course = st.get("course") or config.read_config(repo.root)["name"] or ""
                    spawn.board_cli(repo.root, ["open", course, chosen["name"],
                                          "--homework", "--set", chosen["name"]])
                    st = repo.state()
                    st["session"] = kind
                st["hw"] = chosen["rel"]
                st["chapter"] = chosen["name"]
        else:
            st.pop("hw", None)
        with open(repo.state_path, "w", encoding="utf-8") as fh:
            json.dump(st, fh, indent=2)
        h.server.hub.worker.dirty.set()
        return h.send_json({"ok": True, "session": kind, "hw": st.get("hw")})

    if path == "/text/save":
        # A typed answer in progress, kept per question so the panel can flip
        # between writing and typing without losing either.
        try:
            payload = json.loads(h.read_body().decode("utf-8"))
        except Exception:
            return h.send_json({"ok": False, "error": "bad json"}, status=400)
        qid = str(payload.get("question") or "")
        if not re.match(r"^\d{1,4}$", qid):
            return h.send_json({"ok": False, "error": "bad question"}, status=400)
        text = payload.get("text") or ""
        stem = os.path.join(repo.text, qid + ".txt")
        if text.strip():
            with open(stem, "w", encoding="utf-8") as fh:
                fh.write(text)
        else:
            try:
                os.remove(stem)
            except OSError:
                pass
        h.server.hub.worker.dirty.set()
        return h.send_json({"ok": True, "question": qid})

    if path == "/say":
        try:
            payload = json.loads(h.read_body().decode("utf-8"))
        except Exception:
            return h.send_json({"ok": False, "error": "bad json"}, status=400)
        text = (payload.get("text") or "").strip()
        # A signal carries meaning without a sentence: in a code course the
        # useful things to say are mostly "done", "stuck" and "confused",
        # and making someone type those on a tablet is a tax.
        # "begin" is the cold start. On an empty maths board there is no
        # question, so no answer is owed, so the slate never opens and there
        # is no text box either -- which left the iPad with no way to say
        # the first thing of a session. This is that, and it is a signal
        # rather than a composer on purpose.
        signal = (payload.get("signal") or "").strip().lower() or None
        if signal not in (None, "done", "help", "confused", "begin", "skip"):
            return h.send_json({"ok": False, "error": "bad signal"}, status=400)
        if not text and not signal:
            return h.send_json({"ok": False, "error": "empty"}, status=400)

        tid = payload.get("turn") or turns.next_turn_id(repo)
        rev = turns.turn_revision(repo, tid)
        record = {
            "id": tid, "rev": rev, "kind": "text",
            "answers": payload.get("answers") or turns.newest_question(repo),
            "t": time.time(),
            "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
            "from": payload.get("from") or "student",
            "text": text[:8000],
            "signal": signal,
            "read": False,
        }
        turns.write_turn(repo, record)
        # The typed draft for this question is now the answer itself; it has
        # been said and should not come back to haunt the next prompt.
        a = record.get("answers")
        if a:
            try:
                os.remove(os.path.join(repo.text, str(a) + ".txt"))
            except OSError:
                pass
        # What lands in the inbox is what `board wait` prints, and in a
        # headless session that string IS the prompt the assistant is woken
        # with. A bare "[begin]" tells it nothing, so a signal sent without a
        # sentence carries its own.
        line = ("[%s] " % signal if signal else "") + text
        if signal and not text:
            line += (sense.skip_sense(repo) if signal == "skip"
                     else sense.SIGNAL_SENSE.get(signal, ""))
        if signal == "begin":
            # Where to begin, not merely that they are waiting. Without this
            # the assistant has a blank board, no handoff, and a signal that
            # says nothing -- so it guesses, and the first guess opened a
            # course at chapter four.
            line += " " + sense.session_sense(repo)
        with open(repo.messages_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(dict(record, text=line)) + "\n")
        # Including "ask the tutor to begin", which is the one signal whose
        # whole purpose is a board with nobody on it. It used to put a line in
        # an inbox and hope: a tap on that button with no daemon running was a
        # tap that did nothing for ever, and the board went on saying "no tutor
        # attached" with the request sitting on disk beside it.
        if spawn.wake_tutor(repo):
            h.note("nothing was reading the board; starting a tutor")
        h.server.hub.worker.dirty.set()
        return h.send_json({"ok": True, "turn": tid, "rev": rev})
    return NOT_MINE
