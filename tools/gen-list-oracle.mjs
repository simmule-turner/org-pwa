#!/usr/bin/env node
/**
 * Writes test/fixtures/list-oracle.json: the text Emacs leaves after a list edit on a plain list or checklist — C-c C-c on an
 * item's checkbox, M-RET at the end of an item line (a new item), and deleting an item with its sub-items and renumbering the rest — for a few lists.
 *   node tools/gen-list-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const lists = {
  bullets: '* H\n- a\n- b\n  - b1\n  - b2\n- c\n',
  numbered: '* H\n1. a\n2. b\n3. c\n4. d\n',
  nestedNumbered: '* H\n1. a\n   1. a1\n   2. a2\n2. b\n3. c\n',
  paren: '* H\n1) a\n2) b\n3) c\n',
  counter: '* H\n1. [@5] a\n2. b\n3. c\n',
  plus: '* H\n+ a\n+ b\n  + b1\n+ c\n',
  star: '* H\n * a\n * b\n * c\n',
  checks: '* H\n- [ ] a\n- [X] b\n- [-] c\n- d\n',
  cookie: '* H [0/2]\n- [ ] a\n- [X] b\n',
  nestedChecks: '* H [1/2]\n- [-] a [1/2]\n  - [ ] a1\n  - [X] a2\n- [X] b\n',
  nestedAll: '* H\n- [ ] a\n  - [ ] a1\n  - [ ] a2\n- [ ] b\n',
  description: '* H\n- t :: d\n- u :: e\n- v :: f\n',
  text: '* H\n- a\n  more of a\n- b\n\ntail\n',
  indented: '* H\ntext\n  - a\n  - b\n',
};
const cases = [];
for (const [name, org] of Object.entries(lists)) {
  const items = org.split('\n').map((l, i) => [l, i]).filter(([l]) => /^\s*([-+*]|\d+[.)])\s/.test(l) && !/^\* /.test(l));
  for (const [l, i] of items) {
    if (/\[[ X-]\]/.test(l)) cases.push({ list: name, org, line: i, op: 'toggle' });
    cases.push({ list: name, org, line: i, op: 'insert-after' }, { list: name, org, line: i, op: 'cut' });
  }
}
const el = `
(require 'org) (require 'json) (require 'cl-lib)
(defun run-case (org line op)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (let ((inhibit-message t))
      (forward-line line) (end-of-line)
      (cond ((string= op "toggle") (org-toggle-checkbox))
            ((string= op "insert-after") (org-meta-return))
            ((string= op "cut") (beginning-of-line) (let* ((struct (org-list-struct)) (item (point))) (delete-region item (org-list-get-item-end item struct)) (condition-case nil (org-list-repair) (error nil)))))
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (push (condition-case e (run-case (cdr (assq 'org c)) (cdr (assq 'line c)) (cdr (assq 'op c))) (error (format "ERROR %S" e))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/list-oracle.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }, null, 1) + '\n');
console.log(cases.length, 'cases,', res.filter((x) => x.startsWith('ERROR')).length, 'errors');
