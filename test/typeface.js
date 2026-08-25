// The reading face must reach the prose and must NOT reach the mathematics.
//
// KaTeX's glyphs, metrics and spacing are one system: substituting a text face
// into it does not produce a dyslexia-friendly formula, it produces a broken
// one. Same for code, where alignment is the point. This is easy to undo by
// accident with one over-broad selector, so it is checked.

const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
const SHEETS = ['board.css', 'home.css', 'slate.css'];
const FACE = fs.readFileSync(path.join(WEB, 'typeface.css'), 'utf8');

let fails = 0;
const fail = (m) => { fails++; console.log('FAIL ' + m); };
const ok = (m) => console.log('ok   ' + m);

// --- the faces are actually vendored ---------------------------------------
for (const f of ['opendyslexic-latin-400-normal.woff2',
                 'opendyslexic-latin-700-normal.woff2',
                 'atkinson-hyperlegible-latin-400-normal.woff2',
                 'atkinson-hyperlegible-latin-700-normal.woff2']) {
  const p = path.join(WEB, 'fonts', f);
  if (fs.existsSync(p) && fs.statSync(p).size > 5000) ok('vendored ' + f);
  else fail('missing or truncated: ' + f);
}
for (const l of ['LICENSE-OpenDyslexic', 'LICENSE-AtkinsonHyperlegible']) {
  fs.existsSync(path.join(WEB, 'fonts', l)) ? ok('licence present: ' + l)
                                            : fail('missing licence: ' + l);
}

// --- every face the CSS declares has a file --------------------------------
const srcs = [...FACE.matchAll(/url\("\/static\/fonts\/([^"]+)"\)/g)].map(m => m[1]);
srcs.length ? ok(srcs.length + ' @font-face sources declared')
            : fail('typeface.css declares no font files');
for (const s of srcs) {
  if (!fs.existsSync(path.join(WEB, 'fonts', s))) fail('@font-face points at a missing file: ' + s);
}

// --- the three faces are all reachable -------------------------------------
for (const mode of ['hyperlegible', 'serif']) {
  FACE.includes(`body[data-face="${mode}"]`) ? ok('face available: ' + mode)
                                             : fail('no rule for face: ' + mode);
}
/[^-]--prose:/.test(FACE) ? ok('default face is set on :root') : fail('no default --prose');
FACE.includes('OpenDyslexic') && FACE.indexOf('OpenDyslexic') < FACE.indexOf('data-face')
  ? ok('OpenDyslexic is the default') : fail('OpenDyslexic is not the default');

// --- no stylesheet hardcodes a family any more -----------------------------
for (const name of SHEETS) {
  const css = fs.readFileSync(path.join(WEB, name), 'utf8');
  const hard = [...css.matchAll(/font-family:\s*([^;]+);/g)]
    .map(m => m[1].trim())
    .filter(v => !v.startsWith('var(--'));
  hard.length ? fail(name + ' hardcodes a family: ' + hard.join(' | '))
              : ok(name + ' uses face tokens only');

  // The killer: a selector broad enough to swallow KaTeX.
  const broad = [...css.matchAll(/(^|\n)\s*(\*|body\s*\*|:root\s*\*)[^{]*\{[^}]*font-family/g)];
  broad.length ? fail(name + ' applies a family with a universal selector')
               : ok(name + ' does not force a family onto everything');
}

// --- KaTeX keeps its own -----------------------------------------------------
const katex = fs.readFileSync(path.join(WEB, 'katex', 'katex.min.css'), 'utf8');
/\.katex\{font:normal[^}]*KaTeX_Main/.test(katex)
  ? ok('KaTeX still declares its own faces')
  : fail('KaTeX no longer sets its own font — maths would inherit the prose face');

// --- code stays monospace ----------------------------------------------------
const board = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');
/\.body (code|pre)[^{]*\{[^}]*var\(--mono\)/.test(board)
  ? ok('code uses the monospace token')
  : fail('code is not pinned to a monospace face');

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall typeface checks passed');
process.exit(fails ? 1 : 0);
