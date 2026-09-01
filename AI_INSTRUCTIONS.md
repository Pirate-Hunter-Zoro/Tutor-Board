# AI_INSTRUCTIONS.md — Tutor-Board

This repository is a tool, not a course. It is the live typeset board the coursework repositories
use for tutoring. If you are here to *use* the board, the contract you want is the
`AI_INSTRUCTIONS.md` in the course repository, section "The live board". This file governs work on
the board itself.

Read `README.md` first.

## Catch up before you change anything

This repository is cloned on more than one machine — this Mac mini and the compute
node — and work moves between them by git, never by hand. The first act of any
session here is:

```
git pull --ff-only
```

A fix shipped from the other machine has to be in front of you before you build on
it, or you will be fixing a board that is not the one running. It is deliberately
never fatal: no remote, no network, or a diverged branch say so in one line and you
carry on. `tutor` and `tutor resume` now do this for the machine — pull, re-exec,
and bounce what is holding old code — but a session of yours may have been open
since before the last one of those ran, so pull anyway. But start from what is on disk, not from what was there when you last
opened it. The same rule applies to a course repository — its lesson transcript
(cards, turns, ink, answers) is versioned too, so a lecture picked up here is the
same one taught there. The headless tutor pushes that transcript on a beat and the
session start pulls it; do not re-commit a card the other machine already wrote.

**Then check the machine you are standing on.** This repository runs on an
always-on Mac mini (`board` on the tailnet) and on a compute node, and each has
two things that have to be true for the one iPad address to work. Prompt the
person for them rather than assuming they are done — a node whose name was changed
in the admin console still has the old name in its local state, and a missing
`handover_secret` fails silently.

**On the compute node this is one command, not a checklist:**

```
bash scripts/setup-node.sh --secret <the Mac mini's handover_secret> --tailnet-name <node-name>
```

Ask the person for both values; the script refuses to run anywhere but a compute node, is
idempotent, and reports what it found rather than what it assumed. Do not pin the machine's name
there — on a cluster it is supposed to change with the allocation. The reasoning, and the one step
left to a person, are in `README.md` under "Always-on, with the machine that holds the repository
preferred".

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
  hold boards at once, and derive it identically on every machine — the always-on host cannot read
  the compute node's filesystem, so a shared rule is the only way it knows where to knock. A name
  maps to a short *sequence* of ports (`boardlib.port_sequence`) rather than to one, because a hash
  cannot promise distinct numbers and did not: two courses collided and the second to start simply
  failed to come up. A start walks the sequence for a free port and records which one it took.
- **Which course the address serves is a decision, not a race.** `chosen.json` records the course a
  person named — `tutor <course>` writes it, and so does a tap in the hub — and every board
  publishes it through `/health` so the always-on host can follow it without reading this
  filesystem. Nothing may go back to serving whichever board answers first: with two boards up that
  is alphabetical order wearing a disguise, and it made tapping a course in the hub do nothing
  visible at all. A board also says who it is in `/health`, and no port is served without that name
  matching the course being looked for — a port is derived from a name and derivation is not proof.
- **Only a person records a course choice.** `chosen.json` is the record the always-on host follows
  to decide which lesson the one installed address opens, and it means *somebody asked for this*. It
  exists precisely because the answer cannot be derived from disk — working in a course touches its
  files, so "most recently used" re-elects itself. Machinery must therefore never write it:
  `agent_start` spawns `tutor headless <course> --respawn`, and `--respawn` means *record nothing*.
  Its callers are the login hook, the periodic pull, and `tutor restart --tutors`, which loops over
  every course — so a write here handed the address to whichever course a loop finished on, and the
  resume that read it back made the mistake permanent. The entry points that are a person naming a
  course (`tutor <course>`, `tutor agent start <course>`, a tap in the hub) do the recording
  themselves, before starting anything. `test/choice.py`.
- **Cards are append-only files.** The assistant writes `live/cards/NNNN-slug.md` and never edits
  a card the student has already read, except to fix a genuine error — the board is a transcript.
- **A card carries what the tutor SAID, never what it thought.** Every model worth teaching with
  reasons before it answers, and the reasoning is written in the first person about the student —
  "they are confusing the fixed field with the subgroup, so I should probably". Providers are meant
  to keep that out of the content they return; several of the free ones do not. A card is the
  lesson, is pushed to every device the moment it is written, and is committed to the transcript, so
  there is no undo — which is why nothing here trusts a model to have kept its thinking to itself.
  `boardlib.strip_reasoning` is the one place that knows what thinking looks like: the tutor strips
  as it comes off the wire, and `board write` strips again on the way in, so an agent this
  repository has never heard of is covered as well. The second gate takes only a block the card
  *opens* with — a lesson may be *about* reasoning models and say the word in earnest, and the body
  of a lesson is not ours to edit. `test/reasoning.py`.
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
  anchored to the card they answer, and versioned, so a correction supersedes the original *in
  place* rather than appending another copy. `live/turns.jsonl` is append-only; every revision
  stays, only the newest is shown. Every send still writes a PNG frozen at that moment into
  `live/answers/`, one per revision, and archiving takes cards, turns and those frozen answers
  together — a folder of the assistant's cards with the student's half missing is a record of half
  a conversation. `test/transcript.py` guards all of it, and none of that is negotiable.

  **What the transcript SHOWS is a separate question, and the answer changed on 31 August 2026.**
  It used to be the frozen picture, always, on the reasoning that the slate was one surface that got
  written over — so the picture was the only copy of what had been handed in. That reasoning expired
  when every question got a page of its own that is never wiped: the page is still there, under that
  question's board, and the picture beside it is a second dead copy of the same ink. The board is
  what is shown, and the picture is the fallback wherever there is no board to show — a filed lesson,
  a past one, or a browser that has never held this question's page, since that mapping is local to
  the device that made it. Decided by the person whose lesson it is, on the argument that a
  correct answer is written up into the document and the transcript is not the archival copy.
  `test/feedback.js` and `test/interactive.js` hold both halves of the rule.
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
- **Two kinds of assistant, two ways of expiring.** A headless daemon has a heartbeat and is dead
  after two minutes of silence. An interactive one is idle for exactly as long as the person in
  front of it is thinking, so it is judged by whether its process still exists — `tutor` records
  the pid before `execvp`, which is the pid the assistant then has. Applying the heartbeat rule to
  both is why the board's indicator was dark in every ordinary session; applying the pid rule to a
  daemon would believe a killed one whose record looked fresh. `boardlib.agent_is_attached` is the
  single place that decides, and the server, `tutor where` and `agent_live` all ask it.
  `headless --stop` skips interactive records: someone is sitting in front of that terminal.
- **A pid on a shared filesystem proves nothing.** Every record that crosses `live/` carries the
  node name, and every liveness check compares it before trusting the pid.
- **`hidden` must actually hide.** Both stylesheets carry
  `[hidden] { display: none !important; }`, because a UA stylesheet's `[hidden]` rule loses to any
  author rule that sets a display. Never remove it; `test/hidden.js` guards it.
- **Read the CSS before theorising about the platform.** The drop overlay shipped painted over the
  lesson from the first version, and it was blamed on caching and then on iOS resume semantics
  before anyone checked a two-line rule. When the user says a fix did not land, verify what is
  actually being rendered before proposing a mechanism for why.
- **The first turn must be possible from the device.** An empty board asks no question, so no
  answer is owed, so nothing opens the slate — and in maths there is no box either. That made the
  cold start a terminal job, which is the ceremony the launcher exists to remove. An empty board
  therefore carries one button that sends a `begin` signal, and sending it makes the board
  non-empty so the button retires itself. A signal has no sentence in it, so its inbox line carries
  its own meaning: in a headless session that line is the prompt the assistant is woken with, and a
  bare tag tells it nothing. `test/begin.py` drives the round trip. Do not answer this hole with a
  composer.
- **The teaching method ships with the board, not with the course.** `TEACHING.md`
  at this root is the method every course is taught by, copied into `live/` on
  every `board start` and pointed at by the brief, the headless prompt and the
  cold-start line. The course owns its subject; this owns the shape of a turn,
  because the shape is a property of the board. Do not paste it into a course's
  `AI_INSTRUCTIONS.md` — the same document in a dozen repositories drifts one
  repository at a time, and the one that drifts is the one noticed last.
  `test/teaching.py` guards both the rules and the delivery.
- **A lecture aims at an exercise.** Pick the section's exercises first, choose a
  manageable few and say which and why, teach only what each one needs with a
  worked example, pose one question, stop. Surveying a chapter and asking
  something at the end is the shape this exists to prevent: it wastes the hour
  and teaches to nothing.
- **Annotations are anchored to a card, never to the page.** The lesson reflows on every
  type-size change, typeface change, rotation and finished figure, so ink stored in page
  coordinates ends up somewhere else every time. Strokes are fractions of their card's own
  width and height and are redrawn from that. The layer is `pointer-events: none` until
  annotate mode is on — an always-live overlay over the lesson is the drop-overlay defect
  again, and it would eat every scroll and every selection. `test/annotate.py` and
  `test/link.js` hold both halves.
- **What the tutor gets is the ink and the card, not a picture of the lesson.** It wrote the
  card and can read it back off disk. Flattening rendered HTML and KaTeX into an image needs
  fonts inlined per send and cannot be verified without a browser; do not add it.
- **The lesson is reconciled, not rebuilt.** Nodes are keyed by card id and revision, so an
  unchanged card keeps its node — and with it its scroll position, its typeset mathematics
  and its ink layer. Never go back to clearing and rebuilding the container: it re-parses
  every card, re-typesets every formula and re-fetches every figure on every frame, and it
  discards the annotation layers.
- **Cards are ordered by their number, not by their mtime.** They are written in sequence and
  that sequence is their place; sorting by modification time meant correcting a typo in card
  three moved it after everything the student had since answered.
- **The student can save without the tutor, and saving is not ending.** `⤓ save`
  in the title bar raises the push offer at any moment, in either mode. The board's
  push commits and records the outcome; it does **not** archive, so a code session
  is not ended by it — only `board push` from a terminal does that, where a commit
  is the session boundary. Sessions end by being abandoned far more often than they
  end tidily, and until this existed the only route to a commit was a prompt that
  only `board finish` could raise. `test/link.js` and `test/annotate.py` hold both
  halves.
- **The way out of a lesson asks.** The back arrow offers save-and-push, leave-without-saving,
  or stay — every time, not only when the board happens to know something is outstanding. The
  session survives either way (it is files), but what is on disk is not what is pushed, and
  walking away is exactly when that gets forgotten. The board also shows the uncommitted count
  on the save itself, from a `git status` cached for eight seconds, and re-offers once when a
  session is returned to with work outstanding.
- **The kind of sitting is chosen on the board, and only from what exists.** The badge is the
  control; `/session` accepts `lecture`, `homework` or `review`, plus a set name or a list of
  chapter names matched against the repository's own, so a name from a request never reaches the
  filesystem. A homework sitting is woken with the path to its assignment sheet and told the
  problems are not its to choose — the one thing that differs from a lecture. Do not let a
  homework prompt inherit the lecture's "pick a manageable few".
- **A test review is held over a scope the student chose, and the scope is a list.** They are the
  only person who knows what is on the paper, so a review cannot start from one tap the way the
  other two do: the picker asks first, and it offers `review.units()` — the course's chapters, or,
  in a project that has none, the project's own top-level parts. A test is not one chapter, so
  every layer takes a list and never a single name, and the whole scope goes in one request:
  sending it a chapter at a time would archive the lesson once per tap. Names are re-resolved
  against the repository on the way out as well as on the way in, so a chapter renamed under a
  running sitting drops off the strip rather than sending the tutor to read a file that is not
  there. A review produces **no document** — nothing transcribed into a `.tex`, nothing compiled
  — because nothing is being handed in and the lesson is the record. Do not give it one, and do
  not let its prompt inherit the lecture's "pick a manageable few" or the homework's write-up.
  `review.py`, `test/review.py` and `test/review.js` hold it.
- **A board is a process, and processes hold old code.** `serve.py` is read once, at start, so a
  change to this repository reaches a course only when its board restarts — while the pages,
  served from disk, already look new. `scripts/save-and-push.sh` runs `tutor restart` after a
  successful push for exactly that reason. Restart only boards answering on this node; a record
  on the shared home may be another machine's.
- **A course is navigable from the board.** Chapters and problem sets are discovered, listed
  under ☰, and opening one goes through `board open` so the lesson being left is archived whole
  rather than written over. Do not add a registry of chapters; `chapters.tsv` and the chapter
  directories are the source of truth, and a code repository correctly has neither.
- **A writing prompt must be declinable.** Teaching is explain, then ask for an example — and a
  prompt that cannot be refused is a prompt that gets answered badly to make it go away. The answer
  block carries *skip this one* in its own header, so it dies with the block. A skip is a turn: in
  the transcript, and it wakes the tutor, because the tutor has to carry on. Unlike a sent answer,
  which keeps the block open so a mistake can be corrected in place, a skip closes it. What the
  tutor is told is to carry on and not press the point; whether to work the exercise aloud anyway
  is its judgement, not a rule. `test/modes.js` holds it.
- **A homework sitting is bound to a problem set, and the set is discovered.** Two layouts exist —
  `homework/hwNN/hwNN.tex` and `chapters/chNN-*/homework/chNN-homework.tex` — and neither is more
  correct, so `homework.py` finds it from the session label and never hardcodes a shape. When it
  cannot tell, it says so and stops: a wrong guess compiles the wrong document or files handwriting
  into somebody else's problem. Problem labels are opaque strings, because one course numbers
  problems 1, 2, 3 and the other 7.1, 7.2, 7.3.
- **The board does not write LaTeX.** The assistant edits the `.tex` with its own tools, as it does
  with every other file in the course. The tool owns only what is invisible from a tablet: which
  set, which problems are still empty, whether the compile passed, and where a page of handwriting
  is filed. Status is parsed from the `.tex` on every build rather than kept in a record of the
  board's own — the file is the truth, and two sources of truth drift. Do not add a splice command
  and do not mirror per-problem state into `live/`.
- **A failed compile reaches the iPad with its reason.** `board hw build` records the outcome and
  the tail of the log, and the board shows the LaTeX error itself. "The build failed" without the
  reason is a message that sends somebody to a laptop, which is the thing this tool exists to
  avoid.
- **The theme has to reach the whole window.** The viewport's background comes from `<html>` and
  only falls through to `<body>` when `<html>` paints none of its own — and the dark palette is
  defined on `body[data-mode="dark"]`, so an `<html>` painting `var(--paper)` resolves it from
  `:root` and is always the light value. That put a cream band under every page shorter than the
  screen. Leave `<html>` unpainted, give `<body>` the colour and a `min-height`. `test/theme.js`
  guards it, and fails on the old CSS.
- **A board with nothing attached must not look like a board with a tutor.** The assistant chip is
  never hidden: no record reads "no tutor attached", and the empty state says so beside the button
  it is inviting a tap on. Somebody asked the tutor to begin, saw the *connection* dot go green,
  and waited on a session nobody had started. Two indicators in one bar means both have to say what
  they mean.
- **An unreachable board must say so.** Zero cards and a dead stream used to render identically —
  "Nothing on the board yet" — so a board whose process had died read as a tutor who had not
  written, and the only signal otherwise was a dot the size of a full stop. No payload plus a dead
  stream states the fault where the lesson would be; a lesson already on screen stays readable
  behind a banner, because discarding what someone is reading is the worse failure. `test/link.js`
  guards both halves.
- **Never aim the tailnet name at a board that is not answering here.** `live/.board.json` crosses
  nodes on a shared home, so every command that re-points `tailscale serve` checks `alive()` first.
  `board net` did not, and a stale record from an ended allocation was enough for a command that
  reads like a diagnostic to park the iPad's one baked-in address on a dead port.
- **One answer panel, not two.** Every course has a writing surface and a typed half, one
  toggle, and whichever the student used last opens next. The mode no longer decides how a
  question is answered — the student does. What stays split is the code signals (*ready to
  check*, *help*, *confused*), which belong to a code course and never to mathematics. Do not
  reintroduce a mode that hides the typed half or the slate. `test/modes.js` and `test/answer.js`
  hold it.
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
- **A headless tutor's permissions are written once, by `board start`, into the course.** Nobody is
  at a terminal, so nothing can be approved while a turn runs, and a refused tool is not an error:
  the agent apologises into a log nobody opens and exits 0, which reaches the iPad as a tutor who
  answered with silence. `TUTOR_PERMISSIONS` in `bin/board` is the whole answer — created never
  edited, so a course keeps a list it has built up, and committed so its owner can see it. Do not
  also put the grant on the agent's command line. One policy in two places drifts the first time
  either moves, and the flag is the copy nobody can see. `test/agents.py` holds it.
- **A repair may move the egress, never remove it.** An exit node routes all of this machine's
  outbound traffic elsewhere; serving a lesson does not notice and teaching one entirely does, so a
  turn that fails is asked about rather than assumed — and only once it has already failed, because
  a probe in front of every turn is a round trip the student waits through. Rotation is bounded and
  every candidate is proved before it is kept. It must never switch the exit node *off*: somebody
  routing everything through one chose to, and exposing the address they hid in order to rescue a
  session is not a trade this code makes for them. Which endpoints count is `egress_probe` in the
  config, so no provider is named anywhere but one default value. `test/egress.py` holds it.
- **The machine's name is pinned, and derived in exactly one place.** Every record that crosses
  `live/` carries it and every liveness check compares it, so if it moves a machine stops
  recognising its own boards: `tutor restart` skips them, the hub reports them elsewhere, and a
  board that is answering becomes impossible to bounce onto new code. It moved here — a Mac with no
  `HostName` set takes its name from the network, and Tailscale's DNS renamed this one mid-session
  — and it was being derived four different ways in four files (`os.uname()` in the launcher,
  `socket.gethostname()` in the board and the server), which can disagree on one machine.
  `boardlib.node_name()` is the only place allowed to answer, it prefers a pinned file over
  anything the network says, and `board start` pins it the first time. Never reach for
  `gethostname()` or `uname()` again. `test/node.py` holds it.
- **The assistant belongs to the course, not to the terminal.** One is alive at a time, in the
  repository whose board is showing, resolved most-specific-first: `--agent`, then the course's
  `tutorboard.json`, then the machine by hostname, then `default_agent`. Switching course on the
  hub moves it. Never tie an assistant's lifetime to a terminal session, and never make the student
  start one.
- **A turn pays for what it needs and never for what it already has.** The tutor
  may be a model billed by the token, and every round trip inside a turn resends
  the whole conversation -- so a document re-read is charged again for the rest
  of that turn and again for the rest of the session. Hence: two headless
  prompts, not one (a cold turn reads the contract, the method and the handoff;
  a resumed turn is told in as many words *not* to re-read them); `board recap`,
  which hands back the whole lesson in one call instead of one round trip per
  card; a capped handoff, because it is read in full at the start of every
  future session; and `session_turns`, which starts a fresh session once
  carrying the old one costs more than reading the lesson back off disk.
  `test/tokens.py` holds all of it.
- **Every change to how the tutor teaches is also a change to what it costs.**
  A new rule in `TEACHING.md` is read by every session for ever, a new card kind
  is more output on every turn, an extra instruction in a prompt is paid for on
  every turn that carries it. Adding one is fine -- teaching quality comes first
  -- but say what it costs and take the saving back somewhere else in the same
  change. Never let a style note ship without the token pass; the two are one
  piece of work, not a feature and an optimisation to do later.
- **The subject list belongs to whoever is serving.** The hub lists the serving
  host's own `courses_dir`, built per request -- so a machine with a subset of
  the repositories offers a subset, and a proxy forwarding to a compute node
  shows that node's list, which is the machine that would have to run the board.
  Never cache it, never bake it into the app, and never add a list of subjects
  anywhere: the two cases compose correctly precisely because neither machine
  knows about the other's repositories. And never let the hub claim a course is
  running on the strength of a `live/.board.json` naming another node -- the home
  directory is shared, so a board that died with an allocation leaves a record
  identical to a live one. Check it against the nodes Slurm still says are yours;
  `tutor resume` sweeps the dead ones at login, and where there is no Slurm the
  answer is unknown, which is left alone rather than deleted.
- **A compute node can only be caught at login.** Nothing there outlives the
  allocation, and no node can be *asked* to take the board over, because asking
  needs something already listening and that is what died. So `tutor resume` is
  the takeover, and it is written to be run from a login file: silent and quick
  when there is nothing to do, and refusing to act when a board is alive on a
  node that is still yours, when Slurm cannot be asked, or when this machine is
  not one of your allocations. Anything appended to `~/.bashrc` must be guarded
  on an interactive shell -- a login file that writes to stdout breaks `scp`,
  `sftp` and git-over-ssh, and the failure surfaces on the other machine as
  something incomprehensible. `test/resume.py` holds all of it. This is a
  workaround for having no always-on host; it is not the always-on design and
  must not grow into a substitute for it.
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
