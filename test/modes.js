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
    addEventListener() {}, appendChild() {}, removeChild() {},
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

function paint(mode, cards, messages) {
  render({ state: { course: 'X', mode }, cards: cards || [], messages: messages || [],
           uploads: [], slate: [] });
  return { composer: registry.composer.hidden, answer: registry.writer.hidden };
}

const question = [{ id: '0001', kind: 'question', title: 'Which subfield?', body: 'q', mtime: now }];

let r = paint('math', question, []);
check('math: no text box, ever', r.composer === true);
check('math: the slate is offered while an answer is owed', r.answer === false);

r = paint('math', question, [{ t: now + 10, text: 'answered' }]);
check('math: the offer goes once something has been sent', r.answer === true);

r = paint('math', [{ id: '0001', kind: 'lesson', body: 'x', mtime: now }], []);
check('math: no offer when nothing was asked', r.answer === true);

r = paint('code', question, []);
check('code: the text box is present', r.composer === false);
check('code: the slate button stays out of the way', r.answer === true);

r = paint('code', [], []);
check('code: the box is there before anything is asked', r.composer === false);

r = paint(undefined, question, []);
check('missing mode falls back to maths, the stricter one', r.composer === true);

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall mode checks passed');
process.exit(fails ? 1 : 0);
