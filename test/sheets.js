// A page is addressed by its number. A gap in the numbers must not move anybody.
//
// Reported from an iPad on relaunching a Galois sitting: "none of the boards
// have my preserved written work on them. I think the work is still saved."
//
// It was. Every page was on disk and every frozen answer was intact. What had
// gone was the ARITHMETIC between the two: the surface took the list of saved
// pages as its array, and addressed the page at index i on the next save as
// `page-(i+1)`. That holds only while the numbers on disk are gapless — and a
// file appears when a page is SAVED, so a page cut and never written on leaves
// none. `page-01`, `-06`, `-08` and `-10` had never been saved, so after a
// reload index 5 was `page-09` and the next stroke on it was written to
// `page-06`.
//
// The fingerprint was all over that directory: `page-13`/`page-14`
// byte-identical, `page-21`/`page-22`, `page-34`/`page-35`,
// `page-41`/`-42`/`-43` — each one a page written back out under its
// neighbour's number, silently, while every board on the screen pointed at
// somebody else's sheet.
//
// So: the number is the identity, it comes off the filename, and it is what the
// save addresses. This test is the gap.
//
// jsdom, because both halves of it are the surface and the board disagreeing.

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

// Exactly the shape that was on disk: 1, 6, 8 and 10 never saved.
const NUMBERS = [2, 3, 4, 5, 7, 9, 11, 12];
const stroke = (n) => ({ c: '#eee', w: 3, pts: [[10 * n, 10], [10 * n, 90]] });
// Each page carries as many strokes as its own number, so which sheet is which
// is visible in one integer and a swap cannot hide.
const saved = NUMBERS.map((n) => ({
  page: n, w: 1130, h: 1514,
  strokes: Array.from({ length: n }, (_, i) => stroke(n + i / 100)),
}));

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
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 900, height: 120, right: 900, bottom: 120, x: 0, y: 0 };
};
window.Element.prototype.scrollIntoView = function () {};
window.Element.prototype.setPointerCapture = function () {};
window.Element.prototype.releasePointerCapture = function () {};

// Every save the surface makes, so the assertion can be about the number that
// actually goes on the wire rather than about an internal.
const posted = [];
window.fetch = (u, init) => {
  const url = String(u);
  if (/slate\/state/.test(url)) {
    return Promise.resolve({ json: () => Promise.resolve({ pages: saved }) });
  }
  if (/slate\/save/.test(url)) {
    let body = {};
    try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
    posted.push(body);
    return Promise.resolve({ json: () => Promise.resolve({ ok: true, page: body.page }) });
  }
  if (/answers\/.*\.json/.test(url)) {
    // The frozen answer: what was handed in, which cannot move.
    return Promise.resolve({ json: () => Promise.resolve(
      { w: 1130, h: 1514, strokes: saved[5].strokes.slice() }) });
  }
  return new Promise(() => {});
};
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
const t0 = 1788400000;
const card = (id, kind, title, n) =>
  ({ id, kind, title, body: 'the ' + title + ' body', mtime: t0 + n * 100 });
const KEY = 'board.pages.n:Galois Theory:-';
const mapping = () => {
  try { return JSON.parse(window.localStorage.getItem(KEY) || '{}'); }
  catch (e) { return {}; }
};

(async () => {

// -------------------------------------------------- the surface itself
es.onmessage({ data: JSON.stringify({
  state: { course: 'Galois Theory', session: 'lecture', mode: 'math' },
  cards: [card('0001', 'question', 'Exercise 3.8', 1)],
  // The answer to 3.8 was handed in off page 9 — the SIXTH file on disk.
  turns: [{ id: 't0001', rev: 1, kind: 'ink', answers: '0001', t: t0 + 200,
            page: 9, strokes: 9, png: '/answers/t0001-r1.png',
            ink: '/answers/t0001-r1.json' }],
  history: 0,
}) });
await sleep(80);

// Built lazily, on the frame after the first payload: there is nothing to put
// under a pen until there is a lesson.
const slate = window.__slate;
if (!slate) { console.log('FAIL no slate instance was captured'); process.exit(1); }
ok('the surface is reachable');

slate.pages() === NUMBERS.length
  ? ok('the whole sitting is on the surface')
  : fail('only ' + slate.pages() + ' of ' + NUMBERS.length + ' pages arrived');
NUMBERS.every((n) => slate.hasPage(n))
  ? ok('and every page answers to the number it is saved under')
  : fail('a page cannot be found by its own number: '
         + NUMBERS.filter((n) => !slate.hasPage(n)).join(', '));
!slate.hasPage(1) && !slate.hasPage(6) && !slate.hasPage(8)
  ? ok('while a number nothing was ever saved under is simply not there')
  : fail('a gap in the numbering came back as a page');
slate.inkOn(9) === 9
  ? ok('page 9 holds page 9\'s writing, whatever position it sits at')
  : fail('page 9 holds ' + slate.inkOn(9) + ' strokes — the sixth file on disk '
         + 'has ' + slate.inkOn(9) + ', which is the slide');

// ---------------------------------------------------- and the board with it
const q = mapping()['0001#0'];
q && q.p === 9
  ? ok('the board for the question is put on the sheet the answer came off')
  : fail('the board was filed onto page ' + (q && q.p) + ' rather than 9 — '
         + 'which is the reported defect: the working is on disk and the board '
         + 'is looking somewhere else');
slate.at() === 9
  ? ok('and that is the page under the pen')
  : fail('the pen is on page ' + slate.at() + ', not on the working');

// ------------------------------------- and the save addresses that number
//
// The half that did the damage. A page saved under its POSITION wrote over
// whichever file that position happened to name — a page nobody had touched,
// belonging to another question, holding somebody's proof.
posted.length = 0;
slate.load({ w: 1130, h: 1514, strokes: saved[5].strokes.concat([stroke(99)]) });
await slate.save(false);
await sleep(40);

const wrote = posted[posted.length - 1];
wrote && wrote.page === 9
  ? ok('writing on it saves to page 9, not to whichever file its position names')
  : fail('the save addressed page ' + (wrote && wrote.page)
         + ' — it would have written over that page\'s work');

// ------------------------------------------------- and a new page is a new page
const fresh = slate.fresh(true);
fresh === 13
  ? ok('a new page takes the next unused number, above everything on disk')
  : fail('a new page came back as ' + fresh + ', which is a number already in '
         + 'use — the next save would write over it');
posted.length = 0;
slate.load({ w: 1130, h: 1514, strokes: [stroke(1)] });
await slate.save(false);
await sleep(40);
const newest = posted[posted.length - 1];
newest && newest.page === 13
  ? ok('and it saves under that number')
  : fail('the new page saved as ' + (newest && newest.page));
slate.inkOn(9) === 10
  ? ok('while page 9 keeps what was written on it')
  : fail('cutting a new page disturbed page 9 (' + slate.inkOn(9) + ' strokes)');

// --------------------------------- and the record is numbers, not positions
//
// The other half of why this is now safe: the mapping in localStorage outlives
// the array it was written against. A record of positions cannot survive one
// page being cut, and there is nothing in it that says which it is — so the key
// is versioned, and anything written under the old one is thrown away rather
// than read as though it meant numbers.
/board\.pages\.n:/.test(Object.keys(window.localStorage).find(
  (k) => /board\.pages/.test(k)) || '')
  ? ok('the mapping is kept under a key that says it holds page numbers')
  : fail('the record is still under the key that held positions, so an old '
         + 'browser\'s indices will be read as numbers');

const src = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
/writer\.hasPage\(/.test(src)
  ? ok('and the board asks whether a page EXISTS rather than comparing it '
       + 'against a count, which is the question it actually has')
  : fail('the board is still bounds-checking a number against a page count');

console.log(errors.length ? '\n' + errors.length + ' FAILURES'
  : '\na page is its number, and a gap moves nobody');
process.exit(errors.length ? 1 : 0);

})();
