#!/usr/bin/env node
/**
 * Writes test/fixtures/org-yank-oracle.json: what Emacs 29.3 does for `org-yank` (C-y in an Org buffer) with kills that are subtrees and
 * kills that are not, at every caret position of a few outlines, under the four settings of `org-yank-adjusted-subtrees` and
 * `org-yank-folded-subtrees`. test/org-yank-oracle.test.js holds src/org-yank.js to it.
 *
 *   node tools/gen-org-yank-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const buffers = [
  '* A\nbody\n** B\ntext\n* C\n',
  '** Deep\n*** Deeper :tag:\nnote\n* Top\n',
  'intro\n* One\n\n* Two\nlast',
  '*** \n* Z\n',
  '',
  '* Only',
  '\n* Late\n',
];
const kills = [
  '* Tree\nbody\n',
  '** Sub\n*** Subsub\ntext\n',
  '* T1\n* T2 :x:\n',
  '\n* After blank\n',
  '*** Deep tree\n',
  '** A\n* Smaller\n',
  'plain text',
  '* No newline',
];
const settings = [[false, true], [true, true], [false, false], [true, false]];
const cases = [];
for (const text of buffers) for (let pos = 0; pos <= text.length; pos++) for (const kill of kills) for (const [adjusted, folded] of settings) cases.push({ text, pos, kill, adjusted, folded });

const el = `;; -*- lexical-binding: t -*-
(require 'org) (require 'json)
(transient-mark-mode 1)
(defun run-case (c)
  (let ((text (cdr (assq 'text c))) (pos (cdr (assq 'pos c))) (kill (cdr (assq 'kill c))) (err nil))
    (with-temp-buffer
      (insert text)
      (org-mode)
      (setq kill-ring (list kill))
      (setq org-yank-adjusted-subtrees (eq (cdr (assq 'adjusted c)) t))
      (setq org-yank-folded-subtrees (eq (cdr (assq 'folded c)) t))
      (goto-char (1+ pos))
      (setq last-command nil)
      (let ((inhibit-message t) (message-log-max nil))
        (condition-case e (call-interactively 'org-yank) (error (setq err (error-message-string e)))))
      (list (cons 'text (buffer-substring-no-properties (point-min) (point-max))) (cons 'pos (1- (point)))
            (cons 'mark (if (mark t) (1- (mark t)) -1)) (cons 'error (or err ""))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-yank-oracle-'));
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', maxBuffer: 1 << 28 });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const out = cases.map((c, i) => ({ ...c, emacs: results[i] }));
fs.writeFileSync('test/fixtures/org-yank-oracle.json', JSON.stringify({ emacs: '29.3', cases: out }) + '\n');
console.log(`${out.length} cases written`);
