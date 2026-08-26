# Tutor-Board

A live board for tutoring sessions — mathematics or code.

The assistant writes a lesson card into a file. A local server sees the file appear and pushes it
to every browser that has the board open — laptop, iPad, phone — where it renders as typeset
mathematics in about a tenth of a second. Nothing is refreshed by hand and nothing is compiled by
the reader. Handwriting, typed answers, and photos travel back the other way, into an inbox the
assistant reads.

It exists because reading mathematics as `\QQ(\sqrt[3]{2})` in a terminal is miserable, and
because a PDF that has to be rebuilt and re-scrolled after every sentence is not a conversation.
The same turned out to be true of being walked through code on a tablet, so a repository declares
which kind of subject it is and the board adapts.

**Contents** — [What it is not](#what-it-is-not) · [The three surfaces](#the-three-surfaces) ·
[Commands](#commands) · [Writing a card](#writing-a-card) · [The slate](#the-slate--writing-by-hand)
· [Getting work back](#getting-work-back) · [Any agent](#any-agent-not-just-one) ·
[Layout](#layout) · [Setup, start to finish](#setup-start-to-finish) ·
[Networking](#networking-reaching-it-from-anywhere) · [The iPad app](#the-ipad-app) ·
[What is verified](#what-is-verified-and-what-is-not)

---

## What it is not

Not a chat client. The conversation still happens wherever the assistant is running — a terminal,
an editor, an SSH session. The board is the *display* for the mathematics, plus a back channel for
the student's answers and working. One process per course repository.

## The three surfaces

Four pages, and it is worth being clear about which is which, because they were built in that
order and the earlier ones did not know the later ones were coming.

| Surface | Who writes there | What for |
|---|---|---|
| **Home** (`/`) | — | what you are in the middle of, every course found beside it, and the way in |
| **The board** (`/board`) | the assistant | the lesson: prose, typeset mathematics, tables, compiled diagrams |
| **The slate** (`/slate`) | the student, with a Pencil | working, proofs, anything handwritten — **this is the main way to answer** |
| **The drop zone** | the student | a file that was not written on the slate |
| **The text box** | the student | *code courses only* — a sentence back to the assistant |

**There is no text box.** Answering means writing, and writing happens on the slate: a question
card puts a *Write your answer* button on the board, which opens the slate with that question
pinned at the top, and **review** sends the page. Nothing has to be typed anywhere, in the app or
in a terminal.

The drop zone predates the slate: before there was anywhere to write, the only way to get
handwriting to the assistant was to photograph it and drop the photo on the page. It survives
because it still covers the cases the slate cannot:

- paper you worked on away from the iPad, photographed
- a problem sheet, a scan, a page from a book
- a screenshot of something on another machine
- pages written in Notability or GoodNotes and exported as PDF

For ordinary "here is my answer", use the slate. The `＋` in the title bar is the same upload path
and is the practical one on iOS, where dragging a file onto a web page is awkward.

## Setting up a second machine

The natural arrangement is an always-on host for the daemon and whatever other machines you
happen to work on. One script does the whole setup:

```
git clone https://github.com/<you>/Tutor-Board ~/Tutor-Board
cd ~/Tutor-Board && bash bootstrap.sh --name mac-mini
```

It installs `tutor` and `board`, clones the course repositories, turns on the commit-attribution
hook in each clone, names this machine on the tailnet, and prints what is left to do. No `sudo`,
nothing system-wide.

The list of repositories is **not** in this repository, which is public. It lives at
`~/.config/tutor-board/courses.txt`, one entry per line:

```
https://github.com/you/Galois-Theory.git
https://github.com/you/odd-remote-name.git   Nice-Directory-Name
```

The second field is only needed when the directory you want differs from the repository name. To
produce the list on a machine that already has everything:

```
for d in ~/*/; do git -C "$d" remote get-url origin 2>/dev/null; done
```

### Two machines at once

The tailnet identity is one machine that moves, which is what keeps the address stable across
compute nodes on a shared home. Two hosts cannot both answer to `board`, so give the second its
own name — `bootstrap.sh --name`, or `board vpn up --hostname mac-mini` later. Each gets its own
`*.ts.net` address; install the board on the iPad from each, and you have two icons with no
ambiguity about which machine you are talking to.

### Surviving a reboot

An always-on machine is always on until it isn't.

```
bash scripts/install-autostart.sh Galois-Theory opencode
bash scripts/install-autostart.sh --uninstall
```

On macOS that writes a LaunchAgent with `RunAtLoad` and `KeepAlive`, so the daemon starts at login
and is restarted if it dies; logs go to `~/Library/Logs/tutor-headless.log`. On Linux with
systemd it writes a `--user` unit with `Restart=always` (add `loginctl enable-linger $USER` to
survive logout). Both run as you, which is necessary — the daemon needs your tailnet, your git
credentials, and your agent's own auth.

Neither survives a machine that is off. Nothing does. `tutor where` and the dot on the board are
how you find out, and the board keeps working from any other machine in the meantime.

## Starting a session

```
tutor
```

That is the whole entry point. It lists the courses it finds, you pick one, and it brings that
course's board up, opens a session, and launches your assistant already pointed at the repository's
contract — with the board running before the assistant exists.

```
tutor galois                 match a course by name
tutor galois --homework      and open a homework sitting
tutor trd --agent opencode   with a particular assistant
tutor galois --no-agent      just bring the board up
tutor --list                 what courses exist
tutor --agents               what assistants are configured
```

It replaces: remember which directory, `cd` there, start an agent, then tell the agent to start the
board. That last step is ceremony nobody should have to perform, and forgetting it produces a
session where the assistant talks into a terminal no one is reading.

### Headless — no terminal at all

```
tutor headless galois --agent opencode
tutor headless --stop
```

The assistant runs as a daemon. `board wait` blocks until you send something from the board, hands
it over, the assistant writes a card, and it goes back to waiting. You are on the sofa with an
iPad; nobody is at a keyboard at any point.

Each agent needs a `headless` recipe in the config — a command that takes a prompt, does the work,
and exits:

```json
"opencode": { "headless": ["opencode", "run", "--continue", "{prompt}"] },
"claude":   { "headless": ["claude", "-p", "{prompt}", "--continue"] }
```

`{prompt}` is substituted. Continuity across turns is the agent's own business; the flag that
resumes its session belongs in the recipe. Output goes to `live/agent.log`.

**This needs a machine that stays on.** On a cluster node your processes live and die with your
allocation, so the daemon dies when the job ends — headless there is only useful for as long as
you hold the node. An always-on machine is the right home for it: a Mac mini already on your
tailnet, with its own clones of the course repositories, kept in step by pushing.

### Knowing what is actually up

A daemon you cannot see is worse than no daemon, so nothing has to be assumed:

```
tutor where
```

```
this machine: mac-mini

  Galois Theory            board:up :8787   agent:opencode listening
  Probability              board:-          agent:-
  TRD-EHR                  board:on compute301  agent:-

  reachable at https://board.<tailnet>.ts.net/
```

On the board itself, a dot beside the course name says whether an assistant is attached: green and
*listening*, amber and pulsing while it is *working*, red when the heartbeat has gone stale. The
heartbeat expires after two minutes, so a daemon that crashed stops claiming to be there.

Liveness is checked against the process, not just the pid — a record on a shared filesystem may
have been written by another machine, and a pid on its own can be a stranger's.

### Two machines, and which one owns the address

The tailnet identity is one machine that moves, so `board.<tailnet>.ts.net` points at whichever
host currently holds it, and `board vpn up` refuses to start a second daemon against the same
state. That is the right behaviour for one machine at a time.

If you want an always-on host *and* an occasional cluster node live together, give them separate
identities — a different `--hostname` and a different `TS_DIR` on the second — and install the
board on the iPad from each address. Two apps, two icons, no ambiguity about which is which.

### Which assistant runs is configuration

`~/.config/tutor-board/config.json`, written on first run:

```json
{
  "courses_dir": "~",
  "default_agent": "claude",
  "agents": {
    "claude":   { "cmd": ["claude"],   "prompt": "argv" },
    "opencode": { "cmd": ["opencode"], "prompt": "argv" },
    "aider":    { "cmd": ["aider"],    "prompt": "none" }
  }
}
```

`cmd` is whatever launches it. `prompt: "argv"` appends the opening brief as a final argument;
`prompt: "none"` launches it bare and prints the one line to paste. Add an entry for anything that
runs in a terminal — nothing in the launcher knows which assistant it is starting.

The brief itself is written to `live/BRIEF.md` every time, so an assistant that takes no argument
can still be told to read it. It names the course, the mode, the session kind, and the board's
addresses, and says plainly that the board is already running.

### Why there is no registry

Courses are whatever directories are sitting beside the tool. Adding one means making a directory;
there is no list to update and nothing that can go stale. `courses_dir` moves the search if your
repositories live somewhere else.

## Courses, and the two modes

Nothing is registered and nothing is configured centrally. **Any directory beside this one is a
course** if it holds a `tutorboard.json`, an `AI_INSTRUCTIONS.md`, or a `live/` folder. The hub
lists what it finds each time you open it; adding a course means making a directory.

A course says what it is in `tutorboard.json` at its root:

```json
{
  "name": "Galois Theory",
  "mode": "math"
}
```

| | `"mode": "math"` | `"mode": "code"` |
|---|---|---|
| Answering | write on the slate, tap **review** | type in the box on the board |
| Text box | **none** | yes, and the slate is one tap away for sketching |
| Suits | proofs, derivations, anything worked by hand | being walked through code, reviewing what you wrote, "do it yourself" |

The distinction is not decoration. In a mathematics course a text box is the path of least
resistance and quietly destroys the point — you end up typing `sqrt(2)` instead of working the
problem. In a code course the useful things to say *are* sentences: *look at what I just wrote*,
*this test fails*, *stop explaining and write it*. So the box exists there and not here.

`board init` writes the file:

```
board init                      # guess from what is in the repository
board init "TRD-EHR" --code     # or just say
board init "Galois Theory" --math
```

Without a config the mode is guessed — LaTeX anywhere in the repository means mathematics,
otherwise code — and the name comes from the directory. The guess is only ever about *how* the
board behaves, never about whether it works, and one command overrides it.

## Running it on another machine

Nothing here is tied to a Linux cluster. The server is standard-library Python, the pages are
plain browser JavaScript, and the two things that genuinely differ between machines — where TeX
keeps its binaries and which `tailscale` is in charge — are isolated in `boardlib.py`.

- **TeX** is found by globbing rather than guessing an architecture: `~/.TinyTeX/bin/*`,
  `~/Library/TinyTeX/bin/*` (where TinyTeX lands on macOS), `/Library/TeX/texbin` for MacTeX, and
  `/usr/local/texlive/*/bin/*`.
- **Tailscale** comes in two shapes. On a machine with no administrator rights the board runs its
  own `tailscaled` in userspace mode. On a machine where Tailscale is already installed and
  running — a Mac, most obviously — there is nothing to start, and `board vpn` says so and gets
  out of the way instead of fighting the daemon that already works.
- **Slurm** is used for one thing, deciding whether a stale lock belongs to a job that has ended.
  Where `squeue` does not exist that check is simply skipped.

`board doctor` reports the platform it thinks it is on. `install.sh` prints the right instructions
for it, including that Tailscale on macOS is an application rather than a static binary.

### Driving it with a different assistant

The interface is a command line and a directory of files, so anything that can run a shell command
can drive it — OpenCode, Codex, Cursor, a local model behind a terminal wrapper. See
[Any agent, not just one](#any-agent-not-just-one).

The one thing to check before committing to a setup is **whether the assistant can look at an
image**. In a `code` course it does not matter: the instruction goes on the board, the answers come
back through the text box, and nothing needs to be seen. In a `math` course the whole return path
is the slate, and something that cannot read a page of handwriting is no use.

That question has two halves, and both have to be yes:

- **the model** — whether it accepts images at all, which varies by vendor *and* by which model
  of theirs you point at it; a vendor's flagship chat model being text-only says nothing about
  their vision line;
- **the harness** — whether the tool driving it actually attaches the file. Something
  vision-capable behind a reader that only ever sends text is still blind here.

Both move, and neither is worth taking on trust. Settle it by experiment:

```
board eyes
```

renders an image holding a random token, a random word, and a small definite integral, and prints
the path. Ask your assistant to open it and report all three. Then `board eyes --answer` shows
what was actually in it, so an invented answer is obvious.

If it cannot read them, that repository belongs in `code` mode, where nothing needs to be seen.

## The reading face

The default is **OpenDyslexic** — heavier at the bottom of each letter, with the shapes pulled
apart so `b`/`d` and `p`/`q` stop trading places. The **Aa** button cycles it:

1. **OpenDyslexic** — the default
2. **Atkinson Hyperlegible** — the Braille Institute's face, same goal of making similar letters
   unmistakable, calmer to look at
3. **Serif** — an ordinary book face

The choice is remembered and follows you from the hub to the lesson to the slate. Both faces are
vendored under `web/fonts/` with their OFL licences, so nothing is fetched from a CDN and the
installed app caches them like everything else.

**Mathematics is deliberately excluded**, and this is not an oversight. KaTeX's glyphs, metrics
and spacing are one system; substituting a text face into it does not produce a dyslexia-friendly
formula, it produces a broken one. Code is excluded for the same reason — alignment is the point.
`test/typeface.js` fails if a selector ever gets broad enough to swallow either, which is a
one-character mistake away at all times.

Leading and tracking move with the face, because OpenDyslexic's weighted baseline needs more room
between rows than a book serif does.

## Sessions, and finishing one

A session is opened with a kind, and in a mathematics course the kind matters:

```
board open "Galois Theory" "Ch 7 — Splitting fields" --lecture
board open "Galois Theory" "Problem set 4"           --homework
```

**Lecture** is teaching: one concept, one question, then wait. **Homework** is producing work that
has to end up typeset and compiled — the user writes each solution by hand, the assistant reviews
it, and once it is agreed correct the assistant transcribes it into the `.tex` and compiles the
finished assignment. The write-up is clerical once the mathematics is settled; making someone
retype their own proof teaches nothing.

The kind shows as a badge on the board, so there is never a question about which sitting this is.

### Saving and pushing

```
board finish
```

raises a prompt **on the board** — not in a terminal, because the person answering is holding an
iPad — asking whether to save and push. Tapping **Push** runs the repository's
`scripts/save-and-push.sh`, and the outcome appears on the board either way: a green line naming
the branch, or a red one carrying the actual error text. A failed push is never silent, and the
hub shows the last result too.

`board push "message"` does it from the terminal without asking.

The script is deliberately ordinary — `git add -A`, commit, push — and lives in each repository so
it works with or without this tool:

- The commit is authored by whoever `git config user.name` says, with **no trailers, no
  co-authors, and no attribution to any assistant**. The work belongs to the person who did it and
  the history should say only that.
- `GIT_TERMINAL_PROMPT=0`, so a missing credential fails in seconds with a readable message
  instead of hanging on a prompt nobody can see.
- Nothing to commit is a success, not an error; unpushed commits still get pushed.
- No `origin` means it commits locally and says so.

## Setting up a course repository

The minimum is nothing at all: make a directory next to this one and run `board start` inside it.
Everything below is optional, and each item buys something specific.

1. **`tutorboard.json`** — declare the name and the mode rather than being guessed at.
   One command: `board init "Real Analysis" --math`.

2. **`latex/coursemacros.sty`** *(maths)* — your own macros. They are loaded ahead of the board's
   own vocabulary in every compiled diagram and in every exported lesson, so notation you already
   use in your `.tex` files works unchanged on the board. Without it you still get the shared set
   in `web/macros.js` — `\QQ`, `\degree{L}{K}`, `\Gal`, `\PP`, `\EE` and the rest.

3. **`scripts/build.sh`** *(optional)* — if it exists, `board export --build` uses it instead of
   the built-in compile, so an exported lesson comes out through the same pipeline as the rest of
   your documents. It is called with one argument, the path to a `.tex` file.

4. **`AI_INSTRUCTIONS.md`** — how the assistant should teach *this* subject. The board is a
   display; this is the contract. It is also what marks a directory as a course if you have no
   `tutorboard.json` yet.

5. **`live/` in `.gitignore`** — the board's working directory. Cards, ink, uploads and compiled
   figures all live there and none of it belongs in history. Exports and archives are underneath
   it, so pull anything worth keeping out into the repository proper.

6. **`scripts/save-and-push.sh`** — the end-of-session push. Copy it from any repository here;
   it is self-contained and takes an optional commit message.

7. **Somewhere for finished work** — a `handwritten/` folder, a `notes/` directory, whatever fits.
   The board hands the assistant a path to each slate page; where it should be filed afterwards is
   the repository's business, and `AI_INSTRUCTIONS.md` is where you say so.

## Commands

The assistant runs these. The student never does.

```
board start                      # bring the board up
board net                        # every address it answers on, tailnet included
board init "Course" --math       # declare what this repository is
board finish                     # offer the push, on the iPad
board push "message"             # or just do it
board eyes                       # can the assistant driving this see images?
board open "Galois Theory" "Ch 7 — Splitting fields"
board next lesson splitting-fields   # -> live/cards/0001-splitting-fields.md
board inbox                      # what the student sent back, with file paths
board slate                      # just the pages written on the iPad
board wait --timeout 300         # block until the student sends something
board export --build             # the whole lesson as a typeset PDF
board vpn up|status|serve|down   # the Tailscale link
board doctor                     # is this machine equipped
board stop
```

## Writing a card

The assistant writes card files; that is the entire authoring interface. A card is markdown with
a small front matter block:

```markdown
---
kind: question
title: Which subfield is fixed?
---

Take $L = \QQ(\sqrt[3]{2}, \omega)$ and the subgroup $H = \gen{\sigma}$ of order 3.

Which of the three intermediate fields is $\Fix(H)$, and why can it not be
$\QQ(\sqrt[3]{2})$?
```

`kind` is one of `lesson`, `question`, `correct`, `wrong`, `review`, `note`, `recap`. It only
changes the label and the accent colour; `question` is the one that says *your move*.

Mathematics is written in ordinary LaTeX, `$…$` and `$$…$$`, using the same macro vocabulary as
the course repository's `latex/coursemacros.sty` — `\QQ`, `\degree{L}{K}`, `\GalG{L}{K}`,
`\Fix`, `\minpoly{\alpha}{K}`, and the rest. See `web/macros.js` for the full list.

### Diagrams

KaTeX cannot draw a subgroup lattice. Anything in a `tikz`, `tikzcd`, or `latex` fence is compiled
by real LaTeX to an SVG, cached by content hash, and dropped into the page:

````markdown
```tikzcd
& L \arrow[dl, dash, "2"'] \arrow[dr, dash, "3"] & \\
\QQ(\sqrt[3]{2}) \arrow[dr, dash, "3"'] & & \QQ(\omega) \arrow[dl, dash, "2"] \\
& \QQ &
```
````

The first render of a new diagram takes a second or two and shows a placeholder; every render
after that is instant. Blank lines inside a fence are stripped, because a blank line inside a
`tikzcd` is a paragraph break and TeX will not have it.

## The slate — writing by hand

The writing surface is **part of the lesson**, not a panel over it. A question puts an answer
block into the card flow directly beneath itself, always the same generous size, and the drawing
tools appear in the page's own chrome bar beside the type-size and theme buttons — they belong to
the app rather than floating on top of it. Nothing to drag, nothing to discover, nothing covered. `/slate` is the same component full-screen, for a derivation that wants the whole page.

Every control is named — Pen, Marker, Erase, Select — because an icon alone was not legible, and a
control you cannot identify is worse than no control. Labels drop on narrow screens in the order
that costs least: nib sizes first, the four tools last.

Strokes are captured as pointer events with pressure. Once a pen has been seen, finger touches
stop drawing, which is the whole of palm rejection.

**Paper is dark by default** — chalk on slate, unruled. The `paper` button cycles black, white and
cream; `plain` cycles unruled, grid and lines. The ink palette follows the paper, so the default
colour is always one you can see, and the last swatch is a colour picker for anything you like.

Ink smoothness is deliberate work, not a default. Raw pointer samples are jittery and unevenly
spaced, and drawing them directly is what produces a granular, faceted line. Instead each sample
is blended into the last, a Catmull-Rom curve is run through the result, that curve is resampled
to about a pixel of spacing, and the width varies smoothly along it. Committed strokes are cached
to an offscreen canvas so only the live stroke is redrawn per frame — latency is most of what
"smooth" actually means.

Each page is saved twice: `live/slate/page-NN.json` holds the strokes as vectors, so the page
survives a reload and reopens on any device; `live/slate/page-NN.png` is what the assistant opens
and reads. The PNG is exactly what you see, paper colour included — inverting it would wreck a
colour you chose on purpose. Autosave runs about a second after the
pen lifts. **Send** — always visible, outside the scrolling tool strip, because a Send button you have to
scroll sideways to find is a Send button that does not exist — puts the page in the inbox and
tells the assistant to look at it. The **live**
toggle does that automatically whenever writing pauses, at most once every fifteen seconds — that
is the mode for being watched while you work.

### What the slate can do

Strokes are stored as vectors rather than pixels, which is what makes the editing possible.

- **Tools** — pen, highlighter (translucent, multiply-blended, always painted under the ink),
  stroke eraser, and lasso.
- **Lasso and clipboard** — draw a loop around anything to select it, then drag it to move,
  cut, copy, paste, duplicate, recolour, or delete. A stroke has to be more than 60% inside the
  loop to be caught, so clipping the edge of a neighbouring symbol does not drag it along.
  Choosing an ink while something is selected recolours it. ⌘/Ctrl with Z, X, C, V, D work, and
  so does Delete.
- **Six inks, three nibs**, pressure-sensitive width.
- **Zoom and pan** — pinch to zoom, one finger to pan, trackpad pinch on a laptop. The pen always
  writes; a finger never draws once a pen has been seen, which is the whole of palm rejection.
  Zoom is clamped and the page cannot be lost off-screen.
- **Pages**, and a **↕** button to make the current page taller when a proof runs long.
- Grid, ruled, or blank paper. Undo is 60 deep and covers selection edits, not just strokes.

### What it deliberately cannot do

It does not recognise handwriting. Turning ink into text, or into LaTeX, needs a trained
recogniser — the apps that do this well license an engine built for the purpose, and it is not
something a canvas and a few hundred lines of JavaScript will approximate.

That is a smaller loss here than it sounds, because **the recogniser is the tutor**. Nebo has to
convert your ink into something a computer can act on; this only has to get your ink in front of
someone who reads mathematics. The PNG goes straight to them. Write the way you would on paper.

## Getting work back

Everything the student sends lands in `live/inbox/`: typed lines in `messages.jsonl`, files in
`uploads/`, handwriting in `live/slate/`. `board inbox` prints all three with full paths and marks
them read; `board slate` lists the slate pages alone.

`board wait` blocks until something arrives, then prints it and exits. That is the wake-up
primitive, and it is the difference between a session driven from the keyboard and one driven
entirely from the iPad: the student writes, taps send, and the assistant is woken by a process
exiting rather than by anyone typing in a terminal.

## Any agent, not just one

The entire interface is a command line and a directory of files. There is no SDK, no plugin, and
nothing model-specific anywhere in it. Any assistant that can run a shell command and write a file
can drive the board: Claude Code, Codex, DeepSeek, Cursor, a local model behind a terminal
wrapper.

- **To teach:** run `board start`, then write markdown files into `live/cards/`.
- **To listen:** run `board inbox`, or block on `board wait --timeout 300` inside your own loop.
- **To reach the iPad:** `board vpn up`, then `board net`.
- **To read handwriting:** open the PNG that `board inbox` names. This is the one capability the
  agent must supply itself — an agent that cannot look at an image cannot review handwritten
  work, and should ask for a typed answer in the board's text box instead.

## Layout

```
bin/board          the command line
serve.py           the server: watches cards, pushes SSE, compiles TikZ, takes uploads and ink
web/               the hub   — home.html, home.css, home.js
                   the board — board.html, board.css, board.js, macros.js, vendored KaTeX
                   the slate — slate.html, slate.css, slate.js
                   the app   — manifest.webmanifest, sw.js, icon-*.png (icon.tex makes them)
test/              node test/markdown.js and node test/macros.js
```

Per course repository, all of it ignored by git:

```
live/
  state.json       course and chapter labels shown in the title bar
  cards/NNNN-*.md  the lesson, in order
  inbox/           messages.jsonl and uploads/
  slate/           page-NN.json (strokes) and page-NN.png (what the assistant reads)
  tikzcache/       compiled SVG, keyed by content hash
  archive/         previous lessons, filed by `board open` or `board archive`
  export/          .tex and PDF produced by `board export`
  .board.json      which node, which pid, which port
```

---

# Setup, start to finish

This is the whole build, in the order it was done, on a machine with **no administrator rights**.
Everything below lives under `$HOME`. Nothing needs `sudo`; if a step ever seems to, it is the
wrong step.

## 0. What the machine has to have

```
board doctor
```

reports python, `latex`, `pdflatex`, `dvisvgm`, the vendored KaTeX, the node name, the port, and
the tailnet name. What it is checking for:

| Needed | Where it came from here |
|---|---|
| Python 3.7+ | system python3 — standard library only, nothing from pip |
| A TeX installation | TinyTeX in `~/.TinyTeX` |
| `dvisvgm`, `standalone` | `tlmgr install dvisvgm standalone varwidth preview needspace` |
| KaTeX | vendored into `web/katex/`, see step 2 |
| node | only to run the tests |

## 1. The tool itself

```
git clone https://github.com/<you>/Tutor-Board ~/Tutor-Board
cd ~/Tutor-Board && bash install.sh
```

That puts two commands on your path: `tutor`, which starts a session, and `board`, which the
assistant drives.

`install.sh` symlinks `bin/board` into `~/.local/bin`, then reports what is missing and prints the
command that would fix it. It never uses `sudo`, never writes outside `~/.local`, and never
installs anything on your behalf — the TeX and Tailscale steps are printed for you to run.

`bin/board` resolves its own symlink with `realpath`, so the launcher can live anywhere on the
path while the web assets stay next to the script.

A "course" is just a directory with a `live/` folder in it. `board` finds the enclosing repository
by walking up for a `.git` or an `AI_INSTRUCTIONS.md`, so running it anywhere inside a project is
enough. There is nothing to register and no configuration file.

## 2. Vendoring KaTeX

KaTeX is served from the repository rather than a CDN, so the board works with no internet and
so the iPad app has something to cache. It was taken from the npm tarball rather than by scraping
a CDN file by file:

```
npm pack katex@0.16.11
tar xzf katex-0.16.11.tgz
cp package/dist/katex.min.{css,js} package/dist/contrib/auto-render.min.js web/katex/
cp -r package/dist/fonts web/katex/fonts
rm web/katex/fonts/*.ttf web/katex/fonts/*.woff     # woff2 only; 3.0M -> 1.6M
```

## 3. TeX packages for the diagram pipeline

TinyTeX is deliberately minimal, so the pieces that turn a `tikzcd` fence into an SVG had to be
added:

```
tlmgr install dvisvgm standalone varwidth preview needspace
```

`standalone` crops the page to the picture, `dvisvgm` turns the DVI into an SVG, and `needspace`
is used by `board export` to stop a card's heading from being orphaned at a page break.

The pipeline is `latex` → DVI → `dvisvgm --no-fonts --exact-bbox`, not pdflatex → PDF, because
DVI keeps the geometry `dvisvgm` needs to produce clean vector output with text as paths.

## 4. Tailscale, without root

The board runs on a lab compute node on the institute network. The iPad is not on that network
and never will be. There is no route between them and no administrator rights to make one.

Tailscale's `tailscaled` has a **userspace-networking** mode: it implements its own TCP/IP stack
in the process instead of asking the kernel for a TUN device. That is what makes an unprivileged
install possible.

```
mkdir -p ~/.local/opt/tailscale
curl -L https://pkgs.tailscale.com/stable/tailscale_1.102.3_amd64.tgz \
  | tar xz --strip-components=1 -C ~/.local/opt/tailscale
ln -s ~/.local/opt/tailscale/tailscale{,d} ~/.local/bin/
```

Check <https://pkgs.tailscale.com/stable/> for the current version and the right architecture.

`board vpn up` then starts the daemon with:

```
tailscaled --tun=userspace-networking \
           --socket=~/.local/state/tailscale/tailscaled.sock \
           --statedir=~/.local/state/tailscale \
           --socks5-server=localhost:1055
```

The SOCKS5 proxy is not needed for the board, but it is how the setup was *tested* — a request
sent through it traverses the same userspace stack an iPad's traffic does, so it proves inbound
forwarding works without needing a second device.

### Logging in

The daemon starts logged out and prints an authentication URL. Nobody can approve it from the
terminal; a human opens the URL in a browser, signs in to the Tailscale account **the iPad uses**,
and presses Connect.

```
board vpn up          # prints the URL if not linked
board vpn status      # "Log in at: https://login.tailscale.com/a/…"
```

If the tailnet has device approval switched on, the machine also has to be approved under
Machines in the admin console.

### The node is named `board`, not after the machine

This is the part that is easy to get wrong, and it was gotten wrong first.

A cluster hands out whichever node is free, so the board runs on `node-a` today and
`node-b` next week. Registering as `node-a-board` would mean the address changed every
time — and the installed iPad app has exactly one origin baked into its home-screen icon, so a
changed address breaks it silently, days later.

The fix: Tailscale's state directory lives in the **shared home**, and the node registers as plain
`board`. Same state, same node key, same identity — one machine that happens to move, exactly like
a laptop changing networks. `https://board.<tailnet>.ts.net/` is the address forever.

Two hazards come with that, and the tool closes both:

- **One node at a time.** Two daemons sharing one state file would fight over the same node key.
  `board vpn up` refuses when another node holds the link, recorded in
  `~/.local/state/tailscale/owner.json` — and clears that record automatically when the recorded
  node no longer appears in `squeue` for this user, which is the usual reason it is stale.
  `--force` overrides.
- **A pid on a shared filesystem means nothing.** `live/.board.json` records the node name as well
  as the pid, and `board start`, `stop`, and `status` compare the node before trusting the pid.
  Without that, `board stop` from a different machine would signal an unrelated process that
  happened to have the same pid number.

### HTTPS

```
board vpn serve
```

puts a real Let's Encrypt certificate on the node's `*.ts.net` name and proxies it to the current
board. It needs certificates enabled once for the tailnet: admin console → **DNS → HTTPS
Certificates → Enable**.

This is worth the step rather than optional decoration: HTTPS makes the page a *secure context*,
which is what a service worker requires, which is what makes the installed app open instantly and
survive a dropped link instead of showing a blank screen.

Each repository has its own port, so `board start` re-points the proxy automatically. Switching
from Galois theory to probability changes what `https://board.<tailnet>.ts.net/` serves without
changing the address.

## 5. The iPad app

The board is a progressive web app: `web/manifest.webmanifest`, an icon, and `web/sw.js`.

The icon is rendered by TeX — `web/icon.tex` draws a chalk ∑ on slate with TikZ, `pdflatex` makes
a PDF, and `pdftoppm -scale-to N` rasterises 180, 192, and 512 pixel versions. Full bleed, no
rounded corners, because iOS applies its own mask.

Three files have to be served from the site root, which `serve.py` does explicitly:
`/manifest.webmanifest`, `/sw.js` (a service worker's scope is its own directory), and
`/apple-touch-icon.png` (where iOS looks).

The service worker caches the shell — HTML, CSS, JS, icons, KaTeX fonts — and **nothing live**.
The SSE stream, the board payload, uploads, slate saves, and compiled figures go to the network
every time. A cached lesson is a stale lesson, which is worse than a blank screen. Bump `VERSION`
in `sw.js` whenever a shell file changes.

Install it: open the board in Safari → Share → **Add to Home Screen**. It gets its own icon,
launches without Safari's chrome, and long-pressing the icon offers **Slate** as a shortcut
straight to the writing surface.

---

# Networking: reaching it from anywhere

`board net` prints every address the board currently answers on, in the order worth trying:

```
on this machine
  http://127.0.0.1:8787/
on the local network  (--lan was given; there is no authentication)
  http://192.168.1.24:8787/
over tailscale — from anywhere, on any of your devices
  this address does not change when you move to another compute node
  https://board.<tailnet>.ts.net/       <- open this on the iPad
  http://board.<tailnet>.ts.net:8787/
  http://100.x.y.z:8787/
```

Each repository gets a stable port derived from its directory name, so two courses can hold boards
at the same time. `board start --local` binds to loopback only, for use over an SSH tunnel or VS
Code's port forwarding.

## Security — read this before exposing it

**There is no authentication of any kind.** Anyone who can reach the port can read the lesson,
post to the inbox, upload files, and switch which course is being served. That is a deliberate
trade for a personal tool, and it means the network boundary is the only boundary.

What the code does to keep that honest:

- **It binds to loopback by default.** `board start` listens on `127.0.0.1` only. Opening it to
  the local network takes an explicit `board start --lan`, and `board net` says so when you have.
- **Tailscale needs no exception.** `tailscale serve` proxies from the tailnet to `127.0.0.1`, so
  the board stays closed on every other interface while remaining reachable from your own devices.
  This is the intended way to use it remotely.
- **Uploaded files are served inert.** Anything a person uploaded comes back with
  `X-Content-Type-Options: nosniff`, and anything that is not a plain image or a PDF is sent as
  `application/octet-stream` with `Content-Disposition: attachment`. Without that, uploading an
  `.html` or `.svg` file would put chosen script on the board's own origin.
- **Request bodies are capped** at 64 MB, and slate page numbers, upload names, figure hashes and
  static paths are all validated or sanitised rather than trusted.
- **`/switch` only accepts a directory the server already discovered** as a sibling of the current
  one. Paths from the request never reach the filesystem.

What it does **not** do, and you should assume it never will:

- No TLS of its own. HTTPS comes from `tailscale serve`, or from a reverse proxy you put in front.
- No user accounts, no sessions, no CSRF tokens, no rate limiting.
- `/switch` can start a process. On a tailnet of your own devices that is a feature; anywhere else
  it is a hole.

**Do not put this on a public interface.** Loopback plus Tailscale, or loopback plus an SSH
tunnel. If you need it on a LAN you share with anyone, put an authenticating reverse proxy in
front of it.

## The `hidden` attribute needs help

Every element the scripts toggle with `hidden` — the drop overlay, the scratch drawer, the slate's
prompt bar — is also given a `display` by a rule of its own. A user-agent stylesheet's
`[hidden] { display: none }` loses to *any* author rule that sets a display, whatever its
specificity, because author origin outranks user-agent origin. Without a guard those elements are
painted permanently.

Both stylesheets carry `[hidden] { display: none !important; }` and `test/hidden.js` fails if
either loses it. This is written down because the drop overlay shipped visible over the lesson
from the first version, and it cost two confident wrong diagnoses — a caching theory and an
iOS-resume theory — before anyone read the CSS.

## If the app looks stale or stuck

**Swiping out of an installed iOS app and back in does not reload it.** It resumes: the document
is restored from memory and no script re-runs, so a fixed bug stays on screen and new code never
executes. This is the single most confusing thing about the platform and it is worth knowing
before it costs an hour.

To actually reload, in rough order of effort:

1. Tap **↻** in the title bar. It exists because a standalone app has no browser reload button,
   and without it there is no way out from inside the app.
2. Force-quit: app switcher, swipe up on the card, reopen.
3. Delete the home-screen icon and Add to Home Screen again — this also drops the service worker's
   cache.

The app now also asks the service worker for an update every time it returns to the foreground,
and reloads itself when a new worker takes over, so a fix usually lands on its own a moment after
you swipe back in. The `controllerchange` reload is guarded on there having been a controller
already, or the very first visit would reload itself.

Nothing is cached by the browser except the KaTeX fonts — HTML, CSS, JS, and `sw.js` all go out
`no-store` — and the service worker is network-first for the shell. Bump `VERSION` in `sw.js`
whenever a shell file changes, so the old cache is evicted rather than merged. There is never a
need to revisit the original link.

One iPadOS quirk worth knowing about, since it produced a real bug: the system raises `dragenter`
on the page for gestures that are not file drags — the app-switcher swipe among them — and does
not reliably raise the matching `dragleave` when the gesture ends outside the page. Anything keyed
off those events needs a files-only gate, a watchdog, and a reset on `visibilitychange`. The drop
overlay is also `pointer-events: none`, so if it ever does stick it is cosmetic rather than a wall
across the lesson.

---

# What is verified, and what is not

Run before committing:

```
node test/markdown.js    26 cases on the markdown renderer, including the math-safety ones
node test/macros.js      every KaTeX macro, plus real formulas from both courses
node test/hidden.js      that `hidden` elements are actually hidden
node test/pages.js       every page's script runs against its own markup
node test/modes.js       that math mode has no text box and code mode does
node test/typeface.js    that the reading face reaches prose and never the maths
node test/interactive.js drives the real board in a real DOM and writes on it
                         (needs `npm install jsdom`; skips without it)
python3 tools/sync-macros.py --check   that TeX and KaTeX know the same commands
./install.sh             re-runs the environment check
board doctor
```

`test/markdown.js` matters more than it looks. The renderer parks math and code before any
markdown parsing and restores it afterwards, because otherwise a subscript or an asterisk inside
`$…$` gets eaten by the emphasis rules. Every change to it needs a case proving that still holds.

Confirmed by actually exercising it:

- TikZ fences compile and cache; the exported lesson typesets as a PDF.
- Slate ink round-trips: strokes in, PNG on disk, opened and read.
- `board wait` blocks and wakes on a send.
- Inbound over the tailnet works in userspace-networking mode, checked through the SOCKS proxy.
- The `ts.net` certificate validates, so the page is a secure context.

Not verified by anything automated: **how the pages look and feel**. There is no browser on the
compute node. Type sizes, spacing, the smoothness of a Pencil stroke, whether palm rejection
actually rejects a palm — those are only ever confirmed by opening the thing and using it. A test
suite cannot tell you the type is too small.
