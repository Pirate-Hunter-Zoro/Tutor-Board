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
  const screen = CSS.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/g, '');
  const re = new RegExp('(^|[},])\\s*' + selector.replace(/[#.]/g, '\\$&')
                        + '\\s*\\{([^}]*)\\}', 'm');
  const m = re.exec(screen);
  return m ? m[2] : null;
}

function decl(body, prop) {
  if (!body) return null;
  const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(body);
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

console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                          : '\nevery bar is where it belongs');
process.exit(errors.length ? 1 : 0);
