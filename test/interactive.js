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

// A payload arrives for reasons that have nothing to do with the lesson: the
// tutor's heartbeat lands every thirty seconds while it writes, the uncommitted
// count changes, a figure finishes compiling. The reconcile used to answer every
// one of them by detaching the whole lesson into a fragment and re-appending it,
// which restarts CSS animations -- and every card carried an entry animation, so
// the board visibly slid up and faded back in while nothing on screen had
// changed. From a chair it reads as the board glitching and snapping back.
try {
  const doc0 = window.document;
  const host = doc0.getElementById('cards');
  const before = host.querySelector('.card');
  if (!before) throw new Error('no card was rendered');
  const identity = {};
  before.__identity = identity;
  before.querySelector('.body').setAttribute('data-not-rebuilt', 'yes');

  let moved = 0;
  // A keyed node, or a fragment carrying keyed nodes -- the old path moved the
  // whole lesson inside a fragment, and counting only bare nodes misses it
  // entirely, which is exactly the shape of a test that proves nothing.
  const keyed = (n) => {
    if (n.dataset && n.dataset.key) return 1;
    if (n.childNodes) {
      return Array.prototype.filter.call(
        n.childNodes, (c) => c.dataset && c.dataset.key).length;
    }
    return 0;
  };
  const realInsert = host.insertBefore.bind(host);
  const realAppend = host.appendChild.bind(host);
  host.insertBefore = function (n, r) { moved += keyed(n); return realInsert(n, r); };
  host.appendChild = function (n) { moved += keyed(n); return realAppend(n); };

  // Same lesson, different heartbeat. This is the common case, not a corner.
  window.__render({
    state: { course: 'X', mode: 'math' },
    cards: [{ id: '0001', kind: 'question', title: 'Q', body: 'hi', mtime: now }],
    messages: [], uploads: [], slate: [],
    agent: { agent: 'claude', state: 'working', pid: 1, host: 'h', last_seen: now + 30 },
  });

  host.insertBefore = realInsert;
  host.appendChild = realAppend;

  const after = host.querySelector('.card');
  moved === 0
    ? ok('an unchanged lesson is not moved when a payload arrives')
    : fail('the lesson was re-inserted ' + moved + ' time(s) for a payload that '
           + 'changed nothing in it — every card replays its entry animation');
  after && after.__identity === identity
    ? ok('and the card keeps the very node it had')
    : fail('the card node was replaced, losing its ink layer and scroll position');
  after && after.querySelector('.body').getAttribute('data-not-rebuilt') === 'yes'
    ? ok('and its body was not re-rendered from markdown')
    : fail('the card body was rebuilt, so every payload re-parses the whole lesson');
  after && !after.classList.contains('fresh')
    ? ok('and it is not marked fresh, so nothing animates')
    : fail('an old card came back marked fresh');
} catch (e) { fail('reconcile: ' + e.message); }

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

  // Undo and redo were in the scrolling row, off the right-hand edge of a
  // narrow screen, with the scrollbar hidden so nothing said they were there.
  // They are the two controls a person writing by hand reaches for most.
  const undo = acts && acts.querySelector('button[title="undo"]');
  const redo = acts && acts.querySelector('button[title="redo"]');
  undo && redo
    ? ok('undo and redo are in the fixed column, never scrolled off')
    : fail('undo/redo are not reachable in the pinned column');

  // A re-render must not throw away a zoom the writer set. The board renders on
  // every server event, and relayout used to refit the page each time.
  const dbg = window.__writerDebug;
  if (dbg) {
    const zoomIn = chrome.querySelector('.sl-menu button[title="in"]')
                || doc.querySelector('.sl-menu button[title="in"]');
    if (zoomIn) {
      zoomIn.click();
      const zoomed = dbg().k;
      window.__render({
        state: { course: 'X', mode: 'math' },
        cards: [{ id: '0001', kind: 'question', title: 'Q', body: 'hi', mtime: now }],
        messages: [], uploads: [], slate: [],
      });
      setTimeout(() => {
        Math.abs(dbg().k - zoomed) < 1e-6
          ? ok('a zoom survives a re-render (' + zoomed.toFixed(3) + ')')
          : fail('the zoom was reset by a render: ' + zoomed + ' -> ' + dbg().k);
        viewerChecks();
      }, 40);
      return;
    }
  }
  viewerChecks();

  function viewerChecks() {
    // What the student wrote belongs in the lesson, under the question it
    // answers -- not in a drawer of unlabelled thumbnails at the bottom of the
    // screen, which is where it used to go.
    const q1 = { id: '0001', kind: 'question', title: 'Q', body: 'hi', mtime: now };
    const ink1 = { id: 't0001', rev: 1, kind: 'ink', answers: '0001',
                   t: now + 5, t0: now + 5, png: '/answers/t0001-r1.png',
                   ink: '/answers/t0001-r1.json', strokes: 12 };
    // While it is still waiting to be read, the answer is deliberately NOT in the
    // flow: the ink is on the writing surface immediately below, and a frozen
    // copy of it above that surface is the same thing twice.
    window.__render({
      state: { course: 'X', mode: 'math' },
      cards: [q1], messages: [], uploads: [], slate: [], turns: [ink1],
    });
    doc.querySelector('.mine[data-turn="t0001"]')
      ? fail('a just-sent answer is duplicated above the surface it is still on')
      : ok('a just-sent answer is not repeated above the writing surface');

    // The tutor replies. Now it is what was handed in, and it belongs in place.
    window.__render({
      state: { course: 'X', mode: 'math' },
      cards: [q1, { id: '0002', kind: 'wrong', title: 'Not quite', body: 'no',
                    mtime: now + 10 }],
      messages: [], uploads: [], slate: [], turns: [ink1],
    });
    const mine = doc.querySelector('.mine[data-turn="t0001"]');
    mine ? ok('an answer appears in the lesson, not in a drawer')
         : fail('the answer is not in the card flow');
    const q = doc.querySelector('.card[data-kind="question"]');
    mine && q && q.nextElementSibling && q.nextElementSibling.dataset.turn === 't0001'
      ? ok('the answer sits directly under its question')
      : fail('the answer is not under the question it answers');
    mine && mine.querySelector('.slate-shot img')
      ? ok('the ink that was sent is shown in place')
      : fail('the sent ink is not rendered in the lesson');

    // A revision supersedes in place rather than piling up at the end.
    window.__render({
      state: { course: 'X', mode: 'math' },
      cards: [q1, { id: '0002', kind: 'wrong', title: 'Not quite', body: 'no',
                    mtime: now + 10 }],
      messages: [], uploads: [], slate: [],
      turns: [{ id: 't0001', rev: 2, kind: 'ink', answers: '0001',
                t: now + 90, t0: now + 5, png: '/answers/t0001-r2.png',
                ink: '/answers/t0001-r2.json', strokes: 14 }],
    });
    doc.querySelectorAll('.mine[data-turn="t0001"]').length === 1
      ? ok('a revision replaces the answer instead of adding one')
      : fail('a revision produced a second block');
    /revised/.test(doc.querySelector('.mine .when').textContent)
      ? ok('a revised answer says so')
      : fail('a revision is indistinguishable from the original');

    // Tapping a picture used to open a new browsing context. Installed to the
    // home screen there is no chrome and no back button, so it was a one-way
    // trip out of the app.
    window.__render({
      state: { course: 'X', mode: 'math' },
      cards: [{ id: '0001', kind: 'question', title: 'Q', body: 'hi', mtime: now }],
      messages: [], turns: [], slate: [],
      uploads: [{ url: '/uploads/photo.png', name: 'photo.png', mtime: now }],
    });
    const tileEl = doc.querySelector('#scratch-list a');
    if (!tileEl) { fail('no scratch tile to open'); return done(); }
    tileEl.target === '_blank'
      ? fail('a picture still opens in a context with no way back')
      : ok('a picture does not open in a new context');

    tileEl.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
    const v = doc.getElementById('viewer');
    v && !v.hidden ? ok('the viewer opens in the page') : fail('the viewer did not open');

    const closeBtn = v && v.querySelector('#viewer-close');
    closeBtn ? ok('the viewer has a close button') : fail('the viewer has no way out');
    if (closeBtn) {
      closeBtn.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
      v.hidden ? ok('the close button closes it') : fail('the close button did nothing');
    }
    done();
  }
  return;
}, 60), 60);

function done() {
  console.log(errors.length ? '\n' + errors.length + ' FAILURES' : '\nthe board accepts writing');
  window.close();
  process.exit(errors.length ? 1 : 0);
}
