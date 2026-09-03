// Three replies to one attempt, and where the eye lands when one arrives.
//
// This is here because of a real evening on Exercise 1.3. The working was sent
// three times; each send was a revision of the SAME turn, so the transcript
// showed one attempt, as it should. The tutor's three replies were three cards,
// and cards are not versioned, so all three stayed open in a row underneath
// that single attempt -- reading as three live objections to the working on
// screen, when two of them were about ink that had since been rewritten.
//
// The second half of the same evening: a new reply arrived and the board
// scrolled to the bottom of the document. The bottom of the document is the
// bottom of the writing surface, which is deliberately the last thing in the
// lesson -- so the feedback that had just been waited twenty minutes for went
// off the top of the screen and a blank slate arrived instead.
//
// jsdom, because both of these are about what is actually in the document.

const fs = require('fs');
const path = require('path');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.log('skip  jsdom is not installed — `npm install jsdom` to run this test');
  process.exit(0);
}

const WEB = path.join(__dirname, '..', 'web');
const errors = [];
const ok = (m) => console.log('ok   ' + m);
const fail = (m) => { errors.push(m); console.log('FAIL ' + m); };

const dom = new JSDOM(fs.readFileSync(path.join(WEB, 'board.html'), 'utf8'), {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://board.test/board',
});
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, { get: () => () => {}, set: () => true });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 900 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 500 });
// jsdom has no layout engine, so give it one that is enough to reason about:
// each card sits sixty pixels below the one before it, the bar is forty tall,
// and the document is longer than the window. Without this every rectangle is
// the origin and every scroll target collapses to zero, which would let the
// defect this file exists for pass.
Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { get: () => 4000 });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  const id = this.dataset && this.dataset.card;
  const top = id ? 60 * parseInt(id, 10) : 0;
  const height = this.id === 'bar' ? 40 : 120;
  return { left: 0, top: top, width: 900, height: height,
           right: 900, bottom: top + height, x: 0, y: top };
};
window.Element.prototype.scrollIntoView = function () {};
// The slate asks for its saved pages before it can say how many it has,
// and the board now waits for that answer rather than acting on the one
// blank sheet that stands in until it comes. A promise that never settles
// models a board that never finds out; these tests mean a board with
// nothing saved, which is a different thing and has to say so.
window.fetch = (u) => (/slate\/state/.test(String(u))
  ? Promise.resolve({ json: () => Promise.resolve({ pages: [] }) })
  : new Promise(() => {}));
window.renderMathInElement = () => {};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);

// Watch the wire, not the intention: what the board actually asks the window to
// scroll to is the whole question here.
const scrolls = [];
window.scrollTo = function (a, b) {
  scrolls.push(typeof a === 'object' && a ? a.top : b);
};
window.addEventListener('error', (e) => fail('uncaught: ' + e.message));

window.EventSource = function () {
  window.__es = this;
  this.readyState = 1;
  this.close = function () {};
  this.addEventListener = function () {};
};

for (const f of ['typeface.js', 'macros.js', 'slate-core.js', 'annotate.js']) {
  try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
  catch (e) { fail(f + ': ' + e.message); }
}

// Whether a hand is mid-answer is the slate's to say, and saying it in jsdom
// means no pen. Wrap the real surface rather than teach the board a test-only
// hook: what is under test is the board asking, not the slate answering.
const realCreate = window.Slate && window.Slate.create;
if (realCreate) {
  window.Slate.create = function (opts) {
    const api = realCreate(opts);
    api.busy = () => !!window.__slateBusy;
    window.__slate = api;          // the instance, for the page-mapping tests
    return api;
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { window.eval(fs.readFileSync(path.join(WEB, 'board.js'), 'utf8')); }
catch (e) { fail('board.js: ' + e.message); }

const doc = window.document;
const els = { get writer() { return doc.getElementById('writer'); } };
const es = window.__es;
if (!es) { console.log('FAIL board.js never opened a stream'); process.exit(1); }

const t0 = 1787849000;
const card = (id, kind, title, n) =>
  ({ id: id, kind: kind, title: title, body: 'the ' + title + ' body',
     mtime: t0 + n * 100 });

// The lesson as it stood: one question, one answer sent three times, and one
// reply to each of those three sends.
const lesson = {
  state: { course: 'Galois Theory', session: 'lecture', mode: 'math' },
  cards: [
    card('0001', 'question', 'Exercise 1.3', 1),
    card('0002', 'wrong', 'the Note that line', 2),
    card('0003', 'wrong', 'a conjugate is not a coset', 3),
    card('0004', 'wrong', 'one sentence does all the work', 4),
  ],
  turns: [{ id: 't0002', rev: 3, kind: 'ink', answers: '0001', t: t0 + 350,
            iso: '2026-08-28 17:07:43', png: '/answers/t0002-r3.png',
            ink: '/answers/t0002-r3.json' }],
  messages: [], uploads: [], slate: [], push: null,
  agent: { agent: 'claude', state: 'attached', mode: 'interactive' },
};
es.onmessage({ data: JSON.stringify(lesson) });

const nodeFor = (id) => doc.querySelector('[data-card="' + id + '"]');

// 1. Only the newest reply is open.
{
  const folded = ['0002', '0003'].filter((id) => {
    const n = nodeFor(id);
    return n && n.classList.contains('superseded');
  });
  folded.length === 2
    ? ok('the two replies that were answered again are folded away')
    : fail('replaced feedback is still open: ' + folded.length + ' of 2 folded');

  const live = nodeFor('0004');
  live && !live.classList.contains('superseded')
    ? ok('and the newest reply — the one about the working on screen — is open')
    : fail('the live reply was folded too, which leaves nothing to read');
}

// 2. Folding is not deleting. The heading still reads, and the body comes back.
{
  const n = nodeFor('0002');
  /the Note that line/.test(n.textContent)
    ? ok('a folded reply still says what it was about')
    : fail('a folded reply is anonymous; there is no way to know what it holds');
  const css = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
  /\.card\.superseded\s*>\s*\.body\s*{\s*display:\s*none/.test(css)
    ? ok('the fold is a display rule on the body, not a removal')
    : fail('nothing in the CSS actually folds a superseded card');
  /\.card\.superseded\.open\s*>\s*\.body\s*{\s*display:\s*block/.test(css)
    ? ok('and it opens again')
    : fail('a folded card has no open state — the text is unreachable');

  const head = n.querySelector('.card-head');
  head.querySelector('.card-older')
    ? ok('the heading carries a mark saying it was replaced')
    : fail('a folded card looks like a card that is simply short');
  head.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  n.classList.contains('open')
    ? ok('tapping the heading opens it')
    : fail('a folded reply cannot be opened again — this is deletion, not folding');
  head.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  !n.classList.contains('open')
    ? ok('and tapping it again folds it back')
    : fail('an opened reply cannot be folded again');
}

// 2b. A question stays open for as long as it takes, and every reply to it
//     belongs to it. The rule was "replies after the NEWEST question card", and
//     a real evening on Exercise 1.3 ran to eleven cards under ONE question — so
//     for two hours there was no newer question after them, nothing folded, and
//     the board was a wall of every reply ever written. Five of those cards were
//     `note`, which was not counted as a reply at all.
{
  const long = Object.assign({}, lesson, {
    cards: [
      card('0101', 'question', 'Exercise 1.3', 1),
      card('0102', 'wrong', 'the Note that line', 2),
      card('0105', 'note', 'you cannot prove it', 3),
      card('0106', 'note', 'a name collision', 4),
      card('0108', 'correct', 'the cancellation lands', 5),
      card('0111', 'note', 'which element is h', 6),
    ],
  });
  es.onmessage({ data: JSON.stringify(long) });
  const open = ['0102', '0105', '0106', '0108', '0111']
    .filter((id) => nodeFor(id) && !nodeFor(id).classList.contains('superseded'));
  open.length === 1 && open[0] === '0111'
    ? ok('with one question open all evening, only its newest reply stays open')
    : fail('the wall of feedback is back: ' + open.length + ' cards open ('
           + open.join(', ') + ')');
  nodeFor('0105') && nodeFor('0105').classList.contains('superseded')
    ? ok('and an aside is a reply too — five of them were the bulk of the wall')
    : fail('`note` cards are not folded, which was most of the problem');
}

// 3. Teaching is not feedback. A lesson card after a question is new material
//    and must never be folded because another card came after it.
{
  es.onmessage({ data: JSON.stringify(Object.assign({}, lesson, {
    cards: lesson.cards.concat([card('0005', 'lesson', 'what a normal subgroup is', 5),
                                card('0006', 'wrong', 'still not the coset', 6)]),
  })) });
  const teach = nodeFor('0005');
  teach && !teach.classList.contains('superseded')
    ? ok('a lesson written after the question stays open')
    : fail('teaching was folded away as though it were stale feedback');
  nodeFor('0004').classList.contains('superseded')
    ? ok('while the reply that a newer reply replaced is folded')
    : fail('the older reply stayed open once another arrived');
}

(async function () {
await sleep(30);

// 4. Where the eye lands. The writing surface is the last thing in the lesson,
//    so the bottom of the document is the wrong answer by construction.
// Card 0007 is written in several paragraphs, because a reply usually is, and
// because a one-block card has nothing to reveal a block at a time.
const manyBlocks = Object.assign(card('0007', 'wrong', 'nearly', 7),
  { body: 'The third line does not follow.\n\nTake the fixed field first.\n\n'
          + 'Then count the cosets.\n\nTry it again from there.' });
const withNew = Object.assign({}, lesson, {
  cards: lesson.cards.concat([card('0005', 'lesson', 'what a normal subgroup is', 5),
                              card('0006', 'wrong', 'still not the coset', 6),
                              manyBlocks]),
});
{
  // A card whose first line is ALREADY on the glass is not scrolled to. It grows
  // into view from where it starts, and the reader is left where they are.
  //
  // Asked for from the device, and the comparison is the right one: "I'd rather
  // just keep my position right below my written board work, where I see the
  // message that the tutor is working, and stay there when the message arrives
  // instead of being scrolled into the middle of that message... how it is
  // online if you just go to -- say -- Gemini online, where you as a viewer in
  // your position on the page are stationary, but you see the text lines growing
  // and progressing downward as the response comes in."
  //
  // The layout grants it for nothing: the student's working keeps its place in
  // the run when it freezes -- a live surface and a dormant board are one box by
  // construction -- and everything new lands below it. So nothing above the
  // reader changes height and the reply appears in the space under their working
  // where "the tutor is writing" was.
  const jumpEl = doc.getElementById('jump');
  scrolls.length = 0;
  jumpEl.hidden = true;
  es.onmessage({ data: JSON.stringify(withNew) });
  !scrolls.length
    ? ok('a reply that has already begun on the glass grows into view rather '
         + 'than moving the reader')
    : fail('the board scrolled to a card it could already see, landing '
           + scrolls[scrolls.length - 1] + ' — which is being put in the middle '
           + 'of the message you were waiting for');
  jumpEl.hidden
    ? ok('and offers no jump, because there is nothing to jump to')
    : fail('a jump was offered to a card that is on screen');
}

// 4a. And it arrives a block at a time, not as one wall of text.
{
  const fresh = nodeFor('0007');
  const body = fresh && fresh.querySelector('.body');
  const blocks = body ? Array.from(body.children) : [];
  if (blocks.length < 2) {
    ok('a one-block card has nothing to reveal (skipped)');
  } else {
    const shown = blocks.filter((b) => !b.hidden).length;
    shown === 1
      ? ok('a card that has just arrived shows its first block and holds the rest')
      : fail(shown + ' of ' + blocks.length + ' blocks were shown at once — the '
             + 'card is still landing as one wall of text');
  }
  // And nothing is hidden BEFORE the mathematics has been measured: KaTeX
  // cannot measure what is display:none, and a formula measured at zero width
  // comes back wrong for the rest of the sitting.
  const js2 = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
  const order = js2.indexOf('freshNodes.forEach(typeset)')
                < js2.indexOf('freshCards.forEach(revealLines)');
  order
    ? ok('and the reveal runs after the typesetting, never before it')
    : fail('blocks are hidden before KaTeX has measured them, which breaks '
           + 'display mathematics');
}

// 4b. And a card whose first line is BELOW the fold is OFFERED, not taken to.
//
//     There is nothing to watch grow down there, and a page that has silently
//     changed under somebody has to say so — but taking them is still taking
//     them, and the ask was explicit about that: "WITHOUT scrolling the user down
//     — they'll scroll their own way down to read the response." So the jump
//     button is the whole of what is left of the old behaviour, and it is somebody
//     asking rather than the board deciding.
const farDown = Object.assign({}, withNew, {
  cards: withNew.cards.concat([card('0015', 'wrong', 'the very last line', 15)]),
});
{
  const jumpTo = doc.getElementById('jump');
  scrolls.length = 0;
  jumpTo.hidden = true;
  es.onmessage({ data: JSON.stringify(farDown) });
  !scrolls.length
    ? ok('a reply that arrives below the fold is not scrolled to either')
    : fail('the board took the reader to a card they had not asked for, landing '
           + scrolls[scrolls.length - 1]);
  !jumpTo.hidden
    ? ok('and the way to it is offered, to be taken when they want it')
    : fail('a card arrived below the fold with nothing to say it had');

  // ...and taking the offer goes to that card's first line, clear of the bar.
  // The destination is still the thing that matters; it is only no longer
  // automatic.
  scrolls.length = 0;
  jumpTo.onclick();
  const asked = scrolls[scrolls.length - 1];
  asked !== doc.body.scrollHeight
    ? ok('and not to the bottom of the document, which is the blank slate')
    : fail('the jump still goes past the feedback to the writing surface');
  const live = nodeFor('0015').getBoundingClientRect();
  const bar = doc.getElementById('bar').getBoundingClientRect();
  asked > live.top - bar.height - 20 && asked <= live.top - bar.height
    ? ok('it goes to the first line of that reply, clear of the bar')
    : fail('the jump landed at ' + asked + ', not at the top of card 0015 ('
           + (live.top - bar.height) + ')');
  jumpTo.hidden = true;
}

// 5. A payload is not a card. This is the one that got out: the destination
//    changed from the bottom of the document to the newest card's first line,
//    and the rule was still "if they were at the bottom, go to the bottom" --
//    which had been a no-op for as long as the two were the same place. The
//    tutor's heartbeat lands every thirty seconds, so the board dragged itself
//    a screenful, over and over, while nobody was touching it.
{
  scrolls.length = 0;
  es.onmessage({ data: JSON.stringify(Object.assign({}, farDown, {
    agent: { agent: 'claude', state: 'working', turns: 3 },
  })) });
  !scrolls.length
    ? ok('a heartbeat with no new card does not move the page at all')
    : fail('the board scrolled for a payload that carried nothing new — '
           + scrolls.length + ' time(s)');

  es.onmessage({ data: JSON.stringify(Object.assign({}, farDown, { unsaved: 4 })) });
  !scrolls.length
    ? ok('and neither does the uncommitted count changing')
    : fail('an unrelated payload moved the page');
}

// 6. A hand mid-answer outranks a card arriving. Scrolling the page out from
//    under a pen is not a thing to do to somebody drawing a diagram.
{
  const jump = doc.getElementById('jump');
  window.__slateBusy = true;
  scrolls.length = 0;
  jump.hidden = true;
  es.onmessage({ data: JSON.stringify(Object.assign({}, farDown, {
    cards: farDown.cards.concat([card('0017', 'wrong', 'the last line', 17)]),
  })) });
  !scrolls.length
    ? ok('a card arriving while the pen is down does not move the page')
    : fail('the board scrolled out from under a pen that was mid-stroke');
  !jump.hidden
    ? ok('and the way to it is offered instead, to be taken when ready')
    : fail('the card arrived with nothing to say it had');
  window.__slateBusy = false;
}

// 6b. Send lands you BELOW the working, not above it.
//
// Send is the one moment in a sitting when the interesting thing is under the
// writing rather than over it: the receipt that says it arrived sits at the foot
// of the surface, and "the tutor is writing" sits under that, and between them
// they answer the only question a person has after pressing the button. The
// board used to move upwards instead — and separately, the payload the send
// provoked carried a turn one revision newer than the one on the surface, so the
// answer was fetched back off the server and re-loaded, which re-fits the page
// and throws away the zoom the working was written at.
{
  const js = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
  /onSend:\s*function\s*\(res\)/.test(js)
    ? ok('Send is told which revision it just sent')
    : fail('the send callback ignores the server\'s answer, so the surface will '
           + 'reload the ink already on it and re-fit the page');
  /loadedTurn = res\.turn/.test(js)
    ? ok('and marks it as already on the surface, so nothing is re-fitted')
    : fail('nothing stops restoreAnswer re-loading the ink that was just sent');
  /function revealSent\(\)/.test(js) && /revealSentSettling\(\)/.test(js)
    ? ok('and the board is put under the writing, where the receipt is')
    : fail('nothing puts the page below the surface after a send');
  const body = (js.match(/function revealSent\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  /r\.bottom/.test(body)
    ? ok('anchored to the foot of the surface, not to a card above it')
    : fail('the after-send scroll is not anchored under the writing');

  // And it lets go the moment the tutor replies. Landing on the surface's foot
  // is re-tried 300ms and 900ms after a send, to catch the receipt and the
  // tutor's chip settling to their real heights. But a reply moves the surface:
  // it lands above it and the next board opens underneath, so `els.writer` is by
  // then a fresh blank sheet BELOW the card being read, and a repeat aimed at its
  // foot drags the reader down past the thing they were waiting for. Two smooth
  // scrolls with destinations either side of the new card is the other half of
  // "scrolled into the middle of that message".
  const settle = (js.match(/function revealSentSettling\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  /cardsArrived/.test(settle)
    ? ok('and the repeats stand down the moment a card arrives')
    : fail('the after-send repeats still fire once the tutor has replied, when '
           + 'the surface they aim at has moved below the reply');
}

// 6c. Finishing an exercise must not leave you with nowhere to write.
//
// The surface closes when the tutor says the answer is right, which is correct
// almost always and a dead end the rest of the time. "Correct — now strike that
// line from it" is a `correct` card that still wants a pen. So is remembering
// four more exercises you meant to mention. Reaching a state with nowhere to
// write, by getting an exercise RIGHT, is the worst possible moment for one, and
// in a mathematics course there is no text box to fall back on either.
{
  const settled = Object.assign({}, lesson, {
    cards: lesson.cards.concat([card('0009', 'correct', 'that is the proof', 9)]),
  });
  es.onmessage({ data: JSON.stringify(settled) });

  const writer = doc.getElementById('writer');
  const reopen = doc.getElementById('reopen');
  writer.hidden
    ? ok('a correct answer closes the writing surface, as it should')
    : fail('the surface stays open for ever once opened; it is furniture');
  reopen
    ? ok('and the board carries a way to open it again')
    : fail('there is no way back to a pen: finishing an exercise is a dead end');
  reopen && !reopen.hidden
    ? ok('offered exactly where the surface was')
    : fail('the way back exists in the markup but is never shown');

  reopen.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  !writer.hidden
    ? ok('and asking for it brings the surface back')
    : fail('the button was pressed and no surface appeared');

  // It survives the next payload -- a heartbeat must not take it away again.
  es.onmessage({ data: JSON.stringify(settled) });
  !writer.hidden
    ? ok('and it stays through the payloads that follow')
    : fail('the surface was withdrawn again by the next heartbeat');

  // A new question supersedes the request: the surface would be open anyway,
  // and the request must not outlive what it was made for.
  es.onmessage({ data: JSON.stringify(Object.assign({}, settled, {
    cards: settled.cards.concat([card('0010', 'question', 'Exercise 1.4', 10)]),
  })) });
  !writer.hidden
    ? ok('a new question opens it on its own account')
    : fail('a new question left no surface to answer it on');
}

// 6c2. Every question keeps a surface, and no page is ever destroyed.
//
// The surface only ever answered the NEWEST question, and arriving at a new one
// called `clear` — which is a page of somebody's proof, deleted, because the
// tutor asked something else. Two hours of Exercise 1.3 went that way.
{
  const two = Object.assign({}, lesson, {
    cards: [
      card('0001', 'question', 'Exercise 1.3', 1),
      card('0011', 'note', 'which element is h', 2),
      card('0012', 'question', 'write the set in braces', 3),
    ],
  });
  es.onmessage({ data: JSON.stringify(two) });

  const js = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
  const restore = (js.match(/function restoreAnswer\(\)[\s\S]*?\n\}/) || [''])[0];
  !/writer\.clear\(\)/.test(restore)
    ? ok('arriving at a new question never wipes the surface')
    : fail('the surface is still cleared when a new question arrives — that is a '
           + 'page of working, deleted, because the tutor asked something else');
  /writer\.fresh\(/.test(restore) && /boardPage\[/.test(restore)
    ? ok('each board gets a page of its own instead')
    : fail('there is no page per board, so answers still share one surface');
  /inkOn\(\)\s*>\s*0/.test(restore)
    ? ok('and a page with ink on it is never overwritten from the server')
    : fail('the server can still replace working written since the last send');

  // Every question carries a board, and exactly one of them is real. The rest
  // are pictures of themselves drawn by the same paint code -- because a live
  // surface is two canvases at device resolution, and a dozen of those is not a
  // slow board, it is a board that hands back blank canvases.
  const slot = doc.querySelector('[data-board="0001"]');
  slot
    ? ok('an earlier question still has a board under it')
    : fail('once the tutor asks something else, the previous question has no '
           + 'surface at all');
  !doc.querySelector('[data-board="0012"]')
    ? ok('and the question being answered has the real one, not a picture')
    : fail('the live question is showing a photograph of itself');
  slot && slot.querySelector('.board-send')
    ? ok('and its own Send')
    : fail('a dormant board cannot be sent');

  {
    const css = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
    /#writer,\s*\.board\s*\{/.test(css)
      ? ok('a dormant board is styled by the same rules as the live one')
      : fail('the two boards are styled separately and will drift apart');
    /#writer #slate,\s*\.board-shot\s*\{/.test(css)
      ? ok('and is exactly as tall')
      : fail('a dormant board is a different height, which gives it away');
  }

  // Touching one makes it the live one.
  if (slot) {
    slot.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    !els.writer.hidden
      ? ok('touching a dormant board opens the real surface')
      : fail('touching a board left nothing to write on');
    !doc.querySelector('[data-board="0001"]')
      ? ok('and it is the live one now, not a picture of itself')
      : fail('the board did not actually go live');
    doc.querySelector('[data-board="0012"]')
      ? ok('while the one just left behind becomes a picture')
      : fail('the question left behind lost its board entirely');
  }

  // And a pen already on the glass is not asked to lift and try again.
  {
    const js = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
    /function handOnStroke/.test(js) && /dispatchEvent\(copy\)/.test(js)
      ? ok('a stroke that landed on a picture is handed to the canvas that '
           + 'replaced it')
      : fail('the first mark on a dormant board is eaten by the swap, which is '
             + 'indistinguishable from a broken pen');
    const core = fs.readFileSync(path.join(WEB, 'slate-core.js'), 'utf8');
    /try \{ sheet\.setPointerCapture/.test(core)
      ? ok('and the canvas does not throw on a pointer it never saw natively')
      : fail('handing a stroke on will throw inside the pointerdown handler');
    /c\.width = c\.height = 1;/.test(core)
      ? ok('a preview throws its pixels away as soon as it has them')
      : fail('every preview leaves a canvas behind, which is the whole problem '
             + 'this exists to avoid');
  }
}

// 6c3. Getting an exercise RIGHT deleted every board on the page.
//
// Reported from the device, mid-homework: "when I go back above to see my
// previous responses, it still shows an unchangeable picture of my response. I
// want the actual writing board containing my response."
//
// The boards were painted only while an answer was owed, and nothing is owed the
// moment the tutor writes a `correct` card -- so finishing a problem tore down
// every surface in the lesson and left the transcript as photographs of what had
// been sent. A photograph is a record of an answer; it is not a place to add a
// line to one. The way back, `#reopen`, opens the NEWEST question and only that,
// so an earlier problem was unreachable however much working was on its page.
{
  const q1 = Object.assign({}, lesson, {
    cards: [card('0031', 'question', 'Problem 1', 1)], turns: [],
  });
  es.onmessage({ data: JSON.stringify(q1) });
  await sleep(20);                    // the surface opens on it and takes a page

  const q2 = Object.assign({}, lesson, {
    cards: [card('0031', 'question', 'Problem 1', 1),
            card('0032', 'note', 'take P of both sides', 2),
            card('0033', 'question', 'Problem 2 — Bonferroni', 3)],
    turns: [],
  });
  es.onmessage({ data: JSON.stringify(q2) });
  await sleep(20);                    // ...and moves on, which takes another

  const done = Object.assign({}, q2, {
    cards: q2.cards.concat([card('0034', 'correct', 'that is the proof', 4)]),
    turns: [{ id: 't0009', rev: 4, kind: 'ink', answers: '0033', t: t0 + 450,
              iso: '2026-08-31 10:02:00', png: '/answers/t0009-r4.png',
              ink: '/answers/t0009-r4.json' }],
  });
  es.onmessage({ data: JSON.stringify(done) });
  await sleep(20);

  els.writer.hidden
    ? ok('a correct answer still closes the panel')
    : fail('the panel stayed open, which is not what was asked for');

  const shown = (q) => {
    const n = doc.querySelector('[data-board="' + q + '"]');
    return !!n && !n.hidden;
  };
  shown('0031')
    ? ok('but an earlier question keeps its board once the exercise is marked right')
    : fail('finishing a problem deleted the board under every earlier question, '
           + 'leaving a picture of the answer and nowhere to write');
  shown('0033')
    ? ok('and so does the one that was just answered')
    : fail('the question just finished has no board, so the only way back to the '
           + 'working is a photograph of it');

  // Touching one is the whole point: it must open the real surface, on THAT
  // question's page, even though nothing is owed.
  const slot = doc.querySelector('[data-board="0031"]');
  slot.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await sleep(20);
  !els.writer.hidden
    ? ok('touching an earlier board opens the real surface on a finished lesson')
    : fail('touching a board on a settled lesson does nothing at all');
  !doc.querySelector('[data-board="0031"]')
    ? ok('and that question has the live one now, not a picture')
    : fail('the board did not go live');

  // And it survives the heartbeat. The request used to be cancelled by
  // comparing it against the NEWEST question -- and an earlier question is by
  // definition not the newest, so asking to write on one was withdrawn by the
  // very next payload, thirty seconds later or sooner.
  es.onmessage({ data: JSON.stringify(done) });
  await sleep(20);
  !els.writer.hidden
    ? ok('and the next payload does not withdraw it again')
    : fail('the surface was taken away by the heartbeat, because the question '
           + 'asked for was not the newest one');
  doc.querySelector('[data-board="0033"]')
    ? ok('while the question left behind goes back to being a picture')
    : fail('the question left behind lost its board');

  // 6c4. The type tab did nothing on a question already answered in ink.
  //
  // `panelKind` read the question's history first: a sent ink turn returned
  // "write" whatever the tabs were told, so pressing *type* set the remembered
  // kind, repainted, and was overruled on the way back. Which is every question
  // worth typing about -- you write the proof, the tutor asks what you meant by
  // a line of it, and the answer to that is a sentence.
  const board33 = doc.querySelector('[data-board="0033"]');
  board33.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await sleep(20);
  const typebox = doc.getElementById('typebox');
  const slate = doc.getElementById('slate');
  typebox.hidden
    ? ok('a question answered in ink opens on the pen, as it should')
    : fail('the ink answer did not bring back the writing half');

  doc.getElementById('tab-type').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }));
  !typebox.hidden
    ? ok('and pressing type opens the keyboard half, ink or no ink')
    : fail('pressing type does nothing on a question already answered in ink, '
           + 'which is the only kind of question worth typing about');
  slate.hidden
    ? ok('with the pen put away rather than stacked above it')
    : fail('both halves of the panel are open at once');

  doc.getElementById('tab-write').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }));
  typebox.hidden && !slate.hidden
    ? ok('and the tab goes back, so neither choice is a trap')
    : fail('having chosen to type there is no way back to the pen');

  // The choice belongs to the question it was made on, and it outlives leaving
  // that question -- otherwise the history takes it straight back on return,
  // which is the defect in a slower disguise. (A question with no history of its
  // own still opens on the globally remembered kind: that is the documented
  // "whichever you used last opens next time", and it is not what was reported.)
  doc.getElementById('tab-type').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true }));
  const other = doc.querySelector('[data-board="0031"]');
  if (other) {
    other.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    await sleep(20);
    const back = doc.querySelector('[data-board="0033"]');
    if (back) back.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    await sleep(20);
    !doc.getElementById('typebox').hidden
      ? ok('and coming back to a question you chose to type on keeps the keyboard')
      : fail('the ink history took the panel back the moment the question was '
             + 'left and returned to');
  }
}

// 6c5. The board IS the answer: a written answer is not also frozen into a
// picture above it.
//
// The transcript froze every ink answer at the moment it was sent, which was
// right when the slate was ONE surface that got written over -- the picture was
// then the only copy of what had been handed in. It is not one surface any
// more. Every question owns a page, nothing is ever wiped, and that page is
// still under the board at the end of the question's run. So the picture and
// the board were two copies of the same ink with one of them dead, and going
// back up the lesson to an earlier answer found the dead one: "I wanted the
// frozen submission REPLACED by a live surface."
//
// The rule is not new — the newest unanswered turn has always stood aside for
// the surface below it, for exactly this reason. This is that rule, now that
// every question can keep a board of its own.
{
  const turnNode = () => doc.querySelector('[data-turn="t0009"]');
  turnNode()
    ? ok('a written answer still appears in the transcript, in its own place')
    : fail('the answer vanished from the transcript altogether');
  turnNode() && !turnNode().querySelector('.slate-shot')
    ? ok('and is not also frozen into a picture, now that a board carries it')
    : fail('the answer is shown twice — a dead picture above, the live board '
           + 'below, which is the whole complaint');
  turnNode() && turnNode().querySelector('.to-board')
    ? ok('with one line saying where the working is, and a tap to reach it')
    : fail('the picture went and left nothing pointing at the board');
  turnNode() && /you ·/.test(turnNode().querySelector('.when').textContent)
    ? ok('and the transcript still records that an answer was sent, and when')
    : fail('the turn lost its heading, so nothing says an answer happened');

  // The tap goes somewhere. It scrolls to whichever of the two the board is at
  // that moment: the picture of it, or the live surface if it is the open one.
  {
    let went = null;
    const target = doc.querySelector('[data-board="0033"]') || els.writer;
    target.scrollIntoView = function () { went = this; };
    turnNode().querySelector('.to-board')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    went
      ? ok('and the tap actually goes to the board')
      : fail('the line is there and pressing it does nothing');
  }

  // The picture is the only record there is on a lesson nobody can write on, so
  // it comes straight back.
  const same = Object.assign({}, lesson, {
    cards: [card('0031', 'question', 'Problem 1', 1),
            card('0032', 'note', 'take P of both sides', 2),
            card('0033', 'question', 'Problem 2 — Bonferroni', 3),
            card('0034', 'correct', 'that is the proof', 4)],
    turns: [{ id: 't0009', rev: 4, kind: 'ink', answers: '0033', t: t0 + 450,
              iso: '2026-08-31 10:02:00', png: '/answers/t0009-r4.png',
              ink: '/answers/t0009-r4.json' }],
  });
  const filed = Object.assign({}, same, { archived: true });
  es.onmessage({ data: JSON.stringify(filed) });
  await sleep(20);
  const filedTurn = doc.querySelector('[data-turn="t0009"]');
  filedTurn && filedTurn.querySelector('.slate-shot')
    ? ok('a filed lesson keeps the frozen picture, having no surface to offer')
    : fail('a past lesson now shows neither the working nor a way to reach it');
  !doc.querySelector('[data-board]')
    ? ok('and paints no boards at all, since nothing there can be written on')
    : fail('a filed lesson is offering a writing surface');

  es.onmessage({ data: JSON.stringify(same) });
  await sleep(20);
}

// 6c6. The surface is usable before the network answers, and for that half
// second its page count is a lie. Acting on it destroyed page mappings.
//
// `Slate.create` hands back ONE blank page synchronously — deliberately, so a
// stroke made in the first half-second is not thrown away — and adopts the saved
// pages when `/slate/state` answers. The board read that count to decide which
// page a question belongs on. So a question recorded against page 3 looked like
// a question recorded past the end: the board ruled its page gone, cut a fresh
// one, and wrote THAT down. A reload therefore refiled question after question
// onto page 0, an evening's working ended up on a single sheet, and the mapping
// to it was gone. Nothing a person can see is lost, which is why it survived —
// the accident looked like continuity.
{
  const slate = window.__slate;
  slate
    ? ok('the surface is reachable, so its page bookkeeping can be asserted')
    : fail('no slate instance was captured');

  if (slate) {
    slate.ready()
      ? ok('a surface whose saved pages have arrived says so')
      : fail('the surface never admits to knowing its own pages');

    // The damage was to the RECORD of which page a question sits on, so that is
    // what to watch. A question filed while the count cannot be believed is a
    // question filed against the wrong page, permanently — and it is written to
    // storage, so it outlives the reload that caused it.
    const KEY = 'board.pages:Galois Theory:-';
    const filedIn = () => {
      try { return JSON.parse(window.localStorage.getItem(KEY) || '{}'); }
      catch (e) { return {}; }
    };
    // A question is a chain of boards now, so what is filed against a page is
    // the attempt in hand: the last board that question has.
    const pageFiled = (q) => {
      const map = filedIn();
      const keys = Object.keys(map).filter((k) => k.slice(0, k.lastIndexOf('#')) === q);
      keys.sort((a, b) => parseInt(a.split('#')[1], 10) - parseInt(b.split('#')[1], 10));
      const rec = keys.length ? map[keys[keys.length - 1]] : null;
      return rec ? rec.p : undefined;
    };
    const fresh41 = Object.assign({}, lesson, {
      cards: [card('0041', 'question', 'a question never seen before', 1)],
      turns: [],
    });

    const realReady = slate.ready;
    slate.ready = () => false;
    es.onmessage({ data: JSON.stringify(fresh41) });
    await sleep(20);
    pageFiled('0041') === undefined
      ? ok('a question arriving before the pages do is not filed against one')
      : fail('the board filed a question against a page number it had been told '
             + 'not to believe, and wrote it down — which is the whole defect');

    // ...and the moment the pages land, it is filed properly.
    slate.ready = realReady;
    es.onmessage({ data: JSON.stringify(fresh41) });
    await sleep(20);
    pageFiled('0041') !== undefined
      ? ok('and is filed the moment the real pages arrive')
      : fail('the question never got a page even after the surface was ready');

    // The board has to be TOLD, not left to find out on a heartbeat thirty
    // seconds later — the person is looking at a blank board in the meantime.
    const core = fs.readFileSync(path.join(WEB, 'slate-core.js'), 'utf8');
    /opts\.onPages/.test(core)
      ? ok('and the surface calls the board the moment its pages land')
      : fail('nothing tells the board the page count became trustworthy');
    const js2 = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
    /onPages: function \(\)/.test(js2) && /restoreAnswer\(\);/.test(js2)
      ? ok('and the board puts the right page under the pen when told')
      : fail('the board is told and does nothing with it');
  }
}

// 6c7. A question arrived with nowhere to answer it.
//
// Reported from the device: a preliminary question answered, marked right, the
// actual homework problem posed — "but no new writing board appeared".
//
// Two things had to be true at once, and the boards becoming reachable is what
// made the pair reachable. Going back to an earlier question pins the live
// surface there, and nothing cleared the pin: `workingOn` was set by touching a
// board and outlived everything, including the tutor asking something new. So
// the new question found the surface parked several cards above it — and,
// having never been written on, it had no page of its own either, and a question
// with no page drew no board at all. A question posed with nowhere to answer it
// is the worst state this board has.
//
// The rule is the one `reopenedFor` has always had: a request must not outlive
// what it was made for.
{
  const run = Object.assign({}, lesson, {
    cards: [card('0051', 'question', 'the preliminary', 1),
            card('0052', 'note', 'nearly', 2),
            card('0053', 'correct', 'that is it', 3)],
    turns: [],
  });
  es.onmessage({ data: JSON.stringify(run) });
  await sleep(20);

  // They go back to the preliminary to add a line — which is what the boards
  // are for, and what pins the surface.
  const back = doc.querySelector('[data-board="0051"]');
  back
    ? ok('an answered question offers its board back')
    : fail('there is no board to go back to');
  if (back) {
    back.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    await sleep(20);
    !els.writer.hidden
      ? ok('and touching it parks the live surface there')
      : fail('touching the board opened nothing');
  }

  // Now the tutor poses the actual problem.
  const posed = Object.assign({}, run, {
    cards: run.cards.concat([card('0054', 'question', 'Problem 4 — E before F', 4)]),
  });
  es.onmessage({ data: JSON.stringify(posed) });
  await sleep(20);

  !els.writer.hidden
    ? ok('a new question opens a surface')
    : fail('the new question has no writing surface at all');
  const under = doc.querySelector('[data-card="0054"]');
  under && under.nextElementSibling === els.writer
    ? ok('and it is the LIVE one, under the question just asked')
    : fail('the live surface stayed parked on the earlier question, so the new '
           + 'one was posed with nowhere to answer it');
  doc.querySelector('[data-board="0051"]')
    ? ok('while the question left behind goes back to being a board')
    : fail('going back to the earlier question is no longer offered');

  // The safety net, independent of the above: a question nobody has written on
  // still shows a board. It cannot be a picture — there is nothing to
  // photograph — so it is a blank one, and touching it cuts the page.
  const never = Object.assign({}, lesson, {
    cards: [card('0061', 'question', 'one', 1),
            card('0062', 'question', 'another nobody has reached', 2)],
    turns: [],
  });
  es.onmessage({ data: JSON.stringify(never) });
  await sleep(20);
  const b61 = doc.querySelector('[data-board="0061"]');
  b61 && !b61.hidden
    ? ok('a question never written on still shows a board, blank')
    : fail('a question with no page shows nothing at all, so anything that '
           + 'parks the surface elsewhere leaves it unanswerable');
  b61 && !b61.querySelector('.board-shot').getAttribute('src')
    ? ok('with no picture on it, there being nothing yet to photograph')
    : fail('a blank board is showing a picture of something');
  // An empty board that is captioned like a full one reads as a board whose
  // working has gone missing — which is how it was read on the first evening it
  // existed, by someone whose ink was on disk the whole time.
  b61 && /nothing written here yet/.test(b61.querySelector('.board-hint').textContent)
    ? ok('and saying so, so an empty board never reads as lost work')
    : fail('an empty board is captioned exactly like one with working on it');
  if (b61) {
    b61.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    await sleep(20);
    !els.writer.hidden && !doc.querySelector('[data-board="0061"]')
      ? ok('and touching it gives that question the real surface')
      : fail('a blank board cannot be written on, which makes it decoration');
  }
}

// 6c8. One question, one page — and nothing enforced it.
//
// Reported: "if I write on an earlier board, that change also takes effect on a
// later board". They were not two boards showing similar things; they were the
// same sheet. `fresh()` hands back a trailing BLANK page rather than cutting a
// new one every time — right, or every question leaves an empty sheet behind
// it — but two questions that reach it before either is written on both get
// that index, and from then on they are one page with two boards over it.
//
// The slate cannot see the collision: it deals in ink, not in questions. Only
// the board knows who owns what, so the board is what has to say.
{
  const two = Object.assign({}, lesson, {
    cards: [card('0071', 'question', 'the first', 1)],
    turns: [],
  });
  es.onmessage({ data: JSON.stringify(two) });
  await sleep(20);

  const KEY2 = 'board.pages:Galois Theory:-';
  const filed = () => {
    try { return JSON.parse(window.localStorage.getItem(KEY2) || '{}'); }
    catch (e) { return {}; }
  };
  const lastKey = (map, q) => {
    const keys = Object.keys(map).filter((k) => k.slice(0, k.lastIndexOf('#')) === q);
    keys.sort((a, b) => parseInt(a.split('#')[1], 10) - parseInt(b.split('#')[1], 10));
    return keys.length ? keys[keys.length - 1] : null;
  };
  const pageOfQ = (q) => {
    const map = filed();
    const k = lastKey(map, q);
    return k ? map[k].p : undefined;
  };
  const first = pageOfQ('0071');
  first !== undefined
    ? ok('the first question is given a page')
    : fail('no page was filed for the first question');

  // A second question, before anything is written on the first one's page.
  es.onmessage({ data: JSON.stringify(Object.assign({}, two, {
    cards: two.cards.concat([card('0072', 'question', 'the second', 2)]),
  })) });
  await sleep(20);
  const second = pageOfQ('0072');
  second !== undefined
    ? ok('and so is the second')
    : fail('no page was filed for the second question');
  second !== first
    ? ok('and it is NOT the same page, blank though the first one was')
    : fail('two questions were handed one sheet, so writing on either board '
           + 'changes both — which is exactly what was reported');

  // The repair for a pair already sharing: the later one takes a copy, so what
  // is on screen does not vanish out from under anybody, and from there the two
  // go their own ways. Forced by filing them onto one page by hand, which is
  // the state the old code left behind.
  {
    const map = filed();
    map[lastKey(map, '0072')].p = map[lastKey(map, '0071')].p;
    window.localStorage.setItem(KEY2, JSON.stringify(map));
    // The board keeps its own copy in memory; drive the collision through the
    // path that repairs it by making 0072 the question in hand.
    const slate = window.__slate;
    const before = slate.pages();
    es.onmessage({ data: JSON.stringify(Object.assign({}, two, {
      cards: two.cards.concat([card('0072', 'question', 'the second', 2),
                               card('0073', 'question', 'a third', 3)]),
    })) });
    await sleep(20);
    slate.pages() >= before
      ? ok('a question sharing a sheet is given one of its own')
      : fail('pages went backwards, which loses working');
  }

  const core = fs.readFileSync(path.join(WEB, 'slate-core.js'), 'utf8');
  /api\.clone = function/.test(core) && /markDirty\(\);/.test(core)
    ? ok('and the copy is marked dirty, so it reaches disk rather than living '
         + 'in memory until a reload throws it away')
    : fail('a cloned page is never saved');
}

// 6c9. Two zooms on this page, and only one had a way back.
//
// `#panic` puts the PAGE's magnification back. The writing surface has a zoom
// of its own that it knows nothing about, and being lost in that one left the
// toolbar's ⤢ — which lives in the page chrome, which is what pinching pans off
// the glass.
{
  const find = doc.getElementById('findink');
  !find.hidden
    ? ok('with a surface open, the writing re-centre is offered')
    : fail('there is no way back from a zoom into the writing');

  const slate = window.__slate;
  slate.load({ w: 1000, h: 1400, strokes: [
    { c: '#eee', w: 2, pts: [[300, 1000], [500, 1050], [520, 1200]] },
  ] });
  // Get thoroughly lost: zoom in hard, somewhere with nothing on it.
  slate.zoom ? slate.zoom(6) : null;
  const before = slate.view();
  find.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const after = slate.view();
  const box = slate.inkBox();
  const top = -after.oy / after.k;
  const left = -after.ox / after.k;
  box && top <= box.y0 && top + 500 / after.k > box.y0
    ? ok('and pressing it puts the writing back on screen vertically')
    : fail('the writing is still off screen after the re-centre');
  box && left <= box.x0 + 1
    ? ok('and horizontally')
    : fail('the re-centre left the writing off to one side');
  after.k !== before.k || after.oy !== before.oy
    ? ok('so the view actually moved')
    : fail('the button did nothing at all');
}

// 6d. And a picture can be handed over from the device. The file input has been
// in the page from the beginning and nothing ever opened it -- dropping a file
// and pasting one both worked, and neither is a gesture that exists on a tablet.
{
  const add = doc.getElementById('btn-add-file');
  const file = doc.getElementById('file');
  add ? ok('there is a control for adding a photograph')
      : fail('the only ways to hand over a picture are drag-and-drop and paste');
  let opened = false;
  if (file) file.click = () => { opened = true; };
  if (add) add.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  opened
    ? ok('and pressing it opens the picker')
    : fail('the control does not reach the file input');
}

// 7. The writing surface must NOT be capped against what can be seen.
//
// It was, once, and the cap was a fraction of the visible window -- so it shrank
// by exactly the factor the page was magnified by, and pinch-zooming into the
// writing did nothing at all: the block got smaller as fast as the page got
// bigger. A surface for reading handwriting that cannot be zoomed into is worse
// than one you can occasionally get lost in. The re-centre button is what makes
// zooming safe now; see test/panic.js.
{
  const css = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
  const slate = (css.match(/#writer #slate\s*\{[^}]*\}/) || [''])[0];
  !/--slate-cap|visualViewport/.test(slate)
    ? ok('the surface height is not clamped to the visible window')
    : fail('the surface is capped against the viewport again: zooming into the '
           + 'writing will do nothing');
  const wr = (css.match(/#writer,\s*\.board\s*\{[^}]*\}/) || [''])[0];
  !/--gap-zoom/.test(wr)
    ? ok('and neither is its width')
    : fail('the width is capped against the viewport again');
  /--gap:\s*max\(/.test(wr)
    ? ok('while the strip of page down each side survives, to put a thumb on')
    : fail('the writing surface runs to the edge of the glass again');
}

console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                          : '\nthe newest reply is the one under the working');
process.exit(errors.length ? 1 : 0);
})();
