#!/usr/bin/env node
/**
 * Writes test/fixtures/export-variables-oracle.json: what real Emacs 29.3 (Org 9.6.15) exports for one document under each setting of the
 * export variables (`org-export-with-*`, `org-export-headline-levels`, `org-export-preserve-breaks`, `org-export-time-stamp-file`,
 * `org-export-global-macros`, `org-export-snippet-translation-alist`), as ASCII, HTML and LaTeX. test/export-variables-oracle.test.js
 * holds the app to it.
 *
 *   node tools/gen-export-variables-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SAMPLE = `#+TITLE: Sample title
#+AUTHOR: Ann Author
#+EMAIL: ann@example.org
#+DATE: 2024-05-01
#+MACRO: own from the file
#+MACRO: both file wins

Intro paragraph.

* TODO [#A] First heading [1/2] :work:home:
SCHEDULED: <2024-05-02 Thu> DEADLINE: <2024-05-09 Thu>
:PROPERTIES:
:ID: abc
:CUSTOM: value
:END:
:LOGBOOK:
CLOCK: [2024-05-01 Wed 09:00]--[2024-05-01 Wed 10:30] =>  1:30
- State "DONE" from "TODO" [2024-05-01 Wed 10:00]
:END:
:NOTES:
a note
:END:
Line one
line two with *bold* /italic/ =verbatim= and E_{sub} x^{sup} A_b -- dash ... dots.
Entity \\alpha and \\to and latex \\(a+b\\) and "quotes" and 'single'.
A footnote[fn:1] and a stamp <2024-05-03 Fri> and [2024-05-04 Sat].
: fixed width line

| a | b |
|---+---|
| 1 | 2 |

** DONE Second level :done:
CLOSED: [2024-05-01 Wed 12:00]
- [X] item [1/1]
*** Third level
**** Fourth level
Text four.
***** Fifth level
Text five.
* ARCHIVE entry :ARCHIVE:
Archived text.
* Excluded :noexport:
Excluded text.
* Plain
<2024-05-05 Sun>

[fn:1] The footnote text.
`;

/** A second document for the macros and snippets: each macro name is defined or not by the settings, so without them it is an error in Emacs too. */
export const SAMPLE_MACROS = `#+TITLE: Macros
#+MACRO: own from the file
#+MACRO: both file wins

Intro paragraph.

* Heading
Global {{{g(one)}}} own {{{own}}} both {{{both}}}.
Snippets @@h:<b>h</b>@@ @@html:<i>html</i>@@ @@l:\\textbf{l}@@ @@latex:\\textit{latex}@@ @@ascii:ascii@@ @@H:upper@@.
`;

/** [name, {variable: value text}, uses the macros document] */
export const CASES = [
  ['defaults', {}],
  ['toc nil', { 'org-export-with-toc': 'nil' }],
  ['toc 2', { 'org-export-with-toc': '2' }],
  ['headline-levels 2', { 'org-export-headline-levels': '2' }],
  ['headline-levels 1', { 'org-export-headline-levels': '1' }],
  ['preserve-breaks', { 'org-export-preserve-breaks': 't' }],
  ['section-numbers nil', { 'org-export-with-section-numbers': 'nil' }],
  ['section-numbers 2', { 'org-export-with-section-numbers': '2' }],
  ['time-stamp-file nil', { 'org-export-time-stamp-file': 'nil' }],
  ['archived-trees t', { 'org-export-with-archived-trees': 't' }],
  ['archived-trees nil', { 'org-export-with-archived-trees': 'nil' }],
  ['author nil', { 'org-export-with-author': 'nil' }],
  ['clocks t', { 'org-export-with-clocks': 't' }],
  ['clocks t, drawers t', { 'org-export-with-clocks': 't', 'org-export-with-drawers': 't' }],
  ['clocks nil, drawers t', { 'org-export-with-clocks': 'nil', 'org-export-with-drawers': 't' }],
  ['creator t', { 'org-export-with-creator': 't' }],
  ['date nil', { 'org-export-with-date': 'nil' }],
  ['drawers t', { 'org-export-with-drawers': 't' }],
  ['drawers nil', { 'org-export-with-drawers': 'nil' }],
  ['drawers list', { 'org-export-with-drawers': '("NOTES")' }],
  ['drawers not', { 'org-export-with-drawers': '(not "NOTES")' }],
  ['email t', { 'org-export-with-email': 't' }],
  ['emphasize nil', { 'org-export-with-emphasize': 'nil' }],
  ['entities nil', { 'org-export-with-entities': 'nil' }],
  ['fixed-width nil', { 'org-export-with-fixed-width': 'nil' }],
  ['footnotes nil', { 'org-export-with-footnotes': 'nil' }],
  ['inlinetasks nil', { 'org-export-with-inlinetasks': 'nil' }],
  ['latex nil', { 'org-export-with-latex': 'nil' }],
  ['html latex nil', { 'org-html-with-latex': 'nil' }],
  ['html latex verbatim', { 'org-html-with-latex': 'verbatim' }],
  ['latex verbatim', { 'org-export-with-latex': 'verbatim' }],
  ['planning t', { 'org-export-with-planning': 't' }],
  ['priority t', { 'org-export-with-priority': 't' }],
  ['properties t', { 'org-export-with-properties': 't' }],
  ['properties list', { 'org-export-with-properties': '("CUSTOM")' }],
  ['smart-quotes t', { 'org-export-with-smart-quotes': 't' }],
  ['special-strings nil', { 'org-export-with-special-strings': 'nil' }],
  ['statistics-cookies nil', { 'org-export-with-statistics-cookies': 'nil' }],
  ['sub-superscripts nil', { 'org-export-with-sub-superscripts': 'nil' }],
  ['sub-superscripts {}', { 'org-export-with-sub-superscripts': '{}' }],
  ['tables nil', { 'org-export-with-tables': 'nil' }],
  ['tags nil', { 'org-export-with-tags': 'nil' }],
  ['tags not-in-toc', { 'org-export-with-tags': 'not-in-toc' }],
  ['tasks nil', { 'org-export-with-tasks': 'nil' }],
  ['tasks todo', { 'org-export-with-tasks': 'todo' }],
  ['tasks done', { 'org-export-with-tasks': 'done' }],
  ['timestamps nil', { 'org-export-with-timestamps': 'nil' }],
  ['timestamps active', { 'org-export-with-timestamps': 'active' }],
  ['timestamps inactive', { 'org-export-with-timestamps': 'inactive' }],
  ['title nil', { 'org-export-with-title': 'nil' }],
  ['todo-keywords nil', { 'org-export-with-todo-keywords': 'nil' }],
  ['global macros', { 'org-export-global-macros': '(("g" . "GLOBAL $1") ("own" . "global") ("both" . "global"))' }, true],
  ['global macros, last of a name wins', { 'org-export-global-macros': '(("g" . "first $1") ("g" . "second $1") ("own" . "global") ("both" . "global"))' }, true],
  ['snippet translation', { 'org-export-global-macros': '(("g" . "x"))', 'org-export-snippet-translation-alist': '(("h" . "html") ("l" . "latex"))' }, true],
  ['snippet translation, first of a name wins', { 'org-export-global-macros': '(("g" . "x"))', 'org-export-snippet-translation-alist': '(("h" . "ascii") ("h" . "html") ("H" . "html"))' }, true],
  ['several', { 'org-export-with-toc': 'nil', 'org-export-with-todo-keywords': 'nil', 'org-export-with-tags': 'nil', 'org-export-with-priority': 't', 'org-export-headline-levels': '2' }],
];

const q = (/** @type {string} */ s) => JSON.stringify(s);
const lisp = (/** @type {[string, Record<string, string>][]} */ cases) => `(progn (require 'org) (require 'ox-ascii) (require 'ox-html) (require 'ox-latex)
(setq user-full-name "" user-mail-address "" org-export-use-babel nil org-export-with-broken-links nil org-html-validation-link nil org-tags-column 0)
(defvar h-sample ${q(SAMPLE)})
(defvar h-macros ${q(SAMPLE_MACROS)})
(defun h-run (backend vars &optional macros)
  (let ((saved (mapcar (lambda (v) (cons (car v) (symbol-value (car v)))) vars)))
    (unwind-protect
        (progn (dolist (v vars) (set (car v) (cdr v)))
          (with-temp-buffer (insert (if macros h-macros h-sample)) (org-mode)
            (condition-case err (org-export-as backend) (error (format "ERROR %S" err)))))
      (dolist (s saved) (set (car s) (cdr s))))))
(let (out)
  (dolist (c '(${cases.map(([n, v, m]) => `(${q(n)} ${m ? 't' : 'nil'} (${Object.entries(v).map(([k, val]) => `(${k} . ${val})`).join(' ')}))`).join('\n')}))
    (push (list (car c) (h-run 'ascii (nth 2 c) (nth 1 c)) (h-run 'html (nth 2 c) (nth 1 c)) (h-run 'latex (nth 2 c) (nth 1 c))) out))
  (princ (json-serialize (vconcat (mapcar (lambda (r) (vector (nth 0 r) (nth 1 r) (nth 2 r) (nth 3 r))) (nreverse out)))))))`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.SHOW_LISP) { console.log(lisp(CASES)); process.exit(0); }
  const r = spawnSync('emacs', ['-Q', '--batch', '--eval', lisp(CASES)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const start = r.stdout.indexOf('[[');
  if (r.status !== 0 || start < 0) {
    console.error(r.stderr.slice(-1500));
    process.exit(1);
  }
  const rows = JSON.parse(r.stdout.slice(start));
  const cases = rows.map(([name, ascii, html, latex], i) => ({ name, vars: CASES[i][1], macros: Boolean(CASES[i][2]), ascii, html, latex }));
  fs.writeFileSync(new URL('../test/fixtures/export-variables-oracle.json', import.meta.url), JSON.stringify({ sample: SAMPLE, sampleMacros: SAMPLE_MACROS, cases }, null, 1) + '\n');
  console.log(cases.length, 'cases');
}
