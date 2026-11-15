#!/usr/bin/env node
/**
 * Writes test/fixtures/list-commands-oracle.json: the text Emacs 29.3 (Org 9.6.15) leaves after the list commands of org-list.el on a
 * corpus of lists -- M-right and M-left on an item (org-indent-item, org-outdent-item), M-S-right and M-S-left (the -tree forms), M-up and
 * M-down (org-move-item-up/down), C-c - (org-cycle-list-bullet), C-c ^ (org-sort-list, every type), C-c C-c on a box
 * (org-toggle-checkbox, with C-u and C-u C-u, on a region, on a heading), org-list-repair.  The text sits under a heading, as in a file.
 * test/list-commands-oracle.test.js holds src/list-struct.js to it.
 *   node tools/gen-list-commands-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The lists, as the text under a heading. */
export const LISTS = [
  '- a\n- b\n- c\n',
  '- a\n- b\n  - b1\n  - b2\n- c\n',
  '- a\n  - a1\n    - a11\n  - a2\n- b\n',
  '1. a\n2. b\n3. c\n',
  '1. a\n2. b\n   - b1\n   - b2\n3. c\n',
  '1) a\n2) b\n3) c\n',
  '+ a\n+ b\n+ c\n',
  '  - a\n  - b\n  - c\n',
  '  - a\n    - a1\n  - b\n',
  '- [ ] a\n- [X] b\n- [-] c\n',
  '- [ ] a\n  - [ ] a1\n  - [X] a2\n- [X] b\n',
  '- [ ] a\n  - [ ] a1\n  - [ ] a2\n- [ ] b\n',
  '- [X] a\n- [ ] b\n- [X] c\n',
  '- a\n\n- b\n\n- c\n',
  '- a\n  text of a\n- b\n  more of b\n    deeper\n',
  '- a\n\n  para of a\n- b\n',
  '- a\n\n\n- b\n',
  '- tag :: d\n- other :: e\n- third :: f\n',
  '- a\n  #+begin_src sh\n  echo\n  #+end_src\n- b\n',
  '- a\n  :LOGBOOK:\n  - note\n  :END:\n- b\n',
  '- [@3] a\n- b\n- c\n',
  '3. [@5] a\n4. b\n',
  '- b 2\n- a 10\n- C 1\n',
  '- [X] zeta\n- [ ] alpha\n- beta\n',
  '- 10 apples\n- 2 pears\n- 3 plums\n',
  '- <2020-01-03 Fri> c\n- <2020-01-01 Wed> a\n- <2020-01-02 Thu> b\n',
  '- [2020-02-03 Mon] c\n- [2020-01-01 Wed] a\n- no stamp\n',
  '- b\n  - y\n  - x\n- a\n  - z\n',
  '- a\n- b\n\n\n- c\n',
  '- a\n * b\n   * c\n',
  '- a\n  - b\n    - c\n      - d\n        - e\n          - f\n',
  '- a\n - b\n  - c\n',
  '- a\n+ b\n* c\n'.replace('* c', '  * c'),
  '1. a\n1. b\n1. c\n',
  '- a\n  1. x\n  2. y\n- b\n',
  '- [ ] a [0/2]\n  - [ ] x\n  - [X] y\n',
  '- a\n- b\n\ntext after\n',
  '- a\n- b\n#+begin_example\n- x\n#+end_example\n',
  '#+begin_example\n- x\n- y\n#+end_example\n',
  'text\n',
];

/** [op, arg] pairs run on every item line. */
const ITEM_OPS = [
  ['indent-item'], ['outdent-item'], ['indent-item-tree'], ['outdent-item-tree'], ['move-item-up'], ['move-item-down'], ['repair'],
  ['cycle'], ['cycle', 'previous'], ['cycle', 0], ['cycle', 1], ['cycle', '1.'], ['cycle', '1)'], ['cycle', '*'], ['cycle', '-'],
  ['toggle-cb'], ['toggle-cb', 'u'], ['toggle-cb', 'uu'], ['toggle-cb-ordered'],
  ['sort', 'a'], ['sort', 'A'], ['sort', 'n'], ['sort', 'N'], ['sort', 't'], ['sort', 'T'], ['sort', 'x'], ['sort', 'X'], ['sort-case', 'a'], ['sort-case', 'A'],
];
const cases = [];
const isItem = (l) => /^[ \t]*([-+]|\d+[.)])([ \t]|$)/.test(l) || /^[ \t]+\*([ \t]|$)/.test(l);
for (const org of LISTS) {
  const ls = org.split('\n');
  ls.forEach((l, i) => {
    if (!isItem(l) && !(org === 'text\n' || org.startsWith('#+begin_example'))) return;
    for (const [op, arg] of ITEM_OPS) cases.push({ org, line: i, op, arg: arg ?? null });
    cases.push({ org, line: i, op: 'cycle', arg: null, alpha: true });
  });
  // regions: from each item line to the next item line
  const items = ls.map((l, i) => (isItem(l) ? i : -1)).filter((i) => i >= 0);
  for (let k = 0; k + 1 < items.length; k++) {
    for (const op of ['indent-item', 'outdent-item', 'indent-item-tree', 'outdent-item-tree', 'toggle-cb']) cases.push({ org, line: items[k], op, arg: null, region: [items[k], items[k + 1]] });
  }
  if (items.length) cases.push({ org, line: items[0], op: 'toggle-cb', arg: null, heading: true }, { org, line: items[0], op: 'toggle-cb', arg: 'u', heading: true });
}
// the bullets that cycle through letters
for (const org of ['1) a\n2) b\n', 'a. a\nb. b\n', '- a\n- b\n']) cases.push({ org, line: 0, op: 'cycle', arg: null, alpha: true }, { org, line: 0, op: 'cycle', arg: 'previous', alpha: true });

const el = `
(require 'org) (require 'json) (require 'cl-lib)
(defun lc--run (c)
  (let* ((org (alist-get 'org c)) (line (alist-get 'line c)) (op (alist-get 'op c)) (arg (alist-get 'arg c))
         (region (alist-get 'region c)) (alpha (alist-get 'alpha c)) (heading (alist-get 'heading c)))
    (with-temp-buffer
      (insert "* H\\n" org) (let ((inhibit-message t)) (delay-mode-hooks (org-mode)))
      (transient-mark-mode 1)
      (goto-char (point-min)) (forward-line (+ 1 line))
      (when heading (goto-char (point-min)))
      (let ((org-list-allow-alphabetical alpha) (inhibit-message t))
        (when region
          (goto-char (point-min)) (forward-line (+ 1 (car region))) (set-mark (point))
          (goto-char (point-min)) (forward-line (+ 1 (cadr region))) (end-of-line) (setq mark-active t))
        (cond
         ((string= op "indent-item") (org-indent-item))
         ((string= op "outdent-item") (org-outdent-item))
         ((string= op "indent-item-tree") (org-indent-item-tree))
         ((string= op "outdent-item-tree") (org-outdent-item-tree))
         ((string= op "move-item-up") (org-move-item-up))
         ((string= op "move-item-down") (org-move-item-down))
         ((string= op "repair") (org-list-repair))
         ((string= op "cycle") (org-cycle-list-bullet (if (stringp arg) (if (string= arg "previous") 'previous arg) arg)))
         ((string= op "toggle-cb") (org-toggle-checkbox (cond ((equal arg "u") '(4)) ((equal arg "uu") '(16)) (t nil))))
         ((string= op "toggle-cb-ordered") (org-entry-put nil "ORDERED" "t") (goto-char (point-min)) (forward-line (+ 4 line)) (org-toggle-checkbox))
         ((string= op "sort") (org-sort-list nil (string-to-char arg)))
         ((string= op "sort-case") (org-sort-list t (string-to-char arg)))))
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (json-key-type 'symbol)
         (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (push (condition-case e (lc--run c) (error (format "ERROR %s" (error-message-string e)))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-commands-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/list-commands-oracle.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }) + '\n');
console.log(cases.length + ' cases');
