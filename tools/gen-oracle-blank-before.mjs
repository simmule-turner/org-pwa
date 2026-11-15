#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-blank-before.json: what Emacs 29.3 (Org 9.6) does about the empty line before a new heading
 * (`org-insert-heading-respect-content`) and the blank lines between list items (`org-list-separating-blank-lines-number`) under each value of
 * `org-blank-before-new-entry` (auto, t, nil). test/oracle-blank-before.test.js holds src/heading-edit.js and src/list-edit.js to it.
 *   node tools/gen-oracle-blank-before.mjs   (needs emacs on the PATH)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const HEADING_TEXTS = ['* A\nbody\n* B\nbody\n', '* A\nbody\n\n* B\nbody\n', '* A\n\n* B\n', '* A\n** A1\n\n** A2\n* B\n', '\n* A\nbody\n', '* A\nbody\n\n\n* B\n', '* A', '* A\n'];
export const LIST_TEXTS = ['- one\n- two\n', '- one\n\n- two\n', '- one\n  para\n\n  more\n- two\n', '- one\n', '- one\n  - sub\n- two\n', '- one\n\n  - sub\n\n  - sub2\n\n- two\n', '1. a\n2. b\n\n3. c\n'];
export const SETTINGS = ['auto', 't', 'nil'];
const lispString = (s) => JSON.stringify(s);
const headingCases = [];
for (const text of HEADING_TEXTS) for (const setting of SETTINGS) {
  const n = text.split('\n').filter((l) => /^\*+ /.test(l)).length;
  for (let index = 0; index < n; index++) headingCases.push({ text, setting, index });
}
const listCases = [];
for (const text of LIST_TEXTS) for (const setting of SETTINGS) {
  const lines = text.split('\n');
  lines.forEach((l, line) => { if (/^[ \t]*([-+*]|\d+[.)]) /.test(l)) listCases.push({ text, setting, line }); });
}
const lisp = `(progn (require 'org) (require 'org-list) (require 'json)
(defun run-heading (text setting index)
  (with-temp-buffer (org-mode) (insert text) (goto-char (point-min))
    (let ((org-blank-before-new-entry (list (cons 'heading setting) (cons 'plain-list-item 'auto))))
      (re-search-forward "^\\\\*+ " nil t index) (beginning-of-line)
      (org-insert-heading-respect-content))
    (buffer-string)))
(defun run-list (text setting line)
  (with-temp-buffer (org-mode) (insert text) (goto-char (point-min)) (forward-line line)
    (let* ((org-blank-before-new-entry (list (cons 'heading 'auto) (cons 'plain-list-item setting)))
           (struct (org-list-struct)))
      (org-list-separating-blank-lines-number (point) struct (org-list-prevs-alist struct)))))
(defun sym (s) (intern s))
(let ((out nil))
  (dolist (c (list ${headingCases.map((c) => `(list ${lispString(c.text)} (sym ${lispString(c.setting)}) ${c.index + 1})`).join(' ')}))
    (push (condition-case e (run-heading (nth 0 c) (nth 1 c) (nth 2 c)) (error (format "ERROR %S" e))) out))
  (let ((h (nreverse out)) (l nil))
    (dolist (c (list ${listCases.map((c) => `(list ${lispString(c.text)} (sym ${lispString(c.setting)}) ${c.line})`).join(' ')}))
      (push (condition-case e (run-list (nth 0 c) (nth 1 c) (nth 2 c)) (error (format "ERROR %S" e))) l))
    (princ (json-encode (list :headings (vconcat h) :lists (vconcat (nreverse l))))))))`;
const run = spawnSync('emacs', ['-Q', '--batch', '--eval', lisp], { encoding: 'utf8', timeout: 120000 });
if (run.status !== 0) { console.error(run.stderr); process.exit(1); }
const got = JSON.parse(run.stdout);
const fixture = {
  emacs: 'Emacs 29.3, Org 9.6.15',
  headings: headingCases.map((c, i) => ({ ...c, want: got.headings[i] })),
  lists: listCases.map((c, i) => ({ ...c, want: got.lists[i] })),
};
fs.writeFileSync(path.join(here, '..', 'test', 'fixtures', 'oracle-blank-before.json'), JSON.stringify(fixture, null, 1) + '\n');
console.log(`wrote ${fixture.headings.length} heading and ${fixture.lists.length} list cases`);
