// A repository declares whether it is a mathematics course or a code course,
// and the board has to obey it. In maths there is no text box at all -- the only
// way to answer is to write on the slate. In code a sentence is usually the
// right unit, so the box is there.
//
// The markup ships both controls hidden and the script decides, so nothing about
// this is visible in the HTML. It has to be exercised.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(WEB, 'board.html'), 'utf8');

const ids = new Set();
{
  const re = /\bid="([\w-]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
}

function stub(tag) {
  const el = {
    tagName: tag || 'div', dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    hidden: false, disabled: false, value: '', textContent: '', innerHTML: '',
    children: [], files: [], scrollHeight: 20,
    addEventListener() {}, appendChild() {}, removeChild() {}, after() {},
    setPointerCapture() {}, releasePointerCapture() {}, remove() {}, type: '',
    querySelector: () => stub(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
  };
  return el;
}

const registry = {};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  document: {
    getElementById(id) {
      if (!ids.has(id)) return null;
      return (registry[id] = registry[id] || stub());
    },
    createElement: (t) => stub(t),
    createDocumentFragment: () => stub(),
    querySelector: () => stub(), querySelectorAll: () => [],
    addEventListener() {},
    body: stub('body'), documentElement: stub('html'),
    title: '', hidden: false,
  },
  localStorage: { getItem: () => null, setItem() {} },
  EventSource: function () { return { close() {}, readyState: 1 }; },
  fetch: () => new Promise(() => {}),
  FormData: function () { this.append = () => {}; },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '18px' }),
  navigator: { serviceWorker: undefined },
  isSecureContext: false,
  innerHeight: 800, scrollY: 0, devicePixelRatio: 2,
  scrollTo() {}, addEventListener() {}, print() {},
  location: { reload() {}, protocol: 'https:' },
  renderMathInElement: () => {},
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  ResizeObserver: function () { return { observe() {}, disconnect() {} }; },
  devicePixelRatio: 2,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let src = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
src = src.replace('})();', 'window.__render = render;\n})();');
vm.runInContext(fs.readFileSync(path.join(WEB, 'macros.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(WEB, 'slate-core.js'), 'utf8'), sandbox);
vm.runInContext(src, sandbox, { filename: 'board.js' });

const render = sandbox.window.__render;
const now = Date.now() / 1000;

let fails = 0;
function check(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fails++; console.log('FAIL ' + name); }
}

// A student turn, not a raw message: the transcript is what the board renders
// now, and "something has been sent" means a turn exists.
function paint(mode, cards, turns) {
  render({ state: { course: 'X', mode }, cards: cards || [], turns: turns || [],
           messages: [], uploads: [], slate: [] });
  return { composer: registry.composer.hidden, answer: registry.writer.hidden,
           empty: registry.empty.hidden };
}

const question = [{ id: '0001', kind: 'question', title: 'Which subfield?', body: 'q', mtime: now }];

let r = paint('math', question, []);
check('math: no text box, ever', r.composer === true);
check('math: the slate is offered while an answer is owed', r.answer === false);

// Sending is a checkpoint, not an exit. The tutor's next move is usually to
// point at a mistake in what was just sent, so the panel and the ink have to
// still be there to correct. It used to close on send, which made a correction
// impossible without leaving the lesson.
r = paint('math', question, [{ id: 't0001', rev: 1, kind: 'ink', answers: '0001',
                               t: now + 10, t0: now + 10 }]);
check('math: the answer block survives a send, so it can be corrected', r.answer === false);

// A different question is the thing that closes it.
const question2 = [{ id: '0002', kind: 'question', title: 'And now?', body: 'q', mtime: now + 20 }];
r = paint('math', question2, [{ id: 't0001', rev: 1, kind: 'ink', answers: '0001',
                                t: now + 30, t0: now + 30 }]);
check('math: a new question closes the block for the old one', r.answer === true);

r = paint('math', [{ id: '0001', kind: 'lesson', body: 'x', mtime: now }], []);
check('math: no offer when nothing was asked', r.answer === true);

r = paint('code', question, []);
check('code: the text box is present', r.composer === false);
check('code: the slate button stays out of the way', r.answer === true);

r = paint('code', [], []);
check('code: the box is there before anything is asked', r.composer === false);

r = paint(undefined, question, []);
check('missing mode falls back to maths, the stricter one', r.composer === true);

// A prompt that cannot be declined is a prompt that gets answered badly to make
// it go away. Skipping is a turn like any other -- it is in the transcript and it
// wakes the tutor -- but unlike a sent answer it closes the block, because the
// whole point of skipping is that the prompt goes.
r = paint('math', question, [{ id: 't0009', rev: 1, kind: 'text', signal: 'skip',
                               answers: '0001', t: now + 10, t0: now + 10 }]);
check('math: skipping closes the answer block', r.answer === true);
check('math: and does not conjure a text box', r.composer === true);

// A skip belongs to the question it declined. The next question is a fresh ask.
r = paint('math', question.concat([{ id: '0002', kind: 'question', title: 'Next',
                                     body: 'q', mtime: now + 20 }]),
          [{ id: 't0009', rev: 1, kind: 'text', signal: 'skip', answers: '0001',
             t: now + 10, t0: now + 10 }]);
check('math: a later question is still asked after a skip', r.answer === false);

// The cold start. A maths board with no cards offers no question, so no answer is
// owed, so the slate never opens -- and there is no text box either. Without a
// way to say the first thing, the first turn of every session has to come from a
// terminal, and the board's whole promise is that it does not.
r = paint('math', [], []);
check('math: an empty board still says it is empty', r.empty === false);
check('math: and still has no text box', r.composer === true);
check('math: the cold start is a button, not a composer',
      ids.has('begin') && /id="begin"[\s\S]*?<\/button>/.test(html));
check('math: the begin button lives in the empty state, so a card retires it',
      /<div id="empty"[\s\S]*?id="begin"[\s\S]*?<\/div>/.test(html));

// One card is enough to retire it: the empty state goes, and the button with it.
r = paint('math', [{ id: '0001', kind: 'lesson', body: 'x', mtime: now }], []);
check('math: a card retires the empty state', r.empty === true);

// So does the ask itself, so the tutor is not woken four times.
r = paint('math', [], [{ id: 't0001', rev: 1, kind: 'text', signal: 'begin',
                         t: now, t0: now }]);
check('math: having asked, the board is no longer empty', r.empty === true);

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall mode checks passed');
process.exit(fails ? 1 : 0);
