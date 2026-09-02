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
· [Getting work back](#getting-work-back) ·
[Exporting it](#exporting-the-whole-conversation) · [Any agent](#any-agent-not-just-one) ·
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
> ### Where this is right now, 2 September 2026
>
> **A carried-over copy is the student's, and erasing it means what it says.** Reported from the
> iPad: *"I got a new board to answer the next prompt, and I elected to erase my copied over
> previous board work, and started writing new work. Then all of a sudden, the old previous board
> work showed up again and the new work I started on got wiped."*
>
> Nothing was wiped, and that is the only good news here: `adoptInk` cuts a new page rather than
> writing over one, so the new working was still on disk — on a sheet with nothing pointing at it,
> which from behind a pen is the same thing.
>
> **Two rules keyed to the record were being applied to a board the record is not about.** An answer
> is keyed by QUESTION, and a question has as many boards as it took attempts. The next attempt
> opens on a **copy** of the one that was handed in — that is what carrying the working forward
> means — so it begins life holding every stroke of that answer while never having been the sheet
> the answer came off. Ask "has this sheet lost its answer" of it and the reply is nonsense: erase
> the copy, which is the first thing anybody does with one, and the board concludes the answer has
> been destroyed and hands it back, on a page of its own, under the pen. The record says which sheet
> the answer came off, so the test is whether this board is on it — and if some *other* board of the
> question is, the answer is accounted for and this one is a copy. That is the same guard
> `repairPages` has always applied before it moves anything, which is why `repairPages` never had
> this bug.
>
> **And the question was being asked in the wrong place entirely.** "Has this board's sheet lost
> what was handed in off it" is about a board you are coming BACK to and finding changed — the
> defect below this one, where touching a past board opened the sheet as it is now. It is not about
> the board under your hand, and asking it on every render of the board somebody is sitting on is
> how the send came back over a fresh start: clear your own answer's sheet to write it again, which
> is an ordinary thing to do, and the next payload ruled the answer destroyed. It is now judged once
> per board per **opening** — when the live board changes, and stayed owed until a judgement is
> actually reached, because fetching the frozen strokes and waiting for a hand to come off the glass
> are not decisions. Once judged, nothing the student then does to that sheet re-opens it.
>
> A third guard came with them, for the gap between ruling an answer gone and being able to act on
> it: a sheet that has GAINED ink since the ruling is a sheet somebody is using, and the reclaim is
> abandoned rather than re-judged against working that has appeared underneath it.
>
> `test/chain.js` holds all three, and each one fails on its own: erasing a copy and writing on it,
> coming back to that board later and finding what you wrote, and clearing your own answer to start
> it again. The behaviour the reclaim exists for is unchanged and still checked — a reused sheet
> still gives its answer back under the pen, on a page of its own, and an answer being edited still
> leaves you on the sheet you are editing. Shell version `board-shell-v76`.
>
> **Where a hand lands stopped deciding whether it writes.** Reported in three parts, and the
> middle one is the interesting one: *"annotating is STILL sluggish as hell. And on the side of the
> screen — the far left and right — I can't write/annotate there because it scrolls. I don't want
> the location to be what determines if I scroll or not. I want whether or not it is my finger
> operating determining if it scrolls or not. I should be able to annotate anywhere outside of a
> board."*
>
> **It was two rules about the same screen.** `body.annotating .card` carried `touch-action: none`,
> so a swipe over a card was always a stroke and a swipe anywhere else was always a scroll. `#board`
> is a 46rem column centred in the glass, so on a tablet in landscape that "anywhere else" is two
> hundred pixels of margin down each side — and a pen out there had no canvas under it at all, so
> the gesture went to the page. The margin was answering a question that belongs to the hand.
>
> Both halves are now the hand's. The ink layer permits the scroll in CSS and `annotate.js` takes
> it back on `touchstart` when the contact is a stylus, or when it is a finger and the slate has
> been told a finger writes — so a finger scrolls the lesson natively, with its own momentum,
> anywhere on it, and a pen never scrolls, anywhere on it. And the layer now *reaches* the margins:
> sideways to both edges of the window, up and down half the gap to its neighbour, so a run of
> cards has no strip in it where the pen has nothing to land on. Ink there is still stored as
> fractions **of its card**, which is what keeps it anchored to the words it is about through every
> reflow; the fractions simply go negative. A hidden neighbour is not a neighbour — the writing
> surface sits in that same list and reports a rectangle of zeros while the panel is shut, which
> reads as a neighbour a thousand pixels up, and a layer believing it would reach back over the
> card above and take that card's pen.
>
> **And the sluggishness was four more things, three of them the same shape as fixes the slate
> already had.**
>
> - **Every undo step was a deep copy of the card.** Every point of every mark on it, rebuilt on
>   every pen-down and every touch of the rubber, sixty of them on the stack — an allocation
>   proportional to everything already written, landing at the moment the hand asks the surface for
>   something. A step is the LIST of marks now, which is correct only because adding one REPLACES
>   the list rather than pushing onto it. `test/link.js` undoes two marks one at a time and fails if
>   a step ever starts holding the present.
> - **Every erase sample repainted the card.** Clear the whole layer, repaint every mark, per
>   pointer sample, of which a Pencil sends four a frame. It repairs the rectangle the removed ink
>   occupied instead — clipped, once a frame — and a pen lift repairs the rectangle of the stroke
>   that was just drawn rather than the card. Measured: nothing repainted where a repaint of five
>   marks is 195 line calls.
> - **A second contact could finish somebody else's stroke.** A `pointerup` is a `pointerup`
>   whoever sent it, and the layer never checked. The rest of the hand holding the pen used to be
>   able to end a word halfway through, and now that a finger scrolls over a card like anywhere else
>   there is one more contact that can. A stroke belongs to one pointer.
> - **And the autosave serialised the card in the middle of the next stroke.** It no longer encodes
>   a picture, but `JSON.stringify` of a well-annotated card is still real main-thread time, and it
>   was scheduled about a second after a stroke — which is the middle of the one after it. Deferred
>   while a hand is at work, the way the slate's own save is, with an eight-second ceiling so ink
>   still reaches disk under a hand that never stops.
>
> Two smaller things went with them: `end` no longer asks the card for its rectangle (a forced
> layout of a lesson full of typeset mathematics, once per stroke) — the resize observer remembers a
> card that grew mid-stroke instead; and the picture the tutor reads is cropped to the ink, because
> a layer that reaches both edges of the window would otherwise be a ring the size of a fingernail
> in the middle of a sheet of white.
>
> **What is still not writable, and deliberately.** The student's own turns. A `.mine` block
> carrying a frozen answer is a picture of a board, and the ask was to be able to write *outside* a
> board; the gutter beside one is the only place left where a pen scrolls. Annotations are anchored
> to a card id — `/annotate/save` takes one — so covering a turn is a change to what a mark is
> about, not to where the canvas reaches.
>
> **Nothing that arrives above the reader may move the reader.** The third part of the same report:
> *"intermittently, after I submit a response, it glitches and scrolls me up above the last board I
> wrote my response on."* Nothing scrolled. The transcript grew above the writing surface and took
> the page down with it, which from behind the glass is indistinguishable from being scrolled up.
>
> Two things do that on a send, and the first explains the intermittency. A sent answer is held out
> of the transcript until the tutor replies — but only when it is the LAST item, which it is only
> while the question being answered is also the last card the tutor has written. Answer an exercise
> the tutor has since written a note under, and the turn is rendered into its proper place *above*
> the surface, a whole board's height of it. And the frozen picture is an `img` with a width and no
> height, so it occupies nothing until it decodes and then suddenly occupies a screenful.
>
> Safari has no scroll anchoring, so the board keeps the place itself: `render` notes which card or
> turn the reader is actually looking at and where on the glass it sits, and puts it back once the
> lesson has been rebuilt around it. Everything below that either leaves the page alone or says
> explicitly where it should go, and both of those are decisions; content appearing above somebody
> is not. The late picture compensates on its own `load`.
>
> **And then it still did it, because the board was deciding to.** Reported again in the same
> words: *"after I submit my response, it still glitch-scrolls me up to above the board."* Nothing
> was shifting by then. `render` ends by asking whether anything arrived worth reading, and if so
> aims the page at `revealNewest` — the top of the newest thing the TUTOR has written, which with a
> question open sits directly **above** the writing surface. And "anything arrived" counted a fresh
> *turn*. So the payload the send itself provoked, carrying nothing but the student's own answer,
> read as news, and the board threw the page up to the card above the board they had just written
> on. News is a card. Your own answer is not news: a turn already has its own answer to where the
> page should be, and it is `revealSent`.
>
> That is the whole of the intermittency, too. The branch is gated on `!penBusy()`, whose tail runs
> 2.5 seconds past the last pen sample and 1.2 past the last touch anywhere on the page — so
> whether the payload beat the tail decided whether the page jumped, and when it lost, the board
> offered a jump *button* to the same wrong place instead. And it reads as a *glitch* rather than a
> move because `revealSentSettling` re-lands on the surface's foot 300ms and 900ms after a send: a
> payload arriving inside that window is yanked up and dragged back.
>
> **The first test for this was blind to it**, and that is the lesson worth keeping. It measured the
> shift and passed while the board was overriding the anchor one line later, because `scrollTo` is a
> no-op in the harness and nothing was looking at it. It now watches for a deliberate aim as well as
> a shift — and it is held back 2.7 seconds, because a render driven straight after a stroke is
> inside `penBusy`'s tail and reaches the jump button instead of the scroll, which is half the
> behaviour going untested. `test/interactive.js` carries a small layout engine for the transcript
> and fails on the old rule twice over. Shell version `board-shell-v75`.
>
> **A past board was a photograph taken for somebody else, and it could not be written on.**
> Reported from the iPad, mid-Galois: *"Some of the boards on my current Galois-Theory lesson are
> fucked. The color is inverted and when I try to write on them, it clears everything to be a new
> writing surface. I hate this. I want consistent board renderings even on a reload."*
>
> Three symptoms, and the first two are one defect. A board whose sheet no longer holds the answer
> that came off it shows **the answer** — the fix immediately below this one, and it is right — and
> it showed it as the answer's own PNG. That file is written for a different reader: always dark
> ink on white, cropped to the ink, because its only job is to be legible to whatever agent opens
> it. Dropped into
> a run of boards it reads as exactly what it is, a white sheet among black ones at a magnification
> of its own. And the same boards pointed at a page that had been cleared or reused, so touching one
> opened that sheet **as it is now** — which from behind a pen is an evening's working replaced by a
> blank surface.
>
> The strokes were on disk beside the picture the whole time — `live/answers/<turn>.json`, written
> once with it and never touched again — and nothing was reading them. So a past board is now
> **drawn**, by the slate, from those strokes, on the paper in hand and framed the way the live
> surface frames a page: indistinguishable from a live board, which is the rule every board here is
> built on. And touching one puts that same frozen answer back under the pen, on a page of its own,
> so the sheet that had been reused keeps whatever is on it.
>
> **The two thresholds are deliberate and the difference is the interesting part.** Showing the
> frozen answer asks only for one stroke fewer than was handed in. Moving the page under the pen
> asks for half, because somebody who sends an answer and then rubs two lines out of it is *editing
> that sheet* — and cutting them a fresh copy of the send would orphan the edit they are making.
> Display is reversible; the pen is not. `test/chain.js` holds both, including the edit case.
>
> **And the paper was forgotten on every reload**, which is the third symptom and the reason the
> ask was for consistency *on a reload*. Whether the paper is slate, white or cream is a property of
> the device — of this person, on this screen, in this light — and it was the one such setting that
> did not remember itself, while `finger` beside it did. Every board on the page is drawn with it,
> so a reload silently repainted a whole sitting in the other scheme. It is remembered now, with
> an ink colour that can be seen on it; every photograph is keyed by the paper as well as by what
> is on it, so one tap repaints the lot; the box a picture sits in is painted the paper's own
> colour rather than a hard-coded `#101114`; and choosing a paper no longer marks the page dirty,
> because the paper is not on the page.
>
> **Then the pen answered late, and there were four causes.** Reported in two messages: *"Sometimes
> there's a bit of a delay when I tap to write with the pen, especially if I've just erased
> something"*, and *"scrolling via finger on the writing pad is a little delayed after erasing,
> too."*
>
> - **Nothing was painted until the pen had moved.** A Catmull-Rom segment needs three samples
>   before it yields a single point of curve, and samples closer together than `MIN_STEP` are
>   dropped — so a nib put down and moved slowly, which is how a letter starts, marked the page only
>   after it had travelled a pixel or two. The surface was silent while the hand waited to see its
>   own ink. The landing point is painted as a dot now, on the frame the pen goes down, on both
>   surfaces.
> - **Every erase sample threw the whole cache away.** Rubbing out a word on a page holding four
>   hundred strokes repainted all four hundred, several times a frame. It repairs the rectangle it
>   emptied instead — the union of what the removed strokes covered, clipped, drained once a frame
>   rather than once a sample. Measured in `test/plane.js`: 336 line calls where a full repaint is
>   2,832, on a fixture a fraction of a real page's size.
> - **And a full repaint drew the whole plane.** A page grows downward as it is worked, so most of
>   an evening is a screen or more away; strokes are culled against the visible box now, which is
>   what a pan costs — one finger moving rebuilds the cache, and that is the scroll that stuttered.
> - **The autosave was encoding a picture nobody needed yet.** `toPNG` repaints the page offscreen
>   and PNG-encodes it, on **every** save — about a second after every stroke. This is precisely the
>   defect fixed in the annotation layer earlier the same evening, still present in the place where
>   it costs more. A send still encodes, because that picture is frozen as the answer; an autosave
>   encodes only once the hand is off the glass — and a *finger* counts, which is why the scroll
>   was late too.
>   The strokes reach disk at once either way, and they are what a reload restores.
>
> Three more came out of being told it was *still* laggy, and two of them are the interesting ones.
>
> - **Every undo step was a copy of the whole page.** `JSON.stringify(page().strokes)` — three
>   hundred kilobytes of JSON, built on every pen lift and on every touch of the rubber, at the
>   exact moment a hand is asking the surface for something, with sixty of them on the stack. A
>   step is now the LIST of strokes rather than a copy of them, which is correct only because
>   nothing on a page is ever changed in place: dragging a selection and recolouring one replace
>   the strokes they touch with copies first. `test/plane.js` drags a selection and undoes it, and
>   fails if that copy-on-write goes away — the failure mode otherwise is an undo that silently
>   stops undoing.
> - **Every card in the lesson held a canvas the size of the card.** The ink layer has to exist on
>   every card, because it is what takes the pen while annotate mode is on — and it was allocated at
>   the card's full size in *device* pixels the moment the card appeared. Twenty or thirty cards of
>   that on a retina tablet is several hundred megabytes of backing store for canvases almost none
>   of which will ever be drawn on: the same budget the dormant boards were turned into photographs
>   to stay inside of, spent on nothing. The box stays the card's, plus the overhang that makes two
>   adjacent layers meet; the bitmap now waits for the first mark.
> - **And every payload redrew all of them.** `Annotate.load` runs on every card the tutor writes
>   and every heartbeat, and it called `redrawAll` unconditionally — a forced layout and a full
>   repaint per card, arriving in the middle of somebody writing. It redraws the marks it actually
>   adopted, which after a reload is the point and at any other time is nothing.
>
> Annotation had two of the first four as well: no mark until the pen moved, and `draw` asking the
> card for its rectangle on every erase sample, which forces a layout of a lesson full of typeset
> mathematics. And three smaller things, from being told that a *tap* after erasing was late and
> then that scrolling up to read earlier replies was: an autosave's picture is drawn to a smaller
> cap than a send's (the one a send carries is what the tutor reads and what is frozen as the
> answer, and it keeps every pixel); any tap on the surface or its toolbar pushes the picture pass
> back; and **a scroll of the lesson counts as a hand at work**, which it always should have —
> the board is part of a page that scrolls with a finger, so "is a hand busy" cannot be answered
> from the writing surface alone. Nothing about a picture has to happen in a particular second.
> `test/plane.js` and `test/link.js` count all of it. Shell version `board-shell-v73`.
>
> **And one thing found on the way that is worth more than the fixes: a diagnostic destroyed a page
> of somebody's proof.** `live/slate/page-07.json` in the Galois lesson holds exactly one stroke —
> `#eee`, two pixels wide, from (10,10) to (20,20), on a 1130×1514 page — and so does `page-99`,
> written at 10:59 and 12:52. That is nobody's handwriting. It is a probe payload POSTed to
> `/slate/save` on the **running** board, and page 7 is the sheet question 6's answer was handed in
> off: 279 strokes, replaced by a fixture. The entry below reads that page as "cleared, reused or
> cloned over" and it was neither — it was overwritten by a session checking whether saving worked.
>
> Nothing is lost, because what was handed in cannot move: the answer is intact in
> `live/answers/t0003-r1.json`, and the fix above is what brings it back onto the surface. The file
> is deliberately left as it is rather than repaired by hand — the board holds its own copy of every
> page in memory and would write over any repair on its next autosave, and writing into a live
> lesson's slate is the whole of what went wrong here. **A board with somebody on it is not a test
> fixture.** Drive a temporary course, the way every suite in `test/` does.
>
> **A past board was a picture of a live page, and a live page moves.** Reported twice in
> different words — *"my writing from one section is wrong and came from a later section"*, and
> then *"the very latest few board recordings are just repeats of my earliest"* — and the second
> report is what made it findable, because it says the boards are showing **early** sheets.
>
> Measured on the actual lesson rather than guessed. The record is intact and always was: every
> answer handed in has its own distinct frozen ink in `live/answers/`, four for four, nothing lost
> and nothing crossed. What had moved were the **slate pages** those answers came off. Question 6's
> answer was handed in off page 7 with 279 strokes; page 7 now holds one. Question 7's came off
> page 9 with 279; page 9 now holds a different 228. Pages 4 and 12 are byte-identical. A dormant
> board was `writer.preview(page)` — a photograph of that sheet **as it is now** — so every one of
> them was pointing at a moving target.
>
> What was handed in cannot move: it is written once, into `live/answers/`, and never touched
> again. So a board whose page no longer holds the answer that came off it now shows the answer,
> and says *as it was handed in*. The test for "no longer holds it" is **fewer strokes than were
> sent** — a page can only lose strokes by being cleared, reused or cloned over. More strokes is
> the ordinary case of carrying on after sending, and the live page is then the better picture:
> it contains the answer and the work since. `test/chain.js` hands an answer in, reuses its sheet
> under a later question, and fails on the old behaviour.
>
> A note on the measuring, because it cost a wrong turn: `board_json` caps a response at 1 MB and
> a slate is bigger than that, so the first probe reported **zero** slate pages and briefly looked
> like the working had been deleted. It had not. Read the file, not the endpoint, when the file is
> the thing.
>
> **And annotating was paying for a picture nobody read, after every stroke.** Reported straight
> after the selection fix landed: *"Annotating isn't doing the highlighting anymore but it is HELLA
> laggy. I try to write something out multiple times and a few seconds later the multiple writings
> all show up overlapping and ugly."* The first half is the fix working. The second half is a
> blocked main thread seen from behind a pen — the strokes were captured the whole time and nothing
> could paint them, so several attempts arrived at once.
>
> The autosave was the cost. `Annotate.payload` built an offscreen canvas the size of the card,
> repainted every stroke on it and PNG-encoded the result — on **every** save, which is about a
> second after every stroke, for every card with unsaved marks. On a tablet holding a long lesson
> that is hundreds of milliseconds of the main thread, over and over.
>
> And nothing read it. An autosave exists so a reload does not cost the marks, and what a reload
> restores is `strokes`; `load_notes` never opens the picture. The tutor reads it, and the tutor
> only ever sees marks that were **sent** — so the picture is built when it is sent and not before.
> `test/link.js` counts the encodes on both paths. Shell version `board-shell-v71`.
>
> **The board is a package now.** Asked for in these words: *"reorganize the fuck out of this
> repository. The python scripts are monsters."* They were: `serve.py` was 2,806 lines and
> `boardlib.py` another 1,619, and nine hundred of the first were a single `if path == ...` in two
> methods. The cost was never length. It was that finding out what `/switch` did meant reading past
> everything else, and that two unrelated changes edited the same enormous method.
>
> It is `tutorboard/` now, organised by what a thing is **about** — `paths`, `ports`, `choice`,
> `machine`, `processes`, `tex`, `limits`, `reasoning`, `handoff`, `sense`, `machines`, and then
> `net/`, `course/`, `lesson/` and `server/` with `server/routes/` holding one module per family of
> paths. `serve.py` is the entry point and nothing else; it keeps its name and its command line
> because a board is a long-lived process identified BY that command line, and renaming it would
> orphan every board already running.
>
> Three rules came out of doing it, and they are in `AI_INSTRUCTIONS.md` as rules rather than
> history, because each one broke something on the way. **Import modules, never names** — a test
> that moves `paths.CHOSEN` or replaces `machine.machine_shape` must move it for every caller, and
> `from x import y` takes a copy of the binding and quietly defeats that. **A module name is
> reserved vocabulary** — a local called `state`, `turns`, `cards` or `hub` shadows the module it
> came from, and that is invisible until the line runs. **One place derives a path** — `paths.TOOL`,
> because a module that moves takes a hand-rolled `dirname(dirname(...))` with it and the only
> symptom is LaTeX failing to find `board-macros.tex`.
>
> Nothing about the behaviour changed and the whole suite says so, twice over: every existing check
> passes, and `test/choice.py` now also checks the shape itself — that `/switch` lives in
> `server/routes/machines.py`, that `handler.py` holds no routes, and that the entry point is under
> forty lines. A route that drifts back into a nine-hundred-line handler fails a test rather than
> being noticed a year later.
>
> **Three defects from the same evening went with it.** The word *Pen* got selected when a hand
> rested on the annotation toolbar — `body.annotating #board *` already refused selection over the
> lesson, and that bar is fixed-position, outside `#board`, so none of it applied there; the
> selection then owned the next drag, which is why annotation "intermittently stopped writing".
> Both toolbars now refuse selection and take a tap without waiting to see if it is a zoom.
>
> And **two boards were holding each other's working**: *"my writing from one section is wrong and
> came from a later section, vice versa."* The mapping from question to page is repaired against
> the server's record — every answer carries the page it was sent from — but only where the entry
> in hand looked untrustworthy, and a *swap* looks perfectly healthy from inside one browser: both
> pages exist, neither is shared, both have ink. It is just the wrong ink. A board sitting on a page
> the record says belongs to a different question is now wrong on evidence, and gets moved.
> `test/adopt.js` swaps two boards and fails on the old rule.
>
> **Every autosave was crashing the board, and had been.** Reported as "it also keeps failing to
> save", and the log said it plainly: `UnboundLocalError: local variable 'record' referenced before
> assignment`, once per save, thrown out of `/slate/save`. The send-only tail of that handler had
> been de-indented out of its own `if` — so every ordinary autosave, which is every save the slate
> makes while somebody is writing, ran code that builds a *turn* record, hit `record` before it was
> ever assigned, and killed the connection without a response. The real "saved" return underneath
> it was unreachable dead code the whole time.
>
> The strokes did reach disk — the page file is written before the crash — so nothing was lost; the
> board simply never heard back, said `offline`, and kept the page marked dirty. Both halves of
> what was reported were one bug. `test/begin.py` now posts an ordinary autosave at a real board
> and checks it gets an answer, which is a thing no suite had ever asked.
>
> **And a tutor being bounced no longer reads as a tutor that died.** "No tutor attached. NOW the
> tutor just got attached, but this is spotty" — both true, and the cause was a ship: `tutor
> restart --tutors` stops each daemon and starts it again, and the gap between showed on the iPad
> as the dead-end chip a course that never had a tutor shows. The record is marked on the way out
> now and a clean stop keeps it rather than deleting it, so the board can tell *reattaching…* from
> *stopped — nothing is reading the board* from *no tutor attached*. Three different things that
> used to look identical. `test/agents.py`.
>
> **And then `offline` beside the send button, which was the same wound.** Reported with the
> tutor plainly listening at the top of the same screen. That tag is set when a `/slate/save` is
> refused — and it was set *and left there*: the word never cleared, nothing retried, and the page
> still owed the disk its strokes. One save fell into a gap while the address was trading machines
> and the label stayed for the rest of the sitting.
>
> Underneath it, a worse one. A failed save correctly leaves the page dirty; the drain that runs
> when a save settles then asks for the next dirty page, gets that same page straight back, and
> tries again with nothing in between — **a tight loop hammering a socket that is not there**, for
> as long as the board is unreachable. Now: a refused save says *not saved — retrying*, backs off
> to fifteen seconds, holds the queue while it waits, and clears itself the moment one lands.
> `test/plane.js` refuses every save, watches it retry, then lets one through and checks the label
> goes back to `saved`. Shell version `board-shell-v68`.
>
> **The board kept flickering, and it was the address trading a lesson for an empty room.**
> Reported in three words from the iPad, mid-proof. The state it was reported in, measured rather
> than guessed: a Galois board on the compute node with a tutor and the lesson in it — *Ch 03 —
> Rings*, two cards — and a Galois board on the Mac with **no tutor and nothing on it**, both up,
> both claiming the same chosen course. The address traded between them, so the lesson appeared,
> vanished, and came back.
>
> The follower already has the rule that should decide this: a board with a tutor beats an empty
> room with the same claim. What defeated it is that **deciding asked each board over the tailnet
> three separate times** — once to find it, once for `has_tutor`, once for `limited` — and neither
> of the last two can tell *it said no* from *it did not answer*. So one slow probe made a board
> alive enough to hold the address and, in the same decision, tutorless. A memo in `probe` now
> gives every question asked about a board during one decision the same answer. It is deliberately
> shorter than the tick: a memo, never a cache, so a board that died is noticed on the next
> decision rather than five ticks later.
>
> **And a decision can still disagree with the last one**, so a move the *choice* did not ask for
> now has to say the same thing twice before the address follows it. Only then — a tap moves it at
> once, and so does the board holding it going quiet. Nothing waits on a machine that is broken;
> only a machine that is working gets the benefit of the doubt. `choose_target` returns the course
> it decided for, which is how those two are told apart.
>
> **The one-second wake made it worse, and that was mine, from this morning.** It compares what a
> local board publishes, and a probe it could not make was reading as *it changed* — so one refused
> connection a second became one full re-decision a second, each of them a fresh set of tailnet
> probes and another chance for a timeout to move the address. A wake added to make a tap instant
> had turned a slow wobble into a fast one. `None` is now "I could not ask", never "it changed".
>
> `test/choice.py` reproduces the flicker against a machine that answers every other question, and
> fails on the old code.
>
> **The Mac never has to be visited again.** Asked for in these words: *"make and ship something
> that once I run it on the mac, it will always periodically pull and run this catch-up... I only
> want to have to do this one more time."*
>
> `bash scripts/stay-current.sh`, once, on the always-on host. It registers a LaunchAgent that runs
> a **round** every ten minutes: fetch this repository and every course beside it, and if anything
> actually arrived, run `scripts/catch-up.sh`. That last clause is the whole difference between
> this and a cron line — a catch-up restarts every board on the machine, and doing that every ten
> minutes to somebody mid-proof would be worse than the problem it solves. Nothing arrived is
> nothing done, silently.
>
> **The part that makes it the last visit** is easy to miss and is the reason this is a script
> rather than a plist somebody pastes. A timer that only *runs* something has to be reinstalled by
> hand the next time the schedule, the log path, or the set of background jobs changes — which
> means going back to the machine, which is the thing being abolished. So every round re-asserts
> its own launchd definition **from the repository it just pulled**, and reloads it only if the
> definition actually differs (reloading the follower costs the address a moment, and doing that
> for a file that was already correct is a cost for nothing). It asserts the follower and the warm
> board too, installing them only if they are missing. A future commit that changes how any of this
> is supervised lands by itself.
>
> A round also hands over to the code it just pulled — `exec`, so a commit that changes what a
> round *does* takes effect on the round that fetched it rather than the one after. Guarded on
> HEAD having actually moved, because exec'ing after a pull that changed nothing is a loop.
>
> Two things it is careful about, both of which would otherwise turn into a visit. **"Behind" means
> origin has something we have not** — not that two hashes differ. A machine that is *ahead* of
> origin differs too, and reading that as behind is an infinite loop with a `git pull` in it; it is
> an ancestry question and `--behind` exposes the real one, so the suite tests what runs rather
> than a copy of it. And **the tool repository can never be the thing that gets stuck**: a machine
> that cannot fast-forward is a machine somebody has to go and visit, so a diverged or dirty tool
> is put back on origin the same way `catch-up.sh` puts a course back — `git stash push -u` first,
> then a tag, then the reset, with both named in the log. Nothing is destroyed; it is just no
> longer checked out.
>
> It supersedes `com.tutorboard.pull`, which pulled the tool and none of the courses, and retires
> it on install rather than leaving two timers racing for the same repository.
> `bash scripts/stay-current.sh --status` says whether it is loaded, when it last ran, what it
> found and which commit the machine is on. `test/current.py` drives a real round against real
> repositories.
>
> **Switching a course reliably moves the address, and the hub waits for it to.** Reported in
> these words: *"I just had to type Galois Theory ten fucking times to switch to it from
> Probability, and then it just switched back."* Four separate defects, and every one of them made
> a correct tap look like a tap that did nothing.
>
> **The hub reloaded after 700 milliseconds.** `/switch` records the choice and returns; the
> **follower** on the always-on host is what moves the address, and it does that some time later.
> The page reloaded before then, landed on the board being tapped *away* from, and looked exactly
> like nothing had happened — so you tap again. Ten times. It now polls `/health` until the
> address actually serves the course that was asked for, on the machine that was asked for, says
> what it is waiting for while it waits, and when it does not land in a minute it *says so*
> instead of reloading you back where you started. A second tap while one is in flight is not a
> second switch.
>
> **A tap was recorded on one machine and the other found out by being asked.** Up to thirty
> seconds later, on the follower's next tick — and the cheap wake that exists to avoid that wait
> watches a file only a *local* tap touches, so a tap on the machine not holding the address woke
> nobody. A tap is an event and can be sent: every machine that can hear it now gets the record
> within a moment, by POST to a new `/chose`, which records and does nothing else — no board, no
> tutor, no address. The relay keeps the **originating** timestamp, so one tap is one identical
> record everywhere and there is nothing left for two clocks to disagree about, and an older word
> can never overwrite a newer one in either direction. The wake also asks a board now as well as
> reading a file, because the follower runs under launchd and the boards do not, and those two are
> not always the same disk view — the lesson from 1 September, applied to the other half of it.
>
> **And a board never published the host.** The hub can ask for a course *on a named machine* and
> `wanted_host` is the rule that honours it — reading the host off whichever record is newest,
> including ones it gets by asking a board. A board published the course, the port and the time,
> and not the host. So a choice made anywhere but the follower's own machine arrived with the
> machine silently blank and rule 0 could never fire. The comparison was wrong too: it checked the
> person's choice against the *configured* node name, which is exactly the name that goes stale
> and is why the tailnet walk exists at all. It compares against the host the board was actually
> found on.
>
> **Then it switched back**, and this is the one worth reading. `active_course` decided the
> fallback by comparing the choice's timestamp against every course's `live/` modification time
> and taking the newest. That reads as reasonable and is self-defeating: a running board writes
> into its own `live/` constantly — a heartbeat, a state file, a turn — so the course being *left*
> went on touching its directory and overtook the recorded choice within seconds of the tap. Being
> busy was being read as evidence of being wanted. A named course now wins outright, and
> modification time decides only when nobody has chosen anything, which is the only question it
> can honestly answer.
>
> **And a machine, once found, is not lost again.** The walk that discovers a peer's board knocks
> on the ports of the courses cloned *here*, and the two machines are not the same list — five
> courses on one of this pair and nine on the other. So a peer whose only running board is a
> course this machine has not got was invisible to it, and a machine that drops out of the
> **Where** row is a machine you cannot switch to. The port that answered is remembered per host
> and asked first. What is still true and worth knowing: a machine with **no** board running at
> all cannot appear there, because a board is the only thing on a machine that answers — bring one
> up over there once and it is findable from then on.
>
> `test/choice.py` holds all of it. Shell version `board-shell-v67`.
>
> **The tutor stopped lecturing.** Asked for in these words: *"I want tutoring style for
> homework/lessons of any kind based on a book to be completely about exercises. Completely."*
> `TEACHING.md` had the right instinct already — teach toward the question they are about to
> answer — and it was not enough, because it still described an explaining step: *teach the
> concept, work an example yourself, then hand them a small one.* A model reading that writes a
> lecture and staples a question to the bottom, every time, because that is what teaching looks
> like in everything it has ever read.
>
> So the shape is now stated outright and stated first: **a lesson is exercises, all the way
> down.** There is no explaining step. Whatever would have been explained is handed over as
> something to do — the tutor brings the objects, a group of order six, three candidate subgroups,
> a map that is nearly a homomorphism, and the student shows what they are. The exercise is stated
> in full up front so they can see what the work is for; it is laddered with one small thing per
> idea the exercise *actually uses*, and none at all for an idea it does not, however central that
> idea is to the chapter; and then it is **re-posed in full**, because *now try 4.12* is eleven
> cards up a tablet somebody is holding. Two rungs is normal, five means the wrong exercise was
> chosen. Any rung can be skipped, and skipping every one of them is using the board correctly.
>
> **And a card that poses a problem now carries its own definitions.** Asked for from the board
> mid-proof: *"I don't want to have to scroll back to understand exactly what I'm trying to
> prove."* A statement on its own is not the whole question — the definitions it leans on are
> part of it, and on a tablet they are eleven cards up. So every posing card is **self-contained**:
> under the statement, one line each for every definition, symbol and named result the problem
> uses — *normal: gNg⁻¹ = N for every g in G*; *[G : H]: the number of left cosets* — including the
> ones from checks the student skipped, because a skip means *I have this*, not *do not tell me
> what the symbol means*. A reference list, not a re-teaching: nothing on it is argued for. It
> costs a few lines and it buys the thing the board is for, which is the whole of what they need
> being in front of them.
>
> A review inverts exactly that one thing and nothing else: it asks **cold**, because laddering in
> front of a question tells you only that the student can follow a ladder. The ladder comes off the
> break, once there is one.
>
> The half that mattered as much as the document: in a headless session the board's own sense line
> **is** the whole prompt, and it used to say "teach only what the problem needs, one question per
> turn". That sentence is a lecture instruction. Every kind of sitting — lecture, homework, review
> — now carries the same hoisted paragraph (`METHOD_SENSE` in `serve.py`), and the brief and the
> cold-start prompt in `bin/tutor` say it too. `test/teaching.py` guards both halves.
>
> ### Where this is right now, 1 September 2026
>
> **One command on the Mac.** `bash scripts/catch-up.sh` pulls the tool and re-runs itself on what
> arrived, brings every course repository up to what was pushed, restarts the boards, the tutors
> and the follower, and then *says what is actually true*: what is running, the direct tailnet URL
> for each board, and what the hub will offer on both machines. `--tidy` also stops boards for
> courses with nothing in them; `--report` changes nothing and just tells you where everything is.
> It is machine-agnostic — run it on either host.
>
> Two things it is careful about, both learned the hard way in the writing of it. It never treats
> the tool as a course: this repository holds an `AI_INSTRUCTIONS.md` like every course does, so
> the obvious test would have reset it over the top of whatever was being worked on. And a course
> whose history has diverged is **tagged** before it is reset, so nothing that was not already
> pushed is destroyed — `git reset --hard <tag>` is the way back — while `git clean` is restricted
> to `live/`, because a course may hold untracked work of the person's and this is not the command
> that gets to decide about that.
>
> **And a path-aliasing bug it turned up on the way.** This home is reachable as both
> `/home/<user>/…` and `/mnt/dell_storage/homefolders/<user>/…`, and a board records the path it
> was started with. `board_is_running` compared those as strings, so a command arriving by the
> other spelling concluded the board was not running: the hub showed every course idle while one
> was answering on its port, and `board start` would happily have begun a second board for a
> course that already had one. Compared by `realpath` now, in `tutorboard.paths.same_dir`, and used
> everywhere a root is matched — the hub's *current* flag and both launchers' "you were working
> here" included.
>
> **The machine is now a choice, and it is yours.** Asked for in these words: *"I want to be able
> to control this at all times on the iPad - whatever hosts are available"*. The hub has a
> **Where** row listing every machine on the tailnet that is running a board, with how many
> courses each can teach; picking one lists that machine's courses, and tapping a course there
> records the pair and asks that machine to bring it up.
>
> This was never cosmetic. Which courses exist is a property of a MACHINE — they are whatever is
> cloned next to the board — so a course list has always been "the courses of whichever machine
> happens to be serving you", and the other machine's were not merely hard to reach, they were
> invisible. Measured on this pair while building it: the Mac has five course repositories, the
> compute node has nine. *"Galois Theory is the only option"* was exactly that.
>
> A machine's list comes from a board on that machine — `/courses.json` is already the answer to
> "what is cloned here", so one board is enough to learn what a machine has — and the walk runs
> off the request, so the hub opens now and fills in. `/start` lets a hub on one machine bring a
> course up on another, guarded the way `/switch` is: only a sibling directory that server already
> discovered, so no path from a request reaches the filesystem. The record carries the host beside
> the course, and the follower treats a named machine as **rule 0** — above every preference, but
> only among boards serving the course that was chosen too, because a named host must not let a
> board that is merely up over there take the address off a lesson somebody is in. `test/hub.js`
> drives the row and the tap; `test/choice.py` holds the rest. Shell version `board-shell-v66`.
>
> **And then the follower was deciding from a file nobody writes to.** With everything above in
> place the address still would not move: both machines' boards published `chosen: Galois-Theory`,
> the Mac's own Galois board was up with a tutor listening, and the address served Probability for
> ten minutes. The follower reads that record off disk, and it is not always the same disk view a
> board has — it is started by launchd with whatever environment launchd hands it, and the boards
> are started from a session. It now takes the newest of three: its own copy, what a board **on
> this machine** publishes, and what a board on the other one publishes. Asking something that
> definitely wrote the record beats reading a file and hoping.
>
> **And the half that made the rest of it useless.** With both walls down the follower found the
> other machine's *board* through the peer walk — and then asked the **configured hostname** what
> had been chosen, because that is a different function and I had only fixed one of them. So a tap
> on the far machine was recorded, published in its `/health`, correct in every way, and
> invisible: the address stayed put while both machines said plainly that somebody had asked for
> the other course. Reproduced by driving the real `/switch` and watching for thirty seconds. The
> choice is now read from whoever answers, the walk is bounded (four courses a machine, the last
> one that answered asked first, phones skipped entirely — three iPads on this tailnet would have
> made a tick take a minute), and both machines probe through one implementation instead of two.
>
> **And reaching, which is the same wall from the other side.** A machine in userspace mode cannot
> open a tailnet connection either: from the compute node, the address does not resolve and the
> Mac's IP has no route — both measured. The launcher has always started tailscaled with
> `--socks5-server=localhost:1055`, and nothing ever used it. A health probe now falls back to
> that proxy, so the node can ask the Mac what it is serving instead of assuming nobody is there —
> which is how a second board and a second tutor for one course were getting started. Never for
> loopback, where a proxy cannot help and would only let a test's make-believe ports leak onto the
> real tailnet.
>
> **The measurement that settled it, and the mechanism that actually works.** Binding the tailnet
> address is the obvious fix and it fails on the one machine that matters: a compute node without
> administrator rights runs tailscaled in *userspace* mode, where the address exists and no
> interface carries it — `bind()` returns "cannot assign requested address". `tailscale serve
> --tcp <porttcp://127.0.0.1:<port>` is the mechanism that works in both modes: tailscaled accepts
> the connection on the tailnet itself and forwards it to loopback. Every board publishes itself
> that way on start and takes it down on stop, on its own port, so a course is reachable from the
> other machine at the same number it uses here and nothing has to be published anywhere for
> `locate_course` to find it.
>
> **And the reason switching could never have worked, which was underneath all of it: a board only
> ever listened on loopback.** Deliberately -- there is no authentication here and the university
> LAN is not somewhere to put an unauthenticated page -- and the consequence went unseen for a
> week. The always-on host's follower decides where the address points by probing the compute
> node's ports; every one of those probes was refused by a socket bound to `127.0.0.1`. So the
> address could only ever land on a board **the Mac itself was running**, whatever the record
> said, and no amount of correct arbitration on top of that could move it. Measured, not
> theorised: from the node, `board.tail0c6c62.ts.net` answers on no course port, and neither does
> this machine's own tailscale address.
>
> A board now binds its tailscale address as well as loopback -- the tailnet, not the LAN, which
> is the same trust boundary the iPad already crosses to read the lesson. And the follower no
> longer looks for the far side at one hostname out of a config file: a compute node's name is an
> allocation (`compute302` today, something else last week), so when that name goes stale the
> follower can see nothing but itself, for ever. It asks the tailnet who is up and knocks on all
> of them; a course's ports are derived from its name, so nothing has to be published for that to
> work.
>
> The tap was corrected in the same pass. Deciding what to start by the machine's ROLE was wrong
> in the one way that matters -- if the other machine cannot be reached, a tap did nothing at all
> and the course could not be opened from anywhere. It probes instead: if something is already
> serving that course, record the choice and let the follower point at it; if nothing is, start it
> here. `test/address.py`, `test/choice.py`.
>
> **A tap in the hub started a second board and a second tutor, and then fought the follower for
> the address.** This is the one that made an evening unusable, and every symptom of it was
> reported at once: *"Every time I try to tap on Probability I get bumped back to Galois Theory...
> And NOW suddenly it bumped me to Probability and I can't get back."*
>
> `/switch` did three things on whichever machine happened to serve the hub: started the course's
> board **here**, took the tailnet name for it **here** with `vpn serve`, and started a tutor for
> it **here**. On one machine that is exactly right. On two it is the cause of all of it — a board
> for one course on each machine, so the follower had a choice to make that should never have
> existed; **two tutors on one lesson**, both blocked on the same inbox, both answering every
> message (that evening's own handoff says it: *"Two headless sessions have been firing on the
> same inbox messages all evening, and the other one is unreliable"* — cards contradicting each
> other, a chapter archived mid-exercise by the run that was not teaching); and a tug-of-war over
> the name, `vpn serve` pointing it here while the follower pointed it back, every tick.
>
> Now: the tap records the choice — always, because on a pair of machines that record is the only
> thing both can read — and then does nothing else unless this machine owns its own name or
> already serves that course. The follower places the address, which is its job. A board also
> publishes whether it has a tutor at all, and the follower prefers a board with one over an empty
> room with the same claim. `test/choice.py`.
>
> **Every course's board state was wiped at the student's request**, in one commit per repository:
> cards, turns, ink, answers, archived lessons, inboxes and handoffs. The written-up work is
> untouched — `chapters/`, the homework `.tex` and `.pdf`, the filed handwriting and the readings
> are all outside `live/`. Nothing is destroyed; it is a commit, and the history has all of it.
>
> **"My writing didn't get saved when a new board came up."** Two things were behind that, and
> only one of them was a bug.
>
> The bug is in the slate and it is the important one. A save built its body from `current` at the
> moment the request went out, and the queue behind it carried *whichever page was in hand when
> the wire freed up*. That was harmless while the only way to change page was somebody tapping the
> page controls — and it stopped being harmless the moment the board started moving the page **by
> itself**, which is exactly what an attempt freezing and its successor opening is. Switch pages
> while a save is in flight and the page being left had nothing to carry its last strokes: the
> queued save wrote the new page instead, and the old one kept whatever it had the time before.
> Saves are addressed to a page by number now, `dirtyPages` is the queue and remembers *which*
> pages are owed, and a page is only marked clean if that page did not change while its save was
> in the air. `test/plane.js` drives it against a save held open on the wire — page left, page
> written, save released — and the old code fails it by writing page 2 with nothing on it. The
> board also refuses to cut a new attempt while a pen is on the glass: a page that moves mid-word
> takes the rest of the word with it.
>
> The second thing is not a bug and is the one that was actually reported. The tutor's follow-up
> was a **question** card — "contrapositive or contradiction, which is this?" — and a question
> card is a new question, so it got a board of its own, blank. Right for a new exercise, wrong
> three cards into one, where the proof being asked about is on the board above. The board cannot
> tell those two apart, and guessing is worse than asking: a new exercise opened on a copy of the
> last one is somebody else's proof under your pen, and every board after it carries every stroke
> of the evening. So a blank board with working behind it offers **↴ carry over from question
> NNNN**, on the live surface and on the dormant ones alike; one tap copies that page here and the
> two go their own ways from there. Nothing was lost either way — the 180 strokes were on the
> board above the whole time. `test/chain.js`.
>
> Shell version `board-shell-v65`.
>
> **The tutor's thinking reached the board again, and this time there was nothing to strip.**
> Reported from the same Galois sitting five days after the first one: a card that was eight
> hundred tokens of *"I need to read the student's response... Hmm, wait. Let me re-read the
> question... Actually, I think"*, cut off mid-sentence at the token ceiling. No `<think>`, no
> harmony channel, no brackets — a model deliberating in plain prose in `content`. Every
> tag-shaped gate in `tutorboard.reasoning` looked straight through it, `bin/free` tried twice, got the same
> shape twice, and then wrote whatever it had.
>
> So the second question is asked of **voice** rather than syntax: is this text addressed *to* the
> student, or *about* them? A card speaks to somebody — "take $G = S_4$", "tell me which is
> which". Deliberation talks about the student in the third person, argues with itself, and
> addresses nobody at all. `tutorboard.reasoning.reads_as_reasoning` is that test, and what everything does
> with it is **refuse**, because there is nothing to remove when the whole reply is the thought:
> the free chain passes over a model that deliberates and tries the next one, `board write` writes
> nothing and says why, and the readers — the board, the recap the tutor reads its own lesson back
> through, and the export — put one line in place of a card that reached disk some other way. **A
> card that never appears is a wait; a monologue that appears is the lesson.**
>
> **The part worth keeping when you change it:** the discriminator is that a card has somebody it
> is talking to. Without it, a lesson *about* how reasoning models work — which will say "the
> student", and "wait", and "actually" — gets refused, and refusing a real card mid-lesson is its
> own kind of damage. It is calibrated against every card in every course on this machine —
> eighty-nine of them, the leak caught, none of the rest touched — and `test/reasoning.py` carries
> the real card and four real lessons as fixtures.
>
> **And the third gate is new for a reason:** `board write` was never the only door. The session
> brief tells an interactive tutor to write its card into `live/cards/` itself, so an agent with
> file tools bypasses both writing gates entirely. That one is closed at the reading end, where it
> cannot be bypassed by whoever wrote the file.
>
> **And the lesson can now leave the board as a document.** Asked for in the same sitting: the
> whole tutor-and-student conversation as one PDF to show a professor, tracked in git, and
> numbered rather than stamped with the time -- "that'll be an eyesore". `board export`, and **⋯ →
> export this lesson** on the iPad, writes `transcripts/<lesson>-v1.pdf` and counts up from there;
> `--all` puts every filed lesson and the open one into a single document with a contents page.
>
> What it exports is both halves. The old `board export` wrote the tutor's cards alone, with a
> timestamp for a name, into a directory the course's `.gitignore` throws away -- a record of half
> a conversation that nobody can find and nothing keeps. It now interleaves every page that was
> handed in, as the picture that was actually sent, labelled with which attempt it is, in the
> order the board itself reads them. Written up under [Exporting the whole
> conversation](#exporting-the-whole-conversation); `document.py` owns it and `test/document.py`
> holds it, including a real LaTeX run wherever there is a LaTeX.
>
> **Two things that will bite somebody and are worth knowing.** A model writes prose with arrows
> and Greek in it, and every one of those characters is a *fatal* error to pdflatex rather than a
> warning -- the first real lesson this was pointed at died on the down arrow in the word “save”.
> Known characters are mapped to the command that draws them and the rest are dropped, because a
> missing glyph beats no document. And a course's own `coursemacros.sty` loads hyperref its own
> way, so the export loads graphicx, xcolor and hyperref *after* it and with no options: an option
> clash is also fatal.
>
> **Not verified, and only the device can settle it:** whether a ten-attempt exercise reads well
> as ten full-page images, and how long a whole-course export takes on the Mac with an evening's
> worth of handwriting in it. Shell version `board-shell-v64`.
>
> **Then the boards within one exercise, which is the same ask one level down.** With the pages
> adopted again, the report was that boards persist between questions and not inside one: write,
> hand it in, read the reply, and the board under the reply is the same board — so nothing is kept
> of the attempt it replaced. A question had exactly one board; there was never a second one to
> keep.
>
> A question is a chain now, one board per attempt. A board freezes where it was written as soon
> as two things are true of it — what it holds has been handed in, and the tutor has written
> something since — and the next attempt opens on a **copy** of it. Both halves of that condition
> matter: freezing on the send alone would fork the page every time somebody pressed Send to check
> their working, and freezing on any card at all would cut a board for a hint about working nobody
> has sent. The copy is what makes *all my prior work is on it* and *independent of each other*
> true at once. Every board keeps the card it sits under, so a reload puts it back where it was,
> and each says which attempt it is. `test/chain.js`, and the invariant is in
> `AI_INSTRUCTIONS.md`. Shell version `board-shell-v63`.
>
> **What only the device can settle:** an exercise worked over four or five attempts now holds
> four or five pages where it held one, each a copy of the last plus what was added — more disk,
> more photographs on screen, and iPadOS still does not report a canvas budget so much as act on
> it. The boards are pictures rather than surfaces, which is the whole reason that is affordable,
> but nobody has yet scrolled a long exercise built this way.
>
> **Every past board was blank, and an evening's working was not on the surface at all.** Reported
> from a Galois sitting on the Mac mini. Nothing was lost — the pages were on disk, saving
> normally — but the surface never took them, so every dormant board was a photograph of a blank
> sheet and every question read as work that had gone missing.
>
> The cause is the 31 August fix, undone by the order of two statements. `settled()` exists to
> tell the board that the page count can be believed; it ran before the saved pages were adopted.
> The board believed a count of one, ruled the question it was on to be filed past the end, and
> cut a fresh page — and the adoption guard was `pages.length === 1`, so cutting that page is what
> made the sitting unadoptable. A blank sheet refused an evening. Worse than the display: the next
> stroke saved that blank page to disk under its new number, over a real one.
>
> Three things, because one of them is not enough on its own: the board is told last, adoption now
> asks whether any page carries INK rather than counting sheets, and the question-to-page mapping
> — which lives in localStorage, where nothing can tell a stale entry from a live one — is
> repaired from the server's own record of the page each answer was sent from. That last one is
> what brings an already-damaged evening back, and it only overrules an entry that is already
> untrustworthy: absent, past the end, sharing a sheet, or pointing at a blank page.
> `test/adopt.js`. Shell version `board-shell-v62`.
>
> ### Where this is right now, 31 August 2026
>
> **And then the other half of it, which is why switching courses never felt reliable.** Stopping the
> machinery from writing a choice was necessary and not sufficient: the follower's arbitration had no
> notion of a *claim*. `remote_target` returned "a board on the node" without saying whether it was
> the course anybody had chosen or merely the one that answered, and `choose_target` then handed that
> to `prefer` and the allowance rule as though it were a tie between two equals. It was not a tie. A
> Probability board on the compute node, teaching nobody, took the address off a Galois lesson that
> was mid-proof on the machine holding the repository.
>
> Both targets now carry an `exact` flag, and there is a rule above preference and above the
> allowance: **a board serving the course that was chosen beats one that is not, on either machine.**
> Preference goes back to breaking ties between two boards with an equal claim, which is all it was
> ever for. The allowance ordering is untouched — it decides between two machines serving the *same*
> chosen course — and it deliberately cannot demote a machine to a course nobody asked for, because a
> limited board still shows the lesson and only new turns fail.
>
> The second defect was underneath it. The choice is recorded on whichever machine served the hub
> when the course was tapped, so there are two records and they disagree by design — and the follower
> read only its own. A course tapped in a hub served by the *other* machine was recorded over there,
> invisible here, and the address stayed put. `/health` now publishes `at` alongside the choice, and
> `wanted_course` takes the newer of the two records. A machine too old to publish `at` reads as
> ancient rather than as now, so an old name can never drag anybody off a live lesson.
> `test/choice.py` holds all of it, including the exact shape of the evening that produced it.
>
> **A refresh dropped somebody into another course, and the hub could not get them out.** Reported
> mid-Galois: a refresh opened Probability, and tapping Galois Theory did nothing — Probability came
> straight back. One defect, two symptoms, and it is the 28 August defect (*the tailnet name went to
> whichever course came last*) returned through a door nobody was watching.
>
> `agent_start` spawns `tutor headless <course>`, and that command recorded a course choice — the
> record whose entire purpose is to say *a person asked for this*, because it cannot be derived from
> the filesystem. But every caller of `agent_start` is machinery: the login hook, the periodic
> `tool-pull`, and `tutor restart --tutors` after a ship, which calls it in a **loop** over the
> courses on the machine. So each tick wrote down whichever course the loop finished on. Then
> `tutor resume` reads that record to decide what to bring back — so the wrong course re-elected
> itself, for ever, and a tap in the hub survived only until the next tick.
>
> **The pattern, again, and it is worth naming precisely this time:** not a rule with no way to
> expire, but *a derivation wearing a decision's clothes*. `remember_course`'s own docstring says
> the record exists because "resuming a course touches its files too, so most recently used is
> self-reinforcing" — and the fix for that was defeated by letting the resume write the record
> instead of the file. When you add a caller to something that records intent, ask whether that
> caller is a person. Machinery now spawns with `--respawn` and records nothing; `tutor agent start`
> and the hub tap record it themselves, because those are somebody naming a course. `test/choice.py`.
>
> This one was self-inflicted in the most literal way available: the ship above is what moved the
> address off the Galois lesson that reported the bug above it. **Check the address after every
> ship** is written three paragraphs from the top of this file for a reason.
>
> **The tutor's own thinking was on the board, and it was the whole card.** Reported from a Galois
> sitting on the Mac mini: a turn came back as the model's private deliberation rather than a lesson.
> The Mac is the one machine that can produce it — it holds the address, so when its allowance runs
> out and no compute node takes the lesson over within `takeover_grace`, it falls back to `free`, and
> every model on that free chain reasons before it answers. `bin/free` took `message.content` and used
> it whole. Two gates now: the chain is asked not to send reasoning at all (OpenRouter's exclude,
> Groq's hidden format, dropped and retried bare on a 400), and every reply goes through
> `tutorboard.reasoning.strip_reasoning` regardless, because a free endpoint ignoring a parameter it does not
> implement is the exact shape of this bug. `board write` strips again on the way in — only a block
> the card *opens* with, since a lesson about reasoning models may say the word in earnest — so an
> agent this repository has never heard of is covered too.
>
> **The second half is the one worth reading.** The thought was not merely *in front of* the card, it
> *was* the card, and that was a separate defect: `card_markdown`'s front-matter regex was anchored at
> position zero, so a reply with anything before the opening `---` missed the parse entirely and fell
> through to the branch that makes the whole reply the body. **The pattern this repository keeps
> relearning, in a new coat: a fallback whose failure mode is wider than the case it was written for.**
> A missing title was what that branch was for; an entire leaked monologue is what it delivered.
> The OCR reply and the cached `live/.brief` go through the same strip — the brief because a poisoned
> cache outlives the turn that wrote it and would have gone on feeding thinking to every later turn
> until a source file happened to change. `test/reasoning.py`.
>
> **A finished homework sheet can now be compiled by the tutor that wrote it**, which
> it could not be on the machine that mattered. Reported from the board at the end of a
> sitting: six problems written up, agreed and pushed, and a `.tex` nobody holding an iPad
> could turn into a PDF. The tutor's own account was that it lacked permission, and it was
> half right — the course's `.claude/settings.local.json` is written the first time its
> board starts and, until today, never touched again, so a course created before a grant
> existed was never going to get it. The other half was quieter: `board hw build` ran the
> course's `scripts/build.sh` with whatever `PATH` the board process had, and that script
> looks for TinyTeX's *Linux* directory, which the Mac does not have. Both are in the
> defect table. The grant now covers `pdflatex`, `latexmk` and the course's build script;
> `install_permissions` tops an existing file up rather than skipping it, appending only
> what is missing so a course's own list survives; and the build runs under
> `tutorboard.tex.tex_env()`, which already knew where every TeX on either machine lives.
> A failed build also stops saying `FAILED` and nothing else. `TEACHING.md` now says
> plainly that compiling is the tutor's job and that it is allowed to do it, because one
> refused command had been enough to convince it otherwise.
>
> **Test review shipped today.** A third kind of sitting, beside lecture and homework, for revising
> for a paper: the badge offers *test review*, that opens a picker of every chapter the course has,
> and starting one wakes the tutor over exactly the chapters ticked. It teaches in the homework
> shape — state the question, they write it, it comes back with the break located — and produces no
> document, because nothing is being handed in. A code project has no chapters and is offered its
> own top-level parts instead. Written up under
> [Test review](#test-review--revising-for-a-paper); `review.py` owns the discovery and the scope,
> `test/review.py` and `test/review.js` hold it.
>
> **Two defects from an evening of homework, both about going back up the
> lesson.** Reported in one message: earlier answers showed as "an unchangeable
> picture of my response" with no board under them, and the *type* tab did
> nothing. Both are in the defect table. The first was the boards being tied to
> whether an answer was owed — the tutor marks a problem right, and every board
> on the page goes with it; they are painted for the whole live lesson now, and
> touching one still makes it the live surface on that question's own page. The
> second was `panelKind` letting the question's history outrank the tab that was
> just pressed.
>
> **And then the frozen submission itself went, which was the actual ask.** The
> first fix put a live board under every question and left the frozen picture
> where it was, so the answer appeared twice — that is not what was wanted. An
> ink answer is now shown by its board and nothing else: the turn keeps its
> heading and one line pointing down at the working. The picture is still written
> per revision into `live/answers/` and still comes back wherever there is no
> board to show it. The invariant in `AI_INSTRUCTIONS.md` was rewritten rather
> than quietly broken — read it before restoring the old behaviour, because the
> reasoning it used to carry has genuinely expired. Shell version
> `board-shell-v57`.
>
> **Then the page mapping, which was quietly broken the whole time**, and a
> homework skip that dropped the problem. Both in the defect table. The first is
> the one worth reading: the surface is usable before `/slate/state` answers, and
> for that half-second its page count is a lie the board was acting on — so a
> reload refiled question after question onto page 0 and the mapping to an
> evening's working was overwritten. It looked like a feature, because the
> accident was continuity. The second is a method change as much as a code one:
> `TEACHING.md` now separates the two things a skip can mean, and a homework
> sitting writes its document in the sheet's order however the student works it.
> Shell version `board-shell-v58`.
>
> **And then a question with nowhere to answer it**, which is the worst state
> this board has and was mine, from the change three commits earlier. Making the
> boards reachable made `workingOn` reachable, and `workingOn` had no way to
> expire — so going back to an earlier question pinned the live surface there for
> the rest of the sitting. **The pattern this repository keeps relearning, again:
> a rule with no way to expire.** It is in the defect table twice over now, once
> for palm rejection and once for this. When you add a rule that changes where
> input goes, ask what clears it. Shell version `board-shell-v59`.
>
> **Then every past board read as empty**, and the working looked lost. It was
> not: 537 strokes on disk, still saving. The boards were photographs of the
> blank top of a page whose writing started two-thirds of the way down it —
> because the surface is a plane and a page grows downward as you work it, while
> `fitPage` had always parked at the top of the nominal box. Fixed for the live
> surface and the photographs together, since they are meant to frame a page
> identically. A blank board also now says it is blank, because an empty board
> captioned like a full one is what made this read as data loss in the first
> place. Shell version `board-shell-v60`.
>
> **Two boards were one sheet**, and there is now a second re-centre button. The
> first is the last of the page-per-question defects: `fresh()` reuses a trailing
> blank page, which is correct until two questions reach it before either is
> written on, and then writing on one board changes the other. The board now
> refuses a page another question owns, and repairs an existing pair by giving
> the later question a copy. The second is asked for rather than broken: there
> are two zooms on this page — the browser's and the surface's — and only the
> browser's had a way back that a pinch could not take off the glass. `#findink`
> rides under `#panic`, appears while the surface does, and puts the view over
> the writing. Shell version `board-shell-v61`.
>
> **What only the device can settle about it:** the writing surface is now built
> on a lesson where nothing is owed — it has to be, because every dormant board
> is a picture drawn from its pages — so a finished sitting holds one hidden
> surface plus a photograph per question, where it used to hold none of either.
> That is the same count an active lesson has always held, but it now persists
> after the last answer is marked right, and jsdom has no canvas backend to say
> whether it feels like anything. Watch for a blank board or the app reloading,
> which is what iPadOS does instead of reporting a canvas budget.
>
> **The board now pulls itself, on both machines.** Reported from the compute node: a shipped fix
> had to be `git pull`-ed there by hand, which was supposed to have stopped being true when the
> login hook went in. It never was true — the hook runs `tutor resume`, and `resume` pulled the
> *course* and never the tool. `tutor` and `tutor resume` now fast-forward this repository as well,
> re-exec onto what arrived, and then run `tutor restart --tutors`; `scripts/tool-pull.sh` on the
> Mac does the same rather than bouncing only the proxy, which is what had left the always-on
> host's own boards serving old code after every pull. Under
> [Every session starts by catching up](#every-session-starts-by-catching-up), guarded by
> `test/resume.py`. **The one thing to know about it:** the node has to be pulled by hand *once
> more*, because the version of the launcher that would do it for you is the one being installed.
>
> Two things came out of screenshotting it, and both are in the defect table: the contents drawer
> had never actually been a drawer (an empty `#contents { }` rule under a comment claiming it
> borrowed the scratch drawer's), and `TEST REVIEW` in the badge was wide enough to squeeze the
> chapter label and the tutor chip out of the title bar — the badge says `REVIEW` and the strip
> underneath carries the rest.
>
> **Not verified, and only a person with the hardware can settle it:** whether a twenty-chapter
> picker is comfortable to tick on an iPad with a pen in the other hand, and whether a review turn
> actually reads the way it is written — no tutor has run one. The scope reaches the prompt and the
> prompt says the right things; what a model does with it is the untested half.
>
> **One more thing worth someone's attention, not fixed here:** at iPad-portrait width the tutor
> chip is squeezed out of the title bar entirely, in a plain lecture as much as in a review. The
> invariant says that chip is never hidden. It is a flex-shrink in `.bar-left` and it predates this
> change, so it is not in it.
>
> ### Where this was, 30 August 2026
>
> The Mac mini exists, and the always-on path described under
> [Always-on](#always-on-with-the-machine-that-holds-the-repository-preferred) is running for the first time: the Mac
> holds `board` on the tailnet and proxies to the compute node, which now keeps its own name.
> Four defects came out of the first evening of two machines, and every one of them was invisible
> from the compute node alone:
>
> - **A board holds old code, and so does the proxy.** The running board predated `/handover` and
>   answered `not found`; the Mac's follower would have gone on running a stale `bin/follow` after
>   a pull, because the pull agent restarted nothing. `scripts/tool-pull.sh` now restarts the
>   follower when the pull moves HEAD, and `--always-on` installs it.
> - **The proxy picked a course by alphabet.** Two boards up meant the address was pinned to
>   whichever sorted first, for ever; tapping a course in the hub did every correct thing and
>   changed nothing visible. The choice is now recorded and published — see
>   [Which course the address opens](#which-course-the-address-opens).
> - **Two courses hashed to one port.** `Mathematical-Modeling` and `Research-Journey` both wanted
>   8786, and the second to start failed to come up with the reason four lines into a log nobody
>   opens. A name now maps to a sequence of ports, and a board says who it is so a shared number
>   can never become a shared lesson.
> - **A chapter title ran off its card.** The hub's course rows were one nowrap flex line with the
>   metadata pushed right; anything as long as a real chapter title went straight through the
>   border. Rows are two stacked lines now, and only the word *live* is coloured.
>
> Assistants are no longer exclusive: every course keeps its own, because an idle one is blocked on
> `board wait` and costs nothing, while a cold one costs a re-read of the contract, the method and
> the lesson. New suites: `test/choice.py` (the address follows the choice, and ports do not
> collide) and `test/hub.js` (the course list stays inside its card).
>
> **The one thing this pair of machines will keep teaching you:** a fix is not shipped until the
> process holding the old code has been restarted — and on the always-on host that is three
> processes, not one. Check what is actually being served before theorising about why a fix did not
> land.
>
> ### Where this was, end of 28 August 2026
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
bash scripts/catch-up.sh   # put this machine right, and say what is true
bash scripts/stay-current.sh  # ...and keep doing that, without anybody here
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
- *macOS.* The platform paths in `tutorboard/`, `bootstrap.sh` and the LaunchAgent are written from
  documentation, not from a Mac.
- *Headless mode.* `tutor headless` has never been run against a real agent end to end. The
  `headless` recipes in the config are best guesses at each tool's non-interactive flags. The
  wrap-up turn that writes `HANDOFF.md` rides on that path and is equally unexercised.
- *What a usage limit actually prints.* The phrases in `usage_limit_says` are what the default
  agent is documented to say, not text anyone here has watched it emit. Everything downstream of
  the match is under test; the match itself is only confirmed the first time an allowance really
  runs out. If it turns out to say something else, that is one list in the config and no code —
  and the failure mode of a miss is the old behaviour, a turn that failed, rather than anything new.
- *Always-on hosting.* There is no machine that is awake when the cluster allocation is not, so
  the iPad can only reach a board while a session is already running somewhere. The plan for
  fixing that is written up under
  [Not yet built](#always-on-with-the-machine-that-holds-the-repository-preferred) and is waiting on a
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
| A headless tutor was refused the card write it was woken to make, and exited 0 — the board showed silence | `test/agents.py`, and `board start` writes the course's permissions |
| The machine renamed itself from the network mid-session, so a running board became another node's and could not be restarted | `test/node.py` |
| The proxy moved the address off a live compute node without asking it to wrap up, stranding a tutor that went on teaching into a copy nobody could reach | `test/choice.py` |
| A restart brought back the tutor that was running rather than the one the config named, so a changed default never reached a course | `test/agents.py` |
| The default agent's command was not installed, so the daemon read as *listening* and failed every turn into a log | `test/agents.py` |
| A board whose node had died read as a tutor who had not written yet — same words, and a dot the size of a full stop for a difference | `test/link.js` |
| `board net` re-pointed the HTTPS name at a dead port, trusting a stale record from another node | `alive()` in `cmd_net` |
| An empty maths board could not be answered, asked, or prodded from the iPad at all: the first turn needed a terminal | `test/begin.py` |
| A writing prompt could not be declined, so an unwanted exercise had to be answered badly to clear it | `test/modes.js` |
| The writing surface vanished after closing and reopening the app: it survived a send only through an in-memory pin, and a pin is a variable | `test/link.js`, `test/modes.js` |
| The contents drawer laid out in the flow of the page under the lesson rather than over it: it carried a comment saying it borrowed the scratch drawer and an empty rule that borrowed nothing, because an ID selector is not inheritance | `test/review.js` |
| A sitting badge reading `TEST REVIEW` pushed the chapter label to `Tes…` and the tutor chip to `no` — the title bar is the one row on this page that cannot grow | `test/review.js` |
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
| A board that was merely running captured the one address off a machine mid-lesson: the follower weighed "the board serving the chosen course" and "some board that answered over there" as if they were the same kind of claim, so `prefer` and the allowance rule decided between a lesson and a stranger | `test/choice.py` |
| A course tapped in a hub served by the other machine recorded the choice *over there*, where the follower never read it — the tap started the board, moved nothing, and looked broken | `test/choice.py`, and `/health` now publishes when the choice was made |
| A refresh landed in another course, and tapping the right one in the hub changed nothing: `agent_start` spawns `tutor headless <course>`, which recorded a *person's* course choice — and its callers are all timers, one of which loops over every course, so each tick handed the address to whichever course the loop finished on, and `tutor resume` then re-elected it from the record it had just written | `test/choice.py` |
| The tutor's own thinking was written onto the board as the lesson: the free chain's models reason in the first person about the student, and the reply was taken from `message.content` and used whole | `test/reasoning.py`, and `tutorboard.reasoning.strip_reasoning` on the wire and again at `board write` |
| And it was the whole card rather than a preamble to it, because the front-matter parser was anchored at position zero — anything in front of the opening `---` sent the reply down the branch that makes the entire text the body | `test/reasoning.py` |
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
| Writing on an earlier board changed a later one. They were not two boards showing similar things; they were the same sheet. `fresh()` hands back a trailing *blank* page rather than cutting a new one every time — right, or every question leaves an empty page behind it — but two questions that reach it before either is written on both get that index, and from then on one page has two boards over it. The slate cannot see the collision: it deals in ink, not in questions | the board refuses a page another question owns, and a question already sharing one takes a copy of it — so nothing vanishes off the screen and the two go their own ways from there; `test/feedback.js` |
| Every past board read as empty and the working looked lost. Nothing was lost — the page held 537 strokes and was still saving. The surface is a plane: you pan down and carry on, the page box grows, and on a real evening's page the ink began 769 units down a box 1514 tall. `fitPage` parked the view at the top of the box, "where the writing begins", which is true of a fresh page and false of every page anyone has worked down — so opening it showed blank paper with the working below the fold, and a dormant board, being a photograph with nobody to pan it, showed the blank paper and nothing else | opening a page frames its ink, at the same page-width zoom so nothing is resized; the preview does the same, being a picture of the same page; `test/plane.js` records the transform, there being no other way to ask where a drawing looked |
| A question was posed with nowhere to answer it: a preliminary marked right, the real problem asked, and no board. Going back to an earlier question pins the live surface there and nothing cleared the pin — `workingOn` was set by touching a board and outlived everything, the tutor asking something new included. The new question found the surface parked several cards above it, and having never been written on it had no page, and a question with no page drew no board at all. Both halves were mine, shipped the same evening the boards became reachable enough for anyone to hit them | a new question ends the excursion, the rule `reopenedFor` already had; and a question with no page shows a blank board rather than nothing; `test/feedback.js` |
| A new board for the same question came up blank, and an evening's working ended up on one sheet with the mapping to it destroyed. `Slate.create` hands back ONE blank page synchronously — deliberately, so a stroke made before the network answers is not lost — and adopts the saved pages when `/slate/state` arrives. The board read that count to decide which page a question belongs on, so a question recorded against page 3 looked like one recorded past the end: its page was ruled gone, a fresh one was cut, and *that* was written down. Every reload refiled another question onto page 0. Nothing a person could see was lost, which is why it survived — the accident looked like continuity | `api.ready()` and the `onPages` callback; the board files nothing against a page count it has been told not to believe, and is called the moment the real one lands; `test/feedback.js` |
| And then that fix was defeated by its own ordering, which cost the whole sitting rather than one mapping. `settled()` — the call whose entire job is to say *the page count can be believed now* — ran as the FIRST statement of the `/slate/state` handler, before the saved pages were adopted. So the board was told to believe a count of one, judged the question it was on to be recorded past the end, cut a fresh page for it, and by cutting it pushed the length to two. The adoption guard was `pages.length === 1`. It no longer held, so an evening on disk was refused in silence: every past board a blank photograph, and the next stroke saved a blank sheet over a real page under its new number. **The pattern, in a new coat: a guard written against the only thing that could break it at the time it was written** | the board is told last, once the pages are actually in; adoption asks whether any page has INK rather than how many sheets there are, so nothing blank can refuse a sitting; and the mapping is repaired from the page each answer records having been sent from, which is the one authority a browser cannot rot; `test/adopt.js` |
| Only one board per question ever existed, so within an exercise the earlier attempts did not persist: you write, hand it in, the tutor replies, and the board that "appeared" under the reply was the same board slid down the run. Reported as "the previous board for this same question that I have not yet completed doesn't persist... I want ALL boards to persist and to operate independently of each other" | a question is a chain, one board per attempt: frozen where it was written as soon as what it holds has been handed in AND the tutor has answered since — both halves, or Send forks the page under your hand and a second hint cuts a board about nothing — and the next attempt opens on a COPY, which is the only way the working carries forward and the two are still independent; `test/chain.js` |
| `board export` wrote the tutor's cards and nothing else, named with the second it happened, into `live/export/` -- which a course's `.gitignore` throws away. Half a conversation, unfindable, unkept. Asked for instead: the whole thing as one PDF to show a professor | `document.py` interleaves every card and every page handed in, in the board's own reading order and labelled by attempt; it lands in `transcripts/<lesson>-vN.pdf`, is staged in git, and `--all` makes one document of the whole course; `test/document.py` |
| A card arrived that was the model thinking out loud, with no tag anywhere in it -- the whole reply was the thought, so every strip in `tutorboard.reasoning` passed it through and `bin/free` wrote it after two attempts came back the same way. Eight hundred tokens of deliberation, cut off mid-sentence, as the lesson | `reads_as_reasoning` judges voice rather than syntax -- a card is addressed to somebody, deliberation is about them -- and every caller refuses rather than edits: the chain tries the next model, `board write` writes nothing, and the board, the recap and the export show a notice in place of a card that got to disk another way; `test/reasoning.py` |
| A save was addressed to "the current page", not to a page. A queued save therefore carried whichever page was in hand when the wire freed up — so switching page while one was in flight left the page being LEFT with an older version of itself on disk. Invisible until the board began switching pages on its own, and then it was ink lost | saves carry a page number, `dirtyPages` remembers which pages are owed, and a page is cleaned only if it did not change while its save was in the air; `test/plane.js` holds a save open on the wire and checks what the queue does with it |
| A follow-up question landed on a blank board while the working it was asking about sat on the board above. Not a defect -- a question card is a new question and a new question gets a blank sheet -- but wrong in the middle of an exercise, and unguessable from a card kind | a blank board with working behind it offers to carry it over, one tap, as a copy; the person decides, because a new exercise opened on the last one's proof is worse than a blank sheet; `test/chain.js` |
| A skipped homework problem was dropped. One sentence told the tutor what a skip meant — "do not re-ask it, carry on" — which is right for a concept check and expensive for an assigned problem, where a skip is a lost mark and the student means *not now* | `skip_sense` reads the sitting: in homework the skip defers and names what is still owed, off the document rather than off anyone's memory; `homework.outstanding`, `board hw`, `test/begin.py`, `test/homework.py` |
| A written answer was shown twice: a frozen picture of the ink under the question, and the board carrying the same ink under the feedback — one of them dead, and the dead one was the one you met first scrolling back up. The freezing was right when the slate was ONE surface that got written over, because then the picture was the only copy of what had been handed in; it stopped being right when every question got a page that is never wiped | the board is the answer; the turn keeps its heading and one line pointing at it, and the picture returns wherever there is no board — a filed lesson, a past one, a browser that never held the page; `test/feedback.js`, `test/interactive.js` |
| Getting an exercise RIGHT deleted every writing board in the lesson. The boards were painted only while an answer was *owed*, and a `correct` card owes nothing — so finishing a problem left the transcript as frozen pictures of what had been sent, with no surface under any earlier question to add a line to. A picture is a record of an answer, not a place to write one | the boards are painted for the whole live lesson; the one question that goes without a picture is the one the real surface is sitting under; `test/feedback.js` |
| Pressing *type* did nothing on a question already answered in ink. `panelKind` read the question's history before anything else, and a sent ink turn answered "write" whatever the tabs were told — so the press set the remembered kind, repainted, and was overruled on the way back. Which is every question worth typing about: you write the proof, the tutor asks what you meant by a line of it, and the answer to that is a sentence | `pickedKind`, recorded against the question the tab was pressed on and read before the history — the same rule as `chosen.json`, that a decision outranks an inference; `test/feedback.js` |
| The compute node never pulled the board. Every session pulled the *course*, and the always-on host had a timer for the tool, but `--tool-pull` refuses to install one on a node — so the node ran whatever it was last pulled by hand, indefinitely, while the Mac moved on. And the timer that did run bounced only the proxy on purpose, so the Mac's own boards and tutors went on serving the old code after every pull: a fix reached the disk of both machines and the lesson of neither | `tutor` and `tutor resume` pull this repository, re-exec onto it, and then `tutor restart --tutors`; `scripts/tool-pull.sh` does the same; `test/resume.py` |
| ...and the first version of that fix could not say it had happened: `execve` throws away whatever is sitting in the process's buffers, and stdout is a pipe or a log file every time this runs for real — so the one line explaining why the board changed under somebody's lesson was dropped on the way out | a flush before the exec; `test/resume.py` drives a real clone and reads what it printed |
| A deploy dropped somebody mid-proof into a different course: starting a board claimed the tailnet name unconditionally, and `tutor restart` restarts every board on the machine one after another — so the address ended up wherever the course list happened to end. The installed app has one URL baked into it and no way to say which lesson it wanted | `ts_repoint` will not take a name from a board that is still answering; `board vpn serve` is the one command that does, because that is a person asking; `test/address.py` |
| An evening's homework was written up and could not be typeset. Two causes wearing one face. A course's `.claude/settings.local.json` was written the first time its board started and never touched again, so a course created before the LaTeX grant existed was never going to get it — and the tutor, refused the compiler, reasonably concluded the machine was the problem. Underneath that, `board hw build` handed the course's own `scripts/build.sh` whatever `PATH` the board process happened to have: that script prepends TinyTeX's *Linux* directory, and on the Mac, started by a login agent with `/usr/bin:/bin` and nothing else, there was no `pdflatex` to find. The sheet was complete and correct the whole time | the grant covers `pdflatex`, `latexmk`, the course's build script and the rest of the toolchain, and `install_permissions` now tops an existing file up instead of skipping it — appending only what is missing, so a course's own list survives intact; the build runs under `tutorboard.tex.tex_env()`, which already knew every place a TeX gets installed on either machine; `test/agents.py`, `test/homework.py` |
| **The pattern this repository keeps relearning, again: a rule with no way to expire.** "Only ever created, never edited" was written to protect a course's own permission list, and it did — while quietly guaranteeing that no course would ever receive a grant added after its first board start. A file that is only ever created is a file frozen at the moment the project understood the least about what it needed | anything that installs a file into a course has to have an answer to "and then what, in six weeks"; here it is a merge that only appends |
| `board hw build` printed the single word `FAILED` for an entire sitting while knowing more than that. The course's build script discards its own output by design, so on the one failure it could not explain — no compiler at all — it had nothing to pass on, and "failed" with no reason reads as a broken proof to the person who just wrote it | a failed build with nothing to say is given a reason: the missing compiler is named when that is what it is, and a silent script is named when it is not; the board shows it the way it shows a LaTeX error; `test/homework.py` |

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

The rule it all follows from: **a lesson is exercises, all the way down.** There
is no explaining step that stands on its own. Whatever would have been explained
is handed over as something to *do* — the tutor supplies the objects, a group of
order six, two polynomials, three candidate subgroups, and the student shows what
they are: is this one an example, which of these three is not, where exactly does
the second one fail. That showing *is* the teaching.

The shape, in a mathematics course:

1. **Read the section's exercises first.** They are the specification for the
   lesson; the prose is the means.
2. **Choose a manageable few** — three to five, sometimes two — and say in the
   opening card which ones and why each earned its place. Not all of them.
3. **For each in turn:** state the exercise in full, so the student can see what
   the work is for, then **ladder it** — one tiny thing to work themselves per
   idea the exercise actually needs, one per card, thirty seconds of writing
   each, and none at all for an idea it does not need. Two rungs is normal;
   five means the wrong exercise was chosen.
4. **Then put the exercise back in front of them**, restated in full — *now try
   4.12* is not a re-pose when it is eleven cards up a tablet — and ask for it,
   **with every definition it uses listed under it**, one line each. Nobody
   should have to scroll back up a lesson to find out what they are proving.
5. **Read what comes back.** A wrong answer gets its break located, not repaired.
6. **When the chosen set is done, offer more** as a question — the student
   answers, or taps **skip**, which means *move on*.

Any rung can be skipped, like any other prompt, and a student who skips every one
of them and goes straight to the exercise is using the board exactly as intended:
the ladder is scaffolding for an answer, and anyone who can reach without it
should.

Front-loading is the failure it exists to prevent: no chapter summary, no "here
is everything we will cover", no card that teaches for four paragraphs and asks
at the bottom. The measure of a sitting is how many exercises got answered.

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

It catches this machine up on the board and on the course, brings the link up, starts the board for
the course you were last in, re-points the tailnet name, and attaches a tutor. The first of those is
the reason the hook below matters as much as it does: nothing else pulls this repository on a
compute node, because nothing on one survives long enough to run a timer.

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

That appends a marked block to `~/.bashrc`, which the shared home puts on every node. It is what
keeps the node current: a fix shipped from the Mac is pulled, the launcher re-execs onto it, and
anything still running the old code is bounced — see
[Every session starts by catching up](#every-session-starts-by-catching-up). It runs in
**interactive shells only** — a login file that writes to stdout breaks `scp`, `sftp` and
git-over-ssh with a remote error nobody can read — takes a lock so five terminals do not race, and
backgrounds itself so no prompt ever waits on the network. `~/.tutor-resume.log` has whatever it
said; `export TUTOR_BOARD_NO_RESUME=1` turns it off for one shell.

This is a workaround for not having an always-on machine, not a substitute for one. It still means
the board is up only when you are logged in somewhere. The Mac mini design under
[Not yet built](#always-on-with-the-machine-that-holds-the-repository-preferred) is the real answer.

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
    "claude":   { "cmd": ["claude"],   "prompt": "argv",
                  "headless_first": ["claude", "-p", "{prompt}",
                                     "--permission-mode", "acceptEdits",
                                     "--allowedTools", "Bash(board *)"],
                  "headless":       ["claude", "-p", "{prompt}", "--continue",
                                     "--permission-mode", "acceptEdits",
                                     "--allowedTools", "Bash(board *)"] },
    "opencode": { "cmd": ["opencode"], "prompt": "argv" },
    "aider":    { "cmd": ["aider"],    "prompt": "none" },
    "free":     { "cmd": ["opencode"], "prompt": "argv", "raw_prompt": true }
  }
}
```

`cmd` is whatever launches it. `prompt: "argv"` appends the opening brief as a final argument;
`prompt: "none"` launches it bare and prints the one line to paste. Add an entry for anything that
runs in a terminal — nothing in the launcher knows which assistant it is starting.

**`claude` is the default.** Claude Code arrives with the course repository already in front of it,
which is most of a tutor: it reads the slate PNG itself rather than through a transcription model,
writes the card, and edits the course's own `.tex` when a homework sitting needs it. What it costs
is the ~38k-token tool prompt on every turn, which is the whole reason the next entry exists.

#### What a headless tutor is allowed to do, and where that is written

Headless there is nobody at a terminal, so nothing can be approved while a turn runs — and **a
refused tool is not an error.** The agent apologises into a log nobody opens and exits 0. A first
homework turn once read the assignment, composed the whole opening card, and ended having written
nothing.

That is settled in exactly one place: `board start` writes the course its own
`.claude/settings.local.json` (`TUTOR_PERMISSIONS` in `bin/board`) — `acceptEdits` for the files a
tutor writes, plus `board`, `pdftotext` and `pdfinfo`. It is only ever created, never edited, so a
course that has built up its own list keeps it, and it is a committed file the course's owner can
read and change.

It deliberately does **not** also appear as a flag on the agent's command. One policy written in two
places is one policy that drifts the first time either moves, and of the two the committed file is
the half anybody can actually see. `test/agents.py` holds both halves of that.

One entry is not a terminal agent at all: **`free`** is the built-in lightweight tutor. Its
headless turn is `bin/free`, a stdlib script that runs the lesson through `board recap`, OCRs the
student's handwriting with a free vision model, and writes one card as a plain completion over the
free-model chain (OpenRouter `:free`, then Groq). It exists because a general coding agent carries a
~38k-token tool prompt every turn, which exhausts the free tiers; a tutoring turn is three small
steps and this does exactly those. `raw_prompt` hands the script the raw inbox instead of the
instruction prompt, and its interactive `cmd` is opencode, so a person asking for a terminal
session still gets one.

It is no longer the default and it is not going anywhere: it is what a machine you want to run
without paying for a model runs, and it is selected like anything else — `--agent free`, a course's
`tutorboard.json`, or `hosts` and `default_agent` in this file. It is also the floor the whole
arrangement stands on. When the paid tutor's allowance runs out and no compute node can pick the
lesson up, this is what answers — see [when the allowance runs
out](#when-the-allowance-runs-out).

An agent is a command, and two machines do not have the same commands installed. Naming a
particular program as the default made that worth checking, so a start whose command is missing now
refuses and says which one, instead of leaving a daemon that reads as *listening* and fails every
turn into a log. `tutor --agents` marks what this machine cannot actually run.

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

**`fallback_agent` is not a fifth layer either.** The four above answer *which assistant this course
wants*; the fallback answers *what to do when the one it wants has nothing left to spend*. It is one
name — `free` by default, `null` to turn the whole thing off — and it is used only after a turn has
failed on a usage limit and no other machine has taken the lesson over. Nothing falls back from it,
which is the point of it being the free one.

### The assistant belongs to the course, not to the terminal

Each course keeps its own assistant, in its own repository, reading that repository's own
`AI_INSTRUCTIONS.md` and resolved by the table above. Switching course on the hub brings the new
course's board up and starts an assistant there if one is not already listening; it leaves the
others alone.

They used to be exclusive — starting one asked whatever was listening elsewhere to write its handoff
and go. That bought nothing. A listening daemon is blocked on `board wait` and spends nothing while
nobody is asking it anything, and the cost was paid on the way back: returning to a course meant a
cold assistant that had to re-read the contract, the method and the lesson before it could write a
word. They still write their handoff when they are actually stopped, which is what a stop is for.

```
tutor agent status           which courses have one attached
tutor agent start galois     attach one there, leaving the others listening
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

**And the board pulls itself, on the same beat.** The course was only ever half of it: `tutor` and
`tutor resume` also fast-forward *this* repository, under the same never-fatal rule. The always-on
host had a timer for that and a compute node had nothing at all — `--tool-pull` refuses to install
one there, because a timer on a machine that ceases to exist is not a plan — so a fix shipped from
the Mac sat on GitHub until somebody remembered to `git pull` by hand on the node. Remembering by
hand is the thing this repository keeps failing at, and a login is the only moment a node gets.

Two things follow from the pull, and neither is optional:

- **The launcher re-execs itself** when the pull moves `HEAD`. `bin/tutor` was read into memory
  when the process started, exactly the way a board reads `serve.py`, so carrying on inside the
  launcher that was there before the pull is the same defect one level further in — and the hardest
  version of it to see, because the code reporting what it did would be the code that was replaced.
- **Then it bounces what is still holding the old code**, which is `tutor restart --tutors`: the
  boards answering on this machine, the tutors that are not mid-turn, and the proxy if this is the
  always-on host. This is `scripts/ship.sh` seen from the other end. Shipping bounces the machine a
  change is *written* on; without the same act on the machine that *receives* it, the fix is on
  disk and nowhere else, and the pages look new while the endpoints behind them are the old ones.

Only the two commands that begin a session do this. `tutor restart` does not, because `ship.sh`
calls it seconds after its own push and a second fetch there is a network round trip that finds
nothing.

### Always-on, with the machine that holds the repository preferred

**The goal.** Open the app on the iPad, pick a course, get a session. No command anywhere, ever.
Nothing about how that is arranged is visible to the person holding the iPad.

**Which machine serves is now decided by who has the clone.** A course cloned on the Mac mini is
taught on the Mac mini; the compute node is for a course the Mac has not got. That is the reverse of
how this started, and the reason it reversed is that the tutor moved: the node used to win because
that is where the data and the hardware are, which mattered when the thing doing the teaching needed
them. It does not any more — the tutor is Claude, reached over the network — so the better host is
the machine that is always awake and already holds the repository, and does not take an allocation
with it when it dies.

It is one word of configuration, `follow.prefer`, and `"node"` puts the original arrangement back.

**Preference settles a tie and nothing else.** A live board beats a dead one in either direction:
an address with nothing listening behind it is the one outcome worse than the wrong machine. So the
proxy still serves the node when only the node has a board up, whatever the preference says.

**Nor is it a tie when a machine has nothing left to spend.** A tutor whose usage limit has been
reached is the strangest kind of broken: the board answers, the machine is healthy, the network is
fine, the agent is installed, and no lesson can be taught. Preference is about which machine is the
better host, and a machine that cannot teach is not a host at all — so it stands aside, and gets the
address straight back when the allowance returns. That gives one order, best to worst:

```
the Mac mini on Claude   →   a compute node on Claude   →   the Mac mini on whatever is free
```

Each step is taken only when the one above it cannot be. The first two are the proxy's doing and the
last is the tutor's own; the section below is how the three fit together.

**Moving the address off a live machine is not free, and is why `/handover` finally has a caller.**
The proxy used to leave the compute node only when the node had died, and a dead machine needs no
telling. A *preference* moves the address off a node that is alive and mid-lesson — which strands
the tutor there: still waiting on `board wait`, still writing cards into a copy nobody can reach,
and never given the one turn that writes `HANDOFF.md`. So the follower now asks the machine it is
leaving to wrap up, on the transition and only on the transition. The endpoint was built for this
moment and had no caller until there was a policy that could create it.

#### The design, and the one discovery that shaped it

The obvious approach is that the tailnet identity `board` *moves*: whichever machine is serving
claims it, the way it moves between compute nodes today. That cannot extend to the Mac mini — the
ownership record lives in a shared home the Mac does not see, and macOS runs its own system
Tailscale that cannot also be `board` in userspace mode. So it is inverted: **the Mac mini owns
`board` permanently and proxies.** A compute node keeps its own ordinary name, and the Mac forwards
the iPad's traffic to whichever machine is actually serving — its own board for a course it holds,
the node for one it does not. The iPad's single baked-in origin never changes.

The first draft of this assumed the proxy was a re-point of `tailscale serve` at the node. **It is
not: `tailscale serve` accepts a remote tailnet backend in its config and then answers every
request with a 502** — it only proxies to a local backend. So the Mac runs a small local reverse
proxy instead, and points `tailscale serve` at that.

The pieces:

- **`bin/follow`** — the reverse proxy and the follower in one. A raw byte pipe (so the SSE stream
  and uploads pass through unmodified) that probes both machines' `/health` and flips its upstream
  between them, preferring its own board (`follow.prefer`, default `"local"`). It acts only when the
  target actually changes, which is what makes asking the outgoing machine to hand over a single
  request rather than one every thirty seconds. `--node`/`--listen`/`--prefer` override the config;
  an ad-hoc instance on another port never steals `tailscale serve`.
- **`scripts/install-autostart.sh --always-on`** — the course-less form, registering three
  LaunchAgents: `com.tutorboard.follow` (KeepAlive proxy), `com.tutorboard.resume`
  (StartInterval `tutor resume --quiet`, the warm board it falls back to), and
  `com.tutorboard.pull` (`scripts/tool-pull.sh`, which keeps this repository current and, when the
  pull moves HEAD, runs `tutor restart --tutors` — the boards, the tutors and the follower all hold
  the code they started with, and the follower in particular has to agree with the compute node
  about where courses live). The periodic resume pulls by the same route a login on the node does;
  whichever of the two gets there first does the same thing.
- **`/handover`** in `serve.py` — a secret-gated way for one machine to ask the other to wrap up
  its tutor before the proxy moves. `bin/follow` is its caller, on the transition off a remote
  machine and only there.
- **`tutorboard.machine.machine_shape()`** — "always-on host" (a `follow` config block), "compute node"
  (Slurm answers), or "standalone". `board doctor` prints it, and `bin/board` uses it so that on
  the always-on host the HTTPS name points at the proxy, never at a board port directly.

#### Setting a machine up for this

**Two names, and they are not the same name.** The *tailnet* name is the service — `board`, the one
origin the iPad app is installed against. The *machine* name is who wrote a record — `mac-mini`,
`compute301`. Conflating them is how this went wrong: Tailscale's DNS made `uname -n` answer
`board`, the machine stopped recognising boards it had written as `mac-mini`, and a live board
became unrestartable while still answering perfectly.

- **`board node`** — what this machine calls itself, and whether that is pinned. `board start` pins
  it the first time, before anything writes a record carrying it. `board node <name>` corrects a
  wrong one. Pinned means the network cannot rename the machine underneath a running board: a Mac
  with no `HostName` set takes its name from whatever DNS says that day.
- **The tailnet names are decided once and never move.** The Mac mini is `board`, permanently. Its
  `~/.config/tutor-board/config.json` carries:

  ```json
  "follow": { "node": "compute-node", "listen": "127.0.0.1:8844", "prefer": "local" }
  ```

  `node` is the compute node's tailnet name, `listen` is the local proxy port, and `prefer` decides
  which machine wins when both have a board — `"local"`, a course cloned here is taught here.
- **A compute node keeps its own name — not `board`.** Its `board vpn up` must be told that name
  once, or the stale state in the shared home re-registers it as `board` and claws the identity
  back from the Mac.

> **If you are a tutor working on the compute node, there is one command. Ask the person for the
> Mac mini's `handover_secret` and the name this node should keep, then run:**
>
> ```
> bash scripts/setup-node.sh --secret <the Mac's handover_secret> --tailnet-name <node-name>
> ```
>
> It pulls, checks the machine's name, writes the secret, picks the tutor this machine can actually
> run, removes a `follow` block if it finds one, and restarts the boards and tutors so they are on
> the code it just pulled. Every step is idempotent and reports what it found, so running it again
> when you are unsure costs nothing.
>
> The one thing it will not do for you is `board vpn up --hostname <node-name>`. That moves the one
> origin the iPad app is installed against, so it stays a person's decision; the script tells you
> when it is needed.
>
> **Do not pin the machine's name here.** `board node <name>` is for the always-on Mac, whose name
> comes from the network and must not. On a cluster the name is *supposed* to change between
> allocations, because it is a different machine each time and every ownership check depends on
> that being true — `board start` will not pin on a host where Slurm answers, and `board node
> --unpin` undoes one that was set by mistake.

#### When the allowance runs out

The failure this handles is not a fault. Everything works and there is simply nothing left to spend:
the agent says so, exits non-zero, and every turn after it does the same until a clock somewhere
rolls over. Treated as an ordinary broken turn it is invisible in the worst way — the board shows a
tutor listening, the student sends again, and nothing comes back for four hours.

It is also the one failure with a genuinely better machine to run to, which is why it is worth
detecting at all. There are three moves, and they are taken in order.

**1. Notice, and say so where the other machine can hear it.** A turn that has already failed has
its output read back for the phrases a provider uses. Only a *failed* turn — reading every
successful one for the words "rate limit" finds them in the lesson, because a course on queueing
theory says them in earnest. What a limit looks like is `usage_limit_says` in the config, a list of
patterns, for the same reason `egress_probe` is a list of URLs: the board is not allowed to know
which assistant is driving it, so the provider is named in one default value and nowhere else.

The record is per **machine**, not per course — an allowance belongs to an account and every board
here is equally unable to spend one — and it carries an expiry rather than a flag. Claude Code names
the epoch second the limit lifts and that is believed over any window we could guess; without one it
is an hour. A limit that has to be cleared by hand is a limit that outlives itself and quietly
demotes a machine for days.

`/health` publishes it, for exactly the reason `/health` publishes the chosen course: only the
machine that hit the limit can know about it, and the Mac cannot read the compute node's filesystem.
A board too old to publish the field is not assumed to be exhausted — silence is an allowance.

**2. Let a compute node take the lesson, if one is up with an allowance of its own.** The follower
passes over a preferred machine that has none, and the move ends the way every move between machines
now does: with `/handover`, so the outgoing tutor gets the turn that writes `HANDOFF.md` instead of
being orphaned. That call used to fire in one direction only, because the address only ever left the
node when the node had died and a dead machine needs no telling. An allowance moves it off a machine
that is alive and mid-lesson, so both directions now carry a live tutor — and `handover` declines to
bother a host that is not answering, which is what stops a dead node costing a request timeout on
every move away from it.

**3. Only then, teach with what is free.** The tutor whose allowance ran out does not answer straight
away. It pushes the transcript — the message it has just failed to answer is in there, and the beat
that would have carried it is the beat there is no time for — and then waits one proxy tick
(`takeover_grace`, 45s; the follower re-decides every 30) to see whether it gets stopped. If it does,
a compute node has the address and that is the better outcome; the wait is the only thing that lets
it win the race. If nothing takes the lesson, it falls back to `fallback_agent` — `free` by default —
and answers the message it was holding. A free-model answer beats a board where nobody is home.

What is *not* claimed here: that the message crosses the wire with the address. It goes into the
repository, and the node pulls on its own 90-second beat, so whether the node's `board wait` wakes on
it or the student sends again is the same open question an allocation dying mid-lesson has always
had. The address moving is the part that is certain.

Coming back up is the same three steps in reverse and nobody types anything. The limit expires, or a
turn goes through and proves the allowance is back before the clock said it would; the tutor climbs
out of the fallback at the top of its next turn, `/health` stops saying it is exhausted, and the
address comes home on the following tick.

```
board limit              has the allowance here run out, and until when
board limit --clear      it came back early; stop waiting out the guess
```

`board doctor` names it too. The one thing worth knowing: if both machines run the same account,
they run out together, and step 2 is skipped every time — the node publishes a limit of its own and
the proxy keeps the address here. That is correct and it is also the whole reason step 3 exists.

#### Exit nodes, which are invisible until they are not

An exit node routes **all** of this machine's outbound traffic through somewhere else. Nothing about
*serving* a lesson notices — tailnet traffic does not go through it, so the iPad reaches the board
exactly as before. Everything about *teaching* one does, because the tutor's provider is out on the
ordinary internet, and commercial VPN egress is precisely the address a provider geo-blocks,
rate-limits or challenges.

The failure that produces is total and looks like nothing: turns fail, the board shows an assistant
listening, and the reason is four lines into a log nobody opens.

```
board egress             what a turn can reach, and through where
board egress --repair    rotate exit nodes until one works
```

`board doctor` names the exit node when there is one. A headless tutor asks the same question by
itself, but **only after a turn has actually failed** — a probe before every turn would put a round
trip to the internet in front of every card a student is sitting waiting for, to answer a question
whose answer is almost always yes. If the egress is the fault, it rotates, and then re-answers the
message whose turn was lost rather than leaving the student to wonder and send again.

Three things it will not do:

- **It never turns the exit node off.** Dropping back to the bare connection is the obvious repair
  and the wrong one: somebody routing everything through an exit node is doing it deliberately, and
  exposing the address they arranged not to expose in order to rescue a tutoring session is not a
  trade this gets to make on their behalf. If nothing works, the original goes back and the fault is
  reported.
- **It never walks the whole list.** Four tries. A rotation that works through four hundred Mullvad
  endpoints is an outage of its own.
- **It never decides which endpoints matter.** `egress_probe` in the config is a list of URLs, with
  a default that suits the default agent. The board is not allowed to know which assistant is
  driving it — the same rule that makes a model a command recipe rather than a field — so the
  provider is named in one default value and nowhere else.

Ordering matters in the probe: any HTTP answer counts, including `401`. The question is whether the
packets arrive, not whether we are allowed in, and a 401 to an unauthenticated request has proved
the entire path.

#### Which course the address opens

The proxy has to pick a board, and it used to pick by knocking on every course's port in sorted
order and taking the first that answered. That is not a decision, it is the alphabet — and with two
boards up it was permanent. Tapping *Probability* in the hub did every correct thing and changed
nothing anybody could see: the switch worked, the board started, the agent moved, and the address
went on opening Galois Theory, because G sorts before P. The only way out was to stop the other
board, which is the opposite of what the hub is for.

So the boards are asked instead of raced:

- **`chosen.json`** in `~/.config/tutor-board/` records the course a *person* named. `tutor <course>`
  writes it and so does a tap in the hub. It is a decision, and a decision cannot be derived from
  file times — resuming a course touches its files, so "most recently used" is self-reinforcing.
- **`/health` publishes it**, along with the port that course is genuinely serving on, read from its
  own board record. Only the serving machine can read either of those things; the Mac cannot see
  that filesystem at all. One board answering is enough for the proxy to learn where to go.
- **`/health` also says which course this board is**, and the proxy hands the address to nobody
  whose name does not match the course it went looking for. Ports are derived from names, and
  derivation is not proof: a hash can put two courses on one number, and a start whose port was busy
  moves to the next in its sequence. Without the check, a wrong number becomes a wrong lesson
  silently — somebody opens a Galois proof and is shown a problem set.

Several boards may be up at once and each keeps its own assistant. A listening tutor is blocked on
`board wait` and costs nothing while nobody is asking it anything, so exclusivity bought nothing and
cost the thing that matters: coming back to a course used to mean a cold agent that had to re-read
the contract, the method and the lesson before it could write a word. `test/choice.py` guards all of
this, and it is worth reading before changing any of it.

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
keeps its binaries and which `tailscale` is in charge — are isolated in `tutorboard/`,
in `tex.py`, `machine.py` and `net/tailscale.py`.

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
board open "Galois Theory" --review --over ch01 --over ch07
```

**Lecture** is teaching: one concept, one question, then wait. **Homework** is producing work that
has to end up typeset and compiled — the user writes each solution by hand, the assistant reviews
it, and once it is agreed correct the assistant transcribes it into the `.tex` and compiles the
finished assignment. The write-up is clerical once the mathematics is settled; making someone
retype their own proof teaches nothing. **Test review** is revision: the student says which
chapters the test covers and the tutor asks questions over exactly those, in the same shape a
homework problem is posed, with no document at the end because nothing is being handed in.

The kind shows as a badge on the board, so there is never a question about which sitting this is.

### Getting around a course

**☰** in the title bar opens the contents: every chapter the course has, every problem set,
the way into a test review, and the way back to what has already been filed. Tapping a chapter
opens a lecture there; tapping a set opens a homework sitting bound to it. The chapter you are
in is marked.

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

### Switching between a lecture, homework and a test review

The **LECTURE / HOMEWORK / REVIEW** badge in the title bar is the control. Tap it, and it offers
*lecture*, any problem set the repository actually has — `hw01`, `hw02`, `ch07` — or *test
review*. Nothing is typed, so nothing invented can reach the filesystem, and switching to homework
binds the set in one action. Switching back to a lecture unbinds it.

This was a terminal-only decision until it wasn't: `board open … --homework`. A student who
wanted help with a problem set had to find a keyboard to say so, which is the ceremony this
whole tool exists to remove.

**The three sittings differ in one thing: who chooses what gets worked on.**

| | lecture | homework | test review |
|---|---|---|---|
| The problem list | the tutor picks a manageable few from the section's exercises | the assignment sheet chose them; all of them, in order | the student chose the *chapters*; inside them the questions are the tutor's |
| Leaving some undone | fine — sections are archived and can be returned to | not fine; a skipped problem is a lost mark | fine — the point is finding what is not solid, not finishing a list |
| A document at the end | only if a set is bound | yes, and compiled | no; nothing is handed in, so nothing is typeset |
| Everything else | identical | identical | identical |

In a homework sitting the tutor is woken with the path to the sheet itself — for Probability
that is `homework/hw01/assignment/Prob.Homework1.2026.pdf` — and told to read it and do
exactly what it assigns. If no sheet is filed, it is told to ask rather than to infer a
problem list from the chapter. Statements are transcribed into the set's `.tex` first, then
the problems are taught one at a time exactly as in a lecture.

### Test review — revising for a paper

Tapping *test review* does not start a sitting. It asks what the test covers, because the
student is the only person who knows: a drawer of every chapter the course has, each one a
tick, *select all*, and **start review**. Nothing is typed there either — every name in it came
off the repository's own chapter table — and the whole scope goes in one action, because a review
over four chapters is one decision and sending it four times would file the lesson away four
times over.

Then it teaches exactly as a homework sitting does. A card states a question, the answer block
takes the working, the tutor reads it and locates the break rather than repairing it. What
differs is where the questions come from and what happens at the end:

- **The scope is not the tutor's to widen or narrow.** It is named in the line the tutor is
  woken with and it is on a strip under the title bar the student can see, so a review that
  quietly turns into a lecture on chapter one is visible while it is happening. **change** on
  that strip reopens the picker with the current scope already ticked.
- **The questions are spread across the whole scope**, and anything answered cleanly is moved
  on from. A review exists to find what is not solid yet.
- **Nothing is written up.** No `.tex`, no compile, no `board hw` at all — nothing is being
  handed in, and the lesson is the record.

From a terminal, if you are already at one:

```
board review list                     everything this repository can be reviewed over
board open "Galois Theory" --review --over ch01 --over ch07
board review over ch02 ch03           change what it covers, without reopening
board review                          what it covers now
tutor galois --review --over ch07     or straight from the launcher
```

Chapters are matched on their label, their short form or their bare number, so `ch07`, `Ch 7`
and `7` all find the same one. A name the repository does not have is refused and named, never
silently dropped.

**In a code project there are no chapters, and it is not told it is broken.** It is offered its
own top-level parts instead — `loader/`, `pipeline/`, `web/` — discovered the same way
everything else here is discovered, and a flat repository falls back to its own source files.
The sitting then asks about code that already exists: what a function does, why it is written
that way, what would break if it changed. It never sets work, and a repository whose stance is
`do` does not turn a review into an implementation — a review asks.

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

## Exporting the whole conversation

A lesson on the board is a scroll on a piece of glass. Somebody eventually has to *show* it —
to a professor, to themselves in a fortnight — and neither a screenshot nor a print of the page
is a document.

```
board export                     # this lesson
board export --all               # every lesson in the course, as one
```

and, on the iPad, **⋯ → export this lesson** or **export the whole course**. It writes both
halves of the sitting in the order they happened — the tutor's cards typeset from their own
markdown and mathematics, and *every page you handed in*, as the picture that was actually sent,
labelled `You wrote — attempt 2 of 5` with the time. An exercise worked over ten attempts is ten
pages of your own handwriting with the tutor's replies between them, which is the record of the
work rather than a summary of it.

It lands in `transcripts/` — outside `live/`, which is runtime state a course repository ignores
— as `<lesson>-v1.pdf`, then `-v2.pdf`, then `-v3.pdf`. **Numbered, never stamped with the time.**
A folder of `20260901-143210-...` is an eyesore and still does not answer the only question anyone
asks of it, which is which one is the latest. The `.tex` is kept beside the PDF, because the
source is the record and a PDF nobody can rebuild is a dead end; the images are named relative to
the repository, so it still builds on another machine.

Both files are `git add`-ed as soon as they are written — **staged, not committed**. An export
happens in the middle of a lesson and a commit in the middle of a lesson is a decision the person
makes, so it goes with the next `⤓ save` or `board push` like everything else.

`--all` puts every filed lesson and the one still open into a single document with a contents
page, each sitting named by the moment it was filed and the open one saying *(in progress)* —
because two evenings on the same chapter carry the same label in `state.json` and a table of
contents that cannot tell them apart is not one.

What it costs: a LaTeX run of a minute or so for a long course, and the board says so while it
waits. A failure never loses the source — the `.tex` is written and staged either way, and the
error appears on the board rather than in a log nobody opens.

## Setting up a course repository

The minimum is nothing at all: make a directory next to this one and run `board start` inside it.
Everything below is optional, and each item buys something specific.

1. **`tutorboard.json`** — declare the name and the mode rather than being guessed at.
   One command: `board init "Real Analysis" --math`.

2. **`latex/coursemacros.sty`** *(maths)* — your own macros. They are loaded ahead of the board's
   own vocabulary in every compiled diagram and in every exported lesson, so notation you already
   use in your `.tex` files works unchanged on the board. Without it you still get the shared set
   in `web/macros.js` — `\QQ`, `\degree{L}{K}`, `\Gal`, `\PP`, `\EE` and the rest.

3. **`scripts/build.sh`** *(optional)* — how this repository compiles a `.tex` file, called with
   one argument, the path to it. `board hw build` uses it, so a homework write-up comes out
   through the same pipeline as the rest of your documents. (The transcript export compiles
   itself, because it has to work in a repository that has no build script at all.)

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
board export                     # the whole conversation, as transcripts/<lesson>-vN.pdf
board export --all               # every lesson in the course, as one document
board hw                         # this sitting's problem set: what is still empty
board hw build                   # compile it; the result lands on the board
board hw file 7.2                # file a sent page into the set's handwritten/
board review list                # everything this repository can be reviewed over
board review over ch01 ch07      # what a test review covers
board vpn up|status|serve|down   # the Tailscale link
board doctor                     # is this machine equipped
board limit                      # has the tutor's allowance here run out
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
bin/board          the command line (also: tutor, follow, free)
serve.py           the entry point, and nothing else
TEACHING.md        how to teach on this board -- copied into every course's live/
tutorboard/        the board itself, organised by what a thing is about:
  paths ports      what this machine knows about itself
  choice machine   which course was asked for, and what this machine is
  processes tex    what is alive here, and where TeX is
  limits reasoning what a model may say, and when it may not say it
  handoff sense    what a turn means, and what it leaves behind
  machines.py      the other machines, and what each can teach
  net/             reaching them: tailscale, socks, boards, egress
  course/          a course on disk: repo, config, document, homework, review,
                   syllabus
  lesson/          what is on the board now: cards, turns, notes, slate,
                   archive, state, git, uploads
  server/          app, handler, hub, tikz, spawn, multipart, and routes/ --
                   one module per family of paths
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
  .board.json      which node, which pid, which port
```

and one directory outside `live/`, because it is meant to be kept and the rest of `live/` is
runtime state:

```
transcripts/       <lesson>-v1.pdf, -v2.pdf … written by `board export`
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
python3 test/choice.py   that the address follows the course a person chose
python3 test/limit.py    that a lesson moves to a machine with an allowance to teach it

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
