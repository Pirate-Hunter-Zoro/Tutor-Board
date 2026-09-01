// An exercise is a chain of boards, and every one of them stays.
//
// Reported from a Galois sitting, in these words: "For one exercise/question, I
// write down one thing, get feedback on it, and then get another board with all
// my prior work on it which is great, but the previous board for this same
// question that I have not yet completed doesn't persist... I want ALL boards to
// persist and to operate independently of each other."
//
// The board that "appeared" under the feedback was not another board. It was the
// same one, slid down the run to sit under the newest card — a question had
// exactly one board, so there was never a second one to keep. Only the last
// board of a finished question survived into the rest of the lesson, which is
// exactly what was described.
//
// So a question is a chain: one board per attempt. A board is frozen where it
// is as soon as what it holds has been handed in AND the tutor has written
// something since — both halves, or pressing Send to check your working would
// cut a board, and so would a hint about working nobody has sent. The next
// attempt opens on a COPY, which is what makes "all my prior work is on it" and
// "independently of each other" true at the same time.
//
// jsdom, because this is about what is actually in the document and how many
// pages the surface has.

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
const doc = window.document;

window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, { get: () => () => {}, set: () => true });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 900 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 500 });
Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { get: () => 4000 });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 900, height: 120, right: 900, bottom: 120, x: 0, y: 0 };
};
window.Element.prototype.scrollIntoView = function () {};
window.Element.prototype.setPointerCapture = function () {};
window.Element.prototype.releasePointerCapture = function () {};
window.fetch = (u) => (/slate\/state/.test(String(u))
  ? Promise.resolve({ json: () => Promise.resolve({ pages: [] }) })
  : new Promise(() => {}));
window.renderMathInElement = () => {};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = function () {};
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
const realCreate = window.Slate && window.Slate.create;
if (realCreate) {
  window.Slate.create = function (opts) {
    const api = realCreate(opts);
    window.__slate = api;
    return api;
  };
}
try { window.eval(fs.readFileSync(path.join(WEB, 'board.js'), 'utf8')); }
catch (e) { fail('board.js: ' + e.message); }

const es = window.__es;
if (!es) { console.log('FAIL board.js never opened a stream'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = 1788000000;
const card = (id, kind, title, n) =>
  ({ id, kind, title, body: 'the ' + title + ' body', mtime: t0 + n * 100 });
const writer = () => doc.getElementById('writer');
const boards = () => Array.from(doc.querySelectorAll('[data-board="0001"]'));
// One stroke, standing in for a hand: what matters here is that the page has ink
// on it and that the ink is not shared with another page.
const ink = (n) => ({ c: '#eee', w: 3, pts: [[10 + n, 10 + n], [90 + n, 90 + n]] });

// The lesson: one exercise, worked over several attempts.
const lesson = (cards, turns) => JSON.stringify({
  state: { course: 'Galois Theory', session: 'lecture', mode: 'math' },
  cards, turns: turns || [], history: 0,
});
const q1 = card('0001', 'question', 'Exercise 1.3', 1);

(async () => {

// ------------------------------------------------------------ the first board
es.onmessage({ data: lesson([q1]) });
await sleep(40);

const slate = window.__slate;
slate ? ok('the surface is reachable') : fail('no slate instance was captured');

!writer().hidden
  ? ok('a question opens a board to answer it on')
  : fail('the question has nowhere to be answered');
boards().length === 0
  ? ok('and it is the live one, so there is no picture of it as well')
  : fail('the live board is also being shown as a photograph of itself');

// Something is written on it.
slate.load({ w: 1130, h: 1514, strokes: [ink(1)] });
const firstPage = slate.at();

// ------------------------------------- sending, on its own, does not end it
es.onmessage({ data: lesson([q1], [
  { id: 't0001', rev: 1, kind: 'ink', answers: '0001', t: t0 + 150, page: firstPage + 1,
    strokes: 1, png: '/answers/t0001-r1.png', ink: '/answers/t0001-r1.json' },
]) });
await sleep(40);

boards().length === 0 && slate.pages() === 1
  ? ok('handing it in does not cut a new board — Send is also how you check '
       + 'your working, and it must not fork the page under your hand')
  : fail('a send on its own started a second board (' + boards().length
         + ' pictures, ' + slate.pages() + ' pages)');

// --------------------------------- the tutor answers, and the attempt is over
const fb = card('0002', 'note', 'the third line does not follow', 2);
es.onmessage({ data: lesson([q1, fb], [
  { id: 't0001', rev: 1, kind: 'ink', answers: '0001', t: t0 + 150, page: firstPage + 1,
    strokes: 1, png: '/answers/t0001-r1.png', ink: '/answers/t0001-r1.json' },
]) });
await sleep(40);

const kept = boards();
kept.length === 1
  ? ok('the board that was answered is still on the page, as a board')
  : fail('the previous board for this question did not persist (' + kept.length
         + ' of them) — which is the whole report');
kept.length === 1 && doc.querySelector('[data-card="0001"]').nextElementSibling === kept[0]
  ? ok('and it is still where it was written, under the question')
  : fail('the kept board moved somewhere other than where it was written');
doc.querySelector('[data-card="0002"]').nextElementSibling === writer()
  ? ok('while the next attempt is live under the feedback it answers')
  : fail('the live surface is not under the tutor\'s reply');

slate.pages() === 2
  ? ok('the next attempt is a page of its own')
  : fail('the next attempt did not get its own page (' + slate.pages() + ')');
slate.inkOn(1) === 1 && slate.at() === 1
  ? ok('opened on a copy, so everything written so far is still under the pen')
  : fail('the new board came up blank, losing the working it should carry '
         + '(page ' + slate.at() + ', ' + slate.inkOn(1) + ' strokes)');

// ------------------------------------------------------------- independently
slate.load({ w: 1130, h: 1514, strokes: [ink(2), ink(3)] });
await sleep(20);
slate.inkOn(0) === 1 && slate.inkOn(1) === 2
  ? ok('and writing on it leaves the board above exactly as it was')
  : fail('the two boards are one sheet: writing on the later one changed the '
         + 'earlier (' + slate.inkOn(0) + ' and ' + slate.inkOn(1) + ' strokes)');

// A second reply with nothing handed in since does NOT cut a third board: it is
// the answer to an attempt that ends it, not any card at all.
es.onmessage({ data: lesson([q1, fb, card('0003', 'note', 'and check the sign', 3)], [
  { id: 't0001', rev: 1, kind: 'ink', answers: '0001', t: t0 + 150, page: firstPage + 1,
    strokes: 1, png: '/answers/t0001-r1.png', ink: '/answers/t0001-r1.json' },
]) });
await sleep(40);
boards().length === 1 && slate.pages() === 2
  ? ok('a second remark about working nobody has re-sent cuts nothing')
  : fail('every card the tutor writes is starting a new board');

// ------------------------------------------------- and the chain keeps going
const run3 = [q1, fb, card('0003', 'note', 'and check the sign', 3),
              card('0004', 'note', 'nearly — the sign on the second term', 4)];
const sent2 = [{ id: 't0001', rev: 2, kind: 'ink', answers: '0001', t: t0 + 350,
                 page: 2, strokes: 2, png: '/answers/t0001-r2.png',
                 ink: '/answers/t0001-r2.json' }];
es.onmessage({ data: lesson(run3, sent2) });
await sleep(40);

boards().length === 2
  ? ok('a second attempt answered leaves a second board behind it')
  : fail('the chain stopped at one (' + boards().length + ' kept)');
slate.pages() === 3 && slate.inkOn(2) === 2
  ? ok('and the third attempt opens on a copy of the second')
  : fail('the third attempt did not carry the working forward ('
         + slate.pages() + ' pages, ' + slate.inkOn(2) + ' strokes on the last)');

// Every board in the chain says which attempt it is, so two pictures of similar
// working are not two mysteries.
const labelled = boards().filter((b) =>
  /attempt \d+ of \d+/.test(b.querySelector('.board-hint').textContent));
labelled.length === boards().length
  ? ok('each board says which attempt it is')
  : fail('the boards in a chain are captioned identically');

// Getting it right closes the panel, and every board in the chain stays: the
// picture of an answer is a record, and what was asked for is somewhere to
// carry on working.
es.onmessage({ data: lesson(run3.concat([card('0005', 'correct', 'that is the proof', 5)]),
                            sent2) });
await sleep(40);
writer().hidden && boards().length === 3
  ? ok('and finishing the exercise keeps all three, panel shut')
  : fail('marking it right lost boards (' + boards().length + ' kept, panel '
         + (writer().hidden ? 'shut' : 'open') + ')');
es.onmessage({ data: lesson(run3, sent2) });
await sleep(40);

// ------------------------------------------ and any of them can be written on
{
  const first = boards()[0];
  first.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  await sleep(40);
  !writer().hidden && slate.at() === 0
    ? ok('touching an earlier attempt opens the real surface on that page')
    : fail('an earlier board cannot be written on (page ' + slate.at() + ')');
  doc.querySelector('[data-card="0001"]').nextElementSibling === writer()
    ? ok('and the surface goes where that board was, not to the end of the run')
    : fail('the surface opened somewhere other than the board that was touched');
  boards().length === 2
    ? ok('while the attempts it was not opened on stay where they are')
    : fail('opening one board disturbed the others (' + boards().length + ')');
}

// -------------------------------------- a follow-up question is a blank board
{
  // What was reported the evening the chain shipped: "my writing didn't get
  // saved when a new board came up - same question". Nothing was lost -- the
  // working was on the board above, 180 strokes of it, and still is. But the
  // tutor's follow-up was a QUESTION card, and a question card is a new
  // question, and a new question gets a board of its own, which is blank.
  //
  // That is right for a new exercise and wrong three cards into one. The board
  // cannot tell those apart, and guessing would be worse than asking: a new
  // exercise opened on a copy is somebody else's proof under your pen, and every
  // board after it carries every stroke of the evening. So the offer is made and
  // the person decides.
  const followUp = card('0002', 'question', 'contrapositive or contradiction?', 6);
  es.onmessage({ data: lesson(run3.concat([followUp]), sent2) });
  await sleep(40);

  const carry = doc.getElementById('carry');
  !carry.hidden
    ? ok('a blank board with working behind it offers to carry it over')
    : fail('a follow-up question lands on a blank sheet with no way back to the '
           + 'proof it is asking about');
  /question 0001/.test(carry.textContent)
    ? ok('and says which board it would come from')
    : fail('"carry over" with no "from where": ' + carry.textContent);

  const before = slate.pages();
  const ink = slate.inkOn(slate.at());
  ink === 0
    ? ok('the new board really is blank until it is asked for')
    : fail('the follow-up board came up with ' + ink + ' strokes on it already');

  carry.onclick();
  await sleep(40);
  slate.pages() === before + 1
    ? ok('carrying it over makes a copy rather than reopening the same sheet')
    : fail('the working was moved, not copied (' + before + ' -> '
           + slate.pages() + ' pages)');
  slate.inkOn(slate.at()) === 2
    ? ok('and the working is under the pen')
    : fail('the carried board is empty (' + slate.inkOn(slate.at()) + ' strokes)');
  slate.inkOn(2) === 2
    ? ok('while the board it came from is untouched')
    : fail('carrying the working over took it away from where it was');
  doc.getElementById('carry').hidden
    ? ok('and the offer goes once there is something on the board')
    : fail('the offer is still standing over somebody\'s working, where taking '
           + 'it would replace it');
}

// ------------------------------------------------- and the record survives it
{
  const KEY = 'board.pages:Galois Theory:-';
  let map = {};
  try { map = JSON.parse(window.localStorage.getItem(KEY) || '{}'); } catch (e) {}
  const mine = Object.keys(map).filter((k) => k.indexOf('0001#') === 0).sort();
  mine.length === 3
    ? ok('all three boards are written down, so a reload finds them again')
    : fail('the chain is not persisted (' + mine.join(', ') + ')');
  const pages = mine.map((k) => map[k].p);
  new Set(pages).size === pages.length
    ? ok('each on a page of its own')
    : fail('two boards are filed onto one page: ' + pages.join(', '));
  mine.every((k) => !!map[k].a)
    ? ok('each remembering the card it sits under')
    : fail('a board does not know where it goes, so a reload cannot place it');
}

console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                          : '\nan exercise is a chain of boards, and every one of them stays');
process.exit(errors.length ? 1 : 0);
})();
