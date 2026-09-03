// The lesson, photographed by the thing that drew it.
//
// Asked for from the iPad, about the export that already existed: "for the
// tutor session export, I don't want the latex dump it currently gives; I want
// it as if it were a screenshot of the entire iPad screen scrolled down over the
// whole tutoring session."
//
// jsdom has no rasteriser, so this does not check that a card comes out looking
// like a card -- nothing short of the device can. What it checks is every rule
// the rasteriser depends on, and each one is a rule that fails silently:
//
//   - THE SELECTOR REWRITE. The clone cannot be a document, so `body`, `html`
//     and `:root` all have to become the wrapper or the whole lesson comes out
//     unstyled -- with the reading face gone, the paper white and the cards
//     invisible. And `.card .body` must NOT be rewritten, or the tutor's prose
//     inherits the page's own rules and every card is the height of a page.
//   - WHAT IS PHOTOGRAPHED. Anything not on the glass has a rectangle of zeros
//     and would come out as a blank page.
//   - AND THE FALLBACK. `shot.js` is a separate deferred file. A board that
//     opened from a cache without it must fall back to the typeset export
//     rather than throw on a tap.

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
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 700, height: 220, right: 700, bottom: 220, x: 0, y: 0 };
};

try {
  window.eval(fs.readFileSync(path.join(WEB, 'shot.js'), 'utf8'));
  ok('loaded shot.js');
} catch (e) {
  fail('shot.js: ' + e.message);
}

const Shot = window.TutorShot;
if (!Shot) {
  fail('shot.js exposes nothing, so the board has nothing to photograph with');
  console.log('\n' + errors.length + ' FAILURES');
  process.exit(1);
}

// --- the selector rewrite ----------------------------------------------------
//
// Every case here is a real selector out of board.css or typeface.css, and each
// one decides something visible. `body[data-face="serif"]` is the reading face;
// `:root` is the entire palette; `body.annotating .card` is what a marked-up
// card looks like.
const REWRITES = [
  ['body', '.tb-shot', 'the page itself'],
  [':root', '.tb-shot', 'the palette'],
  ['html', '.tb-shot', 'the root element'],
  ['body[data-face="serif"]', '.tb-shot[data-face="serif"]', 'the reading face'],
  ['body.annotating .card', '.tb-shot.annotating .card', 'a marked-up card'],
  ['body .card, body .mine', '.tb-shot .card, .tb-shot .mine', 'a list of both'],
  ['body > #board', '.tb-shot > #board', 'a child combinator'],
  ['body.tools-out .annbar', '.tb-shot.tools-out .annbar', 'a state class'],
];
for (const [from, want, what] of REWRITES) {
  const got = Shot.rootward(from);
  got === want
    ? ok(`${what}: ${from} → ${got}`)
    : fail(`${from} became ${got} rather than ${want}, so ${what} is lost`);
}

// AND WHAT MUST SURVIVE UNTOUCHED. `.body` is the tutor's prose inside a card
// and it is the one that would break silently: rewrite it and every card's text
// inherits the rules written about the page.
const KEEP = [
  '.card .body',
  '.body',
  '.card-body',
  '#somebody',
  '.mine .text',
  '.pushed-get:disabled',
  '.busy-dot',
];
for (const sel of KEEP) {
  const got = Shot.rootward(sel);
  got === sel
    ? ok(`and ${sel} is left exactly as it is`)
    : fail(`${sel} was rewritten to ${got} — a class that merely contains the `
           + 'word was mistaken for the element');
}

// --- the scoping -------------------------------------------------------------
//
// Every selector goes under the wrapper, and that is what lets the same
// stylesheet be attached to the LIVE document to measure with. Unscoped, a
// `<style>` in the body would restyle the lesson the student is reading while
// the export runs -- and, worse, the measurement and the render would be two
// different stylesheets over the same nodes, which is how a picture ends up
// somewhere other than its box.
const SCOPES = [
  ['.card', '.tb-shot .card'],
  ['body', '.tb-shot'],
  [':root', '.tb-shot'],
  ['body .card', '.tb-shot .card'],
  ['.card, .mine', '.tb-shot .card, .tb-shot .mine'],
  ['#board', '.tb-shot #board'],
];
for (const [from, want] of SCOPES) {
  const got = Shot.scope(from);
  got === want
    ? ok(`scoped: ${from} → ${got}`)
    : fail(`${from} scoped to ${got} rather than ${want}`);
}
// And never twice: a rule already about the page must not become a descendant
// of itself, or the palette stops applying to the wrapper that carries it.
Shot.scope('body') === '.tb-shot' && Shot.scope(':root') === '.tb-shot'
  ? ok('and a rule about the page is the wrapper, not a child of it')
  : fail('the page\'s own rules were scoped under the wrapper, so they never match');

// --- rem, and the viewport ---------------------------------------------------
//
// FOUND BY RENDERING A PAGE AND LOOKING AT IT, which is the only way it could
// have been. `rem` is the font size of the DOCUMENT ROOT, and the fragment in a
// `foreignObject` has no `<html>` -- so every `rem` in the sheet resolved to the
// initial 16px instead of the board's 18. `.mine { max-width: 32rem }` came out
// an eighth narrow, which moved every right-aligned student turn sixty-three
// pixels and left the handwriting drawn into it outside its own box.
//
// The board's own numbers, stated: `--fs: 18px` on :root, and a window the
// shape of the iPad this is read on. A test whose expectations came from the
// harness's defaults would pass against a conversion that ignored the root
// entirely, which is the bug.
{
  window.document.documentElement.style.fontSize = '18px';
  for (const [k, v] of [['innerWidth', 1024], ['innerHeight', 1366]]) {
    Object.defineProperty(window, k, { value: v, configurable: true });
  }
  const px = (s) => Shot.unitsToPx(s);

  Shot.unitsToPx('a{margin:1rem}') === 'a{margin:18px}'
    ? ok('the conversion reads the root the page actually has (18px)')
    : fail('the conversion ignored the root font size: '
           + Shot.unitsToPx('a{margin:1rem}'));
  const cases = [
    ['a{margin:1.6rem}', 'a{margin:28.8px}', 'a length in rem'],
    ['a{max-width:32rem}', 'a{max-width:576px}', 'the width that moved the turns'],
    ['a{padding:.6rem .9rem}', 'a{padding:10.8px 16.2px}', 'a shorthand'],
    ['a{margin:-.5rem}', 'a{margin:-9px}', 'a negative length'],
    ['a{width:50vw}', 'a{width:512px}', 'a viewport width'],
    ['a{height:74svh}', 'a{height:1010.84px}', 'the small-viewport height the slate uses'],
    ['a{color:red}', 'a{color:red}', 'and nothing else is touched'],
  ];
  for (const [inp, want, what] of cases) {
    const got = px(inp);
    got === want ? ok(`${what}: ${inp} → ${got}`)
                 : fail(`${inp} became ${got} rather than ${want}`);
  }

  // AND NOT INSIDE A url(). This cost an afternoon and produced a lesson in a
  // system sans with the rules after the font silently dropped: the bundle
  // carries every font inlined as base64, and base64 is full of things that
  // look exactly like a length -- a digit, one of these unit names, then a
  // non-word character, which is a word boundary.
  // The payload is a real false positive, not merely a long string: `4rem+`
  // and `9vh/` are each a digit, a unit name, and then a non-word character,
  // which is exactly what a word boundary is. Without the guard both are
  // rewritten and the font is no longer a font.
  const PAYLOAD = 'd09GMgABAAAA4rem+Tk9vh/wAB8=';
  const FONT = '@font-face{font-family:"OpenDyslexic";'
    + 'src:url(data:font/woff2;base64,' + PAYLOAD + ') format("woff2")}';
  px(FONT).indexOf(PAYLOAD) !== -1
    ? ok('and a base64 font containing "4rem+" and "9vh/" is left byte for byte')
    : fail('the unit conversion rewrote the middle of a font file: ' + px(FONT));

  const QUOTED = 'a{background:url("x-3rem-y.png")}';
  px(QUOTED) === QUOTED
    ? ok('nor a quoted url that happens to contain one')
    : fail('a quoted url was rewritten: ' + px(QUOTED));

  // A length either side of a url has to survive, or the guard would be a way
  // of skipping half the sheet.
  px('a{margin:1rem;background:url(f.woff2);padding:2rem}')
    === 'a{margin:18px;background:url(f.woff2);padding:36px}'
    ? ok('and a length either side of a url is still converted')
    : fail('the url guard swallowed the declarations around it: '
           + px('a{margin:1rem;background:url(f.woff2);padding:2rem}'));
}

// --- object-fit --------------------------------------------------------------
//
// Every dormant board -- which is to say every past answer -- is
// `object-fit: cover; object-position: top left`. Stretching one to its box
// instead squashes an evening's working.
{
  // A tall picture in a wide box: cover crops its height, anchored at the top.
  const tall = Shot.fitBox('cover', 'top left',
                           { x: 0, y: 0, w: 400, h: 200 }, { w: 500, h: 1000 });
  Math.abs(tall.sh - 250) < 0.01 && tall.sy === 0 && tall.sw === 500
    ? ok('cover from the top left crops the source, and crops it from the top')
    : fail('cover gave ' + JSON.stringify(tall));

  const centred = Shot.fitBox('cover', '50% 50%',
                              { x: 0, y: 0, w: 400, h: 200 }, { w: 500, h: 1000 });
  Math.abs(centred.sy - 375) < 0.01
    ? ok('and centred cover takes the middle of it instead')
    : fail('centred cover gave ' + JSON.stringify(centred));

  const stretched = Shot.fitBox('fill', '50% 50%',
                                { x: 7, y: 9, w: 400, h: 200 }, { w: 500, h: 1000 });
  stretched.sw === 500 && stretched.sh === 1000
    && stretched.bw === 400 && stretched.bh === 200
    && stretched.bx === 7 && stretched.by === 9
    ? ok('and fill, which is the default, uses all of it and all of the box')
    : fail('fill gave ' + JSON.stringify(stretched));

  const held = Shot.fitBox('contain', '50% 50%',
                           { x: 0, y: 0, w: 400, h: 400 }, { w: 800, h: 400 });
  Math.abs(held.bh - 200) < 0.01 && Math.abs(held.by - 100) < 0.01
    ? ok('and contain insets the destination rather than cropping the picture')
    : fail('contain gave ' + JSON.stringify(held));
}

// --- the wrapper's own box ---------------------------------------------------
//
// ALSO FOUND BY RENDERING. The wrapper carries body's classes and attributes so
// the reading face and the palette are the page's own -- which means body's own
// rules land on it, and board.css says `body { min-height: 100vh }` so there is
// something to paint the bottom of a screen with. Converted to pixels, that made
// every single card exactly one page tall: a seven-page document for four cards,
// each floating at the top of a sheet of empty paper.
{
  const box = Shot.boxStyle(792, '--paper:#111;');
  const has = (prop, want) =>
    new RegExp('(^|;)\\s*' + prop + '\\s*:\\s*' + want + '\\s*(;|$)').test(box);
  has('height', 'auto') && has('min-height', '0') && has('max-height', 'none')
    ? ok('the wrapper states its height, and states all three of them')
    : fail('the wrapper does not override body\'s min-height, so every block '
           + 'becomes a full page: ' + box);
  has('min-width', '0') && has('max-width', 'none')
    ? ok('and its width the same way, for the same reason')
    : fail('the wrapper leaves a max-width to the stylesheet: ' + box);
  /^display:block;/.test(box) && /overflow:hidden/.test(box)
    ? ok('and it establishes a formatting context, so a card\'s top margin '
         + 'stays inside the box that was measured')
    : fail('the wrapper does not contain its children\'s margins: ' + box);
  box.indexOf('width:792px') !== -1 && box.indexOf('--paper:#111;') !== -1
    ? ok('and the column width and the pinned palette are both on it')
    : fail('the wrapper lost the width or the palette: ' + box);
}

// --- nothing animates in a still ---------------------------------------------
//
// `.card.fresh { animation: rise .28s ease-out both }` with
// `@keyframes rise { from { opacity: 0 } }`. Nothing animates inside an SVG
// loaded as an image, and `both` means it renders the FIRST frame -- so a card
// that had just arrived would export transparent. The newest thing the tutor
// wrote is the likeliest thing anybody exports.
/animation:\s*none\s*!important/.test(Shot.STILL)
  && /transition:\s*none\s*!important/.test(Shot.STILL)
  ? ok('a still refuses every animation and every transition')
  : fail('an entrance animation would export at its first frame, which for a '
         + 'fresh card is opacity 0: ' + Shot.STILL);
/\.tb-shot\s*\*/.test(Shot.STILL)
  ? ok('and refuses them for everything inside the lesson, not just the wrapper')
  : fail('only the wrapper is held still: ' + Shot.STILL);

// --- the SVG asks for its own size and no more -------------------------------
//
// The obvious worry is that a photograph comes out soft on a retina tablet, and
// the obvious answer -- ask the SVG for twice the pixels -- is the one that must
// not be taken. Measured in WebKit both ways it can be done, a
// `transform="scale(2)"` on a wrapping group and a viewBox smaller than the
// width and height: both rasterise at the right size and both LOSE KATEX. Every
// display formula and every radical sign came out blank while the prose around
// them was perfect, so it reads on the device as "the mathematics is missing"
// and as nothing else at all.
//
// It is also unnecessary. WebKit re-rasterises an SVG image at the size it is
// being DRAWN at: counted on real output, the share of the ink that is a
// mid-tone edge -- which is what softness is -- fell from 52% at 1x to 27% at
// 2x to 22% at 3x for text, and 59% to 41% to 29% for a display formula.
{
  const svg = Shot.svgFor('<div xmlns="http://www.w3.org/1999/xhtml">x</div>', 792, 1400);
  const w = /\swidth="([^"]+)"/.exec(svg);
  const h = /\sheight="([^"]+)"/.exec(svg);
  const vb = /viewBox="([^"]+)"/.exec(svg);
  w && h && w[1] === '792' && h[1] === '1400'
    ? ok('the SVG asks for the column\'s own size in CSS pixels')
    : fail('the SVG is ' + (w && w[1]) + 'x' + (h && h[1]) + ' rather than 792x1400');
  vb && vb[1] === '0 0 792 1400'
    ? ok('and its viewBox matches it exactly, so it scales itself by nothing')
    : fail('the viewBox is "' + (vb && vb[1]) + '" — a viewBox that does not '
           + 'match the width and height scales the content, and scaling the '
           + 'content is what loses every formula');
  !/transform\s*=/.test(svg)
    ? ok('and there is no transform around the lesson, for the same reason')
    : fail('a transform wraps the lesson: ' + svg.slice(0, 220));
  /<foreignObject[^>]*width="792"[^>]*height="1400"/.test(svg)
    ? ok('and the foreignObject is the box the lesson was laid out in')
    : fail('the foreignObject does not match the measured box: ' + svg.slice(0, 260));
}

// --- what is photographed ----------------------------------------------------
const doc = window.document;
const cards = doc.getElementById('cards');

function card(id, hidden) {
  const el = doc.createElement('article');
  el.className = 'card';
  el.dataset.card = id;
  el.innerHTML = '<div class="card-head"><span class="kind">Your move</span></div>'
    + '<div class="body"><p>Show that this is separable.</p></div>';
  if (hidden) el.hidden = true;
  cards.appendChild(el);
  return el;
}

card('0001');
card('0002');
const unseen = card('0003', true);

// jsdom reports no computed display for `hidden` on its own, so the rule under
// test -- "anything not on the glass is not in the document" -- is asserted
// through both routes the code uses.
let list = Shot.blocks();
if (list.length === 2 && list.indexOf(unseen) === -1)
  ok('the cards on the glass are what gets photographed, and only those');
else
  fail('blocks() returned ' + list.length + ' nodes and '
       + (list.indexOf(unseen) === -1 ? 'skipped' : 'INCLUDED') + ' a hidden one');

if (list[0].dataset.card === '0001' && list[1].dataset.card === '0002')
  ok('and in reading order, which is the order they happened in');
else
  fail('the blocks came back out of order');

// A card with no height is a card mid-render. It has nothing on it to
// photograph and a page of nothing is worse than no page.
const flat = card('0004');
flat.getBoundingClientRect = () => ({ width: 700, height: 0, top: 0, left: 0,
                                      right: 700, bottom: 0, x: 0, y: 0 });
if (Shot.blocks().indexOf(flat) === -1)
  ok('and a block with no height at all is not a page');
else
  fail('a zero-height block would become a blank page in the document');

// --- the furniture -----------------------------------------------------------
//
// A screenshot with a live Send button in it is a picture of a control that does
// nothing, in a document somebody is emailing to their professor.
const MUST_GO = ['.board-send', '.board-carry', '.to-board', '#skip'];
for (const sel of MUST_GO) {
  Shot.FURNITURE.indexOf(sel) !== -1
    ? ok(`${sel} is stripped, because it is a control and not the lesson`)
    : fail(`${sel} would be photographed as though it were part of the lesson`);
}

// --- comments, and why the writing surface went missing ----------------------
//
// XML forbids a double hyphen inside a comment, and board.html explains itself
// at length -- like this -- so its comments are full of them. Any block whose
// markup came from the page rather than from `render` therefore failed to parse
// and rasterised to nothing.
//
// Which is why it was the WRITING SURFACE, and only that: a card is built by
// JavaScript and carries no comments, so the export looked entirely correct
// while the one block holding the student's unsent working was silently absent.
{
  const host = doc.createElement('section');
  host.innerHTML = '<div>before</div>'
    + '<!-- a follow-up question is a new board -- and a new board is blank -->'
    + '<div>after<!-- another -- one --></div>';
  Shot.stripFurniture(host);
  host.innerHTML.indexOf('<!--') === -1
    ? ok('every comment is stripped out of the clone')
    : fail('a comment survived, and a double hyphen in one is a parse error that '
           + 'rasterises the whole block to nothing: ' + host.innerHTML);
  /^<div>before<\/div><div>after<\/div>$/.test(host.innerHTML)
    ? ok('and nothing else goes with them')
    : fail('stripping the comments took content with it: ' + host.innerHTML);

  // The real test: does the serialised form actually parse as XML, which is
  // what the browser does with it.
  const wrap = doc.createElement('div');
  wrap.innerHTML = '<p>a card<!-- with a -- comment in it --></p>'
    + '<img src="x.png">';               // and a void element, unclosed in HTML
  Shot.stripFurniture(wrap);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
    + '<foreignObject width="10" height="10">' + Shot.serialize(wrap)
    + '</foreignObject></svg>';
  const parsed = new window.DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = parsed.querySelector('parsererror');
  !err
    ? ok('and the serialised block is well-formed XML, comments and void '
         + 'elements and all')
    : fail('the block does not parse, so the browser paints none of it: '
           + err.textContent.slice(0, 160));
}

// --- the live writing surface ------------------------------------------------
//
// A foot of blank dark paper as the last page of a document somebody is
// emailing to their professor reads as a document that went wrong. But working
// drawn and not yet sent is the student's and belongs in the photograph, so the
// question is not "is this the live board" but "has anything been written on
// it" -- and the board is the side that knows.
{
  const writer = doc.getElementById('writer');
  if (!writer) {
    fail('there is no writing surface in the page at all');
  } else {
    /* board.js moves the surface into the run of cards -- it is the tail of the
       transcript, not a fixture beside it -- so put it where the board puts it. */
    cards.appendChild(writer);
    writer.hidden = false;
    Shot.liveInk = () => 0;
    Shot.blocks().indexOf(writer) === -1
      ? ok('a live surface nobody has written on is not in the document')
      : fail('a blank writing surface becomes a page of blank paper');
    Shot.liveInk = () => 3;
    Shot.blocks().indexOf(writer) !== -1
      ? ok('and one with unsent working on it is')
      : fail('working drawn and not yet sent was left out of the record');
    /* "I could not tell" must never be the reason an evening's unsent working
       is dropped. */
    Shot.liveInk = () => { throw new Error('no idea'); };
    Shot.blocks().indexOf(writer) !== -1
      ? ok('and a surface that cannot answer is kept, not dropped')
      : fail('a failure to count strokes silently discarded the live board');
    Shot.liveInk = null;
    Shot.blocks().indexOf(writer) !== -1
      ? ok('and with nothing to ask, it is kept too')
      : fail('the live board is dropped when nothing has been asked');
    writer.hidden = true;
  }
}

// --- when the page loads it -------------------------------------------------
//
// `shot.js` has to be running BEFORE board.js, because board.js is what hands
// it the way to ask how much is on the live surface. It was loaded `defer` in
// the head, and a deferred script runs after the document is parsed -- which is
// after the classic script at the end of the body. So it did not exist yet when
// board.js looked for it, the hook was never set, and every photograph ended
// with a page of blank paper.
{
  const html = fs.readFileSync(path.join(WEB, 'board.html'), 'utf8');
  const tags = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => ({
    src: (/src="([^"]+)"/.exec(m[1]) || [])[1] || '',
    defer: /\bdefer\b/.test(m[1]),
    at: m.index,
  }));
  const shot = tags.find((t) => /shot\.js$/.test(t.src));
  const board = tags.find((t) => /board\.js$/.test(t.src));
  if (!shot || !board) {
    fail('board.html does not load both shot.js and board.js');
  } else if (board.defer) {
    shot.defer && shot.at < board.at
      ? ok('both are deferred, and the rasteriser is first in document order')
      : fail('board.js is deferred and shot.js is not ordered before it');
  } else {
    !shot.defer && shot.at < board.at
      ? ok('the rasteriser is a classic script, loaded before board.js')
      : fail('shot.js is ' + (shot.defer ? 'deferred' : 'ordered after board.js')
             + ' while board.js is not — so it does not exist yet when board.js '
             + 'reaches for it');
  }
}

// --- the fallback ------------------------------------------------------------
//
// `shot.js` is a separate deferred file, and the service worker caches the shell
// file by file. A board that opened without it must still export.
{
  const bare = new JSDOM(fs.readFileSync(path.join(WEB, 'board.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://board.test/board',
  });
  const w = bare.window;
  w.HTMLCanvasElement.prototype.getContext = () =>
    new Proxy({}, { get: () => () => {}, set: () => true });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 700, height: 220, right: 700, bottom: 220, x: 0, y: 0 };
  };
  w.Element.prototype.scrollIntoView = function () {};
  w.EventSource = function () { return { close() {}, readyState: 1, addEventListener() {} }; };
  w.renderMathInElement = () => {};
  w.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  w.scrollTo = () => {};
  const asked = [];
  w.fetch = (u, o) => {
    asked.push(String(u));
    return /slate\/state/.test(String(u))
      ? Promise.resolve({ json: () => Promise.resolve({ pages: [] }) })
      : Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  };

  for (const f of ['typeface.js', 'macros.js', 'slate-core.js', 'annotate.js']) {
    try { w.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); } catch (e) { /* not under test */ }
  }
  // Deliberately NOT shot.js, so the fallback is what is under test here.
  try {
    w.eval(fs.readFileSync(path.join(WEB, 'board.js'), 'utf8'));
    ok('a board with no rasteriser loaded still starts');
  } catch (e) {
    fail('board.js threw without shot.js: ' + e.message);
  }
  try {
    asked.length = 0;
    w.document.getElementById('btn-export').onclick();
    asked.some((u) => /\/export$/.test(u))
      ? ok('and its export button falls back to the typeset transcript')
      : fail('a board without the rasteriser asked for ' + JSON.stringify(asked)
             + ' — the export button does nothing at all');
  } catch (e) {
    fail('tapping export without the rasteriser threw: ' + e.message);
  }

  // And the whole course was never the photograph's job: a filed sitting is not
  // on the glass, so there is nothing on the device to photograph.
  try {
    asked.length = 0;
    w.document.getElementById('btn-export-all').onclick();
    asked.some((u) => /\/export$/.test(u))
      ? ok('and the whole course is still typeset, which is the only way it can be')
      : fail('exporting the course asked for ' + JSON.stringify(asked));
  } catch (e) {
    fail('exporting the whole course threw: ' + e.message);
  }
}

// --- and the hook actually gets set, in the real load order ------------------
{
  const both = new JSDOM(fs.readFileSync(path.join(WEB, 'board.html'), 'utf8'), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://board.test/board',
  });
  const w = both.window;
  w.HTMLCanvasElement.prototype.getContext = () =>
    new Proxy({}, { get: () => () => {}, set: () => true });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 700, height: 220, right: 700, bottom: 220, x: 0, y: 0 };
  };
  w.Element.prototype.scrollIntoView = function () {};
  w.EventSource = function () { return { close() {}, readyState: 1, addEventListener() {} }; };
  w.renderMathInElement = () => {};
  w.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  w.scrollTo = () => {};
  w.fetch = (u) => (/slate\/state/.test(String(u))
    ? Promise.resolve({ json: () => Promise.resolve({ pages: [] }) })
    : new Promise(() => {}));
  for (const f of ['typeface.js', 'macros.js', 'slate-core.js', 'annotate.js',
                   'shot.js', 'board.js']) {
    try { w.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
    catch (e) { fail('loading ' + f + ': ' + e.message); }
  }
  typeof (w.TutorShot || {}).liveInk === 'function'
    ? ok('loaded in the page\'s own order, the board hands the rasteriser the '
         + 'way to ask what is on the live surface')
    : fail('the hook was never set: TutorShot.liveInk is '
           + typeof (w.TutorShot || {}).liveInk + ' — every photograph would end '
           + 'with a page of blank paper');
  (w.TutorShot || {}).liveInk && w.TutorShot.liveInk() === 0
    ? ok('and with no slate mounted it reports nothing written')
    : fail('an unmounted surface reports ' + ((w.TutorShot || {}).liveInk
           && w.TutorShot.liveInk()));
}

console.log();
if (errors.length) {
  console.log(errors.length + ' FAILURES');
  process.exit(1);
}
console.log('the lesson is photographed as it was read, and nothing else is');
