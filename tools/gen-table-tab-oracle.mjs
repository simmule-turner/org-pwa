// Asks Emacs 29.3 (Org 9.6.15) what TAB (org-cycle) does at every caret position of some tables, and writes
// test/fixtures/table-tab-oracle.json. Run: node tools/gen-table-tab-oracle.mjs   (needs emacs on the path)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEXTS = [
  '| a | b |\n| c | d |\n',
  '| a | b |\n|-\n',
  '| a | b |\n|-\n| c | d |\n',
  '|-\n',
  '| a | b |\n|---+---|\n| c | d |\n',
  '| a |  b |\n| c |\n',
  '|a|b|\n|c|d|\n',
  '* H\n| a | b |\n|-\n',
  '  | a | b |\n  |-\n  | c | d |\n',
  '| a | b |\n| c | d |',
  '| Item | Cost |\n|------+------|\n| Flights | 420 |\n| Hotel | 310 |\n\ntext after\n',
  '| a | b |\n|---+---|\n| c | d |\n|---+---|\n| e | f |\n',
  'text before\n| x | y | z |\n| 1 | 2 |\n',
  '| a | b |\n|---+---|\n',
];
const cases = [];
for (const text of TEXTS) for (let pos = 0; pos <= text.length; pos++) cases.push({ text, pos });
const el = `
(require 'org) (require 'json)
(let* ((json-object-type 'alist) (json-array-type 'list)
       (cs (with-temp-buffer (insert-file-contents (getenv "ORACLE_IN")) (json-read-from-string (buffer-string))))
       (out '()))
  (dolist (c cs)
    (with-temp-buffer
      (org-mode)
      (insert (cdr (assq 'text c)))
      (goto-char (1+ (cdr (assq 'pos c))))
      (let ((inhibit-message t) (message-log-max nil) (before (buffer-string)) (in-table (org-at-table-p 'any)))
        (push (condition-case e
                  (progn (org-cycle) (list (cons 'table (if in-table t :json-false)) (cons 'text (substring-no-properties (buffer-string))) (cons 'pos (1- (point)))))
                (error (list (cons 'error (error-message-string e)))))
              out))))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttab-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', maxBuffer: 1 << 28 });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/table-tab-oracle.json', JSON.stringify(cases.map((c, i) => ({ ...c, result: results[i] }))));
console.log(`${cases.length} cases, ${results.filter((x) => x.error).length} errors, ${results.filter((x) => x.table).length} in a table`);
