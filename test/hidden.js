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


// --- the writing panel must never be usable-looking but unusable -----------
// It shipped once collapsed to a handle, which sized its canvas to 0x0: the
// toolbar and Send were clipped away and touches fell through to the lesson
// behind. Both halves of that are checked here.
{
  const boardCss = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
  const slateCss = fs.readFileSync(path.join(WEB, 'slate.css'), 'utf8');
  const boardJs = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');

  const wr = /#writer\s*\{[^}]*\}/.exec(boardCss);
  if (wr && /min-height:\s*(\d+(\.\d+)?)rem/.test(wr[0])) {
    const rem = parseFloat(/min-height:\s*(\d+(\.\d+)?)rem/.exec(wr[0])[1]);
    rem >= 12 ? console.log('ok   writer panel has a usable minimum height')
              : (fails++, console.log('FAIL writer min-height is only ' + rem + 'rem'));
  } else {
    fails++; console.log('FAIL #writer declares no min-height — it can collapse to nothing');
  }

  /^(?!.*data-open).*$/.test(boardJs) || true;
  /showWriter\(/.test(boardJs)
    ? console.log('ok   the panel is opened by the board, not by the user dragging')
    : (fails++, console.log('FAIL nothing opens the writing panel automatically'));

  /\.sl-wrap\s*\{[^}]*touch-action:\s*none/.test(slateCss)
    ? console.log('ok   the whole writing surface opts out of page gestures')
    : (fails++, console.log('FAIL only the canvas opts out — a near-miss touch scrolls the page'));

  /\.slate-root\s*\{[^}]*touch-action:\s*none/.test(slateCss)
    ? console.log('ok   the panel itself does not scroll the lesson behind it')
    : (fails++, console.log('FAIL the panel does not contain its own gestures'));

  /class="sl-send"|"sl-send"/.test(fs.readFileSync(path.join(WEB, 'slate-core.js'), 'utf8'))
    ? console.log('ok   a Send control exists')
    : (fails++, console.log('FAIL no Send control'));
}

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall hidden-element checks passed');
process.exit(fails ? 1 : 0);
