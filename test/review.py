#!/usr/bin/env python3
"""A test review: revision over a scope the student chose.

The board already had two kinds of sitting and both of them decide the problem
list somewhere the student is not: a lecture's is the tutor's to pick, a
homework's was set on a sheet. Revising for a test is neither — the student is
the only one who knows what is on the paper — so the scope is chosen on the
board, from what the repository actually has, and the tutor is told it and told
not to widen it.

What is guarded here is everything that could let a name nobody chose reach the
filesystem or the tutor's prompt, and the two shapes of repository: a course has
chapters, a project has parts, and neither is invented for the other.
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
import review   # noqa: E402
import serve    # noqa: E402

fails = []


def check(name, cond):
    if cond:
        print("ok   " + name)
    else:
        fails.append(name)
        print("FAIL " + name)


# --- what a repository can be reviewed over -----------------------------------
# Discovered, never registered: the same rule as course discovery and problem-set
# discovery, and for the same reason -- an index is a thing that goes stale.
book = tempfile.mkdtemp(prefix="tutor-rev-book-")
proj = tempfile.mkdtemp(prefix="tutor-rev-proj-")
flat = tempfile.mkdtemp(prefix="tutor-rev-flat-")
bare = tempfile.mkdtemp(prefix="tutor-rev-bare-")
try:
    with open(os.path.join(book, "chapters.tsv"), "w", encoding="utf-8") as fh:
        fh.write("01\t1\t9\tch01-a\tGroups, fields and vector spaces\n"
                 "02\t10\t19\tch02-b\tThe Euclidean algorithm\n"
                 "07\t60\t70\tch07-c\tSplitting fields\n")

    units = review.units(book)
    check("a course offers its own chapters", len(units) == 3)
    check("and they are chapters, not parts",
          review.kind(book) == "chapters" and units[0]["kind"] == "chapter")
    check("in the order the course puts them in",
          [u["short"] for u in units] == ["Ch 01", "Ch 02", "Ch 07"])

    for d in ("web", "scripts", "bin", "live", "node_modules", "__pycache__", ".git"):
        os.makedirs(os.path.join(proj, d), exist_ok=True)
    with open(os.path.join(proj, "serve.py"), "w") as fh:
        fh.write("x\n")
    names = [u["name"] for u in review.units(proj)]
    check("a project with no chapters offers its own parts instead",
          review.kind(proj) == "parts" and names == ["bin", "scripts", "web"])
    # Nobody revises their build output or somebody else's library, and the
    # board's own working directory is not part of the project at all.
    check("and never build output, dependencies or the board's own live/",
          not ({"live", "node_modules", "__pycache__", ".git"} & set(names)))

    for f in ("main.py", "util.py", "README.md"):
        with open(os.path.join(flat, f), "w") as fh:
            fh.write("x\n")
    check("a flat project falls back to its own source files",
          [u["name"] for u in review.units(flat)] == ["main.py", "util.py"])

    check("a repository with neither says so rather than inventing one",
          review.units(bare) == [] and review.status(bare, {}) is None)

    # --- a name from a request is checked, never trusted -----------------------
    chosen, unknown = review.resolve(book, ["Ch 07 — Splitting fields", "ch01"])
    check("a chapter can be named by its label or by its number",
          [u["short"] for u in chosen] == ["Ch 01", "Ch 07"])
    check("and the scope comes back in the course's order, not the tapping order",
          [u["short"] for u in chosen] == ["Ch 01", "Ch 07"])
    check("a name this course does not have is reported, not dropped",
          review.resolve(book, ["ch99"])[1] == ["ch99"])
    check("naming the same chapter twice reviews it once",
          len(review.resolve(book, ["7", "ch07", "Ch 07"])[0]) == 1)
    # `chapters.tsv` writes 07 and a chapter directory writes 7. Both are the
    # course's own way of saying the same thing.
    check("padded and unpadded chapter numbers both find it",
          review.resolve(book, ["7"])[0] and review.resolve(book, ["07"])[0])

    # --- the scope is re-resolved, never echoed back --------------------------
    state = {"review": ["Ch 01 — Groups, fields and vector spaces",
                        "Ch 99 — deleted since"]}
    scope = review.scope(book, state)
    check("a scope naming something that no longer exists drops it",
          [u["short"] for u in scope] == ["Ch 01"])

    check("a short scope is named in the sitting label",
          review.sitting_label(review.resolve(book, ["1", "7"])[0])
          == "Test review — Ch 01, Ch 07")
    check("and a long one is counted instead of listed",
          review.sitting_label(review.resolve(book, ["1", "2", "7"])[0]
                               + [{"short": "Ch 08"}], "chapters")
          == "Test review — 4 chapters")
finally:
    for d in (proj, flat, bare):
        shutil.rmtree(d, ignore_errors=True)

# --- the sitting itself, through the real handler -----------------------------
tmp = tempfile.mkdtemp(prefix="tutor-rev-")
json.dump({"name": "Galois Theory", "mode": "math"},
          open(os.path.join(tmp, "tutorboard.json"), "w"))
shutil.copy(os.path.join(book, "chapters.tsv"), os.path.join(tmp, "chapters.tsv"))
repo = serve.Repo(tmp)
open(os.path.join(repo.cards, "0001-mid-lesson.md"), "w", encoding="utf-8").write(
    "---\nkind: lesson\ntitle: A card\n---\n\nwork in progress\n")

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
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


try:
    payload = hub.build()
    check("the board is told what can be reviewed before any review exists",
          payload.get("review") and len(payload["review"]["units"]) == 3)
    check("and that nothing is being reviewed yet",
          payload["review"]["scope"] == [])

    # A scope is a list, because a test is not one chapter.
    status, body = post("/session", {
        "session": "review",
        "over": ["Ch 01 — Groups, fields and vector spaces",
                 "Ch 07 — Splitting fields"]})
    check("a review can be opened from the board over several chapters",
          status == 200 and body.get("ok"))
    st = repo.state()
    check("the badge will read review", st.get("session") == "review")
    check("and the scope is recorded, in the course's own order",
          st.get("review") == ["Ch 01 — Groups, fields and vector spaces",
                               "Ch 07 — Splitting fields"])
    check("the sitting is labelled with what it covers",
          "Test review" in (st.get("chapter") or ""))
    # Opening one is starting a different lesson, so what is being left is filed
    # whole rather than written over -- the same rule as switching chapter.
    check("and the lesson it interrupted was filed, not overwritten",
          len(serve.list_archive(repo)) == 1)

    # Nothing invented reaches the filesystem or the prompt.
    status, body = post("/session", {"session": "review", "over": ["ch99"]})
    check("a chapter this course does not have is refused",
          status == 400 and body.get("unknown") == ["ch99"])
    status, _ = post("/session", {"session": "review", "over": []})
    check("and a review over nothing is refused rather than opened", status == 400)
    check("a refused review leaves the sitting it was in alone",
          repo.state().get("review") == ["Ch 01 — Groups, fields and vector spaces",
                                         "Ch 07 — Splitting fields"])

    # --- what the tutor is actually told --------------------------------------
    sense = serve.session_sense(repo)
    check("the tutor is told this is a test review", "TEST REVIEW" in sense)
    check("and the chapters are named in the prompt, not left to be looked up",
          "Splitting fields" in sense and "Groups, fields and vector spaces" in sense)
    check("and told the scope is not its to widen", "not yours to widen" in sense)
    check("and to spread the questions across all of it",
          "spread the questions" in sense)
    check("and that a review produces no document",
          "do not compile" in sense and "no write-up" in sense)
    check("and it still points at the method rather than restating it",
          "live/TEACHING.md" in sense)
    # A lecture picks a manageable few from one section; a review is not that.
    check("and not told to pick a manageable few, which is a lecture behaviour",
          "manageable few" not in sense)

    status, _ = post("/session", {"session": "lecture"})
    check("switching back to a lecture ends the review",
          repo.state().get("session") == "lecture")
    check("and clears its scope, so no strip describes a sitting that has gone",
          not repo.state().get("review"))
    check("and the lecture prompt is a lecture's again",
          "manageable few" in serve.session_sense(repo))

    # --- a review with nothing chosen -----------------------------------------
    # Not reachable from the board's picker, which refuses to start one. It is
    # reachable from `board open --review` with no --over, and the answer is to
    # ask rather than to choose -- exactly as a homework sitting with no sheet.
    st = repo.state()
    st["session"] = "review"
    st.pop("review", None)
    json.dump(st, open(repo.state_path, "w"))
    sense = serve.session_sense(repo)
    check("a review with no scope asks which chapters rather than choosing them",
          "Ask in your first card" in sense and "do not choose them yourself" in sense)
finally:
    httpd.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)

# --- a project is revised too, and it is not set work -------------------------
# The user will probably never do this, but a project falling through to the code
# prompt would be told to go and find the next change to make, which is the
# opposite of a review.
tmp2 = tempfile.mkdtemp(prefix="tutor-rev-code-")
try:
    json.dump({"name": "TRD-EHR", "mode": "code", "stance": "do"},
              open(os.path.join(tmp2, "tutorboard.json"), "w"))
    for d in ("loader", "pipeline"):
        os.makedirs(os.path.join(tmp2, d))
    repo2 = serve.Repo(tmp2)
    st = repo2.state()
    st.update({"session": "review", "review": ["loader", "pipeline"]})
    json.dump(st, open(repo2.state_path, "w"))

    sense = serve.session_sense(repo2)
    check("a project review is a review, not the next piece of work",
          "TEST REVIEW" in sense and "next" not in sense.split("TEST REVIEW")[0])
    check("and names the parts it is over", "loader" in sense and "pipeline" in sense)
    check("and calls them parts of the project, not chapters",
          "parts of this project" in sense)
    check("and is told to ask about the code rather than to set a change",
          "do not assign a change" in sense)
    # `stance: do` says write the code. It cannot mean write it into a review.
    check("and a doing stance does not turn a review into work",
          "because a review asks" in sense)

    st["session"] = "lecture"
    json.dump(st, open(repo2.state_path, "w"))
    check("while an ordinary sitting in the same project is still a project",
          "PROJECT" in serve.session_sense(repo2))
finally:
    shutil.rmtree(tmp2, ignore_errors=True)
    shutil.rmtree(book, ignore_errors=True)

print()
print("%d FAILURES" % len(fails) if fails
      else "a review covers what the student chose and nothing else")
sys.exit(1 if fails else 0)
