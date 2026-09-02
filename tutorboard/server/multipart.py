"""Reading an upload, without a library.
"""

import posixpath
import re


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
