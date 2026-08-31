// Choosing what a test review covers, on the board.
//
// A lecture starts from one tap and a homework sitting from one tap on a set,
// because in both cases somebody else already decided what the problems are. A
// review cannot: the student is the only one who knows what is on the test, so
// the sitting has to ask before it starts, and it has to ask with a list rather
// than a text box -- a name nobody chose must never reach the filesystem or the
// tutor's prompt.
//
// What is exercised here is the picker's behaviour and the one request it makes.
// The markup ships everything hidden and the script decides, so none of this is
// visible in the HTML.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(WEB, 'board.html'), 'utf8');
const css = fs.readFileSync(path.join(WEB, 'board.css'), 'utf8');

const ids = new Set();
{
  const re = /\bid="([\w-]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
}

function stub(tag) {
  const el = {
    tagName: tag || 'div', dataset: {}, _classes: new Set(),
    style: { setProperty() {}, removeProperty() {} },
    hidden: false, disabled: false, value: '', textContent: '',
    children: [], childNodes: [], files: [], scrollHeight: 20, type: '',
    addEventListener() {}, removeChild() {}, after() {},
    insertBefore() {}, firstChild: null,
    setPointerCapture() {}, releasePointerCapture() {}, remove() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
    getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }),
  };
  el.classList = {
    add: (c) => el._classes.add(c),
    remove: (c) => el._classes.delete(c),
    toggle: (c, on) => (on === undefined
      ? (el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c))
      : (on ? el._classes.add(c) : el._classes.delete(c))),
    contains: (c) => el._classes.has(c),
  };
  el.appendChild = (kid) => { el.children.push(kid); return kid; };
  // A real element drops its children when innerHTML is set, and the picker
  // repaints itself on every tick. A stub that keeps them makes a list that
  // grows by three on every tap look like one that is being redrawn.
  let markup = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => markup,
    set: (v) => { markup = v; if (!v) el.children.length = 0; },
  });
  // Enough of a query to find the two spans a picker row is built from.
  el.querySelector = (sel) => {
    const want = sel.replace(/^\./, '');
    if (!el._parts) el._parts = {};
    return (el._parts[want] = el._parts[want] || stub('span'));
  };
  el.querySelectorAll = () => [];
  return el;
}

const registry = {};
const posts = [];
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  document: {
    getElementById(id) {
      if (!ids.has(id)) return null;
      return (registry[id] = registry[id] || stub());
    },
    createElement: (t) => stub(t),
    createDocumentFragment: () => stub(),
    querySelector: () => stub(), querySelectorAll: () => [],
    addEventListener() {},
    body: stub('body'), documentElement: stub('html'),
    title: '', hidden: false,
  },
  localStorage: { getItem: () => null, setItem() {} },
  EventSource: function () { return { close() {}, readyState: 1 }; },
  fetch: (url, opts) => {
    posts.push({ url, body: JSON.parse((opts && opts.body) || '{}') });
    return new Promise(() => {});
  },
  FormData: function () { this.append = () => {}; },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => '18px' }),
  navigator: { serviceWorker: undefined },
  isSecureContext: false,
  innerHeight: 800, scrollY: 0, devicePixelRatio: 2,
  scrollTo() {}, addEventListener() {}, print() {},
  location: { reload() {}, protocol: 'https:' },
  renderMathInElement: () => {},
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  ResizeObserver: function () { return { observe() {}, disconnect() {} }; },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let src = fs.readFileSync(path.join(WEB, 'board.js'), 'utf8');
src = src.replace('})();',
  'window.__render = render;\nwindow.__openReview = openReview;\n})();');
vm.runInContext(fs.readFileSync(path.join(WEB, 'macros.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(WEB, 'slate-core.js'), 'utf8'), sandbox);
vm.runInContext(src, sandbox, { filename: 'board.js' });

const render = sandbox.window.__render;
const openReview = sandbox.window.__openReview;
const now = Date.now() / 1000;

let fails = 0;
function check(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fails++; console.log('FAIL ' + name); }
}

const CHAPTERS = [
  { name: 'Ch 01 — Groups', label: 'Ch 01 — Groups', short: 'Ch 01', kind: 'chapter' },
  { name: 'Ch 02 — Rings', label: 'Ch 02 — Rings', short: 'Ch 02', kind: 'chapter' },
  { name: 'Ch 07 — Splitting fields', label: 'Ch 07 — Splitting fields',
    short: 'Ch 07', kind: 'chapter' },
];

function paint(session, scope, units) {
  render({
    state: { course: 'Galois Theory', mode: 'math', session,
             chapter: session === 'review'
               ? 'Test review — Ch 01, Ch 07' : 'Ch 02 — Rings' },
    cards: [{ id: '0001', kind: 'lesson', body: 'x', mtime: now }],
    turns: [], messages: [], uploads: [], slate: [],
    review: { of: (units || CHAPTERS)[0] && (units || CHAPTERS)[0].kind === 'part'
                ? 'parts' : 'chapters',
              units: units || CHAPTERS, scope: scope || [], total: 3 },
  });
}

// --- the strip ---------------------------------------------------------------
// Same argument as the homework strip: the state of the sitting is not visible
// on an iPad unless the board says it, and a scope nobody can see is a scope the
// tutor can quietly widen.
paint('lecture', []);
check('a lecture carries no review strip', registry.rvbar.hidden === true);
check('and the badge says lecture', registry.session.textContent === 'lecture');
check('and a lecture still shows the chapter it is in',
      /Ch 02/.test(registry.chapter.textContent));

paint('review', ['Ch 01 — Groups', 'Ch 07 — Splitting fields']);
check('a review sitting carries one', registry.rvbar.hidden === false);
check('naming what it covers',
      registry['rv-scope'].textContent.indexOf('Ch 01 — Groups') === 0
      && /Splitting fields/.test(registry['rv-scope'].textContent));
// The bar is at capacity: "TEST REVIEW" in the badge pushed the chapter label to
// "Tes…" and the tutor chip to "no". The strip underneath carries the full name,
// so the badge stays as short as the two beside it.
check('the badge stays short enough for the bar it is in',
      registry.session.textContent === 'review'
      && registry.session.textContent.length <= 'homework'.length
      && registry.session.dataset.kind === 'review');
check('and the strip underneath carries the full name',
      /<span id="rv-lead">\s*test review\s*<\/span>/.test(html));
// Three sayings of the same thing in one row: the badge, the chapter line and
// the strip. The chapter line is the one with no extra information in it, and
// the bar is the one row on this page that cannot grow.
check('and the chapter line does not repeat it back',
      registry.chapter.textContent === '');

// Reachable from a terminal, never from the picker: say what is missing rather
// than showing an empty strip, which reads as "nothing to see here".
paint('review', []);
check('a review with nothing chosen says so on the strip',
      /nothing chosen/.test(registry['rv-scope'].textContent));

// --- the picker --------------------------------------------------------------
paint('lecture', []);
openReview();
check('the picker opens', registry.review.hidden === false);
check('and asks about chapters in a course',
      /chapters/.test(registry['review-title'].textContent));
check('offering every chapter the course has',
      registry['review-list'].children.length === 3);
// A review over nothing is not a sitting, and starting one would file the lesson
// they are in away for no reason at all.
check('with nothing ticked there is nothing to start',
      registry['review-start'].disabled === true);
check('and it says so rather than leaving a blank',
      /nothing chosen/.test(registry['review-count'].textContent));

const rows = () => registry['review-list'].children;
rows()[0].onclick();
check('ticking one arms the start', registry['review-start'].disabled === false);
check('and the row shows it is ticked', rows()[0].classList.contains('on'));
check('and the count is honest', /1 of 3/.test(registry['review-count'].textContent));

rows()[2].onclick();
check('a review is over several chapters, not one',
      /2 of 3/.test(registry['review-count'].textContent));
rows()[2].onclick();
check('and a tick can be taken back', /1 of 3/.test(registry['review-count'].textContent));

registry['review-all'].onclick();
check('select all takes the lot', /3 of 3/.test(registry['review-count'].textContent));
check('and then offers to clear them', registry['review-all'].textContent === 'clear');
registry['review-all'].onclick();
check('which it does', registry['review-start'].disabled === true);

// --- starting one -------------------------------------------------------------
posts.length = 0;
rows()[0].onclick();
rows()[1].onclick();
registry['review-start'].onclick();
check('starting a review closes the picker', registry.review.hidden === true);
check('and asks for exactly one sitting, not one per chapter', posts.length === 1);
check('naming the kind and the whole scope in one request',
      posts[0].url === '/session'
      && posts[0].body.session === 'review'
      && posts[0].body.over.length === 2
      && posts[0].body.over[0] === 'Ch 01 — Groups');
// Everything sent is a name the server handed us. Nothing is typed anywhere in
// this flow, so nothing invented can reach the filesystem.
check('and every name sent came from the list the board was given',
      posts[0].body.over.every(
        (n) => CHAPTERS.some((c) => c.name === n)));

posts.length = 0;
paint('lecture', []);
openReview();
registry['review-start'].onclick();
check('a start with nothing chosen sends nothing at all, whatever is tapped',
      posts.length === 0);

// Re-opening is an edit of what the sitting already covers, not a fresh
// decision: "change" on the strip has to start from where you are.
paint('review', ['Ch 02 — Rings']);
openReview();
check('changing a running review starts from what it already covers',
      rows()[1].classList.contains('on') && !rows()[0].classList.contains('on'));

// --- a project ----------------------------------------------------------------
// The parts of a project, where there are no chapters. Same picker, same list
// discipline, different noun -- a project is not told it has chapters.
const PARTS = [
  { name: 'loader', label: 'loader/', short: 'loader', kind: 'part' },
  { name: 'pipeline', label: 'pipeline/', short: 'pipeline', kind: 'part' },
  { name: 'web', label: 'web/', short: 'web', kind: 'part' },
];
paint('lecture', [], PARTS);
openReview();
check('a project is asked about its parts, not its chapters',
      /parts of the project/.test(registry['review-title'].textContent)
      && !/chapters/.test(registry['review-title'].textContent));
check('and offers the parts it actually has',
      registry['review-list'].children.length === 3);

// --- a repository with nothing to review ---------------------------------------
paint('lecture', [], []);
openReview();
check('a repository with neither chapters nor parts says so',
      /nothing here to review/.test(registry['review-list'].children[0].textContent));
check('and cannot start a review over nothing',
      registry['review-start'].disabled === true);

// The chooser must not offer a kind of sitting this repository cannot hold.
registry.session.onclick();
check('and the badge does not offer test review there',
      registry['kind-review'].hidden === true);
paint('lecture', [], CHAPTERS);
registry.session.onclick();
check('while a course with chapters does', registry['kind-review'].hidden === false);

// --- the drawer is a drawer -----------------------------------------------------
// #contents carried a comment saying it borrowed the scratch drawer and an empty
// rule that borrowed nothing, so it laid out in the flow of the page under the
// lesson instead of over it. An ID selector is not inheritance, and the review
// picker is the third drawer to want the same shape.
const drawer = css.match(/#scratch[^{]*\{[^}]*position:\s*fixed[^}]*\}/);
check('the drawer rule exists at all', !!drawer);
check('and the contents panel is actually in it',
      !!drawer && /#contents\b/.test(drawer[0].split('{')[0]));
check('and so is the review picker',
      !!drawer && /#review\b/.test(drawer[0].split('{')[0]));

// [hidden] loses to any author rule that sets a display, and every panel here is
// shipped hidden. The guard lives in test/hidden.js; this only insists the
// picker is one of the things it protects, by using the attribute and nothing else.
check('the picker is hidden by the attribute, like every other panel',
      /<aside id="review" hidden>/.test(html));

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall review checks passed');
process.exit(fails ? 1 : 0);
