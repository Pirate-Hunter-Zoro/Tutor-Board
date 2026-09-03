// Nothing the reader can be waiting on is allowed to be silent.
//
// Reported from an iPad, mid-proof, in two messages:
//
//   "The tutor was sluggish to start up... But the tutor was just marked as dead
//    or not available or not listening in the app. If the tutor is 'waking' up,
//    I should be told that. It seemed to tell me the tutor was dead which put me
//    in 'send again' mode leading to massive confusion."
//
//   "The tutor also appears to be very non responsive. Now it's just hanging. I
//    need you to make the tutor way more robust. I don't ever want to be left
//    hanging."
//
// The board knew two things: the wire ("sending to the tutor", for a hundred
// seconds and then gone) and the turn ("the tutor is writing"). Between them sat
// every state that actually goes wrong — a tutor still coming up, a turn that
// failed and went back to waiting, a course with nothing attached at all — and
// the board's answer to all three was to HIDE the strip. A blank space where
// "sending" was is indistinguishable from a send that never left, which is
// precisely the thing that produces a second send.
//
// So the question is one question, asked of the server, off disk: is there
// something in the inbox that nothing has picked up. Everything below is that
// question having an answer in words.
//
// jsdom, because the whole assertion is what a person can read on the glass.

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
const doc = window.document;

window.HTMLCanvasElement.prototype.getContext = () =>
  new Proxy({}, { get: () => () => {}, set: () => true });
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 900 });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 500 });
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 900, height: 120, right: 900, bottom: 120, x: 0, y: 0 };
};
window.Element.prototype.scrollIntoView = function () {};
window.Element.prototype.setPointerCapture = function () {};
window.Element.prototype.releasePointerCapture = function () {};
window.fetch = (u) => (/slate\/state/.test(String(u))
  ? Promise.resolve({ json: () => Promise.resolve({ pages: [] }) })
  : new Promise(() => {}));
window.renderMathInElement = () => {};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = function () {};
window.addEventListener('error', (e) => fail('uncaught: ' + e.message));
window.EventSource = function () {
  window.__es = this;
  this.readyState = 1;
  this.close = function () {};
  this.addEventListener = function () {};
};

for (const f of ['typeface.js', 'macros.js', 'slate-core.js', 'annotate.js', 'board.js']) {
  try { window.eval(fs.readFileSync(path.join(WEB, f), 'utf8')); }
  catch (e) { fail(f + ': ' + e.message); }
}
const es = window.__es;
if (!es) { console.log('FAIL board.js never opened a stream'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now() / 1000;
const q = { id: '0001', kind: 'question', title: 'Exercise 3.8',
            body: 'assemble the sum', mtime: t0 };

// Handed in two minutes ago, and nothing has marked it read.
const held = { since: t0 - 120, count: 1 };

const frame = (agent, waiting) => JSON.stringify({
  state: { course: 'Galois Theory', session: 'lecture', mode: 'math' },
  cards: [q],
  turns: [{ id: 't0001', rev: 1, kind: 'ink', answers: '0001', t: t0 - 120,
            page: 1, strokes: 67, png: '/answers/t0001-r1.png',
            ink: '/answers/t0001-r1.json' }],
  agent: agent, waiting: waiting || null, history: 0,
});

const busy = () => doc.getElementById('busy');
const says = () => doc.getElementById('busy-text').textContent;
const chip = () => doc.getElementById('agent').textContent;
const since = () => doc.getElementById('busy-since').textContent;

(async () => {

// ------------------------------------------------------------- waking up
es.onmessage({ data: frame({ agent: 'claude', state: 'waking' }, held) });
await sleep(40);

/waking up/.test(chip())
  ? ok('a tutor coming up says so in the chrome')
  : fail('the chip does not say the tutor is waking: "' + chip() + '"');
!/stopped|not reading/.test(chip())
  ? ok('and emphatically does not say it stopped')
  : fail('a start in flight is being reported as a death: "' + chip() + '"');
doc.getElementById('no-tutor').hidden
  ? ok('and the lesson does not warn that nothing is reading the board')
  : fail('the "no tutor" warning is up over a tutor that is on its way');


!busy().hidden && /waking up/.test(says()) && /no need to send again/i.test(says())
  ? ok('and where the answer will appear it says the work is safe and not to '
       + 'send again — which is the whole of the report')
  : fail('the strip says "' + says() + '" over work sitting in the inbox');
/2m/.test(since())
  ? ok('with how long it has been waiting, counted from the send')
  : fail('no idea how long this has been going: "' + since() + '"');

// ------------------------------------------------------- nothing attached
es.onmessage({ data: frame(null, held) });
await sleep(40);

!busy().hidden && /no tutor is reading/.test(says())
  ? ok('work handed in to a board with nothing attached says exactly that')
  : fail('an unattended board is silent about it: "' + says() + '"');
busy().classList.contains('busy-bad')
  ? ok('and it reads as a problem rather than as progress')
  : fail('a board nobody is reading is painted as though it were working');

// --------------------------------------------------------- a failed turn
//
// AND WITH NOTHING IN THE INBOX, WHICH IS THE REAL CASE. `board wait` marks a
// message read the moment it hands it over, so by the time a turn fails the
// message it failed on is read and the inbox is empty. A failure that could
// only be reported alongside unclaimed work would therefore never be reported
// at all -- which is exactly the hole the whole report is about.
es.onmessage({ data: frame({ agent: 'claude', state: 'listening',
                             failure: { error: 'timed out', at: t0 - 30 } },
                           null) });
await sleep(40);

!busy().hidden && /failed/.test(says())
  ? ok('a turn that fell over is reported where the answer should have been')
  : fail('a failed turn still reads as a tutor quietly listening: "' + says() + '"');
/ran too long/.test(says())
  ? ok('in words rather than in the daemon\'s own error string')
  : fail('the log\'s wording reached the iPad: "' + says() + '"');
/Send again/.test(says())
  ? ok('and says what to do about it')
  : fail('a failure with no way forward: "' + says() + '"');
/30s|31s/.test(since())
  ? ok('timed from when it fell over, which is the fact a person can act on')
  : fail('the failure is not dated: "' + since() + '"');

// A retry is not a dead end, and must not be painted as one: the daemon
// re-answers the same message on its own.
es.onmessage({ data: frame({ agent: 'claude', state: 'listening', retrying: true,
                             failure: { error: 'exit 1', at: t0 - 30 } },
                           null) });
await sleep(40);
/trying again/.test(says()) && !busy().classList.contains('busy-bad')
  ? ok('a failure being retried says so, and is not painted as a dead end')
  : fail('a retry in progress reads as a failure to act on: "' + says() + '"');

// A send AFTER a failure is the newer fact, and the board must talk about that
// rather than about the failure it has already reported once.
es.onmessage({ data: frame({ agent: 'claude', state: 'waking',
                             failure: null },
                           { since: t0 - 10, count: 1 }) });
await sleep(40);
es.onmessage({ data: frame({ agent: 'claude', state: 'listening',
                             failure: { error: 'exit 1', at: t0 - 300 } },
                           { since: t0 - 20, count: 1 }) });
await sleep(40);
/has not picked this up yet/.test(says())
  ? ok('a send made since the failure is what the board talks about')
  : fail('the board is still reporting an older failure over a newer send: "'
         + says() + '"');

// ------------------------------------------------ out of allowance is not a bug
es.onmessage({ data: frame({ agent: 'claude', state: 'listening',
                             failure: { error: 'out of allowance', at: t0 - 30 } },
                           null) });
await sleep(40);
/allowance/.test(says())
  ? ok('an allowance that has run out is named, because nothing is broken')
  : fail('running out of allowance is reported as something else: "' + says() + '"');

// ------------------------------------------------------- and the turn itself
es.onmessage({ data: frame({ agent: 'claude', state: 'working', turns: 4,
                             turn_started: t0 - 200 }, null) });
await sleep(40);

!busy().hidden && /the tutor is/.test(says())
  ? ok('a turn in progress still says so')
  : fail('the working message went missing: "' + says() + '"');
/3m/.test(since())
  ? ok('and counts from when the DAEMON started the turn, not from when this '
       + 'page first saw it — a reload used to restart the clock at zero')
  : fail('the elapsed time is this browser\'s, not the turn\'s: "' + since() + '"');
/still writing/.test(says())
  ? ok('and a long one says it is long, rather than leaving the number to')
  : fail('a three-minute turn is not being flagged as long: "' + says() + '"');

// ------------------------------------------------------------ and silence
// Nothing waiting, nothing working: there is genuinely nothing to say, and
// saying something anyway is furniture.
es.onmessage({ data: frame({ agent: 'claude', state: 'listening' }, null) });
await sleep(40);
busy().hidden
  ? ok('with nothing owed and nothing waiting, the strip goes')
  : fail('the strip is talking about nothing: "' + says() + '"');

console.log(errors.length ? '\n' + errors.length + ' FAILURES'
  : '\nno state a reader can be waiting in is silent');
process.exit(errors.length ? 1 : 0);

})();
