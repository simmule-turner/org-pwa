#!/usr/bin/env node
/**
 * Writes examples/editing.org: headings, lists and tables before and after an edit, the "after" being what Emacs left.
 * test/examples-emacs.test.js holds the app to every pair.
 *   node tools/gen-edit-cookbook.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// line: the 1-based line of the heading, item or row the edit starts from; col: the 1-based column
const cases = [
  { title: 'Promote a heading', text: 'The stars drop by one and the heading stays where it is in the text, so the siblings after it become its children.', op: 'promote', line: 3, org: '* A\n** B\n** C\n** D\n' },
  { title: 'Demote a heading', text: 'The heading and its subtree go one level deeper. After a sibling it becomes that sibling\'s last child.', op: 'demote', line: 3, org: '* A\n** B\n** C\n*** C1\n' },
  { title: 'Move a subtree', text: 'A heading changes places with its sibling, subtree and all.', op: 'up', line: 3, org: '* A\n** B\n* C\n** C1\n* D\n' },
  { title: 'A new numbered item', text: 'Ordered items are numbered again.', op: 'item-below', line: 3, org: '* Steps\n1. Mix\n2. Bake\n3. Cool\n' },
  { title: 'A new item above sub-items', text: 'The new item goes right under the item\'s first line, and the sub-items follow it.', op: 'item-below', line: 2, org: '* Shopping\n- Fruit\n  - apples\n  - pears\n- Bread\n' },
  { title: 'A new description item', text: 'The term is empty, ready to be filled in.', op: 'item-below', line: 2, org: '* Terms\n- org :: outliner\n- pwa :: web app\n' },
  { title: 'Checking a box', text: 'A box that has boxes under it shows what they add up to, and the cookie follows.', op: 'toggle', line: 3, org: '* Packing [0/2]\n- [-] Bag [1/2]\n  - [ ] shirts\n  - [X] shoes\n- [ ] Passport\n' },
  { title: 'Insert a table column', text: 'The table is aligned again and the =#+TBLFM:= references move with the columns.', op: 'insert-col', line: 3, col: 2, org: '| a | b |\n|---+---|\n| 1 | 2 |\n#+TBLFM: $2=$1*2\n' },
  { title: 'Delete a table row', text: 'The other rows keep their layout, and row references in =#+TBLFM:= follow.', op: 'delete-row', line: 3, org: '| n | sq |\n|---+----|\n| 1 |  1 |\n| 2 |  4 |\n| 3 |  9 |\n#+TBLFM: @4$2=@3$1*@3$1\n' },
  { title: 'Change a table cell', text: 'The columns are widened to the longest cell.', op: 'set-cell', line: 3, col: 1, value: 'a much longer name', org: '| Name | Qty |\n|------+-----|\n| ab   |   3 |\n' },
];
const el = `
(require 'org) (require 'json) (require 'cl-lib)
(defun run-case (org op line col value)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (let ((inhibit-message t) (org-adapt-indentation nil))
      (forward-line (1- line))
      (cond ((string= op "promote") (org-promote-subtree))
            ((string= op "demote") (org-demote-subtree))
            ((string= op "up") (org-move-subtree-up))
            ((string= op "item-below") (end-of-line) (org-meta-return))
            ((string= op "toggle") (end-of-line) (org-toggle-checkbox))
            ((string= op "insert-col") (move-to-column 2) (org-table-goto-column col) (org-table-insert-column))
            ((string= op "delete-row") (move-to-column 2) (org-table-kill-row))
            ((string= op "set-cell") (move-to-column 2) (org-table-get-field col value) (org-table-align)))
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case (cdr (assq 'org c)) (cdr (assq 'op c)) (cdr (assq 'line c)) (cdr (assq 'col c)) (cdr (assq 'value c))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-book-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const esc = (t) => t.trimEnd().split('\n').map((l) => (/^\s*(\*|#\+)/.test(l) ? ',' + l : l)).join('\n');
const how = (c) => `${c.op}${c.line ? ' at line ' + c.line : ''}${c.col ? ', column ' + c.col : ''}${c.value ? ', value "' + c.value + '"' : ''}`;
let out = `#+TITLE: Editing headings, lists and tables
#+STARTUP: showall

A cookbook for structure edits. Each section shows text before an edit and after it. The "after" texts are what Emacs 29.3 (Org 9.6.15) left (promote and demote with =M-left= and =M-right= on a subtree, =M-up=, =M-RET=, =C-c C-x C-b=, the table commands), and the app gives the same. Lines that start with =*= or =#+= carry a comma, as org requires inside a block.
`;
cases.forEach((c, i) => {
  out += `\n* ${c.title}\n${c.text}\n\nBefore (${how(c)}):\n#+BEGIN_SRC org\n${esc(c.org)}\n#+END_SRC\n\nAfter:\n#+BEGIN_SRC org\n${esc(results[i])}\n#+END_SRC\n`;
});
out += `
* Where the app differs from Emacs
- Emacs re-aligns a heading's tags to =org-tags-column= when its level changes; the app leaves their spacing as it is.
- Deleting a table column leaves an extra column in Emacs when a row has an empty cell and the rule is a bare =|-=; the app deletes the column asked for.
- A new item below an item with a checkbox has none, as in Emacs; the item menu has *Add checkbox below* for one with a box.
`;
fs.writeFileSync('examples/editing.org', out);
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
fs.writeFileSync('test/fixtures/editing-cases.json', JSON.stringify(cases, null, 1) + '\n');
console.log(cases.length, 'cases written');
