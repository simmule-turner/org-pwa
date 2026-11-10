#!/usr/bin/env node
/**
 * Writes test/fixtures/table-oracle.json: the table text Emacs leaves after a table edit (insert or delete a row or column,
 * set a cell), for a few tables. org-table-align runs after each, as it does on every edit in Emacs.
 *   node tools/gen-table-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tables = {
  aligned: '| Name  | Qty |\n|-------+-----|\n| apple |   3 |\n| fig   |  12 |\n',
  loose: '|a|b|c|\n|-\n|1|22|333|\n|x||z|\n',
  numbers: '| item | price |\n|---+---|\n| a | 1.5 |\n| b | 22 |\n| c | n/a |\n',
  empty: '| a | b |\n|---+---|\n|   |   |\n| x |   |\n',
  wide: '| 名前 | n |\n|---+---|\n| 日本語 | 1 |\n| ab | 2 |\n',
  widthRow: '| a | b |\n| <5> | <r> |\n|---+---|\n| long text here | 1 |\n| x | 22 |\n',
  groups: '| h1 | h2 |\n|----+----|\n| a | 1 |\n|----+----|\n| b | 2 |\n',
  sortdata: '| word | num | when |\n|------+-----+------|\n| pear | 10 | [2026-01-02 Fri] |\n| Apple | 9 | <2026-01-01 Thu 10:30> |\n| apple | 1.5 | 10:15 |\n| fig | -2 | 1:30:00 |\n| Fig |  | [2026-01-02 Fri 08:00] |\n| zed | n/a | text |\n| ant | 1e2 | 5 |\n| bee | 12abc | 0.5 |\n| cat | 9 | <2026-01-01 Thu 10:30> |\n|------+-----+------|\n| z | 3 | |\n| y | 2 | |\n',
  formula: '| a | b |\n|---+---|\n| 1 | 2 |\n#+TBLFM: $2=$1*2\n',
  refs: '| a | b | c |\n|---+---+---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n#+TBLFM: @3$2=@2$1+@4$3::$3=$1+$2::@2$1=remote(x,@1$1)\n',
};
const cases = [];
for (const [name, org] of Object.entries(tables)) {
  const rows = org.split('\n').filter((l) => l.startsWith('|'));
  const ncols = Math.max(...rows.map((l) => l.split('|').length - 2));
  rows.forEach((l, r) => {
    if (/^\|-/.test(l)) return;
    cases.push({ table: name, org, op: 'insert-row-below', row: r }, { table: name, org, op: 'delete-row', row: r }, { table: name, org, op: 'set-cell', row: r, col: 0, value: 'a longer value' }, { table: name, org, op: 'set-cell', row: r, col: ncols - 1, value: '7' });
  });
  for (let c = 0; c < ncols; c++) {
    cases.push({ table: name, org, op: 'insert-col-before', col: c, row: 0 }, { table: name, org, op: 'delete-col', col: c, row: 0 });
  }
}
// the commands of the Table pad: insert above, move, rules, sort. `at` is where Emacs leaves the cursor: [row, column], 0-based.
const more = [];
for (const [name, org] of Object.entries(tables)) {
  const rows = org.split('\n').filter((l) => l.startsWith('|'));
  const ncols = Math.max(...rows.map((l) => l.split('|').length - 2));
  rows.forEach((l, r) => {
    more.push({ table: name, org, op: 'insert-row-above', row: r, col: 0 }, { table: name, org, op: 'hline-below', row: r, col: 0 }, { table: name, org, op: 'hline-above', row: r, col: 0 }, { table: name, org, op: 'hline-and-move', row: r, col: 0 });
    if (/^\|-/.test(l)) return;
    more.push({ table: name, org, op: 'move-row-up', row: r, col: 0 }, { table: name, org, op: 'move-row-down', row: r, col: 0 });
    for (const [key, mode] of [['alpha', 'a'], ['alpha-reverse', 'A'], ['numeric', 'n'], ['numeric-reverse', 'N'], ['time', 't']]) for (let c = 0; c < ncols; c++) more.push({ table: name, org, op: 'sort-' + key, mode, row: r, col: c });
  });
  for (let c = 0; c < ncols; c++) more.push({ table: name, org, op: 'move-col-left', col: c, row: 0 }, { table: name, org, op: 'move-col-right', col: c, row: 0 });
}
// ?f and ?F: a function that gets the key (its name) and one that compares keys (its name, or none for sort-subr's own)
for (const [getkey, compare] of [['length', ''], ['string-to-number', '>'], ['upcase', ''], ['upcase', 'string-greaterp'], ['length', '>'], ['string-to-number', '<']]) {
  for (const mode of ['f', 'F']) for (const col of [0, 1, 2]) more.push({ table: 'sortdata', org: tables.sortdata, op: 'sort-func', mode, getkey, compare, row: 2, col });
}
cases.push(...more);
const el = `
(require 'org) (require 'json) (require 'cl-lib)
(defun run-case (org op row col value mode getkey compare)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (let ((inhibit-message t))
      (forward-line row) (move-to-column 2)
      (org-table-goto-column (1+ (or col 0)))
      (cond ((string= op "insert-row-above") (org-table-insert-row))
            ((string= op "hline-below") (org-table-insert-hline))
            ((string= op "hline-above") (org-table-insert-hline t))
            ((string= op "hline-and-move") (org-table-hline-and-move))
            ((string= op "move-row-up") (org-table-move-row-up))
            ((string= op "move-row-down") (org-table-move-row-down))
            ((string= op "move-col-left") (org-table-move-column-left))
            ((string= op "move-col-right") (org-table-move-column-right))
            ((string= op "sort-func") (org-table-sort-lines nil (string-to-char mode) (intern getkey) (and compare (not (string= compare "")) (intern compare))))
            ((string-prefix-p "sort-" op) (org-table-sort-lines nil (string-to-char mode)))
            ((string= op "insert-row-below") (org-table-insert-row t))
            ((string= op "delete-row") (org-table-kill-row))
            ((string= op "set-cell") (org-table-get-field (1+ col) value) (org-table-align))
            ((string= op "insert-col-before") (org-table-insert-column))
            ((string= op "delete-col") (org-table-delete-column)))
      (list (cons 'text (buffer-string)) (cons 'row (- (line-number-at-pos) 1)) (cons 'col (condition-case nil (1- (org-table-current-column)) (error -1)))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (push (condition-case e (run-case (cdr (assq 'org c)) (cdr (assq 'op c)) (cdr (assq 'row c)) (cdr (assq 'col c)) (cdr (assq 'value c)) (cdr (assq 'mode c)) (cdr (assq 'getkey c)) (cdr (assq 'compare c))) (error (list (cons 'text (format "ERROR %S" e))))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'table-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/table-oracle.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: res[i].text, at: res[i].row === undefined ? undefined : [res[i].row, res[i].col] })) }, null, 1) + '\n');
console.log(cases.length, 'cases,', res.filter((x) => x.text.startsWith('ERROR')).length, 'errors');
