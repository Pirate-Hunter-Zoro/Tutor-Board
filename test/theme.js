// The dark theme has to reach the whole window, not just the part with content.
//
// This is here because of a screenshot. An iPad showed the board in dark mode
// with a cream panel filling the bottom 40% of the screen, and it looked for all
// the world like a broken writing surface. It was the page itself:
//
//   :root                    { --paper: #fbfaf7 }      <- light
//   body[data-mode="dark"]   { --paper: #16171a }      <- dark, scoped to BODY
//   html, body               { background: var(--paper) }
//
// The viewport's background is taken from <html>, and only falls through to
// <body> when <html> paints none of its own. So <html> painted `var(--paper)`
// resolved against `:root` -- always the light cream, whatever theme was on --
// and <body>'s dark box stopped wherever the content did. An empty board is
// almost all "wherever the content did".
//
// The rule this guards: if a sheet defines its dark palette on a `body` selector,
// then `html` must not paint a background of its own.

const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
const errors = [];
const ok = (m) => console.log('ok   ' + m);
const fail = (m) => { errors.push(m); console.log('FAIL ' + m); };

// Every top-level rule as [selector, declarations], @media blocks removed.
function rules(css) {
  const flat = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/g, '')
                  .replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(flat)) !== null) out.push([m[1].trim(), m[2]]);
  return out;
}

function paintsBackground(body) {
  // `background: none` and `background-color: transparent` paint nothing, which
  // is the whole point of the fix; anything else is a real paint.
  const m = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/.exec(body);
  if (!m) return false;
  return !/^\s*(none|transparent|initial|unset)\s*$/i.test(m[1]);
}

for (const sheet of ['board.css', 'home.css', 'slate.css']) {
  const css = fs.readFileSync(path.join(WEB, sheet), 'utf8');
  const all = rules(css);

  const darkOnBody = all.some(([sel]) => /body\s*\[data-mode/.test(sel));
  if (!darkOnBody) {
    ok(sheet + ': one palette, no theme switch to get wrong');
    continue;
  }
  ok(sheet + ': the dark palette is scoped to the body');

  const htmlPaints = all.filter(([sel, body]) =>
    sel.split(',').some((s) => /(^|\s)html\b/.test(s.trim()) && !/:has|\bbody\b/.test(s))
    && paintsBackground(body));

  if (htmlPaints.length === 0) {
    ok(sheet + ': html paints nothing, so the body colour reaches the viewport');
  } else {
    fail(sheet + ': html paints a background (' + htmlPaints[0][0] + ') while the'
         + ' dark tokens are body-scoped — the bottom of a short page goes light');
  }

  const bodyPaints = all.some(([sel, body]) =>
    sel.split(',').some((s) => /^body$/.test(s.trim())) && paintsBackground(body));
  bodyPaints
    ? ok(sheet + ': the body paints one, so there is something to propagate')
    : fail(sheet + ': nothing paints a background at all');

  // A body only as tall as its content leaves the rest of the viewport to the
  // canvas. Propagation covers it, but the body must still have a colour to give.
  const tall = all.some(([sel, body]) =>
    sel.split(',').some((s) => /^body$/.test(s.trim())) && /min-height/.test(body));
  tall
    ? ok(sheet + ': and the body is at least a screen tall')
    : fail(sheet + ': the body can be shorter than the screen with nothing behind it');
}

// The board is the page this actually happened on, so pin the specific shape.
const board = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
/--paper\s*:/.test(board) && /body\[data-mode="dark"\][^{]*\{[^}]*--paper/.test(board)
  ? ok('board.css still switches --paper by theme')
  : fail('board.css no longer defines a dark --paper — this test is now lying');

console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                          : '\nthe theme reaches the whole window');
process.exit(errors.length ? 1 : 0);
