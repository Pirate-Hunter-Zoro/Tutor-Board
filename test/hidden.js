// Anything the scripts toggle with `hidden` must genuinely disappear.
//
// This exists because it did not. `.drop { display: grid }` and
// `#scratch { display: flex }` quietly beat the user-agent stylesheet's
// [hidden] { display: none } -- author origin wins over UA regardless of
// specificity -- so the drop overlay was painted over the lesson permanently,
// from the first version, with no drag involved. It cost two wrong diagnoses
// (a caching theory and an iOS-resume theory) before anyone read the CSS.
//
// Two checks: the guard rule is present, and no element that starts hidden is
// separately given a display by a rule that would outrank it.

const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
const PAIRS = [['home.html', 'home.css'], ['board.html', 'board.css'],
               ['slate.html', 'slate.css']];
const GUARD = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/;

let fails = 0;
function fail(msg) { fails++; console.log('FAIL ' + msg); }

for (const [htmlName, cssName] of PAIRS) {
  const html = fs.readFileSync(path.join(WEB, htmlName), 'utf8');
  const css = fs.readFileSync(path.join(WEB, cssName), 'utf8');

  if (GUARD.test(css)) {
    console.log('ok   ' + cssName + ' carries the [hidden] guard');
  } else {
    fail(cssName + ' has no [hidden] { display: none !important } rule');
  }

  // Elements that start hidden in the markup.
  const hiddenIds = [];
  const tagRe = /<(\w+)((?:[^>]*?))\bhidden\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = m[2] + m[3];
    const id = /\bid="([\w-]+)"/.exec(attrs);
    const cls = /\bclass="([^"]*)"/.exec(attrs);
    if (id) hiddenIds.push({ id: id[1], classes: cls ? cls[1].split(/\s+/) : [] });
  }
  if (!hiddenIds.length) fail(htmlName + ' declares nothing hidden — did the markup change?');

  // Strip the print block: display:none in there is the point, not a hazard.
  const screenCss = css.replace(/@media\s+print\s*\{[\s\S]*?\n\}/g, '');

  for (const el of hiddenIds) {
    const selectors = ['#' + el.id].concat(el.classes.map(c => '.' + c));
    const offenders = [];
    for (const sel of selectors) {
      const ruleRe = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
      let r;
      while ((r = ruleRe.exec(screenCss)) !== null) {
        const d = /(?:^|;|\s)display\s*:\s*([\w-]+)/.exec(r[1]);
        if (d && d[1] !== 'none') offenders.push(sel + ' { display: ' + d[1] + ' }');
      }
    }
    // With the guard in place these are harmless, but flag them so the pattern
    // stays visible: an element that is both hidden and given a display is
    // relying on one !important to stay correct.
    const note = offenders.length ? '  (relies on the guard: ' + offenders.join(', ') + ')' : '';
    console.log('ok   ' + htmlName + ' #' + el.id + ' hides' + note);
  }
}


// --- the answer block must never be usable-looking but unusable -----------
// It shipped once collapsed to a handle, which sized its canvas to 0x0: the
// controls were clipped away and touches fell through to the lesson behind.
// It then shipped depending on a network round trip before it had a page at
// all, so a slow link produced a surface that silently swallowed every stroke.
{
  const boardCss = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
  const slateCss = fs.readFileSync(path.join(WEB, 'slate.css'), 'utf8');
  const boardJs = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
  const coreJs = fs.readFileSync(path.join(WEB, 'slate-core.js'), 'utf8');

  // A definite, generous height that does not depend on anyone dragging.
  /#writer\s+#slate\s*\{[^}]*height:\s*clamp\(\s*(\d+(?:\.\d+)?)rem/.test(boardCss)
    ? (parseFloat(/#writer\s+#slate\s*\{[^}]*height:\s*clamp\(\s*(\d+(?:\.\d+)?)rem/.exec(boardCss)[1]) >= 18
        ? console.log('ok   the answer block has a usable minimum height')
        : (fails++, console.log('FAIL the answer block can be too short to write in')))
    : (fails++, console.log('FAIL the answer block has no definite height'));

  /placeWriter\(/.test(boardJs)
    ? console.log('ok   the block is placed by the board, not found by the user')
    : (fails++, console.log('FAIL nothing places the answer block automatically'));

  /insertBefore\(els\.writer/.test(boardJs)
    ? console.log('ok   it is moved into the lesson flow under its question')
    : (fails++, console.log('FAIL the block is not put into the card flow'));

  // Usable before the network answers.
  /pages = \[blankPage\(\)\];\s*\n\s*current = 0;\s*\n\s*layout\(\);/.test(coreJs)
    ? console.log('ok   there is a page to draw on before any fetch resolves')
    : (fails++, console.log('FAIL the surface waits on the network before it can be drawn on'));

  /\.sl-wrap\s*\{[^}]*touch-action:\s*none/.test(slateCss)
    ? console.log('ok   the whole writing surface opts out of page gestures')
    : (fails++, console.log('FAIL only the canvas opts out — a near-miss touch scrolls the page'));

  // Every control says what it is.
  ['Pen', 'Marker', 'Erase', 'Select', 'Send'].forEach(function (w) {
    coreJs.indexOf('"' + w + '"') !== -1 || coreJs.indexOf('>' + w + '<') !== -1
      ? console.log('ok   labelled control: ' + w)
      : (fails++, console.log('FAIL no label for ' + w));
  });
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall hidden-element checks passed');
process.exit(fails ? 1 : 0);
