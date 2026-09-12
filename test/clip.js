// One clipboard, three surfaces — and the annotation layer's own repairs.
//
// Reported from the iPad, over four messages in a few minutes, all of them
// about ink written on the lesson:
//
//   "I want to be able to copy/paste writing from writing board to different
//    writing board, from annotation to writing board, and from writing board to
//    annotation."
//   "Scrolling is also still janky and delayed and unresponsive at times,
//    especially when I'm annotating"
//   "Scrolling AND zooming when annotating is janky. And the erasing when
//    annotating wipes out EVERYTHING - it should just wipe out what I touch,
//    like the erasing on the writing board"
//   "adding a new annotation makes the old annotations disappear"
//
// Five separate things, and every one of them is invisible to every other
// suite. What is checked here:
//
//   1. the clipboard is one clipboard. Two mounted writing surfaces are two
//      instances of slate-core.js, and the clipboard used to be a variable
//      inside each of them;
//   2. it crosses between the writing surface and a card's marks, in both
//      directions, and the geometry survives the trip -- the two store their
//      ink in different coordinates and neither can be assigned to the other;
//   3. the rubber on a card takes out the part it touches. A mark there is a
//      ring around a paragraph, not a letter, so removing the whole stroke is
//      removing the whole annotation;
//   4. a new mark does not take the old ones off the glass. `size` reallocates
//      the layer's bitmap when the lesson has reflowed, and allocating a canvas
//      clears it;
//   5. nothing non-passive is listening for touches unless it can actually
//      refuse something. A `touchmove` listener that is not passive makes the
//      browser ask the main thread before it may scroll a pixel.
//
// jsdom is a development-only dependency; without it this skips.

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM(fs.readFileSync(path.join(WEB, 'board.html'), 'utf8'), {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://board.test/board',
});
const { window } = dom;
const doc = window.document;

window.__paints = {};
window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, {
    get: (t, k) => function () { window.__paints[k] = (window.__paints[k] || 0) + 1; },
    set: () => true,
  });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 900 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 500 });
// Per-element, so a card can be moved and the layer has to notice. The default
// is the window, which is what the writing surface fills.
window.HTMLElement.prototype.getBoundingClientRect = function () {
  const r = this._rect || { left: 0, top: 0, width: 900, height: 500 };
  return { left: r.left, top: r.top, width: r.width, height: r.height,
           right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
};
window.Element.prototype.scrollIntoView = function () {};
window.Element.prototype.setPointerCapture = function () {};
window.Element.prototype.releasePointerCapture = function () {};
window.fetch = (u) => (/slate\/state/.test(String(u))
  ? Promise.resolve({ json: () => Promise.resolve({ pages: [] }) })
  : new Promise(() => {}));
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.addEventListener('error', (e) => fail('uncaught: ' + e.message));

// Every listener the document collects, with whether it promised to be passive.
// This is the whole of the scrolling assertion: a non-passive touch listener is
// a promise that the page might refuse the gesture, and the browser keeps it by
// asking the main thread about every move before it scrolls.
const docListeners = [];
const realAdd = window.document.addEventListener.bind(window.document);
const realRemove = window.document.removeEventListener.bind(window.document);
window.document.addEventListener = function (type, fn, opts) {
  docListeners.push({ type, fn, passive: !!(opts && opts.passive) });
  return realAdd(type, fn, opts);
};
window.document.removeEventListener = function (type, fn, opts) {
  for (let i = docListeners.length - 1; i >= 0; i--) {
    if (docListeners[i].type === type && docListeners[i].fn === fn) {
      docListeners.splice(i, 1);
      break;
    }
  }
  return realRemove(type, fn, opts);
};
const blocking = (type) =>
  docListeners.filter((l) => l.type === type && !l.passive).length;

for (const f of ['typeface.js', 'ink-clip.js', 'slate-core.js', 'annotate.js']) {
  try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
  catch (e) { fail(f + ': ' + e.message); }
}

const A = window.Slate.create({ root: doc.getElementById('slate'), compact: false });
const second = doc.createElement('div');
doc.body.appendChild(second);
const B = window.Slate.create({ root: second, compact: false });

const button = (slate, act) => slate.selbar.querySelector('button[data-act="' + act + '"]');

// A word, as a handful of strokes in a box the lasso can go round.
const word = (x, y) => ([
  { c: '#eee', w: 3, pts: [[x, y], [x + 10, y + 30], [x + 20, y]] },
  { c: '#eee', w: 3, pts: [[x + 30, y], [x + 30, y + 30]] },
  { c: '#eee', w: 3, pts: [[x + 45, y + 10], [x + 60, y + 10], [x + 60, y + 28]] },
]);

// A loop, drawn with a pen, around everything in the given box. The box is in
// the page's own logical units and is converted through the view, because the
// surface frames a page above its own writing and the offset is not zero.
function loop(slate, x0, y0, x1, y1, id) {
  const sheet = slate.root.querySelector('canvas.sl-sheet');
  const v = slate.view();
  const send = (type, lx, ly) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { pointerId: id, pointerType: 'pen', pressure: 0.6,
                        clientX: lx * v.k + v.ox, clientY: ly * v.k + v.oy,
                        isPrimary: true });
    ev.getCoalescedEvents = () => [ev];
    sheet.dispatchEvent(ev);
  };
  slate.tool('lasso');
  send('pointerdown', x0, y0);
  send('pointermove', x1, y0);
  send('pointermove', x1, (y0 + y1) / 2);
  send('pointermove', x1, y1);
  send('pointermove', x0, y1);
  send('pointermove', x0, y0);
  send('pointerup', x0, y0);
}

(async () => {
  await sleep(20);

  // ------------------------------------------- one clipboard, two surfaces
  {
    A.load({ w: 900, h: 500, strokes: word(120, 120) });
    B.load({ w: 900, h: 500, strokes: [] });
    await sleep(10);

    loop(A, 90, 90, 260, 200, 11);
    A.picked() === 3
      ? ok('a loop on the first surface catches the word inside it')
      : fail('the lasso picked ' + A.picked() + ' strokes of 3');

    button(A, 'copy').onclick();
    window.InkClip.count() === 3
      ? ok('and Copy puts it on the clipboard')
      : fail('the clipboard holds ' + window.InkClip.count() + ' strokes of 3');

    // The other surface. Before this, each `create` had a clipboard of its own
    // and this button said "nothing copied yet".
    const paste = button(B, 'paste');
    paste.disabled
      ? fail('the second surface will not offer Paste, so the clipboard is '
             + 'still per-instance')
      : ok('the second surface offers Paste with nothing selected on it');
    paste.onclick();
    await sleep(10);
    B.strokes() === 3
      ? ok('and pasting there lands the word on it')
      : fail('the second surface has ' + B.strokes() + ' strokes, not 3');
    B.picked() === 3
      ? ok('left picked, so it can be dragged where it is wanted')
      : fail('the pasted ink is not selected (' + B.picked() + ')');

    // What the clip landed as: the same size it was copied at, inside the view.
    // The box is the ink's extent plus the nib's own width on each side, so it
    // is a few units wider than the 60 by 30 the points span.
    const box = B.inkBox();
    box && Math.abs((box.x1 - box.x0) - 60) < 9 && Math.abs((box.y1 - box.y0) - 30) < 9
      ? ok('at the size it was copied at')
      : fail('the pasted ink came out ' + (box ? Math.round(box.x1 - box.x0) + 'x'
             + Math.round(box.y1 - box.y0) : 'nowhere'));
  }

  // ------------------------------------------------ and it survives leaving
  {
    let raw = null;
    try { raw = window.localStorage.getItem('tutor-board.clip'); } catch (e) {}
    raw && JSON.parse(raw).strokes.length === 3
      ? ok('the clipboard is on disk, so /slate and back does not lose it')
      : fail('nothing was written to localStorage, so a navigation empties the '
             + 'clipboard');
  }

  // --------------------------------------------------- a card, and its marks
  //
  // With a neighbour above it, because the layer reaches half way into the gap
  // between the two and that is the geometry a reflow changes without the card
  // itself changing size at all.
  const above = doc.createElement('div');
  above.className = 'card';
  above._rect = { left: 100, top: 0, width: 700, height: 40 };
  doc.getElementById('cards').appendChild(above);
  const card = doc.createElement('div');
  card.className = 'card';
  card.dataset.card = 'c1';
  card._rect = { left: 100, top: 260, width: 700, height: 200 };
  doc.getElementById('cards').appendChild(card);
  window.Annotate.setOn(true);
  window.Annotate.attach(card);
  const layer = card.querySelector('canvas.ann-layer');

  // Coordinates RELATIVE TO THE CARD, which is the one frame that survives the
  // padding moving underneath: the layer's own offset is the card's rectangle
  // less the padding, so an offset from the card's corner is the same number in
  // card space whatever the padding is.
  const nib = (type, x, y, id = 41) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { pointerId: id, pointerType: 'pen', pressure: 0.6,
                        clientX: card._rect.left + x, clientY: card._rect.top + y,
                        isPrimary: true });
    ev.getCoalescedEvents = () => [ev];
    layer.dispatchEvent(ev);
  };

  // A line written across the card, the way a person underlines a step.
  function write(y, id) {
    window.Annotate.setTool('pen');
    nib('pointerdown', 50, y, id);
    for (let i = 1; i <= 40; i++) nib('pointermove', 50 + i * 10, y, id);
    nib('pointerup', 450, y, id);
  }

  {
    write(40, 41);
    const marks = window.Annotate.payload('c1', false).strokes.length;
    marks === 1
      ? ok('a mark lands on the card')
      : fail('the card holds ' + marks + ' marks, not 1');
  }

  // -------------------------------- a new mark leaves the old ones on screen
  {
    // The lesson reflows: a figure above finishes compiling and grows. The card
    // is the same size and in the same place, so its own resize observer sees
    // nothing at all -- but the layer reaches half way into the gap above it,
    // and that gap has just closed. `size` reallocates the bitmap, and
    // allocating a canvas clears it.
    above._rect = { left: 100, top: 0, width: 700, height: 240 };
    window.Annotate.setTool('pen');
    window.__paints = {};
    nib('pointerdown', 100, 80, 42);
    const repainted = window.__paints.stroke || 0;
    nib('pointerup', 100, 80, 42);
    repainted > 0
      ? ok('a pen landing after the lesson reflowed puts the existing marks '
           + 'back on the glass (' + repainted + ' line calls)')
      : fail('the layer was reallocated and nothing repainted what was on it — '
             + 'which is "adding a new annotation makes the old annotations '
             + 'disappear"');
  }

  // ------------------------------------- the rubber takes out what it touches
  {
    window.Annotate.clear('c1');
    write(40, 43);
    const before = window.Annotate.payload('c1', false).strokes[0];
    const wide = before.p.length / 2;

    window.Annotate.setTool('erase');
    nib('pointerdown', 250, 40, 44);
    nib('pointermove', 256, 40, 44);
    nib('pointerup', 256, 40, 44);
    const after = window.Annotate.payload('c1', false).strokes;

    after.length === 2
      ? ok('rubbing the middle of a line leaves the two ends of it behind')
      : fail('the rubber left ' + after.length + ' pieces, not 2 — a mark on a '
             + 'card is a ring round a paragraph, and taking the whole stroke '
             + 'is taking the whole annotation');
    if (after.length === 2) {
      const kept = after[0].p.length / 2 + after[1].p.length / 2;
      kept > wide * 0.6
        ? ok('and most of the line survives (' + kept + ' of ' + wide + ' samples)')
        : fail('only ' + kept + ' of ' + wide + ' samples survived a six-pixel rub');
      after[0].p[0] < after[1].p[0]
        ? ok('in the order they were written')
        : fail('the pieces came back out of order');
    }
  }

  // ------------------------------------------- a card's marks, onto the slate
  {
    window.Annotate.clear('c1');
    write(40, 45);
    window.Annotate.setTool('lasso');
    nib('pointerdown', 20, 10, 46);
    nib('pointermove', 250, 10, 46);
    nib('pointermove', 480, 10, 46);
    nib('pointermove', 480, 80, 46);
    nib('pointermove', 250, 80, 46);
    nib('pointermove', 20, 80, 46);
    nib('pointerup', 20, 10, 46);
    window.Annotate.picked() === 1
      ? ok('a loop on a card catches the mark inside it')
      : fail('the card lasso picked ' + window.Annotate.picked() + ' of 1');

    const n = window.Annotate.copy();
    n === 1
      ? ok('and Copy puts a card mark on the same clipboard')
      : fail('copying off a card put ' + n + ' strokes on the clipboard');

    B.load({ w: 900, h: 500, strokes: [] });
    await sleep(5);
    button(B, 'paste').onclick();
    await sleep(5);
    B.strokes() === 1
      ? ok('which pastes onto the writing board')
      : fail('the board has ' + B.strokes() + ' strokes after pasting a card mark');

    // A line four hundred pixels wide, dropped on a surface nine hundred wide:
    // it fits, so it is not shrunk, and it is somewhere on the visible page.
    const box = B.inkBox();
    const view = B.view();
    box && box.x0 > -1e4 && box.x1 - box.x0 > 100
      ? ok('at a readable size (' + Math.round(box.x1 - box.x0) + ' units wide)')
      : fail('the pasted mark came out ' + (box ? Math.round(box.x1 - box.x0) : 'nowhere'));
    view && ok('and the board is still at ' + Math.round(view.k / view.fit * 100) + '%');
  }

  // ------------------------------------------- the slate's working, onto a card
  {
    A.load({ w: 900, h: 500, strokes: word(200, 200) });
    await sleep(5);
    loop(A, 170, 170, 300, 280, 12);
    A.picked() === 3
      ? ok('working looped on the writing board')
      : fail('the lasso picked ' + A.picked() + ' of 3 on the board');
    button(A, 'copy').onclick();

    window.Annotate.clear('c1');
    const n = window.Annotate.paste();
    n === 3
      ? ok('pastes onto the card the pen was last on')
      : fail('pasting onto a card landed ' + n + ' strokes of 3');
    const marks = window.Annotate.payload('c1', false).strokes;
    marks.length === 3
      ? ok('and the card is holding them')
      : fail('the card holds ' + marks.length + ' marks of 3');
    window.Annotate.picked() === 3
      ? ok('left picked, so they can be dragged onto the words they are about')
      : fail('the pasted marks are not selected (' + window.Annotate.picked() + ')');
    // Fractions of the card, which is what a card stores -- and inside it,
    // because a mark half a screen off the edge of the card it is anchored to
    // moves somewhere else on the next reflow.
    const xs = marks.reduce((a, s) => a.concat(s.p.filter((_, i) => i % 2 === 0)), []);
    const ys = marks.reduce((a, s) => a.concat(s.p.filter((_, i) => i % 2 === 1)), []);
    Math.min(...xs) > -0.2 && Math.max(...xs) < 1.2
      ? ok('within the width of the card it landed on')
      : fail('the pasted marks run from ' + Math.min(...xs).toFixed(2) + ' to '
             + Math.max(...xs).toFixed(2) + ' of the card width');
    Math.min(...ys) > -0.2 && Math.max(...ys) < 1.2
      ? ok('and within its height')
      : fail('the pasted marks run from ' + Math.min(...ys).toFixed(2) + ' to '
             + Math.max(...ys).toFixed(2) + ' of the card height');
  }

  // --------------------------------------------- dragging what is picked
  {
    const marks = window.Annotate.payload('c1', false).strokes;
    const before = marks.map((s) => s.p[0]);
    window.Annotate.setTool('lasso');
    // Inside the selection's own box: this is a drag, not a new loop. The box is
    // in card fractions; a card is 700 by 200 here.
    const x = marks[0].p[0] * 700, y = marks[0].p[1] * 200;
    nib('pointerdown', x + 5, y + 5, 47);
    nib('pointermove', x + 45, y + 15, 47);
    nib('pointerup', x + 45, y + 15, 47);
    const after = window.Annotate.payload('c1', false).strokes.map((s) => s.p[0]);
    after.some((v, i) => Math.abs(v - before[i]) > 0.001)
      ? ok('and dragging inside the loop moves them')
      : fail('a drag inside the selection moved nothing');
  }

  // ------------------------------------------------------- the scrolling
  {
    window.Annotate.setOn(false);
    blocking('touchstart') === 0 && blocking('touchmove') === 0
      ? ok('with annotate off, nothing non-passive is waiting for a touch')
      : fail('the page still has ' + blocking('touchstart') + ' touchstart and '
             + blocking('touchmove') + ' touchmove listeners that can block a '
             + 'scroll while nothing is being annotated');

    window.Annotate.setOn(true);
    blocking('touchmove') === 0
      ? ok('with it on and no stroke in progress, a touchmove is not blocked — '
           + 'so the scroll and the pinch are the compositor\'s')
      : fail('a non-passive touchmove listener is in place while merely '
             + 'annotating, which is a main-thread round trip per frame of '
             + 'every scroll');

    window.Annotate.setTool('pen');
    nib('pointerdown', 200, 100, 48);
    blocking('touchmove') === 1
      ? ok('and it is armed for exactly as long as the stroke lasts')
      : fail('a stroke in progress has ' + blocking('touchmove')
             + ' touchmove listeners, so it cannot refuse the scroll');
    nib('pointerup', 260, 100, 48);
    blocking('touchmove') === 0
      ? ok('...and disarmed when the nib comes up')
      : fail('the touchmove refusal outlived the stroke');
  }

  // The other half of the same report is a CSS rule: the layer used to refuse
  // every gesture for a second and a half after the nib was last heard from,
  // and two fingers are never the pen.
  {
    const css = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
    const rule = /body\.pen-writing canvas\.ann-layer\s*\{([^}]*)\}/.exec(css);
    rule && /touch-action:\s*pinch-zoom/.test(rule[1])
      ? ok('and the pen latch leaves pinching alone')
      : fail('body.pen-writing still takes every gesture, so the lesson cannot '
             + 'be magnified for a second and a half after each mark');
  }

  console.log(errors.length ? errors.length + ' failed' : 'one clipboard, three surfaces');
  process.exit(errors.length ? 1 : 0);
})();
