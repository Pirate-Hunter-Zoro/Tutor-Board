// A question has to be answerable, in every repository.
//
// In a maths course the answer block is a writing surface, and that has been
// true from the start. In a code project there was nothing at all: the composer
// carried three signals -- ready to check, I need help, I'm confused -- and none
// of them is "here is my answer", while the text row stayed shut until one of
// the two that need a sentence was picked. So a card that asked the student to
// decide something left them with no way to say what they had decided, and the
// only route back was a terminal, which is the ceremony this tool exists to
// remove. Found by a person holding an iPad, reading a question, with nowhere to
// put the answer.
//
// The mode that produced that split is gone and so are the signals; the panel is
// the answer everywhere. A `mode` still in a payload is dead data, and both
// values are painted here to prove it.
//
// A real DOM, because this is placement and visibility, which is exactly what a
// stub reports as fine.

const fs = require('fs');
const path = require('path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
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
const doc = window.document;

window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, { get: () => () => {}, set: () => true });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 900 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 500 });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 900, height: 500, right: 900, bottom: 500, x: 0, y: 0 };
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
window.EventSource = function () { return { close() {}, readyState: 1, addEventListener() {} }; };
window.renderMathInElement = () => {};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};
window.addEventListener('error', (e) => fail('uncaught: ' + e.message));

for (const f of ['typeface.js', 'macros.js', 'slate-core.js', 'annotate.js']) {
  try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
  catch (e) { fail(f + ': ' + e.message); }
}
try {
  let src = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
  src = src.replace('})();', 'window.__render = render;\n})();');
  window.eval(src);
  ok('loaded the board');
} catch (e) { fail('board.js: ' + e.message); }

const now = Date.now() / 1000;
const question = { id: '0001', kind: 'question', title: 'Refit inside the bootstrap',
                   body: 'How should the population reach the bootstrap?', mtime: now };

function paint(mode, turns) {
  window.__render({
    state: { course: 'P', mode: mode },
    cards: [question], turns: turns || [], messages: [], uploads: [], slate: [],
  });
}

const block = () => doc.getElementById('writer');
const typebox = () => doc.getElementById('typebox');

// --- a repository whose work is code --------------------------------------
paint('code');
const b = block();
b && !b.hidden
  ? ok('a question in a code project offers an answer panel')
  : fail('a code question has no answer panel at all');

const card = doc.querySelector('.card[data-card="0001"]');
b && card && card.nextElementSibling === b
  ? ok('and it sits directly under the question, not at the end of the page')
  : fail('the answer panel is not under the question it answers');

const write = doc.getElementById('tab-write');
const type = doc.getElementById('tab-type');
write && type
  ? ok('offering both ways: write, or type')
  : fail('one of the two ways to answer is missing');

// Typing opens the typed half of the SAME panel, not a separate box.
typebox().hidden = true;
type.onclick();
!typebox().hidden
  ? ok('typing opens the typed half')
  : fail('the typed half stays shut, which is the whole defect');

// And nothing else. The signals are not hidden here -- they do not exist.
!doc.getElementById('composer')
  ? ok('and nothing beside it: there is no signal bar to show')
  : fail('the composer is back in the markup');

// Skipping is available here too: a prompt that cannot be declined gets
// answered badly to make it go away.
doc.getElementById('skip')
  ? ok('and the question can be declined, as in a maths course')
  : fail('a code question cannot be skipped');

paint('code', [{ id: 't1', rev: 1, signal: 'skip', answers: '0001', t: now + 1,
                 from: 'student', kind: 'text', text: '' }]);
block().hidden
  ? ok('and a skipped question retires the panel')
  : fail('the panel survives a skip, so the prompt does not go away');

// --- and so does a maths course, identically ------------------------------
paint('math');
!block().hidden
  ? ok('a maths course gets the same answer panel')
  : fail('the maths answer panel did not appear');

// --- a minute of writing must not look like a minute of nothing ----------
// A card is a file and the lesson shows nothing until it exists, so the tutor
// taking ninety seconds over one looked exactly like a tutor that had died. The
// only signal was a dot in the title bar the size of a full stop.
function paintWith(agent) {
  window.__render({
    state: { course: 'P' },
    cards: [question], turns: [], messages: [], uploads: [], slate: [],
    agent: agent,
  });
}

const busy = doc.getElementById('busy');
paintWith({ agent: 'claude', state: 'working', turns: 1, host: 'h', pid: 1 });
busy && !busy.hidden
  ? ok('the lesson says the tutor is writing while it writes')
  : fail('nothing on the board says the tutor is working — a blank screen and a '
         + 'dead tutor look identical');
busy && /writing/i.test(busy.textContent)
  ? ok('and says what it is doing, not merely that something is happening')
  : fail('the working state does not say what is going on');
// It must sit right after the lesson and NEVER inside it: #cards is reconciled,
// and an unkeyed element among the cards is stepped over by the cursor walk, so
// cards land on the wrong side of it and the answer block stops sitting under
// its own question. That is not hypothetical -- it broke two suites.
busy && busy.parentNode !== doc.getElementById('cards')
  ? ok('and stays out of the reconciled lesson, which it would otherwise disorder')
  : fail('the notice was put inside #cards, where it shifts the cards around it');
busy && doc.getElementById('cards').nextElementSibling === busy
  ? ok('and sits directly after the lesson, where the card is about to appear')
  : fail('the notice is not at the end of the lesson');

paintWith({ agent: 'claude', state: 'listening', turns: 1, host: 'h', pid: 1 });
busy.hidden
  ? ok('and it goes when the turn ends')
  : fail('the working notice outlives the turn');

// A turn does NOT end when the card lands: the tutor goes on to verify, file and
// write the handoff, and the daemon says "working" throughout. The notice
// counted through all of it, so a 34-second card looked like a four-minute wait
// -- measured, on a real board, and reported as "WHAT is going on".
paintWith({ agent: 'claude', state: 'working', turns: 2, host: 'h', pid: 1 });
!busy.hidden ? ok('a new turn starts the notice again')
             : fail('the notice does not come back for the next turn');
window.__render({
  state: { course: 'P' },
  cards: [question, { id: '0002', kind: 'lesson', title: 'Answer', body: 'here',
                      mtime: now + 500 }],
  turns: [], messages: [], uploads: [], slate: [],
  agent: { agent: 'claude', state: 'working', turns: 2, host: 'h', pid: 1 },
});
busy.hidden
  ? ok('and it stops the moment a card lands, not when the tutor stops tidying')
  : fail('the notice goes on counting after the answer is already on screen — '
         + 'which is worse than having no notice at all');

paintWith(null);
busy.hidden
  ? ok('and a board with no tutor attached does not claim one is writing')
  : fail('the working notice appears with no tutor at all');


console.log(errors.length ? '\n' + errors.length + ' FAILURES'
                          : '\na question can be answered in every repository');
process.exit(errors.length ? 1 : 0);
