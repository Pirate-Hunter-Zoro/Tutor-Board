// Every macro in web/macros.js must actually parse in KaTeX, and so must a
// representative sample of the mathematics a lesson will contain. A macro that
// throws would otherwise show up as a red smear on the board mid-lesson.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const katex = require(path.join(ROOT, 'web', 'katex', 'katex.min.js'));

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'web', 'macros.js'), 'utf8'), sandbox);
const MACROS = sandbox.window.BOARD_MACROS;

let fails = 0;
function render(name, tex, display) {
  try {
    katex.renderToString(tex, {
      macros: JSON.parse(JSON.stringify(MACROS)),
      displayMode: !!display,
      throwOnError: true,
      strict: false,
      trust: true,
    });
    return true;
  } catch (e) {
    fails++;
    console.log('FAIL ' + name + '\n   ' + tex + '\n   ' + e.message.split('\n')[0]);
    return false;
  }
}

// Exercise each macro with the right number of dummy arguments.
const names = Object.keys(MACROS);
const NEEDS_CONTEXT = { '\\given': true };  // only legal inside \left ... \right
names.forEach(function (name) {
  if (NEEDS_CONTEXT[name]) return;
  const def = MACROS[name];
  let arity = 0;
  for (let n = 1; n <= 9; n++) if (def.indexOf('#' + n) !== -1) arity = n;
  let call = name;
  if (name === '\\hl') call = '\\hl{yellow}{x}';
  else for (let n = 0; n < arity; n++) call += '{x}';
  render('macro ' + name, call + (arity === 0 && /operatorname|mathbb|mathrm|mathbf/.test(def) ? '' : ''));
});
console.log(names.length + ' macros exercised');

// Real formulas of the kind the two courses will actually put on the board.
[
  ['degree tower', '\\degree{L}{\\QQ} = \\degree{L}{K}\\,\\degree{K}{\\QQ} = 6'],
  ['galois group', '\\GalG{L}{\\QQ} \\iso \\Symn{3}'],
  ['fixed field', '\\Fix(H) = \\setst{x \\in L}{\\sigma(x) = x \\ \\forall \\sigma \\in H}'],
  ['minimal poly', '\\minpoly{\\alpha}{K}(x) = x^3 - 2 \\in \\polyring{\\QQ}{x}'],
  ['finite field', '\\Fq{p^n} \\iso \\Zmod{p}[x]/\\ideal{f}'],
  ['frobenius', '\\Frob\\colon x \\mapsto x^{p}, \\quad \\charac(K) = p'],
  ['normal subgroup', 'H \\normal G, \\quad \\idx{G}{H} = 2'],
  ['cyclotomic', '\\cyclotomic{n}(x) = \\prod_{\\gcd(k,n)=1} (x - \\zeta^k)'],
  ['units and gen', '\\units{\\Fq{q}} = \\gen{g}, \\quad \\ord(g) = q - 1'],
  ['iso arrow', '\\QQ(\\sqrt[3]{2}) \\isoto \\QQ[x]/\\ideal{x^3-2}'],
  ['restriction', '\\restrict{\\sigma}{K} = \\mathrm{id}_K'],
  ['trace and norm', '\\Tr(\\alpha) + \\Norm(\\alpha) \\ne \\disc'],
  ['transcendence', '\\trdeg(\\ext{L}{K}) = 1, \\quad \\algclos{\\QQ} \\subset \\CC'],
  ['probability', '\\PP(X \\le t) = \\EE[\\ind\\{X \\le t\\}]'],
  ['variance', '\\Var(X) = \\EE[X^2] - (\\EE[X])^2, \\quad \\Cov(X,Y) = 0'],
  ['convergence', 'X_n \\dto X, \\quad \\bar{X}_n \\asto \\mu, \\quad X \\indep Y'],
  ['conditional', '\\PP\\left(A \\given B\\right) = \\frac{\\PP(A \\cap B)}{\\PP(B)}'],
  ['aligned block', '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', true],
  ['cases', 'f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}', true],
  ['array', '\\begin{array}{c|cc} \\cdot & e & \\sigma \\\\ \\hline e & e & \\sigma \\end{array}', true],
  ['matrix', '\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}', true],
  ['highlight', '\\hl{yellow}{x^3 - 2} \\text{ is irreducible}'],
].forEach(function (row) { render(row[0], row[1], row[2]); });

console.log(fails ? '\n' + fails + ' FAILURES' : '\nall macro checks passed');
process.exit(fails ? 1 : 0);
