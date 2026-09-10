// A lesson stays where the reader left it.
//
// Reported from the iPad, about the app updating itself:
//
//   "this hasn't happened for a bit, BUT I noticed that there are a few times
//    when after I sent a response, the whole screen went white, and then the
//    page reloaded with the tutor response and all prior responses collapsed
//    (though reachable) and all prior boards only yielding the frozen canvas of
//    my work."
//
// Every part of that is one `location.reload()`, fired the instant a new service
// worker claimed the page. The reload was deliberate -- swiping out of an
// installed iOS app and back in RESUMES it, so without one a fixed bug stays on
// screen until the app is force-quit -- and the moment it chose was not. An
// update is asked for on every return to the foreground, and sending a response
// is exactly when an app comes back to the foreground.
//
// A reload is cheap for the code and expensive for the person: the scroll
// position goes, every card folds back to how it renders on a first visit, the
// live surface is replaced by the picture of the last thing sent, and there is a
// white flash in the middle of a proof. So a new worker is news, not an event.
//
// jsdom, because the whole assertion is about what survives on the glass.

const fs = require('fs');
const path = require('path');

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.log('skip  jsdom is not installed — `npm install jsdom` to run this test');
  process.exit(0);
}

const WEB = path.join(__dirname, '..', 'web');
const errors = [];
const ok = (m) => console.log('ok   ' + m);
const fail = (m) => { errors.push(m); console.log('FAIL ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// `location.reload` cannot be replaced in jsdom -- the property is not
// configurable -- so reloads are counted where jsdom itself reports them: it
// refuses to navigate and says so on the virtual console. That is the reload.
let reloads = 0;
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (/navigation/i.test(e.message)) reloads++; });

const dom = new JSDOM(fs.readFileSync(path.join(WEB, 'board.html'), 'utf8'), {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://board.test/board',
  virtualConsole: vc,
});
const { window } = dom;
const doc = window.document;

window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, { get: () => () => {}, set: () => true });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 800 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 600 });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 800, height: 40, right: 800, bottom: 40, x: 0, y: 0 };
};
window.Element.prototype.scrollIntoView = function () {};
window.Element.prototype.setPointerCapture = function () {};
window.Element.prototype.releasePointerCapture = function () {};
window.fetch = (u) => (/slate\/state/.test(String(u))
  ? Promise.resolve({ json: () => Promise.resolve({ pages: [] }) })
  : new Promise(() => {}));
window.EventSource = function () { return { close() {}, readyState: 1, addEventListener() {} }; };
window.renderMathInElement = () => {};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};
window.addEventListener('error', (e) => fail('uncaught: ' + e.message));

// The page is told whether it is being looked at, on demand: that is the whole
// question this file is about.
let hidden = false;
Object.defineProperty(doc, 'hidden', { get: () => hidden, configurable: true });
Object.defineProperty(doc, 'visibilityState',
                      { get: () => (hidden ? 'hidden' : 'visible'), configurable: true });
const goHidden = async (v) => {
  hidden = v;
  doc.dispatchEvent(new window.Event('visibilitychange'));
  await sleep(20);
};

// A service worker registration that can be made to hand the page over on
// demand, which is the event the whole complaint hangs on.
const sw = new window.EventTarget();
sw.controller = { scriptURL: 'https://board.test/sw.js' };   // one is already in charge
sw.register = () => Promise.resolve({ update() {} });
Object.defineProperty(window.navigator, 'serviceWorker', { value: sw, configurable: true });
Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

for (const f of ['typeface.js', 'macros.js', 'slate-core.js', 'annotate.js']) {
  try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
  catch (e) { fail(f + ': ' + e.message); }
}
try {
  let src = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
  src = src.replace('})();', 'window.__render = render;\nwindow.__writer = function () { return writer; };\n})();');
  window.eval(src);
  ok('loaded the board');
} catch (e) { fail('board.js: ' + e.message); }

window.dispatchEvent(new window.Event('load'));

const strip = () => doc.getElementById('newver');
const handOver = async () => {
  sw.dispatchEvent(new window.Event('controllerchange'));
  await sleep(20);
};

(async function () {
  const now = Date.now() / 1000;
  window.__render({
    state: { course: 'Galois-Theory', mode: 'math' },
    cards: [{ id: '0001', kind: 'question', title: 'Two candidates in Z[x]',
              body: 'Which of these generate a proper ideal?', mtime: now }],
    turns: [], messages: [], uploads: [], slate: [],
  });
  await sleep(40);

  strip() && strip().hidden
    ? ok('nothing says anything about a new version until there is one')
    : fail('the update strip is showing before any update has arrived');

  // ---------------------------------------------------- reading, mid-lesson
  await handOver();
  reloads === 0
    ? ok('a new version arriving while the lesson is on screen does NOT reload it')
    : fail('the page reloaded out from under the reader — this is the white '
           + 'screen that was reported');
  strip() && !strip().hidden
    ? ok('and says so instead, where it can be taken when it suits')
    : fail('the update is neither taken nor mentioned, so the fix is invisible '
           + 'until the app is force-quit');

  // Asked for, it happens at once. The point is that it is a decision.
  doc.getElementById('newver-now').onclick();
  await sleep(20);
  reloads === 1
    ? ok('and loads at once when it is actually asked for')
    : fail('the button that says "load it now" did not reload (' + reloads + ')');
})().then(async () => {
  // -------------------------------------------- and the moment it is put down
  //
  // A second page, because the first one has already reloaded and a reload is a
  // one-way door: `reloading` latches, on purpose, so a worker that hands over
  // twice does not reload twice.
  let reloads2 = 0;
  const vc2 = new VirtualConsole();
  vc2.on('jsdomError', (e) => { if (/navigation/i.test(e.message)) reloads2++; });
  const two = new JSDOM(fs.readFileSync(path.join(WEB, 'board.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://board.test/board',
    virtualConsole: vc2,
  });
  const w2 = two.window, d2 = w2.document;
  w2.HTMLCanvasElement.prototype.getContext = () =>
    new Proxy({}, { get: () => () => {}, set: () => true });
  w2.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  Object.defineProperty(w2.HTMLElement.prototype, 'clientWidth', { get: () => 800 });
  Object.defineProperty(w2.HTMLElement.prototype, 'clientHeight', { get: () => 600 });
  w2.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 800, height: 40, right: 800, bottom: 40, x: 0, y: 0 };
  };
  w2.Element.prototype.scrollIntoView = function () {};
  w2.Element.prototype.setPointerCapture = function () {};
  w2.Element.prototype.releasePointerCapture = function () {};
  w2.fetch = (u) => (/slate\/state/.test(String(u))
    ? Promise.resolve({ json: () => Promise.resolve({ pages: [] }) })
    : new Promise(() => {}));
  w2.EventSource = function () { return { close() {}, readyState: 1, addEventListener() {} }; };
  w2.renderMathInElement = () => {};
  w2.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  w2.scrollTo = () => {};

  let hidden2 = false;
  Object.defineProperty(d2, 'hidden', { get: () => hidden2, configurable: true });
  const sw2 = new w2.EventTarget();
  sw2.controller = { scriptURL: 'https://board.test/sw.js' };
  sw2.register = () => Promise.resolve({ update() {} });
  Object.defineProperty(w2.navigator, 'serviceWorker', { value: sw2, configurable: true });
  Object.defineProperty(w2, 'isSecureContext', { value: true, configurable: true });
  for (const f of ['typeface.js', 'macros.js', 'slate-core.js', 'annotate.js']) {
    w2.eval(fs.readFileSync(path.join(WEB, f), 'utf8'));
  }
  let src2 = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
  src2 = src2.replace('})();', 'window.__writer = function () { return writer; };\n})();');
  w2.eval(src2);
  w2.dispatchEvent(new w2.Event('load'));
  await sleep(30);

  // The update arrives while the lesson is being read: nothing happens.
  sw2.dispatchEvent(new w2.Event('controllerchange'));
  await sleep(20);
  reloads2 === 0 ? ok('a second board agrees: not while it is being read')
                 : fail('the second board reloaded while visible');

  // The app is put down. NOW it is free, and the person comes back to the new
  // code rather than to a page that reloads in front of them.
  hidden2 = true;
  d2.dispatchEvent(new w2.Event('visibilitychange'));
  await sleep(20);
  reloads2 === 1
    ? ok('and takes it the moment the app is put down, where it costs nothing')
    : fail('a waiting update is never taken, so the board can stay on old code '
           + 'for ever (' + reloads2 + ' reloads)');

  // ------------------------------------------------ and never over live ink
  //
  // The surface owning unsaved strokes outranks everything above: a reload with
  // ink the disk has not been told about is a page of handwriting gone.
  const js = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
  /function inkOwed\(\)[\s\S]{0,200}writer\.owed\(\)/.test(js)
    ? ok('and asks the writing surface what it still owes before either route')
    : fail('nothing consults the surface, so a reload can land on unsaved ink');
  /function takeUpdate\(\)[\s\S]{0,160}if \(inkOwed\(\)\) return;/.test(js)
    ? ok('with the ink checked on the way through, not merely nearby')
    : fail('the ink check is not on the path that reloads');

  const slate = fs.readFileSync(path.join(WEB, 'slate.js'), 'utf8');
  /writer\.owed\(\)/.test(slate) && /if \(document\.hidden\) take\(\);/.test(slate)
    ? ok('and the full-screen slate keeps the same rule, where the stakes are ink')
    : fail('the full-screen writing surface still reloads itself unasked');

  console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                            : '\na lesson stays where the reader left it');
  window.close();
  two.window.close();
  process.exit(errors.length ? 1 : 0);
});
