// An unreachable board must not look like an empty one.
//
// This is here because it cost a real sitting. A compute node's allocation had
// ended, so the board process was gone; the installed app served its cached
// shell, the payload never arrived, and the page said "Nothing on the board
// yet." The owner read that as "the tutor has not written anything" and waited.
// The only signal to the contrary was a red dot the size of a full stop.
//
// So: no payload plus a dead stream must say so where the lesson would be, and
// a lesson already on screen when the link drops must stop claiming to be
// current. jsdom because a stub DOM proves nothing about what is painted.

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

window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, { get: () => () => {}, set: () => true });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 900 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 500 });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 900, height: 500, right: 900, bottom: 500, x: 0, y: 0 };
};
window.Element.prototype.scrollIntoView = function () {};
window.fetch = () => new Promise(() => {});
window.renderMathInElement = () => {};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};
window.addEventListener('error', (e) => fail('uncaught: ' + e.message));

// Hand the stream back to the test, so a dropped link can actually be staged.
window.EventSource = function () {
  window.__es = this;
  this.readyState = 0;
  this.close = function () {};
  this.addEventListener = function () {};
};

for (const f of ['typeface.js', 'macros.js', 'slate-core.js']) {
  try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
  catch (e) { fail(f + ': ' + e.message); }
}
try {
  window.eval(fs.readFileSync(path.join(WEB, 'board.js'), 'utf8'));
  ok('loaded board.js');
} catch (e) { fail('board.js: ' + e.message); }

const doc = window.document;
const empty = doc.getElementById('empty');
const offline = doc.getElementById('offline');
const linkbad = doc.getElementById('linkbad');
const dot = doc.getElementById('dot');
const es = window.__es;

if (!offline) fail('the board has no offline state at all');
if (!linkbad) fail('the board has no stale-link banner at all');
if (!es) fail('board.js never opened a stream');

// The CSS guard, again. Every element toggled with `hidden` needs it, because a
// UA stylesheet's [hidden] rule loses to any author rule that sets a display --
// and .offline sets one through .empty.
const css = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
if (/\[hidden\]\s*{\s*display:\s*none\s*!important/.test(css)) ok('[hidden] is still guarded');
else fail('board.css lost its [hidden] !important guard');

if (es) {
  // 1. Before anything arrives, the page is honest about waiting, not broken.
  if (!empty.hidden && offline.hidden) ok('waiting: the empty state shows, the fault does not');
  else fail('a fresh board should show the empty state and no fault');

  // 2. The stream dies before any payload: this is the case that misled a person.
  es.onerror();
  if (!offline.hidden) ok('dead stream, no payload: the fault is stated on the board');
  else fail('a dead stream with no payload leaves the board silent');
  if (empty.hidden) ok('dead stream, no payload: "nothing yet" is withdrawn');
  else fail('the board still claims the tutor has written nothing — the original defect');
  if (/dead/.test(dot.className)) ok('the connection dot is dead');
  else fail('the dot did not go dead');
  if (dot.title && dot.title !== 'connection') ok('the dot says what it means: ' + dot.title);
  else fail('the dot has no useful title while disconnected');
  if (linkbad.hidden) ok('no stale-lesson banner: there is no lesson to be stale');
  else fail('the stale-lesson banner showed with no lesson on screen');

  // 3. It comes back. The fault must clear, and the empty state return.
  es.onopen();
  if (offline.hidden) ok('reconnected: the fault clears');
  else fail('the fault stayed up after the stream reopened');

  // 4. A payload arrives, then the link drops. The lesson stays, but stops
  //    claiming to be current.
  es.onmessage({ data: JSON.stringify({
    state: { course: 'Galois Theory', session: 'lecture', mode: 'math' },
    cards: [{ n: 1, slug: 'first', kind: 'lesson', title: 'A first card',
              html: '<p>text</p>', mtime: Date.now() / 1000 }],
    turns: [], messages: [], uploads: [], slate: [], push: null, agent: null,
  }) });
  const painted = doc.getElementById('cards').textContent;
  if (/A first card/.test(painted)) ok('a card renders');
  else fail('the card never rendered, so the rest of this proves nothing');

  es.onerror();
  if (!linkbad.hidden) ok('link lost with a lesson up: the board says it may be out of date');
  else fail('the lesson silently went stale');
  if (offline.hidden) ok('the full-page fault does not replace a lesson already read');
  else fail('a dropped link threw away a lesson the student was reading');
  if (/A first card/.test(doc.getElementById('cards').textContent)) ok('the lesson survives the drop');
  else fail('the lesson was cleared by a dropped link');
}

if (errors.length) {
  console.log('\n' + errors.length + ' failure(s)');
  process.exit(1);
}
console.log('\nlink       an unreachable board says so');
