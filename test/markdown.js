// Harness: run board.js in a stub DOM and exercise renderMarkdown.
const fs = require('fs');
const path = require('path').join(__dirname, '..', 'web', 'board.js');

function stubEl() {
  const el = {
    style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){} },
    hidden: false, value: '', textContent: '', innerHTML: '', files: [],
    addEventListener(){}, appendChild(){}, querySelector(){ return stubEl(); },
    scrollHeight: 0,
  };
  Object.defineProperty(el, 'onclick', { set(){}, get(){ return null; } });
  return el;
}
global.document = {
  getElementById: () => stubEl(),
  createElement: () => stubEl(),
  createDocumentFragment: () => stubEl(),
  addEventListener(){}, body: { scrollHeight: 0, dataset: {}, classList: { toggle(){} } },
  documentElement: { style: { setProperty(){} } },
  title: '', hidden: false,
};
global.window = global;
global.localStorage = { getItem(){ return null; }, setItem(){} };
global.EventSource = function(){ return { close(){}, readyState: 1 }; };
global.getComputedStyle = () => ({ getPropertyValue: () => '18px' });
global.matchMedia = () => ({ matches: false, addEventListener(){} });
global.addEventListener = () => {};
global.scrollTo = () => {};
global.fetch = () => Promise.resolve({});
global.renderMathInElement = () => {};
global.innerHeight = 800; global.scrollY = 0;
global.FormData = function(){ this.append = () => {}; };
global.setTimeout = setTimeout;

let src = fs.readFileSync(path, 'utf8');
// expose the internals for testing
src = src.replace('})();', 'window.__test = { renderMarkdown, inline, protect, restore };\n})();');
eval(src);

const R = window.__test.renderMarkdown;
let fails = 0;
function check(name, md, mustContain, mustNotContain) {
  const out = R(md);
  const bad = [];
  (mustContain || []).forEach(s => { if (out.indexOf(s) === -1) bad.push('missing: ' + s); });
  (mustNotContain || []).forEach(s => { if (out.indexOf(s) !== -1) bad.push('present: ' + s); });
  if (bad.length) { fails++; console.log('FAIL ' + name); bad.forEach(b => console.log('   ' + b)); console.log('   got: ' + out.replace(/\n/g,' ').slice(0,300)); }
  else console.log('ok   ' + name);
}

check('heading', '## Splitting fields', ['<h2>Splitting fields</h2>']);
check('paragraph', 'Plain text here.', ['<p>Plain text here.</p>']);
check('inline math untouched by emphasis',
  'Let $a_1 * a_2$ and $x_i$ be given.',
  ['$a_1 * a_2$', '$x_i$'], ['<em>']);
check('display math',
  'Then\n\n$$\n\\degree{L}{\\QQ} = 6\n$$\n\ndone.',
  ['\\degree{L}{\\QQ} = 6', '<p>done.</p>']);
check('bracket display math', 'text\n\n\\[ x^2 \\]\n\nmore', ['x^2']);
check('bold and italic', 'This is **bold** and *slanted*.', ['<strong>bold</strong>', '<em>slanted</em>']);
check('underscore in math not escaped',
  '$\\alpha_1$ and _real_ emphasis',
  ['$\\alpha_1$', '<em>real</em>']);
check('inline code', 'run `make split` now', ['<code>make split</code>']);
check('fenced code', 'a\n\n```\nx = 1\n```\n\nb', ['<pre><code>x = 1</code></pre>']);
check('bullet list', '- alpha\n- beta\n', ['<ul>', '<li>alpha</li>', '<li>beta</li>', '</ul>']);
check('ordered list', '1. first\n2. second\n', ['<ol>', '<li>first</li>']);
check('nested list', '- outer\n  - inner\n', ['<ul>', '<li>outer<ul><li>inner</li></ul></li>']);
check('list with math', '- $x$ has degree $2$\n', ['<li>', 'math-raw']);
check('table', '| a | b |\n|---|---|\n| 1 | 2 |\n', ['<table>', '<th', '>a</th>', '<td', '>1</td>']);
check('table with math cells', '| root | value |\n|---|---|\n| $\\alpha$ | $\\omega\\sqrt[3]{2}$ |\n',
  ['$\\alpha$', '$\\omega\\sqrt[3]{2}$']);
check('hr', 'a\n\n---\n\nb', ['<hr>']);
check('blockquote', '> quoted line', ['<blockquote>', 'quoted line']);
check('figure ready', '@@FIGURE:abc123:ready@@', ['<img alt="figure" src="/figure/abc123.svg">']);
check('figure pending', '@@FIGURE:abc123:pending@@', ['compiling figure']);
// `>` is left unescaped on purpose so blockquote lines still match; `&lt;script>`
// is inert text, which is what matters.
check('html escaped in prose', 'if a < b then <script>alert(1)</script>',
  ['&lt;', '&lt;script&gt;alert(1)&lt;/script&gt;'.replace(/&gt;/g, '>')], ['<script>']);
check('math with less-than survives', '$a < b$', ['$a &lt; b$']);
check('escaped dollar', 'costs \\$5 today', ['$5']);
check('link', '[Garling](https://example.com)', ['<a href="https://example.com"']);
check('multiline paragraph joins', 'one\ntwo', ['<p>one two</p>']);
check('adjacent inline math', '$a$ and $b$', ['$a$', '$b$']);
check('starred command not italic', 'use $x^*y^*z$ here', ['$x^*y^*z$'], ['<em>']);

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall markdown checks passed');
process.exit(fails ? 1 : 0);
