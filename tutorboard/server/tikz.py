"""TikZ to SVG, off the request thread.

A diagram takes seconds to compile and a card has to appear in a tenth of one,
so the card lands with a placeholder and the picture arrives when it is ready.
"""

import hashlib
import json
import os
import queue
import shutil
import subprocess
import tempfile
import threading

from .. import paths, tex


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
        source = os.path.join(work, "fig.tex")
        with open(source, "w", encoding="utf-8") as fh:
            fh.write(TIKZ_DOC % {"width": "0pt", "macros": macros, "body": body})

        env = tex.tex_env([
            os.path.join(self.repo.root, "latex"),
            os.path.join(paths.TOOL, "tex"),
        ])

        proc = subprocess.run(
            ["latex", "-interaction=nonstopmode", "-halt-on-error",
             "-output-directory=" + work, source],
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
