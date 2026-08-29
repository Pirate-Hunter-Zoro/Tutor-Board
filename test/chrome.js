// Two bars cannot both own the top of the window.
//
// #bar (home, reload, scratch, type size, theme, print) and #drawbar (the pen
// tools) were both `position: sticky; top: 0`, and the tool bar, later in the
// document and a layer above, painted straight over the header. The moment an
// answer was owed there was no way to reload, open the scratch drawer, change
// the type size or leave the lesson -- and nothing looked broken, because the
// covering bar is a perfectly good bar.
//
// Read the CSS rather than trusting a rendered page: there is no browser here,
// and this is exactly the class of defect a stub DOM reports as fine.

const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'web', 'board.css'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'board.html'), 'utf8');
const errors = [];
const ok = (m) => console.log('ok   ' + m);
const fail = (m) => { errors.push(m); console.log('FAIL ' + m); };

// The declarations of one top-level rule, with @media blocks left out.
function block(selector) {
  // Comments first: a declaration written under an explanatory comment is still
  // a declaration, and leaving them in made `decl` miss the line after one.
  const screen = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
                    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/g, '');
  const re = new RegExp('(^|[},])\\s*' + selector.replace(/[#.]/g, '\\$&')
                        + '\\s*\\{([^}]*)\\}', 'mg');
  // Every rule with this selector, not merely the first: a stylesheet may well
  // add to a selector further down, and testing only the first one reports a
  // property as missing while it is sitting there.
  let m, body = '';
  while ((m = re.exec(screen)) !== null) body += ';' + m[2];
  return body || null;
}

function decl(body, prop) {
  if (!body) return null;
  const m = new RegExp('(?:^|;|\\n)\\s*' + prop + '\\s*:\\s*([^;]+)', 'm').exec(body);
  return m ? m[1].trim() : null;
}

const bar = block('#chrome');
const draw = block('#drawbar');

bar ? ok('#chrome has a rule') : fail('#chrome has no rule at all');
draw ? ok('#drawbar has a rule') : fail('#drawbar has no rule at all');

// The header owns the top.
/sticky|fixed/.test(decl(bar, 'position') || '') && decl(bar, 'top') === '0'
  ? ok('the chrome stack is pinned to the top')
  : fail('the chrome stack no longer holds the top of the window');

// One stack, not three things racing for the same offset. The end-of-session
// question and the push result used to stick to top:0 a layer below the header,
// which posted both of them underneath it.
/<div id="chrome">[\s\S]*<header id="bar">[\s\S]*id="finish"[\s\S]*id="pushed"[\s\S]*id="hwbar"[\s\S]*id="linkbad"[\s\S]*<\/div>/
  .test(HTML)
  ? ok('the banners are inside the chrome stack, under the bar')
  : fail('the banners are not part of the chrome stack');

['.finish, .pushed, .linkbad, .hwbar', '#bar'].forEach((sel) => {
  const b = block(sel);
  if (b === null) return fail(sel + ' has no rule');
  decl(b, 'position') === null || decl(b, 'top') === null
    ? ok(sel + ' does not separately claim the top')
    : fail(sel + ' sticks to the top on its own and will overlap the stack');
});

// A control in the bar must never wrap. It did: the save's label broke onto a
// second line once the bar filled up, which made the button taller than its row,
// and it painted straight over the agent chip and the button beside it. This is
// the same family as the two bars fighting for the top -- something in the chrome
// growing past the space it was given and covering what is next to it.
const barBtn = block('#bar button, #bar a');
if (barBtn === null) fail('#bar controls have no rule of their own');
else if (/nowrap/.test(decl(barBtn, 'white-space') || ''))
  ok('a control in the bar cannot wrap onto a second line');
else fail('bar controls may wrap — a two-line button overlaps its neighbours');

// And the left group is what gives way when the course name is long.
const left = block('.bar-left');
/hidden/.test(decl(left, 'overflow') || '')
  ? ok('the left group truncates rather than pushing the controls off the edge')
  : fail('a long course name can still push the controls out of the bar');

// The tools own the bottom, and must not claim a top edge at all.
/sticky|fixed/.test(decl(draw, 'position') || '') && decl(draw, 'bottom') === '0'
  ? ok('#drawbar is pinned to the bottom')
  : fail('#drawbar is not docked to the bottom: ' + JSON.stringify(decl(draw, 'position')));

decl(draw, 'top') === null
  ? ok('#drawbar does not also claim the top edge')
  : fail('#drawbar is anchored to the top again — it will cover the header');

// Docked to the bottom, its own children must open upward or they leave the
// screen: the overflow sheet and the selection bar follow the row in the markup.
/column-reverse/.test(decl(draw, 'flex-direction') || '')
  ? ok('the overflow sheet opens upward from the tool row')
  : fail('#drawbar stacks downward; its menu will open off the bottom of the screen');

// A fixed bar covers whatever is under it unless the page gives up the height.
/padding-bottom/.test(block('body.tools-out') || '')
  ? ok('the page reserves room for the tools')
  : fail('nothing reserves height for the fixed tool bar — it will cover the last card');

// The safe area on a home-screen iPad is below the tool row, not above it.
/env\(safe-area-inset-bottom\)/.test(draw || '')
  ? ok('the tool bar clears the home indicator')
  : fail('#drawbar ignores the bottom safe-area inset');

// Code mode's composer is the counterpart of the pen tools and belongs in the
// same place. It shipped with no rule of its own at all -- a bare form in the
// flow, scrolling off the end of the lesson like a paragraph.
const comp = block('#composer');
comp ? ok('#composer has a rule') : fail('#composer has no styling at all');
/sticky|fixed/.test(decl(comp, 'position') || '') && decl(comp, 'bottom') === '0'
  ? ok('#composer is docked to the bottom')
  : fail('#composer is not docked; it scrolls away with the lesson');
/env\(safe-area-inset-bottom\)/.test(comp || '')
  ? ok('#composer clears the home indicator')
  : fail('#composer ignores the bottom safe-area inset');
/padding-bottom/.test(block('body\\[data-mode2="code"\\]') || '')
  ? ok('a code course reserves room for the composer')
  : fail('nothing reserves height for the composer — it will cover the last card');

// An entry animation on every card, rather than on the ones that just arrived,
// is invisible for exactly as long as nothing re-inserts a card. The reconcile
// did, on every payload, and the whole lesson slid and faded each time -- the
// board "glitching and shifting and going right back". `render` already marks
// what is new.
!/animation:\s*rise/.test(block('.card') || '')
  ? ok('a card that is merely on screen does not animate')
  : fail('every .card carries an entry animation; any re-insertion replays it '
         + 'across the whole lesson');
/animation:\s*rise/.test(block('.card.fresh') || '')
  ? ok('and a card that has just arrived does')
  : fail('nothing animates a newly arrived card');
!/animation:\s*rise/.test(block('.mine') || '')
  ? ok('the same holds for the student\'s own turns')
  : fail('every .mine carries an entry animation');

// The writing surface is not a paragraph, and must not share a paragraph's
// width. #board carries a 46rem measure because prose needs one; the surface
// inside it was therefore about half an iPad in landscape, on a tool whose whole
// value is the area you have to write in.
{
  // The live surface and a dormant board share one rule, so that a board nobody
  // is writing on is indistinguishable from the one they are.
  const wr = block('#writer, .board') || '';
  /\bmargin:[^;]*var\(--bleed\)/.test(wr) || /margin-(left|inline)/.test(wr)
    ? ok('#writer breaks out of the reading column')
    : fail('#writer is still confined to the 46rem prose measure');
  /50vw/.test(wr)
    ? ok('and does so against the viewport, so it scales with the device')
    : fail('#writer\'s width is not derived from the viewport');
  /max\(/.test(wr) && /--room/.test(wr)
    ? ok('with a cap, so a large display does not get an absurd surface')
    : fail('the breakout is uncapped');
  !/transform:/.test(wr)
    ? ok('and without a transform, which would land the canvas on a half pixel')
    : fail('#writer is translated; the canvas will be soft');

  const sl = block('#writer #slate, .board-shot') || '';
  /svh/.test(sl)
    ? ok('the surface height uses svh, so iOS chrome does not eat the top of it')
    : fail('the surface is sized in vh; on iOS its first screenful hides under the chrome');
  /height:\s*clamp\([^;]*vh/.test(sl)
    ? ok('and keeps a vh fallback for browsers that do not know svh')
    : fail('no fallback height: an older browser gets no height at all');
}

console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                          : '\nevery bar is where it belongs');
process.exit(errors.length ? 1 : 0);
