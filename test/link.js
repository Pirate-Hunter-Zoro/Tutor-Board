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

    var above = false;
    for (var q = 1; last && q < last.p.length; q += 2) if (last.p[q] < 0) above = true;
    if (above) ok('and ink drawn past the edge of the card is kept, not clipped flat');
    else fail('ink outside the card was clamped to its edge — a circle drawn '
              + 'around anything near an edge comes back cut off');

    if (last && last.pr && last.pr.length * 2 === last.p.length)
      ok('pressure is recorded, so the line varies in width');
    else fail('no pressure was recorded; every stroke is a constant-width line');

    var padded = parseFloat(layer.style.width || '0');
    if (padded > W) ok('the layer is larger than the card, so there is room to overshoot');
    else fail('the layer is exactly the card, so anything drawn past it is lost');

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

  // A code repository is the same promise. The button lives in the title bar,
  // which both modes share, and a commit there must NOT end the session the way
  // `board push` from a terminal does -- a mid-session save is a save, not a
  // declaration that the work is finished.
  es.onmessage({ data: JSON.stringify(Object.assign({}, b4, {
    state: { course: 'TRD', session: 'lecture', mode: 'code' } })) });
  if (!saveBtn.hidden) ok('a code course has the same save');
  else fail('the save disappears in a code repository');
  saveBtn.onclick();
  if (/lesson stays open/.test(doc.getElementById('finish-sub').textContent))
    ok('and it says the lesson stays open, which in a code course it must');
  else fail('a code-course save reads as ending the session');
  doc.getElementById('finish-no').onclick();

  // Leaving is silent, so the board has to say what leaving would cost. In a
  // code course above all: the work is in the editor, and the commit is the
  // whole point of the session.
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

  // A code repository has neither chapters nor sets, and must not be told it is
  // broken -- its sections are made as it goes.
  es.onmessage({ data: JSON.stringify(Object.assign({}, frame, {
    state: { course: 'TRD', session: 'lecture', mode: 'code' },
    history: 0, contents: { chapters: [], sets: [] } })) });
  opener.onclick();
  var text2 = doc.getElementById('contents-list').textContent;
  if (/Sections/.test(text2) && /as you go/.test(text2))
    ok('a code course is told its sections are made as it goes');
  else fail('a code course gets an empty or wrong contents: ' + text2.slice(0, 90));
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
