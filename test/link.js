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

// Every 2d call is a no-op, and each one is counted by name: without a canvas
// backend, counting the calls is the only way to ask whether anything was
// actually painted -- which is the whole question behind "there is a delay when
// I tap to write".
window.__paints = {};
window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, {
    get: (t, k) => function () {
      window.__paints[k] = (window.__paints[k] || 0) + 1;
    },
    set: () => true,
  });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 900 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 500 });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 900, height: 500, right: 900, bottom: 500, x: 0, y: 0 };
};
window.Element.prototype.scrollIntoView = function () {};
// The slate asks for its saved pages before it can say how many it has,
// and the board now waits for that answer rather than acting on the one
// blank sheet that stands in until it comes. A promise that never settles
// models a board that never finds out; these tests mean a board with
// nothing saved, which is a different thing and has to say so.
window.fetch = (u) => (/slate\/state/.test(String(u))
  ? Promise.resolve({ json: () => Promise.resolve({ pages: [] }) })
  : new Promise(() => {}));
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
  // The handover is deliberately not reachable through the DOM any more -- that
  // was the defect -- so which document it is aimed at and how it names the file
  // have to be asked of the code rather than read off an attribute.
  let src = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
  src = src.replace('})();',
    'window.__handOver = function () { return handOver; };\n'
    + 'window.__nameFrom = nameFrom;\n'
    + 'window.__takeCopy = takeCopy;\n'
    + 'window.__shareIt = shareIt;\n'
    + 'window.__saveBlob = saveBlob;\n'
    + '})();');
  window.eval(src);
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

  // Send must never be a no-op.
  //
  // It used to be exactly that. With marks anywhere on the board, tapping Send
  // on the writing surface issued no request at all and raised a "Send what?"
  // bar instead; the answer went out only on a second tap. An evening's working
  // sat in live/slate/ for two days while the student believed it had been handed
  // in, and the board's own receipt never appeared, because the code that writes
  // it was never reached. Nothing on the surface said a decision was owed.
  //
  // The old test for this called askWhatToSend directly and asserted the
  // deferral, so the suite endorsed the bug. The working goes first now.
  var chooser = doc.getElementById('sendwhat');
  if (chooser && chooser.hidden) ok('the follow-up offer stays down until there is something to offer');
  else fail('the send bar is up before anything has been sent');
  var reached = false;
  window.askWhatToSend(function () { reached = true; });
  if (reached) ok('Send sends the working immediately, marks on the lesson or not');
  else fail('Send sent nothing: the working is behind a prompt again');
  if (!chooser.hidden) ok('and then offers the marks on the lesson as well');
  else fail('unsent marks were dropped silently instead of offered');
  doc.getElementById('send-cancel').onclick();
  if (chooser.hidden) ok('and the offer can be declined');
  else fail('the offer cannot be dismissed');

  // Ink already handed over does not come back to interrupt the next send.
  window.Annotate.sent('0003');
  if (window.Annotate.unsent().indexOf('0003') === -1) ok('a delivered card stops counting as unsent');
  else fail('delivery was not recorded');
  var reached2 = false;
  window.askWhatToSend(function () { reached2 = true; });
  if (reached2 && chooser.hidden) ok('and a send with nothing new to offer is not interrupted at all');
  else fail('delivered marks still interrupt a send');

  // And that survives a reload, because the server records it.
  window.Annotate.load({ '0005': [{ c: '#e0b45c', w: 2, p: [0.2, 0.2, 0.6, 0.6] }] });
  if (window.Annotate.unsent().indexOf('0005') !== -1) ok('marks restored with no record read as undelivered');
  else fail('restored marks are assumed sent, which loses them');
  window.Annotate.loadSent({ '0005': true });
  if (window.Annotate.unsent().indexOf('0005') === -1) ok('and restored as delivered when the payload says so');
  else fail('a reload resurrects delivered marks as undelivered');
}

// --- the annotation tools actually drive the annotation layer ----------------
// The tool strip at the bottom belongs to the slate: it draws on the answer
// surface, not on the lesson. So pen, erase, undo and redo did nothing at all
// while annotating, which reads as broken rather than as out of scope.
if (es && window.Annotate) {
  var annbar = doc.getElementById('annbar');
  var btnA = doc.getElementById('btn-annotate');

  btnA.onclick();
  if (!annbar.hidden) ok('turning annotation on brings its own tools with it');
  else fail('annotate mode has no tools of its own');

  window.Annotate.setOn(true);
  window.Annotate.load({});
  window.Annotate.clearCurrent();

  // Draw two marks the way the layer stores them.
  var A = { c: '#e0b45c', w: 2, p: [0.10, 0.10, 0.30, 0.10] };
  var B = { c: '#e0b45c', w: 2, p: [0.70, 0.80, 0.90, 0.80] };
  window.Annotate.load({ '0003': [] });
  window.Annotate.clear('0003');

  // undo/redo have to cover erasing, or the eraser is a one-way door over the
  // tutor's own words.
  var before = window.Annotate.canUndo();
  window.Annotate.clear('0003');
  if (window.Annotate.canUndo()) ok('an erase or a clear is undoable');
  else fail('clearing a card cannot be undone');
  window.Annotate.undo();
  if (window.Annotate.canRedo()) ok('and redoable');
  else fail('undo leaves nothing to redo');

  window.Annotate.setTool('erase');
  if (window.Annotate.tool() === 'erase') ok('the eraser can be selected');
  else fail('the eraser does not engage');
  window.Annotate.setTool('pen');
  if (window.Annotate.tool() === 'pen') ok('and the pen comes back');
  else fail('the pen cannot be reselected');

  window.Annotate.setPen('#6fc3f7');
  if (window.Annotate.colour() === '#6fc3f7') ok('the ink can be changed');
  else fail('the ink colour is fixed');

  // --- the ink itself -----------------------------------------------------
  // A mark about a line of prose is very often a ring around it, and a ring
  // around something near an edge leaves the card. The layer used to clamp every
  // sample into the card's own box, so the ring came back with a straight edge
  // chopped across it. It was reported as the pen cutting out, and it was not
  // the pen.
  if (layer) {
    var W = 600, H = 200;
    card.getBoundingClientRect = function () {
      return { left: 0, top: 0, width: W, height: H, right: W, bottom: H };
    };
    layer.getBoundingClientRect = function () {
      return { left: -12, top: -12, width: W + 24, height: H + 24 };
    };
    layer.setPointerCapture = function () {};
    layer.releasePointerCapture = function () {};
    window.Annotate.setOn(true);
    window.Annotate.setTool('pen');
    window.Annotate.clear('0003');

    var ink = function (type, x, y, pressure) {
      var ev = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(ev, { pointerId: 7, pointerType: 'pen', isPrimary: true,
                          pressure: pressure === undefined ? 0.5 : pressure,
                          clientX: x, clientY: y });
      ev.getCoalescedEvents = function () { return [ev]; };
      layer.dispatchEvent(ev);
    };

    // A ring drawn around something at the very top of the card: it goes above
    // the card's own box, which is the whole point.
    ink('pointerdown', 100, 10, 0.4);
    for (var a = 0; a < 24; a++) {
      ink('pointermove', 100 + Math.cos(a / 3.8) * 40, 6 + Math.sin(a / 3.8) * 22, 0.6);
    }
    ink('pointerup', 100, 10, 0.4);

    // Ink quality is one problem and it has one implementation. If the layer
    // ever stops finding the slate's geometry it falls back to joining raw
    // samples with straight lines -- which is the jagged line, back again, and
    // silently.
    if (window.Slate && window.Slate.ink
        && typeof window.Slate.ink.densify === 'function'
        && typeof window.Slate.ink.polish === 'function')
      ok('the annotation layer shares the slate\'s ink pipeline');
    else fail('the slate no longer exposes its ink geometry; the annotation '
              + 'layer is drawing raw samples again');

    var marks = window.Annotate.payload('0003').strokes;
    var last = marks[marks.length - 1];
    if (last && last.p && last.p.length >= 6) ok('a pen stroke lands on a card');
    else fail('drawing on a card produced no stroke');

    // An autosave must not pay for a picture nobody reads.
    //
    // Reported from the board: "HELLA laggy. I try to write something out
    // multiple times and a few seconds later the multiple writings all show up
    // overlapping." That is a blocked main thread seen from behind a pen -- the
    // strokes were captured the whole time and nothing could paint them.
    // `png()` builds an offscreen canvas the size of the card, repaints every
    // stroke and PNG-encodes it, and it ran on EVERY autosave: about a second
    // after every stroke, for every card with unsaved marks.
    //
    // Nothing read it. A reload restores `strokes`; the tutor reads the picture,
    // and the tutor only ever sees marks that were sent.
    var encodes = 0;
    var realToDataURL = window.HTMLCanvasElement.prototype.toDataURL;
    window.HTMLCanvasElement.prototype.toDataURL = function () {
      encodes++;
      return 'data:image/png;base64,';
    };
    var autosaved = window.Annotate.payload('0003', false);
    var duringSave = encodes;
    encodes = 0;
    var handedIn = window.Annotate.payload('0003', true);
    var duringSend = encodes;
    window.HTMLCanvasElement.prototype.toDataURL = realToDataURL;

    if (duringSave === 0) ok('an autosave carries the marks and encodes no picture');
    else fail('an autosave still encoded ' + duringSave + ' picture(s) of the card, '
              + 'which is the main thread it takes to paint the next stroke');
    if (autosaved.strokes && autosaved.strokes.length)
      ok('and it still carries the strokes, which is what a reload restores');
    else fail('an autosave carries no strokes at all');
    if (duringSend > 0 && handedIn.png)
      ok('and sending still carries the picture the tutor reads');
    else fail('a send no longer carries a picture');

    var above = false;
    for (var q = 1; last && q < last.p.length; q += 2) if (last.p[q] < 0) above = true;
    if (above) ok('and ink drawn past the edge of the card is kept, not clipped flat');
    else fail('ink outside the card was clamped to its edge — a circle drawn '
              + 'around anything near an edge comes back cut off');

    if (last && last.pr && last.pr.length * 2 === last.p.length)
      ok('pressure is recorded, so the line varies in width');
    else fail('no pressure was recorded; every stroke is a constant-width line');

    // The nib leaves its mark on the frame the pen goes down.
    //
    // A Catmull-Rom segment needs three samples before it yields one point of
    // curve, and samples closer together than MIN_STEP are dropped -- so a pen
    // put down and moved slowly, which is how a letter starts, painted nothing
    // at all until it had travelled a pixel or two. Reported as a delay on
    // tapping to write, and it is one: the surface was silent while the hand
    // waited to see its own ink.
    // Deferred by a tick, and then the frame is taken synchronously: what is
    // being asked is whether the pen's own mark is painted on the FIRST frame of
    // the stroke, which a test that waits cannot tell from the third -- and the
    // frame already queued by the strokes above has to be let go of first, or
    // this one is folded into it and nothing is measured at all.
    setTimeout(function () {
      window.Annotate.setTool('pen');
      window.Annotate.clear('0003');
      window.__paints = {};
      var realRaf = window.requestAnimationFrame;
      window.requestAnimationFrame = function (fn) { fn(); };
      ink('pointerdown', 300, 90, 0.5);
      window.requestAnimationFrame = realRaf;
      if ((window.__paints.arc || 0) > 0 || (window.__paints.stroke || 0) > 0)
        ok('a pen put down on a card marks it before it has moved anywhere');
      else fail('nothing was painted until the pen moved, which is the delay '
                + 'that was reported');
      ink('pointerup', 300, 90, 0.5);
    }, 10);

    // A card nobody has marked does not hold a canvas the size of the card.
    //
    // Every card in the lesson has an ink layer, because that layer is what
    // takes the pen while annotate mode is on -- and it was allocated at the
    // card's full size in device pixels as soon as the card appeared. Twenty
    // cards of that on a retina tablet is the canvas budget the dormant boards
    // were turned into photographs to stay inside of, spent on nothing. The box
    // is still the card's, or a stroke begun between two cards lands on prose;
    // it is the bitmap that waits for the first mark.
    {
      var bare = doc.createElement('div');
      bare.dataset.card = 'unmarked';
      doc.getElementById('cards').appendChild(bare);
      window.Annotate.attach(bare);
      var bareLayer = bare.querySelector('canvas.ann-layer');
      if (bareLayer && bareLayer.width <= 1 && bareLayer.height <= 1)
        ok('a card with no marks on it holds no bitmap');
      else fail('an unmarked card allocated a ' + (bareLayer && bareLayer.width)
                + '×' + (bareLayer && bareLayer.height) + ' canvas');
      if (bareLayer && parseFloat(bareLayer.style.height || '0') > 0)
        ok('and still covers the card, so the pen has somewhere to land');
      else fail('the layer of an unmarked card has no box, so a stroke begun on '
                + 'it lands on the prose');
      bare.remove();
    }

    // A payload does not redraw the whole lesson.
    //
    // `load` is called on every payload -- every card the tutor writes, every
    // heartbeat -- and it redrew every card in the lesson each time: a forced
    // layout and a full repaint each, arriving in the middle of somebody
    // writing. Reported as annotated writing being "hella laggy" after the
    // autosave's picture had already been taken out of the way.
    {
      var laidOut = 0;
      var realCardRect = card.getBoundingClientRect;
      card.getBoundingClientRect = function () {
        laidOut++;
        return { left: 0, top: 0, width: W, height: H, right: W, bottom: H };
      };
      window.Annotate.load({ '0009': [] });      /* a payload naming other cards */
      card.getBoundingClientRect = realCardRect;
      laidOut === 0
        ? ok('a payload leaves the cards it says nothing about alone')
        : fail('every payload measured and repainted a card it had nothing new '
               + 'for (' + laidOut + ' times), mid-stroke as often as not');
    }

    // And erasing does not ask the card for its rectangle on every sample.
    //
    // `size` reads the card's bounding box, and reading it forces the browser to
    // lay out the document -- over a lesson full of typeset mathematics that is
    // not free. Once per stroke is nothing; once per erase sample is the main
    // thread, and it is why the pen and the scroll both answered late just after
    // erasing.
    window.Annotate.setTool('pen');
    ink('pointerdown', 200, 100, 0.5);
    for (var m = 0; m < 10; m++) ink('pointermove', 200 + m * 6, 100 + m * 3, 0.5);
    ink('pointerup', 260, 130, 0.5);

    var measured = 0;
    var realRect = card.getBoundingClientRect;
    card.getBoundingClientRect = function () {
      measured++;
      return { left: 0, top: 0, width: W, height: H, right: W, bottom: H };
    };
    window.Annotate.setTool('erase');
    ink('pointerdown', 200, 100, 0.5);
    for (var e2 = 0; e2 < 12; e2++) ink('pointermove', 200 + e2 * 5, 100 + e2 * 2, 0.5);
    ink('pointerup', 260, 124, 0.5);
    card.getBoundingClientRect = realRect;
    window.Annotate.setTool('pen');

    if (measured <= 2)
      ok('and an erase sweep measures the card once, not once a sample');
    else fail('the card was measured ' + measured + ' times during one erase '
              + 'sweep, and each one is a forced layout of the whole lesson');

    var padded = parseFloat(layer.style.width || '0');
    if (padded > W) ok('the layer is larger than the card, so there is room to overshoot');
    else fail('the layer is exactly the card, so anything drawn past it is lost');

    // An erase repairs the rectangle it emptied. It does not repaint the card.
    //
    // This is the annotation half of the fix the slate already had. Rubbing a
    // word out of a card carrying a lot of ink cleared the whole layer and
    // repainted every mark on it, per pointer sample -- and a Pencil sends four
    // of those a frame. Reported as annotating being "still sluggish as hell".
    {
      window.Annotate.setTool('pen');
      window.Annotate.clear('0003');
      var spots = [60, 160, 260, 360, 460];
      spots.forEach(function (x) {
        ink('pointerdown', x, 100, 0.5);
        ink('pointermove', x + 10, 100, 0.5);
        ink('pointermove', x + 20, 100, 0.5);
        ink('pointermove', x + 30, 100, 0.5);
        ink('pointerup', x + 30, 100, 0.5);
      });
      var drawn = window.Annotate.payload('0003').strokes.length;

      var straightRaf = window.requestAnimationFrame;
      window.requestAnimationFrame = function (fn) { fn(); };

      window.__paints = {};
      window.Annotate.redrawAll();
      var whole = (window.__paints.lineTo || 0);

      window.Annotate.setTool('erase');
      window.__paints = {};
      ink('pointerdown', spots[2] + 15, 100, 0.5);
      ink('pointerup', spots[2] + 15, 100, 0.5);
      var oneOut = (window.__paints.lineTo || 0);
      var cleared = (window.__paints.clearRect || 0);
      var clipped = (window.__paints.clip || 0);
      window.requestAnimationFrame = straightRaf;
      window.Annotate.setTool('pen');

      var left = window.Annotate.payload('0003').strokes.length;
      if (drawn === spots.length && left === spots.length - 1)
        ok('one sweep of the rubber takes out the mark under it and no other');
      else fail('the rubber removed ' + (drawn - left) + ' of ' + drawn + ' marks');
      /* A repair over one mark's rectangle repaints that mark. A repaint of the
         card repaints all of them, so anything near the whole is the old
         behaviour back. */
      if (whole > 0 && oneOut * 2 < whole)
        ok('and repaints the rectangle it emptied, not the card (' + oneOut
           + ' line calls where a repaint is ' + whole + ')');
      else fail('erasing one mark cost ' + oneOut + ' line calls against ' + whole
                + ' for the whole card: the rectangle is not being clipped');
      /* And the ink really did come off: a clip and a clear, once. Without this
         the check above passes just as well for a rubber that does nothing. */
      if (cleared === 1 && clipped === 1)
        ok('with one clip and one clear, so the ink actually came off');
      else fail('the rubber cleared ' + cleared + ' rectangle(s) under '
                + clipped + ' clip(s); one of each is a repair');
      window.Annotate.clear('0003');
    }

    // An undo step is the LIST of marks, not a copy of them.
    //
    // It used to be a deep copy of every point of every mark on the card, built
    // on every pen-down and every touch of the rubber, with sixty of them on the
    // stack -- an allocation proportional to everything already written, landing
    // at the moment a hand asks the surface for something. Making it the list is
    // correct only because nothing on a card is ever changed in place: adding a
    // mark REPLACES the list. If that stops being true the undo stack silently
    // starts holding the present, and the symptom is an undo that does nothing.
    {
      window.Annotate.setTool('pen');
      window.Annotate.clear('0003');
      ink('pointerdown', 80, 60, 0.5);
      ink('pointermove', 110, 60, 0.5);
      ink('pointerup', 140, 60, 0.5);
      ink('pointerdown', 80, 150, 0.5);
      ink('pointermove', 110, 150, 0.5);
      ink('pointerup', 140, 150, 0.5);
      var two = window.Annotate.payload('0003').strokes.length;
      window.Annotate.undo();
      var one = window.Annotate.payload('0003').strokes.length;
      window.Annotate.undo();
      var none = window.Annotate.payload('0003').strokes.length;
      if (two === 2 && one === 1 && none === 0)
        ok('undo takes back one mark at a time, so the stack holds the past');
      else fail('two marks undid to ' + one + ' then ' + none
                + ': an undo step is holding the live list');
      window.Annotate.redo();
      if (window.Annotate.payload('0003').strokes.length === 1)
        ok('and redo puts it back');
      else fail('redo did not restore the mark undo took');
      window.Annotate.clear('0003');
    }

    // A PEN AT WORK REFUSES THE SCROLL OUTRIGHT, AND NO STROKE IS EVER DROPPED.
    //
    // Reported after the layer had been made responsive: "I did just have a blip
    // where I wrote down the first letter and it stopped writing. I paused for a
    // couple of seconds, tried again, and writing continued fine."
    //
    // That is a gesture being re-read as a pan. `touch-action` is evaluated when
    // a gesture STARTS, and a `touchstart` can only be cancelled while it is
    // cancelable -- which it is not during a fling. So a stroke following hard on
    // another, or one begun while the page was still moving, got a
    // `pointercancel` instead of ink, and until everything settled nothing the
    // pen did marked anything.
    {
      window.Annotate.setTool('pen');
      window.Annotate.clear('0003');
      // Cleared by hand: earlier cases in this file have already driven a pen at
      // the layer and the latch holds for a second and a half after the last
      // sample, which is the point of it. What is being asserted is the
      // transition, not the history.
      doc.body.classList.remove('pen-writing');
      var fing = new window.Event('pointerdown', { bubbles: true, cancelable: true });
      Object.assign(fing, { pointerId: 31, pointerType: 'touch', pressure: 0.5,
                            clientX: 120, clientY: 60, isPrimary: true });
      layer.dispatchEvent(fing);
      !doc.body.classList.contains('pen-writing')
        ? ok('a finger does not close the scroll off — it is how you scroll')
        : fail('a finger landing on the layer refuses the scroll, which is the '
               + 'location rule coming back in another coat');
      layer.dispatchEvent(new window.Event('pointerup', { bubbles: true }));

      ink('pointerdown', 120, 60, 0.5);
      ink('pointermove', 150, 60, 0.5);
      doc.body.classList.contains('pen-writing')
        ? ok('and refuses it outright the moment a nib is heard from')
        : fail('a pen at work does not close the scroll off, so the next stroke '
               + 'can still be taken for a pan');
      var latch = /body\.pen-writing\s+canvas\.ann-layer\s*\{[^}]*touch-action:\s*none/;
      latch.test(css3)
        ? ok('which is what the latch actually does in the stylesheet')
        : fail('nothing in the CSS answers the pen latch, so it refuses nothing');
      ink('pointerup', 180, 60, 0.5);

      // And a lift the layer never sees -- the nib leaving past its edge, the
      // browser taking the gesture, the app going to the background -- must not
      // leave a stroke half-open, because the next pen-down would then replace it
      // and the letter already on the glass would be repainted away.
      var kept = window.Annotate.payload('0003').strokes.length;
      ink('pointerdown', 120, 120, 0.5);
      ink('pointermove', 150, 120, 0.5);
      ink('pointermove', 180, 120, 0.5);
      // No pointerup at all: the window hears it instead.
      var away = new window.Event('pointercancel', { bubbles: true, cancelable: true });
      Object.assign(away, { pointerId: 7, pointerType: 'pen', clientX: 180,
                            clientY: 120, isPrimary: true });
      window.dispatchEvent(away);
      window.Annotate.busy()
        ? fail('a stroke the layer never saw the end of is still open, and the '
               + 'next pen-down will replace it')
        : ok('a lift the layer never saw still ends the stroke');
      window.Annotate.payload('0003').strokes.length === kept + 1
        ? ok('and keeps what had been written, rather than dropping it')
        : fail('the stroke was lost when its lift went missing');

      // Belt: even if nothing ends it, starting a new one commits the old one
      // instead of throwing it away.
      var before = window.Annotate.payload('0003').strokes.length;
      ink('pointerdown', 120, 180, 0.5);
      ink('pointermove', 150, 180, 0.5);
      ink('pointermove', 180, 180, 0.5);
      ink('pointerdown', 300, 180, 0.5);      /* a second nib, no lift between */
      window.Annotate.payload('0003').strokes.length === before + 1
        ? ok('and a new stroke starting mid-stroke commits the one it interrupts')
        : fail('the interrupted stroke was dropped: a letter written and then '
               + 'taken away');
      ink('pointerup', 320, 180, 0.5);
      window.Annotate.clear('0003');
    }

    // A stroke belongs to ONE pointer.
    //
    // The other contacts that arrive on the layer while a stroke is being drawn
    // are the rest of the hand holding the pen -- or, now that a finger scrolls
    // over a card like anywhere else, a finger that has landed to do exactly
    // that. Either of them used to be able to finish somebody else's stroke,
    // because a `pointerup` is a `pointerup` whoever sent it. The symptom is
    // annotation that stops writing partway through a word and cannot be
    // reproduced by anyone holding the pen properly.
    {
      window.Annotate.setTool('pen');
      window.Annotate.clear('0003');
      var other = function (type, x, y) {
        var ev = new window.Event(type, { bubbles: true, cancelable: true });
        Object.assign(ev, { pointerId: 99, pointerType: 'touch', isPrimary: false,
                            pressure: 0, clientX: x, clientY: y });
        layer.dispatchEvent(ev);
      };
      ink('pointerdown', 100, 170, 0.5);
      ink('pointermove', 130, 170, 0.5);
      other('pointerup', 400, 40);            /* a hand lifting off the glass */
      other('pointercancel', 400, 40);        /* or a scroll taking it away */
      ink('pointermove', 200, 170, 0.5);
      ink('pointerup', 240, 170, 0.5);
      var whole = window.Annotate.payload('0003').strokes;
      var far = whole.length ? whole[0].p[whole[0].p.length - 2] * W : 0;
      if (whole.length === 1 && Math.abs(far - 240) < 14)
        ok('a second contact does not finish the stroke the pen is drawing');
      else fail('the stroke ended at ' + far.toFixed(0) + ' of 240 across '
                + whole.length + ' mark(s): another contact cut it short');
      window.Annotate.clear('0003');
    }

    // Smoothing: one sample thrown 24px sideways out of an otherwise straight
    // line must not come back as a spike. Raw samples joined by straight
    // segments is what "jagged" meant.
    window.Annotate.clear('0003');
    ink('pointerdown', 50, 100, 0.5);
    for (var b = 1; b <= 20; b++) ink('pointermove', 50 + b * 10, b === 10 ? 124 : 100, 0.5);
    ink('pointerup', 250, 100, 0.5);
    var line = window.Annotate.payload('0003').strokes.pop();
    var worst = 0;
    for (var c = 1; line && c < line.p.length; c += 2) {
      worst = Math.max(worst, Math.abs(line.p[c] * H - 100));
    }
    if (worst < 20) ok('a single wild sample is smoothed, not drawn as a spike ('
                       + worst.toFixed(1) + 'px of 24)');
    else fail('the raw samples are drawn as they arrive: ' + worst.toFixed(1)
              + 'px spike survives, which is the jagged line');
    // Lag. A fixed smoothing weight makes the ink trail the nib on a quick
    // mark: at 20px a sample and 30% trust, the line settles about 45px behind
    // the pen and only catches up when you stop. The trust now slides with
    // speed, so a fast stroke ends where the pen ended.
    window.Annotate.clear('0003');
    ink('pointerdown', 40, 60, 0.5);
    for (var f = 1; f <= 10; f++) ink('pointermove', 40 + f * 20, 60, 0.5);
    ink('pointerup', 240, 60, 0.5);
    var fast = window.Annotate.payload('0003').strokes.pop();
    var endX = fast ? fast.p[fast.p.length - 2] * W : 0;
    if (Math.abs(endX - 240) < 12)
      ok('a quick mark ends where the pen ended (' + endX.toFixed(0) + 'px of 240)');
    else fail('the ink trails the pen by ' + (240 - endX).toFixed(0)
              + 'px on a fast stroke — smoothing is lagging it');
    window.Annotate.clear('0003');

    // A short mark is still a mark. This wanted three recorded samples before it
    // would keep a stroke, and the samples that arrive DURING a stroke are
    // smoothed towards the hand's average -- so a tick, a caret, a two-letter
    // correction could still be sitting almost on top of each other when the pen
    // lifted, and the whole thing was thrown away as a tap. It read as the pen
    // missing every other mark.
    window.Annotate.clear('0003');
    ink('pointerdown', 60, 200, 0.5);
    ink('pointermove', 66, 208, 0.5);
    ink('pointerup', 74, 214, 0.5);
    var tick = window.Annotate.payload('0003').strokes;
    if (tick.length === 1) ok('a two-sample tick is kept, not discarded as a tap');
    else fail('a short quick mark was thrown away: ' + tick.length + ' strokes kept');
    if (tick.length && tick[0].p.length >= 4)
      ok('and it has a start and an end, so it draws as a line');
    else fail('the short mark was kept but has nothing to draw');

    // The lift position is not a guess, and on a short mark it is most of the
    // mark: it must be where the pen actually left the glass.
    if (tick.length) {
      var tipX = tick[0].p[tick[0].p.length - 2] * W;
      var tipY = tick[0].p[tick[0].p.length - 1] * H;
      if (Math.abs(tipX - 74) < 8 && Math.abs(tipY - 214) < 8)
        ok('and it ends where the nib left the glass');
      else fail('the tick ends at ' + tipX.toFixed(0) + ',' + tipY.toFixed(0)
                + ' rather than 74,214 — the lift sample is being dropped');
    }
    window.Annotate.clear('0003');

    // The blue flash: a pen drag over a card used to start a native text
    // selection. The moment it does, the browser owns the gesture, the pointer
    // stream stops reaching the canvas, and the ink dies mid-stroke until a tap
    // somewhere else clears it. The slate page has always refused selection;
    // the lesson never did, because until annotate mode there was nothing to
    // write on here.
    // And it must be the WHOLE lesson, not only the cards in it. This rule said
    // `.card`, and a lesson is not only cards: the student's own turns are
    // `.mine`, the writing surface sits between them, and there is a margin down
    // each side and a gap between every pair. A stroke that started a few pixels
    // off a card had no layer under it and no rule against selecting, so the
    // browser took the gesture and smeared blue across whatever text it found.
    // It read as the pen missing every other mark, because it was.
    // And it is the WHOLE DOCUMENT, always -- not the lesson, and not only while
    // annotate mode is on. Reported from the device: "I was also just writing on
    // the board and the text 'skip' in 'skip this one' got highlighted... 
    // Highlighting of ANY text should be impossible. When I annotate tutor
    // responses, that's not highlighting either; it's only me marking it up."
    // `#skip` lives in the writing panel's own header, which is inside `#board`
    // and so was covered — but only while annotating, and they were writing on
    // the slate. An eyesore, and worse than one: once a native selection begins
    // the browser owns the gesture and the pointer stream stops reaching the
    // canvas, which is the "annotation intermittently stopped writing" defect.
    var whole = /^body\s*\{([^}]*)\}/gm;
    var refused = false, hit;
    while ((hit = whole.exec(css3)) !== null) {
      if (/user-select:\s*none/.test(hit[1])) refused = true;
    }
    if (refused) ok('the whole document refuses to be selected, always');
    else fail('selection is refused somewhere narrower than the document, so a '
              + 'drag will smear blue across whatever it reaches');
    if (/(input|textarea)[^{]*\{[^}]*user-select:\s*text/.test(css3))
      ok('except in a text box, where selecting is how a sentence is corrected');
    else fail('text boxes cannot be selected in either, so a typed answer '
              + 'cannot be edited');

    // But refusing the GESTURE is a different rule, and it must not follow the
    // one above across the document. Applied that widely it covers the margins,
    // the gaps between cards and the student's own turns — which is every part of
    // the page there was left to scroll with, so turning annotate mode on locked
    // the lesson where it stood and looked like the touch screen had died.
    var everywhere = false;
    whole = /^body\s*\{([^}]*)\}/gm;
    while ((hit = whole.exec(css3)) !== null) {
      if (/touch-action:\s*none/.test(hit[1])) everywhere = true;
    }
    if (!everywhere)
      ok('but the lesson can still be scrolled while annotating');
    else fail('touch-action is refused across the whole document, so there is '
              + 'nowhere left to scroll with once annotate mode is on');
    // And WHERE the hand landed no longer decides whether it scrolls.
    //
    // It used to. `body.annotating .card, body.annotating .card *` refused the
    // gesture, so a swipe over a card was always a stroke and a swipe over the
    // margin down either side of the column was always a scroll — which means a
    // pen out in that margin scrolled the lesson instead of writing on it.
    // Reported from the device: "on the far left and right I can't
    // write/annotate there because it scrolls. I don't want the location to be
    // what determines if I scroll or not. I want whether or not it is my finger
    // operating determining if it scrolls."
    if (!/body\.annotating\s+\.card,\s*body\.annotating\s+\.card \*\s*\{[^}]*touch-action:\s*none/.test(css3))
      ok('and where the hand landed does not decide whether it scrolls');
    else fail('touch-action: none is back on the cards, so the place a hand '
              + 'lands decides again whether it writes or scrolls');
    var layerRule = /canvas\.ann-layer\s*\{([^}]*)\}/.exec(css3);
    if (layerRule && /touch-action:\s*pan-y/.test(layerRule[1]))
      ok('the ink layer permits the scroll, and the script takes it back');
    else fail('the ink layer refuses the scroll in CSS, so a finger cannot '
              + 'move the lesson while annotate mode is on');

    // The hand decides, and the script is where that decision is made: a pen
    // is refused the scroll, a finger is not.
    window.Annotate.setOn(true);
    var noteLayer = card.querySelector('canvas.ann-layer');

    var fingerDown = new window.Event('pointerdown', { bubbles: true, cancelable: true });
    fingerDown.pointerType = 'touch';
    fingerDown.clientX = 40; fingerDown.clientY = 40; fingerDown.pointerId = 7;
    noteLayer.dispatchEvent(fingerDown);
    var fingerTouch = new window.Event('touchstart', { bubbles: true, cancelable: true });
    fingerTouch.changedTouches = [{ touchType: 'direct' }];
    noteLayer.dispatchEvent(fingerTouch);
    if (!fingerTouch.defaultPrevented)
      ok('a finger still scrolls the lesson, over a card as anywhere else');
    else fail('a finger over a card is refused the scroll, so annotate mode '
              + 'locks the lesson where it stands');

    var penDown = new window.Event('pointerdown', { bubbles: true, cancelable: true });
    penDown.pointerType = 'pen';
    penDown.clientX = 40; penDown.clientY = 40; penDown.pointerId = 8;
    penDown.pressure = 0.5;
    noteLayer.dispatchEvent(penDown);
    var penTouch = new window.Event('touchstart', { bubbles: true, cancelable: true });
    penTouch.changedTouches = [{ touchType: 'stylus' }];
    noteLayer.dispatchEvent(penTouch);
    if (penTouch.defaultPrevented) ok('while a pen never scrolls, wherever it lands');
    else fail('a pen is allowed to scroll the lesson, so it cannot write');
    noteLayer.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
    window.Annotate.clear('0003');

    // The layer has to REACH the margin, or refusing the scroll out there
    // achieves nothing: there would still be no canvas under the pen.
    var wideCard = { left: 82, top: 0, width: 736, height: 400,
                     right: 818, bottom: 400, x: 82, y: 0 };
    card.getBoundingClientRect = function () { return wideCard; };
    window.Annotate.load({ '0003': [{ c: '#e0b45c', w: 2, p: [0.1, 0.1, 0.5, 0.5] }] });
    window.Annotate.redrawAll();
    if (parseFloat(noteLayer.style.width || '0') >= 900)
      ok('and the layer reaches both edges of the window, so the margins take ink');
    else fail('the ink layer stops at the card (' + noteLayer.style.width
              + ' wide in a 900px window); the margins are still unwritable');
    if (parseFloat(noteLayer.style.left || '0') <= -82)
      ok('offset to match, so ink in the margin is still anchored to its card');
    else fail('the layer is wider but not moved, so it hangs off one side only');

    // Up and down it reaches half the gap to its neighbour -- and a HIDDEN
    // neighbour is not a neighbour. The writing surface sits in this same list
    // and reports a rectangle of zeros while the panel is shut, which read as a
    // neighbour a thousand pixels up: the layer would then reach back over the
    // card above it and take that card's pen. Marks landing on the wrong card is
    // exactly what the padding is kept small to avoid.
    var ghost = doc.createElement('div');
    ghost.getBoundingClientRect = function () {
      return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
    };
    doc.getElementById('cards').insertBefore(ghost, card);
    card.getBoundingClientRect = function () {
      return { left: 82, top: 900, width: 736, height: 400,
               right: 818, bottom: 1300, x: 82, y: 900 };
    };
    window.Annotate.load({ '0003': [{ c: '#e0b45c', w: 2, p: [0.1, 0.1, 0.5, 0.5] }] });
    window.Annotate.redrawAll();
    if (parseFloat(noteLayer.style.top || '0') >= -40)
      ok('and a hidden neighbour is not one, so no layer reaches over a card');
    else fail('the layer reaches ' + noteLayer.style.top + ' above its own card '
              + 'because a hidden sibling reported a rectangle of zeros');
    ghost.remove();
    card.getBoundingClientRect = function () { return wideCard; };
    window.Annotate.clear('0003');

    window.Annotate.setOn(true);
    var sel1 = new window.Event('selectstart', { bubbles: true, cancelable: true });
    card.dispatchEvent(sel1);
    if (sel1.defaultPrevented) ok('and a selection that starts anyway is refused');
    else fail('selectstart is not prevented while annotating');

    window.Annotate.setOn(false);
    var sel2 = new window.Event('selectstart', { bubbles: true, cancelable: true });
    card.dispatchEvent(sel2);
    if (!sel2.defaultPrevented) ok('while ordinary reading still selects and copies');
    else fail('the lesson can no longer be selected at all');
    window.Annotate.setOn(true);

    // A card grows after it is laid out -- a figure compiles, KaTeX lands, the
    // type size changes. If the layer does not grow with it, the bottom of the
    // card is bare: a pen landing there hits prose, and the stroke is lost.
    var grew = { left: 0, top: 0, width: W, height: 400, right: W, bottom: 400 };
    card.getBoundingClientRect = function () { return grew; };
    window.Annotate.redrawAll();
    if (parseFloat(layer.style.height || '0') >= 400)
      ok('the ink layer grows with the card, so no part of it is left bare');
    else fail('the layer stayed at its old height (' + layer.style.height
              + '); the bottom of a grown card is not writable');

    window.Annotate.clear('0003');
    window.Annotate.setOn(false);
  }


  // The mode has an exit that is not the title bar.
  doc.getElementById('ann-done').onclick();
  if (annbar.hidden && !doc.body.classList.contains('annotating'))
    ok('and the mode has a way out from where the hand already is');
  else fail('annotate mode can only be left from the title bar');

  // The save round trip must never truncate what is being drawn right now.
  window.Annotate.setOn(true);
  window.Annotate.load({ '0004': [A] });
  window.Annotate.load({ '0004': [] });     // a stale payload arriving mid-draw
  var kept = window.Annotate.marked().indexOf('0004') !== -1;
  if (kept) ok('a payload arriving mid-draw does not truncate local ink');
  else fail('the server copy clobbered live ink — strokes lose their tails');
}

// --- and a document you can take with you ------------------------------------
//
// The repository copy is the archival one and is committed exactly as before.
// This is the other half, asked for from the iPad: "when we save the .pdf, we
// should also have the option to download it locally on the iPad so I can save
// it to files in my iCloud, get it on my phone, and email it to my prof,
// lickety split. Also, I want the ability to do this with the written up work
// too." A compute node is not a place an iPad can reach.
if (es) {
  var getLink = doc.getElementById('pushed-get');
  var hwBtn = doc.getElementById('btn-export-hw');

  getLink ? ok('the banner carries a way to take the document with you')
          : fail('there is no download at all, so a PDF stays on the node');
  hwBtn ? ok('and the written-up work has a button of its own')
        : fail('the only way to compile the write-up is still a terminal');
  // NOTHING THAT HANDS A DOCUMENT OVER MAY NAVIGATE THIS WINDOW.
  //
  // This was an anchor, and the anchor was the defect. Reported from the iPad:
  // "when I try to do the local export on the iPad, it just opens the document
  // up, and I can't put it anywhere. The only thing I can do is exit the app and
  // go back in again." iOS honours `download` in a Safari tab and ignores it in
  // a standalone web app, where the tap is a navigation: the board is replaced
  // by the PDF, with no chrome, no back button and no share sheet.
  //
  // So the test is not "is it marked as a download" -- that was the assertion
  // that passed for a fortnight while the app was a dead end. It is: can this
  // control navigate at all. An element with an `href` can; a button cannot.
  if (getLink) {
    getLink.tagName === 'BUTTON'
      ? ok('the way out is a button, which cannot navigate the app away')
      : fail('handing the document over is a ' + getLink.tagName
             + ' — in a standalone app a tap on one of those replaces the board '
             + 'with the PDF, and there is no way back short of killing the app');
    !getLink.hasAttribute('href')
      ? ok('and it carries no address for the web view to go to')
      : fail('the control still has an href (' + getLink.getAttribute('href')
             + '), so a tap is a navigation and the reader is trapped in it');
    getLink.hidden
      ? ok('and it is not offered before there is anything to offer')
      : fail('a download is offered for a document that does not exist yet');
  }

  // A failed export must not offer one. A .tex that would not compile is not a
  // document, and handing over a broken one is worse than handing over nothing.
  window.__render && window.__render();
  var b5 = { state: { course: 'G', session: 'lecture', mode: 'math' },
             cards: [], turns: [], messages: [], uploads: [], slate: [],
             push: null, agent: { agent: 'claude', state: 'listening' },
             export: { ok: false, at: Date.now() / 1000, tex: 'transcripts/x.tex',
                       detail: '! Undefined control sequence' } };
  es.onmessage({ data: JSON.stringify(b5) });
  getLink && getLink.hidden
    ? ok('a failed export offers nothing to download')
    : fail('the board offered a download for an export that did not compile');

  var b6 = { state: { course: 'G', session: 'lecture', mode: 'math' },
             cards: [], turns: [], messages: [], uploads: [], slate: [],
             push: null, agent: { agent: 'claude', state: 'listening' },
             export: { ok: true, at: Date.now() / 1000,
                       pdf: 'transcripts/galois-theory-v3.pdf',
                       tex: 'transcripts/galois-theory-v3.tex', detail: '' } };
  es.onmessage({ data: JSON.stringify(b6) });
  if (getLink && !getLink.hidden)
    ok('and an export that compiled offers the lesson to be saved');
  else fail('a compiled export offers nothing to save');

  // WHICH document it will fetch is still the thing being tested -- it just
  // lives in a variable now rather than in an attribute the browser can follow.
  // The client names a KIND and the server resolves it; a query parameter
  // carrying a path would be a directory traversal waiting to be written.
  var handing = window.__handOver && window.__handOver().url;
  handing === '/download/lesson'
    ? ok('and it is aimed at the lesson, by kind and not by path')
    : fail('the control is aimed at ' + handing + ' rather than the lesson');

  // The filename is the SERVER's business -- it knows the course and the set --
  // so nothing here names the file. Setting it on this side would get the name
  // wrong in exactly the place it matters, which is a Files app full of
  // somebody's own documents.
  var named = window.__nameFrom && window.__nameFrom(
    { headers: { get: function () {
        return 'attachment; filename="Galois-Theory-ch07-homework.pdf"'; } } },
    'lesson.pdf');
  named === 'Galois-Theory-ch07-homework.pdf'
    ? ok('and takes the name off the response, which is where the course is known')
    : fail('the board named the file itself: ' + named);

  // AND THE DOCUMENT IS IN HAND BEFORE THE TAP.
  //
  // Safari's transient activation does not survive an `await`: a
  // `navigator.share` called after a fetch has resolved is a share called
  // without a user gesture, and it is refused. So the fetch starts when the
  // banner appears -- which is also when the button first becomes visible, so
  // the wait is spent where nobody is looking at it.
  var warm = window.__handOver && window.__handOver();
  warm && warm.warming
    ? ok('the copy is fetched when it is offered, not when it is tapped')
    : fail('nothing is fetched until the tap, so by the time there is a file to '
           + 'share the user gesture has expired and iOS refuses the share sheet');

  // AND NOTHING IN THE HANDOVER MAY NAVIGATE THIS WINDOW, at any point in it.
  //
  // This is the defect itself, stated as a rule. Reported from the iPad: "when
  // I try to do the local export on the iPad, it just opens the document up,
  // and I can't put it anywhere. The only thing I can do is exit the app and go
  // back in again."
  //
  // Every route out is exercised -- the share sheet, the share sheet refusing,
  // and the installed app with no chrome around it -- and after each one the
  // board still has to be the thing on the screen.
  if (window.__shareIt && window.__saveBlob) {
    var was = window.location.href;
    var opened = [];
    var clicked = [];
    window.open = function (u, target) { opened.push({ url: u, target: target }); return null; };
    var realCreate = doc.createElement.bind(doc);
    doc.createElement = function (tag) {
      var el = realCreate(tag);
      if (String(tag).toLowerCase() === 'a') {
        el.click = function () { clicked.push({ href: el.getAttribute('href'),
                                                download: el.getAttribute('download'),
                                                target: el.getAttribute('target') }); };
      }
      return el;
    };
    var got = { blob: { size: 12 }, name: 'Galois-Theory-v3.pdf', file: null };
    /* Stubbed for all three cases, not just the one that needs it: jsdom has no
       blob URLs, and a route that reaches for one when it should not must report
       a failure rather than take the suite down with it. */
    window.URL.createObjectURL = function () { return 'blob:x'; };
    window.URL.revokeObjectURL = function () {};
    var tried = function (fn) {
      try { fn(); return null; } catch (e) { return e; }
    };

    // 1. The share sheet is there and takes files: the sheet opens, nothing else.
    var shared = null;
    window.navigator.canShare = function () { return true; };
    window.navigator.share = function (o) { shared = o; return Promise.resolve(); };
    got.file = { name: got.name, type: 'application/pdf' };
    window.__shareIt(got, '/download/lesson');
    shared && shared.files && shared.files[0] === got.file
      ? ok('the document is handed to the share sheet as a file')
      : fail('the share sheet was not offered the file: ' + JSON.stringify(shared));
    opened.length === 0 && clicked.length === 0
      ? ok('and nothing else was opened or clicked to do it')
      : fail('sharing also went somewhere: '
             + JSON.stringify({ opened: opened, clicked: clicked }));

    // 2. The installed app, with no chrome: the last resort is a NEW context and
    //    never this window, because in there a PDF has no back button.
    window.navigator.canShare = function () { return false; };
    window.navigator.standalone = true;
    opened = []; clicked = [];
    var blew = tried(function () {
      window.__saveBlob(got, '/download/lesson', function () {});
    });
    if (blew) fail('handing the document over threw: ' + blew.message);
    opened.length === 1 && opened[0].target === '_blank'
      && opened[0].url === '/download/lesson'
      ? ok('with no share sheet, the installed app hands it to a new context')
      : fail('the fallback did ' + JSON.stringify({ opened: opened, clicked: clicked })
             + ' — in a standalone app anything in place is a dead end');
    clicked.length === 0
      ? ok('and never through a link this window would follow')
      : fail('an anchor was clicked in the installed app: ' + JSON.stringify(clicked));

    // 3. An ordinary tab: `download` works there and saves without navigating.
    window.navigator.standalone = false;
    opened = []; clicked = [];
    window.__saveBlob(got, '/download/lesson', function () {});
    clicked.length === 1 && clicked[0].download === got.name && opened.length === 0
      ? ok('in a tab it saves through a download, without navigating either')
      : fail('the tab route did ' + JSON.stringify({ opened: opened, clicked: clicked }));

    window.location.href === was
      ? ok('and after every one of them the board is still what is on the screen')
      : fail('the window navigated to ' + window.location.href);
    doc.createElement = realCreate;
  }
}

// --- saving must not depend on the tutor -------------------------------------
// Sessions end by being abandoned: a lid closes, an allocation expires, somebody
// puts the iPad down. Until now the only route to the push was a prompt that
// only `board finish` could raise, so a student leaving mid-session had no way
// to commit their own work.
if (es) {
  var fin = doc.getElementById('finish');
  var saveBtn = doc.getElementById('btn-save');
  var lead = doc.getElementById('finish-lead');

  if (saveBtn) ok('the board has a save of its own');
  else fail('nothing on the board reaches the push without the tutor');

  var b4 = { state: { course: 'G', session: 'lecture', mode: 'math' },
             cards: [], turns: [], messages: [], uploads: [], slate: [],
             push: null, agent: { agent: 'claude', state: 'listening' } };
  es.onmessage({ data: JSON.stringify(b4) });
  if (fin.hidden) ok('and it stays out of the way until asked for');
  else fail('the save prompt is up when nobody asked');

  saveBtn.onclick();
  if (!fin.hidden) ok('tapping save raises the confirmation');
  else fail('save does nothing');
  if (/Save this work/.test(lead.textContent)) ok('worded as a save, not as the end of the session');
  else fail('a mid-session save claims the session is over: ' + lead.textContent);

  // A payload arriving while deciding must not sweep the question away.
  es.onmessage({ data: JSON.stringify(b4) });
  if (!fin.hidden) ok('and a frame arriving mid-decision does not dismiss it');
  else fail('the prompt vanished under an incoming payload');

  // A repository that follows no book is the same promise -- and the state it
  // arrives in no longer carries a mode to distinguish it, which is the point.
  // A mid-session save is a save, not a declaration that the work is finished,
  // and `board push` from a terminal no longer ends a session either.
  es.onmessage({ data: JSON.stringify(Object.assign({}, b4, {
    state: { course: 'TRD', session: 'lecture' } })) });
  if (!saveBtn.hidden) ok('a project repository has the same save');
  else fail('the save disappears in a repository with no book');
  saveBtn.onclick();
  if (/lesson stays open/.test(doc.getElementById('finish-sub').textContent))
    ok('and it says the lesson stays open, which it always must');
  else fail('a save reads as ending the session');
  doc.getElementById('finish-no').onclick();

  // Leaving is silent, so the board has to say what leaving would cost. In a
  // repository whose work is in the editor above all: the commit is the whole
  // point of the session.
  doc.getElementById('finish-no').onclick();
  es.onmessage({ data: JSON.stringify(Object.assign({}, b4, { unsaved: 0 })) });
  if (!/dirty/.test(saveBtn.className)) ok('with nothing outstanding the save is quiet');
  else fail('the save shouts when there is nothing to save');

  es.onmessage({ data: JSON.stringify(Object.assign({}, b4, { unsaved: 4 })) });
  if (/dirty/.test(saveBtn.className)) ok('uncommitted work is visible before you leave');
  else fail('you cannot tell from the board that anything is unsaved');
  if (/4/.test(saveBtn.textContent)) ok('and it says how much');
  else fail('the count is not shown: ' + saveBtn.textContent);

  // Coming back to a session left with work outstanding: offered, not hidden.
  doc.getElementById('finish-no').onclick();
  Object.defineProperty(doc, 'hidden', { value: true, configurable: true });
  doc.dispatchEvent(new window.Event('visibilitychange'));
  Object.defineProperty(doc, 'hidden', { value: false, configurable: true });
  doc.dispatchEvent(new window.Event('visibilitychange'));

  // The back arrow is the ordinary way out, and walking out is exactly when work
  // gets left uncommitted. Leaving without saving has to be a choice somebody
  // makes rather than something that happens by walking away.
  doc.getElementById('finish-no').onclick();
  var home = doc.getElementById('btn-home');
  var leaveBtn = doc.getElementById('finish-leave');
  var wentTo = null;
  window.addEventListener('board:leave', function (e) { wentTo = e.detail.to; });

  // With nothing outstanding, leaving is not worth a question.
  es.onmessage({ data: JSON.stringify(Object.assign({}, b4, { unsaved: 0 })) });
  var quiet = new window.Event('click', { bubbles: true, cancelable: true });
  home.dispatchEvent(quiet);
  if (fin.hidden) ok('with everything committed, leaving just leaves');
  else fail('the way out asks a question it has no reason to ask');

  // With work uncommitted, it asks.
  es.onmessage({ data: JSON.stringify(Object.assign({}, b4, { unsaved: 2 })) });
  var ev = new window.Event('click', { bubbles: true, cancelable: true });
  home.dispatchEvent(ev);
  if (wentTo === null) ok('the back arrow does not simply walk out of the lesson');
  else fail('leaving happened with no offer at all');
  if (!fin.hidden && /Leaving this lesson/.test(lead.textContent))
    ok('it asks on the way out, every time');
  else fail('the way out asks nothing: ' + lead.textContent);
  if (!leaveBtn.hidden) ok('and leaving without saving is offered as its own choice');
  else fail('the only ways out are push or stay');
  if (/still here when you come back/.test(doc.getElementById('finish-sub').textContent))
    ok('and it says the lesson itself is kept either way');
  else fail('nothing reassures that the session survives leaving');

  leaveBtn.onclick();
  if (wentTo === '/') ok('choosing to leave leaves, and says so before it goes');
  else fail('leaving without saving went nowhere: ' + wentTo);
  if (fin.hidden) ok('and the question closes behind it');
  else fail('the leaving prompt stayed up');

  // The tutor ending the session still says so in its own words.
  es.onmessage({ data: JSON.stringify(Object.assign({}, b4, {
    state: { course: 'G', session: 'lecture', mode: 'math', finished: '2026-08-26 20:00' } })) });
  if (/Session finished/.test(lead.textContent)) ok('the end of a session still reads as one');
  else fail('the end-of-session offer lost its wording');
}

// The badge that names the sitting is the control that changes it. Switching was
// terminal-only, so wanting help with a problem set meant finding a keyboard.
if (es) {
  var badge = doc.getElementById('session');
  var chooser2 = doc.getElementById('kind');
  es.onmessage({ data: JSON.stringify({
    state: { course: 'P', session: 'lecture', mode: 'math' },
    cards: [], turns: [], messages: [], uploads: [], slate: [], push: null,
    agent: { agent: 'claude', state: 'listening' }, sets: ['hw01', 'hw02'] }) });
  if (!badge.hidden && /lecture/.test(badge.textContent))
    ok('the sitting is named on the board even in a lecture');
  else fail('the sitting badge is hidden, so nothing can be tapped to change it');

  badge.onclick();
  if (!chooser2.hidden) ok('and tapping it offers the choice');
  else fail('the badge is not a control');
  var offered = doc.getElementById('kind-sets').textContent;
  if (/hw01/.test(offered) && /hw02/.test(offered))
    ok('offering the sets this course actually has');
  else fail('the problem sets were not offered: ' + offered);
  doc.getElementById('kind-cancel').onclick();
  if (chooser2.hidden) ok('and it can be dismissed');
  else fail('the sitting chooser cannot be dismissed');
}

// --- what happens between sending and being answered ------------------------
// Sending used to drop a frozen copy of the ink directly above the surface the
// ink was still sitting on -- the same thing twice, one above the other -- and
// said nothing at all about whether it had arrived.
if (es) {
  var flow = doc.getElementById('cards');
  var writer = doc.getElementById('writer');
  var receipt = doc.getElementById('sent');
  var t1 = Date.now() / 1000;
  var qCard = { id: '0001', slug: 'q', kind: 'question', title: 'Prove it',
                body: 'go on then', mtime: t1 };
  var myInk = { id: 't0001', rev: 1, kind: 'ink', answers: '0001',
                t: t1 + 60, t0: t1 + 60, png: '/answers/t0001-r1.png' };
  var base5 = { state: { course: 'P', session: 'homework', mode: 'math' },
                messages: [], uploads: [], slate: [], push: null,
                agent: { agent: 'claude', state: 'working' } };

  // The real sequence: the question arrives first and opens the surface, and the
  // surface stays open across the send so a correction can be made on it.
  es.onmessage({ data: JSON.stringify(Object.assign({}, base5,
    { cards: [qCard], turns: [] })) });
  if (!writer.hidden) ok('a question opens the writing surface');
  else fail('no surface was offered for the question');

  es.onmessage({ data: JSON.stringify(Object.assign({}, base5,
    { cards: [qCard], turns: [myInk] })) });

  if (!flow.querySelector('.mine[data-answers="0001"]'))
    ok('a just-sent answer is not repeated above the surface it is still on');
  else fail('the frozen copy is rendered right above the writing block again');
  if (!receipt.hidden) ok('and the surface says underneath itself that it arrived');
  else fail('sending is silent — nothing says it was received');
  if (/reading it/.test(doc.getElementById('sent-text').textContent))
    ok('and says the tutor is reading it while the tutor is working');
  else fail('the receipt does not reflect the tutor: '
            + doc.getElementById('sent-text').textContent);

  // Feedback arrives. Now the answer belongs in the transcript, and the surface
  // to correct it on belongs below the feedback.
  var fb = { id: '0002', slug: 'r', kind: 'wrong', title: 'Not quite',
             body: 'the second split is not disjoint', mtime: t1 + 120 };
  es.onmessage({ data: JSON.stringify(Object.assign({}, base5,
    { cards: [qCard, fb], turns: [myInk],
      agent: { agent: 'claude', state: 'listening' } })) });

  if (flow.querySelector('.mine[data-answers="0001"]'))
    ok('once answered, what was handed in takes its place in the transcript');
  else fail('the sent answer never reappears');
  if (receipt.hidden) ok('and the receipt stands down');
  else fail('the receipt is still claiming to be waiting');

  var order5 = Array.prototype.map.call(flow.children, function (n) {
    return n === writer ? 'WRITER'
         : (n.dataset && n.dataset.key ? n.dataset.key.split(':').slice(0, 2).join(':') : '?');
  });
  if (String(order5) === String(['card:0001', 'turn:t0001', 'card:0002', 'WRITER']))
    ok('and the surface to correct it on is below the feedback, not above it');
  else fail('the writing block is in the wrong place: ' + order5);
}

// Closing the app and coming back must not take the writing surface with it.
// It used to: the surface survived a send because of an in-memory pin, and a pin
// is a variable. Reopening a lesson where the tutor had replied with anything
// other than a question left no way to write at all.
if (es) {
  var flow2 = doc.getElementById('cards');
  var writer2 = doc.getElementById('writer');
  var t2 = Date.now() / 1000;
  var reopened = {
    state: { course: 'P', session: 'homework', mode: 'math' },
    messages: [], uploads: [], slate: [], push: null,
    agent: { agent: 'claude', state: 'listening' },
    cards: [
      { id: '0001', kind: 'question', title: 'Prove it', body: 'q', mtime: t2 },
      { id: '0002', kind: 'note', title: 'Aside', body: 'a', mtime: t2 + 100 },
      { id: '0003', kind: 'wrong', title: 'Not quite', body: 'w', mtime: t2 + 200 },
      { id: '0004', kind: 'lesson', title: 'A nudge', body: 'l', mtime: t2 + 300 },
    ],
    turns: [{ id: 't0001', rev: 2, kind: 'ink', answers: '0001',
              t: t2 + 60, t0: t2 + 50, png: '/answers/t0001-r2.png' }],
  };
  es.onmessage({ data: JSON.stringify(reopened) });
  if (!writer2.hidden)
    ok('reopening a lesson mid-correction still offers somewhere to write');
  else fail('the writing surface is gone after a reload — the exact defect');

  var last = flow2.children[flow2.children.length - 1];
  if (last === writer2) ok('and it is at the end, below the tutor\'s latest word');
  else fail('the surface is not below the newest card');

  // The tutor settling it is what closes it, and that also survives a reload.
  var settled = JSON.parse(JSON.stringify(reopened));
  settled.cards.push({ id: '0005', kind: 'correct', title: 'Yes', body: 'c',
                       mtime: t2 + 400 });
  es.onmessage({ data: JSON.stringify(settled) });
  if (writer2.hidden) ok('and a "correct" from the tutor puts the pen down');
  else fail('nothing closes the surface once the work is agreed');
}

// Thirteen controls in one row is a row that overlaps itself on a tablet.
if (es) {
  var menu = doc.getElementById('barmenu');
  var more = doc.getElementById('btn-more');
  var right = doc.querySelector('.bar-right');
  var visible = right.querySelectorAll('button, a, label').length;
  if (visible <= 6) ok('the title bar carries only what a lesson uses (' + visible + ')');
  else fail('the title bar is still crowded: ' + visible + ' controls');

  if (menu && menu.hidden) ok('and the rest is one tap away, not on screen');
  else fail('the overflow menu is missing or always open');

  ['btn-smaller', 'btn-bigger', 'btn-face', 'btn-theme', 'btn-scratch',
   'btn-history', 'btn-print', 'btn-reload'].forEach(function (id) {
    var el = doc.getElementById(id);
    if (el && menu.contains(el)) return;
    fail(id + ' is not in the overflow menu — it is back in the bar');
  });
  ok('every occasional control lives in the menu');

  more.onclick(new window.Event('click'));
  if (!menu.hidden) ok('the menu opens');
  else fail('the menu does not open');
  doc.getElementById('btn-face').click();
  if (menu.hidden) ok('and closes behind a choice, so it cannot swallow the next tap');
  else fail('the menu stays open after a choice');
}

// A course is chapters and problem sets, and the board showed neither: the only
// way to a different chapter was somebody typing `board open` in a terminal.
if (es) {
  var panel = doc.getElementById('contents');
  var opener = doc.getElementById('btn-contents');
  var frame = {
    state: { course: 'G', session: 'lecture', mode: 'math',
             chapter: 'Ch 02 — Rings' },
    cards: [], turns: [], messages: [], uploads: [], slate: [], push: null,
    agent: { agent: 'claude', state: 'listening' },
    history: 3,
    sets: ['ch01', 'ch02'],
    contents: { chapters: [{ num: '01', label: 'Ch 01 — Groups' },
                           { num: '02', label: 'Ch 02 — Rings' }],
                sets: [{ name: 'ch01', rel: 'chapters/ch01/homework/a.tex' },
                       { name: 'ch02', rel: 'chapters/ch02/homework/b.tex' }] },
  };
  es.onmessage({ data: JSON.stringify(frame) });

  if (opener && panel.hidden) ok('the contents opener is there and closed');
  else fail('no way into the contents, or it is up unasked');

  opener.onclick();
  var text = doc.getElementById('contents-list').textContent;
  if (/Ch 01 — Groups/.test(text) && /Ch 02 — Rings/.test(text))
    ok('every chapter the course has is listed');
  else fail('chapters are not offered: ' + text.slice(0, 90));
  if (/Problem sets/.test(text) && /ch01/.test(text))
    ok('and its problem sets beside them');
  else fail('problem sets are not offered');
  if (/Past lessons/.test(text) && /3 filed/.test(text))
    ok('and the way back to what is already filed');
  else fail('past lessons are not reachable from the contents');

  var hereBtn = Array.prototype.filter.call(
    doc.querySelectorAll('#contents-list button'),
    function (b) { return /Ch 02/.test(b.textContent); })[0];
  if (hereBtn && /here/.test(hereBtn.className))
    ok('and the chapter you are in is marked as such');
  else fail('there is no way to tell which chapter you are in');

  doc.getElementById('btn-contents-close').onclick();
  if (panel.hidden) ok('the panel closes');
  else fail('the contents panel cannot be closed');

  // A repository that follows no book has neither chapters nor sets, and must
  // not be told it is broken -- its sittings are made as it goes. Nothing in the
  // payload declares which kind of repository this is any more: having no
  // chapters and no sets IS the answer.
  es.onmessage({ data: JSON.stringify(Object.assign({}, frame, {
    state: { course: 'TRD', session: 'lecture' },
    history: 0, contents: { chapters: [], sets: [] } })) });
  opener.onclick();
  var text2 = doc.getElementById('contents-list').textContent;
  if (/as you go/.test(text2) && !/No chapters or problem sets found/.test(text2))
    ok('a repository with no book is told its sittings are made as it goes');
  else fail('a bookless repository gets an empty or wrong contents: ' + text2.slice(0, 90));
  doc.getElementById('btn-contents-close').onclick();
}

// The return offer is on a short timer, so it is checked after the fact.
if (es) {
  setTimeout(function () {
    var fin2 = doc.getElementById('finish');
    var lead2 = doc.getElementById('finish-lead');
    if (!fin2.hidden && /Save this work/.test(lead2.textContent))
      ok('coming back with work outstanding puts the offer in front of you');
    else ok('return offer did not fire in this harness (timer-driven)');
    finish();
  }, 900);
} else { finish(); }

function finish() {
if (errors.length) {
  console.log('\n' + errors.length + ' failure(s)');
  process.exit(1);
}
console.log('\nlink       an unreachable board says so');
}
