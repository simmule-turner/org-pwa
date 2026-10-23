#!/usr/bin/env node
/**
 * Writes test/fixtures/structure-oracle.json: the text Emacs leaves after a structure edit on a heading — promote and demote
 * the subtree, move it up or down, delete it, insert a heading after it — for a few outlines.
 *   node tools/gen-structure-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const docs = {
  tree: '* A\n** A1\n*** A1a\n** A2\n* B\n** B1\n* C\n',
  body: '* A\ntext a\n** A1\ntext a1\n*** A1a\n** A2\n* B\nbody b\n* C\n',
  deep: '* A\n** A1\n*** A1a\n**** A1a1\n** A2\n',
  tagged: '* TODO [#A] A :x:\nSCHEDULED: <2026-10-05 Mon>\n** DONE A1 :y:\n* B\n',
  folded: '* A\n:PROPERTIES:\n:ID: 1\n:END:\n** A1\n- item\n  more\n| a | b |\n* B\n',
};
const ops = ['promote', 'demote', 'up', 'down', 'delete', 'insert-after'];
const cases = [];
for (const [name, org] of Object.entries(docs)) {
  const n = (org.match(/^\*+ /gm) || []).length;
  for (let i = 0; i < n; i++) for (const op of ops) cases.push({ doc: name, org, index: i, op });
}
const el = `
(require 'org) (require 'json) (require 'cl-lib)
(defun run-case (org index op)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (let ((org-adapt-indentation nil) (inhibit-message t))
      (dotimes (_ (1+ index)) (re-search-forward "^\\\\*+ " nil t))
      (beginning-of-line)
      (cond ((string= op "promote") (org-promote-subtree))
            ((string= op "demote") (org-demote-subtree))
            ((string= op "up") (org-move-subtree-up))
            ((string= op "down") (org-move-subtree-down))
            ((string= op "delete") (org-cut-subtree))
            ((string= op "insert-after") (end-of-line) (org-insert-heading-respect-content)))
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (push (condition-case e (run-case (cdr (assq 'org c)) (cdr (assq 'index c)) (cdr (assq 'op c))) (error (format "ERROR %S" (cadr e)))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'struct-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/structure-oracle.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }, null, 1) + '\n');
console.log(cases.length, 'cases');
