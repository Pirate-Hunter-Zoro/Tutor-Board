// A fresh page must be exactly the size of the surface showing it, so 100% zoom
// is already the right size to write at on any screen.
//
// The first version used a fixed 1600-unit-wide page scaled to fit, which meant
// everything was small on a small screen and the only remedy was zooming -- and
// zooming a handwriting surface is miserable. A later attempt clamped the page
// width to a range, which reintroduced the same scale factor at both extremes.
// Neither is caught by anything but measuring it.
//
// Needs `npm install jsdom`; skips without it.

const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('skip  jsdom is not installed'); process.exit(0); }

const WEB = path.join(__dirname, '..', 'web');
const SRC = fs.readFileSync(path.join(WEB, 'slate-core.js'), 'utf8');
let fails = 0;

function zoomAt(W, H) {
  const dom = new JSDOM('<!doctype html><div id="bar"></div><div id="slate"></div>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://b.test/' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = () =>
    new Proxy({}, { get: () => () => {}, set: () => true });
  w.HTMLCanvasElement.prototype.toDataURL = () => '';
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get: () => W });
  Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get: () => H });
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
  w.fetch = () => new Promise(() => {});
  w.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  w.eval(SRC);
  const api = w.Slate.create({ root: w.document.getElementById('slate'),
                               bar: w.document.getElementById('bar'), compact: true });
  const k = api.debug().k;
  w.close();
  return k;
}

[[390, 420, 'phone portrait'],
 [820, 500, 'iPad portrait'],
 [1180, 620, 'iPad landscape'],
 [1512, 700, 'laptop'],
 [2560, 900, 'large display'],
 [300, 300, 'very narrow'],
 [1024, 260, 'short and wide']].forEach(function (c) {
  const k = zoomAt(c[0], c[1]);
  const pct = Math.round(k * 100);
  if (pct === 100) console.log('ok   ' + c[2] + ' (' + c[0] + 'x' + c[1] + ') opens at 100%');
  else { fails++; console.log('FAIL ' + c[2] + ' opens at ' + pct + '% — writing would be the wrong size'); }
});

console.log(fails ? '\n' + fails + ' FAILURES' : '\nevery screen writes at natural size');
process.exit(fails ? 1 : 0);
