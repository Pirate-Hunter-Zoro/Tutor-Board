/* ==========================================================================
   macros.js -- KaTeX macro vocabulary.

   These mirror latex/coursemacros.sty in the course repositories, so a command
   written on the board is the same command that later goes into a .tex file.
   Anything KaTeX cannot express (tikz, tikz-cd, theorem environments) is not
   here -- those go in a ```tikz fence and are compiled server-side to SVG.
   ========================================================================== */

window.BOARD_MACROS = {
  /* number systems */
  "\\NN": "\\mathbb{N}",
  "\\ZZ": "\\mathbb{Z}",
  "\\QQ": "\\mathbb{Q}",
  "\\RR": "\\mathbb{R}",
  "\\CC": "\\mathbb{C}",
  "\\FF": "\\mathbb{F}",
  "\\Fq": "\\mathbb{F}_{#1}",
  "\\Zmod": "\\mathbb{Z}/#1\\mathbb{Z}",

  /* fields and extensions (Garling's colon notation) */
  "\\ext": "#1\\!:\\!#2",
  "\\degree": "[#1\\!:\\!#2]",
  "\\adjoin": "#1(#2)",
  "\\polyring": "#1[#2]",
  "\\minpoly": "m_{#1,#2}",
  "\\algclos": "\\overline{#1}",
  "\\charac": "\\operatorname{char}",
  "\\Frob": "\\operatorname{Frob}",

  /* groups */
  "\\Gal": "\\Gamma",
  "\\GalG": "\\Gamma(#1\\!:\\!#2)",
  "\\Aut": "\\operatorname{Aut}",
  "\\Mon": "\\operatorname{Mon}",
  "\\Fix": "\\operatorname{Fix}",
  "\\Sym": "\\Sigma",
  "\\Symn": "\\Sigma_{#1}",
  "\\Alt": "A",
  "\\Altn": "A_{#1}",
  "\\ord": "\\operatorname{ord}",
  "\\im": "\\operatorname{im}",
  "\\Ker": "\\operatorname{ker}",
  "\\normal": "\\trianglelefteq",
  "\\gen": "\\langle #1 \\rangle",
  "\\idx": "[#1:#2]",

  /* rings */
  "\\Frac": "\\operatorname{Frac}",
  "\\cont": "\\operatorname{cont}",
  "\\hcf": "\\operatorname{hcf}",
  "\\ideal": "\\left(#1\\right)",
  "\\units": "#1^{\\times}",

  /* polynomials and Galois-theoretic quantities */
  "\\disc": "\\Delta",
  "\\Norm": "\\mathrm{N}",
  "\\Tr": "\\operatorname{tr}",
  "\\trdeg": "\\operatorname{tr.deg}",
  "\\cyclotomic": "\\Phi_{#1}",
  "\\derivative": "D#1",

  /* odds and ends */
  "\\restrict": "\\left.#1\\right|_{#2}",
  "\\set": "\\left\\{#1\\right\\}",
  "\\setst": "\\left\\{#1 \\;\\middle|\\; #2\\right\\}",
  "\\abs": "\\left|#1\\right|",
  "\\iso": "\\cong",
  "\\isoto": "\\xrightarrow{\\ \\sim\\ }",
  "\\into": "\\hookrightarrow",
  "\\onto": "\\twoheadrightarrow",
  "\\divides": "\\mid",
  "\\ndivides": "\\nmid",

  /* probability, for the sibling course */
  "\\PP": "\\mathbb{P}",
  "\\EE": "\\mathbb{E}",
  "\\Var": "\\operatorname{Var}",
  "\\Cov": "\\operatorname{Cov}",
  "\\Corr": "\\operatorname{Corr}",
  "\\indep": "\\perp\\!\\!\\!\\perp",
  "\\ind": "\\mathbf{1}",
  "\\dto": "\\xrightarrow{\\;d\\;}",
  "\\pto": "\\xrightarrow{\\;p\\;}",
  "\\asto": "\\xrightarrow{\\;a.s.\\;}",
  "\\given": "\\mathrel{}\\middle|\\mathrel{}",

  /* highlight -- for pointing at the piece of an expression under discussion */
  "\\hl": "\\colorbox{#1}{$\\displaystyle #2$}"
};
