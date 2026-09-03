"""The HTTP handler: headers, bodies, the event stream, and a table of routes.

What is NOT here is every route. That was nine hundred lines of `if path == ...`
in two methods, and the cost of it was not length -- it was that finding out what
one path did meant reading past all the others, and adding one meant editing the
method everybody else was editing. The families live in `routes/`; this keeps the
plumbing they all use and the order they are asked in.
"""

import sys
import json
import mimetypes
import os
import re
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler

from .. import paths
from ..lesson import cards
from . import routes
from .routes import lesson, machines, pages, saving, taking, writing   # noqa: F401

WEB = paths.WEB

mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("application/manifest+json", ".webmanifest")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "mathboard"

    def log_message(self, fmt, *args):
        pass

    # A request log, deliberately narrow.
    #
    # `board.log` used to hold nothing but "listening", which made two very
    # different failures the same observation: a send that never left the iPad
    # and a send this server rejected both looked like silence. Diagnosing the
    # first one cost a scratch server and a jsdom probe. Now the file says what
    # arrived.
    #
    # The poll and the stream are left out on purpose. /board.json is asked for
    # several times a second and /events never ends, so logging either buries
    # the one line anybody actually wants -- but a failure is logged whatever
    # the path, because a 500 on the poll is worth knowing about.
    QUIET_GET = re.compile(
        r"^/(events|board\.json|courses\.json|health|static/|figure/|"
        r"icon-\d+\.png|apple-touch-icon\.png|manifest\.webmanifest|sw\.js|"
        r"slate/(page-|state)|answers/|uploads/|notes/|favicon)")

    def log_request(self, code="-", size="-"):
        try:
            status = int(code)
        except (TypeError, ValueError):
            status = 0
        path = (self.path or "").split("?", 1)[0]
        if self.command == "GET" and status < 400 and self.QUIET_GET.match(path):
            return
        length = ""
        try:
            n = int((self.headers or {}).get("Content-Length") or 0)
            if n:
                length = " %d bytes in" % n
        except (TypeError, ValueError):
            pass
        self.note("%s %s -> %s%s" % (self.command, path, code, length))

    def note(self, line):
        """One timestamped line into board.log, which is this process's stderr."""
        try:
            sys.stderr.write("[%s] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), line))
            sys.stderr.flush()
        except (OSError, ValueError):
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

    def send_file(self, path, cache=False, untrusted=False, download=None):
        """`download` is a filename, and it means SAVE THIS rather than show it.

        A PDF is in `INLINE_OK`, so a browser handed one renders it in the tab --
        which is the right default for looking at a figure and the wrong one for
        a document somebody asked to keep. On an iPad an inline PDF is a preview
        with no obvious route into Files; an attachment goes straight to the
        share sheet, and from there to iCloud, a phone, or an email to a
        professor. So the caller says which it wants, and the filename is the
        name the file will have on the other side.
        """
        if not os.path.isfile(path):
            self.send_bytes(b"not found", "text/plain", status=404)
            return
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if path.endswith(".svg") and not untrusted:
            ctype = "image/svg+xml"
        extra = None
        if download:
            extra = ("Content-Disposition",
                     'attachment; filename="%s"' % download)
        elif untrusted and ctype not in self.INLINE_OK:
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

        # Installable-app files must sit at the root: the service worker's scope
        # is its own directory, and iOS looks for /apple-touch-icon.png.
        if re.match(r"^/(apple-touch-icon|icon-\d+)\.png$", path):
            return self.send_file(os.path.join(WEB, os.path.basename(path)), cache=True)
        if path in ("/slate", "/slate/"):
            return self.send_file(os.path.join(WEB, "slate.html"))
        if re.match(r"^/slate/page-\d+\.png$", path):
            return self.send_file(os.path.join(repo.slate, os.path.basename(path)))

        for mod in (routes.pages, routes.taking, routes.lesson, routes.writing,
                    routes.machines):
            answered = mod.get(self, repo, path)
            if answered is not routes.NOT_MINE:
                return answered
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

        for mod in (routes.saving, routes.lesson, routes.writing,
                    routes.machines):
            answered = mod.post(self, repo, path)
            if answered is not routes.NOT_MINE:
                return answered
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
