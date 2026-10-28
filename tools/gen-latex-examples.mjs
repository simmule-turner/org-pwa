#!/usr/bin/env node
/**
 * Writes examples/export-latex.org and examples/citations.org: each section has an Org text, the settings it needs, and the LaTeX
 * body Emacs 29.3 (Org 9.6.15) wrote for it. test/example-export-latex.test.js holds the app to every section.
 *   node tools/gen-latex-examples.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const examples = path.join(here, '..', 'examples');

const LATEX = [
  {
    file: 'export-latex.org',
    title: 'LaTeX export',
    intro: 'A cookbook for the LaTeX export (=C-c C-e l l= in Emacs, More → Export → LaTeX in the app). Each section shows an Org text, the settings it needs, and the body of the =.tex= file Emacs 29.3 (Org 9.6.15) wrote for it, the part between =\\begin{document}= and =\\end{document}=. The app writes the same text. Label hashes (=sec:org…=) are numbered by first use, as they differ on every run. Settings go in Settings → Export → LaTeX, in the Lisp box. The last section says where the app differs from Emacs.',
    cases: [
      { title: 'A macro with a template', text: 'A =#+MACRO:= is replaced by its text; =$1=, =$2= are the arguments.', org: '#+MACRO: version 1.2\n#+MACRO: greet Hello, $1!\n* Notes\nRelease {{{version}}}. {{{greet(world)}}}\n' },
      { title: 'A macro that runs Lisp', text: 'A template that starts with =(eval= is evaluated. The arguments are strings, and what the form returns is written as text. An error stops the export.', org: '#+MACRO: gnustamp (eval (concat "GNU/" (capitalize $1)))\n#+MACRO: plural (eval (if (equal $1 "1") (concat $1 " file") (concat $1 " files")))\n* Notes\nRunning {{{gnustamp(linux)}}} on {{{plural(1)}}}, then {{{plural(3)}}}.\n' },
      { title: 'Headlines', text: 'A TODO keyword and tags are written as =ox-latex= writes them, the tags at the right of the title. A priority shows only with =pri:t=.', org: '#+OPTIONS: pri:t\n* TODO [#A] Write the report :work:urgent:\n** DONE Outline\n* Plain heading\n' },
      { title: 'Leaving the keyword, priority and tags out', text: '=todo:nil=, =pri:t= and =tags:nil= in =#+OPTIONS:= choose what a headline shows.', org: '#+OPTIONS: todo:nil pri:t tags:nil\n* TODO [#B] Write the report :work:\n' },
      { title: 'Your own headline format', text: '=org-latex-format-headline-function= is called for every section title and low-level list headline with the keyword, its type (=todo= or =done=), the priority as a character code, the title, the tags and the export info. Whatever it returns is the headline.', init: '(setq org-latex-format-headline-function\n      (lambda (todo todo-type priority text tags info)\n        (concat (if todo (format "[%s] " todo) "")\n                text\n                (if tags (concat " #" (mapconcat #\'identity tags ",")) ""))))', org: '* TODO Write the report :work:\n* Read the notes\n' },
      { title: 'A named headline function', text: 'A function you define can be given by name.', init: '(defun my-headline (todo todo-type priority text tags info)\n  (if (eq todo-type (quote done))\n      (concat "\\\\sout{" text "}")\n    text))\n(setq org-latex-format-headline-function #\'my-headline)', org: '* TODO Open task\n* DONE Finished task\n' },
      { title: 'A different class', text: '=org-latex-classes= defines a class and its sectioning commands. =#+LATEX_CLASS:= picks it for one file.', init: '(add-to-list \'org-latex-classes\n  \'("memo" "\\\\documentclass{article}"\n    ("\\\\section*{%s}" . "\\\\section*{%s}")\n    ("\\\\subsection*{%s}" . "\\\\subsection*{%s}")))', org: '#+LATEX_CLASS: memo\n* To the team\n** Schedule\nWe meet on Friday.\n' },
      { title: 'A table with attributes', text: '=#+ATTR_LATEX:= sets the column alignment, the table environment and booktabs rules.', org: '#+CAPTION: Prices\n#+ATTR_LATEX: :align lrr :booktabs t\n| Item | Price | Qty |\n|------+-------+-----|\n| Pen  |  1.50 |   4 |\n| Book | 12.00 |   2 |\n' },
      { title: 'A figure', text: 'A link to an image with a caption becomes a =figure=. =:width= and =:placement= go in =#+ATTR_LATEX:=.', org: '#+CAPTION: A cat\n#+NAME: fig-cat\n#+ATTR_LATEX: :width 0.5\\textwidth :placement [h]\n[[file:cat.png]]\n\nSee [[fig-cat]].\n' },
      { title: 'A link to a figure by name', text: 'A link whose target is the =#+NAME:= of a figure, even a name with a colon, is a reference to it.', org: '#+CAPTION: A cat\n#+NAME: fig:cat\n[[file:cat.png]]\n\nSee [[fig:cat]].\n' },
    ],
    differs: ['=org-latex-format-headline-function= is called with =nil= in place of the export info, so a function that reads it sees nothing.', 'A macro =(eval ..)= runs on the app\'s own Lisp interpreter (see the Lisp init), not on Emacs, so a function the interpreter does not have gives an error.'],
  },
  {
    file: 'citations.org',
    title: 'Citations',
    bib: true,
    intro: 'A cookbook for citations. Point =#+BIBLIOGRAPHY:= at a file (=refs.bib= beside these examples) and write =[cite:@key]=. The LaTeX that Emacs 29.3 (Org 9.6.15) writes for each text is shown, the part between =\\begin{document}= and =\\end{document}=, and the app writes the same. The =basic= processor, which is the default, writes the citation as text and the reference list as paragraphs; =natbib= and =biblatex= write commands for LaTeX to resolve. The last section says where the app differs from Emacs.',
    cases: [
      { title: 'A citation and its list', text: 'The default style is author and year. =#+PRINT_BIBLIOGRAPHY:= marks where the reference list goes.', org: '#+BIBLIOGRAPHY: refs.bib\n* Notes\nSee [cite:@knuth84] and [cite:@knuth84;@lamport94].\n\n* References\n#+PRINT_BIBLIOGRAPHY:\n' },
      { title: 'Styles', text: '=/t= is the text style, =/na= leaves the author out, =/b= is the bare form, and =/n= prints nothing.', org: '#+BIBLIOGRAPHY: refs.bib\n* Notes\n[cite/t:@knuth84], [cite/na:@knuth84], [cite/b:@knuth84], [cite/n:@three].\n' },
      { title: 'Prefix, suffix and page numbers', text: 'Text before a key is its prefix, and text after it is its suffix.', org: '#+BIBLIOGRAPHY: refs.bib\n* Notes\nDetails in [cite:see @knuth84, p. 5] and [cite/t:@lamport94, chapter 2].\n' },
      { title: 'Several authors', text: 'The basic processor shortens a long author list.', org: '#+BIBLIOGRAPHY: refs.bib\n* Notes\nPrior work: [cite:@three].\n\n#+PRINT_BIBLIOGRAPHY:\n' },
      { title: 'natbib', text: '=#+CITE_EXPORT: natbib= leaves the work to LaTeX: =\\citep{}=, =\\citet{}= and a =\\bibliography{}= line. The style after the processor name becomes =\\bibliographystyle{}=.', org: '#+CITE_EXPORT: natbib plain\n#+BIBLIOGRAPHY: refs.bib\n* Notes\nSee [cite:@knuth84], [cite/t:@lamport94] and [cite/a:@knuth84].\n\n#+PRINT_BIBLIOGRAPHY:\n' },
      { title: 'biblatex', text: '=#+CITE_EXPORT: biblatex= writes =\\autocite{}=, =\\textcite{}= and =\\printbibliography=.', org: '#+CITE_EXPORT: biblatex\n#+BIBLIOGRAPHY: refs.bib\n* Notes\nSee [cite:@knuth84], [cite/t:@lamport94] and [cite/a:@knuth84].\n\n#+PRINT_BIBLIOGRAPHY:\n' },
      { title: 'The author alone', text: '=/a= (the author alone) prints the author in HTML and plain text, but Org 9.6.15\'s LaTeX export stops with an error; the app stops with the same one.', org: '#+BIBLIOGRAPHY: refs.bib\n* Notes\nBy [cite/a:@knuth84].\n' },
    ],
    differs: [
    ],
  },
];

const el = `
(require 'org) (require 'ox-latex) (require 'json) (require 'oc) (require 'oc-basic) (require 'oc-natbib) (require 'oc-biblatex)
(setq org-export-with-broken-links nil)
(defun run-case (org init dir name)
  (let ((file (expand-file-name (concat name ".org") dir)))
    (with-temp-file file (insert org))
    (with-current-buffer (find-file-noselect file)
      (let ((inhibit-message t)
            (org-latex-classes (copy-sequence org-latex-classes))
            (org-latex-format-headline-function #'org-latex-format-headline-default-function))
        (unwind-protect
            (condition-case e
                (progn (when (and init (not (string= init ""))) (eval (read (concat "(progn " init ")")) nil))
                       (org-export-as 'latex nil nil nil))
              (error (concat "ERROR " (error-message-string e))))
          (set-buffer-modified-p nil) (kill-buffer))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-array-type 'list) (json-object-type 'alist) (cs (json-read-from-string (buffer-string))) (out '()) (i 0))
    (dolist (c cs)
      (push (run-case (cdr (assq 'org c)) (cdr (assq 'init c)) (getenv "ORACLE_DIR") (format "case%d" (setq i (1+ i)))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;

/** The body of a .tex file, with Org's random label hashes numbered by first use. @param {string} tex */
export function bodyOf(tex) {
  const ids = new Map();
  const a = tex.indexOf('\\begin{document}');
  const b = tex.lastIndexOf('\\end{document}');
  const body = a < 0 ? tex : tex.slice(a + '\\begin{document}'.length, b);
  return body
    .replace(/^\\(maketitle|tableofcontents)\s*$/gm, '')
    .replace(/\\(bibliography|addbibresource)\{[^}]*\/(refs(?:\.bib)?)\}/g, '\\$1{$2}')
    .replace(/org[0-9a-f]{7}/g, (id) => {
      if (!ids.has(id)) ids.set(id, 'org' + String(ids.size + 1).padStart(7, '0'));
      return ids.get(id);
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const esc = (/** @type {string} */ t) => t.split('\n').map((l) => (/^\s*(\*|#\+)/.test(l) ? ',' + l : l)).join('\n');

for (const group of LATEX) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-ex-'));
  fs.copyFileSync(path.join(examples, 'refs.bib'), path.join(dir, 'refs.bib'));
  fs.writeFileSync(path.join(dir, 'run.el'), el);
  fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(group.cases.map((c) => ({ org: c.org, init: c.init || '' }))));
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json'), ORACLE_DIR: dir }, encoding: 'utf8', input: '' });
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(1);
  }
  const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
  let out = `#+TITLE: ${group.title}\n#+STARTUP: showall\n\n${group.intro}\n`;
  group.cases.forEach((c, i) => {
    const res = results[i];
    if (res.startsWith('ERROR')) console.error(`${group.file}: "${c.title}" -> ${res}`);
    out += `\n* ${c.title}\n${c.text}\n\n#+begin_src org\n${esc(c.org.trimEnd())}\n#+end_src\n`;
    if (c.init) out += `\nSettings:\n\n#+begin_src emacs-lisp\n${esc(c.init)}\n#+end_src\n`;
    out += `\nEmacs writes:\n\n#+begin_src latex\n${esc(res.startsWith('ERROR') ? res : bodyOf(res))}\n#+end_src\n`;
  });
  if (group.differs.length) out += `\n* Where the app differs from Emacs\n${group.differs.map((d) => '- ' + d).join('\n')}\n`;
  fs.writeFileSync(path.join(examples, group.file), out);
  console.log(`wrote examples/${group.file}`);
}
