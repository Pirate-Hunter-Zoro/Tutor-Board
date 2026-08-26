#!/usr/bin/env python3
"""The first turn of a session has to be possible from the device.

A maths board with no cards asks no question, so no answer is owed, so the slate
never opens -- and in maths there is deliberately no text box. That left the iPad
with no way to say anything at all until somebody typed in a terminal, which is
the one ceremony the launcher exists to abolish. `begin` is that first turn: a
signal, not a composer.

This drives the real HTTP handler, because what is being guarded is the whole
round trip -- the endpoint accepting the signal, the turn landing in the
transcript, and the inbox line being something an assistant woken by `board wait`
can actually act on. In a headless session that line IS the prompt.
"""

import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import urllib.error
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


tmp = tempfile.mkdtemp(prefix="tutor-begin-")
with open(os.path.join(tmp, "tutorboard.json"), "w", encoding="utf-8") as fh:
    json.dump({"name": "Test Course", "mode": "math"}, fh)
repo = serve.Repo(tmp)

worker = serve.TikzWorker(repo)
worker.start()
hub = serve.Hub(repo, worker)
hub.payload = json.dumps(hub.build())

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()

httpd = serve.ThreadingHTTPServer(("127.0.0.1", port), serve.Handler)
httpd.daemon_threads = True
httpd.repo = repo
httpd.hub = hub
threading.Thread(target=httpd.serve_forever, daemon=True).start()

BASE = "http://127.0.0.1:%d" % port


def post(path, body):
    req = urllib.request.Request(BASE + path, method="POST",
                                 data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


try:
    # Nothing on the board at all: the state this exists for.
    check("the board starts with no cards",
          not [n for n in os.listdir(repo.cards) if n.endswith(".md")])

    status, body = post("/say", {"signal": "begin"})
    check("a bare 'begin' is accepted", status == 200 and body.get("ok") is True)

    turns = serve.load_turns(repo)
    check("it lands in the transcript as a turn", len(turns) == 1)
    check("and keeps its signal", turns and turns[0].get("signal") == "begin")
    check("it answers no card, because there is none",
          turns and not turns[0].get("answers"))

    with open(repo.messages_path, "r", encoding="utf-8") as fh:
        lines = [json.loads(l) for l in fh if l.strip()]
    check("it reaches the inbox, which is what `board wait` watches", len(lines) == 1)
    text = lines[0].get("text", "") if lines else ""
    # The failure this guards: the inbox line used to be the bare tag "[begin] ",
    # and a headless assistant woken with that string has been told nothing.
    check("the inbox line names the signal", "[begin]" in text)
    check("and carries its meaning, because a tap has no sentence in it",
          "nothing on the board" in text and "first card" in text)
    check("the line is not just the tag", len(text.strip()) > len("[begin]") + 8)
    # Where to begin, not merely that somebody is waiting. The first real cold
    # start opened a course at chapter four because nothing said otherwise.
    check("with no chapter set it says so, and says not to guess",
          "no chapter label" in text and "guess" in text)
    check("a course that is not a book is not given a fictional chapter one",
          "follows a book" not in text)

    # An unread message is what wakes `board wait`.
    check("it arrives unread", lines and lines[0].get("read") is False)

    # The signal vocabulary is closed. A typo must not become a new kind of turn.
    status, body = post("/say", {"signal": "commence"})
    check("an unknown signal is refused", status == 400 and body.get("ok") is False)

    # And the old ones still work, unchanged.
    status, _ = post("/say", {"signal": "done"})
    check("'done' still works", status == 200)
    with open(repo.messages_path, "r", encoding="utf-8") as fh:
        lines = [json.loads(l) for l in fh if l.strip()]
    check("a signal with no sentence always carries its meaning",
          "ready for you to check" in lines[-1].get("text", ""))

    # A course that follows a book says so on disk, and the cold start names its
    # actual first chapter rather than telling the assistant to work it out. This
    # is the defect: "the floor of the subject" and "the start of the book" are
    # not the same place, and a tutor left to choose picked chapter four.
    with open(os.path.join(tmp, "chapters.tsv"), "w", encoding="utf-8") as fh:
        fh.write("# num\tfrom\tto\tslug\ttitle\n")
        fh.write("01\t1\t20\tch01-groups\tGroups, fields and vector spaces\n")
        fh.write("02\t21\t40\tch02-zorn\tThe axiom of choice\n")
        fh.write("04\t61\t80\tch04-ext\tField extensions\n")
    post("/say", {"signal": "begin"})
    with open(repo.messages_path, "r", encoding="utf-8") as fh:
        lines = [json.loads(l) for l in fh if l.strip()]
    text = lines[-1].get("text", "")
    check("a book course is told which chapter is first, by name",
          "Groups, fields and vector spaces" in text)
    check("and how many there are, so it knows it is a course not a topic",
          "3 chapters" in text)
    check("and is told not to open at the foundation of the subject instead",
          "where the book starts" in text)
    check("chapter four does not get named as the opening",
          "Field extensions" not in text)

    # A labelled sitting names its own starting point.
    with open(repo.state_path, "w", encoding="utf-8") as fh:
        json.dump({"course": "Test Course", "session": "lecture",
                   "chapter": "Ch 1 — groups, fields and vector spaces"}, fh)
    post("/say", {"signal": "begin"})
    with open(repo.messages_path, "r", encoding="utf-8") as fh:
        lines = [json.loads(l) for l in fh if l.strip()]
    check("a labelled sitting tells the assistant where to start",
          "Ch 1" in lines[-1].get("text", "") and "Start there" in lines[-1].get("text", ""))

    # Declining a prompt is a turn like any other: recorded, and carrying enough
    # for the tutor to know not to press the point.
    status, _ = post("/say", {"signal": "skip", "answers": "0001"})
    check("'skip' is accepted", status == 200)
    turns = serve.load_turns(repo)
    check("a skip is a turn in the transcript",
          any(t.get("signal") == "skip" for t in turns))
    check("and it records which question it declined",
          [t for t in turns if t.get("signal") == "skip"][0].get("answers") == "0001")
    with open(repo.messages_path, "r", encoding="utf-8") as fh:
        lines = [json.loads(l) for l in fh if l.strip()]
    check("and tells the tutor to carry on rather than re-ask",
          "not writing this one" in lines[-1].get("text", "")
          and "carry on" in lines[-1].get("text", ""))

    # The board's own view of who is attached. An interactive assistant is idle
    # for as long as the person is thinking, so judging it by a heartbeat is why
    # this indicator was never once green outside headless.
    import time as _time
    agent_path = os.path.join(repo.live, "agent.json")

    def write_agent(**kw):
        with open(agent_path, "w", encoding="utf-8") as fh:
            json.dump(kw, fh)

    host = socket.gethostname().split(".")[0]
    write_agent(host=host, pid=os.getpid(), agent="claude", state="attached",
                mode="interactive", cmd=sys.executable,
                last_seen=_time.time() - 6000)
    st = serve.load_agent(repo)
    check("the board sees an interactive assistant that has been idle for an hour",
          st and st["state"] == "attached")

    write_agent(host=host, pid=999999, agent="claude", state="attached",
                mode="interactive", cmd=sys.executable, last_seen=_time.time())
    st = serve.load_agent(repo)
    check("and marks it stale once its process is gone",
          st and st["state"] == "stale")

    write_agent(host="a-node-that-is-not-this-one", pid=os.getpid(), agent="claude",
                state="attached", mode="interactive", cmd=sys.executable,
                last_seen=_time.time())
    st = serve.load_agent(repo)
    check("a record from another node is stale whatever its pid says",
          st and st["state"] == "stale")
    os.remove(agent_path)

    # A signal sent WITH a sentence keeps the person's own words and does not get
    # the canned gloss appended.
    status, _ = post("/say", {"signal": "help", "text": "the lattice makes no sense"})
    with open(repo.messages_path, "r", encoding="utf-8") as fh:
        lines = [json.loads(l) for l in fh if l.strip()]
    last = lines[-1].get("text", "")
    check("a sentence of their own is left alone",
          "the lattice makes no sense" in last and "they are stuck" not in last)
finally:
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

print()
print("%d FAILURES" % len(fails) if fails
      else "the first turn can come from the device")
sys.exit(1 if fails else 0)
