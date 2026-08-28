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
window.fetch = () => new Promise(() => {});
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
    return api;
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { window.eval(fs.readFileSync(path.join(WEB, 'board.js'), 'utf8')); }
catch (e) { fail('board.js: ' + e.message); }

const doc = window.document;
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
const withNew = Object.assign({}, lesson, {
  cards: lesson.cards.concat([card('0005', 'lesson', 'what a normal subgroup is', 5),
                              card('0006', 'wrong', 'still not the coset', 6),
                              card('0007', 'wrong', 'nearly', 7)]),
});
{
  scrolls.length = 0;
  es.onmessage({ data: JSON.stringify(withNew) });
  scrolls.length
    ? ok('a new reply scrolls the board')
    : fail('a new reply arrived and the board did not move at all');
  const asked = scrolls[scrolls.length - 1];
  asked !== doc.body.scrollHeight
    ? ok('and not to the bottom of the document, which is the blank slate')
    : fail('the board still scrolls past the feedback to the writing surface');

  // The newest card's own top, less the bar it would otherwise hide under.
  const live = nodeFor('0007').getBoundingClientRect();
  const bar = doc.getElementById('bar').getBoundingClientRect();
  asked > live.top - bar.height - 20 && asked <= live.top - bar.height
    ? ok('it scrolls to the first line of the new reply, clear of the bar')
    : fail('the scroll landed at ' + asked + ', not at the top of card 0007 ('
           + (live.top - bar.height) + ')');
}

// 5. A payload is not a card. This is the one that got out: the destination
//    changed from the bottom of the document to the newest card's first line,
//    and the rule was still "if they were at the bottom, go to the bottom" --
//    which had been a no-op for as long as the two were the same place. The
//    tutor's heartbeat lands every thirty seconds, so the board dragged itself
//    a screenful, over and over, while nobody was touching it.
{
  scrolls.length = 0;
  es.onmessage({ data: JSON.stringify(Object.assign({}, withNew, {
    agent: { agent: 'claude', state: 'working', turns: 3 },
  })) });
  !scrolls.length
    ? ok('a heartbeat with no new card does not move the page at all')
    : fail('the board scrolled for a payload that carried nothing new — '
           + scrolls.length + ' time(s)');

  es.onmessage({ data: JSON.stringify(Object.assign({}, withNew, { unsaved: 4 })) });
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
  es.onmessage({ data: JSON.stringify(Object.assign({}, withNew, {
    cards: withNew.cards.concat([card('0008', 'wrong', 'the last line', 8)]),
  })) });
  !scrolls.length
    ? ok('a card arriving while the pen is down does not move the page')
    : fail('the board scrolled out from under a pen that was mid-stroke');
  !jump.hidden
    ? ok('and the way to it is offered instead, to be taken when ready')
    : fail('the card arrived with nothing to say it had');
  window.__slateBusy = false;
}

// 5. The board reads the visual viewport, not the layout, when sizing the
//    surface. Pinch-zooming the page is invisible to vw/svh/rem, and a surface
//    that grows past every visible edge leaves nothing to pinch back out on.
{
  const js = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
  /visualViewport/.test(js)
    ? ok('the writing surface is sized against what can actually be seen')
    : fail('nothing consults the visual viewport; page zoom can still engulf the screen');
  /visualViewport\.addEventListener\(\s*["']resize/.test(js)
    ? ok('and re-sized as the magnification changes')
    : fail('the cap is computed once and never again');

  const css = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
  /--slate-cap/.test(css) && /min\(clamp\(/.test(css)
    ? ok('the height is capped by it')
    : fail('the surface height ignores the cap');
  /--gap-zoom/.test(css)
    ? ok('and so is the width, so a strip of page survives at every zoom')
    : fail('the width ignores the cap: the surface can still reach both edges');
}

console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                          : '\nthe newest reply is the one under the working');
process.exit(errors.length ? 1 : 0);
})();
