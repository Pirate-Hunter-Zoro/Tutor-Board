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
// Every 2d call is a no-op except `setTransform`, which is recorded: it is the
// only way to ask, without a layout engine, WHERE on a page a drawing was framed
// — and framing a page above its own writing is what made a board full of work
// read as an empty one.
window.__transforms = [];
// Every other call is counted by name. Without a canvas backend, counting how
// many times the surface asked to draw a line is the only way to ask how much
// work a gesture costs -- which is the whole question behind a pen that answers
// late after erasing.
window.__paints = {};
window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, {
    get: (t, k) => (k === 'setTransform'
      ? (a, b, c, d, e, f) => { window.__transforms.push({ k: a, ox: e, oy: f }); }
      : function () { window.__paints[k] = (window.__paints[k] || 0) + 1; }),
    set: () => true,
  });
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
// The slate asks for its saved pages before it can say how many it has,
// and the board now waits for that answer rather than acting on the one
// blank sheet that stands in until it comes. A promise that never settles
// models a board that never finds out; these tests mean a board with
// nothing saved, which is a different thing and has to say so.
window.fetch = (u) => (/slate\/state/.test(String(u))
  ? Promise.resolve({ json: () => Promise.resolve({ pages: [] }) })
  : new Promise(() => {}));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A contact with a patch the size of a palm, rather than a fingertip. Safari
// reports the contact size on a pointer event; this is what a heel of a hand
// looks like on the wire.
const heel = (type, x, y, id) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerId: id, pointerType: 'touch', pressure: 0.5,
                      clientX: x, clientY: y, width: 58, height: 46, isPrimary: false });
  ev.getCoalescedEvents = () => [ev];
  sheet.dispatchEvent(ev);
};
const heelSwipe = (id, x, y, dx, dy) => {
  heel('pointerdown', x, y, id);
  for (let i = 0; i < 20; i++) heel('pointermove', x + dx * i, y + dy * i, id);
  heel('pointerup', x + dx * 20, y + dy * 20, id);
};

// And once the hand has had a moment, a deliberate swipe scrolls.
(async function () {
  await sleep(650);
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

  // ------------------------------------------------------------------ palms
  //
  // The complaint, in the words it arrived in: "my palm rests on the writing
  // block and then I get scrolled way up with a vertical line streaking upward".
  // Two symptoms, one cause. The suppression was a timer since the pen last
  // REPORTED, and a pen held still reports nothing -- so pausing mid-stroke to
  // think ran the timer out while the nib was still on the glass. The resting
  // heel then panned the plane, and the next sample of the very same stroke was
  // converted against the new offset: the page appeared to scroll away, and the
  // stroke drew a straight line across the working to catch up.
  slate.finger('scroll');
  {
    pen('pointerdown', 200, 200, 3);
    pen('pointermove', 220, 210, 3);
    await sleep(700);                    // thinking about the next line, nib down
    const v0 = slate.view();
    const n0 = slate.strokes();
    swipe(31, 600, 400, -8, -5);         // the heel shifts where it rests

    const v1 = slate.view();
    (v1.ox === v0.ox && v1.oy === v0.oy)
      ? ok('a pen paused mid-stroke still suppresses the hand resting beside it')
      : fail('the plane panned under a stroke in progress — this is the streak');

    pen('pointermove', 240, 220, 3);
    pen('pointerup', 240, 220, 3);
    slate.strokes() === n0 + 1
      ? ok('and the stroke it was in the middle of finishes as one line')
      : fail('the paused stroke did not survive the hand');
  }

  // The pen is the ONLY signal. There was a contact-size test here as well --
  // a palm's patch is wider than a fingertip's -- and it took the scroll and the
  // pinch with it: what Safari reports for a fingertip's width is not the small
  // number the specification's examples suggest, so the threshold meant to catch
  // a heel of a hand caught ordinary fingers, and the surface stopped answering
  // touch at all. A signal that cannot be calibrated without the hardware in
  // front of you does not belong in the path that decides whether the surface
  // responds.
  {
    await sleep(700);
    const v0 = slate.view();
    heelSwipe(41, 500, 300, -8, -5);
    const v1 = slate.view();
    (v1.ox !== v0.ox || v1.oy !== v0.oy)
      ? ok('with no pen in sight, a broad contact still pans — size is not judged')
      : fail('contact size is being judged again; this is what killed the scroll');
  }

  // A judgement that cannot be undone is a surface that stops answering.
  //
  // "Write a line, then scroll" is the commonest pair of gestures there is, and
  // the condemnation used to be made on `handAtWork()` -- true for half a second
  // after the pen last reported -- and then kept for the whole life of the
  // contact. So a finger put down within half a second of the pen lifting was
  // dead, and stayed dead however long it rested. The surface looked like it had
  // stopped answering at random; the randomness was how fast the hand moved.
  {
    pen('pointerdown', 300, 300, 5);
    pen('pointermove', 340, 320, 5);
    pen('pointerup', 340, 320, 5);            // the nib is off the glass
    const v0 = slate.view();
    swipe(45, 500, 300, -7, -4);              // a finger, immediately after
    // Suppressed for the moment, which is right -- a hand settles after a pen.
    const v1 = slate.view();
    (v1.ox === v0.ox && v1.oy === v0.oy)
      ? ok('a finger landing on the pen\'s heels is held off for a moment')
      : fail('the palm suppression does not apply just after a stroke');

    await sleep(700);                          // and now it should let go
    const v2 = slate.view();
    swipe(47, 500, 300, -7, -4);
    const v3 = slate.view();
    (v3.ox !== v2.ox || v3.oy !== v2.oy)
      ? ok('and lets go again — the judgement is a moment, not a life sentence')
      : fail('a finger condemned by the pen stays condemned; this is the surface '
             + 'that stops answering at random');
  }

  // And an ordinary fingertip, for the avoidance of doubt.
  {
    const v0 = slate.view();
    swipe(43, 500, 300, -8, -5);
    const v1 = slate.view();
    (v1.ox !== v0.ox || v1.oy !== v0.oy)
      ? ok('as does an ordinary fingertip')
      : fail('palm rejection ate the finger scroll');
  }

  // Every rule that refuses a touch has to expire, or a lift the surface never
  // saw takes the surface away for good. This is the failure that cost an
  // evening: `penDown` latched true and nothing a hand did was allowed to pan,
  // pinch or write, with nothing on screen to say it was a latch.
  {
    const js = fs.readFileSync(path.join(WEB, 'slate-core.js'), 'utf8');
    /PEN_STALE/.test(js) && /PALM_STALE/.test(js)
      ? ok('and both refusals expire on their own')
      : fail('a refusal here can outlive the contact that caused it');
    /window\.addEventListener\(t, function \(ev\) \{\s*if \(ev\.pointerType === "pen"\) penDown = false;/
      .test(js)
      ? ok('a pen lifted outside the surface still gives the hand its glass back')
      : fail('only the canvas can clear the pen; a nib lifted past its edge latches');
  }

  // And the usual order of events: the hand lands BEFORE the nib does, so a
  // stroke a touch has started is a palm by hindsight the moment a pen arrives.
  {
    slate.finger('write');
    await sleep(700);
    const n0 = slate.strokes();
    touch('pointerdown', 700, 100, 51);
    for (let i = 0; i < 8; i++) touch('pointermove', 700 - i * 5, 100 + i * 9, 51);
    pen('pointerdown', 300, 300, 5);
    touch('pointermove', 650, 190, 51);
    touch('pointerup', 650, 190, 51);
    slate.strokes() === n0
      ? ok('a line a hand had started is discarded when the nib arrives')
      : fail('the hand\'s stroke was kept: ' + (slate.strokes() - n0) + ' extra');

    pen('pointermove', 320, 320, 5);
    pen('pointerup', 320, 320, 5);
    slate.strokes() === n0 + 1
      ? ok('and the pen\'s own stroke is the only thing that lands')
      : fail('the pen stroke did not land after the hand was disowned');
    slate.finger('scroll');
  }

  // ----------------------------------------------------------------- rubbing
  //
  // "If I swipe over a bunch of text many times quickly, all of that text
  // should be gone." It was not: the rubber tested the single point each event
  // landed on, and a fast swipe is fast precisely because its samples arrive a
  // long way apart -- so it left untouched gaps between them and half the
  // working survived every pass. It is a swept segment now.
  {
    slate.finger('scroll');
    slate.clear();
    // Ten short strokes in a row, the way a line of working looks.
    for (let n = 0; n < 10; n++) {
      pen('pointerdown', 100 + n * 40, 300, 7);
      pen('pointermove', 110 + n * 40, 310, 7);
      pen('pointermove', 120 + n * 40, 300, 7);
      pen('pointerup', 120 + n * 40, 300, 7);
    }
    const written = slate.strokes();
    written === 10
      ? ok('ten marks on the page to rub out')
      : fail('the fixture wrote ' + written + ' strokes, not 10');

    // One fast swipe across the lot, delivered as three samples — which is what
    // a flick actually looks like on the wire.
    slate.tool && slate.tool('erase');
    pen('pointerdown', 80, 305, 8);
    pen('pointermove', 260, 305, 8);
    pen('pointermove', 460, 305, 8);
    pen('pointerup', 520, 305, 8);

    slate.strokes() === 0
      ? ok('and one fast swipe takes all of them, gaps between samples included')
      : fail('a fast swipe left ' + slate.strokes() + ' of 10 behind — the '
             + 'rubber is still testing points instead of the line between them');
  }

  // ...and rubbing out a word does not repaint the page.
  //
  // Every erase sample used to throw the whole cache away, so a page holding an
  // evening's proof repainted every stroke on it, several times a frame, for a
  // gesture that touched one word. That is the main thread gone, and from behind
  // a pen it reads as the surface answering late -- reported as a delay on
  // putting the pen down, "especially if I've just erased something", and as a
  // scroll that stutters just afterwards.
  {
    slate.tool('pen');
    slate.clear();
    // Sixty words, spread down a page far longer than the glass -- which is what
    // a worked exercise is. Only a few of them are anywhere near the rubber.
    const many = [];
    for (let i = 0; i < 60; i++) {
      many.push({ c: '#eee', w: 3,
                  pts: [[60, 60 + i * 90], [90, 60 + i * 90], [140, 70 + i * 90]] });
    }
    slate.load({ w: 1130, h: 60 * 90 + 200, strokes: many });
    await new Promise((r) => setTimeout(r, 5));

    // The SWEEP, measured before the pen comes off. That is the part that used to
    // cost a whole-page repaint per sample -- a Pencil sends four a frame -- and
    // it is the part a hand is waiting on. The lift is a separate frame and
    // rebuilds the cache once, which is not what anybody feels.
    //
    // Compared against a full repaint AT THE SAME VIEW. It used to be compared
    // against `fitInk`, which zooms out to frame the whole page: fine while the
    // cost of a repaint did not depend on the zoom, and not a comparison at all
    // now that it does -- see the thinning case below.
    slate.tool('erase');
    window.__paints = {};
    pen('pointerdown', 70, 70, 21);
    for (let i = 1; i <= 8; i++) pen('pointermove', 70 + i * 4, 70 + i, 21);
    await new Promise((r) => setTimeout(r, 20));
    const during = window.__paints.stroke || 0;
    const clipped = window.__paints.clip || 0;
    pen('pointerup', 104, 78, 21);
    await new Promise((r) => setTimeout(r, 20));

    slate.tool('pen');
    window.__paints = {};
    slate.relayout();
    await new Promise((r) => setTimeout(r, 20));
    const full = window.__paints.stroke || 0;

    // A clip is the repair: the rectangle the removed ink covered, painted over
    // with the paper and whatever else reaches into it. Counting STROKES here
    // would prove nothing -- a hole with no other ink in it has no strokes to
    // put back, which is the common case and was hidden before only because
    // this number used to include the pen coming off.
    clipped > 0
      ? ok('rubbing out repairs the rectangle it emptied (' + clipped + ' clip(s))')
      : fail('the erase sweep clipped nothing, so it is repainting the sheet');
    during * 3 < full
      ? ok('and not the rest of the page with it (' + during + ' line calls in '
           + 'the sweep, where a repaint of what is on screen is ' + full + ')')
      : fail('an erase sweep still costs a whole repaint (' + during + ' of '
             + full + ' line calls), which is the pause that was reported');

    // ---- zooming out is the one gesture the cull cannot help with ----------
    //
    // The visible box grows, so fewer strokes are off-screen, so a repaint that
    // drew a handful draws the lot -- and the view is baked into the cache, so
    // it did that on every frame of the pinch. Reported from the iPad:
    // "occasional glitching out/lagging on the writing board when I try to zoom
    // out. It was non responsive to my touch for a few seconds, and then it was
    // fine." The few seconds are the pinch.
    //
    // Two answers, and this is the first: the curve is resampled to about one
    // logical unit, so zoomed out to a quarter it carries four points per pixel
    // on the glass. Nothing is drawn finer than a pixel any more.
    window.__paints = {};
    slate.relayout();
    await new Promise((r) => setTimeout(r, 20));
    const atNatural = window.__paints.lineTo || 0;
    slate.zoom(0.2);
    await new Promise((r) => setTimeout(r, 30));
    window.__paints = {};
    slate.relayout();
    await new Promise((r) => setTimeout(r, 20));
    const zoomedOut = window.__paints.lineTo || 0;
    zoomedOut > 0 && zoomedOut < atNatural
      ? ok('a page drawn zoomed out costs less, not more (' + zoomedOut
           + ' line calls against ' + atNatural + ' at natural size)')
      : fail('zoomed out to a fifth the page costs ' + zoomedOut
             + ' line calls against ' + atNatural + ' at natural size: detail '
             + 'is being drawn finer than the screen can show it');

    // And the second answer: while two fingers are down, nothing is drawn at
    // all. The cache is blitted with the transform that carries the view it was
    // drawn at to the view now -- one `drawImage` a frame, whatever is on the
    // page -- and the crisp repaint happens once, when the fingers come off.
    slate.zoom(1);
    await new Promise((r) => setTimeout(r, 30));
    const twoDown = (a, b) => {
      [[41, 200, 200], [42, 400, 400]].forEach(([id, x, y]) => {
        const ev = new window.Event('pointerdown', { bubbles: true, cancelable: true });
        Object.assign(ev, { pointerId: id, pointerType: 'touch', pressure: 0,
                            clientX: x, clientY: y, isPrimary: id === 41 });
        doc.querySelector('#slate canvas.sl-sheet').dispatchEvent(ev);
      });
    };
    twoDown();
    window.__paints = {};
    slate.zoom(0.5);
    await new Promise((r) => setTimeout(r, 30));
    const mid = window.__paints.stroke || 0;
    const blits = window.__paints.drawImage || 0;
    mid === 0 && blits > 0
      ? ok('and a zoom with two fingers down draws no strokes at all, just the '
           + 'picture it already had (' + blits + ' blit(s))')
      : fail('a pinch frame repainted ' + mid + ' stroke(s) — the page is being '
             + 'redrawn under the gesture, which is the lag that was reported');

    [41, 42].forEach((id) => {
      const up = new window.Event('pointerup', { bubbles: true, cancelable: true });
      Object.assign(up, { pointerId: id, pointerType: 'touch', pressure: 0,
                          clientX: 300, clientY: 300, isPrimary: id === 41 });
      doc.querySelector('#slate canvas.sl-sheet').dispatchEvent(up);
    });
    await new Promise((r) => setTimeout(r, 30));
    (window.__paints.stroke || 0) > mid
      ? ok('and the fingers coming off is what pays for the crisp one')
      : fail('the page was never redrawn properly after the pinch, so it stays '
             + 'soft');

    slate.tool('pen');
    slate.clear();
  }

  // An undo step is the LIST of strokes, not a copy of the page.
  //
  // It used to be `JSON.stringify(page().strokes)`, taken on every pen lift and
  // on every touch of the rubber -- three hundred kilobytes of JSON built at the
  // exact moment a hand is asking the surface for something, and sixty of them
  // on the stack. Reported as the first stroke of the rubber being slow, and as
  // a general lateness in putting the pen down.
  //
  // What makes a shallow list correct is that a stroke on the page is never
  // changed in place, and that is what is actually checked here: erase, drag,
  // and then walk the undo stack back and see the working return.
  {
    slate.tool('pen');
    slate.clear();
    slate.load({ w: 1130, h: 900, strokes: [
      { c: '#eee', w: 3, pts: [[200, 200], [260, 200], [300, 240]] },
      { c: '#eee', w: 3, pts: [[200, 400], [260, 400], [300, 440]] },
    ] });
    await new Promise((r) => setTimeout(r, 10));

    // No copy of the page is made when the rubber goes down.
    const realStringify = window.JSON.stringify;
    let strung = 0;
    window.JSON.stringify = function () {
      strung++;
      return realStringify.apply(window.JSON, arguments);
    };
    slate.tool('erase');
    pen('pointerdown', 950, 950, 61);            // nowhere near the ink
    window.JSON.stringify = realStringify;
    pen('pointerup', 950, 950, 61);
    strung === 0
      ? ok('putting the rubber down copies nothing')
      : fail('the rubber still serialises the whole page before it has removed '
             + 'anything (' + strung + ' times), which is the pause reported on '
             + 'the first erase after switching tool');

    // And the undo it recorded still undoes.
    const before = slate.strokes();
    pen('pointerdown', 200, 200, 62);
    pen('pointermove', 300, 240, 62);
    pen('pointerup', 300, 240, 62);
    await new Promise((r) => setTimeout(r, 10));
    slate.strokes() < before
      ? ok('and the rubber still takes ink out')
      : fail('nothing was erased, so the undo below proves nothing');
    const undoBtn = slate.bar.querySelector('button[title="undo"]');
    undoBtn ? undoBtn.onclick() : fail('the toolbar has no undo button');
    await new Promise((r) => setTimeout(r, 10));
    slate.strokes() === before
      ? ok('undo brings the erased working back')
      : fail('undo restored ' + slate.strokes() + ' strokes of ' + before);
  }

  // ...and dragging a selection still undoes, which is the half that could go
  // silently wrong: a shallow undo step is only correct because nothing on the
  // page is ever changed in place. A drag that moved the very points an earlier
  // step is holding would leave that step "undoing" to the moved position, and
  // nothing about the screen would say so.
  {
    slate.tool('pen');
    slate.clear();
    slate.load({ w: 1130, h: 900, strokes: [
      { c: '#eee', w: 3, pts: [[300, 300], [340, 300], [380, 340], [300, 340]] },
    ] });
    await new Promise((r) => setTimeout(r, 10));
    const at = () => { const v = slate.view(); return (lx, ly) =>
      [lx * v.k + v.ox, ly * v.k + v.oy]; };
    const box0 = slate.pngBox();

    // A loop right round it.
    slate.tool('lasso');
    const to = at();
    const ring = [[240, 240], [440, 240], [440, 400], [240, 400], [240, 250]];
    let first = to(ring[0][0], ring[0][1]);
    pen('pointerdown', first[0], first[1], 71);
    for (const q of ring.slice(1)) {
      const xy = to(q[0], q[1]);
      pen('pointermove', xy[0], xy[1], 71);
    }
    pen('pointerup', first[0], first[1], 71);
    await new Promise((r) => setTimeout(r, 10));

    const grab = to(340, 320), drop = to(440, 320);
    pen('pointerdown', grab[0], grab[1], 72);
    pen('pointermove', drop[0], drop[1], 72);
    pen('pointerup', drop[0], drop[1], 72);
    await new Promise((r) => setTimeout(r, 10));
    const box1 = slate.pngBox();

    if (Math.abs(box1.x0 - box0.x0) < 20) {
      ok('drag not exercised in this harness (no selection was made)');
    } else {
      ok('a selection can be dragged');
      const undoBtn = slate.bar.querySelector('button[title="undo"]');
      undoBtn.onclick();
      await new Promise((r) => setTimeout(r, 10));
      Math.abs(slate.pngBox().x0 - box0.x0) < 2
        ? ok('and undo puts it back where it was, so the step it took is intact')
        : fail('undo left the selection at ' + Math.round(slate.pngBox().x0)
               + ' instead of ' + Math.round(box0.x0) + ': the drag moved the '
               + 'very points the undo step was holding');
    }
    slate.tool('pen');
    slate.clear();
  }

  // The nib leaves its mark on the frame the pen goes down.
  //
  // The curve needs three samples before it can produce a single point of
  // resampled line, and samples closer together than MIN_STEP are dropped -- so
  // a pen put down and moved slowly, which is how a letter starts, painted
  // nothing until it had travelled a pixel or two. The surface was silent while
  // the hand waited to see its own ink.
  {
    slate.tool('pen');
    slate.clear();
    await new Promise((r) => setTimeout(r, 20));
    window.__paints = {};
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (fn) => fn();
    pen('pointerdown', 300, 250, 31);
    window.requestAnimationFrame = realRaf;
    (window.__paints.arc || 0) > 0 || (window.__paints.stroke || 0) > 0
      ? ok('a pen put down marks the page before it has moved anywhere')
      : fail('nothing was painted until the pen moved, which is the delay that '
             + 'was reported on tapping to write');
    pen('pointerup', 300, 250, 31);
  }

  // A picture of the page is not encoded under a hand.
  //
  // `toPNG` repaints the whole page onto an offscreen canvas and PNG-encodes it,
  // and every save did it -- about a second after every stroke. It is the same
  // defect this repository already fixed in the annotation layer, in the place
  // where it costs more: a page holds four hundred strokes by the end of an
  // exercise, and the encode lands right about when a hand comes back to write.
  //
  // A send must still carry it: it is copied into live/answers/ as the frozen
  // answer, and that has to be what was handed in.
  {
    const bodies = [];
    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      if (/slate\/save/.test(String(u))) {
        bodies.push(JSON.parse(opts.body));
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, rev: 1 }) });
      }
      return new Promise(() => {});
    };
    const root4 = doc.createElement('div');
    doc.body.appendChild(root4);
    const s4 = window.Slate.create({ root: root4, compact: false });
    const sheet4 = root4.querySelector('canvas.sl-sheet');
    const pen4 = (type, x, y) => {
      const ev = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(ev, { pointerId: 51, pointerType: 'pen', pressure: 0.6,
                          clientX: x, clientY: y, isPrimary: true });
      ev.getCoalescedEvents = () => [ev];
      sheet4.dispatchEvent(ev);
    };
    await new Promise((r) => setTimeout(r, 10));

    pen4('pointerdown', 120, 120);
    for (let i = 0; i < 8; i++) pen4('pointermove', 120 + i * 7, 120 + i * 5);
    pen4('pointerup', 190, 165);
    await s4.save(false);                       /* the hand is still on the glass */
    const auto = bodies[bodies.length - 1];
    auto && !auto.png
      ? ok('an autosave under a hand carries the strokes and no picture')
      : fail('an autosave still encodes a picture of the whole page, which is '
             + 'the main thread the next stroke needed');
    auto && auto.strokes && auto.strokes.length === 1
      ? ok('and the strokes are what it carries, which is what a reload restores')
      : fail('an autosave carried no strokes');

    // ...and a scroll of the LESSON counts as a hand too. The board is part of a
    // page that scrolls with a finger, so "is a hand busy" cannot be answered
    // from the writing surface alone. Reported as scrolling up to read earlier
    // replies being laggy just after writing.
    await new Promise((r) => setTimeout(r, 2600));      /* the pen goes stale */
    bodies.length = 0;
    window.dispatchEvent(new window.Event('scroll'));
    await s4.save(false);
    const scrolled = bodies[bodies.length - 1];
    scrolled && !scrolled.png
      ? ok('and a page being scrolled defers it as surely as a pen does')
      : fail('a picture is still encoded in the middle of a scroll');

    await s4.save(true);
    const sent = bodies[bodies.length - 1];
    sent && sent.send && sent.png
      ? ok('and a send carries the picture, because it is frozen as the answer')
      : fail('a send no longer carries the picture that becomes the answer');
    window.fetch = realFetch;
  }

  // The paper is remembered, because every board on the page is drawn with it.
  //
  // It was not, and a reload therefore repainted a whole sitting in the other
  // scheme: the live surface and a dozen photographs of past boards, all of them
  // the paper this was last set to. Reported from the iPad as boards whose
  // "color is inverted".
  {
    window.localStorage.setItem('tutor-board.slate.paper', 'white');
    window.localStorage.setItem('tutor-board.slate.rule', 'lines');
    const root5 = doc.createElement('div');
    doc.body.appendChild(root5);
    const s5 = window.Slate.create({ root: root5, compact: false });
    s5.paper() === 'white/lines'
      ? ok('a reload comes back on the paper it was left on')
      : fail('the paper was forgotten (' + s5.paper() + '), so every board on '
             + 'the page is drawn in the other scheme after a reload');
    root5.dataset.paper === 'white'
      ? ok('and the chrome around it agrees')
      : fail('the surface and its chrome disagree about the paper');
    window.localStorage.removeItem('tutor-board.slate.paper');
    window.localStorage.removeItem('tutor-board.slate.rule');
  }

  // A pen is never a palm, whatever its id says. Pointer ids are small integers
  // and the platform reuses them, so a palm's id -- especially one whose lift the
  // surface never saw, and which is therefore still in the map -- comes back
  // attached to the Pencil. The lift handler then returned early and the stroke
  // that had just been written was never committed: a mark that appears under the
  // nib and is gone by the time the hand moves.
  {
    slate.finger('scroll');
    slate.tool('pen');
    slate.clear();
    // Strand a palm on id 77, by letting a touch land while the pen is at work
    // and never lifting it.
    pen('pointerdown', 100, 100, 77);
    pen('pointermove', 130, 130, 77);
    pen('pointerup', 130, 130, 77);
    touch('pointerdown', 600, 400, 77);       // judged a palm: the pen just went
    // ...and no pointerup for it, ever.

    const n0 = slate.strokes();
    pen('pointerdown', 200, 200, 77);         // the same id, now a Pencil
    for (let i = 1; i <= 12; i++) pen('pointermove', 200 + i * 9, 200 + i * 4, 77);
    pen('pointerup', 308, 248, 77);
    slate.strokes() === n0 + 1
      ? ok('a pen stroke on a recycled palm id is still committed')
      : fail('the stroke was thrown away because its id had once been a hand');
  }

  // Ink must not be lost to two saves racing each other to the disk.
  {
    const js = fs.readFileSync(path.join(WEB, 'slate-core.js'), 'utf8');
    /if \(saving\)/.test(js)
      ? ok('only one save is ever on the wire')
      : fail('overlapping autosaves can still land out of order, and the older '
             + 'one wins');
    /\(pageSeq\[idx\] \|\| 0\) === at/.test(js)
      ? ok('and a save only clears a page if THAT page did not change while it flew')
      : fail('a stale save can report "saved" and stop the next one happening');
  }

  // And a save is for a PAGE, not for "whichever page is in hand when the wire
  // frees up".
  //
  // Reported as "my writing didn't get saved when a new board came up". The
  // board moves the page on its own now -- an attempt freezing and its successor
  // opening is a page switch that arrives on a payload, in the middle of
  // somebody writing -- and a switch while a save was in flight left the page
  // being LEFT with nothing to carry its last strokes: the queued save that
  // followed built its body from the new current page, and the old one kept
  // whatever it had the time before.
  //
  // A surface of its own, because the one above has a save in the air already
  // (this file's fetch never resolves, which is exactly a board on a dead link).
  {
    const sent = [];
    let release = null;
    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      if (/slate\/save/.test(String(u))) {
        sent.push(JSON.parse(opts.body));
        return new Promise((res) => {
          release = () => res({ json: () => Promise.resolve({ ok: true }) });
        });
      }
      return new Promise(() => {});
    };
    const root2 = doc.createElement('div');
    doc.body.appendChild(root2);
    const s2 = window.Slate.create({ root: root2, compact: false });
    const sheet2 = root2.querySelector('canvas.sl-sheet');
    const pen2 = (type, x, y, id) => {
      const ev = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(ev, { pointerId: id, pointerType: 'pen', pressure: 0.6,
                          clientX: x, clientY: y, isPrimary: true });
      ev.getCoalescedEvents = () => [ev];
      sheet2.dispatchEvent(ev);
    };
    const draw = (id, y) => {
      pen2('pointerdown', 120, y, id);
      for (let i = 0; i < 8; i++) pen2('pointermove', 120 + i * 7, y + i * 5, id);
      pen2('pointerup', 190, y + 45, id);
    };

    draw(41, 120);
    s2.save(false);                          // one on the wire, unresolved
    draw(42, 300);                           // and more ink while it is up there

    const before = sent.length;
    s2.fresh(true);                          // the page moves under them
    s2.at() === 2
      ? ok('a new page can open while a save is still in the air')
      : fail('the page did not move (at ' + s2.at() + ')');

    await new Promise((r) => setTimeout(r, 5));
    sent.length === before
      ? ok('and nothing else goes on the wire while one is on it')
      : fail('two saves are in flight at once again');

    release();
    await new Promise((r) => setTimeout(r, 30));

    const followed = sent[sent.length - 1];
    followed && followed.page === 1
      ? ok('the save that follows is for the page that was LEFT, by number')
      : fail('the queued save carried page ' + (followed && followed.page)
             + ' — the page moved to — so the page written on kept an older '
             + 'version of itself, which is ink lost');
    followed && followed.strokes.length === 2
      ? ok('and it carries everything written on it, the late strokes included')
      : fail('the strokes made while a save was in flight never reached disk ('
             + (followed && followed.strokes.length) + ')');
    window.fetch = realFetch;
  }

  // A save the network refused must not become a permanent label.
  //
  // Reported from the board: "I also see an 'offline' next to the send button.
  // What gives? It says claude listening at the top." The board had been
  // flickering; one save fell into the gap; and the tag beside the send button
  // said `offline` for the rest of the sitting -- while the page still owed the
  // disk its strokes and nothing anywhere was retrying. The word was wrong, it
  // never cleared, and the ink behind it was genuinely not saved.
  {
    const tries = [];
    let refuse = true;
    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      if (/slate\/save/.test(String(u))) {
        tries.push(JSON.parse(opts.body));
        if (refuse) return Promise.reject(new Error('no route to host'));
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, rev: 1 }) });
      }
      return new Promise(() => {});
    };
    const root3 = doc.createElement('div');
    doc.body.appendChild(root3);
    const s3 = window.Slate.create({ root: root3, compact: false });
    const sheet3 = root3.querySelector('canvas.sl-sheet');
    const tag = () => root3.querySelector('.sl-saved').textContent;
    const pen3 = (type, x, y, id) => {
      const ev = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(ev, { pointerId: id, pointerType: 'pen', pressure: 0.6,
                          clientX: x, clientY: y, isPrimary: true });
      ev.getCoalescedEvents = () => [ev];
      sheet3.dispatchEvent(ev);
    };
    pen3('pointerdown', 120, 120, 71);
    for (let i = 0; i < 6; i++) pen3('pointermove', 120 + i * 7, 120 + i * 5, 71);
    pen3('pointerup', 170, 160, 71);

    await s3.save(false);
    await new Promise((r) => setTimeout(r, 5));
    /^not saved/.test(tag())
      ? ok('a refused save says it is retrying, not that the board is offline')
      : fail('the tag beside the send button reads "' + tag() + '"');

    const afterFirst = tries.length;
    await new Promise((r) => setTimeout(r, 1400));
    tries.length > afterFirst
      ? ok('and it actually retries rather than leaving the ink where it is')
      : fail('nothing retried; the strokes are still only in the browser');

    refuse = false;
    await new Promise((r) => setTimeout(r, 2600));
    tag() === 'saved'
      ? ok('and the moment one lands, the label clears itself')
      : fail('the label stayed at "' + tag() + '" after a save succeeded');
    window.fetch = realFetch;
  }

  // The board asks the surface whether a hand is mid-answer before it moves the
  // page. A surface that cannot answer is a page that scrolls under a pen.
  typeof slate.busy === 'function'
    ? ok('and the surface can say whether a hand is in the middle of something')
    : fail('nothing can ask the slate whether it is being written on');

// ------------------------------------------- opening a page frames the writing
//
// Reported as work having disappeared: the boards were still there and every
// one of them was empty. Nothing had been lost — the page held 537 strokes and
// was still saving — and that is the point. The surface is a plane. You pan
// down and carry on, the page box grows to hold what you wrote, and on a real
// page of an evening's homework the ink began 769 units down a box 1514 tall.
//
// `fitPage` parked the view at the top of the box, "where the writing begins",
// which is true of a fresh page and false of every page anyone has worked down.
// So opening that page showed a screenful of blank paper with the working below
// the fold — and a dormant board, which is a photograph and has nobody to pan
// it, showed blank paper and nothing else.
{
  const far = { w: 1130, h: 1514, strokes: [
    { c: '#eee', w: 2, pts: [[200, 900], [400, 900], [400, 1100]] },
    { c: '#eee', w: 2, pts: [[200, 1300], [600, 1320]] },
  ] };
  slate.load(far);

  const box = slate.inkBox();
  box && box.y0 > 800
    ? ok('a page can have its writing far below the top of its box')
    : fail('the fixture does not reproduce the shape that caused this');

  const v = slate.view();
  const topShown = -v.oy / v.k;             // the page-y sitting at the top edge
  const bottomShown = topShown + H / v.k;
  topShown > 700 && topShown <= box.y0
    ? ok('and opening it parks the view on the writing, not above it')
    : fail('the page opens on blank paper with the working below the fold '
           + '(showing ' + Math.round(topShown) + '..' + Math.round(bottomShown)
           + ', ink at ' + Math.round(box.y0) + ')');
  bottomShown > box.y0
    ? ok('so the first thing on the page is actually on screen')
    : fail('nothing written is inside the opened view');

  // The scale is not what changed. Handwriting comes out the size it was
  // written at because the page WIDTH sets the zoom, and that is tested for its
  // own reasons in test/sizing.js — framing must not quietly start zooming.
  Math.abs(v.k - W / far.w) < 1e-9
    ? ok('and the zoom is still the page width, so nothing is resized')
    : fail('framing the ink changed the writing scale, which it must not');

  // The photograph is framed the same way, because it stands for the same page.
  window.__transforms.length = 0;
  const url = slate.preview(1, 900, 500);
  const drew = window.__transforms[0] || null;
  url ? ok('a dormant board still gets a picture')
      : fail('no preview was produced at all');
  drew ? ok('drawn through a transform, which is what says where it looked')
       : fail('the preview drew nothing at all');
  if (drew) {
    const top = -drew.oy / drew.k;
    top > 700 && top <= box.y0
      ? ok('and the picture is of the writing, not of the paper above it')
      : fail('the board shows an empty band above the ink, which reads as work '
             + 'that has been lost (showing from ' + Math.round(top)
             + ', ink at ' + Math.round(box.y0) + ')');
  }

  // A page written from the top is unaffected: it frames from the top, as it
  // always did, because that is where its ink is.
  slate.load({ w: 1130, h: 1514, strokes: [
    { c: '#eee', w: 2, pts: [[100, 40], [300, 60]] },
  ] });
  const v2 = slate.view();
  -v2.oy / v2.k < 40
    ? ok('and a page written from the top still opens at the top')
    : fail('an ordinary page now opens somewhere other than its first line');
}

  console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                            : '\nthe surface is a plane, and a finger is not a pen');
  window.close();
  process.exit(errors.length ? 1 : 0);
})();
