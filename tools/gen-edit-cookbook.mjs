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
  { title: 'Demote a heading with odd levels', text: '=#+STARTUP: odd= (or =org-odd-levels-only=) makes levels one, three, five stars, so a heading changes by two stars. The demoted heading goes under its sibling.', op: 'demote', line: 4, org: '#+STARTUP: odd\n* A\n*** B\n*** C\n' },
  { title: 'Turn a line into a heading', text: '=C-c *= makes the line a heading one level below the entry it is in; on a heading it makes the line plain text again.', op: 'toggle-heading', line: 2, org: '* Notes\nbuy milk\n' },
  { title: 'Wrap lines in a source block', text: '=C-c C-,= then =s= wraps the selected lines (here lines 2 and 3) in a source block, ready for a language.', op: 'template', line: 2, to: 3, value: 's', org: '* Code\nprint(1)\nprint(2)\n' },
  { title: 'Wrap lines in a drawer', text: '=C-c C-x d= and a name wraps the selected lines in that drawer, as the first lines of the entry.', op: 'drawer', line: 2, to: 3, value: 'NOTES', org: '* Meeting\nfirst point\nsecond point\n' },
  { title: 'Split a heading', text: '=M-RET= with the caret inside a heading\'s title starts a new heading with the text after the caret; tags stay on the first.', op: 'split', line: 1, col: 6, org: '* Buy milk and eggs :errand:\n' },
  { title: 'Split a list item', text: 'In a list item the text after the caret, with any sub-items, moves to the new item.', op: 'split', line: 2, col: 6, org: '* Shopping\n- milk and eggs\n  - oat\n- bread\n' },
  { title: 'Keep the line whole', text: 'With =org-M-RET-may-split-line= set to =nil= the new item goes after the whole item.', op: 'split', line: 2, col: 6, value: 'nil', org: '* Shopping\n- milk and eggs\n  - oat\n- bread\n' },
  { title: 'A rule from |-', text: 'In the Text view, =Tab= on a line that is just =|-= writes the rule, aligns the table and starts a row under it.', op: 'tab', line: 3, col: 2, org: '| Item | Cost |\n| Flights | 420 |\n|-\n' },
  { title: 'Tab to the next field', text: 'In the Text view, =Tab= aligns the table and moves to the next field; from the last field of the last row it adds a row.', op: 'tab', line: 2, col: 13, org: '| Item | Cost |\n| Flights | 420 |\n' },
];
const el = `
(require 'org) (require 'json) (require 'cl-lib)
(defun run-case (org op line col value to)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (let ((inhibit-message t) (org-adapt-indentation nil) (transient-mark-mode t))
      (forward-line (1- line))
      (when (member op '("template" "drawer")) (set-mark (point)) (forward-line (- (1+ to) line)) (activate-mark))
      (cond ((string= op "toggle-heading") (org-toggle-heading))
            ((string= op "template") (org-insert-structure-template (cdr (assoc value org-structure-template-alist))))
            ((string= op "drawer") (org-insert-drawer nil value))
            ((string= op "promote") (org-promote-subtree))
            ((string= op "demote") (org-demote-subtree))
            ((string= op "up") (org-move-subtree-up))
            ((string= op "item-below") (end-of-line) (org-meta-return))
            ((string= op "tab") (move-to-column col) (org-cycle))
            ((string= op "split") (move-to-column col) (let ((org-M-RET-may-split-line (if value (car (read-from-string value)) '((default . t))))) (org-meta-return)))
            ((string= op "toggle") (end-of-line) (org-toggle-checkbox))
            ((string= op "insert-col") (move-to-column 2) (org-table-goto-column col) (org-table-insert-column))
            ((string= op "delete-row") (move-to-column 2) (org-table-kill-row))
            ((string= op "set-cell") (move-to-column 2) (org-table-get-field col value) (org-table-align)))
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case (cdr (assq 'org c)) (cdr (assq 'op c)) (cdr (assq 'line c)) (cdr (assq 'col c)) (cdr (assq 'value c)) (cdr (assq 'to c))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-book-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const esc = (t) => t.trimEnd().split('\n').map((l) => (/^\s*(\*|#\+)/.test(l) ? ',' + l : l)).join('\n');
const how = (c) => `${c.op}${c.line ? ' at line ' + c.line : ''}${c.to ? ' to ' + c.to : ''}${c.col ? ', column ' + c.col : ''}${c.value ? ', value "' + c.value + '"' : ''}`;
let out = `#+TITLE: Editing headings, lists and tables
#+STARTUP: showall

A cookbook for structure edits. Each section shows text before an edit and after it. The "after" texts are what Emacs 29.3 (Org 9.6.15) left (promote and demote with =M-left= and =M-right= on a subtree, =M-up=, =M-RET=, =C-c C-x C-b=, =C-c *=, =C-c C-,=, =C-c C-x d=, the table commands), and the app gives the same. Lines that start with =*= or =#+= carry a comma, as org requires inside a block.
`;
cases.forEach((c, i) => {
  out += `\n* ${c.title}\n${c.text}\n\nBefore (${how(c)}):\n#+BEGIN_SRC org\n${esc(c.org)}\n#+END_SRC\n\nAfter:\n#+BEGIN_SRC org\n${esc(results[i])}\n#+END_SRC\n`;
});
out += `
* Where the app differs from Emacs
- Emacs re-aligns a heading's tags to =org-tags-column= when its level changes; the app leaves their spacing as it is.
- Deleting a table column leaves an extra column in Emacs when a row has an empty cell and the rule is a bare =|-=; the app deletes the column asked for.
- =M-RET= splits at the caret in the Text view. On the outline there is no caret, so it adds after the focused heading or item; in a table (wrap region) it is not available.
- A new item below an item with a checkbox has none, as in Emacs; the item menu has *Add checkbox below* for one with a box.
`;
fs.writeFileSync('examples/editing.org', out);
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
fs.writeFileSync('test/fixtures/editing-cases.json', JSON.stringify(cases, null, 1) + '\n');
console.log(cases.length, 'cases written');
