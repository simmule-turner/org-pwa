#!/usr/bin/env node
/**
 * Writes the "Other sparse trees" section of examples/match-queries.org: for each C-c / command, the headings Emacs 29.3 (Org 9.6.15) shows
 * in that file (the clock reads 2026-10-22). test/examples-emacs.test.js holds the app to them.
 *   node tools/gen-example-sparse.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FILE = new URL('../examples/match-queries.org', import.meta.url).pathname;
const MARK = '\n* Other sparse trees\n';
const base = fs.readFileSync(FILE, 'utf8').split(MARK)[0].replace(/\n*$/, '\n');
fs.writeFileSync(FILE, base);
// key: what is typed after C-c /, arg: its answer
const cases = [
  { key: 'r', arg: 'spec' },
  { key: 'r', arg: '\\<review\\>' },
  { key: 'r', arg: 'Emacs\\|Org' },
  { key: 't', arg: '' },
  { key: 'T', arg: 'NEXT|WAITING' },
  { key: 'd', arg: '' },
  { key: 'b', arg: '2026-11-01' },
  { key: 'a', arg: '2026-11-01' },
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-sparse-'));
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
const el = `
(require 'org) (require 'json) (require 'cl-lib)
(defun titles () (let (out) (dolist (o (sort (copy-sequence org-occur-highlights) (lambda (a b) (< (overlay-start a) (overlay-start b)))))
  (save-excursion (goto-char (overlay-start o)) (when (ignore-errors (org-back-to-heading t) t)
    (let ((h (org-get-heading t t t t))) (unless (member h out) (push h out)))))) (nreverse out)))
(defun run-case (c)
  (with-temp-buffer
    (insert-file-contents "${FILE}") (org-mode)
    (cl-letf (((symbol-function 'current-time) (lambda () (encode-time 0 0 0 22 10 2026))))
      (let ((key (alist-get 'key c)) (arg (alist-get 'arg c)) (inhibit-message t))
        (cond ((equal key "r") (org-occur arg))
              ((equal key "t") (org-show-todo-tree nil))
              ((equal key "T") (cl-letf (((symbol-function 'completing-read) (lambda (&rest _) arg))) (org-show-todo-tree '(4))))
              ((equal key "d") (org-check-deadlines nil))
              ((equal key "b") (org-check-before-date arg))
              (t (org-check-after-date arg)))
        (vconcat (titles))))))
(let ((cases (json-parse-string (with-temp-buffer (insert-file-contents "${path.join(dir, 'cases.json')}") (buffer-string)) :object-type 'alist :array-type 'list)))
  (princ (json-encode (vconcat (mapcar #'run-case cases)))))
`;
fs.writeFileSync(path.join(dir, 'run.el'), el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { encoding: 'utf8', maxBuffer: 1 << 26 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2500)); process.exit(1); }
const out = JSON.parse(m[0]);
let text = `${MARK}
=C-c /= asks for a kind of sparse tree; these are the headings each of them shows in this file, with the clock at 2026-10-22. After the key come its answer: a regexp for =r=, the keywords for =T=, a date for =b= and =a=; =t= and =d= ask nothing.

`;
cases.forEach((c, i) => {
  text += `- =C-c / ${c.key}${c.arg ? ' ' + c.arg : ''}= :: ${out[i].join('; ') || '(none)'}\n`;
});
fs.writeFileSync(FILE, base + text);
console.log(cases.length, 'sparse trees written');
