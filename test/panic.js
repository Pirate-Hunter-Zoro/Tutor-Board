// The way back, from anywhere.
//
// The writing surface is capped so that pinch-zooming the page cannot make it
// swallow the glass. A cap is a guess at a number, though, and being wrong
// about it strands somebody mid-proof with nothing to pinch on and no way out
// but quitting the app. The button is the part that does not depend on the
// guess being right, which is why it is worth a file of its own.
//
// Two things here are easy to get wrong and impossible to see in a screenshot:
//
//   1. `position: fixed` is fixed to the LAYOUT viewport. Pinching moves the
//      VISUAL one. A control placed by CSS alone therefore slides off the glass
//      at exactly the moment it is needed, and looks perfect in every test that
//      never zooms.
//   2. A tap on a tablet always travels a few pixels. Telling a tap from a drag
//      by distance means the button sometimes moves when it was meant to act,
//      and sometimes acts when it was meant to move. It is told by time.

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

window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, { get: () => () => {}, set: () => true });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 800 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 600 });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 800, height: 40, right: 800, bottom: 40, x: 0, y: 0 };
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
window.EventSource = function () {
  this.readyState = 1; this.close = function () {}; this.addEventListener = function () {};
};

const scrolls = [];
window.scrollTo = function (a, b) {
  scrolls.push(typeof a === 'object' && a ? a.top : b);
};

// jsdom has no visual viewport, which is the whole subject here, so stand one
// up that can be zoomed and panned on demand.
const vv = new window.EventTarget();
vv.width = 800; vv.height = 600; vv.offsetLeft = 0; vv.offsetTop = 0; vv.scale = 1;
Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
// Placement is coalesced to one per animation frame — this fires on every scroll
// event, and a forced layout per scroll frame is how a page that is merely
// scrolling starts to stutter. So a zoom has to be given a frame to land in.
const zoomTo = async (scale, offsetLeft, offsetTop) => {
  vv.scale = scale;
  vv.width = 800 / scale;
  vv.height = 600 / scale;
  vv.offsetLeft = offsetLeft;
  vv.offsetTop = offsetTop;
  vv.dispatchEvent(new window.Event('resize'));
  await sleep(10);
};

window.addEventListener('error', (e) => fail('uncaught: ' + e.message));

for (const f of ['typeface.js', 'macros.js', 'slate-core.js', 'annotate.js']) {
  try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
  catch (e) { fail(f + ': ' + e.message); }
}
try { window.eval(fs.readFileSync(path.join(WEB, 'board.js'), 'utf8')); }
catch (e) { fail('board.js: ' + e.message); }

const doc = window.document;
const btn = doc.getElementById('panic');
const meta = doc.querySelector('meta[name="viewport"]');
const metaWas = meta && meta.getAttribute('content');

const at = () => {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/
    .exec(btn.style.transform || '');
  return m ? { x: +m[1], y: +m[2], k: +m[3] } : null;
};
const press = (type, x, y) => btn.dispatchEvent(
  new window.MouseEvent(type, { bubbles: true, clientX: x || 0, clientY: y || 0 }));

(async function () {
  if (!btn) {
    fail('there is no way back: the board has no re-centre button at all');
    console.log('\n' + errors.length + ' FAILURES');
    process.exit(1);
  }
  ok('the board carries a re-centre button');

  // 1. Always there. Not conditional on a mode, a card, or an answer being owed
  //    — the state it exists to rescue you from is one you can reach at any
  //    moment, including one where nothing else on the page can be reached.
  !btn.hidden ? ok('and it is present without being asked for')
              : fail('the button starts hidden, so it is not there when it is needed');
  {
    const js = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
    !/els\.panic\.hidden\s*=/.test(js)
      ? ok('and nothing in the board ever takes it away')
      : fail('something hides the button; the one guarantee is then conditional');
  }

  // 2. It is placed against the visual viewport, not by CSS.
  const first = at();
  first ? ok('it is placed from JavaScript: ' + btn.style.transform)
        : fail('nothing positioned the button — CSS alone cannot follow a pinch');

  // 3. Zoom the page in and pan to the far corner. This is the state that
  //    stranded a person: everything fixed by CSS is now off the glass.
  await zoomTo(2, 300, 200);
  const zoomed = at();
  if (!zoomed) {
    fail('the button lost its position when the page was zoomed');
  } else {
    Math.abs(zoomed.k - 0.5) < 0.001
      ? ok('zoomed to 2×, it counter-scales to 0.5 and stays a thumb wide')
      : fail('the button scales with the page: at 2× it is drawn at ' + zoomed.k);
    zoomed.x >= vv.offsetLeft && zoomed.x <= vv.offsetLeft + vv.width &&
    zoomed.y >= vv.offsetTop && zoomed.y <= vv.offsetTop + vv.height
      ? ok('and it followed the visible window into the corner it was panned to')
      : fail('the button sits at ' + zoomed.x + ',' + zoomed.y + ' — outside the '
             + 'visible window at ' + vv.offsetLeft + ',' + vv.offsetTop);
    zoomed.x !== first.x || zoomed.y !== first.y
      ? ok('which is to say it moved when the page did')
      : fail('the button did not move at all; it is pinned to the layout');
  }

  // 4. A tap. It travels a couple of pixels, as every tap on a tablet does,
  //    and it must still be a tap.
  scrolls.length = 0;
  press('pointerdown', 400, 300);
  press('pointermove', 402, 303);
  press('pointerup', 402, 303);

  // It is a zoom control and nothing else. Being zoomed too far into the writing
  // is not the same as being in the wrong part of the transcript, and answering
  // the first with the second takes the page away from somebody who was looking
  // at exactly the right thing.
  !scrolls.length
    ? ok('a tap leaves the lesson exactly where it was')
    : fail('the button scrolled the page; it is a zoom control, not a jump');
  btn.classList.contains('hit')
    ? ok('and says out loud that it did something, since a change of scale is '
         + 'easy to miss')
    : fail('a tap gave no sign at all that it had been received');
  !btn.classList.contains('holding')
    ? ok('and a tap that travelled three pixels was not mistaken for a drag')
    : fail('the button was picked up by a tap; distance is being used to decide');

  const during = meta && meta.getAttribute('content');
  /maximum-scale=1/.test(during || '')
    ? ok('and it asks the browser to drop the magnification')
    : fail('nothing attempts to undo the page zoom: ' + during);

  // The clamp must be temporary. A board that can never be zoomed in again is a
  // worse outcome than the one this fixes.
  await sleep(650);
  meta.getAttribute('content') === metaWas
    ? ok('and lifts the clamp again, so the page can still be zoomed by hand')
    : fail('the viewport was left clamped: ' + meta.getAttribute('content'));

  // 5. Findable. It is a rescue, and the state it rescues you from is one where
  //    the screen is already full of something else — so it carries its own name
  //    and the board's accent rather than being a dim circle in a corner.
  {
    /re-cent/i.test(btn.textContent)
      ? ok('the button says what it does')
      : fail('the button is unlabelled: ' + JSON.stringify(btn.textContent));
    const css = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
    // The rule is shared with the surface's own re-centre, which is the same
    // control for the other zoom on this page.
    const rule = (css.match(/#panic(?:,\s*#findink)?\s*\{[^}]*\}/) || [''])[0];
    /background:\s*var\(--accent\)/.test(rule)
      ? ok('and is painted in the accent, not in the page it sits on')
      : fail('the button has no contrasting fill; it reads as a smudge');

    // 5b. There are two zooms on this page and only one of them had a way back.
    //     `#panic` puts the PAGE's magnification back; the writing surface has a
    //     zoom of its own that it knows nothing about, and getting lost in that
    //     one left the toolbar's ⤢ as the only way out — in the page chrome,
    //     which is exactly what pinching pans off the glass.
    const find = doc.getElementById('findink');
    find
      ? ok('the writing surface has a re-centre of its own')
      : fail('there is no way back from a zoom into the writing');
    find && /writing/i.test(find.textContent)
      ? ok('and it says which of the two it is')
      : fail('the two re-centres are not tellable apart');
    find && find.hidden
      ? ok('and is absent while there is no surface to be lost on')
      : fail('a button offering to find writing on a board that is not there');
    /#panic,\s*#findink\s*\{[^}]*position:\s*fixed/.test(css)
      ? ok('and is placed by script against the visible window, as the other is')
      : fail('the second button is laid out by CSS alone, so a pinch takes it '
             + 'off the glass at the moment it is wanted');
    const js = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
    /els\.findink\.style\.transform/.test(js)
      ? ok('and rides under the first, so there is one thing to move')
      : fail('nothing ever positions it');
    !/opacity:\s*0?\.[0-8]/.test(rule)
      ? ok('and is not dimmed away')
      : fail('the button is still faded out at rest');
  }

  // 6. A press and hold picks it up, and where it is put is where it stays.
  await zoomTo(1, 0, 0);
  const before = at();
  scrolls.length = 0;
  try { window.localStorage.removeItem('board.panic'); } catch (e) {}

  press('pointerdown', 600, 200);
  await sleep(500);
  btn.classList.contains('holding')
    ? ok('a press and hold picks the button up, and says so before it moves')
    : fail('holding the button does nothing; there is no way to get it out of the way');

  press('pointermove', 120, 480);
  const moved = at();
  moved && (moved.x !== before.x || moved.y !== before.y)
    ? ok('and it follows the finger across the screen')
    : fail('the button was held but would not move');

  press('pointerup', 120, 480);
  !btn.classList.contains('holding')
    ? ok('letting go puts it down')
    : fail('the button is still being held after the finger left');
  !scrolls.length
    ? ok('and moving it is not also a tap, so nothing jumped underneath it')
    : fail('the drag re-centred the board as well — every move is now a surprise');

  let stored = null;
  try { stored = JSON.parse(window.localStorage.getItem('board.panic') || 'null'); }
  catch (e) { /* reported below */ }
  stored && typeof stored.x === 'number'
    ? ok('where it was put is remembered, so it is not re-placed every session')
    : fail('the position is not saved; the button walks home on every reload');
  stored && stored.x >= 0 && stored.x <= 1 && stored.y >= 0 && stored.y <= 1
    ? ok('and remembered as a fraction of the window, so a rotation keeps it on screen')
    : fail('the position was saved in pixels: ' + JSON.stringify(stored));

  // 7. Wherever it is put, it stays on the glass. A control dragged to the very
  //    edge and then met with a rotation or a zoom must not end up half off it.
  window.localStorage.setItem('board.panic', JSON.stringify({ x: 1, y: 1 }));
  await zoomTo(3, 500, 400);
  const corner = at();
  const bw = (btn.offsetWidth || 108) / 3, bh = (btn.offsetHeight || 32) / 3;
  corner && corner.x + bw <= vv.offsetLeft + vv.width + 1 &&
            corner.y + bh <= vv.offsetTop + vv.height + 1
    ? ok('pushed into the corner it is still wholly on the glass')
    : fail('the button can be pushed past the edge of the visible window');

  console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                            : '\nthere is always a way back');
  process.exit(errors.length ? 1 : 0);
})();
