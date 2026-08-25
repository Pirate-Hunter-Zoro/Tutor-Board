// Each page's script must run to completion against its own markup.
//
// This exists because removing the composer from the board left one orphaned
// `autosize()` call behind, and a `getElementById` for an element that no longer
// existed would have done the same. Either one throws at load and takes the
// whole page with it -- a blank screen, with the cause only visible in a console
// nobody has open on an iPad.
//
// The DOM here is deliberately strict: getElementById returns a stub only for an
// id that genuinely appears in that page's HTML, and null otherwise. So a script
// reaching for an element the markup dropped fails here rather than in your hand.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web');
const PAGES = [
  ['home.html', ['home.js']],
  ['board.html', ['macros.js', 'slate-core.js', 'board.js']],
  ['slate.html', ['slate-core.js', 'slate.js']],
];

let fails = 0;

function idsIn(html) {
  const ids = new Set();
  const re = /\bid="([\w-]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return ids;
}

function makeStub(tag) {
  const el = {
    tagName: tag || 'div',
    style: { setProperty() {}, removeProperty() {} },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    hidden: false, disabled: false, value: '', textContent: '', innerHTML: '',
    files: [], children: [], length: 0,
    clientWidth: 900, clientHeight: 600, scrollHeight: 600, width: 900, height: 600,
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    setPointerCapture() {}, focus() {}, blur() {}, click() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
    querySelector: () => makeStub(),
    querySelectorAll: () => [],
    getContext: () => ctx2d(),
    setPointerCapture() {}, releasePointerCapture() {},
    remove() {}, insertBefore() {}, contains: () => false,
    toDataURL: () => 'data:image/png;base64,',
  };
  return el;
}

function ctx2d() {
  const noop = () => {};
  return new Proxy({}, {
    get(_, k) {
      if (k === 'canvas') return makeStub('canvas');
      if (k === 'measureText') return () => ({ width: 10 });
      return noop;
    },
    set() { return true; },
  });
}

for (const [htmlName, scripts] of PAGES) {
  const html = fs.readFileSync(path.join(WEB, htmlName), 'utf8');
  const ids = idsIn(html);
  const missing = [];

  const doc = {
    getElementById(id) {
      if (!ids.has(id)) { missing.push(id); return null; }
      return makeStub();
    },
    createElement: (t) => makeStub(t),
    createDocumentFragment: () => makeStub(),
    querySelector: () => makeStub(),
    querySelectorAll: () => [],
    addEventListener() {},
    body: makeStub('body'),
    documentElement: makeStub('html'),
    title: '', hidden: false,
  };

  const sandbox = {
    document: doc,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    EventSource: function () { return { close() {}, readyState: 1, addEventListener() {} }; },
    fetch: () => new Promise(() => {}),          // never settles; no async surprises
    FormData: function () { this.append = () => {}; },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '18px' }),
    navigator: { serviceWorker: undefined },
    isSecureContext: false,
    devicePixelRatio: 2,
    innerHeight: 800, innerWidth: 1200, scrollY: 0,
    scrollTo() {}, addEventListener() {}, removeEventListener() {}, print() {},
    location: { href: '/', reload() {}, protocol: 'https:' },
    alert() {}, Image: function () { return makeStub('img'); },
    renderMathInElement: () => {},
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
  ResizeObserver: function () { return { observe() {}, disconnect() {} }; },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  let threw = null;
  for (const s of scripts) {
    try {
      vm.runInContext(fs.readFileSync(path.join(WEB, s), 'utf8'), sandbox, { filename: s });
    } catch (e) {
      threw = s + ': ' + e.message;
      break;
    }
  }

  if (threw) { fails++; console.log('FAIL ' + htmlName + ' — ' + threw); }
  else if (missing.length) {
    fails++;
    console.log('FAIL ' + htmlName + ' — script wants elements the markup does not have: '
                + [...new Set(missing)].join(', '));
  } else {
    console.log('ok   ' + htmlName + ' + ' + scripts.join(', ') + ' loads clean');
  }
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall pages load without throwing');
process.exit(fails ? 1 : 0);
