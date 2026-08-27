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

for (const f of ['typeface.js', 'macros.js', 'slate-core.js', 'annotate.js']) {
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

  // 5. Reachable and attended are two different things, and the connection dot
  //    going green says only the first. Somebody tapped "ask the tutor to begin"
  //    on a live board with nothing attached, saw green, and waited.
  es.onopen();
  var noTutor = doc.getElementById('no-tutor');
  var agentChip = doc.getElementById('agent');
  var live = { state: { course: 'Galois Theory', session: 'lecture', mode: 'math' },
               cards: [], turns: [], messages: [], uploads: [], slate: [],
               push: null, agent: null };
  es.onmessage({ data: JSON.stringify(live) });
  if (!agentChip.hidden && /no tutor/i.test(agentChip.textContent))
    ok('nothing attached: the chrome says so rather than going blank');
  else fail('a board with no tutor attached looks identical to one with a tutor');
  if (!noTutor.hidden) ok('and it is said where somebody about to tap is looking');
  else fail('the empty state invites a tap without saying nobody will read it');

  es.onmessage({ data: JSON.stringify(Object.assign({}, live, {
    agent: { agent: 'claude', state: 'attached', mode: 'interactive' } })) });
  if (noTutor.hidden) ok('and withdrawn the moment one attaches');
  else fail('the warning stayed up with a tutor attached');
  if (/attached/.test(agentChip.textContent)) ok('an interactive tutor reads as attached');
  else fail('an interactive tutor is not reported: ' + agentChip.textContent);

  es.onmessage({ data: JSON.stringify(Object.assign({}, live, {
    agent: { agent: 'claude', state: 'stale', mode: 'interactive' } })) });
  if (!noTutor.hidden) ok('a tutor whose process has gone counts as none');
  else fail('a stale tutor still reads as attended');

  // A turn in progress is the tutor doing its job. This showed on a real iPad as
  // "assistant not responding" plus a red "no tutor attached", five minutes into
  // a turn that was writing a card.
  es.onmessage({ data: JSON.stringify(Object.assign({}, live, {
    agent: { agent: 'claude', state: 'working', turns: 3 } })) });
  if (noTutor.hidden) ok('a tutor mid-turn is not reported as absent');
  else fail('a working tutor is shouted about as missing');
  if (/working/.test(agentChip.textContent)) ok('and the chrome says it is working');
  else fail('a working tutor reads as: ' + agentChip.textContent);

  es.onmessage({ data: JSON.stringify(Object.assign({}, live, {
    cards: [{ n: 1, slug: 'first', kind: 'lesson', title: 'A first card',
              html: '<p>text</p>', mtime: Date.now() / 1000 }],
    agent: { agent: 'claude', state: 'attached', mode: 'interactive' } })) });

  es.onerror();
  if (!linkbad.hidden) ok('link lost with a lesson up: the board says it may be out of date');
  else fail('the lesson silently went stale');
  if (offline.hidden) ok('the full-page fault does not replace a lesson already read');
  else fail('a dropped link threw away a lesson the student was reading');
  if (/A first card/.test(doc.getElementById('cards').textContent)) ok('the lesson survives the drop');
  else fail('the lesson was cleared by a dropped link');
}

// --- the lesson is reconciled, not rebuilt -----------------------------------
// Every payload used to blow the whole lesson away and build it again: every
// card's markdown re-parsed, every formula re-typeset, every figure re-fetched.
// The tutor writes a card every few minutes and the payload arrives on every
// change, so that cost was paid over and over for cards nobody had touched --
// on an iPad, growing with the length of the lesson.
if (es) {
  var cardsHost = doc.getElementById('cards');
  var base = { state: { course: 'G', session: 'lecture', mode: 'math' },
               turns: [], messages: [], uploads: [], slate: [], push: null,
               agent: { agent: 'claude', state: 'listening' } };
  var t0 = Date.now() / 1000;
  var one = { n: 1, id: '0001', slug: 'a', kind: 'lesson', title: 'First',
              body: 'text one', mtime: t0 };
  var two = { n: 2, id: '0002', slug: 'b', kind: 'question', title: 'Second',
              body: 'text two', mtime: t0 + 5 };

  es.onmessage({ data: JSON.stringify(Object.assign({}, base, { cards: [one] })) });
  var firstNode = cardsHost.querySelector('[data-key]');
  if (firstNode) ok('a card renders with an identity of its own');
  else fail('cards are not keyed, so nothing can be reused');

  es.onmessage({ data: JSON.stringify(Object.assign({}, base, { cards: [one] })) });
  if (cardsHost.querySelector('[data-key]') === firstNode)
    ok('an identical payload reuses the very same node');
  else fail('an unchanged card was rebuilt — the whole lesson is re-rendered per frame');

  es.onmessage({ data: JSON.stringify(Object.assign({}, base, { cards: [one, two] })) });
  var nodes = cardsHost.querySelectorAll('[data-key]');
  if (nodes.length === 2) ok('a new card is added');
  else fail('expected two cards, got ' + nodes.length);
  if (nodes[0] === firstNode) ok('and the card already on screen is left alone');
  else fail('adding a card rebuilt the ones before it');

  // Edited in place -- the one case where a rebuild is correct.
  var edited = Object.assign({}, one, { body: 'text one, corrected', mtime: t0 + 90 });
  es.onmessage({ data: JSON.stringify(Object.assign({}, base, { cards: [edited, two] })) });
  var after = cardsHost.querySelectorAll('[data-key]');
  if (after[0] !== firstNode) ok('a card edited in place is rebuilt, as it must be');
  else fail('an edited card kept its stale node');
  if (/corrected/.test(after[0].textContent)) ok('and shows the correction');
  else fail('the correction never reached the page');

  // A card the payload no longer carries goes.
  es.onmessage({ data: JSON.stringify(Object.assign({}, base, { cards: [two] })) });
  if (cardsHost.querySelectorAll('[data-key]').length === 1)
    ok('a card that leaves the payload leaves the page');
  else fail('removed cards linger');
}

// A correction must not move the card it corrects. Cards carry a sequence number
// because they are written in order; sorting them by modification time meant a
// typo fixed in card three landed after everything the student had since
// answered, which is a transcript that no longer records what happened.
if (es) {
  var host2 = doc.getElementById('cards');
  var b2 = { state: { course: 'G', session: 'lecture', mode: 'math' },
             messages: [], uploads: [], slate: [], push: null,
             agent: { agent: 'claude', state: 'listening' } };
  var s0 = Date.now() / 1000;
  var c1 = { id: '0001', slug: 'a', kind: 'question', title: 'One', body: 'q one', mtime: s0 };
  var c2 = { id: '0002', slug: 'b', kind: 'lesson', title: 'Two', body: 'two', mtime: s0 + 10 };
  var mine = { id: 't0001', rev: 1, kind: 'text', answers: '0001', text: 'my answer',
               t: s0 + 5, t0: s0 + 5 };

  es.onmessage({ data: JSON.stringify(Object.assign({}, b2, { cards: [c1, c2], turns: [mine] })) });
  var order = function () {
    return Array.prototype.map.call(host2.querySelectorAll('[data-key]'),
                                    function (n) { return n.dataset.key.split(':').slice(0, 2).join(':'); });
  };
  if (String(order()) === String(['card:0001', 'turn:t0001', 'card:0002']))
    ok('an answer sits under the question it answers');
  else fail('the transcript is out of order: ' + order());

  var fixed = Object.assign({}, c1, { body: 'q one, typo fixed', mtime: s0 + 900 });
  es.onmessage({ data: JSON.stringify(Object.assign({}, b2, { cards: [fixed, c2], turns: [mine] })) });
  if (String(order()) === String(['card:0001', 'turn:t0001', 'card:0002']))
    ok('and correcting a card leaves it exactly where it was');
  else fail('a corrected card jumped down the transcript: ' + order());
}

// --- writing on the lesson itself --------------------------------------------
// The layer must be inert until it is asked for, or it eats every scroll and
// every text selection in the lesson -- which is exactly the shape of the drop
// overlay defect that shipped painted over the board.
if (es) {
  var cardsBox = doc.getElementById('cards');
  var b3 = { state: { course: 'G', session: 'lecture', mode: 'math' },
             turns: [], messages: [], uploads: [], slate: [], push: null,
             agent: { agent: 'claude', state: 'listening' } };
  var k0 = Date.now() / 1000;
  es.onmessage({ data: JSON.stringify(Object.assign({}, b3, {
    cards: [{ id: '0003', slug: 'c', kind: 'lesson', title: 'Marked', body: 'body', mtime: k0 }] })) });

  var card = cardsBox.querySelector('[data-card="0003"]');
  if (card) ok('a card announces which card it is, so ink can be anchored to it');
  else fail('cards carry no id for an annotation to attach to');

  var layer = card && card.querySelector('canvas.ann-layer');
  if (layer) ok('and carries its own ink layer');
  else fail('no ink layer was attached to the card');

  // Inert by default: the CSS, not the script, is what decides this.
  var css3 = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
  if (/canvas\.ann-layer\s*{[^}]*pointer-events:\s*none/.test(css3))
    ok('the layer ignores the pointer until annotate mode is on');
  else fail('the ink layer will swallow scrolling and selection in the lesson');
  if (/body\.annotating\s+canvas\.ann-layer\s*{[^}]*pointer-events:\s*auto/.test(css3))
    ok('and takes it only while annotating');
  else fail('annotate mode never enables the layer');

  // The toggle is a mode, and a mode has to be visible.
  var btn = doc.getElementById('btn-annotate');
  if (btn) ok('there is a control to turn it on');
  else fail('nothing turns annotation on');
  if (btn) {
    btn.onclick();
    if (doc.body.classList.contains('annotating')) ok('and it marks the body, so the mode is visible');
    else fail('annotate mode leaves no trace on the page');
    btn.onclick();
    if (!doc.body.classList.contains('annotating')) ok('and turns off again');
    else fail('annotate mode cannot be left');
  }

  // Marks survive the lesson being re-rendered around them.
  window.Annotate.load({ '0003': [{ c: '#e0b45c', w: 2, p: [0.1, 0.1, 0.5, 0.5] }] });
  if (window.Annotate.marked().indexOf('0003') !== -1) ok('saved marks load back onto their card');
  else fail('marks did not come back from the payload');

  var sameLayer = card.querySelector('canvas.ann-layer');
  es.onmessage({ data: JSON.stringify(Object.assign({}, b3, {
    cards: [{ id: '0003', slug: 'c', kind: 'lesson', title: 'Marked', body: 'body', mtime: k0 }] })) });
  if (cardsBox.querySelector('[data-card="0003"] canvas.ann-layer') === sameLayer)
    ok('and a re-render does not throw the layer away');
  else fail('the ink layer is rebuilt on every frame — marks would flicker or vanish');

  // With marks present and no answer owed, there has to be a way to send them.
  var notesend = doc.getElementById('notesend');
  if (notesend && !notesend.hidden) ok('marks can be sent with no question owed');
  else fail('marks made outside a question are stranded with no way to send');

  // And when both exist, the student is asked which -- not guessed at.
  var chooser = doc.getElementById('sendwhat');
  if (chooser && chooser.hidden) ok('the chooser stays out of the way until asked for');
  else fail('the send chooser is up when nothing is being sent');
  var reached = false;
  window.askWhatToSend(function () { reached = true; });
  if (!reached && !chooser.hidden) ok('sending working with marks present asks which');
  else fail('it sent without asking, or never asked');
  doc.getElementById('send-cancel').onclick();
  if (chooser.hidden) ok('and the question can be dismissed');
  else fail('the chooser cannot be dismissed');
}

if (errors.length) {
  console.log('\n' + errors.length + ' failure(s)');
  process.exit(1);
}
console.log('\nlink       an unreachable board says so');
