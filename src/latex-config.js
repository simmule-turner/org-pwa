// @ts-check
/**
 * The ox-latex variables an init text can set (Settings → Export → LaTeX): `org-latex-classes`, `org-latex-packages-alist`,
 * `org-latex-src-block-backend` (and its old name `org-latex-listings`), and the listings and minted options and language tables.
 * Their defaults are Org 9.6's. See lisp-read.js for the forms an init text may use.
 */

import { runInit, readLisp, listItems, stringValue, symbolName, isNil } from './lisp-read.js';

/** @typedef {import('./lisp-read.js').Lisp} Lisp */
/**
 * A sectioning level of a class: how Org's `org-latex-classes` writes a heading. `fmt` has two `%s`: the title, then everything the heading holds.
 * @typedef {{ numbered: string | null, unnumbered: string | null }} Sectioning
 * @typedef {{ name: string, header: string, sections: (Sectioning | null)[] }} LatexClass
 * @typedef {{ options: string, name: string, compilers: string[] | null }} LatexPackage
 * @typedef {{ classes: LatexClass[], packages: (string | LatexPackage)[], backend: 'verbatim' | 'listings' | 'minted' | 'engraved', listingsOptions: [string, string | null][], listingsLangs: Map<string, string>, mintedOptions: [string, string | null][], mintedLangs: Map<string, string> }} LatexConfig
 */

const DEFAULT_INIT = `
(setq org-latex-classes
  '(("article" "\\\\documentclass[11pt]{article}"
     ("\\\\section{%s}" . "\\\\section*{%s}") ("\\\\subsection{%s}" . "\\\\subsection*{%s}")
     ("\\\\subsubsection{%s}" . "\\\\subsubsection*{%s}") ("\\\\paragraph{%s}" . "\\\\paragraph*{%s}")
     ("\\\\subparagraph{%s}" . "\\\\subparagraph*{%s}"))
    ("report" "\\\\documentclass[11pt]{report}"
     ("\\\\part{%s}" . "\\\\part*{%s}") ("\\\\chapter{%s}" . "\\\\chapter*{%s}")
     ("\\\\section{%s}" . "\\\\section*{%s}") ("\\\\subsection{%s}" . "\\\\subsection*{%s}")
     ("\\\\subsubsection{%s}" . "\\\\subsubsection*{%s}"))
    ("book" "\\\\documentclass[11pt]{book}"
     ("\\\\part{%s}" . "\\\\part*{%s}") ("\\\\chapter{%s}" . "\\\\chapter*{%s}")
     ("\\\\section{%s}" . "\\\\section*{%s}") ("\\\\subsection{%s}" . "\\\\subsection*{%s}")
     ("\\\\subsubsection{%s}" . "\\\\subsubsection*{%s}"))))
(setq org-latex-listings-langs
  '((emacs-lisp "Lisp") (lisp "Lisp") (clojure "Lisp") (c "C") (cc "C++") (fortran "fortran")
    (perl "Perl") (cperl "Perl") (python "Python") (ruby "Ruby") (html "HTML") (xml "XML")
    (tex "TeX") (latex "[LaTeX]TeX") (shell-script "bash") (gnuplot "Gnuplot")
    (ocaml "[Objective]Caml") (caml "Caml") (sql "SQL") (sqlite "sql") (makefile "make") (R "r")))
(setq org-latex-minted-langs
  '((emacs-lisp "common-lisp") (cc "c++") (cperl "perl") (shell-script "bash") (caml "ocaml")))
`;

/** @param {Lisp | undefined} f @returns {string | null} */
const str = (f) => stringValue(f);

/**
 * One sectioning entry as Org reads it: a string, a `(numbered . unnumbered)` pair, or a list of two or four strings.
 * @param {Lisp} f
 * @returns {Sectioning | null}
 */
function sectioning(f) {
  const only = str(f);
  if (only !== null) return { numbered: only + '\n%s', unnumbered: only + '\n%s' };
  if (f.k !== 'list') return null;
  if (f.tail) {
    const a = str(f.items[0]);
    const b = str(f.tail);
    return a !== null && b !== null && f.items.length === 1 ? { numbered: a + '\n%s', unnumbered: b + '\n%s' } : null;
  }
  const strings = f.items.map(str);
  if (strings.some((s) => s === null)) return null;
  const s = /** @type {string[]} */ (strings);
  if (s.length === 2) return { numbered: s[0] + '\n%s' + s[1], unnumbered: null };
  if (s.length === 4) return { numbered: s[0] + '\n%s' + s[1], unnumbered: s[2] + '\n%s' + s[3] };
  return null;
}

/** @param {Lisp | undefined} value @returns {LatexClass[]} */
function classesOf(value) {
  /** @type {LatexClass[]} */
  const out = [];
  for (const entry of listItems(value) || []) {
    const items = listItems(entry);
    if (!items) continue;
    const name = str(items[0]);
    const header = str(items[1]);
    if (name === null || header === null) continue;
    out.push({ name, header, sections: items.slice(2).map(sectioning) });
  }
  return out;
}

/** @param {Lisp | undefined} value @returns {(string | LatexPackage)[]} */
function packagesOf(value) {
  /** @type {(string | LatexPackage)[]} */
  const out = [];
  for (const entry of listItems(value) || []) {
    const text = str(entry);
    if (text !== null) {
      out.push(text);
      continue;
    }
    const items = listItems(entry);
    if (!items) continue;
    const options = str(items[0]);
    const name = str(items[1]);
    if (options === null || name === null) continue;
    const comps = items[3] && !isNil(items[3]) ? (listItems(items[3]) || []).map(str).filter((x) => x !== null) : null;
    out.push({ options, name, compilers: comps && /** @type {string[]} */ (comps) });
  }
  return out;
}

/** An alist of `("key" "value")`, `("key" . "value")` or `("key")` entries. @param {Lisp | undefined} value @returns {[string, string | null][]} */
function optionsOf(value) {
  /** @type {[string, string | null][]} */
  const out = [];
  for (const entry of listItems(value) || []) {
    if (entry.k !== 'list') continue;
    const key = str(entry.items[0]);
    if (key === null) continue;
    out.push([key, entry.tail ? str(entry.tail) : entry.items[1] ? str(entry.items[1]) : null]);
  }
  return out;
}

/** An alist from a language symbol to its name in the other package. @param {Lisp | undefined} value @returns {Map<string, string>} */
function langsOf(value) {
  const out = new Map();
  for (const entry of listItems(value) || []) {
    const items = listItems(entry);
    const lang = items && symbolName(items[0]);
    const name = items && str(items[1]);
    if (lang && name !== null && name !== undefined && !out.has(lang)) out.set(lang, name);
  }
  return out;
}

/** @type {Map<string, Lisp> | null} */
let defaults = null;

/**
 * The LaTeX settings: Org's defaults with the init text on top.
 * @param {string | undefined} init
 * @returns {LatexConfig}
 */
export function latexConfig(init) {
  if (!defaults) defaults = runInit(DEFAULT_INIT);
  const vars = init && init.trim() ? runInit(init, defaults, { 'org-latex-listings': 'org-latex-src-block-backend' }) : defaults;
  const wanted = vars.get('org-latex-src-block-backend');
  const name = wanted ? (symbolName(wanted) === 't' ? 'listings' : symbolName(wanted)) : 'verbatim';
  const backend = name === 'listings' || name === 'minted' || name === 'engraved' ? name : 'verbatim';
  return {
    classes: classesOf(vars.get('org-latex-classes')),
    packages: packagesOf(vars.get('org-latex-packages-alist')),
    backend,
    listingsOptions: optionsOf(vars.get('org-latex-listings-options')),
    listingsLangs: langsOf(vars.get('org-latex-listings-langs')),
    mintedOptions: optionsOf(vars.get('org-latex-minted-options')),
    mintedLangs: langsOf(vars.get('org-latex-minted-langs')),
  };
}

/** The names of the classes an init text defines, for the Settings class list. @param {string | undefined} init */
export function latexClassNames(init) {
  return [...new Set(latexConfig(init).classes.map((c) => c.name))];
}

/** Parses an init text only to tell whether it has anything the exporter reads (for the "N set" count). @param {string | undefined} init */
export function hasLatexInit(init) {
  return !!init && readLisp(init).length > 0;
}
