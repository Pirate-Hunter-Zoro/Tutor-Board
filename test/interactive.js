// Drive the real board in a real DOM and make it accept a pen stroke.
//
// This exists because the hand-rolled stubs in the other tests are too
// forgiving. They happily reported that everything loaded while the writing
// surface was, on an actual iPad, impossible to write on -- twice. Both causes
// were invisible to a stub that returns a plausible object for everything:
//
//   1. the panel was collapsed, so its canvas was sized 0x0 and touches fell
//      through to the lesson behind it;
//   2. the component created no page until /slate/state resolved, so on a slow
//      link every stroke threw on its way out, silently.
//
// A real DOM catches both, because a canvas that was never sized reports the
// browser default of 300x150 and a stroke that throws never lands.
//
// jsdom is a development-only dependency and is not required to run the board.
// Without it this test skips rather than fails:  npm install jsdom

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

// jsdom has no canvas backend and no layout engine; supply just enough of both
// that the code under test takes its real paths.
window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, { get: () => () => {}, set: () => true });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 900 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 500 });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 900, height: 500, right: 900, bottom: 500, x: 0, y: 0 };
};
window.Element.prototype.scrollIntoView = function () {};
window.fetch = () => new Promise(() => {});      // deliberately never resolves
window.EventSource = function () { return { close() {}, readyState: 1, addEventListener() {} }; };
window.renderMathInElement = () => {};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};
window.addEventListener('error', (e) => fail('uncaught: ' + e.message));

for (const f of ['typeface.js', 'macros.js', 'slate-core.js']) {
  try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); ok('loaded ' + f); }
  catch (e) { fail(f + ': ' + e.message); }
}
try {
  let src = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
  src = src.replace('})();', 'window.__render = render;\n})();');
  window.eval(src);
  ok('loaded board.js');
} catch (e) { fail('board.js: ' + e.message); }

const now = Date.now() / 1000;
try {
  window.__render({
    state: { course: 'X', mode: 'math' },
    cards: [{ id: '0001', kind: 'question', title: 'Q', body: 'hi', mtime: now }],
    messages: [], uploads: [], slate: [],
  });
  ok('rendered a question');
} catch (e) { fail('render: ' + e.message); }

setTimeout(() => setTimeout(() => {
  const doc = window.document;
  const writer = doc.getElementById('writer');
  const chrome = doc.getElementById('drawbar');
  const canvas = doc.querySelector('#slate canvas');

  writer && !writer.hidden ? ok('the answer block is shown') : fail('no answer block');
  chrome && !chrome.hidden ? ok('the tools are in the page chrome') : fail('tools are not in the chrome');
  chrome && chrome.querySelector('.sl-send') ? ok('Send is in the chrome') : fail('no Send control');

  const labels = [...(chrome ? chrome.querySelectorAll('.sl-seg button') : [])]
    .map((b) => b.textContent.trim()).filter(Boolean);
  ['Pen', 'Marker', 'Erase', 'Select'].every((w) => labels.includes(w))
    ? ok('every tool is named: ' + labels.slice(0, 4).join(', '))
    : fail('tools are unlabelled: ' + labels.join(', '));

  const q = doc.querySelector('.card[data-kind="question"]');
  q && q.nextElementSibling === writer
    ? ok('the block sits in the lesson, under its question')
    : fail('the block is not in the card flow beneath the question');

  if (!canvas) { fail('no canvas'); return done(); }
  canvas.width > 300 && canvas.height > 150
    ? ok('the canvas was sized to its box (' + canvas.width + 'x' + canvas.height + ')')
    : fail('canvas is the unsized browser default — nothing can be drawn on it');

  // Write on it, with the network still hanging.
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  const pen = (type, x, y) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { pointerId: 1, pointerType: 'pen', pressure: 0.6,
                        clientX: x, clientY: y, isPrimary: true });
    ev.getCoalescedEvents = () => [ev];
    canvas.dispatchEvent(ev);
  };
  const before = window.__writerDebug ? window.__writerDebug().strokes : -1;
  pen('pointerdown', 100, 100);
  for (let i = 0; i < 40; i++) pen('pointermove', 100 + i * 4, 100 + Math.sin(i / 4) * 20);
  pen('pointerup', 260, 100);
  const after = window.__writerDebug ? window.__writerDebug().strokes : -1;
  after > before
    ? ok('a pen stroke lands, with the network still unanswered')
    : fail('a pen stroke produced nothing (' + before + ' -> ' + after + ')');

  // Send must be in a column that cannot be squeezed away, not merely present.
  const bar = chrome.querySelector('.sl-bar');
  const acts = chrome.querySelector('.sl-acts');
  bar && acts && acts.querySelector('.sl-send')
    ? ok('Send sits in the fixed column, not in the scrolling tools')
    : fail('Send is in the scrolling area and can be pushed off screen');
  chrome.querySelector('.sl-tools') && chrome.querySelector('.sl-tools').contains(
    chrome.querySelector('.sl-more'))
    ? ok('the tools scroll inside their own column')
    : fail('the tools are not confined to their column');

  done();
}, 60), 60);

function done() {
  console.log(errors.length ? '\n' + errors.length + ' FAILURES' : '\nthe board accepts writing');
  window.close();
  process.exit(errors.length ? 1 : 0);
}
