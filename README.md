# Tutor-Board

A live board for tutoring sessions.

The assistant writes a lesson card into a file. A local server sees the file appear and pushes it
to every browser that has the board open — laptop, iPad, phone — where it renders as typeset
mathematics in about a tenth of a second. Nothing is refreshed by hand and nothing is compiled by
the reader. Handwriting, typed answers, and photos travel back the other way, into an inbox the
assistant reads.

It exists because reading mathematics as `\QQ(\sqrt[3]{2})` in a terminal is miserable, and
because a PDF that has to be rebuilt and re-scrolled after every sentence is not a conversation.
The same turned out to be true of being walked through code on a tablet — and, after a while, that
the two wanted the *same* board rather than two. A repository declares nothing about its subject
now: one interface, one method, whether the exercises are proofs or functions.

**It is written for one machine: a compute node on a Slurm cluster, with no administrator rights,
on a shared home.** Nothing needs `sudo`, nothing is supervised, and nothing assumes the machine
will still be yours tomorrow — see [The machine this is written
for](#the-machine-this-is-written-for).

**Contents** — [What it is not](#what-it-is-not) · [The three surfaces](#the-three-surfaces) ·
[Commands](#commands) · [Writing a card](#writing-a-card) · [The slate](#the-slate--writing-by-hand)
· [Getting work back](#getting-work-back) ·
[Exporting it](#exporting-the-whole-conversation) · [Any agent](#any-agent-not-just-one) ·
[Layout](#layout) · [The machine](#the-machine-this-is-written-for) ·
[Setup, start to finish](#setup-start-to-finish) ·
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
> ### Where this is right now, 11 September 2026 (later)
>
> **One machine, one tutor, one address.** The machine is the compute node: its tailnet name is the
> origin the iPad app is installed against, and it opens whichever course was last chosen on it —
> `board net` prints it. `tailscale serve` only ever proxies to a port on the machine running it, so
> there is no arrangement in which one origin serves two machines: everything under
> [One address, and the machine holding it](#one-address-and-the-machine-holding-it) follows from
> that. The hub is a directory listing of this machine's courses, with nothing to pick between.
>
> The tutor is Claude Code. There is no second tutor to fall through to when an allowance runs out,
> and that is a decision rather than an omission: a lesson answered worse, by something else,
> without the student being told, is worse than a board that reports the failure and names the hour
> the allowance comes back. `board limit` says when.
>
> **Three things reported from the iPad, all of them somebody unable to get where they were going.**
>
> **The contents drawer could not be scrolled, so the problem sets could not be reached.** *"I'm in
> Probability right now, and the bar showing the contents and the Problem Sets is not scrollable, so
> I can't reach the problem sets."* Every drawer on this page is the same shape — a fixed panel from
> the top of the glass to the bottom, a head and a foot that do not move, and a list between them —
> so the list is the part that scrolls, and being *inside* a panel does not make it a scroller. Four
> of the five lists carry the two declarations that say so. `#contents-list` carried neither, laid
> out at its full height, and ran off the bottom edge where there is nothing to scroll and no way to
> reach it. Probability's eleven chapters reach the bottom of an iPad on their own, which put every
> problem set past it. `test/chrome.js` now asserts the rule for all five rather than for the one
> that happened to be reported.
>
> **`salloc` is the whole of it now.** *"I don't want to have to have an open VSCode session on my
> laptop ssh'ed into a compute node."* `salloc` hands you a shell on the LOGIN node and leaves the
> machine it gave you with nobody on it — so "the only moment a compute node gets is the moment you
> log in to it" was a moment that only ever arrived because somebody kept a second session alive by
> hand. The login hook fires on the login node too, and `tutor resume` there hands the whole command
> to the node: it pulls, re-execs onto what it pulled, bounces what is holding the old code, brings
> the board up, re-points the name and attaches a tutor. ssh first, because it leaves no process
> behind on the login node; a Slurm step that holds itself open where ssh cannot get in. See
> [`salloc` is the whole of it](#salloc-is-the-whole-of-it). `test/resume.py` holds the rules for
> which node, both ways in, and the two escapes.
>
> **Switching course in the hub could not be made to work.** *"whenever I want to switch courses on
> a host, when I have the switch option, I can hit it, but it never seems to work. It just gives me
> the options to 'ask again' or 'stay here'."* A course has its own port, so opening one means
> re-pointing the one name the app is installed against — and nothing did it. The hub asked the
> address which course it was serving, got the old answer for a minute, and then had nothing to say
> but that. So `/switch` takes the name itself, in the same request, on the machine that starts the
> board: a tap is a person naming the lesson they want, which is exactly the case `ts_repoint` holds
> a name *for* rather than against. The overlay asks nothing now — a tap dismisses it — and a course
> on another machine says where it is instead of waiting for an address that will never serve it.
> `test/hub.js` drives the tap in a real DOM; `test/choice.py` holds the rule.
>
> **A dead tutor was a sentence in a bar that cannot grow.** *"I get a message that 'tutor stopped -
> nothing is rea...' that gets cut off on the top bar."* The title bar already carries the course,
> the chapter, the sitting badge and three controls; it is the one row on this page with no room, and
> the half of that sentence that gets cut is the half saying what to do. The chip is two words now —
> `tutor stopped` — and `#tutorbad` carries the rest across the width of the chrome: *anything you
> send starts another and waits in the inbox until it is up*, which is true, because a send wakes a
> dead tutor by itself. In the chrome and not in the empty-board panel, because a tutor dies in the
> middle of a lesson that has cards on it, which is exactly when that panel is not on screen.
> `test/hanging.js` holds it. Shell version `board-shell-v92`.
>
> **This tool is written for one machine: a compute node on a Slurm cluster, no administrator
> rights, shared home.** Everything that existed for a machine of a different shape is gone — no
> supervisors, no launch agents, no periodic rounds, no second host to arbitrate with, and no
> platform branches for an operating system this is never run on. What is left assumes the four
> facts under [The machine this is written for](#the-machine-this-is-written-for), and the one that
> shapes the most code is that **nothing here can be supervised**: an allocation ends and the
> machine stops being yours, so a login is the only moment there is. `scripts/install-autostart.sh
> --login-hook` is the whole of the automation, and `tutor resume` is what it runs.
>
> **Two clones of one course must never both run a transcript beat.** Two boards each committing
> `live/slate/page-06.png` is a merge conflict in a binary file, and a repository left in a
> half-finished merge is a repository whose every later push fails — reported as "I just tried to
> push changes and it failed". One machine is how that stays impossible.
>
> ### Where this was earlier on 11 September 2026
>
> **A regression, and the latent defect underneath it that made both symptoms.** Reported
> immediately after the last ship: *"Now zooming on the writing board is fucked up!!! One finger
> acts as if I'm zooming with two fingers! And two fingers does nothing"*. Two symptoms, one cause,
> and the cause was not new — the change I shipped only made it reachable.
>
> **What a gesture IS was decided by counting a map.** One contact in `touches` pans, two pinch. So
> a contact that should not be in that map does not add noise, it changes the answer:
>
> | `touches` | fingers actually down | what the code did |
> |---|---|---|
> | 2 entries | 1 | the pinch branch ran, one moving finger against a frozen phantom — **one finger zooms** |
> | 3 entries | 2 | matched neither the two-finger branch nor the one-finger branch — **two fingers do nothing** |
>
> **A phantom got in two ways, and neither had anything to expire.** This file has learned that
> lesson twice already — `penDown` latched and took the surface away outright, `palms` latched and
> killed the next finger given a reused pointer id, and both got a staleness bound and a
> window-level lift. `touches` had neither. A finger lifted past the edge of the sheet delivered its
> `pointerup` to the window, where only the pen was being listened for; and a contact condemned as a
> palm returned out of `endStroke` *before* the line that would have taken it out of the map, so any
> finger that landed while the nib was down was left there for good.
>
> Now: a lift is caught at the window as well as at the sheet, for every pointer type, through one
> `forgetContact` so the two cannot disagree — they did, and the sheet's copy finding nothing left
> to delete is what skipped the `zoomSettled` that pays for the crisp repaint, leaving the page soft
> after a pinch that ended off the edge. Anything that has not reported for `GESTURE_STALE` is
> dropped before it is counted. And the pinch is between the two contacts it *started* between
> rather than whichever two the map holds, so a heel of a hand landing late no longer ends it.
>
> **My part in it was the `blur` handler**, added the day before to clear the contacts when the app
> goes away mid-gesture. The reasoning is right and the event is wrong: `blur` arrives at moments
> nobody chose — iOS raises it as the browser takes a gesture over, among other things — so a pinch
> could have both its fingers forgotten underneath it and then do nothing for the rest of the
> gesture. It takes the pen and never the hand now. The case it was for is covered by the expiry,
> which cannot misfire mid-gesture because a live contact reports on every frame it moves.
>
> **And the three-dot menu was underneath the writing toolbar.** *"It may have been that the writing
> toolbar when on a board is covering up elements of the three-dot menu from the top right. Make
> sure that menu is on TOP of everything when it appears."* At `z-index: 50` it was above
> `#drawbar`'s 41 and still came out under it: `#drawbar` is `flex-direction: column-reverse` and
> grows UPWARD as the slate's own menu and selection bar open inside it, so on a board with the pen
> out the toolbar reached into the lower half of the menu. It is 99 — above the toolbar, the
> annotation bar, the send prompts, the panic button and the full-screen drawers. A menu is the most
> recent thing the person asked for; nothing should be over it.
>
> Being drawn on top of a thing is not the same as not overlapping it, though, so `placeMenu` now
> takes the toolbar's top edge as its floor rather than the bottom of the glass. An entry painted
> over a black tool bar is still an entry nobody can read.
>
> `test/plane.js` reproduces the report: a finger lifted where the sheet never hears it, then a
> single finger dragging, and the zoom must not move — against the code this replaced it runs from
> 0.4939 to 0.1822, which is the complaint in one number. Also that two fingers still pinch
> afterwards, that a third contact does not end a live pinch, and that `blur` takes the pen and not
> the hand. `test/chrome.js` compares the menu's stacking against every other layer on the page
> rather than against one of them, and `test/panic.js` opens it with the toolbar out and checks it
> stops above it. Shell version `board-shell-v89`.
>
> ### Where this was on 10 September 2026 (late)

> **The ⋯ menu could not be scrolled, and the lesson scrolled instead.** *"At the top right, there
> are three dots I can tap to get a menu of other things I can do, like refresh the app, etc. That
> isn't scrollable — or at least when I try to scroll it, the main session page behind it is what
> scrolls instead."* The menu was capped and given `overflow-y: auto` on 8 September, and both
> halves of this report say that did not land. Two causes, and the second one produced both
> symptoms on its own.
>
> **It lived inside a sticky element.** The menu hung off `#chrome`, which is `position: sticky`,
> and WebKit does not reliably hand a touch drag to an `overflow` container nested inside one: the
> gesture walks past it to the page. So the menu was clipped exactly as intended and could not be
> moved a pixel — which is the report, word for word. Being in there also trapped it in `#chrome`'s
> stacking context, so its `z-index: 45` competed with the bar's own children and not with the
> page. It is a body-level `position: fixed` layer now, which is what a menu is.
>
> **And it was measured against the wrong viewport.** `placeMenu` capped its height with
> `window.innerHeight` — the LAYOUT viewport, which is not what you can see. The iPad keyboard comes
> up under a typed answer and takes half the glass while `innerHeight` does not move; a pinch
> magnifies the page and `innerHeight` does not move. The cap was then **bigger than the screen**,
> which does two things at once: the last entries sit off the bottom, and the menu does not overflow
> its own box — and a box that does not overflow is not a scroller, so iOS correctly gives the drag
> to the lesson. One wrong number, both complaints, and the reason the previous fix looked like it
> had done nothing.
>
> This is the same mistake `#panic` was written to escape, in the same file. `test/panic.js` has
> carried the rule since it was written — *"`position: fixed` is fixed to the LAYOUT viewport.
> Pinching moves the VISUAL one. A control placed by CSS alone therefore slides off the glass at
> exactly the moment it is needed, and looks perfect in every test that never zooms"* — and the menu
> was the second control with the defect. It is placed from `window.visualViewport` now, hung from
> the real bottom of the chrome stack rather than an ancestor's edge, and re-placed while it is open
> on every visual-viewport move, coalesced to one placement a frame.
>
> `-webkit-overflow-scrolling: touch` is gone with it. It is deprecated, it does nothing on any iOS
> this runs on, and the separate scrolling layer it asks for is implicated in exactly this failure:
> a nested scroller that never receives the gesture.
>
> **Why no test caught it.** The 8 September tests assert the CSS text — that `overflow-y: auto` is
> there, that the cap is in `dvh`, that something measures the room. Every one of those was true and
> the menu still could not be scrolled. `test/chrome.js` now asserts where the element *lives* — that
> it is not inside `#chrome`, that it is `position: fixed`, that the deprecated scrolling layer has
> not come back. And `test/panic.js`, which already stands up a zoomable visual viewport, opens the
> menu with the keyboard up and checks the cap against what can be seen: 204px of a 260px visible
> viewport, where the old code gave 712px. Both fail against the code they replaced.
> Shell version `board-shell-v88`.
>
> ### Where this was earlier on 10 September 2026 (evening)
>
> Two things reported from the iPad in one message, and they are unrelated to each other except
> that both are the board interrupting somebody in the middle of a proof.
>
> **A pinch showed the page as it was before the mark.** *"Sometimes zooming after writing or
> erasing on the board glitches out and I have to wait a second for it to work properly and to be
> able to scroll or erase or write again."* The second is the pinch.
>
> The writing surface keeps a bitmap of the page and blits it, stretched, while two fingers are
> down — one `drawImage` a frame rather than four hundred strokes redrawn sixty times a second.
> That trick is right and it stays. What was wrong is that the bitmap can be stale in **two
> different ways and there was one flag between them.** `cacheValid` means *drawn at the view
> showing now*, which a pinch breaks on every frame, and breaking it is fine: the ink is still the
> right ink, so a stretched blit is a true picture of the page, softly rendered. A stroke committed
> or a word rubbed out is a different thing entirely — then the bitmap's **ink** is out of date, and
> stretching it is not softness, it is the page before the edit. Nothing could tell those apart, so
> a pinch that began just after a mark was made blitted a bitmap with no such mark in it. The ink
> came back when the gesture settled, about a second later, which is the "glitches out".
>
> The ink has its own flag now. A view change stretches; an ink change costs one rebuild, at the
> view in hand, and every frame after it stretches again — one rebuild per edit, never one per
> frame.
>
> **And the mend after an erase was painted at the wrong scale.** Rubbing out does not throw the
> bitmap away; it records the rectangle it emptied and paints that patch back. A patch has to land
> where the rest of the bitmap thinks that part of the page is, and the transform came from `view` —
> the same thing as the bitmap's own geometry only until somebody starts a pinch, after which the
> view moves every frame and the bitmap does not follow. So the repair went in at one scale on top
> of ink drawn at another. It uses `cacheAt`, the bitmap's own geometry, which is what it was for.
>
> **A finger resting on the glass read as an idle surface.** Every test of whether the hand is busy
> was a timestamp of the last thing it did, and a finger held still does nothing — which is how a
> pinch is held at the zoom you wanted and how it is repositioned between two pinches. After 1.2
> seconds of that the surface called itself idle and let a PNG encode land in the middle of the
> gesture. A contact that is down is now busy, with a twenty-second bound so a lift that was never
> delivered cannot wedge the encode for ever, and `blur` clears the contacts outright.
>
> **The encode was also being invited in by arithmetic.** Whether an autosave carried a picture was
> worked out from `handBusy()` at the instant the timer fired, and that timer is set `AUTOSAVE_MS`
> — 1200ms — after the last mark, which is exactly the width of the hand's tail in `handBusy`. The
> autosave fired a millisecond after the guard expired, every time. A guard asked once, at an
> instant, cannot cover a window. Carrying a picture is a decision the caller makes now: a send, a
> leave, or the picture timer whose whole business is finding a gap. And a picture save that failed
> re-owes the picture instead of leaving the PNG on disk behind the strokes until the next mark —
> the last mark of an evening being exactly the one nothing follows.
>
> **A new version of the app reloaded the page out from under the reader.** *"There are a few times
> when after I sent a response, the whole screen went white, and then the page reloaded with the
> tutor response and all prior responses collapsed (though reachable) and all prior boards only
> yielding the frozen canvas of my work."* Every part of that is one `location.reload()`, fired the
> instant a new service worker claimed the page.
>
> The reload was deliberate and the reason for it is still true: swiping out of an installed iOS app
> and back in RESUMES it, so without one a fixed bug stays on screen until the app is force-quit.
> The moment it chose was not. An update is asked for on every return to the foreground, and
> **sending a response is exactly when an app comes back to the foreground** — which is why it
> happened where it did. A reload is cheap for the code and expensive for the person: the scroll
> position goes, every card folds back to how it renders on a first visit, the live surface is
> replaced by the picture of the last thing sent, and there is a white flash in the middle of a
> proof.
>
> So a new worker is news, not an event. Taken at once when the page is **hidden**, because then it
> costs nothing and the app is on the new code the moment it is picked up again. Offered otherwise,
> in a strip that says what it is — *a new version of the board is ready · load it now · later* — so
> somebody who wants the fix now can have it and somebody mid-exercise is not interrupted by one.
> And never over ink the disk has not been told about: the surface can be asked what it still owes
> (`api.owed` — a dirty page, a save on the wire, a retry, a picture outstanding) and both routes ask
> before they reload. The full-screen slate keeps the same rule, where what would be lost is
> handwriting.
>
> `test/plane.js` holds the surface half — a mark made just before a pinch is drawn rather than
> stretched away, the frames after it still cost one blit, a mend lands at the geometry the bitmap
> was drawn at, and a finger resting on the glass is a hand at work. `test/staying.js` is new and
> holds the other: a handover while the lesson is on screen reloads nothing and says so instead, a
> handover taken the moment the app is put down, and the ink consulted on the way through. Both fail
> against the code they replaced. Shell version `board-shell-v87`.
>
> ### Where this was earlier on 10 September 2026
>
> **One killed git closed every door in the repository, and nothing noticed for seventy minutes.**
> Reported in one sentence: *"I just tried to push up some work in Galois Theory, and it failed."*
> The board's red banner held git's own words — *Another git process seems to be running in this
> repository … remove the file manually to continue* — which is not an instruction anybody can
> follow from an iPad in the middle of a proof.
>
> **Measured, and the file was still there.** A zero-byte `.git/index.lock` in Galois-Theory,
> written at 15:16:32, with no git process running and nobody holding it open. The last transcript
> commit was 15:14:59. Every save after that — 15:18:57, 15:19:01, 16:24:30 — failed at `git add`,
> and four handwritten attempts at 3.26, two slate pages and a card sat uncommitted the whole time.
>
> Every git call in this tool runs under a subprocess timeout, on a network filesystem, in a
> repository whose slate pages are rewritten every two seconds while somebody draws. `git add`,
> `git commit`, `git pull` and an ordinary `git status` all take `index.lock` before they touch the
> index and release it by renaming it over the index at the end. A git killed at its timeout never
> reaches the rename. What it leaves shuts the beat, the save button, `board push` and the person's
> own terminal, permanently, out of one interrupted command.
>
> **A lock is not a rebase, and treating it like one was the mistake.** A rebase means a person is
> part-way through something and the answer is to wait forever. A lock means either that git is
> running this second, which is over in seconds, or that it is not — in which case the file is
> rubbish and holding onto it costs somebody their afternoon. `worktree.lock_reason` tells those
> apart by asking who has the file open (`/proc`, every open descriptor is a symlink there) and
> falling back to age where it cannot ask, with a threshold above every timeout in this tool. A
> lock nobody holds is thrown out; a lock somebody holds is left, and the board says *press save
> again in a moment* instead of naming a file.
>
> **The beat is what heals it, because the beat is the only thing that comes back.** It runs every
> ninety seconds whether or not anybody is looking. It now clears the rubbish before it stages, and
> `sync` and the tool's own self-update do the same — a lock in the tool's repository would have
> stopped every board on the machine from ever updating again.
>
> **And the beat's own failure was silent, which is why this took seventy minutes to surface.**
> `git add -A live` was fired and forgotten: with the index locked it staged nothing, the
> `diff --cached` after it found nothing to commit, and the beat returned as though it had simply
> had a quiet ninety seconds. It says *transcript: NOT staged* now. A beat that cannot do its job
> says so.
>
> **The save badge was the likeliest thing to have created that lock, and it had no business
> taking one.** `git status --porcelain` every eight seconds, to draw **⤓ save 4**, and an ordinary
> `git status` takes the lock to write back the index it just refreshed — a kindness to the next
> command, and the wrong trade entirely for a poll. It is `--no-optional-locks` now, which also
> means the badge keeps counting while somebody else holds the lock rather than going blank at the
> moment it has most to say.
>
> `test/beside.py` holds all of it, against real repositories: a lock held open by a live process
> is left alone however old it looks, a lock nobody holds is cleared and the page still gets
> committed, a tap on save rescues itself and says it did, and the badge neither creates a lock nor
> goes blank because of one.
>
> ### Where this is right now, 9 September 2026
>
> **A machine you cannot see is a machine you cannot switch to, and the compute node had gone
> invisible.** Reported while the app was open: *"I don't see any options to go to the compute
> node"*, with the ask alongside it — *"I want the option to switch tutors to ALWAYS be available
> and visible on the home screen."* Both halves were right, and the second one is the reason the
> first was possible to miss.
>
> **Measured, both directions, a minute apart.** The Mac's `/hosts.json` named the compute node
> once and then only itself. The node was up the whole time, teaching PSYCH-ASR on 9171. The Mac
> has five course repositories — Algo-Solutions, Galois-Theory, Lean-Theorem-Proving,
> Mathematical-Modeling, Probability — and **PSYCH-ASR is not one of them**.
>
> That is the whole defect. A machine is found by knocking, a course's port is a pure function of
> its name, and the walk knocked on the ports of the courses cloned **here**. So the one board on
> the node sat on a number the Mac had no reason to ever try, and the only thing that had been
> keeping the node visible at all was a remembered port from an earlier sighting — 9098,
> Galois-Theory, whose board is gone. That memo lived in a dictionary in a process, so it expired
> between two probes and took the machine with it.
>
> **A machine's own course list is the answer, and it was already being fetched every time one was
> found.** It is written down now — `~/.local/state/tutor-board/hosts.json`, per machine: the name,
> the port that answered, and what that machine said it could teach. The next walk knocks on the
> ports of **their** courses, the running one first, before falling back to ours. The Mac had
> PSYCH-ASR in hand every time it drew that row; it simply threw it away.
>
> **And a board now says where it is, rather than waiting to be guessed at.** `/hello` — host,
> port, course list, and the same three things in the reply, so one exchange teaches both machines.
> Whichever of the pair can see the other teaches it the way back.
>
> **On a heartbeat, and that took a second round to get right.** The first version announced at
> start-up and on every walk, which sounds like enough and is not: the node's boards restarted at
> the moment of shipping, *before* the Mac had pulled, so the one announcement of the evening was
> answered by a machine with no `/hello` on it — a 404, and the end of it. The walk is no fallback,
> because a walk happens when somebody ASKS, and a board nobody has the hub open against never
> looks for anyone. So the machine holding the news was the one machine that would never send it,
> and the row still said "board" on its own until the announcement was posted by hand. It is a
> clock now: every five minutes, one POST per machine at most, and none once the far side has
> answered.
>
> **The row is never hidden again.** It hid itself at one machine — "one machine is not a choice,
> and a row of one button is furniture" — which draws *nobody has looked yet* and *there is no
> other machine* in exactly the same way: as nothing at all. A machine seen before is listed even
> when it is not answering, marked as not answering, with the last course list it gave and its live
> flags stripped, because what is running over there is the one thing a remembered list cannot
> still know. The hub also answers from that file on its first request now, so the app opens with
> the other machine already in the row instead of thirty seconds later.
>
> **And a tap on a machine with no board is told so.** It used to record the choice and hand back
> "asked for Galois-Theory on compute-node", which moves nothing: nothing on that machine can start
> a course, because a board is the only thing over there that answers. It now says *compute-node
> has no board answering. Bring one up on that machine once and it is reachable from here* — and
> records nothing, so no follower is left chasing a machine that cannot answer.
>
> `test/peers.py` holds the walk and the memory, `test/hub.js` the row in a real DOM, `test/choice.py`
> and `test/keeping.py` the rules and the route. Shell version `board-shell-v86`.
>
> **Not fixed, and worth knowing.** The Mac cannot hear an announcement until it is on this code —
> its own ten-minute pull does that, and the pair introduce themselves on the walk after it. And
> this node has `tailscale serve` mappings for five ports whose boards are long gone (8780, 8791,
> 8937, 9071, 9098): harmless, because a health check fails closed on a mapping with nothing behind
> it, but each one costs the walk a connect.
>
> ### Where this is right now, 8 September 2026 (afternoon)
>
> **A document is a file, not an event — and it was being offered as one.** Reported in two
> sentences: *"I just tried to save a copy of my homework, and it's not working. It compiles the
> homework, but it's not letting me view the compiled .pdf or save it anywhere locally on the
> iPad."* Every clause of that was true, and there were three faults behind it.
>
> **The button lived for one payload.** `doExportHomework` painted the banner from a record it had
> invented itself — the reply to `/hw/build`, tagged `kind: "hw"`, on no disk anywhere — and handed
> it to the argument slot that belongs to `push.json`. About a second later the next payload
> repainted the same banner from the real `push.json`, which knows nothing about a write-up, and
> `save a copy` went with it **along with the URL behind it**. A minute of LaTeX, a PDF sitting in
> the repository, and a tap that did nothing at all. The write-up's record has always been on disk
> in `live/hw.json`; the payload carries it as `hw.build`, the banner takes it from there, and
> whether the document EXISTS is now a separate question the payload answers off the files
> (`papers`, four `stat` calls) rather than something inferred from whichever record is in the
> banner.
>
> **And a document made a minute ago was as unreachable as one made ten days ago**, because the
> only controls for one lived in the banner of the build that produced it. **⋯ → documents · view
> or save** lists both, at any moment, with what each one is and when — and offers to make the one
> that is not there, so it is never a dead end.
>
> **There was no way to READ either of them.** The one control was *save a copy*, which raises the
> share sheet: somewhere to PUT a document, not somewhere to read one. "Did the proof make it in"
> was unanswerable from the board. **read it** now draws the pages — PNGs, rendered by the machine
> that holds the PDF (`pdftoppm`, `pdftocairo` or `gs`, found on the same PATH as TeX), shown in a
> panel the board owns and ✕ closes back into the lesson. Not an `<iframe>`, because iOS renders a
> PDF in one as a single unscrollable page; and never a navigation, because a PDF navigated to in a
> home-screen app leaves the board with no chrome and no way back, which is the trap the download
> button was rewritten to escape in the first place. Pages are cached against the PDF's own
> modification time, so a rebuild is drawn again and a re-open is instant, and the cache is bounded
> and carries its own `.gitignore`. A machine with no renderer says so and offers the copy instead
> of showing an empty panel.
>
> **And the service worker had been caching the downloads.** `/download/…` matched neither the live
> list nor the runtime list, so it fell through to the shell rule, which caches any 200 it sees.
> Megabytes of transcript inside the app's own storage allowance — and a document that is rebuilt
> at the same URL every time, so a cached one served while the link blinks is last week's write-up
> under this week's name. That is the same mistake as a cached lesson, one layer down, in the file
> whose entire rule is against it.
>
> **And the menu that all of this hangs in could not be scrolled.** Reported straight after:
> *"I also can't see the refresh button when I tap the '...' menu."* The documents entry was the
> eleventh, and the menu hangs off `#chrome`, which is stuck to the top of the window — so an
> entry past the bottom edge of the glass is not below the fold, it is unreachable, because
> scrolling the page moves the lesson and not the menu. At the reading type size somebody
> actually uses, that is past the bottom of an iPad in landscape. It scrolls now, capped at the
> room measured under the bar when it opens rather than guessed — the banners in the chrome stack
> change that figure, and a save offer, an export result and the homework strip are all up at
> exactly the moment somebody goes looking for the reload. With a fade at the bottom edge while
> there is more, because on iOS a scroller shows no bar until a finger is already on it, which
> makes a capped menu and a truncated one look the same from a foot away. `test/chrome.js` —
> where the rule that the title bar cannot grow already lived, nothing having said the same about
> the menu it overflows into.
>
> `test/paper.py` holds the server half against a real board on a real socket, and `test/link.js`
> holds the half that actually failed: two payloads in a row, with the write-up still reachable
> after the second. `board doctor` and `scripts/setup-mac.sh` both say whether this machine can
> draw a page, because a panel that will not fill is a bad place to find that out.
>
> ### Where this was earlier on 8 September 2026
>
> **A turn is its own session, because what a turn costs is round trips times the conversation
> behind them.** Reported in one sentence — *"one response in Galois-Theory just used 5% of my
> five-hour quota"* — and the agent's own transcript holds the whole of it. Eleven cards, one
> resumed session, `claude-opus-5[1m]`, **17.9M tokens**:
>
> | turn | context held | round trips | tokens | cost |
> |---|---|---|---|---|
> | 1 (cold) | 74k | 18 | 1.14M | $2.24 |
> | 3 | 96k | 8 | 0.76M | $1.36 |
> | 8 | 152k | 36 | **5.22M** | $4.49 |
> | 11 | 176k | 8 | 1.39M | $2.43 |
>
> Measured after the change, on a copy of the same course: **225k tokens over 6 round trips**, and
> 443k on the first turn in a directory whose harness prefix is not yet cached. One seventh of
> what a turn was taking, and it does not climb.
>
> Four defects, and the arithmetic was the same in all four: something was being read or carried
> that was already on disk.
>
> - **The turn was running `board wait` at the end of itself.** That is turn 8. The course
>   contract documents `board wait` as the way to be woken — true, and right for a person at a
>   terminal — so a headless tutor that read the contract in full did as it was told: it held its
>   whole conversation open while the student thought, took their next message out from under the
>   daemon's own waiter, and answered it inside the previous turn's context. Two cards, 36 round
>   trips, 5.05M cached input tokens, $4.49. No prompt wording can fix an instruction that is
>   correct in the document it appears in, so `board wait` now asks `live/agent.json` whether a
>   headless turn is in flight and refuses — exit 0, saying what to do instead, because a
>   non-zero exit reads to an agent as a broken command and gets retried. The daemon's own waiter
>   passes `--force`.
> - **`HANDOFF.md` was 3,824 words against a documented cap of 350.** `live/TEACHING.md` listed
>   "updating `HANDOFF.md`" among the things a turn involves, so every turn read it (5.4k tokens),
>   edited it, and handed the next turn a longer one. Each edit was reasonable. Now `board
>   handoff` is the only writer, it **refuses** a body over the cap rather than trimming one — the
>   useful half of a handoff is at the bottom — and a teaching turn is told not to touch it at all.
> - **A cold turn read three whole documents in three round trips.**
>   `AI_INSTRUCTIONS.md` 9.1k, `live/TEACHING.md` 9.5k, `HANDOFF.md` 5.4k. `board brief` is the
>   tenth of that a turn acts on: the method as a paragraph, this course's own *rules that do not
>   bend* pulled out of its contract, the chapter's handoff, and the note the last turn left. The
>   documents stay on disk with their sections named for the rare rule that needs its detail.
> - **`session_turns` was 12 and the arithmetic says 1.** It is not the cache expiring — a
>   `--continue` turn re-caches only its increment, measured at 40 tokens on a 43k conversation —
>   it is that turn eleven paid on each of its eight round trips to read back ten turns it would
>   never look at again. A fresh session costs nothing for the harness: a second `claude -p` in
>   the same directory reads its 28k system prompt out of cache for $0.015, because the cache is
>   keyed on the prefix and not on the session. So every turn is cold, holds ~22k whether it is
>   turn 2 or turn 40, and what the tutor was *thinking* goes to disk too — `board note`, at most
>   120 words in `live/NEXT.md`, read by the next turn out of the brief.
>
> **And it is measured now, which it was not.** Every number above was dug out of a session
> transcript by hand, after the fact. `--output-format json` on the recipe makes the agent report
> what its turn cost; every headless turn appends a line to `live/cost.jsonl` and `tutor cost`
> adds it up, including the one line that matters — whether the second half of a session cost
> more per turn than the first. The flag is appended from the recipe's `usage_args` rather than
> written into its `headless` argv, because a machine's config overrides `agents` one level deep
> and this machine holds a verbatim copy of the old claude recipe; in the argv, every such
> machine would have stopped reporting silently.
>
> **Not fixed, and worth knowing.** The `board wait` paragraph is still in each course's own
> `AI_INSTRUCTIONS.md`, where it is correct for the interactive session it was written for. The
> guard is what stops it costing money, not the wording. And the handoff already on disk in
> Galois Theory is still over its cap: the next wrap-up turn replaces it, and until then
> `board brief` prints it in full and says by how much it is over — losing continuity is worse
> than paying for it once.
>
> ### Where this is right now, 7 September 2026 (evening)
>
> **A board keeps the lesson it is holding.** Reported in four words — *"Galois-Theory tutor
> session up and crashed"* — and the log holds the whole of it inside one minute. Two defects
> there, and a third found while fixing them — each one a lesson ended by something that was not
> in the room.
>
> **18:09:25 — the tutor was stopped by a proxy the student was not using.** `/handover` is how
> the always-on host asks an outgoing board to wrap up before the address moves: the tutor there
> is about to be unreachable, so it gets its one turn to write `HANDOFF.md` rather than being
> orphaned. That reasoning holds for a reader who arrives through the proxy and for nobody else.
> This node publishes its OWN tailnet name as well — `compute-node.<tailnet>.ts.net` — which is
> what the app on the iPad is installed against and which does not move when
> `board.<tailnet>.ts.net` does. So the Mac's follower re-decided where its address pointed, asked
> compute301 to stand down, and compute301 stood down: a lesson that was running, reachable, and
> being read on an address the follower does not serve. Eight seconds earlier the student had sent
> *"All rational numbers…"*. The daemon answered that one turn, wrote its handoff, and left —
> `stopped after 1 turn(s)`, in the middle of Garling 3.11.
>
> **The board now says no, and the follower comes back.** Two questions, both answered off this
> machine's own disk: is the tutor mid-turn — the guard `tutor restart --tutors` has always
> applied and this one never did, because bouncing a tutor that is writing loses the card — and
> has the student done anything here lately. Sending, handing a page in, or drawing on the slate,
> all read off the files rather than the directories, because the slate writes OVER the page being
> drawn on and a directory's mtime only moves when a file appears in it. Ten minutes, which is
> thinking time on a proof rather than a network timeout. A board nobody is using still hands over
> at once, which is the orphan case the mechanism exists for and now the only case it acts on.
>
> The refusal had to be one the caller returns from. `handover` was called once, at the instant
> the address moved, and never again — so a board that said no was a board that was orphaned for
> good, which is the exact outcome the handover exists to prevent. It is an obligation the
> follower carries now: asked again each tick until the machine agrees or stops answering, and
> dropped if the address comes back to it.
>
> **18:09:09 — and every keystroke of the typed answer had already been failing.** A
> `FileNotFoundError` for `live/text/0070.txt`, twice, with a traceback into `board.log` and a 500
> on the iPad. `live/text/` was gone: the other machine's transcript beat committed the deletion
> of the last draft in it at 15:59, git removes a directory when it removes the last tracked file
> in it, and the pull brought that here. The board had made the directory once, when the process
> started, and a board is a long-lived process. Nothing told it.
>
> It is not `text`'s problem. `answers`, `annotations`, `slate`, `inbox/uploads` and `cards` are
> all tracked, all routinely go empty, and all are written to by a request that arrives whenever
> the student happens to act. `Repo.ensure_dirs` is that list, re-asserted at the top of every
> POST — ten stat calls in front of a route that is about to write a PNG, which is nothing, and it
> is the only place that sees every writer.
>
> `test/keeping.py` holds both, against a real board on a real socket: a directory removed under a
> running server and a typed answer that still saves, a handover refused mid-turn and refused
> eight seconds after a send, one allowed on a sitting that ended an hour ago, and the follower's
> obligation surviving the tick it was refused on.
>
> **And a third, found by running the test suite while writing the other two.** `test/current.py`
> runs the real `stay-current.sh --run`, and a round's first act is `git pull --ff-only` on the
> repository the script lives in — which was this one, with uncommitted work in it. It moved HEAD,
> and a pull that moves hands over to the code that landed with `--after-pull`, which reaches step
> 4 unconditionally and runs `catch-up.sh` for real. The Galois board and its tutor were restarted
> at 18:24, in the middle of the same evening the report came from, and a second board for the
> same course was left answering on 9195 with `live/.board.json` naming it — so the record pointed
> at a loopback-only board while the tailnet was being served by another.
>
> The suite already knew about this shape: `TUTORBOARD_COURSES` exists so a round can be pointed
> at courses that are not the machine's, and the entry for 3 September is the last time this cost
> somebody their working tree. Two holes were left. The round was run out of the real checkout, so
> the override said nothing about step 1 — it runs from a local clone now, and the suite asserts
> the repository it was run from did not move. And `bin/tutor` had never heard of the variable:
> `catch-up.sh` walks the courses it is pointed at and then hands the machine to `tutor restart
> --tutors`, which asked the configuration and found the real home. Moving `HOME` does not help,
> because a missing config falls back to the tool's parent directory, which is the same place.
> `courses()` reads the variable now — one variable, one meaning, everywhere.
>
> **And the guard immediately met the case it was not for, which is how the override came about.**
> Asked, the same evening, to stop the tutor on the Mac — the answer to the two-owners problem
> below. The Mac's board answered `409 busy, somebody was working here 212 seconds ago`, and it was
> right: the iPad was on the Mac's board, not this node's. That is the guard doing its job against
> a caller it was not built to argue with. A person naming the machine has decided which one owns
> the course; the follower re-deciding where an address points has not. `choose_target` already
> draws exactly that line in Rule 0, where a host picked in the hub is the answer rather than a
> preference to be weighed.
>
> So `/handover` takes `X-Handover-Force` alongside the secret — still unreachable from the iPad,
> and `bin/follow` deliberately never sends it, which the suite asserts. `tutor agent stop <course>
> --on <host>` is what does. It exists because saying which machine owns a course used to mean
> being sat at the one that has to give it up, and that machine was a Mac with Remote Login off:
> port 22 refused, 9098 and 443 open. Its board is the only door it opens to the tailnet and
> `/handover` is the only thing behind it that stops a tutor.
>
> **And `board eyes` was broken, which is the command for the question the evening was about.**
> *"The Galois-Theory tutor still isn't able to understand my board work."* The tutor answering
> that board was the Mac's free model, and it could not read the handwriting: cards 0081, 0082 and
> 0083 are all called *please transcribe the content of tNNNN-rN.png* — the tutor asking the
> student to type out their own page. `board eyes` exists to settle exactly that by experiment,
> and it died on `AttributeError: 'str' object has no attribute 'tex_env'`: a local named `tex`
> holding the path to the rendered `.tex` shadowed the `tex` MODULE imported at the top of
> `bin/board`. It is `tex_path` now. Run against the compute node's Claude it reads the token, the
> word and the integral back correctly, so that board can see.
>
> **And switching machines from the hub had never worked, for the same reason as `board eyes`.**
> *"It says 'could not move the board' when I try to access Galois-Theory on the compute node in
> the app."* That sentence is `web/home.js`'s message for any failed `/switch`, and it could not
> say more because the server was answering 500. In `/switch`, the branch for a course on the
> OTHER machine looks up that machine's port with `for h in machines.known_hosts(repo)["hosts"]`
> — and `h` is the REQUEST HANDLER. Python leaves a loop variable bound after the loop, so every
> line after it was calling handler methods on a host dictionary: `h.server.hub.worker.dirty.set()`
> and then `h.send_json(...)`, both dead with *"'dict' object has no attribute"*.
>
> It is `entry` now. The branch is reached by exactly one thing — a tap that moves the board
> between machines — which is why it survived: on a single machine, and on any tap for a course
> the hub is already serving, the code goes the other way and is fine. The two-machine setup is
> the whole reason the hub lists hosts at all, and the one gesture it exists for was a 500.
> `test/keeping.py` drives the real route with the far machine stubbed, and asserts the handler is
> never used as a loop variable anywhere in that file.
>
> **And the follower's log, once somebody read it, held the reason the address never moved — and
> two more defects.** Asked for after the third round of *"will things WORK from now on"*:
>
> ```
> [19:07:21] preferring this machine; following compute-node, listening on 127.0.0.1:8844
> [19:07:21] serving here at 127.0.0.1:9098
> [19:10:48] not moving to compute-node:9098 yet -- 127.0.0.1 still answers for Galois-Theory
> [19:10:50] asked 127.0.0.1 to hand over: ms: can't initialize sys standard streams
>            OSError: [Errno 9] Bad file descriptor
> [19:10:50] serving the compute node at compute-node:9098
> [19:10:54] not moving to 127.0.0.1:9098 yet -- compute-node still answers for Galois-Theory
> [19:11:27] asked compute-node to hand over: claude in Galois-Theory is wrapping up
> [19:11:27] serving here at 127.0.0.1:9098
> ```
>
> **A blank is not a decision, and `wanted_host` was ranking one as though it were.** It took the
> newest record's host even when that host was EMPTY, so a record saying nothing about the machine
> erased one that named it. The person tapped Galois Theory under the compute node; the Mac wrote
> `host: compute-node…` at ...019.325 and the compute node's own board published the same choice
> with `host: ""` at ...019.433 — a tenth of a second later, because the second record is written
> by the machine being TOLD. The blank was newest, so `want_host` came back empty, Rule 0 in
> `choose_target` never fired, and `prefer: local` decided instead. Only a hub tap names a machine;
> a blank comes from a resume, a login hook or `remember_course`, none of which know which machine
> anybody meant, and none of which should overrule somebody's finger.
>
> **With neither side decisive the two boards traded the address, and every trade fires a
> handover.** That is the last four lines above: the compute node's tutor stopped at 19:11:27 by a
> proxy oscillating, minutes after the guard was written to stop exactly that — and the guard was
> right to allow it, because the student was on the OTHER machine at the time. The wobble rule
> (`not moving … yet`) makes each side defer once and then move anyway, which is a slower flap
> rather than none. Fixing the blank fixes the oscillation at its source: the choice is decisive
> again, so there is nothing to oscillate about.
>
> **And a server has no standard input.** `asked 127.0.0.1 to hand over` came back with an
> interpreter crash where a wrap-up should have been. `spawn.tutor_cli` and `spawn.board_cli` let
> their children inherit this process's stdin, and a board detached by `board start` — or started
> by launchd — has fd 0 closed, so the python3 they spawn dies before its first line with *"can't
> initialize sys standard streams"*. Every hub tap that starts a course, opens a chapter or wakes a
> tutor goes through those two functions, so on that machine none of them could do anything, and
> each failure was reported as an ordinary one. `bin/tutor` already passes `DEVNULL` where it forks
> the daemon; it had simply never reached here, or `lesson/git.py`, where `board hw build` from the
> iPad has the same shape.
>
> **Still not fixed, and still needs a person: two machines are beating on one course.** The
> transcript beat logged `Cannot fast-forward to multiple branches` again this evening. Nothing
> above changes that; it is the same decision as before and this file cannot make it.
>
> ### Where this was earlier on 7 September 2026
>
> **The Mac mini teaches for nothing, and the compute node keeps Claude.** Asked for directly:
> *"I want you to modify everything to be FREE AI ONLY on the mac mini side. Compute node side
> still gets to use claude. I want to get all code running on this mac mini to graduate from me
> needing to use claude to debug it, and I want the tutor to not use claude either."*
>
> That splits into two jobs, and the second one is the larger of the two.
>
> **The policy is `free_only`, and it sits OUTSIDE the four-layer agent order.** Three of those
> four layers reach a machine from somewhere else — a course's `tutorboard.json` arrives by `git
> pull`, a `hosts` table is written once and copied, a `--agent` is typed on whichever machine
> somebody happens to be sitting at — so a machine told not to spend must not be talked into it by
> a file that landed in a pull. The resolved agent is checked against what it costs; a paid one is
> reported and replaced. What a recipe costs is written ON the recipe, and an entry that does not
> say is assumed to cost, because the other default bills somebody who never asked. `free` is two
> programs and says so twice: `cost: free` for its headless turns and `cmd_cost: paid` for its
> opencode terminal, so a free-only machine runs every turn and declines to open a session.
>
> **The second job was the free chain itself, which was quietly rotting.** `bin/free` named five
> OpenRouter models in a tuple. Two of them had been retired from the free tier — *"this model is
> unavailable for free; the paid version is available now"* — and the file went on naming them.
> That is the exact shape of the thing being asked about: a fault nobody at the board can see,
> that needs somebody outside to go and read a provider's catalogue. It is now discovered rather
> than declared (`tutorboard/freechain.py`): both catalogues are asked, ranked by a PREFERENCE
> list rather than a permission list, so a model published tomorrow is in the chain tomorrow and
> the chain never empties when a favourite is retired. Retired models are remembered for a week; a
> 429 is not a retirement. And the handwriting was being read by a **paid** vision model, on a
> tutor whose entire reason to exist is costing nothing — that was one credit balance away from
> answering "insufficient credits" to every page the student handed in.
>
> **`board free` is the command that replaces the debugging session.** The board is up, a tutor is
> attached, the log is empty, nothing arrives — everything above the model is fine in that state
> and looks fine. `board free` walks the chain and asks it, `--deep` also asks it to read a page,
> and `board doctor` now ends with the same picture off the cache. `scripts/setup-mac.sh` proves
> the chain answers before it says the machine is set up.
>
> **The egress probe was asking after the wrong building.** It is what tells a failed turn apart
> from a broken network, and it was pinned to Anthropic's endpoint because the default agent was
> Claude Code. On a machine teaching for nothing that is a question about a server the tutor never
> opens a connection to — Anthropic answering proves nothing when the free providers are the ones
> an exit node is being challenged on, and Anthropic being blocked would report a broken machine
> that can teach perfectly well. The default now follows what the machine teaches with;
> `egress_probe` in the config still beats both, because the board is still not allowed to know
> which assistant is driving it.
>
> **And a failed turn now says why on the iPad.** It used to say `exit 1` — true, identical for
> every cause, and a dead end for anybody who is not going to read a log. The turn had almost
> always already said something better one line further up (*"every model on the chain deliberated
> instead of writing a card"*, *"no provider key on this machine"*), so that is the sentence the
> board is handed, with the exit code kept on the end for whoever does open the log.
> `failure_reason` in `bin/tutor`.
>
> ### Where this was on 3 September 2026 (night)
>
> **There is one board now, and one method, in every repository.** Reported from Algo-Solutions:
> *"I don't like the tutoring interfase. This whole ready to check button, etc. is messing with my
> mojo from when I was doing Galois Theory. Just make how we do the tutor in Galois Theory the norm.
> Don't have a 'code' mode any more. Any tutor should be able to understand when I tell them via
> typing or writing that I just implemented a change."*
>
> **A `mode` was one word in `tutorboard.json` and it forked almost everything.** `math` or `code`,
> declared or GUESSED by walking the tree for a `.tex`, and from that one word came: which teaching
> method was delivered into `live/TEACHING.md`, what the cold-start prompt told a headless tutor,
> whether `board push` archived the lesson or left it open, what the contents drawer said when a
> repository had no chapters, and whether the bottom of the screen carried an answer panel or three
> tap-buttons — *ready to check*, *I need help*, *I'm confused*. Two boards, and switching course on
> the same iPad switched interface. It is gone: `config.py` no longer has the key, `guess_mode` and
> `for_mode` and `code_sense` are deleted, and `read_config` POPS a `mode` still sitting in a
> course's own file, because those files are in the course repositories and a stale key must never
> be why two boards differ.
>
> **What actually differed between two kinds of repository was one thing, and it was never the
> mode's to say.** Where the exercises come from: the end of a section, in a book, or whatever the
> README points at. That is now read off what the repository HAS — a syllabus, or not — which is a
> fact rather than a declaration, and facts do not go stale. `review.units` was already doing
> exactly this to decide whether a test review covers chapters or the repository's own parts, and
> `session_sense` now asks the same question. A repository with no book gets `where_sense`: read the
> README, follow what it points at, do not manufacture a curriculum out of its headings, ask rather
> than choosing an agenda. Which is every useful sentence the old `code_sense` had, minus the second
> interface it dragged along.
>
> **The signals are gone and nothing replaced them, which is the point.** *Ready to check* was a tap
> that meant "go and look at something", without saying what or why. A written or typed turn says
> the same thing and carries the sentence that makes it useful, and every course has had both since
> the answer panel was unified. The server still ACCEPTS `done`, `help` and `confused`: the iPad
> serves a cached shell, a device that has not picked up `board-shell-v83` yet still has the buttons
> on it, and a 400 in reply to a tap is a lesson that stops.
>
> **`stance` stays, and it is the only thing a repository still declares about how it is taught.**
> `teach` or `do` — TRD-EHR asked in writing for the work to be done rather than set, and it still
> gets that. It is a paragraph appended to the one method rather than a method of its own, which is
> what it always claimed to be and now demonstrably is.
>
> **And the other half of the ask: a course is somewhere its owner WORKS.** *"If I decide to vibe
> code in one of the repositories straight in the terminal without using the tutor, I can do that
> without it messing anything up or GETTING messed up by anything related to the tutoring."* Two
> real defects, both in machinery that runs unattended with nobody watching what it does to git.
>
> The first: **`git commit` commits the INDEX**. The transcript beat ran `git add -A live` and then
> committed — and so also committed whatever had been staged in a terminal a moment earlier, under
> the message *lesson transcript*. Nothing in the beat wanted those files and nothing in it knew
> they were there. The commit names its pathspec now (`--only -- live`), which takes the transcript
> from the working tree and leaves the rest of the index exactly where it was.
>
> The second: **nothing automatic may write into an operation somebody started.** A rebase, a merge,
> a cherry-pick, a revert, a bisect, or a detached HEAD all mean a terminal here has its own plan for
> the next commit. `tutorboard/worktree.py` is that question, asked off the files git itself keeps —
> no `git` call, so it cannot hang on a lock — and every writer asks it: the beat does nothing that
> tick and says why in its log, `sync` and `tool_pull` do not fast-forward, `board push` and the
> board's save button say what is in the way rather than committing, and `catch-up.sh` leaves the
> repository exactly as it is instead of stashing and resetting around it. `catch-up.sh` had a
> sharper version of the same hole: on a detached HEAD, `rev-parse --abbrev-ref HEAD` returns the
> string `HEAD`, `origin/HEAD` exists in most clones, and the two together were enough to reset
> somebody reading around an old commit onto the remote's default branch.
>
> `test/beside.py` is the new suite and it runs the shipping code against real repositories: a
> genuine conflicted rebase left on disk, a staged refactor that survives the beat untouched, a save
> that refuses and says so on the board. `test/modes.js` now asserts the absence of what it used to
> assert the presence of. Shell version `board-shell-v83`.
>
> ### Earlier on 3 September 2026 (evening)
>
> **A new session had three kinks in it, and all three were the board being silent about
> something it knew.** Reported on relaunching Galois Theory on the iPad against a tutor hosted
> from the compute node: *"The tutor was sluggish to start up... But the tutor was just marked as
> dead or not available or not listening in the app. If the tutor is 'waking' up, I should be told
> that. It seemed to tell me the tutor was dead which put me in 'send again' mode leading to
> massive confusion. And another issue is that none of the boards have my preserved written work on
> them. I think the work is still saved."* Then, while it was being looked at: *"The tutor also
> appears to be very non responsive. Now it's just hanging. I need you to make the tutor way more
> robust. I don't ever want to be left hanging."*
>
> **A tutor coming up now says so, because the board had no word for it.** Starting one brings the
> tailnet link up, starts the board, opens the sitting, reads the addresses back and catches the
> repository up from the remote — and every second of that happens with the board ALREADY SERVING
> the iPad. For the whole of it the only record on disk was the LAST run's, whose pid is gone,
> which the board read as `stale` and said out loud as **"tutor stopped — nothing is reading the
> board"**. That is the same sentence a course that never had a tutor gets, and it is the specific
> thing that makes somebody send again. There is a `waking` state now, written before any of the
> slow work — by the launcher the moment a start is decided, and again by the daemon with its real
> pid — and it expires, so a start that fell over does not go on claiming to be in progress. The
> chip says *claude is waking up…*, amber and pulsing rather than red.
>
> **And the catch-up moved off the request that asked for it.** `agent_start` was doing a
> `git pull` — up to sixty seconds against a remote over a tailnet that may itself be coming
> back — *before* it forked, inside the HTTP request from the iPad. `spawn.tutor_cli` allows that
> request thirty seconds. So a slow remote did not make the start slow, it made the start get
> KILLED before it had spawned anything, and the board then sat waiting on a record that was never
> going to appear. Every session still begins by catching up; it now does it in the daemon, where
> nobody is holding a request open.
>
> **Work handed in with nothing reading the board now starts a tutor.** `board wait` only ever
> returns to a daemon that is already running, and nothing else drains the inbox — so a send to a
> board whose tutor had died, or had never been started, went onto disk and stayed there. This was
> also true of *ask the tutor to begin*, whose entire purpose is a board with nobody on it: a tap
> with no daemon running was a tap that did nothing, for ever. Every route that appends to the
> inbox calls `spawn.wake_tutor`, which is the same `tutor agent start` the hub tap and the login
> hook use — one implementation — and is a no-op unless the board really is unattended.
>
> **Nothing a reader can be waiting on is silent any more, and that is the whole of "never left
> hanging".** The strip under the lesson knew two things: the wire (*sending to the tutor*, which
> expired after a hundred seconds and then vanished) and the turn (*the tutor is writing*). Between
> them sat every state that actually goes wrong, and the strip's answer to all of them was to hide
> itself — and a blank space where "sending" was is indistinguishable from a send that never left.
> Worst of the three: **a turn that FAILED wrote `last_error` and went back to waiting**, so the
> chrome said "claude listening", the strip disappeared, and the student was looking at their own
> handed-in working with nothing coming and no way to know it. The daemon was robust; it recovered
> from every one of those failures. It never told anybody one had happened.
>
> They are one question now — *is there something in the inbox that nothing has picked up* — and
> the server answers it off disk (`notes.waiting`), which is what makes it survive a reload, a
> second device, and the daemon being restarted underneath it. So the strip says *claude is still
> waking up — your work is in its inbox and will be answered. No need to send again.*, or *no tutor
> is reading the board*, or *claude's last turn failed — the turn ran too long and was stopped. Send
> again to retry it.* A failure the daemon is retrying says so and is not painted as a dead end; an
> allowance that has run out is named, because nothing is broken. Failures are stamped with when
> they happened and stop being reported once a turn has succeeded — a failure from an hour ago is
> history rather than news.
>
> **And a long turn is counted from the daemon's clock rather than this page's.** The elapsed time
> started when the browser first SAW the working state, which on a reload, on a second device, or
> on a board picked up halfway through is nowhere near when the turn began. A four-minute turn read
> as "8s" to whoever had just picked the iPad up.
>
> **The preserved working was never lost. The arithmetic between the disk and the screen was.**
> The surface took the list of saved pages as its array and addressed the page at index *i* on the
> next save as `page-(i+1)`. That is the same sheet only while the numbers on disk are gapless —
> and they never are, because a file appears when a page is SAVED, so a page cut and never written
> on leaves none. In that sitting `page-01`, `-06`, `-08` and `-10` had never been saved, so after
> a reload index 5 was `page-09`, and the next stroke on it was written to `page-06`.
>
> The fingerprint is all over that directory and it is unmistakable once you know to look:
> `page-13`/`page-14` byte-identical, `page-21`/`page-22`, `page-34`/`page-35`,
> `page-41`/`-42`/`-43` — each one a page written back out under its neighbour's number, silently,
> while every board on the screen pointed at somebody else's sheet. It is also why
> `live/slate/page-99.json` exists in a sitting that reached fifty-three pages.
>
> **A page is its number now, and it carries it.** The number comes off the FILENAME rather than
> from the field inside the file — that field was written by whichever client saved it, and a
> client that had already slid is a client whose field is wrong too; the filename is what the next
> save will address, which makes it the only thing either side can agree on. Everything handed
> across the slate's API is a number: `at`, `go`, `fresh`, `clone`, `inkOn`, `adoptInk`, `preview`,
> and a new `hasPage` in place of comparing an index against a page count. The index is
> presentation and never reaches disk.
>
> Which means the mapping in `localStorage` — *which board is on which sheet* — is finally a record
> that can outlive the array it was written against, which it never could as a position. The key is
> versioned for it (`board.pages.n`), because every record written before this was an index, there
> is nothing in one that says so, and reading an index as a number is the same mistake in the other
> direction. `repairPages` builds the mapping back out of the turns on disk, which is where the
> authority always was: every answer handed in records the page it came off.
>
> Two smaller things fell out of the same read. `read_slate_pages` sorted by NAME, and the format
> is `%02d` for numbers that run to 999 — so a sitting past a hundred pages came back with its last
> hundred at the front. And a past board whose sheet no longer holds what came off it was already
> handled: it is drawn from the FROZEN answer in `live/answers/`, which is written once and never
> touched. That is why nothing was ever actually lost, and why the boards from that sitting come
> back showing the real working even though their recorded page numbers predate this fix.
>
> **And a fourth thing turned up while looking, which had already eaten pages off the disk.** Two
> clones run the transcript beat over the same course, and `git add -A live` commits a SNAPSHOT of
> whichever working tree it is standing in. Neither machine has the other's newest pages, so each
> snapshot DELETES the other's — and the next fast-forward pull checks that snapshot out and removes
> the files. Measured on this course: `live/slate/` pages 50 to 53, written between 10:13 and 10:25
> that morning, present in one line of history and physically absent from the working tree by 11:09.
> From the iPad that is the same sentence as the mapping bug — *"none of the boards have my
> preserved written work"* — except that this time the work really had gone from the sheet.
>
> Nothing in this tool ever deletes a slate page, an answer or a card except `board archive`, which
> RENAMES it under `live/archive/`. So a deletion whose basename is somewhere in the archive is
> accounted for, and anything else is a snapshot talking about a machine it is not on. Those are put
> back — on disk as well as in the index, which also repairs a clone already clobbered.
>
> **Both halves, because the pull is the destructive one.** Guarding the commit alone does nothing
> about it: a fast-forward checks the other machine's snapshot out and removes the files, and by
> then `HEAD` no longer holds them, so there is nothing left to restore from. The pre-pull commit is
> recorded and the same rule applied against it, which is the only moment that knows.
>
> And `--no-renames` on both diffs, which is load-bearing rather than tidy: slate pages are
> routinely byte-identical — a page cut as a copy of another, an attempt handed in twice, and this
> repository has four such pairs on disk — so a deletion paired with an addition of the same bytes
> is reported as a RENAME, and a rename is not a deletion. The files this exists to protect are
> precisely the ones that would hide behind it. The four pages were recovered from the divergent
> line and put back; the board serves all fifty-four again.
>
> **What is NOT fixed, and needs a person: two machines are running a beat on the same course.**
> This node and the Mac mini each hold a clone of Galois Theory and each has a tutor pushing
> `live/` every ninety seconds — the lesson advanced on the Mac's clone (card 0050, `t0011-r19`)
> while the slate pages advanced here. The guards above make that non-destructive, which is the
> urgent half, but they cannot make it CONVERGE: `--ff-only` refuses a diverged branch by design,
> so the beat now logs `not possible to fast-forward` for ever and the transcript stops reaching
> the remote. It was merged by hand twice and diverged again inside ninety seconds both times,
> because the other beat is still running. A course wants one owner, and which machine that is
> tonight is not a decision this file can make: stop the tutor on the other one
> (`tutor agent stop Galois-Theory` there), or point the address at it and stop this one.
>
> `test/waking.py` holds the server side — a start with no pid yet, its expiry, a record from
> another node, a stamped failure and its staleness, `notes.waiting` off disk, and the launcher's
> own ordering. `test/hanging.js` asserts the board has words for every state a reader can be stuck
> in, and against the old code it reproduces the report verbatim: *"tutor stopped — nothing is
> reading the board"* for a tutor that is waking. `test/sheets.js` is the gap — the exact page
> numbering that was on disk, and it asserts both that the board opens the right sheet and that the
> save addresses it by number rather than writing over its neighbour. Shell version
> `board-shell-v82`.
>
> ### Earlier on 3 September 2026
>
> **The lesson exports as the lesson, and the document can leave the app.** Two things asked for
> from the iPad in one breath: *"fix the 'local iPad export' of the homework and tutor session
> .pdf — first of all, for the tutor session export, I don't want the latex dump it currently
> gives; I want it as if it were a screenshot of the entire iPad screen scrolled down over the
> whole tutoring session. Second of all, when I try to do the local export on the iPad, it just
> opens the document up, and I can't put it anywhere. The only thing I can do is exit the app and
> go back in again."*
>
> **A photograph, taken by the thing that drew it.** `export this lesson` is now the board's own
> pixels — dark paper, the card chrome, the reading face, the handwriting sitting where it sits.
> `web/shot.js` rasterises a block at a time through an SVG `foreignObject`, packs the blocks onto
> A4 pages, and hands the server finished pages; `tutorboard/course/screenshot.py` wraps each in a
> PDF page, and nothing else. A JPEG goes into a PDF *verbatim*, as `/DCTDecode`, so there is no
> encoder and therefore no dependency — standard library, like the rest of it.
>
> **Which side does what is the whole of the design.** The pixels can only come from the client:
> there is no headless browser on a compute node and there never will be, so the only thing in the
> system that knows what the lesson looks like is the page that drew it. Everything a client must
> not be trusted with stays on the server — where the document goes, what it is called, which
> version it is, and that it is staged for the next commit — and it defers to `document.py` for all
> four, so `transcripts/` holds ONE numbered series rather than two. Export a lesson one way and
> then the other and you get v3 and v4 of the same lesson, which is the only question anybody asks
> of that folder. Pagination is the client's, because the client is the only side holding the pixels
> and therefore the only side that can cut a proof taller than a page without a JPEG decoder.
>
> **`export the whole course` stays typeset**, and that is not laziness: a filed sitting is not on
> the glass, so there is nothing on the device to photograph.
>
> **Six things were wrong in a way only a rendered page could show, and every one of them looked
> fine from the code.** Measured in WebKit — which is the engine that matters, and which disagrees
> with Blink on most of them:
>
> - **An `<img>` does not paint inside an SVG loaded as an image.** Not with a data URI, not with a
>   same-origin URL, not as a `background-image`, not as an SVG `<image>`, not as a cloned canvas.
>   Blink paints all five, which is exactly how this reaches a device unnoticed: the export works on
>   the machine it was written on and arrives on the iPad with every picture missing — which on this
>   page means every piece of handwriting, which is the half of the document that is the student's.
>   The pictures are composited straight onto the page with `drawImage`, from the elements the board
>   is already displaying; what goes into the SVG is the element itself, laid out and unpainted.
> - **`outerHTML` is not XML.** `<img>` is a void element and comes out with no closing tag, and a
>   parse error in an SVG image paints nothing at all. Two blocks of a test lesson went missing and
>   they were the two with pictures in them. `XMLSerializer` closes them. The same bug was eating
>   every radical sign, because KaTeX draws `\sqrt` as an inline `<svg><path/></svg>`.
> - **A comment with `--` in it is a parse error too**, and `board.html` explains itself at
>   length — like this — so its comments are full of them. That is why it was the WRITING SURFACE
>   that vanished and only that: a card is built by JavaScript and carries no comments, so the
>   export looked entirely correct while the one block holding unsent working was silently absent.
> - **`rem` is the font size of the document ROOT**, and a `foreignObject` fragment has no `<html>`.
>   Every `rem` resolved to the initial 16px instead of the board's 18, so `.mine { max-width: 32rem }`
>   came out an eighth narrow — which moved every right-aligned student turn sixty-three pixels and
>   left the handwriting drawn into it outside its own box. Viewport units are the same story
>   against the SVG's viewport. Both are resolved against the window the lesson is being read in,
>   before the SVG ever sees them, along with every media query — flattened, so there is nothing
>   left to disagree about.
> - **`body { min-height: 100vh }` made every card exactly one page tall.** The wrapper stands in
>   for body's LOOK, so body's rules land on it; that rule exists so there is something to paint the
>   bottom of a screen with. A seven-page document for four cards, each floating at the top of a
>   sheet of empty paper.
> - **And a card that had just arrived exported transparent.** `.card.fresh` animates from
>   `opacity: 0` with `both`, nothing animates in a still, and `both` means it renders the first
>   frame. The newest thing the tutor wrote is the likeliest thing anybody exports.
>
> **And the obvious fix for sharpness is the one that must not be taken.** Asking the SVG for twice
> the pixels — a `transform="scale(2)"` on a wrapping group, or a viewBox smaller than the width and
> height — rasterises at the right size and LOSES KaTeX: every display formula and every radical
> sign came out blank while the prose around them was perfect, so it reads on the device as "the
> mathematics is missing" and as nothing else. It is also unnecessary. WebKit re-rasterises an SVG
> image at the size it is being DRAWN at: measured on real output, the share of the ink that is a
> mid-tone edge — which is what softness is — falls from 52% at 1× to 27% at 2× to 22% at 3× for
> prose, and 59% to 41% to 29% for a display formula. Falling is re-rasterisation; a stretched
> bitmap holds its edge fraction or worsens it.
>
> The unit conversion then ate the fonts, which is worth its own line: the bundle carries every
> face inlined as base64, and base64 is full of things that look exactly like a length — `4rem+`
> and `9vh/` are each a digit, a unit name, and a word boundary. Rewriting one rewrites the middle
> of a font file, so the reading face fell back to a system sans and the declaration took the rules
> after it with it. Everything looked plausible and nothing was right.
>
> **And the way out of the document was an anchor, which was the trap itself.** `<a download
> href="/download/lesson">`: iOS honours `download` in a Safari tab and ignores it in a standalone
> web app, where the tap is a NAVIGATION — the board is replaced by the PDF, with no chrome, no back
> button and no share sheet. Both halves of the report are that one mistake, and this page already
> knew better about it somewhere else: `renderScratch` says in as many words that installed to the
> home screen there is no browser chrome, so anything opened in place has no way out short of
> killing the app.
>
> So the document is never navigated to. It is fetched and handed to the system as a file:
> `navigator.share` raises the native sheet OVER the board — Files, iCloud, a phone by AirDrop, an
> email to a professor — and Cancel returns to the lesson, because the lesson never went anywhere.
> The copy is fetched when the button APPEARS rather than when it is tapped, because Safari's
> transient activation does not survive an `await` and a share after a fetch is a share with no
> gesture behind it. Where sharing a file is unavailable: a blob URL with `download`, which saves
> without navigating either — and in the installed app, where that is ignored, a NEW context, which
> hands the PDF to Safari and its back button. A dead end in another app is recoverable; a dead end
> in this one costs the lesson.
>
> **And the write-up's button could never have appeared.** Three places guessed where a course's
> build puts its PDF and all three guessed the same way wrong — beside the source, then `build/`
> beside the source. `scripts/build.sh` does neither: it walks up to the nearest `chNN` / `hwNN`
> unit and compiles there, so `chapters/ch03-rings/homework/ch03-homework.tex` comes out in
> `chapters/ch03-rings/build/`, one level ABOVE the directory being searched. `hw.json` recorded
> `"pdf": null` on a build that had just succeeded, and the board offers the download only when
> there IS a PDF. The document was on disk the whole time and the button for it could not exist.
> `homework.compiled_pdf` is the one place that knows now, and it matches the source's own basename
> rather than taking any PDF in the directory — a chapter's `build/` holds `ch03-notes.pdf` beside
> `ch03-homework.pdf`, and a glob returning whichever came first hands somebody the reading for an
> evening they spent writing up exercises.
>
> `test/shot.py` follows every cross-reference offset in the written PDF to the byte, refuses bytes
> off the network that are not JPEGs, and proves both exports share one version series.
> `test/shot.js` holds each of the six rendering rules, and each fails on its own. `test/link.js`
> exercises all three routes out of the document and asserts the board is still what is on the
> screen after every one of them. Shell version `board-shell-v81`.
>
> ### Before this, 2 September 2026
>
> **A document you can take with you.** Asked for from the iPad: *"when we save the .pdf, we should
> also have the option to download it locally on the iPad so I can save it to files in my iCloud,
> get it on my phone, and email it to my prof, lickety split... I want an option to export the
> written up homework as well as the lesson."* With the emphasis stated twice: **both PDFs stay in
> the course repository and stay tracked in git**, exactly as before. That is the archival copy and
> nothing about it changed. This is the other half — a compute node is not a place an iPad can
> reach, and a tailnet path is not something anybody can hand to a professor.
>
> Three parts. `send_file` can be told to hand a file OVER rather than show it: a PDF is in the
> inline-safe list, so a browser given one renders it in the tab, which on an iPad is a preview with
> no obvious route into Files. An attachment goes to the share sheet, and from there to iCloud, a
> phone, or an email. The banner that already reports an export now carries **save a copy** beside
> it, offered only when there is actually a PDF — a `.tex` that would not compile is not a document,
> and handing over a broken one is worse than handing over nothing.
>
> And the written-up work has a button at last. It had none: the only way to compile the thing an
> evening was actually spent writing was a terminal, which is the one thing the board exists to
> abolish. `/hw/build` presses `board hw build` — the same compile the tutor runs and the same one a
> push runs before it commits a stale PDF, so there is one compiler and one record of what LaTeX
> said, which is also why a failure appears on the iPad instead of in a log nobody reads.
>
> **The client never names a path**, and that is the whole of the security argument. It names a KIND
> — the lesson, or the write-up — and `routes/taking.py` resolves it through the records the board
> already keeps: `live/export.json` and `live/hw.json`. A query parameter carrying a repo-relative
> path is a directory traversal waiting to be written and would buy nothing; there are two documents
> and the board knows where both of them are. The resolved path is still checked — it must end in
> `.pdf`, exist, and be inside the repository — because a record is on disk, disk is editable, and
> "it was ours a moment ago" is not a property that survives. `test/document.py` tries a path
> climbing out of the repository, an absolute path elsewhere, a `.tex`, a PDF that is not there, and
> no record at all.
>
> The file arrives named for its course (`Galois-Theory-ch07-homework.pdf`), because in a Files app
> it sits beside everything else a person owns and `ch07-homework.pdf` says neither whose it is nor
> what it is from — and the name comes from the SERVER, which is the only side that knows the course
> and the set. Shell version `board-shell-v80`.
>
> **The message was there. Nobody was looking at it.** Reported after the send feedback shipped:
> *"when I hit 'Send', I am immediately scrolled to where I want to be, and shortly see the 'the
> tutor is writing' message, but I want to IMMEDIATELY see a message like 'sending to tutor' in the
> time before the 'tutor is writing' message shows up."* It said exactly that, on the frame of the
> tap — under the writing surface, which at the moment of a tap is off the bottom of the glass,
> because the reader is halfway up a page of their own working. `revealSent` brought them down to it
> only after the round trip, by which time the tutor had often already reported working. The landing
> happens on the tap now. The settling repeats are unchanged, and still stand down the moment a card
> arrives.
>
> **And a card arrives a block at a time.** Asked as a matter of style: *"is there a way you could
> stylistically have the response from the tutor show up line by line instead of all just being
> thrown in one text block at once?"* A card is a file and arrives whole, so there is nothing to
> stream — this is a reveal of something already in hand, which is the honest version of the effect
> and the only one that cannot show a half-parsed formula. Blocks rather than lines, because the
> children of the body are what markdown produced and splitting inside a paragraph would break
> typeset mathematics. It runs AFTER the typesetting pass, never before: KaTeX cannot measure what
> is `display:none`, and a formula measured at zero width stays wrong for the rest of the sitting.
> The whole reveal is capped at 1.4s so a long card never becomes something you wait for, any touch
> of the page shows the rest at once, and it only applies to a card whose first line is already on
> the glass — animating one nobody is looking at is just a page changing height under a reader. It
> pairs with the rule above: the reader is stationary and the card grows downward into the space
> where "the tutor is writing" was.
>
> **A pinch stretches the picture it already has.** Reported from the iPad: *"occasional glitching
> out/lagging on the writing board when I try to zoom out. It was non responsive to my touch for a
> few seconds, and then it was fine."*
>
> Zooming out is the one gesture the cull cannot help with. The visible box grows, so fewer strokes
> are off-screen, so a rebuild that drew forty draws four hundred — and the view is baked into the
> cache, so it did that on every frame of the pinch. The few seconds are the pinch; the "fine" is
> the frame after it, when there is one repaint instead of sixty.
>
> Two answers. While two fingers are down the cache is not rebuilt at all: it is blitted with the
> transform carrying the view it was drawn at to the view now — the same trick every map does, and
> the same trade, a moment of softness while the gesture is live and crisp again on release, for one
> `drawImage` a frame whatever is on the page. And nothing is drawn finer than a pixel: the curve is
> resampled to about one logical unit, so zoomed out to a fifth it carried five points per pixel on
> the glass, and zooming out is precisely when a page is at its most expensive to draw. The thinned
> lists are kept per stroke per step so a pinch does not rebuild them every frame, endpoints are
> always kept so nothing gets shorter, and a stroke being written is never thinned.
>
> **The test for the erase repair had been measuring the wrong thing for a fortnight,** and the
> thinning is what exposed it. It compared an erase against a "full repaint" taken at a *different
> zoom* — `fitInk`, which frames the whole page — and that was only ever a comparison while the cost
> of a repaint did not depend on the zoom. It also counted the pen coming off, which invalidates the
> whole cache, so the number it called "the erase" was mostly one full repaint at the end. It now
> measures the SWEEP, which is the part a hand waits on, against a repaint at the same view, and
> asserts the clip actually happened — a hole with no other ink in it has no strokes to put back, so
> counting strokes alone proved nothing. `test/plane.js`. Shell version `board-shell-v79`.
>
> **The tap is answered on the frame it happened.** Asked for as: *"make the time between me
> hitting 'send' and something else happening more snappy so I don't get tempted to double send. If
> it takes a minute for it to say 'tutor is responding', say 'sending to tutor' until that happens.
> I want immediate feedback."*
>
> There was real work in front of a send and none of it was visible. `save` encodes the page to a
> PNG first, synchronously, because that picture is what is frozen as the answer — a few hundred
> milliseconds of main thread on a worked page, before the request is even made. Then the round
> trip, then the server waking the tutor, then the next payload before anything on the board
> changed. A button that swallows a tap for a second is a button that gets pressed twice, and
> pressing this one twice sends twice.
>
> So the label goes up on the frame of the tap and the work waits two frames — two, because a
> `requestAnimationFrame` callback runs BEFORE the paint it belongs to, so doing the encode in the
> first one blocks the very frame that was supposed to show the label. The strip that says what the
> tutor is doing says **sending to the tutor** from the tap until the tutor picks it up, which is a
> statement about the wire and not a guess about the tutor; it clears when the tutor reports working,
> when a card lands, or after a hundred seconds, because an inbox nobody is reading must not leave
> "sending" on the screen all evening. Send refuses a second tap until the first has gone, released
> on a timer as well so a hung request cannot take the button with it. The typed answer and a
> marks-only send do the same.
>
> **And a pen at work now refuses the scroll outright.** Reported as: *"I did just have a blip where
> I wrote down the first letter and it stopped writing. I paused for a couple of seconds, tried
> again, and writing continued fine."* That is a gesture being re-read as a pan. `touch-action` is
> evaluated when a gesture STARTS, and a `touchstart` can only be cancelled while it is cancelable —
> which it is not during a fling. So a stroke following hard on another, or one begun while the page
> was still moving, got a `pointercancel` instead of ink, and until everything settled nothing the
> pen did marked anything.
>
> A latch closes it: while the nib is being heard from, the layer carries `touch-action: none`, so
> the next stroke cannot be reinterpreted however quickly it follows and a finger landing in that
> window is a palm rather than a scroll. It opens again a second and a half after the pen goes quiet.
> Note what it does not do — it decides nothing by where the hand landed; it only stops one hand's
> gesture from being re-read as the other's.
>
> Two more ways a stroke could go missing went with it, both of which would read exactly the same
> from behind a pen. A lift the layer never saw — the nib leaving past its edge, the browser taking
> the gesture, the app backgrounded — left a stroke open for ever, and the window hears those now,
> as the slate always has. And a new stroke beginning while one was still open used to REPLACE it,
> which repaints the card without the samples already on the glass: a letter written and then taken
> away. It commits the one it interrupts. `test/link.js` holds all three.
> Shell version `board-shell-v78`.
>
> **A card arriving never moves the reader.** Specified from the device, after two narrower fixes
> had shipped and it was still happening: *"when I submit the response, I'm scrolled to the bottom
> of the written/typed response I just submitted, where I can clearly see the 'the tutor is
> writing...' message, and once the tutor response is available, have it start getting portrayed for
> the user to see line by line, WITHOUT scrolling the user down — they'll scroll their own way down
> to read the response."* The first telling named what it should feel like, which is any chat page
> on the web: the reader is stationary and the text grows downward past them.
>
> **The layout grants it for nothing, which is the good part.** Measured, rather than assumed:
> before a reply the run is `[question][live board]`, and after it is `[question][the same board,
> frozen][receipt][reply][the next board]`. The student's working keeps its PLACE in the run — a
> live surface and a dormant board are one box by construction, same head and same height, because a
> dormant board has to be indistinguishable from a live one — and everything new lands below it. So
> nothing above the reader changes height, the reply appears in the space under their working where
> "the tutor is writing" was, and it grows down through it. All that was ever needed was to stop
> aiming the page at it. `revealNewest` survives for the two places that are not this: the first
> paint of a lesson, where there is no reader yet to leave alone, and the jump button, which is
> somebody asking to be taken.
>
> **And a third mover, from the position a send actually leaves you in.** Reported once more:
> *"just submitted another board written response and got scrolled UP again to the middle of the
> last tutor response."* Nothing aimed the page anywhere that time — and nothing held it either.
> `revealSent` parks the reader at the FOOT of the writing surface, and the surface is the tail of
> the run and carries no card or turn id of its own, so every keyed node was above the top of the
> glass and the anchor walk found nothing and gave up. The receipt for an answer is then inserted
> beside the QUESTION it answers, which an hour into an exercise is several cards up the page, so the
> surface went down with it and what filled the glass was the bottom of the card above. The anchor
> now falls back to the last keyed thing above the reader. Not the surface itself, though it is what
> is being looked at: a reply MOVES it, because the next board opens under the newest word, and an
> anchor by that name would follow it down the page.
>
> The after-send repeats let go too. `revealSentSettling` re-lands on the surface's foot at 300ms and
> 900ms, to catch the receipt and the tutor's chip settling — but the moment the tutor replies that
> surface is a fresh blank sheet BELOW the card being read, and a repeat aimed at its foot drags the
> reader past the very thing they were waiting for. Two smooth scrolls with destinations either side
> of the new card is what "the middle of that message" was made of.
>
> `test/feedback.js` and `test/interactive.js` hold all of it, and the lesson from the first attempt
> is worth more than the fix: **a test for a scroll has to watch for a deliberate aim, not only for a
> shift.** The first version measured the shift and passed while the board overrode the anchor one
> line later, because `scrollTo` is a no-op in the harness and nothing was looking at it. The second
> version measured nothing at all, because it staged the receipt below the surface rather than above
> it — the condition is that the answered question is not the last card, and it has to be built that
> way. Both were caught by removing the fix and watching the test still pass.
>
> **And nothing on the page can be selected any more.** Reported alongside: *"I was also just
> writing on the board and the text 'skip' in 'skip this one' got highlighted, which doesn't hurt
> functionality but was an eyesore. Highlighting of ANY text should be impossible. When I annotate
> tutor responses, that's not highlighting either; it's only me marking it up."* Both halves are
> right. `#skip` lives in the writing panel's own header, inside `#board`, and the rule refusing
> selection was `body.annotating #board` — the lesson, only while annotate mode was on, and they
> were writing on the slate. It is the whole document now, always, with one exception: a text box,
> where selecting is how a sentence gets corrected. Worth more than the eyesore, too — once a native
> selection begins the browser owns the gesture and the pointer stream stops reaching the canvas,
> which is the "annotation intermittently stopped writing" defect from a fortnight ago.
> Shell version `board-shell-v77`.
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
TikZ compiled to cached SVG; the hub, with course discovery and switching;
the writing surface, docked in the lesson with its tools in the page chrome; slate pages saved as
strokes and as a PNG the assistant reads; the inbox and `board wait`; end-of-session commit and
push with no assistant attribution; Tailscale in userspace mode with HTTPS; the installed iPad app.

**Not verified, and only a person with the hardware can settle it:**

- *How the ink feels.* Smoothing, pressure response and palm rejection are all tuned blind. The
  knobs are `SMOOTH` and `RESAMPLE` at the top of `web/slate-core.js`.
- *How it looks.* There is no browser on the machine this was written on. Every visual judgement
  in here is inference.
- *Headless mode.* `tutor headless` has never been run against a real agent end to end. The
  `headless` recipes in the config are best guesses at each tool's non-interactive flags. The
  wrap-up turn that writes `HANDOFF.md` rides on that path and is equally unexercised.
- *What a usage limit actually prints.* The phrases in `usage_limit_says` are what the default
  agent is documented to say, not text anyone here has watched it emit. Everything downstream of
  the match is under test; the match itself is only confirmed the first time an allowance really
  runs out. If it turns out to say something else, that is one list in the config and no code —
  and the failure mode of a miss is the old behaviour, a turn that failed, rather than anything new.
- *macOS.* The platform paths in `tutorboard/`, `bootstrap.sh` and the LaunchAgent are written
  from the documentation rather than from use. Everything this repository is actually run on is
  Linux.

### Things that broke, and must not break again

Each of these cost a round trip to discover. They are all under test now; if a change makes one of
these tests fail, the test is right.

| What went wrong | Guarded by |
|---|---|
| The only way out of an exported PDF was an anchor, so on the installed app the tap was a navigation: the board was replaced by the document, with no chrome, no back button and no share sheet, and no way out short of killing the app | `test/link.js` |
| An `<img>` does not paint inside an SVG loaded as an image in WebKit — in any form — so every piece of handwriting was missing from the photographed lesson, on the device and nowhere else | `test/shot.js` |
| `outerHTML` leaves void elements unclosed, which is not XML, so any block with a picture in it rasterised to nothing — and so did every radical sign, which KaTeX draws as an inline SVG | `test/shot.js` |
| A comment containing `--` is a malformed XML comment, so the writing surface — the one block whose markup comes from `board.html` rather than from `render` — was silently absent from every export | `test/shot.js` |
| `rem` resolves against the document root and a `foreignObject` has none, so everything sized in rem came out an eighth small and the handwriting landed outside its own box | `test/shot.js` |
| `body { min-height: 100vh }` landed on the wrapper standing in for body, and every single card became exactly one page tall | `test/shot.js` |
| A card that had just arrived exported transparent: `.card.fresh` animates from `opacity: 0` with `both`, and a still renders the first frame | `test/shot.js` |
| Inlining the fonts as base64 and then converting `rem` to pixels rewrote the middle of a font file, because base64 contains things that look exactly like a length | `test/shot.js` |
| `shot.js` was deferred while `board.js` is not, so it did not exist when `board.js` reached for it and every photograph ended with a page of blank paper | `test/shot.js` |
| Three places guessed where a course's build puts its homework PDF and all three were wrong, so `hw.json` recorded `"pdf": null` on a successful build and the download button for the write-up could never appear | `test/shot.py` |
| A hand-written PDF whose cross-reference offsets are one byte out is a file no reader will open | `test/shot.py` |
| Two clones ran the transcript beat over one course, and `git add -A live` commits a snapshot of the working tree it is standing in — so each machine's commit deleted the other's newest slate pages and answers, and the next fast-forward pull removed them from disk. Four pages of a morning's working went that way | `keep_transcript_files` in `bin/tutor`, `test/waking.py` |
| A slate page was addressed by its POSITION in the list the server handed back, so one page cut and never written on — which leaves no file — slid every page after it onto its neighbour's number: every board came back pointing at somebody else's sheet, and the next stroke saved over a real page. Four pages byte-identical to their neighbours in one sitting, and nothing reported an error | `test/sheets.js` |
| `read_slate_pages` sorted the pages by NAME, and `%02d` on numbers running to 999 means `page-100` sorts before `page-99`, so a sitting past a hundred pages came back with its last hundred at the front | `test/waking.py` |
| Starting a tutor took several seconds of link, board, sitting and `git pull`, and for all of it the board read the last run's dead record and said *"tutor stopped — nothing is reading the board"* — the same sentence a course that never had a tutor gets, which is exactly what makes somebody send again | `test/waking.py`, `test/hanging.js` |
| `agent_start` did a sixty-second `git pull` before it forked, inside a thirty-second request from the iPad — so a slow remote did not make the start slow, it made the start get killed before it spawned anything | `test/waking.py` |
| A turn that failed wrote `last_error` and went back to waiting, so the chip said *listening*, the busy strip hid itself, and the student was looking at their own handed-in working with nothing coming and no way to know | `test/hanging.js` |
| Work handed in to a board with no tutor attached went into the inbox and stayed there for ever — nothing drains it, and `board wait` only ever returns to a daemon already running. Including *ask the tutor to begin*, whose whole purpose is a board with nobody on it | `test/waking.py` |
| The elapsed time on a turn was counted from when the BROWSER first saw the working state, so a four-minute turn read as "8s" to anyone who had just picked the iPad up or reloaded | `test/hanging.js` |
| Asking the SVG for twice the pixels — to keep the type sharp on a retina screen — rasterises at the right size and loses every display formula and every radical sign, while the prose around them stays perfect | `test/shot.js` |
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
| A board was asked to stand its tutor down while somebody was being taught on it, and the daemon answered the turn in flight, wrote its handoff and left — mid-exercise | `in_use` in the machines route; `test/keeping.py` |
| A restart brought back the tutor that was running rather than the one the config named, so a changed default never reached a course | `test/agents.py` |
| The default agent's command was not installed, so the daemon read as *listening* and failed every turn into a log | `test/agents.py` |
| A board whose node had died read as a tutor who had not written yet — same words, and a dot the size of a full stop for a difference | `test/link.js` |
| `board net` re-pointed the HTTPS name at a dead port, trusting a stale record from another node | `alive()` in `cmd_net` |
| An empty maths board could not be answered, asked, or prodded from the iPad at all: the first turn needed a terminal | `test/begin.py` |
| A writing prompt could not be declined, so an unwanted exercise had to be answered badly to clear it | `test/modes.js` |
| One word in `tutorboard.json` — `mode` — forked the teaching method, the cold-start prompt, the session boundary, the contents drawer and the whole bottom of the screen, so switching course on the same iPad switched interface | there is no mode; `test/modes.js` asserts the absence of what it used to assert the presence of |
| The transcript beat committed the INDEX, so a file staged in a terminal ninety seconds earlier went into history under the message *lesson transcript* | the commit names its pathspec (`--only -- live`); `test/beside.py` |
| Nothing stopped an unattended commit, fast-forward, stash or `reset --hard` landing in the middle of somebody's rebase — and on a detached HEAD `catch-up.sh` read `rev-parse --abbrev-ref HEAD` as a branch called `HEAD` and reset onto `origin/HEAD` | `tutorboard/worktree.py`, asked by every writer; `test/beside.py`, `test/catchup.py` |
| The writing surface vanished after closing and reopening the app: it survived a send only through an in-memory pin, and a pin is a variable | `test/link.js`, `test/modes.js` |
| The contents drawer laid out in the flow of the page under the lesson rather than over it: it carried a comment saying it borrowed the scratch drawer and an empty rule that borrowed nothing, because an ID selector is not inheritance | `test/review.js` |
| A sitting badge reading `TEST REVIEW` pushed the chapter label to `Tes…` and the tutor chip to `no` — the title bar is the one row on this page that cannot grow | `test/review.js` |
| *"I can't see the refresh button when I tap the '...' menu."* The overflow menu hangs off `#chrome`, which is stuck to the top of the window — so an entry past the bottom edge of the glass is not below the fold, it is **unreachable**: scrolling the page moves the lesson, not the menu. Thirteen entries at the reading type size somebody actually uses is past the bottom of an iPad in landscape, and it got there one entry at a time with nobody counting. The title bar being the row that cannot grow is why the menu exists; nothing said the menu could not grow either | it scrolls, capped at `100dvh` in CSS as a floor and at the room actually measured under the bar when it opens — the banners in the chrome stack change that, and every one of them is up at the moment somebody goes looking for the reload. Plus a fade at the bottom edge while there is more, because on iOS a scroller shows no bar until a finger is already on it, which makes a capped menu and a truncated one look identical; `test/chrome.js` |
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
| A course tapped in the hub started its board and moved nothing: the one address the app is installed against went on opening the course before it, which reads as a tap that did nothing | the machine serving takes the tailnet name for the course it opens, in the request; `test/choice.py`, `test/hub.js` |
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
| The write-up compiled and then could not be reached: *"it compiles the homework, but it's not letting me view the compiled .pdf or save it anywhere locally on the iPad."* `doExportHomework` painted the banner from a record it had invented itself — the reply to `/hw/build` — in the argument slot that belongs to `push.json`, so the next payload a second later repainted from the real push record and took `save a copy` with it, along with the URL behind it. And there was no way to READ either document at all: the one control was the share sheet, which is somewhere to put a document rather than somewhere to read one | whether a document exists is a question the payload answers off the files (`papers`) on every change, and the write-up's own record reaches the banner from `live/hw.json`; **read it** draws the pages as PNGs rendered by the machine holding the PDF, in a panel the board owns — never an `<iframe>`, which iOS gives one unscrollable page, and never a navigation; and **⋯ → documents · view or save** reaches both at any moment rather than only in the banner of the build that made them. The service worker stopped caching `/download/` while it was there; `test/paper.py`, `test/link.js` |
| `board export` wrote the tutor's cards and nothing else, named with the second it happened, into `live/export/` -- which a course's `.gitignore` throws away. Half a conversation, unfindable, unkept. Asked for instead: the whole thing as one PDF to show a professor | `document.py` interleaves every card and every page handed in, in the board's own reading order and labelled by attempt; it lands in `transcripts/<lesson>-vN.pdf`, is staged in git, and `--all` makes one document of the whole course; `test/document.py` |
| A card arrived that was the model thinking out loud, with no tag anywhere in it -- the whole reply was the thought, so every strip in `tutorboard.reasoning` passed it through. Eight hundred tokens of deliberation, cut off mid-sentence, as the lesson | `reads_as_reasoning` judges voice rather than syntax -- a card is addressed to somebody, deliberation is about them -- and every caller refuses rather than edits: `board write` writes nothing, and the board, the recap and the export show a notice in place of a card that got to disk another way; `test/reasoning.py` |
| A save was addressed to "the current page", not to a page. A queued save therefore carried whichever page was in hand when the wire freed up — so switching page while one was in flight left the page being LEFT with an older version of itself on disk. Invisible until the board began switching pages on its own, and then it was ink lost | saves carry a page number, `dirtyPages` remembers which pages are owed, and a page is cleaned only if it did not change while its save was in the air; `test/plane.js` holds a save open on the wire and checks what the queue does with it |
| A follow-up question landed on a blank board while the working it was asking about sat on the board above. Not a defect -- a question card is a new question and a new question gets a blank sheet -- but wrong in the middle of an exercise, and unguessable from a card kind | a blank board with working behind it offers to carry it over, one tap, as a copy; the person decides, because a new exercise opened on the last one's proof is worse than a blank sheet; `test/chain.js` |
| A skipped homework problem was dropped. One sentence told the tutor what a skip meant — "do not re-ask it, carry on" — which is right for a concept check and expensive for an assigned problem, where a skip is a lost mark and the student means *not now* | `skip_sense` reads the sitting: in homework the skip defers and names what is still owed, off the document rather than off anyone's memory; `homework.outstanding`, `board hw`, `test/begin.py`, `test/homework.py` |
| A written answer was shown twice: a frozen picture of the ink under the question, and the board carrying the same ink under the feedback — one of them dead, and the dead one was the one you met first scrolling back up. The freezing was right when the slate was ONE surface that got written over, because then the picture was the only copy of what had been handed in; it stopped being right when every question got a page that is never wiped | the board is the answer; the turn keeps its heading and one line pointing at it, and the picture returns wherever there is no board — a filed lesson, a past one, a browser that never held the page; `test/feedback.js`, `test/interactive.js` |
| Getting an exercise RIGHT deleted every writing board in the lesson. The boards were painted only while an answer was *owed*, and a `correct` card owes nothing — so finishing a problem left the transcript as frozen pictures of what had been sent, with no surface under any earlier question to add a line to. A picture is a record of an answer, not a place to write one | the boards are painted for the whole live lesson; the one question that goes without a picture is the one the real surface is sitting under; `test/feedback.js` |
| Pressing *type* did nothing on a question already answered in ink. `panelKind` read the question's history before anything else, and a sent ink turn answered "write" whatever the tabs were told — so the press set the remembered kind, repainted, and was overruled on the way back. Which is every question worth typing about: you write the proof, the tutor asks what you meant by a line of it, and the answer to that is a sentence | `pickedKind`, recorded against the question the tab was pressed on and read before the history — the same rule as `chosen.json`, that a decision outranks an inference; `test/feedback.js` |
| The node never pulled the board. Every session pulled the *course*, and no timer can keep a machine that ceases to exist current — so a node ran whatever it was last pulled by hand, indefinitely. And a pull that bounces nothing leaves the boards and tutors serving the old code: a fix reaches the disk and not the lesson | `tutor` and `tutor resume` pull this repository, re-exec onto it, and then `tutor restart --tutors`; `test/resume.py` |
| ...and the first version of that fix could not say it had happened: `execve` throws away whatever is sitting in the process's buffers, and stdout is a pipe or a log file every time this runs for real — so the one line explaining why the board changed under somebody's lesson was dropped on the way out | a flush before the exec; `test/resume.py` drives a real clone and reads what it printed |
| A deploy dropped somebody mid-proof into a different course: starting a board claimed the tailnet name unconditionally, and `tutor restart` restarts every board on the machine one after another — so the address ended up wherever the course list happened to end. The installed app has one URL baked into it and no way to say which lesson it wanted | `ts_repoint` will not take a name from a board that is still answering; `board vpn serve` is the one command that does, because that is a person asking; `test/address.py` |
| An evening's homework was written up and could not be typeset. Two causes wearing one face. A course's `.claude/settings.local.json` was written the first time its board started and never touched again, so a course created before the LaTeX grant existed was never going to get it — and the tutor, refused the compiler, reasonably concluded the machine was the problem. Underneath that, `board hw build` handed the course's own `scripts/build.sh` whatever `PATH` the board process happened to have, which for a detached board is `/usr/bin:/bin` and nothing else — so there was no `pdflatex` to find. The sheet was complete and correct the whole time | the grant covers `pdflatex`, `latexmk`, the course's build script and the rest of the toolchain, and `install_permissions` now tops an existing file up instead of skipping it — appending only what is missing, so a course's own list survives intact; the build runs under `tutorboard.tex.tex_env()`, which knows every place a TeX gets installed here; `test/agents.py`, `test/homework.py` |
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

Answering happens in one panel under the question: the slate and a typed half, and a toggle
between them. Whichever the student used last is the one that opens next. Nothing has to be
typed anywhere else, in the app or in a terminal.

### The first turn

An empty board is the one place that rule left a hole. With no card there is no question, so no
answer is owed, so nothing opens the slate — and in mathematics there is no box to type in either.
The board was a dead end until somebody went to a terminal and prompted the assistant, which is
exactly the ceremony `tutor` exists to abolish.

So an empty board carries one button, **ask the tutor to begin**. It sends a `begin` signal — a
tap that carries its own meaning, not a composer — which lands in the inbox as an ordinary unread
message and so wakes `board wait` like anything else. Sending it makes the board
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

In a repository whose work is code the unit is a change made in the student's own
editor, and it is posed, laddered and re-posed exactly as an exercise out of a
book is. When a turn says it has been implemented — typed, or written on the
slate — the tutor goes and reads what actually changed, and locates the break
rather than repairing it. The rest of the discipline is identical, because it is
the same discipline.

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

## Setting it up on the cluster

One script does the whole of it, in the shared home, where every node you are ever given can see
it:

```
git clone https://github.com/<you>/Tutor-Board ~/Tutor-Board
cd ~/Tutor-Board && bash bootstrap.sh
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

### One identity, whichever node you were given

The tailnet identity is one machine that moves, and that is the whole of why the iPad's address
survives an allocation ending: the registration lives in the shared home, so `compute304` and
`compute309` are the same `*.ts.net` name a week apart. The machine's own name still changes with
the allocation, because it is a different machine and every ownership check depends on knowing
that — see [`board node`](#one-address-and-the-machine-holding-it).

If you ever run a second machine, give it a name of its own (`bootstrap.sh --name`, or `board vpn
up --hostname <name>`) and install the board on the iPad from each. An address only ever opens a
board on the machine holding it, so two machines mean two icons — this tool is written for the one
on the cluster.

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

### `salloc` is the whole of it

**The machine you were given has nobody on it.** `salloc` grants an allocation and hands you a shell
on the **login node**; the compute node itself never gets a login, so "the only moment a compute
node gets" was a moment that never arrived unless somebody opened a terminal on the node by hand and
left it open. That is the ceremony: the allocation exists, the machine is yours, the board is not
running, and the thing standing between them is a person keeping a second session alive on a laptop.

So the login node hands the whole command over. `tutor resume` on a machine that holds an allocation
it is not part of runs the same command on the node instead, and everything that decides anything
happens over there — the node pulls this repository, re-execs onto what it pulled, bounces whatever
is holding the old code, starts the board for the course you were last in, re-points the tailnet
name and attaches a tutor. The login node only ever decides which node to knock on.

Which node, in three rules: the one a board is already on, because a live board is never moved; then
the allocation this shell belongs to, since `salloc` puts its job id in the environment of the shell
it starts; then the newest allocation. Only ever a node Slurm says is yours.

It goes in over **ssh**, which leaves nothing behind on the login node: the board ends up in the
node's own session, exactly where it sits when somebody opens a terminal there. Where ssh cannot get
in — a cluster whose credentials do not reach the nodes — the work goes into a **Slurm step**
instead, which needs no credential of its own and which holds itself open for the life of the
allocation. That last part is not decoration: everything a step starts lives in the step's cgroup,
and that cgroup is emptied the moment the step ends, detached or not.

```
salloc …                     and nothing else
tutor resume --no-hop        do it here, wherever here is
TUTOR_BOARD_NO_HOP=1         the same, for a shell
```

One line lands in `~/.tutor-resume.log` either way, naming the node and what it said. That is
deliberate even under `--quiet`: quiet is for a login with nothing to do, and this one crossed a
machine.

To make it automatic:

```
bash scripts/install-autostart.sh --login-hook
bash scripts/install-autostart.sh --uninstall
```

That appends a marked block to `~/.bashrc`, which the shared home puts on every node **and on the
login node** — which is the point of it being on every shell rather than only on the ones you open
on a compute node. It is what keeps the node current: a fix shipped from anywhere is pulled, the
launcher re-execs onto it, and
anything still running the old code is bounced — see
[Every session starts by catching up](#every-session-starts-by-catching-up). It runs in
**interactive shells only** — a login file that writes to stdout breaks `scp`, `sftp` and
git-over-ssh with a remote error nobody can read — takes a lock so five terminals do not race, and
backgrounds itself so no prompt ever waits on the network. `~/.tutor-resume.log` has whatever it
said; `export TUTOR_BOARD_NO_RESUME=1` turns it off for one shell.

The board is up for as long as the allocation is, which is the honest ceiling on a cluster: nothing
on a node outlives the job that gave it to you.

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

**It lives as long as the machine does.** On a cluster node your processes live and die with your
allocation, so the daemon goes when the job ends — which is the same ceiling everything else here
has, and the reason a session's continuity is written to a file and pushed rather than held in a
process.

### What a session costs, and why that is a design question

**A turn is charged for its round trips multiplied by the conversation behind
each of them.** That sentence is the whole of it, and everything below follows.
The lesson is already on disk, so nothing has to be carried in a conversation to
survive — and carrying it anyway is the most expensive thing this tool can do.

The unit that matters is **tokens through the model** — input, output, and cache
both written and read — because on a subscription what runs out is a five-hour
allowance and that is what it is computed from. Dollars are given below as well,
for a machine on a metered key, but they are the second column.

It was carrying the conversation. Measured in Galois Theory on 8 September 2026 —
eleven cards on `claude-opus-5[1m]`, one session resumed throughout, read out of
the agent's own transcript:

| turn | context held | round trips | tokens | cost |
|---|---|---|---|---|
| 1 (cold) | 74k | 18 | 1.14M | $2.24 |
| 3 | 96k | 8 | 0.76M | $1.36 |
| 8 | 152k | 36 | **5.22M** | $4.49 |
| 11 | 176k | 8 | 1.39M | $2.43 |
| **session, 11 cards** | | **150** | **17.9M** | **$25.40** |

The context column is the story. It is *not* the cache expiring: a resumed turn
re-caches only its increment, measured at 40 tokens on a 43k conversation. It is
that turn eleven paid, on each of its eight round trips, to read back ten turns
of history it would never look at again. 1.6M tokens a card, rising, for a lesson
that fits on two sides of paper.

**Measured after the change, on a copy of that same course:** a turn takes
**225k tokens over 6 round trips**, and 443k on the very first turn in a
directory whose harness prefix is not yet cached. That is **one seventh** of what
a turn was taking, and it does not climb — so a response that took 5% of a
five-hour window takes something near 0.7% of one now.

**So a turn is its own session.** `session_turns` is 1. Every turn starts cold,
reads what it needs back off disk in two calls, teaches, writes down what the
next turn needs to know, and dies. Nothing accumulates, so nothing grows.

- **Two calls, and they are the whole cold read.** `board brief` is the standing
  rules — the method as a paragraph, this course's own *rules that do not bend*,
  the chapter's handoff, and the note the last turn left. `board recap` is the
  lesson — every card as a line, the newest in full, the student's turns, which
  question is open. Together about 4.5k tokens. They replaced
  `AI_INSTRUCTIONS.md` (9.1k), `live/TEACHING.md` (9.5k) and `HANDOFF.md` (5.4k)
  read in three round trips, and the full documents are still on disk with their
  sections named for the rare rule that needs its detail.
- **The harness prefix is free.** A second `claude -p` in the same directory
  reads its 28k-token system prompt out of cache for $0.015, because the cache is
  keyed on the prefix and not on the session. Measured. This is why a fresh
  session per turn is cheap and why it was not obvious that it would be.
- **`live/NEXT.md` is what replaced the conversation.** A recap says what was
  asked and what came back. It cannot say that the student is reading a ∃ as a ∀,
  that this is the third attempt at the same line, or that the ladder is aimed at
  the witness rather than the algebra. Every turn writes that with `board note`,
  capped at 120 words, and the next turn reads it out of the brief.
- **A turn does not wait, and `board wait` now refuses it.** Turn 8 above is what
  that cost. The course contract documents `board wait` as the way to be woken —
  true, and correct for a person at a terminal — so a headless tutor reading the
  contract ran it at the end of its own turn, held the whole conversation open
  while the student thought, and answered their next message inside it. Two cards
  in one turn, 36 round trips, $4.49. No wording could fix it, so
  `board wait` asks `live/agent.json` whether a headless turn is in flight and
  says no; the daemon's own waiter passes `--force`, because it is the one caller
  that is not that turn.
- **The handoff is capped by a door, not by a request.** The prompt has said
  "under 350 words" since the day this could bill by the token. The file was
  3,824 words. Nothing had gone visibly wrong: `live/TEACHING.md` listed
  "updating `HANDOFF.md`" among the things a turn involves, every turn duly read
  it, edited it and handed the next turn a longer one, and each edit was
  reasonable on its own. Now `board handoff` is the only thing that writes it, it
  refuses a body over the cap rather than trimming one — the useful half of a
  handoff is at the bottom — and a teaching turn is told not to touch it at all.
- **The recap's own card list is bounded.** It was the last thing that grew with
  the lesson: a hundred and seven cards is 6.4k of titles, read at the start of
  every turn. It now names the last forty and counts the rest, which is what a
  turn reasons about — the older end of a chapter is what `HANDOFF.md` is for —
  and `board recap --all` still prints the lot.
- **Sessions are still recyclable.** `session_turns: 0` resumes for ever, which
  is right on a flat rate and wrong on a meter; any N recycles after N turns,
  which is what this was.

**What is left, and why it is left.** Two things were measured and deliberately
not changed.

*Output is the one lever left, and it is the expensive kind of token.* 3.2k
output on the measured turn — small against 225k total, but on a metered key it
is $0.08 of a $0.39 turn, and a card is a few hundred words, so most of it is
thinking and tool arguments. `--effort medium` cuts it, and the recipe has an
`extra_args` field to put it in. It is empty, because that is a teaching decision
and not a cost decision, and this repository does not get to make it on the
student's behalf.

*The slate PNGs are fine.* Handwriting arrives at most 1415×762, about 1.2k image
tokens, and downscaling handwriting to save a fraction of that is how a tutor
comes to misread a proof. Measured, and left alone.

*And one thing that had not gone wrong yet.* The model is `opus[1m]`, from the
machine's own Claude Code settings, and the largest single request across every
Galois session measured **189,588 tokens** — five per cent short of the 200k
line above which a long context is charged and weighted differently. Twelve
cards was under it; fourteen would not have been. A turn now holds 22k to 44k,
so the 1M window buys nothing and the line is nowhere near. If you want the
standard variant anyway, `extra_args: ["--model", "opus"]` on the recipe pins it
for the tutor without touching what you use at a terminal.

None of this is allowed to cost teaching quality, and the rule cuts both ways: a
change to how the tutor teaches is also a change to what it costs, so a new rule
in `TEACHING.md` is weighed the same way. `test/tokens.py` holds all of it.

### What it actually cost, which is not a matter of opinion

Every claim above is a measurement, and the measuring is now part of the tool
rather than something somebody did once by hand in a session transcript.

`--output-format json` on the recipe makes the agent report what its turn cost.
Every headless turn appends one line to `live/cost.jsonl`, writes a summary line
into `agent.log`, and `tutor cost` adds it up:

```
tutor cost                # the course an assistant is attached to
tutor cost galois --turns # every turn, oldest first
tutor cost --all          # every course on this machine
```

```
when                 turn session  trips     tokens  cacheread cachewrit      out     cost
2026-09-08 11:34:11     1 fresh       10     442.6k     392.5k      43.0k     7.0k    0.804
2026-09-08 11:38:02     2 fresh        6     225.5k     201.1k      21.2k     3.2k    0.394

Galois-Theory — 2 turn(s) on compute301, 2 of them their own session
  334.0k tokens a turn  (1.19% of a window), 8.0 round trips a turn
  668.1k tokens in total  (2.39% of a window), $1.20
  dearest turn: 442.6k tokens  (1.58% of a window) over 10 round trips
  first half 442.6k a turn, second half 225.5k -- flat, which is the point
```

That last line is the one to read. A rising second half means a turn is carrying
something it should have read back off disk, which is the defect this whole
arrangement exists to prevent — and it is the defect that is invisible in every
other form of monitoring, because nothing is broken while it happens.

**The percentage is a calibration, not a published figure.** Nothing says how
many tokens a five-hour window holds, or how a cache read is weighted against an
output token. `quota_tokens` in the config is what to divide by, and it is null
until somebody sets it: calibrate it from one observation — a turn seen taking 5%
of the window, measured at 1.39M tokens, puts the window near 28M. It will be
approximate. It is still worth having, because the thing worth watching is
whether the figure is *flat* across a lesson, and a constant factor does not
affect that.

Two columns matter more than either number. **Round trips** is what a prompt can
change, and the only thing that turned a turn into 5.22M tokens. **Cache read** is
round trips times context: it is what grew without bound while a session was
resumed for twelve turns, and it is what a turn being its own session holds flat.

The flag is appended from the recipe's `usage_args` rather than written into its
`headless` command, and that is not fussiness. A machine's config file overrides
`agents` one level deep, and at least one machine here holds a verbatim copy of
the claude recipe from an older version of this tool. Had the flag gone in the
argv, every machine carrying such a copy would have silently stopped reporting —
which is the one failure a measurement must not have.

### Knowing what is actually up

A daemon you cannot see is worse than no daemon, so nothing has to be assumed:

```
tutor where
```

```
this machine: compute301

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

If you want two machines live at once, give them separate identities — a different `--hostname`
and a different `TS_DIR` on the second — and install the board on the iPad from each address. Two
apps, two icons, no ambiguity about which is which. An address only ever opens a board on the
machine that holds it: `tailscale serve` will not proxy to a remote backend, and answers every
request with a 502 if you ask it to.

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
    "aider":    { "cmd": ["aider"],    "prompt": "none" }
  }
}
```

`cmd` is whatever launches it. `prompt: "argv"` appends the opening brief as a final argument;
`prompt: "none"` launches it bare and prints the one line to paste. Add an entry for anything that
runs in a terminal — nothing in the launcher knows which assistant it is starting.

**`claude` is the default**, and it is the only one this has been taught with at length. Claude
Code arrives with the course repository already in front of it, which is most of a tutor: it reads
the slate PNG itself rather than through a transcription model, writes the card, and edits the
course's own `.tex` when a homework sitting needs it.

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

### Which one, for this course, on this machine

A laptop and a cluster node do not have the same tools installed, and a course may want a
particular assistant regardless of where it runs. Four layers settle it, most specific first:

| Layer | Where it is written | Scope |
|---|---|---|
| `--agent opencode` | the command line | this once |
| `"agent": "opencode"` | the course's `tutorboard.json` | this course, on every machine |
| `"hosts": { "desk": "deepseek" }` | the config, by short hostname | this machine, every course |
| `"default_agent"` | the config | everything else |

```json
{
  "default_agent": "claude",
  "hosts": { "desk": "deepseek", "compute301": "claude" },
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

**And there is no fifth layer for "what if it has nothing left to spend".** There is one tutor, and
a turn it cannot take is a turn the board reports rather than answering worse — see [when the
allowance runs out](#when-the-allowance-runs-out).

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

**It writes it with `board handoff`, which is the only thing that writes it, and which refuses a
body over 350 words.** That cap used to be a sentence in a prompt and the file reached 3,824
words — because every teaching turn was reading it and editing it, and each edit was reasonable on
its own. A teaching turn now leaves **`board note`** instead: at most 120 words in `live/NEXT.md`,
read by the next turn out of `board brief`. The note is what one turn tells the next; the handoff
is what one session tells the next, and it is the only one of the two that crosses a machine.

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
fast-forward-only `git pull` in the course. A handoff written on the machine you left is worth
nothing to the one you arrive on until it is fetched, and the whole point of writing it down is that
the work moves between machines.

It is deliberately never fatal. No remote, no network, or a branch that has diverged: it says so in
one line and the session starts anyway on what is on disk. Somebody holding an iPad cannot resolve
a merge, and a session that refuses to start is worse than a session that starts a commit behind.

**And the board pulls itself, on the same beat.** The course was only ever half of it: `tutor` and
`tutor resume` also fast-forward *this* repository, under the same never-fatal rule. No timer can do
it on a compute node, because a schedule on a machine that ceases to exist is not a plan — so a fix
sat on GitHub until somebody remembered to `git pull` by hand. Remembering by hand is the thing this
repository keeps failing at, and a login is the only moment a node gets.

Two things follow from the pull, and neither is optional:

- **The launcher re-execs itself** when the pull moves `HEAD`. `bin/tutor` was read into memory
  when the process started, exactly the way a board reads `serve.py`, so carrying on inside the
  launcher that was there before the pull is the same defect one level further in — and the hardest
  version of it to see, because the code reporting what it did would be the code that was replaced.
- **Then it bounces what is still holding the old code**, which is `tutor restart --tutors`: the
  boards answering on this machine and the tutors that are not mid-turn.
  This is `scripts/ship.sh` seen from the other end. Shipping bounces the machine a
  change is *written* on; without the same act on the machine that *receives* it, the fix is on
  disk and nowhere else, and the pages look new while the endpoints behind them are the old ones.

Only the two commands that begin a session do this. `tutor restart` does not, because `ship.sh`
calls it seconds after its own push and a second fetch there is a network round trip that finds
nothing.

### One address, and the machine holding it

**The goal.** Open the app on the iPad, pick a course, get a session. No command anywhere, ever.
Nothing about how that is arranged is visible to the person holding the iPad.

**The one address is the machine's, and it opens one board at a time.** `tailscale serve` proxies
the tailnet HTTPS name to a port on the machine it is running on; handed a remote tailnet address it
answers every request with a 502, so there is no arrangement in which one origin serves two
machines. Which board it opens is therefore a decision this machine makes, and it makes it twice:

- **a tap in the hub takes the name for the course it opens.** `/switch` records the choice, starts
  the board, and re-points the name in the same request — a tap is a person saying which lesson they
  mean, and nothing else is going to move an address on their behalf. The hub then waits until the
  address really is serving that course before it reloads, because reloading sooner lands on the
  board being tapped away from, which is indistinguishable from a tap that did nothing.
- **a start does not take it.** `ts_repoint` leaves a name alone while it points at a board that is
  up and answering, because `tutor restart` walks every course on the machine one after another and
  would otherwise leave the address wherever the alphabet finished — which once dropped somebody
  halfway through a Galois proof into a different lesson. What takes a name is a tap, an explicit
  `board vpn serve`, or the name pointing at nothing.

**Two names, and they are not the same name.** The *tailnet* name is the service — the one origin
the iPad app is installed against. The *machine* name is who wrote a record — `compute301`.
Conflating them is how this went wrong once: Tailscale's DNS made `uname -n` answer the service
name, the machine stopped recognising boards it had written under its own, and a live board became
unrestartable while still answering perfectly.

- **`board node`** — what this machine calls itself, and whether that is pinned. `board start` pins
  it the first time, before anything writes a record carrying it, on a machine whose name comes from
  the network and must not. `board node <name>` corrects a wrong one.
- **Do not pin the machine's name on a cluster node.** There the name is *supposed* to change
  between allocations, because it is a different machine each time and every ownership check depends
  on that being true: pin `compute301` and the next allocation calls itself `compute301` while Slurm
  says you hold `compute309`, so `tutor resume` refuses to start a board on a machine it thinks is
  not yours. `board start` will not pin where Slurm answers, and `board node --unpin` undoes one set
  by mistake.
- **`board vpn up --hostname <name>`** sets the tailnet name, once. It moves the one origin the app
  is installed against, so nothing does it for you.

> **If you are a tutor putting a compute node right, there is one command:**
>
> ```
> bash scripts/setup-node.sh [--tailnet-name <node-name>]
> ```
>
> It pulls, checks the machine's name is not pinned, picks the tutor this machine can actually run,
> and restarts the boards and tutors so they are on the code it just pulled. Every step is idempotent and reports what it found, so running it again
> when you are unsure costs nothing.
>
> The one thing it will not do for you is `board vpn up --hostname <node-name>`, for the reason
> above; it tells you when it is needed.

#### When the allowance runs out

The failure this handles is not a fault. Everything works and there is simply nothing left to spend:
the agent says so, exits non-zero, and every turn after it does the same until a clock somewhere
rolls over. Treated as an ordinary broken turn it is invisible in the worst way — the board shows a
tutor listening, the student sends again, and nothing comes back for four hours.

There are two moves, and they are taken in order.

**1. Notice, and say so somewhere it can be read.** A turn that has already failed has
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
machine that hit the limit can know about it. A board too old to publish the field is not assumed to
be exhausted — silence is an allowance.

**2. Then stop, and say so.** The tutor pushes the transcript first — the message it has just failed
to answer is in there, and the beat that would have carried it is the beat there is no time for —
and then the turn is reported as the failure it is. There is one tutor and it has nothing left to
spend; a board that says *the allowance is gone until 4pm* is worth more than one that answers the
question badly with something else.

Coming back up is the same two steps in reverse and nobody types anything. The limit expires, or a
turn goes through and proves the allowance is back before the clock said it would; the tutor climbs
out of the fallback at the top of its next turn and `/health` stops saying it is exhausted.

```
board limit              has the allowance here run out, and until when
board limit --clear      it came back early; stop waiting out the guess
```

`board doctor` names it too. The handoff is the one turn that must not be skipped and a tutor with
no allowance cannot write it: it is attempted anyway, and a session that ends without one is a
session the next has to reconstruct from the cards.

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

Whichever course was last chosen on the machine holding the name. What that must never be is a race:
picking by knocking on every course's port in sorted order and taking the first that answered is not
a decision, it is the alphabet — and with two boards up it is permanent. Tapping *Probability* in the
hub did every correct thing and changed nothing anybody could see, because G sorts before P.

So it is recorded, published and checked:

- **`chosen.json`** in `~/.config/tutor-board/` records the course a *person* named. `tutor <course>`
  writes it and so does a tap in the hub. It is a decision, and a decision cannot be derived from
  file times — resuming a course touches its files, so "most recently used" is self-reinforcing.
- **`/health` publishes it**, along with the port that course is genuinely serving on, read from its
  own board record. Only the serving machine can read either of those things, which is why a board
  answers for them rather than anybody guessing.
- **`/health` also says which course this board is**, and nothing is offered the address whose name
  does not match the course that was asked for. Ports are derived from names, and derivation is not
  proof: a hash can put two courses on one number, and a start whose port was busy moves to the next
  in its sequence. Without the check, a wrong number becomes a wrong lesson silently — somebody
  opens a Galois proof and is shown a problem set.

Several boards may be up at once and each keeps its own assistant. A listening tutor is blocked on
`board wait` and costs nothing while nobody is asking it anything, so exclusivity bought nothing and
cost the thing that matters: coming back to a course used to mean a cold agent that had to re-read
the contract, the method and the lesson before it could write a word. `test/choice.py` guards all of
this, and it is worth reading before changing any of it.

#### What only real hardware can settle

- Whether the iPad app's SSE stream reconnects cleanly when the address changes which board it
  serves underneath it, or whether it needs a nudge. The service worker caches the shell and nothing
  live, so the risk is a hung stream rather than a stale lesson.
- How long taking the board over on a new node actually takes after an allocation dies, and whether
  that gap is short enough to be invisible or wants a "reconnecting" state on the board.

### Why there is no registry

Courses are whatever directories are sitting beside the tool. Adding one means making a directory;
there is no list to update and nothing that can go stale. `courses_dir` moves the search if your
repositories live somewhere else.

## Which subjects the app offers

**Whatever the machine that is serving has on disk, and nothing else.** The hub's list is a
directory listing of this machine's `courses_dir`, built when the app asks for it — never cached,
never baked into the installed app, never written down anywhere. A compute node with every
repository cloned into the shared home offers every subject; a laptop with four of them cloned
offers four.

There is no list to edit and nothing that can disagree with reality, and nothing to pick between:
the hub offers this machine's courses because this machine is the one serving the address. To put a
subset on another machine, clone a subset — `~/.config/tutor-board/courses.txt` is what
`bootstrap.sh` reads, and it is per-machine and not in this repository.

**A course that is not running is still offered**, because opening it is what starts it. What the
hub must never do is claim one is running when it is not. That was a real defect: a board that died
with an allocation leaves `live/.board.json` behind on the shared home, and nothing distinguishes
that from a board answering right now — so the hub went on saying *live on compute304* for hours
after compute304 stopped being a machine this user had, and a tap went somewhere nothing was
listening. The record is now checked against the nodes Slurm says are still yours, and
`tutor resume` sweeps the dead ones as you log in. Where there is no Slurm to ask, the answer is
*unknown*, and unknown is left alone rather than deleted.

## Courses, and the one board

Nothing is registered and nothing is configured centrally. **Any directory beside this one is a
course** if it holds a `tutorboard.json`, an `AI_INSTRUCTIONS.md`, or a `live/` folder. The hub
lists what it finds each time you open it; adding a course means making a directory.

A course says what it is in `tutorboard.json` at its root, and there is very little to say:

```json
{
  "name": "Galois Theory"
}
```

`board init "Galois Theory"` writes it. Without one, the name comes from the directory and
everything works anyway.

**There used to be a `mode`, and it is gone.** A repository declared itself `math` or `code`, and
that one word decided the teaching method, the shape of the first card, where the session boundary
was, half the contents drawer, and whether the board offered an answer panel or three tap-buttons —
*ready to check*, *I need help*, *I'm confused* — docked over the lesson. Two boards, in other
words, and switching courses on the same iPad switched interfaces. What is left is one board and
one method: the lesson is exercises, they are answered on the board by writing or by typing, and
one question ends the turn. A repository whose subject is code is no exception — when something has
been implemented, the turn that says so is a written or typed one, and the tutor goes and looks at
what actually changed.

A `mode` still sitting in an old `tutorboard.json` is read and dropped, because those files live in
the course repositories rather than here and nobody is going to edit nine of them. It cannot come
back through the door it left by.

What a repository *can* still say is **what the tutor is for**:

```json
{
  "name": "TRD-EHR",
  "stance": "do"
}
```

`"stance": "teach"` is the default and the original point of the thing — the
student writes the code, and withholding it is the teaching. `"stance": "do"` is
for a project where that is not what is wanted: the tutor writes the code, runs
it, submits the job, and the card becomes a *report* — what changed, what it does
now, what ran and what came back — rather than an exercise. Everything else about
a turn is unchanged, which is why it is one line of configuration and not a
second mode: still one card, still short, still written before the rest of the work,
still stopping to ask for the one decision it needs. A `--review` sitting is the
single exception, because a review asks rather than sets work.

It is declared and never guessed. Writing the code for somebody who wanted to
learn it is the one mistake here that the next card cannot undo, and nothing
about a repository's contents is evidence either way: a directory full of Python
is not a request to have the Python written.

**A tutor with a `do` stance needs the access to match.** Editing files is
granted by the course's own `.claude/settings.local.json`; anything else it has
to run — `sbatch`, `squeue`, `git commit` — belongs in that file's allow list,
and a companion repository the README points at (a planning repo, a task list)
has to be named in `additionalDirectories` or the file tools will refuse to open
it. A tutor that may write the code but not submit it can only ever report that
nothing has run.

### What differs between courses, now that nothing declares it

Two things, and both are read off what the repository actually *has* rather than off what it once
said about itself — which is the point, because a fact cannot go stale and a declaration can.

| | a repository with a syllabus | a repository without one |
|---|---|---|
| Where the exercises come from | the end of each section, in the book | whatever the README points at: a task list, a plan, a companion repo |
| The contents drawer (☰) | its chapters and problem sets | sittings made as you go, filed under ◷ |
| A `--review` sitting covers | chapters | the repository's own top-level parts |
| Answering | the answer panel | the answer panel |

`chapters.tsv` or `chapters/chNN-*/` is what makes the first column true; there is no flag for it.
A repository with neither is told so and pointed at its README, and is explicitly told **not** to
manufacture chapters out of the README's own headings — which is a thing that happened, once, on a
repository that has none.

The answer panel is the same everywhere: a writing surface and a typed half, one toggle,
and whichever the student used last is the one that opens next time. An old question remembers
its own answer, though: a board you wrote on reopens with the ink still on it, and a typed
answer reopens with the text in the box, both editable and re-sendable as a revision of that
same response rather than a new one.

### Working in a course from a terminal, while it is a course

A course repository is somewhere its owner writes code, not only somewhere they are taught — and
the tutoring machinery runs unattended: the transcript beat commits and pushes every ninety
seconds, a session start fast-forwards the repository, and **⤓ save** on the iPad commits the whole
tree from a tap. Two rules keep those out of somebody's way, and they are in
`tutorboard/worktree.py` so that there is one of each:

- **A commit names its pathspec.** The beat commits `live/` with `--only`, so a file staged in a
  terminal a moment earlier stays staged. `git commit` commits the whole index, which is how a
  half-finished refactor once went into history under the message *lesson transcript*.
- **Nothing automatic touches a repository mid-operation.** A rebase, a merge, a cherry-pick, a
  revert or a bisect outstanding — or a detached HEAD — and the beat does nothing that tick and
  says why in its log; a tap on save says what is in the way, on the board, and commits nothing;
  `catch-up.sh` leaves the repository exactly as it is rather than stashing and resetting around
  it. Nothing is lost by waiting: the transcript is append-only and the next tick is ninety
  seconds away.

So `git rebase -i`, a bisect, or an afternoon of half-staged work in a course with a live board on
it is ordinary and safe in both directions. `test/beside.py` holds it, against real repositories.

## The machine this is written for

**A compute node on a Slurm cluster, with no administrator rights, on a shared home.** Every
decision in here follows from those four facts, and it is worth saying which ones:

- **Nothing needs `sudo`, ever.** The server is standard-library Python, the pages are plain
  browser JavaScript, KaTeX is vendored, and `tailscaled` runs in userspace mode out of `$HOME`.
  A change that needs a package manager or a system service is a change that cannot be deployed
  here.
- **TeX lives under `$HOME`**, and is found by globbing rather than guessing an architecture:
  `~/.TinyTeX/bin/*`, `~/.local/TinyTeX/bin/*`, `/usr/local/texlive/*/bin/*`.
- **Nothing may be supervised.** A timer or a service assumes a machine that comes back; an
  allocation ends and the machine stops being yours. A login is the only moment there is, which is
  what `tutor resume` and the login hook are for.
- **The home directory is shared and the machine is not.** Every record that crosses `live/`
  carries the node's name and every liveness check compares it, because a pid on a shared
  filesystem is a pid on somebody else's machine until proved otherwise. Slurm is asked whether a
  node is still yours; where `squeue` does not answer, the answer is *unknown*, and unknown is left
  alone rather than acted on.

It will run elsewhere — the platform knowledge is isolated in `tutorboard/tex.py`, `machine.py` and
`net/tailscale.py`, and `board doctor` says what it thinks it is on — but nothing is kept here for
the sake of a machine that is not this one.

### Driving it with a different assistant

The interface is a command line and a directory of files, so anything that can run a shell command
can drive it — OpenCode, Codex, Cursor, a local model behind a terminal wrapper. See
[Any agent, not just one](#any-agent-not-just-one).

The one thing to check before committing to a setup is **whether the assistant can look at an
image**. This used to be a question about the course — a `code` one took its answers through a text
box and needed nothing seen — and it is now a question about the board. Every course's return path
runs through the slate, so something that cannot read a page of handwriting is no use in any of
them.

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

If it cannot read them, it cannot tutor from this board — there is no longer a mode that turns the
handwriting off. Point a different assistant at that course; `tutor --agents` lists what the
machine can drive, and the choice is per course.

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

**In a repository that follows no book there are no chapters, and it is not told it is broken.**
It is offered its own top-level parts instead — `loader/`, `pipeline/`, `web/` — discovered the same way
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

It behaves identically in every repository, and it always commits and carries on: a save is a
save. `board push` used to *end* the session in a `code` repository and not in a maths one, so the
same button filed the lesson away in one course and left it open in another, for no reason visible
from the iPad. `board open` and `board archive` are what file a lesson, everywhere.

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
to a professor, to themselves in a fortnight.

**There are two documents, and they are not the same document.**

```
board export                     # this lesson, typeset
board export --all               # every lesson in the course, as one
```

and, on the iPad, **⋯ → export this lesson** and **⋯ → export the whole course (typeset)**.
Reading one, or getting back to one made a fortnight ago, is **⋯ → documents · view or save**.

**`export this lesson`, from the device, is a photograph of the lesson.** Asked for in those
words — *"I want it as if it were a screenshot of the entire iPad screen scrolled down over the
whole tutoring session"* — and it is what it says: the board's own pixels, dark paper, the card
chrome, the reading face, your handwriting sitting where it sits, packed onto A4 pages and cut
where a card allowed it to be cut. It is taken by the iPad, because the iPad is the only thing in
the system that knows what the lesson looks like: there is no headless browser on a compute node
and there never will be. Everything else about it is the server's, and is the same as for the
typeset export — where it goes, what it is called, which version it is, and that it is staged for
the next commit. So `transcripts/` holds one numbered series, not two.

Two things are deliberately not photographed. **The furniture** — Send, the write/type toggle,
`skip this one` — because a live control in a document somebody is emailing is a picture of a
button that does nothing. And **a blank writing surface**, because a foot of empty paper as the
last page reads as a document that went wrong; working you have drawn and not yet sent is yours
and is in there.

**`board export`, and `export the whole course`, is the typeset transcript.** Both halves of the
sitting in the order they happened — the tutor's cards typeset from their own markdown and
mathematics, and *every page you handed in*, as the picture that was actually sent, labelled
`You wrote — attempt 2 of 5` with the time. An exercise worked over ten attempts is ten pages of
your own handwriting with the tutor's replies between them, which is the record of the work rather
than a summary of it.

The whole course can only be this one. A filed sitting is not on the glass, so there is nothing on
the device to photograph.

**And either one can leave the device.** The banner that reports an export carries **save a copy**
beside it, and it never navigates the app anywhere: the document is fetched and handed to the
system as a file, so iOS raises the share sheet OVER the board — Files, iCloud, a phone by AirDrop,
an email to a professor — and Cancel puts you back in the lesson, because the lesson never went
anywhere. The write-up has the same button, from **⋯ → export the written-up homework**.

**And either one can be read without leaving either.** **read it** sits beside *save a copy*, and
in the panel it opens the pages are pictures: drawn to PNG by the machine that holds the PDF, shown
in a panel the board owns, closed with ✕ back into the lesson. That is not a decoration over a
simpler mechanism — it is the only one that works. iOS renders a PDF in an `<iframe>` as one
unscrollable first page, and *navigating* to a PDF in a home-screen app leaves the board with no
chrome, no back button and no share sheet, which is the trap the download button was rewritten to
escape in the first place. A machine with no page renderer on it — `pdftoppm`, `pdftocairo` or
`gs`, looked for on the same PATH as TeX — says so in the panel and offers the copy instead of
showing an empty one. The pages are cached against the PDF's own modification time, so the first
open of a long document takes a few seconds and every one after it is instant, and a rebuilt
document is drawn again rather than served stale.

**And both documents are reachable at every moment, from ⋯ → documents · view or save.** This is
the fix rather than the flourish. The controls for a document used to live in the banner of the
build that made it — and that banner is replaced by the next payload, about a second later.
Reported from the iPad, mid-sitting: *"I just tried to save a copy of my homework, and it's not
working. It compiles the homework, but it's not letting me view the compiled .pdf or save it
anywhere locally."* Every clause of that was true. The compile had worked, the PDF was in the
repository, and the button for it had a life of about one second — after which a tap did nothing at
all, because the URL behind it had been cleared with it.

A document is a **file**, not an event. So whether one exists is a question the payload answers on
every change, off the disk (`papers` in `board.json`, four `stat` calls), and the panel lists both
— name, when, how big — with **read it here** and **save a copy** on each, and an offer to *make*
the one that is not there so the panel is never a dead end. A write-up compiled ten days ago is as
reachable as one compiled ten seconds ago.

Three other things came out of the same report.

- **The write-up's record now comes off disk.** `board hw build`'s outcome reaches the banner from
  `live/hw.json` by way of the payload, in its own argument rather than in the one that belongs to
  `push.json`. It used to be a record the client invented from the reply to `/hw/build` — on no
  disk anywhere — which is why the next payload could paint over it.
- **The banner is its own function.** `paintBanner` rather than `paintSession` with an empty state,
  which used to repaint the session badge as *lecture* for the second before the next payload put
  it back — a homework sitting announcing itself as a lecture at the exact moment somebody exports
  their homework.
- **The service worker had been caching the downloads.** `/download/…` matched neither the live
  list nor the runtime list, so it fell through to the shell rule, which caches any 200 it sees.
  Megabytes of transcript inside the app's own storage allowance, and — worse — a document that is
  rebuilt at the same URL every time, so a cached one served while the link blinks is last week's
  write-up under this week's name. That is the same mistake as a cached lesson, one layer down, in
  the file whose whole rule is against it. `/download/`, `/view/` and `/paper/` go to the network,
  always.

`test/paper.py` holds all of it against a real board on a real socket: both documents resolved,
named for their course and their set, handed over as attachments rather than previews; the pages
drawn, counted, ordered, cached, re-drawn after a rebuild, and bounded so the cache cannot grow
without limit; a machine with no renderer degrading rather than showing an empty panel; every
traversal refused; and, by reading the client, that the record reaches the banner from the payload,
that nothing navigates the board's own window, and that the service worker leaves all three paths
alone.

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
error appears on the board rather than in a log nobody opens. The photograph costs a few seconds
of the tablet's own time instead, a card at a time, and says which card it is on — a button that
goes quiet for twenty seconds is a button somebody presses twice.

## Setting up a course repository

The minimum is nothing at all: make a directory next to this one and run `board start` inside it.
Everything below is optional, and each item buys something specific.

1. **`tutorboard.json`** — declare the name rather than having the directory's used.
   One command: `board init "Real Analysis"`. There is nothing else to declare unless the
   repository wants the work *done* rather than set, which is `"stance": "do"` and is written by
   hand.

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
board init "Course"              # name this repository, so the directory is not used
board finish                     # offer the push, on the iPad
board push "message"             # or just do it
board eyes                       # can the assistant driving this see images?
board open "Galois Theory" "Ch 7 — Splitting fields"
board next lesson splitting-fields   # -> live/cards/0001-splitting-fields.md
board brief                      # the standing rules, in one call: the method, this
                                 #   course's unbendable rules, the handoff, the note
board recap                      # the lesson so far, in one call
board note < note.md             # <=120 words for the next turn (a turn is a session)
board handoff < handoff.md       # HANDOFF.md at session end, <=350 words. Capped.
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
board doctor                     # is this machine equipped, and who teaches on it
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
and reads. **`NN` is the page's identity, not its position** — it is carried by the page from the
moment it exists and is what every save addresses. That sounds like pedantry and is not: a file
appears only when a page is saved, so a page cut and never written on leaves a GAP, and a surface
that addressed pages by where they sat in the list it got back wrote each one over its neighbour
after every reload. See 3 September 2026 above for the wreckage. The PNG is exactly what you see, paper colour included — inverting it would wreck a
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

## What the board is for when the work is code

The work happens in the editor, on the student's own machine. The board is not where code gets
written and never should be — unless the repository declared `"stance": "do"`, which is a decision
made once, in writing.

The board carried three buttons for this once — **Ready to check**, **I need help**, **I'm
confused** — shown only in a `code` course. They are gone with the mode. What says the same things
is the answer panel every course has: a sentence typed, or a page written on the slate, both of
which arrive as ordinary turns and both of which carry the half a tap could not. *Ready to check*
never said what to check or why; *"the recursion is right now but the memo table is still empty on
the second call"* does, and it is the difference between a tutor reading a diff and a tutor
guessing at one.

Turns are recorded like any other, so the transcript of a session is still a record of where the
student got stuck and what unstuck them — and now of what they actually said about it.

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
bin/board          the command line (also: tutor)
serve.py           the entry point, and nothing else
TEACHING.md        how to teach on this board -- copied into every course's live/
tutorboard/        the board itself, organised by what a thing is about:
  paths ports      what this machine knows about itself
  choice machine   which course was asked for, and what this machine is
  processes tex    what is alive here, and where TeX is
  limits reasoning what a model may say, and when it may not say it
  handoff sense    what a turn means, and what it leaves behind
  brief carry      what a turn reads before it teaches, and what it tells the
                   next one -- a turn is its own session, so both are files
  machines.py      the other machines, and what each can teach
  net/             reaching them: tailscale, socks, boards, egress
  course/          a course on disk: repo, config, document, homework, review,
                   syllabus, screenshot, paper (the two documents: resolving one,
                   naming it, and rendering its pages so an iPad can read it)
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
  NEXT.md          <=120 words from the last turn to this one, via `board note`
  cost.jsonl       one line per turn: round trips, tokens, dollars. `tutor cost`
  inbox/           messages.jsonl and uploads/
  slate/           page-NN.json (strokes) and page-NN.png (what the assistant reads)
                   NN is the page's name, not its place in any list
  tikzcache/       compiled SVG, keyed by content hash
  paper/           rendered PDF pages, so a document can be READ on the iPad.
                   Keyed on the PDF's own modification time, bounded to a few
                   page sets, and it carries its own .gitignore -- a course whose
                   minimum is "nothing at all" would otherwise commit it
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

reports python, `latex`, `pdflatex`, `dvisvgm`, the page renderer, the vendored KaTeX, the node
name, the port, and the tailnet name. What it is checking for:

| Needed | Where it came from here |
|---|---|
| Python 3.7+ | system python3 — standard library only, nothing from pip |
| A TeX installation | TinyTeX in `~/.TinyTeX` |
| `dvisvgm`, `standalone` | `tlmgr install dvisvgm standalone varwidth preview needspace` |
| KaTeX | vendored into `web/katex/`, see step 2 |
| `pdftoppm` (poppler) | `/usr/bin`, where a cluster node has it if it has it at all. Wanted rather than needed: without it — or `pdftocairo`, or Ghostscript's `gs` — a PDF can still be saved to the iPad but cannot be **read on the board**, because the pages are rendered here. `board doctor` says so in as many words rather than leaving it to be found from a panel that will not fill |
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
node test/shot.js        that the photographed lesson is the lesson, and nothing else is
node test/sheets.js      that a slate page is addressed by its number, so a gap in the
                         numbering cannot slide every board onto its neighbour's sheet
node test/hanging.js     that the board has words for every state a reader can be stuck
                         in -- a tutor waking, a turn that failed, nobody attached
python3 test/shot.py     that the photograph becomes a PDF that actually opens
python3 test/waking.py   that a tutor coming up says so, and that work handed in is
                         never answered by silence
python3 test/annotate.py that marks on a card are anchored to it and can be sent
python3 test/begin.py    that the first turn of a session can come from the device
python3 test/homework.py that a sitting finds its problem set, in either layout
python3 test/paper.py    that both documents can be READ on the board and SAVED off it,
                         at any moment -- the pages rendered, counted, cached against the
                         PDF's own timestamp and re-drawn after a rebuild; a machine with
                         no renderer degrading rather than showing an empty panel; and,
                         by reading the client, that the write-up's record reaches the
                         banner from the payload rather than being invented for one frame
python3 test/teaching.py that the teaching method reaches every course
python3 test/choice.py   that the address opens the course a person chose
python3 test/limit.py    that an allowance running out is reported rather than hidden
python3 test/tokens.py   what a turn is allowed to read, what it must not run, and that
                         what it cost is measured rather than argued about

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
- A compiled write-up comes back off a real board as an attachment named for its course, and
  its pages render to legible PNGs through `pdftoppm` — checked by looking at one.
- Slate ink round-trips: strokes in, PNG on disk, opened and read.
- `board wait` blocks and wakes on a send.
- Inbound over the tailnet works in userspace-networking mode, checked through the SOCKS proxy.
- The `ts.net` certificate validates, so the page is a secure context.

Not verified by anything automated: **how the pages look and feel**. There is no browser on the
compute node. Type sizes, spacing, the smoothness of a Pencil stroke, whether palm rejection
actually rejects a palm — those are only ever confirmed by opening the thing and using it. A test
suite cannot tell you the type is too small.
