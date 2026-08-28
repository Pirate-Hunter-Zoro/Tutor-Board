// The writing surface is a window onto a plane, and a finger is not a pen.
//
// Two complaints from a person holding an iPad, both invisible to every other
// suite:
//
//   1. zooming out found a hard edge a screen away in every direction, because
//      the page was a box and the view was clamped to it;
//   2. swiping with a finger drew a line instead of scrolling -- the old rule
//      was a latch ("a finger draws until a pen has been seen"), and a latch is
//      a variable, so every reload handed the first swipe to the ink.
//
// The third thing checked here is the one that makes the first affordable: what
// is sent to the tutor is a picture of the WRITING, cropped to the ink and then
// capped, so an unbounded canvas does not mean an unbounded upload.
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

const dom = new JSDOM(fs.readFileSync(path.join(WEB, 'slate.html'), 'utf8'), {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://board.test/slate',
});
const { window } = dom;
const doc = window.document;

const W = 900, H = 500;
window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, { get: () => () => {}, set: () => true });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => W });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => H });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0 };
};
window.Element.prototype.scrollIntoView = function () {};
// jsdom implements neither, and a pointerdown handler that throws just does nothing.
window.Element.prototype.setPointerCapture = function () {};
window.Element.prototype.releasePointerCapture = function () {};
window.fetch = () => new Promise(() => {});
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.addEventListener('error', (e) => fail('uncaught: ' + e.message));

for (const f of ['typeface.js', 'slate-core.js']) {
  try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
  catch (e) { fail(f + ': ' + e.message); }
}

const root = doc.getElementById('slate');
const slate = window.Slate.create({ root, compact: false });
const sheet = root.querySelector('canvas.sl-sheet');

// ---------------------------------------------------------------- the plane
{
  // Room beyond the page in every direction, including above and to the left of
  // the origin. The old clamp allowed neither.
  const r = slate.reach();
  r.x0 < 0 && r.y0 < 0
    ? ok('the plane extends above and to the left of the page')
    : fail('the origin is still a corner you cannot get behind (' + r.x0 + ',' + r.y0 + ')');
  r.x1 > W && r.y1 > H
    ? ok('and beyond the page on the other two sides')
    : fail('the page is still the edge of the world');
}

// Drawing with a pen, far outside the starting page, must be possible and must
// push the plane outward rather than being clamped away.
const pen = (type, x, y, id = 1) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerId: id, pointerType: 'pen', pressure: 0.6,
                      clientX: x, clientY: y, isPrimary: true });
  ev.getCoalescedEvents = () => [ev];
  sheet.dispatchEvent(ev);
};

{
  const before = slate.reach();
  pen('pointerdown', 100, 100);
  for (let i = 0; i < 30; i++) pen('pointermove', 100 + i * 8, 100 + i * 6);
  pen('pointerup', 340, 280);
  slate.strokes() > 0 ? ok('a pen stroke lands') : fail('the pen drew nothing');

  const box = slate.inkBox();
  box ? ok('and the ink has a measurable extent') : fail('the ink has no bounding box');

  const after = slate.reach();
  after.x1 >= before.x1 && after.y1 >= before.y1
    ? ok('the plane never shrinks under what has been written')
    : fail('writing shrank the reachable area');
}

// Zooming out must actually go a long way out. The old floor was half the fit
// scale, which is barely one step.
{
  const v0 = slate.view();
  for (let i = 0; i < 40; i++) slate.zoomOutForTest ? slate.zoomOutForTest() : null;
  const btnOut = root.querySelector('.sl-menu') && [...root.querySelectorAll('.sl-t')]
    .find((b) => b.textContent === '−');
  if (btnOut) {
    for (let i = 0; i < 40; i++) btnOut.onclick();
    const v1 = slate.view();
    v1.k < v0.fit / 4
      ? ok('zooming out reaches at least a quarter of fit scale')
      : fail('zoom out still stops almost immediately (' + (v1.k / v0.fit).toFixed(3) + ' of fit)');
  } else {
    fail('no zoom-out control found');
  }
}

// ------------------------------------------------------- the export is cropped
{
  const btnFit = [...root.querySelectorAll('.sl-t')].find((b) => b.textContent === '⤢');
  btnFit ? ok('there is a control to fit what has been written') : fail('no fit control');

  const box = slate.pngBox();
  const ink = slate.inkBox();
  // The image covers the ink and not the plane: a stroke in a 900x500 corner of
  // a canvas that now reaches thousands of units must not produce a
  // thousand-unit image.
  box.w < (slate.reach().x1 - slate.reach().x0)
    ? ok('the exported image is smaller than the plane it sits on')
    : fail('the export still rasterises the whole canvas');
  box.x0 <= ink.x0 && box.y0 <= ink.y0
    && box.x0 + box.w >= ink.x1 && box.y0 + box.h >= ink.y1
    ? ok('and still contains every mark')
    : fail('the crop cuts ink off');
  box.s > 0 && box.s <= 1
    ? ok('with a scale that only ever shrinks')
    : fail('the export scale is out of range (' + box.s + ')');
  box.w * box.s <= 2600 && box.h * box.s <= 2600
    ? ok('and a capped pixel size, so a large canvas is still a small upload')
    : fail('the image is not capped (' + Math.round(box.w * box.s) + 'x' + Math.round(box.h * box.s) + ')');
}

// ------------------------------------------------------------- finger vs pen
const touch = (type, x, y, id = 9) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerId: id, pointerType: 'touch', pressure: 0.5,
                      clientX: x, clientY: y, isPrimary: true });
  ev.getCoalescedEvents = () => [ev];
  sheet.dispatchEvent(ev);
};

const swipe = (id, x, y, dx, dy) => {
  touch('pointerdown', x, y, id);
  for (let i = 0; i < 20; i++) touch('pointermove', x + dx * i, y + dy * i, id);
  touch('pointerup', x + dx * 20, y + dy * 20, id);
};

slate.finger('scroll');
slate.finger() === 'scroll' ? ok('a finger scrolls by default') : fail('the finger setting did not take');

// Palm rejection first, because the pen has just been used: the heel of a hand
// resting on the glass is a touch like any other, and with a finger set to
// scroll it would drag the canvas out from under the nib mid-word.
{
  const v0 = slate.view();
  const n0 = slate.strokes();
  swipe(21, 400, 300, -6, -4);
  slate.strokes() === n0 && v0.ox === slate.view().ox && v0.oy === slate.view().oy
    ? ok('a touch straight after the pen is treated as a palm and ignored')
    : fail('a resting hand still moves the surface while writing');
}

// And once the hand has had a moment, a deliberate swipe scrolls.
setTimeout(function () {
  const before = slate.strokes();
  const v0 = slate.view();
  swipe(9, 400, 300, -6, -4);

  slate.strokes() === before
    ? ok('a finger swipe writes nothing')
    : fail('a finger still draws — this is the complaint');
  const v1 = slate.view();
  (v1.ox !== v0.ox || v1.oy !== v0.oy)
    ? ok('and pans the surface instead')
    : fail('a finger swipe did nothing at all: it must scroll');

  // The setting is a setting: somebody with no stylus can turn it on.
  slate.finger('write');
  const b2 = slate.strokes();
  swipe(11, 500, 200, 6, 4);
  slate.strokes() > b2
    ? ok('and a finger writes when told to, for a device with no pen')
    : fail('the finger setting cannot be turned on');

  // Remembered, because being asked every session is being asked for ever --
  // and the lesson's annotation layer has to read the same answer.
  window.Slate.fingerWrites() === true
    ? ok('the setting is readable by the lesson\'s annotation layer too')
    : fail('the two surfaces will disagree about the same hand');
  slate.finger('scroll');
  window.Slate.fingerWrites() === false
    ? ok('and both directions round-trip through storage')
    : fail('the setting does not persist');

  console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                            : '\nthe surface is a plane, and a finger is not a pen');
  window.close();
  process.exit(errors.length ? 1 : 0);
}, 650);
