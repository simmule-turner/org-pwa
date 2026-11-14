#!/usr/bin/env node
/**
 * Writes test/fixtures/table-align-sort-oracle.json: what Emacs 29.3 does to a table with org-table-align (alignment cookies,
 * number words, indentation, tables of rules) and with org-table-sort-lines (case-sensitive, time and duration keys).
 *   node tools/gen-table-align-sort-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const align = [
  '| <r> |\n| ab |\n| abc |\n', '| <l> |\n| 12 |\n| 123 |\n', '| <c> |\n| 1 |\n| 123 |\n', '| <c> |\n| 1 |\n| 12 |\n| 1234 |\n',
  '| <r5> | <l> |\n| ab | 12 |\n| abc | 123 |\n', '| <5> | x |\n| ab | 12 |\n| abc | 123 |\n', '| a | b |\n| <r> | <c> |\n| ab | 1 |\n| abc | 123 |\n',
  '| ab | x |\n| <r> | y |\n| abc | z |\n', '| <c> |\n|-----|\n| 1 |\n| 1234 |\n', '| <x> |\n| 12 |\n', '| <r> | <c> |\n|---+---|\n| a | b |\n| 1234567 | 1 |\n',
  '  |   a |\n', '  | a | b |\n  |---+---|\n  | 1 | 22 |\n', '    | <r> |\n    | ab |\n    | abc |\n', ' | a |\n| bb |\n', '\t| a | b |\n\t| ccc | d |\n',
  '| a | b |\n  | ccc | d |\n',
  '| 0 | z |\n| nan | uinf |\n| -inf | inf |\n| +inf | ab |\n', '| nan |\n| x |\n| yy |\n', '| uinf |\n| x |\n', '| -inf |\n| x |\n| yyyy |\n', '| +inf |\n| abc |\n', '| 1 |\n| x |\n| yyy |\n',
  '| 1 |\n| x |\n| yyy |\n| 2 |\n', '| 0x1F |\n| zz |\n| yyyyy |\n', '| 12#ab |\n| zzzzzz |\n', '| >3.5 |\n| <2 |\n| abcdef |\n', '| 2x10^12 |\n| a |\n',
  '| 2.7(10) |\n| a |\n', '| 12:30 |\n| a |\n| bbbb |\n', '| 5% |\n| 1e-3 |\n| abc |\n',
  '|---|\n', '|---|---------|\n|---|---|-----|\n', '|---+---|\n', '|-|\n|-|\n', '|---+---+---|\n|-|\n', '|-+-|\n|---|\n|-|\n', '|---|\n#+TBLFM: $1=1\n',
  '| |\n| |\n', '| a | b |\n| c |\n', '| a |\n| b | c | d |\n|---|\n', '| x | |\n| | 1 |\n| yy | 22 |\n',
];
const bySortRows = {
  words: '| b |\n| C |\n| a |\n| B |\n| A |\n| c |\n| _x |\n| Z |\n| é |\n| e |\n',
  mixed: '| a | 3 |\n| C | 1 |\n| b | 2 |\n',
  stamps: '| <2014-03-04 tue.> |\n| <2008-08-08 sat.> |\n| <2012-03-29 thu.> |\n',
  stamps2: '| [2014-03-04 Tue 10:00] |\n| <2014-03-04 Tue 09:30> |\n| <2014-03-04> |\n| <2014-03-04 foo 11:00> |\n| x [2013-01-01 Tue] y |\n| <2014-03-04 Tue 10:00-11:30> |\n| <2014-03-04 Tue +1w> |\n| <2014-03-04 Tue 08:00 +1d> |\n| [2014-03-04 Tue 10:00]--[2014-03-05 Tue 10:00] |\n| 2014-03-04 |\n| <2014-3-4> |\n| <2014-03-04 mon.> |\n| <2014-03-04 tue. 12:00> |\n',
  clock: '| 114:00 |\n| 17:00 |\n| 1:00 |\n| 0:30:15 |\n| 12:3 |\n| 5 |\n| 1:00:30 |\n| 100:00:00 |\n| 2:5 |\n| 2:05 |\n',
  durs: '| 28:00 |\n| 1d 3:00 |\n| 1h 30min |\n| 1.5h |\n| 2h |\n| 90min |\n| 1d |\n| 1w |\n| 3 h |\n| 1h30min |\n| 1y |\n| 1m |\n| 10min 5h |\n| 5 |\n| abc |\n| about 3:15 pm |\n| 1:05:00 foo |\n',
};
const cases = [];
for (const org of align) cases.push({ op: 'align', org });
for (const [name, org] of Object.entries(bySortRows)) {
  const rows = org.trimEnd().split('\n');
  const ncols = rows[0].split('|').length - 2;
  // Emacs's case-folded string-collate-lessp is not transitive on punctuation-heavy strings, so those are sorted by time and number only
  for (const mode of name === 'stamps2' || name === 'clock' || name === 'durs' ? ['n', 'N', 't', 'T'] : ['a', 'A', 'n', 'N', 't', 'T']) for (let col = 0; col < ncols; col++) for (const withCase of mode.toLowerCase() === 'a' ? [false, true] : [false]) cases.push({ op: 'sort', name, org, mode, col, withCase, row: 0 });
}
const el = `
(require 'org) (require 'json)
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (push
       (condition-case e
           (with-temp-buffer
             (insert (cdr (assq 'org c))) (org-mode) (goto-char (point-min))
             (let ((inhibit-message t))
               (if (string= (cdr (assq 'op c)) "align")
                   (progn (search-forward "|") (org-table-align))
                 (forward-line (cdr (assq 'row c))) (org-table-goto-column (1+ (cdr (assq 'col c))))
                 (org-table-sort-lines (eq (cdr (assq 'withCase c)) t) (string-to-char (cdr (assq 'mode c))))))
             (buffer-string))
         (error (format "ERROR %S" e)))
       out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'table-as-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/table-align-sort-oracle.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }, null, 1) + '\n');
console.log(cases.length, 'cases,', res.filter((x) => x.startsWith('ERROR')).length, 'errors');
