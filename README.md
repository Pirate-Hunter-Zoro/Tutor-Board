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

## Picking this up in a new session

> **If you are reading this in a fresh session on Tutor-Board: your job is fixing the board from
> a person's account of using it.** Not teaching the subject — that is the other session's job,
> in the course repository, and it does not know or care about this one.
>
> **The one thing to understand before touching anything.** The person reporting these defects is
> *using the board at the same time*, on an iPad, in the middle of a Galois Theory proof. A
> regression here does not annoy them later; it stops the lesson now. That has two consequences
> and they are not negotiable:
>
> - **Ship, do not merely commit.** `bash scripts/ship.sh "message"` commits, pushes, and restarts
>   every board — a board is a long-lived process that read `serve.py` when it started, so a commit
>   alone changes nothing for them. Then bump `VERSION` in `web/sw.js` when a shell file changed,
>   or the installed app serves its cached copy and your fix is invisible.
> - **Check the address after every ship.** `tutor restart` bounces every course, and until 28
>   August each restart handed the tailnet name to whichever course came last — dropping somebody
>   mid-proof into a different lesson. That is fixed (`ts_repoint` will not take a name from a
>   board that is answering) but it is worth confirming: the port the HTTPS name points at should
>   be the course they are working in.
>
> ### Where this is right now, end of 28 August 2026
>
> A long evening of use, and roughly a dozen shipped changes. Shell version `board-shell-v54`.
> Three new suites: `test/feedback.js` (reading order, the surface, the boards), `test/panic.js`
> (the way back from a zoom), `test/address.py` (the tailnet name stays with its course).
>
> **Read the defect table below before proposing anything.** Most of that table was written today,
> and about half of its entries are defects *this session introduced and then fixed* — the scroll
> that fired on every heartbeat, palm rejection that latched the surface shut, a cap that made
> zooming into the writing pointless, a selection lockout that stopped the lesson scrolling. The
> pattern is worth naming: **every one of them was a rule with no way to expire, or a fix whose
> blast radius was wider than its author checked.** When you add a rule that refuses input, ask
> what clears it.
>
> **What changed today, in one line each:**
>
> - Feedback folds per question, so a two-hour exercise is not a wall of eleven cards.
> - Each question owns a slate page; nothing is ever wiped, and every question shows a board.
>   One is live, the rest are photographs drawn by the same paint code — see the table.
> - Palm rejection judges by the pen and nothing else, and every refusal expires.
> - The eraser sweeps the segment between samples instead of the point each event landed on.
> - Send lands you under the working, where the receipt is, and no longer re-fits the page.
> - Saving compiles the write-up first, so what is committed is the document and not just its source.
> - A picture can be handed over from the device at all, and the tutor is told to open it.
> - `#panic`, a movable button that puts the page magnification back.
>
> **What has never been tried on a device, in rough order of how likely it is to be wrong:**
>
> 1. **Everything shipped on 28 August.** All of it passes in jsdom, which has no layout engine
>    and no canvas backend. jsdom cannot tell you whether the swap from a dormant board to the
>    live one flickers, whether the palm timings feel right, or whether a preview looks identical
>    to the surface it stands for. Those are the three most likely things to be wrong.
> 2. **The dormant boards, on a real lesson with several questions.** The memory argument behind
>    them is sound and untested: watch for blank boards or the app reloading, which is what
>    iPadOS does instead of reporting a canvas budget.
> 3. **Handing a stroke on.** A pen landing on a dormant board should start its line there, not
>    lose it. This is a synthetic `pointerdown` re-dispatched at the live canvas and nothing but a
>    hand can confirm it.
> 4. **The eraser's reach.** `ERASE_R` is 26 screen pixels, chosen by argument rather than by use.
> 5. **`board hw build` inside a push**, against real LaTeX rather than the stub `test/homework.py`
>    uses.
> 6. **Leaving and saving.** The exit offer appears; nobody has tapped *Save and push*.
> 7. **A second turn in a headless session**, and **`board eyes`** against the headless agent.
> 8. **`tutor restart --tutors` on a busy daemon.** It refuses to claim a restart it did not
>    perform; worth watching once.
>
> **What is worth not relearning:** a board is a process and holds old code. A stub DOM will
> report a broken page as a working one, which is why the interactive suites use jsdom. Five
> visual defects were invisible to every test and obvious in one screenshot — ask for one early.
> Read the CSS before theorising about the platform. And when the person says a fix did not land,
> check what is actually being served (`curl` the file off the running board) before proposing a
> mechanism for why.

Read [`AI_INSTRUCTIONS.md`](./AI_INSTRUCTIONS.md) first — it is the contract for working on this
repository and it carries the invariants that were learned the hard way. Then:

```
board doctor          # is this machine equipped
tutor where           # what is running, and where
bash test/all.sh      # every suite; fetches jsdom itself the first time
```

**Nothing survives a lost session on a cluster node.** Processes die with the allocation, so at the
start of a new session expect to run:

```
tutor resume          # link back up, last course's board here, tutor attached
```

or, to have that happen by itself on every login:

```
bash scripts/install-autostart.sh --login-hook
```

From inside a course directory the long way still works — `board vpn up` then `board start`.

`board vpn serve` re-points the HTTPS name if it has drifted. The tailnet name is deliberately
`board` and not the machine's, so the address the iPad app is installed against does not move —
`board vpn up --hostname` is the only thing that should ever change it.

### Where this stands

Working and exercised: the card stream and its live push; KaTeX with a shared macro vocabulary;
TikZ compiled to cached SVG; the hub, with course discovery and switching; math and code modes;
the writing surface, docked in the lesson with its tools in the page chrome; slate pages saved as
strokes and as a PNG the assistant reads; the inbox and `board wait`; end-of-session commit and
push with no assistant attribution; Tailscale in userspace mode with HTTPS; the installed iPad app.

**Not verified, and only a person with the hardware can settle it:**

- *How the ink feels.* Smoothing, pressure response and palm rejection are all tuned blind. The
  knobs are `SMOOTH` and `RESAMPLE` at the top of `web/slate-core.js`.
- *How it looks.* There is no browser on the machine this was written on. Every visual judgement
  in here is inference.
- *macOS.* The platform paths in `boardlib.py`, `bootstrap.sh` and the LaunchAgent are written from
  documentation, not from a Mac.
- *Headless mode.* `tutor headless` has never been run against a real agent end to end. The
  `headless` recipes in the config are best guesses at each tool's non-interactive flags. The
  wrap-up turn that writes `HANDOFF.md` rides on that path and is equally unexercised.
- *Always-on hosting.* There is no machine that is awake when the cluster allocation is not, so
  the iPad can only reach a board while a session is already running somewhere. The plan for
  fixing that is written up under
  [Not yet built](#not-yet-built-always-on-with-the-compute-node-preferred) and is waiting on a
  Mac mini to exist.

### Things that broke, and must not break again

Each of these cost a round trip to discover. They are all under test now; if a change makes one of
these tests fail, the test is right.

| What went wrong | Guarded by |
|---|---|
| The drop overlay was painted over the lesson permanently — `[hidden]` loses to any author rule that sets a `display` | `test/hidden.js` |
| A pen stroke silently did nothing, because no page existed until `/slate/state` answered | `test/interactive.js` |
| The writing surface was collapsed, so its canvas was 0×0 and touches fell through to the lesson | `test/interactive.js` |
| Send scrolled off the end of the toolbar | `test/interactive.js` |
| Everything opened zoomed out, so writing was too small on any small screen | `test/sizing.js` |
| A subscript inside `$…$` was eaten by the markdown emphasis rules | `test/markdown.js` |
| A macro worked in the prose but not inside a `tikz` fence | `tools/sync-macros.py --check` |
| A bootstrap test renamed the live machine on the tailnet, moving the address the iPad app used | `BOARD_STATE_DIR`, and a guard in `bootstrap.sh` |
| A board whose node had died read as a tutor who had not written yet — same words, and a dot the size of a full stop for a difference | `test/link.js` |
| `board net` re-pointed the HTTPS name at a dead port, trusting a stale record from another node | `alive()` in `cmd_net` |
| An empty maths board could not be answered, asked, or prodded from the iPad at all: the first turn needed a terminal | `test/begin.py` |
| A writing prompt could not be declined, so an unwanted exercise had to be answered badly to clear it | `test/modes.js` |
| The writing surface vanished after closing and reopening the app: it survived a send only through an in-memory pin, and a pin is a variable | `test/link.js`, `test/modes.js` |
| A marker stroke came out of the export as a black smudge over the working it pointed at: the light-ink-to-dark-ink conversion was applied to a six-times-wide translucent stroke | `asHighlight` in `slate-core.js` |
| The marker was invisible on black paper and perfect in the sent PNG: a highlighter multiplies, and multiplying into near-black gives back near-black | `test/chrome.js` reads the CSS; the blend now follows the surface, not the setting |
| A sent answer was frozen into the transcript directly above the surface the same ink was still sitting on | `test/interactive.js`, `test/link.js` |
| The save's label wrapped onto a second line in a crowded bar, making the button taller than its row, so it painted over the agent chip and the button beside it | `test/chrome.js` |
| In dark mode a cream band filled the bottom of the screen: `<html>` painted `var(--paper)`, which resolves from `:root` and is therefore always the light value, while the dark palette is scoped to `<body>` | `test/theme.js` |
| A board with no assistant attached looked exactly like one with an assistant: the chip simply hid itself, so a tap went into an inbox nobody was reading | `test/link.js` |
| A login hook resumed the wrong course and then kept resuming it: the course was chosen by `live/.board.json` mtime, but `board stop` *deletes* that record, so the course you had just stopped became invisible — and starting the wrong one touched its files, which made it the most recent one next time too | `test/resume.py` |
| The test for all of that wrote its temporary course names into the real `~/.config/tutor-board/` | `test/resume.py` isolates the config for the whole run |
| The login-hook installer ran the commands inside its own comment: the block is written through an unquoted heredoc, so a backtick in a comment is a command substitution, and installing it executed `tutor resume` and pasted the output into the file | `test/resume.py` |
| The app opened on a blank white screen after the serving machine's allocation ended: the worker's last-resort fallback was `caches.match("/")`, which resolves to `undefined` when nothing is cached there, and resolving `respondWith` with `undefined` is a network error — so the board's own "cannot reach the board" banner never ran, because nothing ran | `test/offline.js` |
| A pen drag over a card started a native text selection: the card turned blue, the browser took the gesture, and the stroke died until a tap elsewhere cleared it — the slate page had refused selection from the start, the lesson never did | `test/link.js` |
| The whole board glitched, shifted and snapped back while nothing was happening: the reconcile detached the entire lesson into a fragment and re-appended it on every payload, and re-inserting a node restarts its CSS animations — which every card carried | `test/interactive.js`, `test/chrome.js` |
| Every payload re-parsed the markdown of every card and rebuilt its DOM, for a reconcile that then threw all of it away — a full frame's work, thirty seconds apart, for a heartbeat | `test/interactive.js` |
| A circle drawn round something near the edge of a card came back with a straight edge chopped across it: annotation samples were clamped into the card's own box | `test/link.js` |
| Annotation ink was faceted and jagged next to the slate's: the layer joined raw pointer samples with straight lines, redrew every stroke inside the pointer handler, and never asked for the samples the Pencil actually took | `test/link.js` |
| A `begin` signal sent while no tutor was attached was invisible for ever: `board wait` took the unread count at start as a baseline and returned only when it grew, so the first tap did nothing and the second one woke it | `test/begin.py` |
| A resumed turn was told to re-read the contract, the method, the handoff and every card — about fourteen thousand tokens it was already carrying, plus a round trip per card | `test/tokens.py` |
| The "is a tutor attached" dot could never go green outside headless: only the daemon ever wrote `agent.json`, and a heartbeat is the wrong test for a session that is idle whenever its person is thinking | `test/agents.py`, `test/begin.py` |
| Pressing Send did nothing: with marks anywhere on the lesson the handler raised the *Send what?* chooser and issued no request, so an evening's working sat unsent for two days. Every existing assertion about Send checked that the button was in the right column and had not scrolled off the edge; none pressed it. The old chooser test called `askWhatToSend` directly and asserted the deferral, so the suite endorsed the bug | `test/interactive.js` presses the real button and watches the wire; `test/link.js` |
| Sending re-delivered every mark on the board, and marks autosaved in a previous sitting counted as "there are marks" for ever — because the only thing tracked was whether ink had reached *disk*, which the autosave clears about a second after the pen lifts | `sent` in `live/annotations/<card>.json`, `notes_sent` on the payload, `test/annotate.py`, `test/link.js` |
| `board.log` held nothing but "listening", so a send that never left the iPad and a send the server rejected were the same observation: silence. Diagnosing the first cost a scratch server and a jsdom probe | `log_request` in `serve.py`, `test/annotate.py` |
| A turn id was unique for the life of a *lesson*, not of the course: `board archive` renames `turns.jsonl` into the archive and leaves `messages.jsonl` where it is, so filing a chapter sent the counter back to `t0001` while the inbox still held every id ever issued — two different turns, one name, and `turn_revision` offering rev 1 for something already sent | `.turnseq` plus the inbox and `answers/` as the high-water mark, `test/transcript.py` |
| A finger swipe wrote a line instead of scrolling, on every fresh load: the rule was a latch ("a finger draws until a pen has been seen"), and a latch is a variable | `tool.finger`, persisted; `test/plane.js` |
| Zooming out found a hard edge one screen away, because the page was a box and the view was clamped to it | `reach()` in `slate-core.js`, `test/plane.js` |
| The export rasterised the whole page at one pixel per logical unit, which only ever worked because the page was the size of the screen — on a plane it is unbounded work and an unbounded upload | `pngBox` crops to the ink and caps, `test/plane.js` |
| Three "not quite" cards sat in a row under a single attempt: an answer is versioned and shows only its newest revision, so three sends read as one, but the cards that replied to the first two were not versioned and stayed open beside the third — the reading order said they were three live objections to the working on screen | `superseded` in `board.js`, folded to one line each and reopened by a tap; `test/feedback.js` |
| The board scrolled to the bottom of the document when a card arrived, and the bottom of the document is the writing surface — so the feedback that had just been waited for went off the top of the screen and a blank slate arrived in its place | `revealNewest` parks the newest card's first line under the bar, and `following()` decides whether to; `test/feedback.js` |
| The writing surface ran to both edges of the glass, so on the screenful it occupied there was nowhere to put a thumb and scroll the lesson | `--gap` on `#writer` in `board.css`, which is a margin to scroll in, not decoration |
| Pinch-zooming the *page* grew the writing surface past every visible edge, and the surface eats touches by design, so the only pinch left available was the slate's own — the page could not be zoomed back out without quitting the app. `vw`, `svh` and `rem` cannot see the problem: they measure the layout viewport, which does not move when you pinch | `fitWriter` caps the surface against `window.visualViewport`, in CSS pixels, on every magnification change; `test/feedback.js` |
| A cap is a guess at a number, and being wrong about it strands somebody mid-proof with nothing left to pinch on. There is now a button as well, and the button is the guarantee | `#panic`, placed against the visual viewport and counter-scaled so it cannot pan off the glass; a tap re-centres, a press and hold moves it; `test/panic.js` |
| The board scrolled itself a screenful every thirty seconds while nobody was touching it: the rule was "if they were at the bottom, scroll to the bottom", which is a no-op on a board already at the bottom — so it survived every review until the destination changed to the newest card's first line, and then the tutor's heartbeat started dragging the page | nothing arriving means nothing moves; `anythingNew` gates the scroll, `test/feedback.js` |
| A palm resting on the glass panned the plane out from under a stroke that was still being drawn, and the next sample of that stroke landed at the new offset — so the page appeared to scroll away and a straight line streaked across the working to catch up. The suppression was a timer since the pen last *reported*, and a pen held still mid-word reports nothing | `penDown` and `handAtWork()` in `slate-core.js`: while the nib is on the glass a hand does nothing at all; plus contact-size rejection and disowning a stroke a touch began before the pen arrived; `test/plane.js` |
| The "↓ new" button carried a `bottom` and nothing to make `bottom` mean anything, so it sat in the flow at the end of the document where nobody scrolled past to find it | `.jump` is positioned; `test/feedback.js` presses it |
| Capping the writing surface against the visible window made pinch-zooming into the writing pointless: the cap was a fraction of what could be seen, so the block shrank by exactly the factor the page was magnified by | the cap is gone; `#panic` rides the visual viewport and puts the magnification back instead, `test/feedback.js` guards against re-adding it |
| Palm rejection latched the surface shut: a pen lift the canvas never saw left `penDown` true, and with it true nothing a hand did could pan, pinch or write — a dead surface with nothing on screen to say why. A contact-size test made it worse, because what Safari reports for a fingertip's width is not the small number the specification's examples suggest | `PEN_STALE`, `PALM_STALE`, and a window-level pen-up; size is not judged at all; `test/plane.js` |
| A fast swipe of the rubber left half the working behind: it tested the single point each event landed on, and a fast swipe is fast precisely because its samples arrive far apart | `distToSeg` sweeps the segment between samples, and coalesced events follow the real path; `test/plane.js` |
| The annotation pen missed about every other mark, and smeared a blue selection across the page instead. Two causes: the selection lockout said `.card`, and a lesson is not only cards — a stroke starting in the gap between two, or on the student's own turn, had no layer under it and no rule against selecting; and a stroke was discarded below three recorded samples, which is every tick and caret, because the samples are smoothed towards the hand's average and a short mark never gets far from it | `body.annotating #board`, a wider `PAD`, the lift position recorded, and two samples is a mark; `test/link.js` |
| Folding did nothing on a real lesson. Two reasons: the rule was "replies after the NEWEST question card", and one exercise ran to eleven cards under a single question over two hours — so there was never a newer question after them and nothing folded; and `note` was not counted as a reply, while five of those eleven were `note` cards answering something the student had just written | replies are folded per question run, and `note` is a reply; `test/feedback.js` |
| Every question now carries a board under it, and exactly one of them is live. The rest are photographs of themselves drawn by the same paint code, with the same paper and ink, at CSS resolution rather than device resolution — because a live surface is *two* canvases at device pixels (the sheet and its cache), about 17 MB each on an iPad, and iPadOS answers an exceeded canvas budget by handing back blank canvases or reloading the tab. Touching a picture makes it the live one, and a pen already on the glass is handed straight through so its first stroke is not eaten by the swap | `api.preview` in `slate-core.js` throws its pixels away as soon as it has them; `#writer, .board` share one rule so the two cannot drift apart; `test/feedback.js`, `test/chrome.js` |
| A page of somebody's proof was deleted because the tutor asked something else: the surface only ever answered the newest question, and a new one called `clear`. Two hours of Exercise 1.3 went that way | one slate page per question, never wiped; an earlier question carries **write on this one**, which docks the surface under it on its own page; `test/feedback.js` |
| Turning annotate mode on locked the lesson where it stood — nothing scrolled, and it read as the touch screen dying. The selection lockout was widened from `.card` to the whole lesson to stop a pen drag smearing blue across the page, and it carried `touch-action: none` with it: that also covered the margins, the gaps between cards and the student's own turns, which is every part of the page there was left to scroll with | the two rules are separate now — selection is refused everywhere, the gesture only over a card; `test/link.js` |
| The writing surface stopped answering at random, and the randomness was how fast the hand moved: a touch was condemned on `handAtWork()`, which is true for half a second after the pen last reported, and the judgement then lasted the whole life of the contact. "Write a line, then scroll" put a finger down inside that half second, and it stayed dead however long it rested | only a nib actually on the glass condemns for life; the half-second tail is applied per move, where it suppresses and then lets go; `test/plane.js` |
| The re-centre button repositioned on every scroll event — a forced layout read and a transform write per frame of every flick, which is how a page that is merely scrolling starts to stutter | coalesced to one placement per animation frame, its own size measured only when something could have changed it; `test/panic.js` |
| A push shipped a `.tex` carrying tonight's proof beside a `.pdf` from last week that does not. Compiling was a step the tutor had to remember at the end of a turn that had already delivered its card, and a session ends by being abandoned far more often than it ends tidily — so the committed document looked finished and was silently missing the exercise the evening was spent on | saving compiles the write-up first when it is out of date, from the board button and the CLI alike; a LaTeX failure still pushes the source and says so on the board; `test/homework.py` |
| Getting an exercise RIGHT was a dead end: the writing surface closes when the tutor writes a `correct` card, and "correct — now strike that line from it" is a correct card that still wants a pen. In a mathematics course there is no text box to fall back on either, so there was no way to write anything at all until the tutor happened to ask another question | `#reopen`, offered wherever the surface would be, lasting until the next question; `test/feedback.js` |
| Handing the tutor a photograph was impossible from a tablet. The file input had been in the page from the first version and nothing ever clicked it — dropping a file and pasting one both worked, and neither is a gesture that exists on an iPad | `#btn-add-file` in the scratch panel; `test/feedback.js` |
| An upload woke the tutor with a bare filename and no reason to think opening it was the next thing to do — the same defect the bare `[begin]` tag had, for the same reason: a picture has no sentence in it, so its inbox line has to carry its own meaning. `TEACHING.md` never mentioned uploads at all | the line says what to do and `TEACHING.md` has a section on it; `test/begin.py` drives the round trip |
| Pressing Send moved the board upwards and re-fitted the writing surface underneath it. Two causes: nothing put the page under the working, where the receipt and the tutor's "writing…" both are; and the payload the send provoked carried a turn one revision newer than the one on the surface, so `restoreAnswer` fetched the answer back off the server and handed it to `load`, which re-fits the page — throwing away the zoom the working had been written at, on every send | `revealSent` anchors to the foot of the surface; the send records the revision it just sent; `test/feedback.js` |
| A pen stroke appeared under the nib and was gone by the time the hand moved. Pointer ids are small integers and the platform reuses them, so a palm whose lift the surface never saw stayed in the map and came back attached to the Pencil — and the lift handler, seeing a known palm, returned before committing the stroke | a pen is never a palm, whatever the id says; `isPalm` takes the event, not the number; `test/plane.js` |
| Ink was lost to two autosaves racing to the disk: a save builds its body when it is called, so the version that lands is whichever the server writes second — regularly the older one — and any save completing cleared the dirty flag, so once a stale one landed last nothing scheduled another. `board.log` showed 111 strokes saved, then 106, then 111 | one save on the wire at a time, and `changeSeq` so a save only reports success for the page it actually carried; `test/plane.js` |
| A deploy dropped somebody mid-proof into a different course: starting a board claimed the tailnet name unconditionally, and `tutor restart` restarts every board on the machine one after another — so the address ended up wherever the course list happened to end. The installed app has one URL baked into it and no way to say which lesson it wanted | `ts_repoint` will not take a name from a board that is still answering; `board vpn serve` is the one command that does, because that is a person asking; `test/address.py` |

The pattern in most of them: a stub that returns a plausible object for everything will report that
a broken page loads fine. `test/interactive.js` and `test/sizing.js` use a real DOM for that
reason, and are the ones to extend when something is wrong on a device.

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
| **The answer panel** (`/board`) | the student | one block under the question — write on the slate, or type, with a toggle |
| **The drop zone** | the student | a file that was not written on the slate |
| **The signals** | the student | *code courses only* — ready to check, help, confused, in one tap |

Answering happens in one panel under the question: the slate and a typed half, and a toggle
between them. Whichever the student used last is the one that opens next. Nothing has to be
typed anywhere else, in the app or in a terminal.

### The first turn

An empty board is the one place that rule left a hole. With no card there is no question, so no
answer is owed, so nothing opens the slate — and in mathematics there is no box to type in either.
The board was a dead end until somebody went to a terminal and prompted the assistant, which is
exactly the ceremony `tutor` exists to abolish.

So an empty board carries one button, **ask the tutor to begin**. It sends a `begin` signal — the
same mechanism as code mode's *ready to check*, not a composer — which lands in the inbox as an
ordinary unread message and so wakes `board wait` like anything else. Sending it makes the board
non-empty, which retires the button; a tutor woken four times writes four opening cards.

Because a signal has no sentence in it, the inbox line carries its own meaning rather than a bare
tag: a headless assistant is woken with *there is nothing on the board yet and they are waiting,
open the session and write the first card*. `test/begin.py` drives that whole round trip.

### How a lesson is taught

The method lives in [`TEACHING.md`](./TEACHING.md) at this root — **not** in each
course's contract — and `board start` copies it into that course's `live/` every
time. The brief, the headless prompt and the cold-start line all point at it, so
every assistant in every repository reads the same document and none of them can
drift out of step.

The shape, in a mathematics course:

1. **Read the section's exercises first.** They are the specification for the
   lesson; the prose is the means.
2. **Choose a manageable few** — three to five, sometimes two — and say in the
   opening card which ones and why each earned its place. Not all of them.
3. **For each in turn:** teach the concept it needs, work a smaller example
   yourself, **hand the student a tiny instance of it to work themselves**, and
   only then pose the exercise as a `question` card and stop. A concept that has
   only been read is not one they can use, and the exercise is an expensive place
   to discover that. The check is thirty seconds of writing, one concept at a
   time, and it can be skipped like any other prompt.
4. **Read what comes back.** A wrong answer gets its break located, not repaired.
5. **When the chosen set is done, offer more** as a question — the student
   answers, or taps **skip**, which means *move on*.

Front-loading is the failure it exists to prevent: no chapter summary, no "here
is everything we will cover". Teach toward the question the student is about to
answer, and nothing else.

Sections are archived, so nothing has to be crammed — **◷** reopens any of them
with the student's own working still in it, and an exercise left undone is a note
for the next sitting rather than a loss.

In a code course the unit is a change made in the student's own editor, and the
three signals — *ready to check*, *I need help*, *I'm confused* — do what skip
does in mathematics. The rest of the discipline is identical.

### Sending, and what happens next

Sending used to drop a frozen copy of your ink into the transcript directly above the surface
that ink was still sitting on — the same thing twice, one above the other — and said nothing
about whether it had arrived.

Now the surface stays where it is and reports underneath itself: **sent at 8:12 — the tutor is
reading it**, or *waiting for the tutor*, or *no tutor is attached to read it yet*. What was
sent is not rendered into the lesson while it is still the thing you are looking at.

The moment the tutor replies, that changes: your answer takes its proper place under the
question, the receipt stands down, and **the writing surface moves below the feedback** — so
correcting your work happens under the criticism of it rather than scrolled off above it.

### Writing on the lesson itself

A question about a lesson is nearly always a question about one *place* in it — this line,
that step, the word "clearly". **✎ annotate** in the title bar turns the cards into
something you can write on directly; tap it again to stop, and the lesson scrolls and
selects exactly as before while it is off.

Marks are anchored to the **card**, in that card's own coordinates, not to the page. The
lesson reflows constantly — the type-size buttons, the reading face, the iPad rotating, a
figure finishing its compile — and ink pinned to the page would end up somewhere else every
time. Pinned to the card, it moves with the words it is about.

They save themselves about a second after the pen lifts, so a reload never costs them.

**Send always sends.** It used to ask first: with marks anywhere on the board, pressing
Send on the writing surface issued no request at all and raised a *Send what?* bar
instead, and the answer went out only on a second tap. A Send button that does nothing is
worse than no Send button, and it cost a real answer — an evening's working sat in
`live/slate/` for two days while the student believed it had been handed in, and the
board's own receipt never appeared, because the code that writes it was never reached.

So the working goes first, unconditionally; the button sits on the surface holding the
working, and that is what it means. If there are marks on the lesson that have not been
sent, they are then *offered* — **send those as well** — which cannot lose anything,
because by then the working has gone. Writing nothing and marking a card is the one
exception: with an empty surface the marks are the answer, and a blank page is not sent
alongside them.

Marks made when no answer is owed — on a card from ten minutes ago — get their own **send
my annotations** button, because otherwise they would be stranded with no Send button
anywhere on the page.

*Unsent* means unsent. Which cards have been handed over is recorded next to the ink, in
`live/annotations/<card>.json`, and comes back on the payload — so a reload can tell ink
that was delivered from ink that was only ever autosaved. Without that record, marks made
in one sitting and forgotten went on demanding a decision every time anything was sent,
for ever, and sending re-delivered them as a fresh turn each time.

What the tutor receives is the ink and the card it sits on, plus roughly where — *near the
top*, *in the middle*. It wrote that card and reads it back off disk, so it does not need a
picture of its own words, and nothing has to rasterise typeset mathematics in a browser.
`test/annotate.py` drives the round trip; `test/link.js` drives the layer in a real DOM.

### Declining a prompt

Teaching goes: explain, then ask for an example or a worked exercise. Not every one of those is
worth writing out, and **a prompt that cannot be declined is a prompt that gets answered badly to
make it go away**. So the answer block carries **skip this one** in its header, where it dies with
the block it belongs to.

Skipping is a turn like any other — it is in the transcript, and it wakes the tutor, because the
tutor has to carry on. Unlike a sent answer, which keeps the block open so a mistake can be
corrected in place, a skip closes it: the whole point is that the prompt goes away. The next
question is a fresh ask, unaffected.

What the tutor is told is *they are not writing this one out; do not re-ask it and do not press
them on it, carry on with the lesson*. Whether to work the exercise aloud anyway is the tutor's
judgement, not a rule.

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

### Arriving on a new node

An allocation ending takes the board, the tutor and `tailscaled` with it, on a machine you will
never be given back. The tailnet name the iPad has baked into it then points at nothing, and
**no node can be asked to take over**, because being asked requires something already listening
and that is precisely what died. A supervisor does not help either: it brings a service back after
a machine reboots, and a compute node does not reboot, it stops being yours.

The only moment a compute node gets is the moment you log in to it.

```
tutor resume                 take the board over here
tutor resume galois          a particular course, not the last one
tutor resume --no-agent      the board, and you drive the tutor yourself
tutor resume --force         move it even from a node that is still alive
```

It brings the link up, starts the board for the course you were last in, re-points the tailnet
name, and attaches a tutor.

**Which course** is the newer of two signals: when you last *named* one (`tutor galois`,
`tutor headless galois`, `tutor resume galois` — recorded in
`~/.config/tutor-board/chosen.json`) and when a course was last *worked in* (the newest of
`live/.board.json`, `state.json`, `turns.jsonl` and `cards/`). Neither alone is enough. File times
alone cannot tell a course you chose from one a login hook happened to start — and since starting a
course touches its files, a hook that resumed the wrong one would go on resuming it for ever,
quietly. A name alone is no better: one given last week should not beat an afternoon spent
elsewhere. This is not a registry of courses; those are still whatever directories are sitting
there. It records a decision, which is the one thing the filesystem cannot tell you.

What it is careful about is when *not* to act:

- a board already running here is left alone — only the tailnet name is re-checked, since a second
  board on this node moves it;
- a board on a node that Slurm still says is yours is left where it is;
- no Slurm at all means *unknown*, not *gone*, and is also left alone;
- a machine Slurm does not list as yours — a login node — gets no board at all.

To make it automatic:

```
bash scripts/install-autostart.sh --login-hook
bash scripts/install-autostart.sh --uninstall
```

That appends a marked block to `~/.bashrc`, which the shared home puts on every node. It runs in
**interactive shells only** — a login file that writes to stdout breaks `scp`, `sftp` and
git-over-ssh with a remote error nobody can read — takes a lock so five terminals do not race, and
backgrounds itself so no prompt ever waits on the network. `~/.tutor-resume.log` has whatever it
said; `export TUTOR_BOARD_NO_RESUME=1` turns it off for one shell.

This is a workaround for not having an always-on machine, not a substitute for one. It still means
the board is up only when you are logged in somewhere. The Mac mini design under
[Not yet built](#not-yet-built-always-on-with-the-compute-node-preferred) is the real answer.

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

### What a session costs, and why that is a design question

The tutor may be a model billed by the token rather than a flat-rate
subscription, and a headless course is a long sequence of turns against a
conversation that only grows. Two facts drive everything here: **a re-read is
charged again for the rest of the turn and again for the rest of the session**,
because every round trip resends the whole conversation; and **the lesson is
already on disk**, so nothing has to be carried in the conversation to survive.

- **Two prompts, not one.** A cold turn reads the contract, `TEACHING.md` and
  `HANDOFF.md` once. Every turn after it runs on the agent's own resumed session
  and is told, in as many words, *not* to re-read them. The single prompt this
  replaced told every turn to read the lot — roughly fourteen thousand tokens of
  documents the agent was already holding, plus one round trip per card in the
  lesson, plus a `board inbox` that answered "inbox empty" because the wake-up
  had already marked it read.
- **`board recap` reads a lesson in one call.** Every card as a line, the newest
  in full, the student's own turns, and which question is still open. Reading a
  twelve-card lesson card by card is twelve round trips for what fits in one, and
  it is what picking a course up cold used to mean.
- **Sessions are recycled.** `session_turns` in the config (12 by default)
  starts a fresh session once carrying the old one costs more than reading the
  lesson back off disk. Set it to 0 to resume for ever, which is the right answer
  on a flat rate and the wrong one on a meter.
- **The handoff is capped** at 350 words and is no longer invited to review the
  course's documentation on its way out. It is read in full at the start of every
  future session, so length there is a cost paid over and over.

None of this is allowed to cost teaching quality, and the rule cuts both ways: a
change to how the tutor teaches is also a change to what it costs, so a new rule
in `TEACHING.md` is weighed the same way. `test/tokens.py` holds it.

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
*attached* or *listening*, amber and pulsing while it is *working*, red when it has gone.

**How that expires depends on which kind it is, and getting this wrong is why the indicator was
dark in every ordinary session for a while.** A headless daemon writes a heartbeat as it works, so
two minutes of silence means it died. An interactive assistant is idle for exactly as long as the
person in front of it is thinking, and a heartbeat there would call a perfectly healthy session
dead the moment somebody went to make tea — so it is judged by whether its process is still
running. `tutor` records the pid before handing the terminal over, which is the same pid the
assistant then has.

Either way the host is compared first, and a recycled pid running something else does not count:
the home directory is shared across compute nodes, so a record from an ended allocation is very
likely alive here and belonging to a stranger.

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
    "aider":    { "cmd": ["aider"],    "prompt": "none" },
    "free":     { "cmd": ["opencode"], "prompt": "argv", "raw_prompt": true }
  }
}
```

`cmd` is whatever launches it. `prompt: "argv"` appends the opening brief as a final argument;
`prompt: "none"` launches it bare and prints the one line to paste. Add an entry for anything that
runs in a terminal — nothing in the launcher knows which assistant it is starting.

One entry is not a terminal agent at all: **`free`** is the built-in lightweight tutor. Its
headless turn is `bin/free`, a stdlib script that runs the lesson through `board recap`, OCRs the
student's handwriting with a free vision model, and writes one card as a plain completion over the
free-model chain (OpenRouter `:free`, then Groq). It exists because a general coding agent carries a
~38k-token tool prompt every turn, which exhausts the free tiers; a tutoring turn is three small
steps and this does exactly those. `raw_prompt` hands the script the raw inbox instead of the
instruction prompt, and its interactive `cmd` is opencode, so a person asking for a terminal
session still gets one. Use it on a machine you want to run without paying for a model.

The brief itself is written to `live/BRIEF.md` every time, so an assistant that takes no argument
can still be told to read it. It names the course, the mode, the session kind, and the board's
addresses, and says plainly that the board is already running.

### Which one, for this course, on this machine

A laptop and a cluster node do not have the same tools installed, and a course may want a
particular assistant regardless of where it runs. Four layers settle it, most specific first:

| Layer | Where it is written | Scope |
|---|---|---|
| `--agent opencode` | the command line | this once |
| `"agent": "opencode"` | the course's `tutorboard.json` | this course, on every machine |
| `"hosts": { "mac-mini": "deepseek" }` | the config, by short hostname | this machine, every course |
| `"default_agent"` | the config | everything else |

```json
{
  "default_agent": "claude",
  "hosts": { "mac-mini": "deepseek", "compute301": "claude" },
  "agents": {
    "claude":   { "cmd": ["claude"], "prompt": "argv",
                  "headless": ["claude", "-p", "{prompt}", "--continue"] },
    "deepseek": { "cmd": ["opencode", "--model", "…"], "prompt": "argv",
                  "headless": ["opencode", "run", "--continue", "{prompt}"] }
  }
}
```

**A model is not a layer, and must never become one.** An agent entry is a command recipe, so a
second model is a second entry whose `cmd` carries the flag — which is why "opencode with DeepSeek"
and "opencode with something else" are two names in this file and nothing in the code changes.

### The assistant belongs to the course, not to the terminal

One assistant is alive at a time, in the repository whose board is in front of you. Switching
course on the hub moves it: the board for the new course comes up, whatever was listening elsewhere
is asked to finish, and a new one is started in the new repository — resolved by the table above,
reading that repository's own `AI_INSTRUCTIONS.md`.

```
tutor agent status           which course has one attached
tutor agent start galois     attach one there, detaching whatever was elsewhere
tutor agent stop galois      ask it to write its handoff and go
```

Nothing about this asks the student to operate anything. They open a course; the assistant is
there.

### Nothing ends tidily, so every session ends in writing

A session does not finish with a goodbye. A course is switched, a lid closes, an allocation
expires. So the last thing a departing assistant does — before its process goes — is one turn with
no student attached, writing **`HANDOFF.md`** at the root of the course: where the student got to,
what they got wrong and what the misunderstanding actually was, what not to re-teach, and the one
next thing to cover. If the course's README or contract drifted during the session, it fixes those
too.

The brief tells every starting assistant to read that file first. It is committed with the rest of
the work, so it survives the machine, and it is the only continuity there is — an assistant's own
conversation history does not cross a node, a vendor, or a week.

`SIGTERM` is what starts the wrap-up, deliberately: the whole point is that it happens, so nothing
kills the daemon outright. It takes as long as one turn takes, and nobody waits for it.

### It does not matter where you run `tutor` from

Courses are found by name under `courses_dir`, and the launcher changes into the course directory
itself before doing anything. `tutor galois` from your home directory, from inside another course,
or from `/tmp` all do the same thing. The only command that cares where it is run is `board`, which
acts on the repository it is standing in — and the launcher never makes you run that.

### Every session starts by catching up

Before the board comes up and before an assistant is launched, the launcher runs a
fast-forward-only `git pull` in the course. A handoff written on the Mac mini is worth nothing to a
compute node that never fetched it, and the whole point of writing it down is that the work moves
between machines.

It is deliberately never fatal. No remote, no network, or a branch that has diverged: it says so in
one line and the session starts anyway on what is on disk. Somebody holding an iPad cannot resolve
a merge, and a session that refuses to start is worse than a session that starts a commit behind.

### Always-on, with the compute node preferred

**The goal.** Open the app on the iPad, pick a course, get a session. No command anywhere, ever.
The board runs on the compute node when there is one, because that is where the data and the
hardware are, and on the Mac mini the rest of the time, because it is the machine that is always
awake. Nothing about this is visible to the person holding the iPad.

#### The design, and the one discovery that shaped it

The obvious approach is that the tailnet identity `board` *moves*: whichever machine is serving
claims it, the way it moves between compute nodes today. That cannot extend to the Mac mini — the
ownership record lives in a shared home the Mac does not see, and macOS runs its own system
Tailscale that cannot also be `board` in userspace mode. So it is inverted: **the Mac mini owns
`board` permanently and proxies.** A compute node keeps its own ordinary name, and the Mac forwards
the iPad's traffic to whichever machine is actually serving: to the node while it is up, and to the
Mac's own warm board when it is not. The iPad's single baked-in origin never changes.

The first draft of this assumed the proxy was a re-point of `tailscale serve` at the node. **It is
not: `tailscale serve` accepts a remote tailnet backend in its config and then answers every
request with a 502** — it only proxies to a local backend. So the Mac runs a small local reverse
proxy instead, and points `tailscale serve` at that.

The pieces:

- **`bin/follow`** — the reverse proxy and the follower in one. A raw byte pipe (so the SSE stream
  and uploads pass through unmodified) that probes the compute node's `/health` and flips its
  upstream between the node and the Mac's own board. `--node`/`--listen` override the config; an
  ad-hoc instance on another port never steals `tailscale serve`.
- **`scripts/install-autostart.sh --always-on`** — the course-less form, registering two
  LaunchAgents: `com.tutorboard.follow` (KeepAlive proxy) and `com.tutorboard.resume`
  (StartInterval `tutor resume --quiet`, the warm board it falls back to).
- **`/handover`** in `serve.py` — a secret-gated way for one machine to ask the other to wrap up
  its tutor before the proxy moves.
- **`boardlib.machine_shape()`** — "always-on host" (a `follow` config block), "compute node"
  (Slurm answers), or "standalone". `board doctor` prints it, and `bin/board` uses it so that on
  the always-on host the HTTPS name points at the proxy, never at a board port directly.

#### Setting a machine up for this

The tailnet names are decided once and never move:

- **The Mac mini is `board`, permanently.** Its `~/.config/tutor-board/config.json` carries:

  ```json
  "follow": { "node": "compute-node", "listen": "127.0.0.1:8844" }
  ```

  `node` is the compute node's tailnet name; `listen` is the local proxy port.
- **A compute node keeps its own name — not `board`.** Its `board vpn up` must be told that name
  once, or the stale state in the shared home re-registers it as `board` and claws the identity
  back from the Mac.

> **If you are a tutor working on the compute node, and this repository has just been pulled there,
> prompt the person before you do anything else:**
>
> 1. `board vpn up --hostname <node-name>` — pin the node's own name, so it never re-claims `board`.
> 2. `handover_secret` in `~/.config/tutor-board/config.json` — the same value the Mac carries, or
>    `/handover` will answer denied.
>
> Then carry on with the ordinary session start. On the Mac mini the same two questions are the
> first thing to check when a board is not reachable from the iPad.

#### What only real hardware can settle

- Whether the iPad app's SSE stream reconnects cleanly when the proxy's upstream flips underneath
  it, or whether it needs a nudge. The service worker caches the shell and nothing live, so the
  risk is a hung stream rather than a stale lesson.
- How long a reclaim actually takes after an allocation dies, and whether that gap is short enough
  to be invisible or wants a "reconnecting" state on the board.

### Why there is no registry

Courses are whatever directories are sitting beside the tool. Adding one means making a directory;
there is no list to update and nothing that can go stale. `courses_dir` moves the search if your
repositories live somewhere else.

## Which subjects the app offers

**Whatever the machine that is serving has on disk, and nothing else.** The hub's list is a
directory listing of the serving host's `courses_dir`, built when the app asks for it — never
cached, never baked into the installed app, never written down anywhere. So the answer changes with
the machine, by itself:

- serving from a compute node with every repository cloned into the shared home, the app offers
  every subject;
- serving from a Mac mini with four of them cloned, the app offers four;
- and when the mini is proxying to a compute node, the hub you get is *that node's*, listing that
  node's repositories, which is right — it is the machine that would have to run the board.

There is no list to edit and nothing that can disagree with reality. To put a subset on a second
machine, clone a subset: `~/.config/tutor-board/courses.txt` is what `bootstrap.sh` reads, and it
is per-machine and not in this repository.

**A course that is not running is still offered**, because opening it is what starts it. What the
hub must never do is claim one is running when it is not. That was a real defect: a board that died
with an allocation leaves `live/.board.json` behind on the shared home, and nothing distinguishes
that from a board answering right now — so the hub went on saying *live on compute304* for hours
after compute304 stopped being a machine this user had, and a tap went somewhere nothing was
listening. The record is now checked against the nodes Slurm says are still yours, and
`tutor resume` sweeps the dead ones as you log in. Where there is no Slurm to ask, the answer is
*unknown*, and unknown is left alone rather than deleted.

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

A code project can also say **what the tutor is for**:

```json
{
  "name": "TRD-EHR",
  "mode": "code",
  "stance": "do"
}
```

`"stance": "teach"` is the default and the original point of the thing — the
student writes the code, and withholding it is the teaching. `"stance": "do"` is
for a project where that is not what is wanted: the tutor writes the code, runs
it, submits the job, and the card becomes a *report* — what changed, what it does
now, what ran and what came back — rather than an exercise. Everything else about
a turn is unchanged, which is why it is one line of configuration and not a third
mode: still one card, still short, still written before the rest of the work,
still stopping to ask for the one decision it needs.

It is declared and never guessed. Writing the code for somebody who wanted to
learn it is the one mistake here that the next card cannot undo.

**A tutor with a `do` stance needs the access to match.** Editing files is
granted by the course's own `.claude/settings.local.json`; anything else it has
to run — `sbatch`, `squeue`, `git commit` — belongs in that file's allow list,
and a companion repository the README points at (a planning repo, a task list)
has to be named in `additionalDirectories` or the file tools will refuse to open
it. A tutor that may write the code but not submit it can only ever report that
nothing has run.

| | `"mode": "math"` | `"mode": "code"` |
|---|---|---|
| Answering | the answer panel — write on the slate, or type | the answer panel, plus the three signals |
| The panel | write half and type half, one toggle | the same panel, whichever they used last |
| Suits | proofs, derivations, anything worked by hand | being walked through code, reviewing what you wrote, "do it yourself" |

The answer panel is the same in both modes: a writing surface and a typed half, one toggle,
and whichever the student used last is the one that opens next time. An old question remembers
its own answer, though: a board you wrote on reopens with the ink still on it, and a typed
answer reopens with the text in the box, both editable and re-sendable as a revision of that
same response rather than a new one. What still differs is the signals — in a code course the
work happens in the editor on the real machine, so the board carries *ready to check*, *I need
help* and *I'm confused* as one-tap pace control, and none of those belongs in a mathematics
course. The write/type choice is the student's, not the course's; a mode no longer decides how
anyone is allowed to answer.

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

### Getting around a course

**☰** in the title bar opens the contents: every chapter the course has, every problem set,
and the way back to what has already been filed. Tapping a chapter opens a lecture there;
tapping a set opens a homework sitting bound to it. The chapter you are in is marked.

Nothing here is registered. Chapters come from the course's own `chapters.tsv` or its
`chapters/chNN-*/` directories, problem sets from the two layouts described below — the same
discovery everything else uses, so there is no index to maintain and nothing that can go
stale. Galois Theory offers 20 chapters and 20 sets; Probability offers 11 and 3.

**Opening one files the lesson you are in** — cards, turns and answers together — so what you
leave stays readable under **◷** rather than being written over by what comes next. Jumping
around a course is therefore free: go to chapter 7, come back to chapter 2, and chapter 2's
lesson is still there with your own working in it.

A code repository has neither chapters nor problem sets, and is not told it is broken: its
sections are made as it goes. Each piece of work that gets committed is filed as one, which
is what `board push` marks there.

### Switching between a lecture and homework

The **LECTURE / HOMEWORK** badge in the title bar is the control. Tap it, and it offers
*lecture* or any problem set the repository actually has — `hw01`, `hw02`, `ch07`. Nothing is
typed, so nothing invented can reach the filesystem, and switching to homework binds the set
in one action. Switching back to a lecture unbinds it.

This was a terminal-only decision until it wasn't: `board open … --homework`. A student who
wanted help with a problem set had to find a keyboard to say so, which is the ceremony this
whole tool exists to remove.

**The two sittings differ in exactly one thing: who chooses the problems.**

| | lecture | homework |
|---|---|---|
| The problem list | the tutor picks a manageable few from the section's exercises | the assignment sheet chose them; all of them, in order |
| Leaving some undone | fine — sections are archived and can be returned to | not fine; a skipped problem is a lost mark |
| Everything else | identical | identical |

In a homework sitting the tutor is woken with the path to the sheet itself — for Probability
that is `homework/hw01/assignment/Prob.Homework1.2026.pdf` — and told to read it and do
exactly what it assigns. If no sheet is filed, it is told to ask rather than to infer a
problem list from the chapter. Statements are transcribed into the set's `.tex` first, then
the problems are taught one at a time exactly as in a lecture.

### A homework sitting is bound to a problem set

The teaching loop is the same as a lecture's — a card states the problem, the answer block takes
the working, the tutor reviews it. What is different is that a homework sitting is *producing a
document*, and the state of that document lives in a `.tex` file nobody holding an iPad can see.

So the sitting is bound to a set, and the board carries a strip saying which one, how much of it is
written up, and whether the last compile passed:

```
board open "Galois Theory" "Ch 7 homework" --homework          discovers the set
board open "Probability" "Homework 4" --homework --set hw04    or says which
```

```
board hw                  which set, and what is still empty
board hw list             every problem set in this repository
board hw use ch07         say which one, when the label was not enough
board hw build            compile it; the result appears on the board
board hw file 7.2         file a sent page into the set's handwritten/
```

```
hw04  homework/hw04/hw04.tex
  1      written up
  2      EMPTY
  3      statement not transcribed
  1 of 3 written up
```

**The board does not write LaTeX and must not.** The assistant edits the `.tex` with its own tools,
as it does with every other file in the course; what the tool owns is the part that is otherwise
invisible from a tablet. `board hw build` records the outcome, and a failed compile puts the actual
LaTeX error on the board the way a failed push does — "the build failed" without the reason is a
message that sends somebody to a laptop.

Two layouts exist across the courses here and neither is more correct, so the set is **discovered,
not assumed** — the same principle as course discovery:

| | |
|---|---|
| `homework/hw04/hw04.tex` | numbered by assignment (Probability) |
| `chapters/ch07-*/homework/ch07-homework.tex` | numbered by chapter (Galois) |

The session's own label usually settles it: *Homework 4* finds `hw04`, *Ch 7 — splitting fields*
finds `ch07`. When it cannot — twenty chapter sets and nothing to choose between them — it says so
and stops rather than guessing, because a wrong guess compiles the wrong document or files
handwriting into somebody else's problem. `board hw use` pins it for the sitting.

Problem labels are opaque strings, not numbers, because one course numbers problems 1, 2, 3 and the
other numbers them 7.1, 7.2, 7.3. `test/homework.py` covers both layouts, all three per-problem
states, and the discovery rules.

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

**⤓ save commits and pushes.** It runs the repository's `scripts/save-and-push.sh` — the same
script, the same commit, the same push as the offer you get on the way out and as `board push`
from a terminal. There is one path to a commit and three doors onto it.

**You can save without the tutor, at any point.** `⤓ save` in the title bar raises the
same offer, worded as what it is — *Save this work? … The lesson stays open.* Sessions end
by being abandoned far more often than they end tidily: a lid closes, an allocation
expires, somebody puts the iPad down. Until this existed the only route to a commit was a
prompt only `board finish` could raise, so leaving mid-session meant leaving the work
uncommitted.

**And the way out asks when there is something to lose.** With everything committed the back
arrow (`‹`) just goes — a prompt that appears regardless is a prompt that gets dismissed
unread, which is how the one time it mattered gets dismissed too. With work outstanding it
offers
*Save and push*, *Leave without saving*, or *Stay*, and says plainly that the lesson is kept
either way — cards, answers and annotations are files, and they are all still there when you
come back. Leaving without committing is a choice somebody makes, not something that happens
by walking away.

The save also shows what is at stake before you go: with uncommitted work it reads **⤓ save 4**
in amber rather than a quiet `⤓ save`. `git status` is asked at most once every eight seconds
and cached, so the poll loop stays cheap. And if you come back to a session you left with work
outstanding, the offer is put in front of you once rather than waiting to be noticed.

It behaves identically in a code repository, with one deliberate difference from the
terminal: `board push` there *ends* the session, because a commit is what "we got this
working" means — the board's save does not. It commits and the lesson carries on.

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

5. **A `.gitignore` that keeps runtime state local and tracks the transcript** — the lesson
   transcript (`live/cards/`, `live/turns.jsonl`, `live/state.json`, `live/slate/`,
   `live/answers/`, `live/archive/`, `live/inbox/`) is versioned, so a lecture — the cards, the
   student's turns, their handwriting, the files they uploaded and the archive — is the same
   whichever machine picks it up. What stays ignored is the per-machine runtime: `.board.json`,
   `agent.json`, `board.log`, the compiled figure cache and exports. The exact block is the one
   this repository's courses carry:

   ```
   live/*
   !live/cards/
   !live/slate/
   !live/answers/
   !live/archive/
   !live/inbox/
   !live/state.json
   !live/turns.jsonl
   ```

6. **`scripts/save-and-push.sh`** — the end-of-session push. Copy it from any repository here;
   it is self-contained and takes an optional commit message.

7. **Somewhere for finished work** — a `handwritten/` folder, a `notes/` directory, whatever fits.
   The board hands the assistant a path to each slate page; where it should be filed afterwards is
   the repository's business, and `AI_INSTRUCTIONS.md` is where you say so.

### Shipping a change

```
bash scripts/ship.sh ["message"]
```

Commit, push, and put every course on the new code in one act — because they are one act. A
board and a tutor read `serve.py` and `bin/tutor` once, when they start, so changing this
repository does nothing to a course already running: the pages come from disk and look new
while the endpoints and the daemon behind them are the old ones.

If the push fails, nothing is restarted. Running processes stay on the old code, which is the
right place for them while the change is not saved anywhere.

The commit is authored by whoever `git config user.name` says — no trailers, no co-authors, no
attribution to any assistant.

### Changing the tool restarts the boards

A board is a long-lived process that read `serve.py` when it started, so a change to this
repository does not reach a course until its board comes back. The pages are served from disk
and look new while the endpoints behind them are still the old ones — a difference that is
invisible from the outside and costs an evening to find. It cost one here.

So this repository's `scripts/save-and-push.sh` runs `tutor restart` after a successful push:

```
tutor restart              restart every board running on this machine
tutor restart --tutors     and the headless tutors attached to them
```

A tutor in the middle of a turn is left alone: bouncing it loses the card it is writing, and
the student is who pays for that. Otherwise it is stopped with `SIGTERM` — which is what starts
the wrap-up turn that writes `HANDOFF.md` — and the restart waits for that to finish before
starting the next one, so the continuity is written rather than merely a process killed.

It only touches boards that are genuinely answering **on this node** — a record on a shared
filesystem may belong to another machine, and stopping a stranger's process is worse than
leaving a stale one. A course pushing its own work does not do this; only the tool does. A
failed restart never fails the push.

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
board recap                      # the lesson so far, in one call
board inbox                      # what the student sent back, with file paths
board slate                      # just the pages written on the iPad
board wait --timeout 300         # block until the student sends something
board export --build             # the whole lesson as a typeset PDF
board hw                         # this sitting's problem set: what is still empty
board hw build                   # compile it; the result lands on the board
board hw file 7.2                # file a sent page into the set's handwritten/
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

**A fresh page is exactly the size of the surface showing it**, so one logical unit is one CSS
pixel and 100% is already the right size to write at — on a phone, an iPad or a large display.
Zoom exists for when you want it, not because the page arrived the wrong size. The earlier design
used a fixed 1600-unit page scaled to fit, which made writing small on a small screen and left
zooming as the only remedy; `test/sizing.js` sweeps seven screen shapes and fails if any of them
opens at anything but 100%.

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

### The surface is a plane, not a page

A page used to be a box: created at the size of the surface showing it, clamped
so the view could never leave it, and enlarged only by pressing a *taller* button.
Which means running out of room in the middle of a derivation, and zooming out to
find a hard edge one screen away in every direction.

Now panning is clamped to the *ink* instead — whatever has been written, plus a
viewport of clear space beyond it, in every direction including above and to the
left of the origin. Write into that space and it moves outward again. There is no
edge to reach, and no **taller** button, because there is nothing to enlarge.
Zoom out reaches a twelfth of fit scale rather than a half. **⤢** now means *show
me everything I have written*, which on a plane is not the same as *fit the page*.

The clamp still exists, deliberately: a stray pinch cannot fling the surface into
empty space a mile from the nearest word, which is how an unbounded canvas
usually goes wrong.

**And it costs nothing to hand in.** What the tutor is sent is a picture of the
writing, not of the plane: the image is cropped to the ink, padded, and then
scaled down if it is still large (2000 px on the longest side). Cost is
proportional to how much was written rather than to how far the canvas reaches —
the same three lines of algebra export to the same ~700×400 image whether the
plane around them is 800 units across or 8000. It used to rasterise the whole
page at one pixel per unit, which was survivable only because the page was the
size of the screen.

The surface also breaks out of the reading column. `#board` carries a 46rem
measure because prose needs one; sharing it made the writing area about half an
iPad in landscape. Cards keep the measure, the surface bleeds to the width of the
device (capped, so a large display does not get an absurd one), and its height is
`74svh` — `svh` rather than `vh`, because on iOS `vh` is the tallest the viewport
ever gets and anything sized in it spends its first screenful under the browser
chrome.

### A finger is not a pen

Swiping with a finger used to write. The rule was a latch — *a finger draws until
a pen has been seen, and after that a finger is a palm* — and a latch is a
variable, so every reload handed the first swipe to the ink. It also left somebody
with no stylus no way to say so.

It is a setting now, in the **⋯** menu under **Finger**: *scrolls* (the default)
or *writes*. Remembered per device in `localStorage`, because it is a property of
how you work and what is in your other hand, not of a lesson. The lesson's
annotation layer reads the same setting — it had its own copy of the old latch, so
the two surfaces disagreed about the same hand.

With a finger set to scroll, one finger pans, two pinch, and the pen writes.
Anything the hand does is ignored for half a second after the pen last reported,
which is what palm rejection actually is: without it, the heel of a hand resting
on the glass drags the canvas out from under the nib mid-word.

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
  writes; whether a finger does is a setting (**⋯ → Finger**), and touch is ignored for half a
  second after the pen last reported, which is the whole of palm rejection. Panning is clamped to
  the ink and the space around it, so the surface cannot be lost off-screen.
- **Pages**, for starting somewhere clean. A page no longer has to be made taller — it is a
  plane, and it grows into whatever you write on it.
- Grid, ruled, or blank paper. Undo is 60 deep and covers selection edits, not just strokes.

### What it deliberately cannot do

It does not recognise handwriting. Turning ink into text, or into LaTeX, needs a trained
recogniser — the apps that do this well license an engine built for the purpose, and it is not
something a canvas and a few hundred lines of JavaScript will approximate.

That is a smaller loss here than it sounds, because **the recogniser is the tutor**. Nebo has to
convert your ink into something a computer can act on; this only has to get your ink in front of
someone who reads mathematics. The PNG goes straight to them. Write the way you would on paper.

## The lesson is a transcript

Both halves of the conversation are on the board, in order. A card the assistant writes, then what
the student wrote back, directly beneath the question it answers — not in a drawer.

A **turn** is one contribution from the student. It carries the card it answers, it is frozen at
the moment it is sent (the slate is a working surface and will be written over), and it is
**versioned**: reading feedback and sending a corrected answer supersedes the previous revision *in
place* rather than adding another block at the end. Every revision stays in `live/turns.jsonl`,
which is append-only; only the newest is shown.

That is what makes the loop work. The assistant points at a mistake, the previous answer comes back
under the pen, the student fixes it, and the block updates where it already was.

### A session, and what ends one

| Course | A session is | Ended by |
|---|---|---|
| maths | a lesson, chapter, or homework sitting | `board open`, which files the last one |
| code | a piece of work that got committed | `board push` |

Ending one archives the whole of it — cards, turns and the frozen answers — into
`live/archive/<stamp>-<slug>/`. `board history` lists them; on the board, **◷** in the top bar
opens past lessons and renders one read-only, with everything the student wrote still in it. The
button is hidden until there is something to read.

## What the board is for in a code course

In a code course the work happens in the editor, on the student's own machine. The board is not
where code gets written and never should be. What it carries is the three things worth saying
about work that is happening somewhere else:

- **Ready to check** — one tap, no typing.
- **I need help** and **I'm confused** — these open a text box, and that is the moment a keyboard
  should appear, because neither is useful without a sentence after it.

All three are recorded as turns like any other, so the transcript of a code session is a record of
where the student got stuck and what unstuck them.

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
TEACHING.md        how to teach on this board -- copied into every course's live/
boardlib.py        the handful of things that differ between machines
homework.py        where a course keeps its problem sets, and how much of one is done
web/               the hub   — home.html, home.css, home.js
                   the board — board.html, board.css, board.js, macros.js, vendored KaTeX
                   the ink layer — annotate.js, over the tutor's own cards
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
node test/modes.js       that the answer panel is one, and the signals stay in code
node test/typeface.js    that the reading face reaches prose and never the maths
node test/interactive.js drives the real board in a real DOM and writes on it
node test/sizing.js      that every screen size opens at natural writing size
node test/link.js        that an unreachable board says so instead of looking empty
node test/theme.js       that the dark theme reaches the whole window, not just the content
python3 test/annotate.py that marks on a card are anchored to it and can be sent
python3 test/begin.py    that the first turn of a session can come from the device
python3 test/homework.py that a sitting finds its problem set, in either layout
python3 test/teaching.py that the teaching method reaches every course

bash test/all.sh         all of the above, in order. The two real-DOM suites need
                         jsdom; this fetches it on first run and carries on
                         without it if there is no network. A setup step someone
                         has to remember is a setup step that does not happen.
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
