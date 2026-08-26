# AI_INSTRUCTIONS.md — Tutor-Board

This repository is a tool, not a course. It is the live typeset board the coursework repositories
use for tutoring. If you are here to *use* the board, the contract you want is the
`AI_INSTRUCTIONS.md` in the course repository, section "The live board". This file governs work on
the board itself.

Read `README.md` first.

## What this must never become

- A chat client. The conversation lives in the assistant's own session. The board displays
  mathematics and carries the student's answers and scratch work back. Resist every feature that
  starts to look like a message thread with an assistant reply box.
- A dependency pit. Python standard library on the server, no framework in the browser, KaTeX
  vendored. No pip, no npm at run time, no build step. If a change needs a package, it needs a
  better idea instead.
- Something the student has to operate. They open a URL. That is the whole interface. Anything
  that would make them start, restart, or troubleshoot a process is a bug in the design.

## Invariants

- **One process per course repository.** Ports derive from the directory name so two courses can
  hold boards at once.
- **Cards are append-only files.** The assistant writes `live/cards/NNNN-slug.md` and never edits
  a card the student has already read, except to fix a genuine error — the board is a transcript.
- **The macro vocabulary is shared.** `web/macros.js` mirrors each course's
  `latex/coursemacros.sty`. A command that works on the board must work in the `.tex` file, and
  the reverse. When a course adds a macro, add it here too and add a formula using it to
  `test/macros.js`.
- **Math is never touched by the markdown renderer.** `protect()` parks math and code before any
  markdown parsing and `restore()` puts it back as escaped text for KaTeX to walk. Every change to
  the renderer needs a case in `test/markdown.js` proving a subscript or an asterisk inside `$…$`
  still survives.
- **A bad formula must not blank the board.** KaTeX runs with `throwOnError: false`; a broken TikZ
  fence caches an `.err` and renders as a marked box. Nothing in the render path may throw.
- **A lesson is a transcript, and both halves of it are kept.** The student's answers are turns:
  anchored to the card they answer, frozen at the moment they are sent (the slate is a working
  surface and gets written over — never render a live slate page as though it were a submission),
  and versioned, so a correction supersedes the original *in place* rather than appending another
  copy. `live/turns.jsonl` is append-only; every revision stays, only the newest is shown.
  Archiving takes cards, turns and the frozen answers together — a folder of the assistant's cards
  with the student's half missing is a record of half a conversation. `test/transcript.py` guards
  all of it.
- **Two courses, two session boundaries.** Maths ends a session when the chapter does, which is
  what `board open` marks. Code ends it at the commit: `board push` archives and starts the next
  one, because a commit is what "we got this working" means. Do not invent a third.
- **Code mode is not a chat box.** The work happens in the editor on the student's own machine.
  The board carries the three things worth saying about it — ready to check, need help, confused —
  and only opens a keyboard for the two that need a sentence. A free-text box that invites
  conversation is the thing this must never drift into.
- **The slate never loses ink.** Strokes are saved as vectors on an idle timer and again on page
  change and unload. A change that can drop a stroke is a change that must not ship — the student
  is writing a proof, not doodling.
- **The PNG is for reading, not for looking pretty.** It is always dark ink on white with the
  paper rules dropped almost to invisible, whatever the screen is showing, because its only job is
  to be legible to whatever agent opens it.
- **Userspace Tailscale only.** The node has no root and no TUN device, and it must stay that
  way: `--tun=userspace-networking`, binaries and state under `~/.local`. A change that needs
  `sudo` is a change that cannot be deployed here.
- **The service worker caches the shell and nothing live.** SSE, the board payload, uploads,
  slate saves, and figures go to the network every time. A cached lesson is a stale lesson, which
  is worse than a blank screen. Bump `VERSION` in `sw.js` whenever a shell file changes.
- **The identity does not move to the Mac mini; the proxy does.** Between cluster nodes the
  tailnet identity `board` moves, and that works because they share one home directory and one
  ownership record. An always-on Mac shares neither, and runs the system Tailscale as its own node
  besides. So the always-on host keeps `board` permanently and re-points `tailscale serve` at
  whichever machine is actually serving. Do not try to make the identity migrate across that
  boundary; the reasoning and the work list are in the README under "Not yet built".
- **The tailnet address must never depend on the machine.** The node registers as `board`, not
  as the compute host, and its state lives in the shared home so the identity follows the user
  from node to node. The installed iPad app has one origin baked into it; changing that address
  breaks it silently.
- **A pid on a shared filesystem proves nothing.** Every record that crosses `live/` carries the
  node name, and every liveness check compares it before trusting the pid.
- **`hidden` must actually hide.** Both stylesheets carry
  `[hidden] { display: none !important; }`, because a UA stylesheet's `[hidden]` rule loses to any
  author rule that sets a display. Never remove it; `test/hidden.js` guards it.
- **Read the CSS before theorising about the platform.** The drop overlay shipped painted over the
  lesson from the first version, and it was blamed on caching and then on iOS resume semantics
  before anyone checked a two-line rule. When the user says a fix did not land, verify what is
  actually being rendered before proposing a mechanism for why.
- **No text box in math mode, ever.** Answering means writing on the slate. A composer there
  would quietly become the path of least resistance and undo the point of the thing. Code mode is
  the opposite and has one, because a sentence is the right unit for "look at what I just wrote".
  `test/modes.js` holds both halves of that.
- **`tutor` is the entry point; `board` is the assistant's tool.** A person runs `tutor` and gets
  a session. Never add a step that asks them to start the board themselves, or to tell an
  assistant to — that ceremony is the thing the launcher exists to remove.
- **Courses are discovered, never registered.** Any sibling directory with a `tutorboard.json`,
  an `AI_INSTRUCTIONS.md`, or a `live/` folder is a course. Do not add a list, a registry, or a
  config naming them — the filesystem is the source of truth and it cannot go stale.
- **One vocabulary, two renderers.** `tex/board-macros.tex` is generated from `web/macros.js` by
  `tools/sync-macros.py`. Add a macro in one place and regenerate; never hand-edit the TeX file.
  `--check` fails when they drift.
- **Do not assert what a model can or cannot see.** Capabilities differ by vendor, by model
  within a vendor, and by whether the harness attaches the file at all, and all three move. `board
  eyes` settles it by experiment; prefer running it to recalling an answer.
- **Do not promise handwriting recognition.** Ink to text or to LaTeX needs a trained engine. The
  tutor reads the PNG; that is the design, and it is why the slate does not need one.
- **Platform knowledge lives in `boardlib.py`.** Where TeX is, which `tailscale` is in charge.
  Do not hardcode an architecture directory or a socket path anywhere else; the board has to run
  on a Mac and a cluster node without noticing the difference.
- **Nothing model-specific, ever.** The interface is a command line and a directory of files. No
  SDK, no plugin, no assumption about which assistant is driving. `board wait` is the wake-up
  primitive precisely because a blocking process exiting is something every agent understands.
  A model is never a concept in the code: an agent entry is a command recipe, so a different model
  is a different entry whose `cmd` carries the flag. If you find yourself adding a `model` field,
  stop.
- **The assistant belongs to the course, not to the terminal.** One is alive at a time, in the
  repository whose board is showing, resolved most-specific-first: `--agent`, then the course's
  `tutorboard.json`, then the machine by hostname, then `default_agent`. Switching course on the
  hub moves it. Never tie an assistant's lifetime to a terminal session, and never make the student
  start one.
- **No session ends without a handoff.** Sessions end by being abandoned — a switched course, a
  closed lid, an expired allocation — so the departing assistant gets one last turn, with no student
  attached, to write `HANDOFF.md` at the course root. `SIGTERM` starts that wrap-up; nothing may
  kill the daemon outright, and no code path may stop an agent without going through it. An
  assistant's own history does not survive a node, a vendor, or a week. That file is the continuity.

## Where the work is

`README.md` has a "Picking this up in a new session" section: the restart procedure, what is
verified, what is not, and a table of the defects that already happened with the test that guards
each one. Read it before changing anything in `web/`.

Two things follow from that table and are worth stating as rules rather than history:

- **A stub DOM proves almost nothing about a page.** Two separate "the writing surface does not
  work" reports passed every hand-rolled test at the time. Anything touching layout, sizing, or
  pointer input gets a case in `test/interactive.js` or `test/sizing.js`, which use a real DOM.
- **When the user says something does not work on the device, do not theorise.** Read the code
  that draws it and measure. The drop overlay was blamed on caching and then on iOS resume
  semantics before anyone read a two-line CSS rule; the writing surface was blamed on layout
  before anyone checked that a page object existed.

## Before you commit

```
bash test/all.sh
board doctor
```

`test/all.sh` runs every suite and installs jsdom itself the first time, because two of them drive
the pages in a real DOM and those are precisely the ones that caught what the stub DOM waved
through. Do not add a suite that only a person who remembered a setup step will run.

Then actually load the page and look at it. A test suite cannot tell you the type is too small or
a lattice collided with a paragraph.

## Persona and mode

The persona is the same as in the course repositories: aloof, blunt, no emojis, no empty praise.

**The no-code rule does not apply here.** In a course repository the point is that the student
writes the code; withholding it is the teaching. This repository is the *tool*, not the course.
Nobody is learning anything by being told in English which argument to pass — they are trying to
get a board in front of a person who is waiting to be taught on it. Write the code, make the edits,
run the tests, report what happened.

Concretely, in this repository and no other:

- Edit the files directly. Do not narrate an edit the user is then expected to perform.
- Ship the whole change, not the next step of it. The one-step-at-a-time cadence is a teaching
  device and there is nothing being taught here.
- Verification is still yours: `bash test/all.sh` before you claim anything works, and a test for
  any defect a person had to find on a device.
- The override phrase is not needed and should never be asked for.

The teaching rules resume the moment the work is in a course repository — including a course whose
subject happens to be programming. The distinction is what the code is *for*, not what it is
written in.
