// The course list on the front door, and the line that ran off the card.
//
// A course row was one flex line: the name on the left, and everything else
// pushed to the right by `margin-left: auto` with `white-space: nowrap` on it.
// The right-hand half is somebody's prose -- a chapter title like "Homework 1 -
// axioms of probability, Ross ch.1 problems" -- followed by a card count and a
// node name. A nowrap flex item cannot shrink and cannot wrap, so on anything
// narrower than the sentence it simply ran out through the border and off the
// card, over the top of whatever was beside it.
//
// Nothing caught it because nothing was wrong with the DOM: the text was
// correct, the element was there, and jsdom has no layout engine to notice that
// it was in the wrong place. So this file checks the two declarations that
// decide it, and the structure the fix depends on.

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
const check = (m, cond) => (cond ? ok(m) : fail(m));

const css = fs.readFileSync(path.join(WEB, 'home.css'), 'utf8');

// ---- the declarations that caused it ---------------------------------------
const rowBlock = (css.match(/\.courses button, \.courses a \{[^}]*\}/) || [''])[0];
const metaBlock = (css.match(/\.courses \.meta \{[^}]*\}/) || [''])[0];

check('the course row is a column, so the second line has somewhere to go',
      /flex-direction:\s*column/.test(rowBlock));
check('the row cannot be pushed wider than its container',
      /box-sizing:\s*border-box/.test(rowBlock) && /min-width:\s*0/.test(rowBlock));
check('the meta line is allowed to wrap',
      metaBlock !== '' && !/white-space:\s*nowrap/.test(metaBlock));
check('and a long unbroken run of characters breaks rather than overflows',
      /overflow-wrap:\s*anywhere/.test(metaBlock));
check('nothing in the row is pushed to the right edge any more',
      !/margin-left:\s*auto/.test(metaBlock));

// ---- the structure the fix depends on --------------------------------------
const dom = new JSDOM(fs.readFileSync(path.join(WEB, 'home.html'), 'utf8'), {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://board.test/',
});
const { window } = dom;
// The slate asks for its saved pages before it can say how many it has,
// and the board now waits for that answer rather than acting on the one
// blank sheet that stands in until it comes. A promise that never settles
// models a board that never finds out; these tests mean a board with
// nothing saved, which is a different thing and has to say so.
window.fetch = (u) => (/slate\/state/.test(String(u))
  ? Promise.resolve({ json: () => Promise.resolve({ pages: [] }) })
  : new Promise(() => {}));
window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
window.eval(fs.readFileSync(path.join(WEB, 'home.js'), 'utf8'));

// paintCourses lives inside the module closure, so drive it the way the page
// does: hand the refresh loop a response. Simpler and more honest than exporting
// internals for a test -- build the rows through the same code path the app uses.
const LONG = 'Homework 1 — axioms of probability, Ross ch.1 problems';
const list = [
  { repo: 'Probability', course: 'Probability', chapter: LONG, cards: 4,
    running: true, node: 'compute305', current: false },
  { repo: 'Algo-Solutions', course: 'Algo Solutions', chapter: '', cards: 0,
    running: false, current: false },
];

window.fetch = (url) => Promise.resolve({
  json: () => Promise.resolve(
    url === '/courses.json'
      ? { courses: list, where: 'compute305' }
      : { state: { course: 'Galois Theory' }, cards: [], messages: [], slate: [] }),
});

// Kick a refresh and let the two promises settle.
window.dispatchEvent(new window.Event('focus'));
setTimeout(() => {
  const rows = window.document.querySelectorAll('#others li button, #past li button');
  check('every course in the list is drawn', rows.length === 2);

  const prob = window.document.querySelector('#others li button');
  if (!prob) {
    fail('the running course was not drawn at all');
  } else {
    const name = prob.querySelector('.name');
    const meta = prob.querySelector('.meta');
    check('the name is its own element', !!name && name.textContent === 'Probability');
    check('the chapter is on the second line, not beside the name',
          !!meta && meta.textContent.indexOf(LONG) === 0);
    check('the name element does not carry the chapter text too',
          !!name && name.textContent.indexOf(LONG) === -1);
    check('only the live word is coloured, not the chapter and the card count',
          !!meta && !meta.classList.contains('live')
          && !!meta.querySelector('.live'));
    check('and the live word still says which machine is holding it',
          !!meta && /live on compute305/.test(meta.textContent));
  }

  const idle = window.document.querySelectorAll('#past li button');
  const bare = idle[idle.length - 1];
  check('a course nobody has opened is drawn with no second line at all',
        !!bare && !bare.querySelector('.meta'));

  console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                            : '\nthe course list stays inside its card');
  process.exit(errors.length ? 1 : 0);
}, 50);
