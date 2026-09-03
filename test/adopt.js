// An evening's saved pages are adopted, and nothing blank is allowed to refuse
// them.
//
// Reported from a Galois sitting on the Mac: every past board was blank, and the
// working looked lost. It was not lost -- it was on disk, and the surface never
// took it.
//
// The order was the whole defect. `Slate.create` hands back ONE blank page
// synchronously so a stroke made in the first half-second is not thrown away,
// and adopts the saved pages when `/slate/state` answers. `settled()` -- which
// exists to tell the board "the page count can be believed now" -- ran as the
// FIRST statement of that answer, before the saved pages were in. So the board
// was told to believe a count of 1, judged the question it was on to be recorded
// past the end, cut a fresh page for it, and by cutting it pushed the length to
// two. The adoption guard was `pages.length === 1`. It no longer held. The whole
// sitting was refused, silently, and the next stroke saved a blank sheet over a
// real page under its new number.
//
// So there are two things here and they are separate: the board is not told
// until the pages are actually in, and a page with no ink on it can never refuse
// a sitting however many of them there are.
//
// jsdom is a development-only dependency; without it this skips.

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

const W = 900, H = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A surface built against a server that has `n` pages saved, each with one
// stroke on it so there is something to lose. `onPages` is the board's hook, and
// what it sees when it fires is the question.
function surface(saved, onPages) {
  const dom = new JSDOM(fs.readFileSync(path.join(WEB, 'slate.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://board.test/slate',
  });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () =>
    new Proxy({}, { get: () => () => {}, set: () => true });
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => W });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => H });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0 };
  };
  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.setPointerCapture = function () {};
  window.Element.prototype.releasePointerCapture = function () {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.addEventListener('error', (e) => fail('uncaught: ' + e.message));

  const pages = [];
  for (let i = 0; i < saved; i++) {
    pages.push({ page: i + 1, w: 1130, h: 1514,
                 strokes: [{ c: '#eee', w: 3, pts: [[100, 100 + i], [200, 200 + i]] }] });
  }
  window.fetch = (u) => (/slate\/state/.test(String(u))
    ? Promise.resolve({ json: () => Promise.resolve({ pages: pages }) })
    : new Promise(() => {}));

  for (const f of ['typeface.js', 'slate-core.js']) {
    try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
    catch (e) { fail(f + ': ' + e.message); }
  }
  const api = window.Slate.create({
    root: window.document.getElementById('slate'),
    compact: false,
    onPages: function () { if (onPages) onPages(api); },
  });
  return { window, api };
}

(async () => {

// ------------------------------------------------- told only when it is true
{
  // What the board does with `onPages` is put the right page under the pen, and
  // the first thing it asks is how many pages there are. If that number is still
  // the stand-in when it is asked, everything downstream of it is wrong.
  let sawCount = null, sawInk = null;
  const s = surface(4, (api) => { sawCount = api.pages(); sawInk = api.inkOn(1); });
  await sleep(40);

  sawCount === 4
    ? ok('the board is told the count only once the saved pages are in')
    : fail('the board was told the pages had landed while the count was still '
           + 'the stand-in sheet (' + sawCount + ' of 4) — which is the defect');
  sawInk === 1
    ? ok('and the ink is on them by then, not arriving afterwards')
    : fail('the pages were counted before their strokes existed');
  s.api.pages() === 4
    ? ok('and the sitting is on the surface')
    : fail('the saved sitting never arrived (' + s.api.pages() + ' pages)');
  s.window.close();
}

// -------------------------------------------- a blank sheet cannot refuse it
{
  // Belt as well as braces. Whatever else adds a page before the answer lands --
  // a board cutting one, a ⋯ menu tapped in the first half-second -- an empty
  // sheet has nothing on it to protect, so it must not cost anybody an evening.
  const s = surface(4, null);
  s.api.fresh(true);                      // a second blank page, before the answer
  s.api.pages() === 2
    ? ok('a blank page can be cut before the answer arrives')
    : fail('the surface would not cut a page');
  await sleep(40);

  s.api.pages() === 4 && s.api.inkOn(1) === 1
    ? ok('and the saved sitting is still adopted over it')
    : fail('two blank sheets refused an evening on disk (' + s.api.pages()
           + ' pages, ' + s.api.inkOn(1) + ' strokes on the first)');
  s.window.close();
}

// ---------------------------------------------------- and the pen still wins
{
  // The rule this guard is really for: ink made before the network answered is
  // newer than anything the server remembered, and it is not thrown away.
  const s = surface(4, null);
  s.api.load({ w: 1130, h: 1514, strokes: [{ c: '#eee', w: 3, pts: [[10, 10], [20, 20]] }] });
  await sleep(40);

  s.api.pages() === 1 && s.api.inkOn(1) === 1
    ? ok('a stroke made before the answer came back still beats the server')
    : fail('writing in the first half-second was overwritten by the saved pages');
  s.window.close();
}

// ------------------------------------------- and the mapping is repaired too
{
  // The damage outlives the defect. An evening where the count was believed too
  // early is an evening where questions were refiled against pages they were
  // never written on -- and that record is in localStorage, where nothing can
  // tell a stale entry from a live one.
  //
  // The server can. Every answer handed in carries the page it was sent from,
  // so the board takes the mapping back from the record wherever the entry in
  // hand is untrustworthy: here, two questions filed onto one sheet.
  const dom = new JSDOM(fs.readFileSync(path.join(WEB, 'board.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://board.test/board',
  });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () =>
    new Proxy({}, { get: () => () => {}, set: () => true });
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => W });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => H });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0 };
  };
  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.setPointerCapture = function () {};
  window.Element.prototype.releasePointerCapture = function () {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.renderMathInElement = () => {};
  window.scrollTo = function () {};
  window.EventSource = function () {
    window.__es = this;
    this.readyState = 1;
    this.close = function () {};
    this.addEventListener = function () {};
  };
  const saved = [];
  for (let i = 0; i < 4; i++) {
    saved.push({ page: i + 1, w: 1130, h: 1514,
                 strokes: [{ c: '#eee', w: 3, pts: [[100, 100 + i], [200, 200 + i]] }] });
  }
  window.fetch = (u) => (/slate\/state/.test(String(u))
    ? Promise.resolve({ json: () => Promise.resolve({ pages: saved }) })
    : new Promise(() => {}));

  // The rotted record: the second question filed onto the first one's sheet,
  // which is one board changing when you write on the other.
  // A page is named by its NUMBER now, not by where it sits in the array the
  // surface happens to have built -- so the record says page 1, and page 1 is
  // page 1 whatever else is or is not on disk beside it.
  const KEY = 'board.pages.n:Galois Theory:-';
  window.localStorage.setItem(KEY, JSON.stringify({ '0001': 1, '0005': 1 }));

  for (const f of ['typeface.js', 'macros.js', 'slate-core.js', 'annotate.js', 'board.js']) {
    try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
    catch (e) { fail(f + ': ' + e.message); }
  }
  const es = window.__es;
  if (!es) {
    fail('board.js never opened a stream');
  } else {
    const t0 = 1787849000;
    const card = (id, kind, title, n) =>
      ({ id, kind, title, body: 'the ' + title + ' body', mtime: t0 + n * 100 });
    es.onmessage({ data: JSON.stringify({
      state: { course: 'Galois Theory', session: 'lecture', mode: 'math' },
      cards: [card('0001', 'question', 'Exercise 1.1', 1),
              card('0002', 'correct', 'right', 2),
              card('0005', 'question', 'Exercise 1.4', 3)],
      // What the server remembers: the answer to 1.4 was handed in off page 4.
      turns: [{ id: 't0002', rev: 1, kind: 'ink', answers: '0005', t: t0 + 400,
                page: 4, strokes: 12, png: '/answers/t0002-r1.png',
                ink: '/answers/t0002-r1.json' }],
      history: 0,
    }) });
    await sleep(60);

    let filed = {};
    try { filed = JSON.parse(window.localStorage.getItem(KEY) || '{}'); } catch (e) {}
    // A question is a chain of boards; the record is about the attempt in hand,
    // which for both of these questions is the first and only one.
    const pageOfQ = (q) => (filed[q + '#0'] || {}).p;
    pageOfQ('0005') === 4
      ? ok('a question filed onto another question\'s sheet is put back on the '
           + 'page the record says it was sent from')
      : fail('the rotted mapping stood: question 0005 is still on page '
             + pageOfQ('0005') + ', sharing with 0001');
    pageOfQ('0001') === 1
      ? ok('and the question that was not sent keeps the page it had')
      : fail('a mapping with no record behind it was overwritten anyway');
  }
  window.close();
}

// ------------------------------------- two boards holding each other's working
{
  // The half the tests above could not see. Reported from the board, looking
  // back over a lesson: "their recordings are out of wack. My writing from one
  // section is wrong and came from a later section, vice versa."
  //
  // Two questions, each filed onto the page the OTHER one was sent from. Every
  // conservative test passes: both pages exist, no two boards share a sheet in
  // this browser, and both have ink on them. It is just the wrong ink. The only
  // thing that can tell is the server's own record of which page each answer
  // was handed in from -- so a board sitting on a page the record says belongs
  // to another question is wrong on evidence, and gets moved.
  const dom = new JSDOM(fs.readFileSync(path.join(WEB, 'board.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://board.test/board',
  });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () =>
    new Proxy({}, { get: () => () => {}, set: () => true });
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => W });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => H });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0 };
  };
  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.setPointerCapture = function () {};
  window.Element.prototype.releasePointerCapture = function () {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.renderMathInElement = () => {};
  window.scrollTo = function () {};
  window.EventSource = function () {
    window.__es = this;
    this.readyState = 1;
    this.close = function () {};
    this.addEventListener = function () {};
  };
  const saved = [];
  for (let i = 0; i < 4; i++) {
    saved.push({ page: i + 1, w: 1130, h: 1514,
                 strokes: [{ c: '#eee', w: 3, pts: [[100, 100 + i], [200, 200 + i]] }] });
  }
  window.fetch = (u) => (/slate\/state/.test(String(u))
    ? Promise.resolve({ json: () => Promise.resolve({ pages: saved }) })
    : new Promise(() => {}));

  // Swapped: 0001 on the page 0005 was sent from, and 0005 on 0001's.
  const KEY = 'board.pages.n:Galois Theory:-';
  window.localStorage.setItem(KEY, JSON.stringify({ '0001#0': { p: 4 },
                                                    '0005#0': { p: 2 } }));

  for (const f of ['typeface.js', 'macros.js', 'slate-core.js', 'annotate.js', 'board.js']) {
    try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
    catch (e) { fail(f + ': ' + e.message); }
  }
  const es = window.__es;
  if (!es) {
    fail('board.js never opened a stream');
  } else {
    const t0 = 1787849000;
    const card = (id, kind, title, n) =>
      ({ id, kind, title, body: 'the ' + title + ' body', mtime: t0 + n * 100 });
    es.onmessage({ data: JSON.stringify({
      state: { course: 'Galois Theory', session: 'lecture', mode: 'math' },
      cards: [card('0001', 'question', 'Exercise 1.1', 1),
              card('0005', 'question', 'Exercise 1.4', 3)],
      turns: [{ id: 't0001', rev: 1, kind: 'ink', answers: '0001', t: t0 + 200,
                page: 2, strokes: 9, png: '/answers/t0001-r1.png',
                ink: '/answers/t0001-r1.json' },
              { id: 't0002', rev: 1, kind: 'ink', answers: '0005', t: t0 + 400,
                page: 4, strokes: 12, png: '/answers/t0002-r1.png',
                ink: '/answers/t0002-r1.json' }],
      history: 0,
    }) });
    await sleep(60);
    let filed = {};
    try { filed = JSON.parse(window.localStorage.getItem(KEY) || '{}'); } catch (e) {}
    const pageOfQ = (q) => (filed[q + '#0'] || {}).p;
    pageOfQ('0001') === 2 && pageOfQ('0005') === 4
      ? ok('two boards holding each other\'s working are put back where the '
           + 'record says each answer was written')
      : fail('the swap stood: 0001 is on page ' + pageOfQ('0001')
             + ' and 0005 on page ' + pageOfQ('0005')
             + ' -- each still showing the other one\'s writing');
  }
  window.close();
}

  console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                            : '\nthe saved sitting is adopted, and nothing blank refuses it');
  process.exit(errors.length ? 1 : 0);
})();
