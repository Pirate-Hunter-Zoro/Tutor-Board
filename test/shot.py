#!/usr/bin/env python3
"""The lesson as the pixels it was read as, and the document that carries them.

Asked for from the iPad, about the export that already existed: "for the tutor
session export, I don't want the latex dump it currently gives; I want it as if
it were a screenshot of the entire iPad screen scrolled down over the whole
tutoring session."

The pixels are the device's business -- there is no headless browser on a compute
node and there never will be -- so what is checked here is everything on this
side of the wire, and it is the half that can lose an evening:

  - THE PDF HAS TO OPEN. It is written by hand, and a cross-reference offset one
    byte out is a file no reader will touch. So the table is followed rather than
    eyeballed: every offset in it must land exactly on the object it claims.
  - THE BYTES ARE NOT TRUSTED. They came off the network and they are being
    written into somebody's repository. A page that is not a JPEG, a page the
    size of a film, four hundred of them -- each is refused with a reason rather
    than written.
  - THE SERIES IS SHARED. A photograph and a typeset transcript of the same
    lesson are v3 and v4, not two v3s, because "which one is the latest" is the
    only question anybody asks of that folder.
  - AND THE WRITE-UP'S PDF HAS TO BE FINDABLE. Three separate places guessed
    where a course's build puts it and all three guessed wrong, so `hw.json`
    recorded `"pdf": null` on a build that had just succeeded and the download
    button for it could never appear.
"""

import base64
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.dirname(HERE)
sys.path.insert(0, TOOL)

from tutorboard.course import document, homework, screenshot   # noqa: E402

fails = []


def ok(msg):
    print("ok   " + msg)


def bad(msg):
    fails.append(msg)
    print("FAIL " + msg)


# ---------------------------------------------------------------------------
# a JPEG, made here rather than pasted in
# ---------------------------------------------------------------------------
# Hand-assembled from the markers `jpeg_size` actually reads, so the fixture is
# the shape of the thing rather than a blob nobody can check. It is not a
# decodable image and does not need to be: nothing on this side decodes one.
def jpeg(width, height, pad=64):
    def seg(marker, body):
        return bytes([0xFF, marker]) + len(body + b"\0\0").to_bytes(2, "big") + body

    out = b"\xff\xd8"
    # An APP0 first, because a real file has one and the scan has to walk past a
    # segment before it reaches the frame. A reader that only ever looked at
    # byte 2 would pass a test with the frame first and fail on every camera.
    out += seg(0xE0, b"JFIF\0\x01\x02\0\0\x01\0\x01\0\0")
    out += seg(0xC0, bytes([8])
               + height.to_bytes(2, "big") + width.to_bytes(2, "big")
               + bytes([3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]))
    out += seg(0xDA, bytes([1, 1, 0]))
    out += b"\x00" * pad
    out += b"\xff\xd9"
    return out


# ---------------------------------------------------------------------------
# the PDF, followed rather than eyeballed
# ---------------------------------------------------------------------------
def check_pdf(path, pages, want_w, want_h):
    with open(path, "rb") as fh:
        raw = fh.read()

    if not raw.startswith(b"%PDF-"):
        bad("the file does not begin with a PDF header")
        return
    ok("it is a PDF from its first byte")

    m = re.search(rb"startxref\s+(\d+)\s+%%EOF", raw)
    if not m:
        bad("there is no startxref, so no reader can find anything in it")
        return
    start = int(m.group(1))
    if raw[start:start + 4] != b"xref":
        bad("startxref points at %r rather than the table" % raw[start:start + 12])
        return
    ok("and its startxref lands on the cross-reference table")

    # EVERY offset, against the object it claims. This is the check that catches
    # a hand-written PDF: the arithmetic is right for the first object and wrong
    # by the length of one dictionary for the rest.
    table = raw[start:]
    head = re.match(rb"xref\s+0\s+(\d+)\s+", table)
    if not head:
        bad("the table has no subsection header")
        return
    count = int(head.group(1))
    entries = re.findall(rb"(\d{10}) (\d{5}) ([nf])", table)
    if len(entries) != count:
        bad("the table promises %d entries and carries %d" % (count, len(entries)))
        return
    wrong = []
    for i, (off, _gen, kind) in enumerate(entries):
        if kind == b"f":
            continue
        at = int(off)
        want = b"%d 0 obj" % i
        if raw[at:at + len(want)] != want:
            wrong.append((i, at, raw[at:at + 16]))
    if wrong:
        bad("%d offsets do not land on their object, e.g. object %d at %d is %r"
            % (len(wrong), wrong[0][0], wrong[0][1], wrong[0][2]))
    else:
        ok("and every offset in it lands exactly on the object it names (%d)"
           % (count - 1))

    if re.search(rb"/Type\s*/Pages[^>]*/Count\s+%d\b" % pages, raw):
        ok("the page tree says %d pages" % pages)
    else:
        bad("the page tree does not say %d pages" % pages)

    boxes = re.findall(rb"/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]", raw)
    if len(boxes) == pages and all(
            abs(float(w) - want_w) < 0.01 and abs(float(h) - want_h) < 0.01
            for w, h in boxes):
        ok("and every page is the paper that was asked for (%.2f x %.2f)"
           % (want_w, want_h))
    else:
        bad("the pages are %r rather than %d of %.2f x %.2f"
            % (boxes, pages, want_w, want_h))

    # A JPEG goes in verbatim, which is the whole reason there is no encoder
    # here. If that ever stops being true the filter is the thing that changed.
    if raw.count(b"/DCTDecode") == pages:
        ok("each page's picture is the JPEG itself, unre-encoded")
    else:
        bad("there are %d DCTDecode images for %d pages"
            % (raw.count(b"/DCTDecode"), pages))


def main():
    # --- the header reader --------------------------------------------------
    if screenshot.jpeg_size(jpeg(1472, 2082)) == (1472, 2082):
        ok("a JPEG's own header is what says how big it is")
    else:
        bad("the frame header was read as %r" % (screenshot.jpeg_size(jpeg(1472, 2082)),))

    for name, blob in (("a PNG", b"\x89PNG\r\n\x1a\n" + b"\0" * 40),
                       ("empty", b""),
                       ("a JPEG with no frame in it", b"\xff\xd8\xff\xd9"),
                       ("text", b"not a picture at all")):
        if screenshot.jpeg_size(blob) is None:
            ok("and %s is not one" % name)
        else:
            bad("%s was accepted as a JPEG" % name)

    # --- the document -------------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "shot.pdf")
        screenshot.write_pdf(path, [jpeg(1472, 2082), jpeg(1472, 2082),
                                    jpeg(1472, 2082)],
                             595.28, 841.89, title="Ch 03 (Rings)",
                             author="A Student")
        check_pdf(path, 3, 595.28, 841.89)

        # A title with a bracket in it. PDF strings are delimited by parentheses
        # and a course called "Ch 03 (Rings)" is an ordinary thing to be called;
        # unescaped, it ends the string early and the trailer stops parsing.
        with open(path, "rb") as fh:
            raw = fh.read()
        if br"(Ch 03 \(Rings\))" in raw:
            ok("and a bracket in the course's name is escaped, not left to "
               "terminate the string")
        else:
            bad("the title was written as %r"
                % re.search(rb"/Title \(.*?\)", raw))

    # --- what is refused ----------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        root = os.path.join(tmp, "Galois-Theory")
        os.makedirs(os.path.join(root, "live"))
        with open(os.path.join(root, "live", "state.json"), "w", encoding="utf-8") as fh:
            json.dump({"course": "Galois Theory", "chapter": "ch-03-rings"}, fh)
        subprocess.run(["git", "init", "-q"], cwd=root,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        for why, pages in (("nothing at all", []),
                           ("a page that is not a JPEG", [b"<html>hello</html>"]),
                           ("more pages than a lesson has",
                            [jpeg(10, 10)] * (screenshot.MAX_PAGES + 1)),
                           ("a page too large to be one",
                            [jpeg(10, 10, pad=screenshot.MAX_PAGE_BYTES + 8)])):
            rec = screenshot.build(root, pages)
            if not rec.get("ok") and rec.get("detail"):
                ok("%s is refused, with a reason (%s)" % (why, rec["detail"]))
            else:
                bad("%s was written into the repository" % why)

        out_dir = os.path.join(root, document.OUT_DIR)

        # --- and what is accepted ------------------------------------------
        rec = screenshot.build(root, [jpeg(1472, 2082), jpeg(1472, 2082)])
        if rec.get("ok") and rec.get("pages") == 2:
            ok("two pages of a lesson become a document (%s)" % rec.get("pdf"))
        else:
            bad("the photograph was refused: %r" % (rec,))

        if rec.get("pdf") and os.path.isfile(os.path.join(root, rec["pdf"])):
            ok("and it is on disk where the record says it is")
        else:
            bad("the record points at %r, which is not there" % (rec.get("pdf"),))

        if rec.get("pdf", "").startswith(document.OUT_DIR + os.sep):
            ok("in the same folder the typeset export uses")
        else:
            bad("it went to %r rather than %s/" % (rec.get("pdf"), document.OUT_DIR))

        # Staged, not committed: an export happens in the middle of a lesson and
        # a commit in the middle of a lesson is a decision a person makes.
        p = subprocess.run(["git", "diff", "--cached", "--name-only"], cwd=root,
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if rec.get("pdf") in p.stdout.decode("utf-8", "replace").split():
            ok("and it is staged for the next save, not committed behind anybody")
        else:
            bad("the document was not staged, so a push would leave it behind")

        # ONE SERIES, both exports. Photograph, then typeset, then photograph:
        # v1, v2, v3 of the same lesson. Two independent counters would produce
        # two v1s and no way to tell which of them is the latest -- which is the
        # entire question the numbering exists to answer.
        first = rec.get("name")
        with open(os.path.join(out_dir, first.replace("-v1", "-v2") + ".tex"),
                  "w", encoding="utf-8") as fh:
            fh.write("%% a typeset export that got as far as its source\n")
        again = screenshot.build(root, [jpeg(1472, 2082)])
        if again.get("name", "").endswith("-v3"):
            ok("the photograph and the typeset transcript share one series (%s "
               "after %s)" % (again.get("name"), first))
        else:
            bad("%r followed %r and a .tex at v2, so the series forked"
                % (again.get("name"), first))

    # --- the transport ------------------------------------------------------
    good = base64.b64encode(jpeg(8, 8)).decode("ascii")
    pages, why = screenshot.decode({"pages": [good]})
    if pages and screenshot.jpeg_size(pages[0]) == (8, 8) and not why:
        ok("a page arrives as base64 and comes out as the bytes it was")
    else:
        bad("decoding a page gave %r / %r" % (pages, why))

    # The one way base64 most often arrives wrong, and it costs nothing to fix.
    pages, why = screenshot.decode({"pages": [good.rstrip("=")]})
    if pages and screenshot.jpeg_size(pages[0]) == (8, 8):
        ok("and stripped padding is repaired rather than refused")
    else:
        bad("a page with its padding stripped was rejected: %r" % (why,))

    # A canvas hands back `data:image/jpeg;base64,...` and it is easy to send
    # the lot; the prefix is not part of the picture.
    pages, why = screenshot.decode({"pages": ["data:image/jpeg;base64," + good]})
    if pages and screenshot.jpeg_size(pages[0]) == (8, 8):
        ok("and a whole data URI is understood as the picture in it")
    else:
        bad("a data URI was rejected: %r" % (why,))

    for why_text, payload in (("no pages", {}),
                              ("an empty list", {"pages": []}),
                              ("a number", {"pages": [17]}),
                              ("not a list", {"pages": "abcd"})):
        pages, why = screenshot.decode(payload)
        if pages is None and why:
            ok("%s is refused with a reason (%s)" % (why_text, why))
        else:
            bad("%s was accepted" % why_text)

    # --- the paper ----------------------------------------------------------
    if screenshot.page_box({}) == screenshot.A4:
        ok("a request that says nothing about paper gets A4")
    else:
        bad("the default paper is %r" % (screenshot.page_box({}),))

    for why_text, box in (("zero", {"w": 0, "h": 0}),
                          ("a mile", {"w": 99999, "h": 99999}),
                          ("nonsense", {"w": "wide", "h": None})):
        if screenshot.page_box({"page": box}) == screenshot.A4:
            ok("and %s falls back to A4 rather than to a file nothing opens"
               % why_text)
        else:
            bad("%s produced %r" % (why_text, screenshot.page_box({"page": box})))

    if screenshot.page_box({"page": {"w": 612, "h": 792}}) == (612, 792):
        ok("but US Letter, which is a real request, is honoured")
    else:
        bad("Letter was not honoured")

    # --- where a build actually puts the write-up ---------------------------
    #
    # The layout that broke it, exactly as Galois-Theory has it: the source in
    # `chapters/ch03-rings/homework/`, the PDF one level up in
    # `chapters/ch03-rings/build/`, because `scripts/build.sh` walks to the
    # nearest unit directory and compiles there. Every previous guess looked in
    # `homework/build/`, which does not exist.
    with tempfile.TemporaryDirectory() as tmp:
        root = os.path.join(tmp, "Galois-Theory")
        hw_dir = os.path.join(root, "chapters", "ch03-rings", "homework")
        build_dir = os.path.join(root, "chapters", "ch03-rings", "build")
        os.makedirs(hw_dir)
        os.makedirs(build_dir)
        tex_path = os.path.join(hw_dir, "ch03-homework.tex")
        open(tex_path, "w", encoding="utf-8").write("\\documentclass{article}\n")
        # The reading for the same chapter, in the same folder, compiled first.
        open(os.path.join(build_dir, "ch03-notes.pdf"), "wb").write(b"%PDF-1.4\n")

        if homework.compiled_pdf(root, tex_path) is None:
            ok("a write-up that has not been compiled has no PDF")
        else:
            bad("something was offered as the write-up before it was built: %r"
                % homework.compiled_pdf(root, tex_path))

        want = os.path.join(build_dir, "ch03-homework.pdf")
        open(want, "wb").write(b"%PDF-1.4\n")
        got = homework.compiled_pdf(root, tex_path)
        if got and os.path.samefile(got, want):
            ok("and once it is built it is found in the chapter's build/, which "
               "is where the build put it")
        else:
            bad("the write-up's PDF was not found (%r); this is the defect that "
                "recorded pdf: null on a build that had just succeeded" % (got,))

        # The chapter's reading is not the write-up. A glob returning whichever
        # PDF came first hands somebody the notes for an evening they spent
        # writing up exercises.
        os.remove(want)
        got = homework.compiled_pdf(root, tex_path)
        if got is None:
            ok("and the chapter's reading is never mistaken for the write-up")
        else:
            bad("with no write-up compiled it offered %r" % (got,))

        # The other layout in the wild: the source and the PDF side by side.
        flat = os.path.join(root, "homework", "hw04")
        os.makedirs(flat)
        flat_tex = os.path.join(flat, "hw04.tex")
        open(flat_tex, "w", encoding="utf-8").write("\\documentclass{article}\n")
        open(os.path.join(flat, "hw04.pdf"), "wb").write(b"%PDF-1.4\n")
        got = homework.compiled_pdf(root, flat_tex)
        if got and os.path.basename(got) == "hw04.pdf":
            ok("and a course that compiles beside the source is found too")
        else:
            bad("the flat layout's PDF was not found: %r" % (got,))

    print()
    if fails:
        print("%d FAILURES" % len(fails))
        return 1
    print("the lesson photographs into a document that opens")
    return 0


if __name__ == "__main__":
    sys.exit(main())
