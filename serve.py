#!/usr/bin/env python3
"""
serve.py -- the live tutoring board server.

One process per course repository. It watches <repo>/live/cards/ for card files
written by the assistant, renders them to a payload, and pushes that payload to
every connected browser over Server-Sent Events. Any TikZ block inside a card is
compiled to a cached SVG by a background worker.

It also accepts input coming back the other way: text typed into the board from
a phone or iPad, and files (handwritten PDFs, photos of scratch work) dropped
onto the page. Both land in <repo>/live/inbox/ where the assistant reads them.

Python 3.9, standard library only. No pip, no npm, no build step.
"""

import hashlib
import json
import mimetypes
import os
import posixpath
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)
import boardlib
WEB = os.path.join(HERE, "web")

# Python's table predates these; without them fonts go out as octet-stream and
# a strict browser can refuse to load them.
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("application/manifest+json", ".webmanifest")

POLL_SECONDS = 0.25
CARD_RE = re.compile(r"^(\d{4})[-_.](.*)\.(md|markdown|tex)$")


# ---------------------------------------------------------------------------
# repository paths
# ---------------------------------------------------------------------------
class Repo:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.live = os.path.join(self.root, "live")
        self.cards = os.path.join(self.live, "cards")
        self.inbox = os.path.join(self.live, "inbox")
        self.uploads = os.path.join(self.inbox, "uploads")
        self.tikz = os.path.join(self.live, "tikzcache")
        self.archive = os.path.join(self.live, "archive")
        self.slate = os.path.join(self.live, "slate")
        # What the student actually handed in, frozen at the moment they sent
        # it. The slate is a working surface and gets written over; a transcript
        # cannot be built out of a surface that changes underneath it.
        self.answers = os.path.join(self.live, "answers")
        for d in (self.live, self.cards, self.inbox, self.uploads, self.tikz,
                  self.archive, self.slate, self.answers):
            os.makedirs(d, exist_ok=True)

    @property
    def state_path(self):
        return os.path.join(self.live, "state.json")

    @property
    def messages_path(self):
        return os.path.join(self.inbox, "messages.jsonl")

    @property
    def turns_path(self):
        return os.path.join(self.live, "turns.jsonl")

    def state(self):
        try:
            with open(self.state_path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return {}


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


def load_cards(repo, jobs):
    cards = []
    try:
        names = sorted(os.listdir(repo.cards))
    except OSError:
        names = []
    for name in names:
        m = CARD_RE.match(name)
        if not m:
            continue
        path = os.path.join(repo.cards, name)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.read()
        except OSError:
            continue
        meta, body = parse_front_matter(raw)
        body = extract_tikz(body, jobs, repo)
        cards.append({
            "id": m.group(1),
            "slug": m.group(2),
            "kind": (meta.get("kind") or "lesson").lower(),
            "title": meta.get("title", ""),
            "tag": meta.get("tag", ""),
            "body": body,
            "mtime": os.path.getmtime(path),
        })
    return cards


def load_messages(repo, limit=60):
    out = []
    try:
        with open(repo.messages_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return out[-limit:]


# ---------------------------------------------------------------------------
# turns -- the student's half of the transcript
# ---------------------------------------------------------------------------
# A lesson is a conversation, and half of it was previously being thrown into a
# drawer: sent slate pages appeared as thumbnails at the bottom of the page with
# no connection to the question they answered, and nothing the student wrote
# survived the next lesson.
#
# A turn is one contribution, anchored to the card it answers, and versioned:
# sending again after feedback supersedes the previous revision in place rather
# than adding another thumbnail to a pile. The file is append-only -- the whole
# history is on disk -- and only the newest revision of each turn is shown.

def load_turns(repo, path=None):
    """Newest revision of each turn, in the order the turns first appeared."""
    order, latest = [], {}
    try:
        with open(path or repo.turns_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                tid = rec.get("id")
                if not tid:
                    continue
                if tid not in latest:
                    order.append(tid)
                    rec["t0"] = rec.get("t")
                if rec.get("rev", 1) >= latest.get(tid, {}).get("rev", 0):
                    # A revision keeps the original's place in the transcript.
                    rec["t0"] = latest.get(tid, rec).get("t0", rec.get("t"))
                    latest[tid] = rec
    except OSError:
        return []
    return [latest[t] for t in order]


def next_turn_id(repo):
    n = 0
    for rec in load_turns(repo):
        try:
            n = max(n, int(str(rec.get("id", "t0"))[1:]))
        except ValueError:
            pass
    return "t%04d" % (n + 1)


def turn_revision(repo, tid):
    rev = 0
    for rec in load_turns(repo):
        if rec.get("id") == tid:
            rev = rec.get("rev", 1)
    return rev + 1


def newest_question(repo):
    """The card a turn sent now is answering."""
    newest = None
    try:
        names = sorted(os.listdir(repo.cards))
    except OSError:
        return None
    for name in names:
        m = CARD_RE.match(name)
        if not m:
            continue
        try:
            with open(os.path.join(repo.cards, name), "r", encoding="utf-8") as fh:
                meta, _ = parse_front_matter(fh.read())
        except OSError:
            continue
        if (meta.get("kind") or "lesson").lower() == "question":
            newest = m.group(1)
    return newest


def write_turn(repo, rec):
    with open(repo.turns_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")


# ---------------------------------------------------------------------------
# past lessons
# ---------------------------------------------------------------------------
def list_archive(repo):
    """Every finished lesson, newest first, as something to pick from."""
    out = []
    try:
        names = sorted(os.listdir(repo.archive), reverse=True)
    except OSError:
        return out
    for name in names:
        folder = os.path.join(repo.archive, name)
        if not os.path.isdir(folder):
            continue
        st = {}
        try:
            with open(os.path.join(folder, "state.json"), "r", encoding="utf-8") as fh:
                st = json.load(fh) or {}
        except (OSError, ValueError):
            pass
        cards = [n for n in os.listdir(folder) if CARD_RE.match(n)]
        turns = load_turns(repo, os.path.join(folder, "turns.jsonl"))
        out.append({
            "id": name,
            "course": st.get("course") or "",
            "chapter": st.get("chapter") or "",
            "session": st.get("session") or "lecture",
            "opened": st.get("opened") or "",
            "finished": st.get("finished") or "",
            "cards": len(cards),
            "turns": len(turns),
        })
    return out


def archived_session(repo, name):
    """One past lesson, rendered the same way a live one is."""
    folder = os.path.join(repo.archive, name)
    st = {}
    try:
        with open(os.path.join(folder, "state.json"), "r", encoding="utf-8") as fh:
            st = json.load(fh) or {}
    except (OSError, ValueError):
        pass
    jobs = []
    saved_cards, repo.cards = repo.cards, folder
    try:
        cards = load_cards(repo, jobs)
    finally:
        repo.cards = saved_cards
    turns = load_turns(repo, os.path.join(folder, "turns.jsonl"))
    # Their frozen ink lives inside the archived folder now, so the transcript
    # keeps working after the live answers directory has moved on.
    for t in turns:
        for key in ("png", "ink"):
            if t.get(key, "").startswith("/answers/"):
                t[key] = "/archive/%s/answers/%s" % (name, t[key][len("/answers/"):])
    return {"id": name, "state": st, "cards": cards, "turns": turns,
            "archived": True}


def read_slate_pages(repo):
    """Full stroke data, so the slate resumes where it left off on any device."""
    pages = []
    try:
        names = sorted(n for n in os.listdir(repo.slate) if re.match(r"^page-\d+\.json$", n))
    except OSError:
        names = []
    for name in names:
        try:
            with open(os.path.join(repo.slate, name), "r", encoding="utf-8") as fh:
                pages.append(json.load(fh))
        except (OSError, ValueError):
            pass
    return pages


def load_slate(repo, limit=40):
    """Saved slate pages, newest last. Only the metadata -- the strokes stay on
    disk until the slate itself asks for them."""
    out = []
    try:
        names = sorted(n for n in os.listdir(repo.slate) if re.match(r"^page-\d+\.png$", n))
    except OSError:
        names = []
    for name in names[-limit:]:
        path = os.path.join(repo.slate, name)
        out.append({
            "name": name,
            "page": int(name[5:-4]),
            "url": "/slate/" + name,
            "mtime": os.path.getmtime(path),
            "size": os.path.getsize(path),
        })
    return out


def load_agent(repo):
    """Is a headless assistant attached, and is it working or waiting?

    A daemon nobody can see is worse than no daemon. The heartbeat goes stale in
    two minutes, so a crashed one stops claiming to be listening.
    """
    try:
        with open(os.path.join(repo.live, "agent.json"), "r", encoding="utf-8") as fh:
            st = json.load(fh)
    except (OSError, ValueError):
        return None
    if time.time() - st.get("last_seen", 0) > 120:
        st["state"] = "stale"
    return st


def load_push(repo):
    """The outcome of the last push, so the iPad can see it without a terminal."""
    try:
        with open(os.path.join(repo.live, "push.json"), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def run_push(repo, message=None):
    """Commit and push this repository, and record what happened.

    The work is the repository owner's. The script carries no co-author trailer
    and neither does anything here -- history should credit the person who did
    the mathematics and nobody else.
    """
    script = os.path.join(repo.root, "scripts", "save-and-push.sh")
    if os.path.exists(script):
        cmd = ["bash", script]
        if message:
            cmd.append(message)
    else:
        cmd = ["bash", "-c",
               'set -e; export GIT_TERMINAL_PROMPT=0; git add -A; '
               'git diff --cached --quiet || git commit -m "$1"; git push'
               , "_", message or "lesson complete"]
    try:
        p = subprocess.run(cmd, cwd=repo.root, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=180)
        out = p.stdout.decode("utf-8", "replace").strip()
        code = p.returncode
    except subprocess.TimeoutExpired:
        out, code = "timed out after 3 minutes -- is a credential prompt waiting?", 1
    except OSError as exc:
        out, code = str(exc), 1

    record = {
        "ok": code == 0,
        "at": time.time(),
        "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
        "detail": out[-1200:],
    }
    with open(os.path.join(repo.live, "push.json"), "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)
    return record


def load_uploads(repo, limit=40):
    out = []
    try:
        names = sorted(os.listdir(repo.uploads))
    except OSError:
        names = []
    for name in names[-limit:]:
        path = os.path.join(repo.uploads, name)
        if not os.path.isfile(path):
            continue
        out.append({
            "name": name,
            "size": os.path.getsize(path),
            "url": "/uploads/" + urllib.parse.quote(name),
            "mtime": os.path.getmtime(path),
        })
    return out


DEFAULT_CONFIG = {"name": None, "mode": None, "subtitle": ""}


def read_config(root):
    """A course declares itself in tutorboard.json at its root.

    Everything is optional. What is not declared is guessed, and the guess is
    only ever about how the board behaves, never about whether it works.
    """
    cfg = dict(DEFAULT_CONFIG)
    try:
        with open(os.path.join(root, "tutorboard.json"), "r", encoding="utf-8") as fh:
            cfg.update(json.load(fh) or {})
    except (OSError, ValueError):
        pass

    if not cfg.get("name"):
        cfg["name"] = os.path.basename(os.path.abspath(root)).replace("-", " ")

    mode = (cfg.get("mode") or "").lower()
    if mode not in ("math", "code"):
        mode = guess_mode(root)
    cfg["mode"] = mode
    return cfg


def guess_mode(root):
    """LaTeX in the repository means mathematics; otherwise assume code.

    Only a fallback. A repository that cares should say so in tutorboard.json --
    the guess is cheap to get wrong and free to override.
    """
    if os.path.isdir(os.path.join(root, "latex")):
        return "math"
    for base, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs
                   if d not in (".git", "live", "node_modules", "build", "__pycache__")]
        if any(n.endswith(".tex") for n in names):
            return "math"
        if base.count(os.sep) - root.count(os.sep) > 2:
            dirs[:] = []
    return "code"


def sibling_courses(repo):
    """Course repositories sitting alongside this one.

    A repository counts if it holds AI_INSTRUCTIONS.md or a live/ directory. The
    parent directory is the whole search -- there is no configuration and no
    registry to keep in step with reality.
    """
    parent = os.path.dirname(repo.root)
    out = []
    try:
        names = sorted(os.listdir(parent))
    except OSError:
        return out
    for name in names:
        root = os.path.join(parent, name)
        if not os.path.isdir(root):
            continue
        if not (os.path.isfile(os.path.join(root, "tutorboard.json")) or
                os.path.isfile(os.path.join(root, "AI_INSTRUCTIONS.md")) or
                os.path.isdir(os.path.join(root, "live"))):
            continue
        if os.path.abspath(root) == HERE:
            continue          # the tool is not one of the courses
        live = os.path.join(root, "live")
        cfg = read_config(root)
        entry = {
            "repo": name,
            "current": os.path.abspath(root) == repo.root,
            "course": cfg["name"],
            "mode": cfg["mode"],
            "chapter": "",
            "cards": 0,
            "running": False,
            "node": None,
        }
        try:
            with open(os.path.join(live, "state.json"), "r", encoding="utf-8") as fh:
                st = json.load(fh)
            entry["course"] = st.get("course") or entry["course"]
            entry["chapter"] = st.get("chapter") or ""
        except (OSError, ValueError):
            pass
        try:
            entry["cards"] = len([n for n in os.listdir(os.path.join(live, "cards"))
                                  if CARD_RE.match(n)])
        except OSError:
            pass
        try:
            with open(os.path.join(live, ".board.json"), "r", encoding="utf-8") as fh:
                info = json.load(fh)
            entry["node"] = info.get("node")
            if info.get("node") == socket.gethostname().split(".")[0]:
                try:
                    os.kill(info.get("pid", -1), 0)
                    entry["running"] = True
                except OSError:
                    pass
            else:
                entry["running"] = bool(info.get("node"))
        except (OSError, ValueError):
            pass
        out.append(entry)
    return out


def board_cli(repo, args, timeout=90):
    """Drive the board command line from inside the server, for /switch."""
    cli = os.path.join(HERE, "bin", "board")
    try:
        p = subprocess.run([sys.executable, cli] + list(args),
                           cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout)
        return p.returncode, p.stdout.decode("utf-8", "replace")
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)


def tutor_cli(args, timeout=30):
    """Drive the launcher from inside the server, for the agent handover.

    The assistant belongs to the course, not to this process and not to the
    terminal anyone happens to have open, so switching course has to move it.
    Short timeout deliberately: `tutor agent start` detaches and returns, and
    `stop` only signals -- the wrap-up turn it triggers takes as long as it
    takes and nobody is waiting on it.
    """
    cli = os.path.join(HERE, "bin", "tutor")
    try:
        p = subprocess.run([sys.executable, cli] + list(args),
                           cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout)
        return p.returncode, p.stdout.decode("utf-8", "replace")
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 1, str(exc)


# ---------------------------------------------------------------------------
# TikZ -> SVG worker
# ---------------------------------------------------------------------------
# The course's own macros load first and win; board-macros.tex is all
# \providecommand, so it only fills in whatever the course did not define. Without
# it a command that renders fine in the prose fails inside a tikz fence, which is
# the most confusing way for a diagram to break.
TIKZ_DOC = r"""\documentclass[border=6pt,varwidth=%(width)s]{standalone}
\usepackage{amsmath,amssymb,amsthm,mathtools}
\usepackage{tikz}
\usepackage{tikz-cd}
\usetikzlibrary{arrows.meta,positioning,calc,fit,shapes.geometric}
%(macros)s
\input{board-macros.tex}
\begin{document}
%(body)s
\end{document}
"""


class TikzWorker(threading.Thread):
    daemon = True

    def __init__(self, repo):
        threading.Thread.__init__(self)
        self.repo = repo
        self.queue = []
        self.seen = set()
        self.cv = threading.Condition()
        self.dirty = threading.Event()

    def submit(self, jobs):
        with self.cv:
            for job in jobs:
                if job[0] in self.seen:
                    continue
                self.seen.add(job[0])
                self.queue.append(job)
            if self.queue:
                self.cv.notify()

    def run(self):
        while True:
            with self.cv:
                while not self.queue:
                    self.cv.wait()
                digest, kind, src = self.queue.pop(0)
            try:
                self.compile(digest, kind, src)
            except Exception as exc:  # never let the worker die
                self._fail(digest, str(exc))
            self.dirty.set()

    def _fail(self, digest, msg):
        with open(os.path.join(self.repo.tikz, digest + ".err"), "w", encoding="utf-8") as fh:
            fh.write(msg)

    def compile(self, digest, kind, src):
        # A blank line inside a tikzpicture or tikzcd is a \par and blows up the
        # cell. Markdown fences pick up trailing whitespace, so strip it here.
        src = "\n".join(ln for ln in src.split("\n") if ln.strip()).strip()
        macros = ""
        sty = os.path.join(self.repo.root, "latex", "coursemacros.sty")
        if os.path.exists(sty):
            macros = r"\usepackage{coursemacros}"
        body = src
        if kind == "tikzcd" and "\\begin{tikzcd}" not in src:
            body = "\\begin{tikzcd}\n%s\n\\end{tikzcd}" % src
        elif kind == "tikz" and "\\begin{tikzpicture}" not in src and "\\begin{tikzcd}" not in src:
            body = "\\begin{tikzpicture}\n%s\n\\end{tikzpicture}" % src

        work = os.path.join(self.repo.tikz, "_work-" + digest)
        os.makedirs(work, exist_ok=True)
        tex = os.path.join(work, "fig.tex")
        with open(tex, "w", encoding="utf-8") as fh:
            fh.write(TIKZ_DOC % {"width": "0pt", "macros": macros, "body": body})

        env = boardlib.tex_env([
            os.path.join(self.repo.root, "latex"),
            os.path.join(HERE, "tex"),
        ])

        proc = subprocess.run(
            ["latex", "-interaction=nonstopmode", "-halt-on-error",
             "-output-directory=" + work, tex],
            cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90,
        )
        dvi = os.path.join(work, "fig.dvi")
        if proc.returncode != 0 or not os.path.exists(dvi):
            log = os.path.join(work, "fig.log")
            detail = ""
            if os.path.exists(log):
                with open(log, "r", encoding="utf-8", errors="replace") as fh:
                    lines = [ln for ln in fh if ln.startswith("!") or ".tex:" in ln]
                detail = "".join(lines[:8])
            self._fail(digest, detail or proc.stdout.decode("utf-8", "replace")[-800:])
            shutil.rmtree(work, ignore_errors=True)
            return

        out = os.path.join(self.repo.tikz, digest + ".svg")
        proc = subprocess.run(
            ["dvisvgm", "--no-fonts", "--exact-bbox", "--zoom=1.35",
             "--output=" + out, dvi],
            cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90,
        )
        if proc.returncode != 0 or not os.path.exists(out):
            self._fail(digest, proc.stdout.decode("utf-8", "replace")[-800:])
        shutil.rmtree(work, ignore_errors=True)


# ---------------------------------------------------------------------------
# broadcast hub
# ---------------------------------------------------------------------------
class Hub:
    def __init__(self, repo, worker):
        self.repo = repo
        self.worker = worker
        self.lock = threading.Lock()
        self.clients = []
        self.payload = "{}"
        self.digest = ""
        self.seq = 0

    def subscribe(self):
        q = []
        cv = threading.Condition()
        client = (q, cv)
        with self.lock:
            self.clients.append(client)
        return client

    def unsubscribe(self, client):
        with self.lock:
            if client in self.clients:
                self.clients.remove(client)

    def build(self):
        jobs = []
        cards = load_cards(self.repo, jobs)
        if jobs:
            self.worker.submit(jobs)
        state = self.repo.state()
        cfg = read_config(self.repo.root)
        state.setdefault("course", cfg["name"])
        state["mode"] = cfg["mode"]
        data = {
            "state": state,
            "cards": cards,
            "turns": load_turns(self.repo),
            "messages": load_messages(self.repo),
            "uploads": load_uploads(self.repo),
            "slate": load_slate(self.repo),
            "push": load_push(self.repo),
            "agent": load_agent(self.repo),
            "history": len(list_archive(self.repo)),
        }
        return data

    def poll_loop(self):
        while True:
            try:
                data = self.build()
                # The digest covers content only; seq is stamped afterwards, or
                # every poll would look like a change and loop forever.
                blob = json.dumps(data, sort_keys=True)
                digest = hashlib.sha1(blob.encode("utf-8")).hexdigest()
                if digest != self.digest:
                    self.digest = digest
                    self.seq += 1
                    data["seq"] = self.seq
                    self.payload = json.dumps(data)
                    self.push(self.payload)
            except Exception:
                pass
            if self.worker.dirty.wait(POLL_SECONDS):
                self.worker.dirty.clear()

    def push(self, payload):
        with self.lock:
            targets = list(self.clients)
        for q, cv in targets:
            with cv:
                q.append(payload)
                cv.notify()


# ---------------------------------------------------------------------------
# multipart parsing (hand rolled; cgi.FieldStorage is deprecated)
# ---------------------------------------------------------------------------
def parse_multipart(body, boundary):
    parts = []
    sep = b"--" + boundary
    for chunk in body.split(sep):
        if not chunk or chunk in (b"--\r\n", b"--", b"\r\n"):
            continue
        if chunk.startswith(b"\r\n"):
            chunk = chunk[2:]
        if chunk.endswith(b"\r\n"):
            chunk = chunk[:-2]
        head, _, data = chunk.partition(b"\r\n\r\n")
        if not _:
            continue
        headers = {}
        for line in head.decode("utf-8", "replace").splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        disp = headers.get("content-disposition", "")
        name = None
        filename = None
        m = re.search(r'name="([^"]*)"', disp)
        if m:
            name = m.group(1)
        m = re.search(r'filename="([^"]*)"', disp)
        if m:
            filename = m.group(1)
        parts.append({"name": name, "filename": filename, "data": data})
    return parts


SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(name):
    name = posixpath.basename((name or "").replace("\\", "/"))
    name = SAFE_NAME.sub("-", name).strip("-.") or "drop"
    return name[:120]


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "mathboard"

    def log_message(self, fmt, *args):
        pass

    # -- helpers ---------------------------------------------------------
    def send_bytes(self, data, ctype, cache=False, status=200, nosniff=False, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if nosniff:
            self.send_header("X-Content-Type-Options", "nosniff")
        if extra:
            self.send_header(extra[0], extra[1])
        if cache:
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            # The shell must never be held by the browser: an installed app that
            # cannot pick up a fix is an app nobody can repair.
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if getattr(self, "head_only", False):
            return
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_json(self, obj, status=200):
        self.send_bytes(json.dumps(obj).encode("utf-8"), "application/json", status=status)

    # Types that are safe to hand back inline for a file somebody uploaded.
    # Everything else is downloaded rather than rendered -- an uploaded .html or
    # .svg would otherwise run script on this origin.
    INLINE_OK = {"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"}

    def send_file(self, path, cache=False, untrusted=False):
        if not os.path.isfile(path):
            self.send_bytes(b"not found", "text/plain", status=404)
            return
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if path.endswith(".svg") and not untrusted:
            ctype = "image/svg+xml"
        extra = None
        if untrusted and ctype not in self.INLINE_OK:
            ctype = "application/octet-stream"
            extra = ("Content-Disposition",
                     'attachment; filename="%s"' % os.path.basename(path))
        with open(path, "rb") as fh:
            self.send_bytes(fh.read(), ctype, cache=cache, nosniff=untrusted, extra=extra)

    MAX_BODY = 64 * 1024 * 1024   # a slate page is ~200 KB; this is generous

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > self.MAX_BODY:
            raise ValueError("body too large")
        buf = b""
        while len(buf) < length:
            chunk = self.rfile.read(min(65536, length - len(buf)))
            if not chunk:
                break
            buf += chunk
        return buf

    # -- routing ---------------------------------------------------------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        repo = self.server.repo
        hub = self.server.hub

        if path in ("/", "/index.html", "/home"):
            return self.send_file(os.path.join(WEB, "home.html"))
        if path in ("/board", "/board/"):
            return self.send_file(os.path.join(WEB, "board.html"))
        if path == "/courses.json":
            info = {}
            try:
                with open(os.path.join(repo.live, ".board.json"), "r", encoding="utf-8") as fh:
                    info = json.load(fh)
            except (OSError, ValueError):
                pass
            urls = [u for u in info.get("urls", []) if "127.0.0.1" not in u]
            return self.send_json({
                "courses": sibling_courses(repo),
                "where": (urls[0] if urls else "") ,
                "node": info.get("node"),
            })
        # Installable-app files must sit at the root: the service worker's scope
        # is its own directory, and iOS looks for /apple-touch-icon.png.
        if path == "/manifest.webmanifest":
            return self.send_bytes(open(os.path.join(WEB, "manifest.webmanifest"), "rb").read(),
                                   "application/manifest+json")
        if path == "/sw.js":
            return self.send_file(os.path.join(WEB, "sw.js"))
        if re.match(r"^/(apple-touch-icon|icon-\d+)\.png$", path):
            return self.send_file(os.path.join(WEB, os.path.basename(path)), cache=True)
        if path in ("/slate", "/slate/"):
            return self.send_file(os.path.join(WEB, "slate.html"))
        if path == "/slate/state":
            return self.send_json({"pages": read_slate_pages(repo)})
        if re.match(r"^/slate/page-\d+\.png$", path):
            return self.send_file(os.path.join(repo.slate, os.path.basename(path)))
        if path == "/events":
            return self.sse(hub)
        if path == "/board.json":
            return self.send_bytes(hub.payload.encode("utf-8"), "application/json")
        if path.startswith("/static/"):
            rel = path[len("/static/"):]
            target = os.path.normpath(os.path.join(WEB, rel))
            if not target.startswith(WEB):
                return self.send_bytes(b"nope", "text/plain", status=403)
            return self.send_file(
                target, cache=rel.startswith("katex/") or rel.startswith("fonts/"))
        if path.startswith("/figure/"):
            digest = safe_filename(path[len("/figure/"):]).replace(".svg", "")
            return self.send_file(os.path.join(repo.tikz, digest + ".svg"), cache=True)
        if path.startswith("/uploads/"):
            name = safe_filename(path[len("/uploads/"):])
            return self.send_file(os.path.join(repo.uploads, name), untrusted=True)
        if path.startswith("/answers/"):
            name = safe_filename(path[len("/answers/"):])
            return self.send_file(os.path.join(repo.answers, name))
        if path.startswith("/archive/"):
            # A past lesson, read only. The transcript is the point of keeping
            # them: a student coming back to a chapter should see what they
            # wrote at the time, not an empty board.
            rel = path[len("/archive/"):].strip("/")
            if not rel:
                return self.send_json({"sessions": list_archive(repo)})
            name = safe_filename(rel.split("/")[0])
            folder = os.path.join(repo.archive, name)
            if not os.path.isdir(folder):
                return self.send_json({"ok": False, "error": "no such session"}, status=404)
            rest = rel.split("/")[1:]
            if rest and rest[0] == "answers" and len(rest) > 1:
                return self.send_file(os.path.join(folder, "answers",
                                                   safe_filename(rest[1])))
            return self.send_json(archived_session(repo, name))
        if path == "/archive":
            return self.send_json({"sessions": list_archive(repo)})
        if path == "/health":
            return self.send_json({"ok": True, "root": repo.root})
        return self.send_bytes(b"not found", "text/plain", status=404)

    def do_HEAD(self):
        """Same routing as GET, headers only. Health checks and proxies use it."""
        self.head_only = True
        try:
            self.do_GET()
        finally:
            self.head_only = False

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        repo = self.server.repo

        if path == "/push":
            try:
                payload = json.loads(self.read_body().decode("utf-8") or "{}")
            except Exception:
                payload = {}
            record = run_push(repo, (payload.get("message") or "").strip() or None)
            # Clear the end-of-session offer either way; a failure shows as a
            # banner with the reason rather than as a standing prompt.
            st = repo.state()
            if st.pop("finished", None) is not None:
                with open(repo.state_path, "w", encoding="utf-8") as fh:
                    json.dump(st, fh, indent=2)
            self.server.hub.worker.dirty.set()
            return self.send_json(record)

        if path == "/dismiss-finish":
            st = repo.state()
            st.pop("finished", None)
            with open(repo.state_path, "w", encoding="utf-8") as fh:
                json.dump(st, fh, indent=2)
            self.server.hub.worker.dirty.set()
            return self.send_json({"ok": True})

        if path == "/switch":
            try:
                payload = json.loads(self.read_body().decode("utf-8"))
            except Exception:
                return self.send_json({"ok": False, "error": "bad json"}, status=400)
            want = payload.get("repo") or ""
            # Only a sibling directory this server already discovered. No paths
            # from the request ever reach the filesystem.
            match = None
            for c in sibling_courses(repo):
                if c["repo"] == want:
                    match = c
                    break
            if not match:
                return self.send_json({"ok": False, "error": "unknown course"}, status=404)
            target = os.path.join(os.path.dirname(repo.root), match["repo"])
            code, out = board_cli(target, ["start"])
            if code != 0:
                return self.send_json({"ok": False, "error": out.strip()[-300:]}, status=500)
            # The assistant follows the course. `agent start` asks whatever was
            # listening elsewhere to write its handoff first, so nothing is lost
            # by walking away from a lesson -- which is how sessions actually
            # end. It detaches, so this request does not wait on a model.
            acode, aout = tutor_cli(["agent", "start", match["repo"]])
            return self.send_json({"ok": True, "repo": match["repo"],
                                   "detail": out.strip(),
                                   "agent": aout.strip() if acode == 0 else None,
                                   "agent_error": None if acode == 0 else aout.strip()[-300:]})

        if path == "/slate/save":
            try:
                payload = json.loads(self.read_body().decode("utf-8"))
            except Exception:
                return self.send_json({"ok": False, "error": "bad json"}, status=400)
            n = int(payload.get("page") or 1)
            if not (1 <= n <= 999):
                return self.send_json({"ok": False, "error": "bad page"}, status=400)
            stem = os.path.join(repo.slate, "page-%02d" % n)

            with open(stem + ".json", "w", encoding="utf-8") as fh:
                json.dump({"page": n, "w": payload.get("w"), "h": payload.get("h"),
                           "strokes": payload.get("strokes") or []}, fh)

            png = payload.get("png") or ""
            marker = "base64,"
            if marker in png:
                import base64
                try:
                    with open(stem + ".png", "wb") as fh:
                        fh.write(base64.b64decode(png.split(marker, 1)[1]))
                except Exception:
                    pass

            if payload.get("send"):
                strokes = payload.get("strokes") or []
                # Revising an answer supersedes it; a new answer starts a turn.
                tid = payload.get("turn") or next_turn_id(repo)
                rev = turn_revision(repo, tid)
                base = "%s-r%d" % (tid, rev)
                # Frozen, because the slate page it came from will be written
                # over. What was handed in has to stay what was handed in.
                try:
                    shutil.copyfile(stem + ".png", os.path.join(repo.answers, base + ".png"))
                except OSError:
                    pass
                with open(os.path.join(repo.answers, base + ".json"), "w",
                          encoding="utf-8") as fh:
                    json.dump({"w": payload.get("w"), "h": payload.get("h"),
                               "strokes": strokes}, fh)
                record = {
                    "id": tid, "rev": rev, "kind": "ink",
                    "answers": payload.get("answers") or newest_question(repo),
                    "t": time.time(),
                    "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "from": "student",
                    "page": n, "strokes": len(strokes),
                    "png": "/answers/" + base + ".png",
                    "ink": "/answers/" + base + ".json",
                    "read": False,
                }
                write_turn(repo, record)
                msg = dict(record)
                msg["text"] = ("[slate] %s rev %d, %d strokes"
                               % (tid, rev, len(strokes)))
                msg["slate"] = os.path.join(repo.answers, base + ".png")
                with open(repo.messages_path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(msg) + "\n")
                self.server.hub.worker.dirty.set()
                return self.send_json({"ok": True, "page": n, "turn": tid, "rev": rev})
            self.server.hub.worker.dirty.set()
            return self.send_json({"ok": True, "page": n})

        if path == "/say":
            try:
                payload = json.loads(self.read_body().decode("utf-8"))
            except Exception:
                return self.send_json({"ok": False, "error": "bad json"}, status=400)
            text = (payload.get("text") or "").strip()
            # A signal carries meaning without a sentence: in a code course the
            # useful things to say are mostly "done", "stuck" and "confused",
            # and making someone type those on a tablet is a tax.
            signal = (payload.get("signal") or "").strip().lower() or None
            if signal not in (None, "done", "help", "confused"):
                return self.send_json({"ok": False, "error": "bad signal"}, status=400)
            if not text and not signal:
                return self.send_json({"ok": False, "error": "empty"}, status=400)

            tid = payload.get("turn") or next_turn_id(repo)
            rev = turn_revision(repo, tid)
            record = {
                "id": tid, "rev": rev, "kind": "text",
                "answers": payload.get("answers") or newest_question(repo),
                "t": time.time(),
                "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
                "from": payload.get("from") or "student",
                "text": text[:8000],
                "signal": signal,
                "read": False,
            }
            write_turn(repo, record)
            with open(repo.messages_path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(dict(record, text=(
                    ("[%s] " % signal if signal else "") + text))) + "\n")
            self.server.hub.worker.dirty.set()
            return self.send_json({"ok": True, "turn": tid, "rev": rev})

        if path == "/upload":
            ctype = self.headers.get("Content-Type", "")
            m = re.search(r"boundary=([^;]+)", ctype)
            if not m:
                return self.send_json({"ok": False, "error": "no boundary"}, status=400)
            boundary = m.group(1).strip('"').encode("utf-8")
            parts = parse_multipart(self.read_body(), boundary)
            saved = []
            stamp = time.strftime("%Y%m%d-%H%M%S")
            for i, part in enumerate(parts):
                if not part["filename"]:
                    continue
                name = "%s-%02d-%s" % (stamp, i, safe_filename(part["filename"]))
                with open(os.path.join(repo.uploads, name), "wb") as fh:
                    fh.write(part["data"])
                saved.append(name)
            if saved:
                record = {
                    "t": time.time(),
                    "iso": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "from": "student",
                    "text": "[uploaded] " + ", ".join(saved),
                    "files": saved,
                    "read": False,
                }
                with open(repo.messages_path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(record) + "\n")
            self.server.hub.worker.dirty.set()
            return self.send_json({"ok": True, "saved": saved})

        return self.send_bytes(b"not found", "text/plain", status=404)

    # -- server sent events ---------------------------------------------
    def sse(self, hub):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        q, cv = hub.subscribe()
        try:
            self.wfile.write(b"retry: 1000\n\n")
            self.wfile.write(("data: " + hub.payload + "\n\n").encode("utf-8"))
            self.wfile.flush()
            while True:
                with cv:
                    if not q:
                        cv.wait(15.0)
                    pending = q[:]
                    del q[:]
                if pending:
                    for payload in pending[-1:]:
                        self.wfile.write(("data: " + payload + "\n\n").encode("utf-8"))
                else:
                    self.wfile.write(b": ping\n\n")
                self.wfile.flush()
        except Exception:
            pass
        finally:
            hub.unsubscribe((q, cv))


def lan_addresses():
    addrs = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        addrs.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return addrs


def main(argv):
    root = os.getcwd()
    port = 8778
    # Loopback by default. There is no authentication of any kind here, so
    # listening on every interface has to be a decision somebody made on purpose.
    # Tailscale reaches the board through 127.0.0.1 either way.
    host = "127.0.0.1"
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--root", "-r"):
            i += 1
            root = argv[i]
        elif a in ("--port", "-p"):
            i += 1
            port = int(argv[i])
        elif a == "--lan":
            host = "0.0.0.0"
        elif a == "--local":
            host = "127.0.0.1"
        i += 1

    repo = Repo(root)
    worker = TikzWorker(repo)
    worker.start()
    hub = Hub(repo, worker)
    hub.payload = json.dumps(hub.build())

    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    httpd.repo = repo
    httpd.hub = hub

    t = threading.Thread(target=hub.poll_loop, daemon=True)
    t.start()

    info = {
        "pid": os.getpid(),
        "port": port,
        "bind": host,
        # The home directory is shared across compute nodes, so a pid on its own
        # says nothing -- the same number is very likely alive on this node and
        # belong to something else entirely.
        "node": socket.gethostname().split(".")[0],
        "root": repo.root,
        # Only advertise what is actually listening.
        "urls": (["http://127.0.0.1:%d/" % port] +
                 (["http://%s:%d/" % (a, port) for a in lan_addresses()]
                  if host == "0.0.0.0" else [])),
        "started": time.time(),
    }
    with open(os.path.join(repo.live, ".board.json"), "w", encoding="utf-8") as fh:
        json.dump(info, fh, indent=2)
    sys.stderr.write("board listening on %s\n" % ", ".join(info["urls"]))
    sys.stderr.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main(sys.argv[1:])
