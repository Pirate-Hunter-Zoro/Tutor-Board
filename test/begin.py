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

import boardlib  # noqa: E402
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

    # ...but a HOMEWORK sitting means something else by the same tap, and reading
    # it the lecture way is expensive: the problems are assigned, an unanswered
    # one is a lost mark, and the student tapping past it is choosing an order
    # rather than shortening the sheet. So the skip defers, and the line says
    # what is still owed -- read off the document, so it survives the two hours,
    # the restart and the different tutor between the skip and the return.
    def hw_set(pairs):
        """A problem set where `pairs` is (label, written)."""
        body = ["\\documentclass{article}", "\\begin{document}"]
        for label, written in pairs:
            body += ["\\begin{problem}{%s}" % label, "  A statement.",
                     "\\end{problem}",
                     "%% ===== SOLUTION %s =====" % label,
                     ("The argument." if written
                      else "%% TODO(mferguson): your work goes here."),
                     "%% ===== END SOLUTION %s =====" % label]
        body.append("\\end{document}")
        path = os.path.join(tmp, "homework", "hw01", "hw01.tex")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(body) + "\n")

    def skip_line():
        post("/say", {"signal": "skip", "answers": "0002"})
        with open(repo.messages_path, "r", encoding="utf-8") as fh:
            rows = [json.loads(l) for l in fh if l.strip()]
        return rows[-1].get("text", "")

    with open(repo.state_path, "w", encoding="utf-8") as fh:
        json.dump({"course": "Test Course", "session": "homework",
                   "chapter": "Homework 1", "hw": "homework/hw01/hw01.tex"}, fh)

    hw_set([("1", True), ("2", False), ("3", False)])
    text = skip_line()
    check("a skipped homework problem is deferred, not dropped",
          "still assigned" in text and "come back to it" in text)
    check("and the tutor is told what is still owed, in the sheet's order",
          "2, 3" in text)
    check("and which region the next agreed answer goes in",
          "goes in 2" in text)
    check("and that the document is written in the sheet's order, not theirs",
          "any order" in text and "sheet's order regardless" in text)
    check("and it is not the lecture reading, which would drop the problem",
          "Do not re-ask it" not in text)

    # The degenerate case the person asked about out loud: skip the only one
    # left and it comes straight back, because there is nothing to go on with.
    hw_set([("1", True), ("2", True), ("3", False)])
    text = skip_line()
    check("skipping the only problem left has it asked again, and says why",
          "ONLY problem left" in text and "ask it again" in text)
    check("and says plainly that this is not pressing them",
          "not pressing them" in text)

    with open(repo.state_path, "w", encoding="utf-8") as fh:
        json.dump({"course": "Test Course", "session": "lecture",
                   "chapter": "Ch 1 — groups, fields and vector spaces"}, fh)

    # The board's own view of who is attached. An interactive assistant is idle
    # for as long as the person is thinking, so judging it by a heartbeat is why
    # this indicator was never once green outside headless.
    import time as _time
    agent_path = os.path.join(repo.live, "agent.json")

    def write_agent(**kw):
        with open(agent_path, "w", encoding="utf-8") as fh:
            json.dump(kw, fh)

    # Ask the board what this machine is called, exactly as the code does. This
    # line used to derive it here with `socket.gethostname()`, and that is the
    # whole bug in miniature: the machine renamed itself from the network, the
    # test went on writing records under the old name, and the mismatch it was
    # meant to catch was the one thing it could not see.
    host = boardlib.node_name()
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

    # The defect a person found on the device: the heartbeat is written at turn
    # boundaries, so a turn longer than the window reported a daemon busy
    # teaching as dead. A turn that reads a chapter and writes a card routinely
    # runs longer than two minutes.
    write_agent(host=host, pid=os.getpid(), agent="claude", state="working",
                turns=3, last_seen=_time.time() - 600)
    st = serve.load_agent(repo)
    check("a daemon mid-turn is not called dead for being slow",
          st and st["state"] == "working")

    write_agent(host=host, pid=999999, agent="claude", state="working",
                turns=3, last_seen=_time.time())
    st = serve.load_agent(repo)
    check("but a daemon whose process is gone is stale even mid-turn",
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

    # `board wait` has to wake on what is ALREADY unread, not only on what
    # arrives while it happens to be blocking. It used to take the unread count
    # as a baseline and return when that count grew, so a begin signal sent
    # before a tutor was attached -- which is the entire cold start this file is
    # about -- left the daemon waiting for a second tap on a board that was
    # already asking. The student tapped begin twice and got one card.
    import subprocess  # noqa: E402
    import time as _t   # noqa: E402

    with open(repo.messages_path, "r", encoding="utf-8") as fh:
        unread = [json.loads(l) for l in fh if l.strip()]
    check("something is sitting unread before the wait starts",
          any(not m.get("read") for m in unread))

    began = _t.time()
    p_wait = subprocess.run([sys.executable, os.path.join(ROOT, "bin", "board"),
                             "wait", "--timeout", "20"], cwd=tmp,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=60)
    took = _t.time() - began
    out = p_wait.stdout.decode("utf-8", "replace")
    check("a message already unread wakes `board wait` at once",
          p_wait.returncode == 0 and took < 5)
    check("and it is handed the message, not an empty inbox",
          "the lattice makes no sense" in out)

    # Reading is what consumes a message, so the next wait must block again
    # rather than deliver the same thing for ever.
    p_wait = subprocess.run([sys.executable, os.path.join(ROOT, "bin", "board"),
                             "wait", "--timeout", "1"], cwd=tmp,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=60)
    check("a read message does not wake it again", p_wait.returncode == 2)

    # ---- a picture is a message too --------------------------------------
    #
    # A screenshot of the next four exercises is the student saying "these are
    # the ones I want to do", and in a mathematics course it is the ONLY way to
    # say it: there is no text box, and the slate answers a question rather than
    # starting a subject. So it has to reach the tutor, and it has to reach it
    # meaning something -- a wake-up whose whole content is a filename has told
    # the assistant nothing, exactly as the bare "[begin]" tag did.
    boundary = "----tutorboardtest"
    payload = (
        "--%s\r\n"
        'Content-Disposition: form-data; name="f0"; filename="exercises.png"\r\n'
        "Content-Type: image/png\r\n\r\n" % boundary
    ).encode("utf-8") + b"\x89PNG\r\n\x1a\n" + ("\r\n--%s--\r\n" % boundary).encode("utf-8")
    req = urllib.request.Request(
        BASE + "/upload", method="POST", data=payload,
        headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
    with urllib.request.urlopen(req, timeout=10) as r:
        up = json.loads(r.read().decode("utf-8"))
    check("a photograph can be handed over", up.get("ok") and up.get("saved"))
    check("and is on disk where the tutor can open it",
          up.get("saved") and os.path.exists(os.path.join(repo.uploads, up["saved"][0])))

    with open(repo.messages_path, "r", encoding="utf-8") as fh:
        notes = [json.loads(l) for l in fh if l.strip()]
    shot = [m for m in notes if m.get("files")]
    check("it reaches the inbox, which is what wakes the tutor", len(shot) == 1)
    check("unread, so it wakes one that is already waiting",
          shot and shot[0].get("read") is False)
    shot_text = shot[0].get("text", "") if shot else ""
    check("the line names the file", "exercises.png" in shot_text)
    check("and says what to do with it, because a picture has no sentence in it",
          "open the file" in shot_text.lower() and "look at" in shot_text.lower())
    check("the line is not just a filename",
          len(shot_text.strip()) > len("[uploaded] exercises.png") + 20)

    # And the tutor is TOLD that any of this happens.
    with open(os.path.join(ROOT, "TEACHING.md"), "r", encoding="utf-8") as fh:
        method = fh.read().lower()
    check("the method tells the tutor pictures arrive and must be opened",
          "uploaded" in method and "board eyes" in method)
    check("and that one must never sit unremarked",
          "unremarked" in method or "never let one sit" in method)
finally:
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

print()
print("%d FAILURES" % len(fails) if fails
      else "the first turn can come from the device")
sys.exit(1 if fails else 0)
