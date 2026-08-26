// The PNG is for reading, not for looking pretty.
//
// It shipped inverted: white ink on near-black, because the export was painting
// whatever the screen happened to be showing. It was legible to the model that
// caught it and would not have been to a weaker one, which is the whole failure
// mode -- a file that is only *sometimes* readable fails silently, on the turn
// where it matters, with no error anywhere.
//
// There is no canvas backend here, so what is asserted is the colour rule: on a
// white ground, every ink a person can choose must come out dark enough to read.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web');
const errors = [];
const ok = (m) => console.log('ok   ' + m);
const fail = (m) => { errors.push(m); console.log('FAIL ' + m); };

const sandbox = { window: {}, document: { createElement: () => ({ getContext: () => ({}) }) } };
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(WEB, 'slate-core.js'), 'utf8'), sandbox);

const forPaper = sandbox.window.Slate && sandbox.window.Slate.forPaper;
if (typeof forPaper !== 'function') {
  fail('slate-core does not expose the export colour rule');
  console.log('\n1 FAILURES');
  process.exit(1);
}
ok('the export colour rule is reachable');

function lum(css) {
  let r, g, b;
  let m = /^#([0-9a-f]{6})$/i.exec(css);
  if (m) {
    r = parseInt(m[1].slice(0, 2), 16);
    g = parseInt(m[1].slice(2, 4), 16);
    b = parseInt(m[1].slice(4, 6), 16);
  } else {
    m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(css);
    if (!m) return null;
    [, r, g, b] = m.map(Number);
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Every ink offered by the palettes, plus the two the paper skins use as their
// default. If any one of them can be chosen, any one of them must be readable.
const INKS = ['#f2f4f7', '#ffd166', '#7fd1ff', '#8ce99a', '#ff8f8f',
              '#16171a', '#a86a12', '#1a56b0', '#1f5c34', '#9a2020',
              '#241f16', '#ffffff', '#fff'];

let worst = 0, worstInk = null;
INKS.forEach((ink) => {
  const out = forPaper(ink);
  const l = lum(out);
  if (l === null) { fail(ink + ' produced an unreadable colour value: ' + out); return; }
  if (l > worst) { worst = l; worstInk = ink + ' -> ' + out; }
});

worst <= 0.45
  ? ok('every ink comes out dark on white (palest: ' + worstInk + ')')
  : fail('an ink stays too pale to read on white: ' + worstInk);

// A colour chosen on purpose keeps its hue; only its lightness moves. Pale blue
// must not come back as black, or a diagram loses what its colours meant.
const blue = forPaper('#7fd1ff');
const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(blue);
m && Number(m[3]) > Number(m[1])
  ? ok('a colour keeps its hue through the change (' + blue + ')')
  : fail('a deliberate colour was flattened to grey: ' + blue);

// Ink that already reads on white is left exactly as it was.
forPaper('#16171a') === '#16171a'
  ? ok('ink that already reads on white is untouched')
  : fail('a dark ink was needlessly rewritten: ' + forPaper('#16171a'));

// Near-white and near-grey have no hue worth keeping.
lum(forPaper('#f2f4f7')) < 0.12
  ? ok('the default light ink becomes near-black')
  : fail('the default light ink is still pale: ' + forPaper('#f2f4f7'));

console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                          : '\nthe exported page is dark ink on white');
process.exit(errors.length ? 1 : 0);
