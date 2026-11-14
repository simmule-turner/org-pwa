#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-export-fixes.json: what Emacs 29.3 (Org 9.6) exports for the documents below, each of which holds one
 * rule of the export framework the other fixtures do not reach: the default and file-level select/exclude tags and tag groups,
 * footnote definitions in trees that are left out, the footnote separator, inline tasks, timestamps (day names, `<:`), the
 * `::`, `tex`, `-` and `d`/`prop` options, macros in the title and in included files, `:EXPORT_*:` properties of a subtree, and
 * #+INCLUDE of Org files (text before the first heading, keywords, :lines, :minlevel, :only-contents, ::searches, blocks).
 * Each case may carry `files` (written next to the document, so relative #+INCLUDE paths work) and `subtree` (export the first
 * heading's subtree; the Org back end has no subtree scope).  A Lisp error is kept as "ERROR message".
 * test/oracle-export-fixes.test.js holds the exporters to it.
 *   node tools/gen-oracle-export-fixes.mjs   (needs emacs on the PATH)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HDR = '#+OPTIONS: author:nil email:nil date:nil creator:nil timestamp:nil\n';
/** @type {{ name: string, org: string, files?: Record<string, string>, subtree?: boolean }[]} */
const CASES = [];
/** @param {string} name @param {string} org the text after the header @param {{ files?: Record<string, string>, subtree?: boolean }} [more] */
const add = (name, org, more = {}) => CASES.push({ name, org: HDR + org, ...more });

// ---- select and exclude tags ---------------------------------------------------------------------------------------------------
add('select-default-tag', '* A\n* B :export:\ntext\n');
add('select-drops-first-section', '#+SELECT_TAGS: exp\nFirst\n* H1 :exp:\nBody\n* H2\n');
add('select-keeps-nested', '#+SELECT_TAGS: exp\n* A :exp:\n** B\n* C\n');
add('select-ancestor-only', '#+SELECT_TAGS: exp\n* A\n** B :exp:\nb\n* C\n');
add('filetags-exclude', '#+FILETAGS: :noexport:\npre\n* A\nbody\n');
add('filetags-select', '#+FILETAGS: :exp:\n#+SELECT_TAGS: exp\npre\n* A\nx\n* B :exp:\ny\n');
add('tag-group-exclude', '#+TAGS: [ foo : bar baz ]\n#+EXCLUDE_TAGS: foo\n* A :baz:\n* B\ntext\n');
add('tag-group-select', '#+TAGS: [ foo : bar baz ]\n#+SELECT_TAGS: foo\n* A :baz:\n** C\n* B\n');
add('tag-group-exclusive', '#+TAGS: { foo : bar baz }\n#+EXCLUDE_TAGS: foo\n* A :baz:\n* B\ntext\n');

// ---- footnotes -------------------------------------------------------------------------------------------------------------------
add('footnote-def-in-noexport', '* H\nText[fn:1]\n* X :noexport:\n[fn:1] Def\n');
add('footnote-def-before-first-heading-select', '#+SELECT_TAGS: s\n[fn:1] Pre\n* H :s:\nText[fn:1]\n* O\nother\n');
add('footnote-def-outside-subtree', '[fn:1] D\n* H\nText[fn:1]\n', { subtree: true });
add('footnote-def-in-tasks-nil', '#+OPTIONS: tasks:nil\n* H\nText[fn:1]\n* TODO X\n[fn:1] Def\n');
add('footnote-nested-def', 'Text[fn:1]\n\n[fn:1] Definition[fn:2]\n\n[fn:2] Inner\n');
add('footnote-nested-def-order', 'Text[fn:1]\n\n[fn:1] Def[fn:2] and[fn:3]\n\n[fn:3] Three[fn:2]\n\n[fn:2] Inner\n');
add('footnote-adjacent', 'Text[fn:1][fn:2]\n\n[fn:1] One\n\n[fn:2] Two\n');
add('footnote-adjacent-space', 'Text[fn:1] [fn:2]\n\n[fn:1] One\n\n[fn:2] Two\n');
add('footnote-not-adjacent', 'Text[fn:1] and[fn:2]\n\n[fn:1] One\n\n[fn:2] Two\n');

// ---- inline tasks ----------------------------------------------------------------------------------------------------------------
const TASK = '*************** TODO Task :tag:\nbody\n*************** END\n';
add('inlinetask-default', TASK);
add('inlinetask-nil', '#+OPTIONS: inline:nil\n' + TASK);
add('inlinetask-tasks-nil', '#+OPTIONS: tasks:nil\n' + TASK);
add('inlinetask-tasks-done', '#+OPTIONS: tasks:done\n' + TASK);
add('inlinetask-excluded-tag', '#+EXCLUDE_TAGS: tag\n* H\ntext\n' + TASK);
add('inlinetask-in-heading', '* H\ntext\n' + TASK + 'after\n* Next\n');
add('inlinetask-select-tag', '#+SELECT_TAGS: exp\n* H1\n* H2\n*** Inline :exp:\n*************** END\n'.replace('*** Inline :exp:\n*************** END', '*************** Inline :exp:\n*************** END'));
add('inlinetask-priority', '*************** TODO [#A] Task\nbody\n*************** END\n');

// ---- timestamps ------------------------------------------------------------------------------------------------------------------
add('timestamp-weekday-wrong', '[2012-04-29 Mon]\n');
add('timestamp-weekday-lower', '<2012-04-29 sun.>\n');
add('timestamp-no-weekday', 'at <2012-04-29> and [2012-04-29 10:00 +1w]\n');
add('timestamp-planning', '#+OPTIONS: p:t\n* H\nSCHEDULED: <2012-04-29 Mon> DEADLINE: <2012-04-30 sun.>\n');
add('timestamp-nil-isolated', '#+OPTIONS: <:nil\n[2012-04-29 Sun]\n\ntext <2012-04-29 Sun> end\n');
add('timestamp-active-only', '#+OPTIONS: <:active\n<2012-03-29 Thu>[2012-03-29 Thu]\n\nParagraph <2012-03-29 Thu>[2012-03-29 Thu]\n');
add('timestamp-inactive-only', '#+OPTIONS: <:inactive\n<2012-03-29 Thu>[2012-03-29 Thu]\n\nParagraph <2012-03-29 Thu>[2012-03-29 Thu]\n');

// ---- options ---------------------------------------------------------------------------------------------------------------------
add('option-fixed-nil', '#+OPTIONS: ::nil\n: A\n\ntext\n');
add('option-tex-nil', '#+OPTIONS: tex:nil\n$1$ and \\alpha\n');
add('option-tex-verbatim', '#+OPTIONS: tex:verbatim\n$1$ and \\alpha and \\(x\\)\n');
add('option-tex-nil-env', '#+OPTIONS: tex:nil\n\\begin{equation}\nx\n\\end{equation}\n\ntext\n');
add('option-special-nil', '#+OPTIONS: -:nil\na -- b --- c ... d\n');
add('option-drawers-not', '#+OPTIONS: d:(not "BAR")\n:FOO:\nkeep\n:END:\n:BAR:\nremove\n:END:\n');
add('option-drawers-t-logbook', '#+OPTIONS: d:t\n* H\n:LOGBOOK:\n- note\n:END:\ntext\n');
add('option-drawers-list', '#+OPTIONS: d:("FOO")\n:FOO:\nkeep\n:END:\n:BAR:\nremove\n:END:\n');
add('option-prop-list', '#+OPTIONS: prop:("B")\n* H\n:PROPERTIES:\n:A: 1\n:B: 2\n:END:\n');

// ---- macros and subtree settings ----------------------------------------------------------------------------------------------
add('macro-in-title', '#+MACRO: m value\n#+TITLE: {{{m}}}\ntext\n');
add('macro-in-author', '#+OPTIONS: author:t\n#+MACRO: m value\n#+AUTHOR: {{{m}}}\ntext\n');
add('export-title-property', '* A\n:PROPERTIES:\n:EXPORT_TITLE: B\n:END:\nBody\n', { subtree: true });
add('export-author-property', '#+OPTIONS: author:t\n* A\n:PROPERTIES:\n:EXPORT_AUTHOR: Zed\n:END:\nBody\n', { subtree: true });

// ---- #+INCLUDE ---------------------------------------------------------------------------------------------------------------------
const INC = '#+TITLE: Included\n#+MACRO: included-macro success\nIntro text.\n\n#+BEGIN_SRC emacs-lisp :exports results\n(+ 2 1)\n#+END_SRC\n\n* Heading 1\nbody 1\n\n** Sub\nsub text\n\n* Another heading\n:PROPERTIES:\n:CUSTOM_ID: ah\n:END:\n1\n2\n3\n\n* A headline with a table\n:PROPERTIES:\n:CUSTOM_ID: ht\n:END:\n#+CAPTION: a table\n#+NAME: tbl\n| 1 |\n\n* drawer-headline\n:PROPERTIES:\n:CUSTOM_ID: dh\n:END:\n:LOGBOOK:\ndrawer\n:END:\ncontent\n';
const FILES = { 'inc.org': INC, 'inc2.org': 'Second file.\n', 'sub/outer.org': 'Outer.\n#+INCLUDE: "inner.org"\n', 'sub/inner.org': 'Inner.\n', 'code.txt': 'line 1\n* star\nline 3\n' };
const inc = (name, line, more = {}) => add(name, line + '\n', { files: FILES, ...more });
inc('include-whole', '#+INCLUDE: "inc.org"');
inc('include-text-and-keywords', '#+INCLUDE: "inc.org" :lines "1-4"');
inc('include-lines-range', '#+INCLUDE: "inc.org" :lines "3-5"');
inc('include-lines-open-start', '#+INCLUDE: "inc.org" :lines "-4"');
inc('include-lines-open-end', '#+INCLUDE: "inc.org" :lines "28-"');
inc('include-macro-from-file', '#+INCLUDE: "inc.org" :lines "1-4"\n{{{included-macro}}}');
inc('include-minlevel', '* Top\n#+INCLUDE: "inc.org" :minlevel 3');
inc('include-default-level-in-heading', '* Top\n** Second\n#+INCLUDE: "inc.org::*Heading 1"');
inc('include-default-level-before-heading', '#+INCLUDE: "inc.org::*Heading 1"');
inc('include-heading-search', '#+INCLUDE: "inc.org::*Heading 1"');
inc('include-heading-only-contents', '#+INCLUDE: "inc.org::*Heading 1" :only-contents t');
inc('include-custom-id', '#+INCLUDE: "inc.org::#ah"');
inc('include-custom-id-only-contents', '#+INCLUDE: "inc.org::#ah" :only-contents t');
inc('include-custom-id-lines', '#+INCLUDE: "inc.org::#ah" :only-contents t :lines "2-3"');
inc('include-name-search', '#+INCLUDE: "inc.org::tbl" :only-contents t');
inc('include-name-search-whole', '#+INCLUDE: "inc.org::tbl"');
inc('include-regexp-search', '#+INCLUDE: "inc.org::/sub text/"');
inc('include-drawer-heading', '#+INCLUDE: "inc.org::#dh" :only-contents t');
inc('include-src', '#+INCLUDE: "code.txt" src emacs-lisp');
inc('include-src-lines', '#+INCLUDE: "inc.org" src org :lines "3-5"');
inc('include-example', '#+INCLUDE: "code.txt" example');
inc('include-example-capitals', '#+INCLUDE: "code.txt" EXAMPLE :lines "1-3"');
inc('include-export', '#+INCLUDE: "code.txt" export html :lines "1-2"');
inc('include-quote', '#+INCLUDE: "inc2.org" quote');
inc('include-nested-relative', '#+INCLUDE: "sub/outer.org"');
inc('include-indented-in-list', '- item\n  #+INCLUDE: "inc2.org"');
inc('include-two', '#+INCLUDE: "inc2.org"\n#+INCLUDE: "inc2.org"');
inc('include-in-commented-heading', '* COMMENT c\n#+INCLUDE: "inc2.org"\n* After\ntext');
inc('include-heading-line-range-in-search', '#+INCLUDE: "inc.org::*Heading 1" :lines "1-3"');

// ---- source blocks: the -i switch --------------------------------------------------------------------------------------------------
add('src-switch-i', '#+begin_src emacs-lisp -i\n  (a)\n    (b)\n#+end_src\n\n#+begin_src emacs-lisp\n  (a)\n    (b)\n#+end_src\n');
add('src-switch-i-example', '#+begin_example -i\n  (a)\n    (b)\n#+end_example\n');

const BACKENDS = {
  ascii: "(org-export-as 'ascii SUBTREE nil nil '(:ascii-charset ascii))",
  utf8: "(org-export-as 'ascii SUBTREE nil nil '(:ascii-charset utf-8))",
  html: "(org-export-as 'html SUBTREE)",
  latex: "(org-export-as 'latex SUBTREE)",
  orgx: "(org-export-as 'org SUBTREE)",
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oexport-fixes-'));
const el = (name, call) => `
(require 'org) (require 'ox) (require 'ox-ascii) (require 'ox-html) (require 'ox-latex) (require 'ox-org) (require 'org-inlinetask) (require 'json)
(setq org-export-use-babel nil org-export-with-broken-links nil user-full-name "" user-mail-address "" make-backup-files nil
      org-html-validation-link nil org-tags-column 0)
(defun run-case (c)
  (let ((org (alist-get 'org c)) (subtree (alist-get 'subtree c)) (files (alist-get 'files c))
        (case-dir (file-name-as-directory (make-temp-file "case" t))))
    (dolist (f files)
      (let ((target (expand-file-name (symbol-name (car f)) case-dir)))
        (make-directory (file-name-directory target) t)
        (with-temp-file target (insert (cdr f)))))
    (with-temp-buffer
      (setq default-directory case-dir)
      (insert org) (org-mode)
      (when (eq subtree t) (goto-char (point-min)) (re-search-forward "^\\\\* ") (beginning-of-line))
      (let ((inhibit-message t) (message-log-max nil) (SUBTREE (eq subtree t)))
        (condition-case e
            (with-timeout (20 "ERROR TIMEOUT")
              (substring-no-properties ${call}))
          (error (concat "ERROR " (error-message-string e))))))))
(with-temp-buffer
  (insert-file-contents ${JSON.stringify(path.join(dir, 'in.json'))})
  (let* ((cases (json-parse-string (buffer-string) :array-type 'list :object-type 'alist)) (out '()))
    (dolist (c cases) (push (if (and (eq (alist-get 'subtree c) t) ${name === 'orgx' ? 't' : 'nil'}) "SKIP" (run-case c)) out))
    (with-temp-file ${JSON.stringify(path.join(dir, name + '.out.json'))} (insert (json-encode (nreverse out))))))
`;
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(CASES.map((c) => ({ org: c.org, subtree: c.subtree === true ? true : false, files: c.files || {} }))));
const runs = Object.entries(BACKENDS).map(([name, call]) => new Promise((resolve, reject) => {
  const file = path.join(dir, name + '.el');
  fs.writeFileSync(file, el(name, call.replace(/SUBTREE/g, 'SUBTREE')));
  const p = spawn('emacs', ['--batch', '-Q', '-l', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => (code === 0 ? resolve(name) : reject(new Error(`${name}: emacs exited ${code}\n${err.slice(-600)}`))));
}));
await Promise.all(runs);
const out = Object.fromEntries(Object.keys(BACKENDS).map((n) => [n, JSON.parse(fs.readFileSync(path.join(dir, n + '.out.json'), 'utf8'))]));
const version = await new Promise((resolve) => {
  const p = spawn('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let s = '';
  p.stdout.on('data', (d) => { s += d; });
  p.on('close', () => resolve(s.trim()));
});
const cases = CASES.map((c, i) => ({ name: c.name, org: c.org, ...(c.files ? { files: c.files } : {}), ...(c.subtree ? { subtree: true } : {}), ...Object.fromEntries(Object.keys(BACKENDS).map((n) => [n, out[n][i]])) }));
fs.writeFileSync(new URL('../test/fixtures/oracle-export-fixes.json', import.meta.url), JSON.stringify({ emacs: version, cases }, null, 0).replace(/\},\{/g, '},\n{') + '\n');
const errors = Object.fromEntries(Object.keys(BACKENDS).map((n) => [n, out[n].filter((x) => x.startsWith('ERROR')).length]));
console.log(`wrote ${cases.length} cases from Emacs ${version}; errors per back end ${JSON.stringify(errors)}`);
