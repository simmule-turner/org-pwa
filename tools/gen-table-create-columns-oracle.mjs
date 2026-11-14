#!/usr/bin/env node
/**
 * Writes test/fixtures/table-create-columns-oracle.json: what Emacs's org-table-recalculate-buffer-tables does to a field formula
 * whose field is past the last column, for each value of org-table-formula-create-columns (nil, t, warn, prompt answered yes, prompt
 * answered no): the text left or the error, the warnings shown (org-display-warning) and the questions asked (yes-or-no-p).
 * test/table-create-columns-oracle.test.js holds the app to it.
 *   node tools/gen-table-create-columns-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const T = (rows, tblfm) => rows.join('\n') + '\n#+TBLFM: ' + tblfm;
const ONE = ['| 2 |', '| 4 |', '| 8 |'];
const TWO = ['| 1 | 2 |', '| 3 | 4 |', '| 5 | 6 |'];
const HDR = ['| a |', '|---|', '| 1 |', '| 2 |', '| 3 |'];
const TABLES = [
  T(ONE, '@1$2=5'),
  T(ONE, '@3$2=5'),
  T(ONE, '@2$4=5'),
  T(ONE, '@1$2..@2$3=7'),
  T(ONE, '@1$2..@3$3=7'),
  T(ONE, '@2$2..@3$3=7'),
  T(ONE, '@1$3..@2$2=7'),
  T(ONE, '@2$2..@1$3=7'),
  T(ONE, '@1$2..@1$4=7'),
  T(ONE, '@1$2..@3$2=7'),
  T(ONE, '@1$2=5::@3$2=6'),
  T(ONE, '@3$2=6::@1$2=5'),
  T(ONE, '@1$3=5::@1$2=$>'),
  T(ONE, '@1$2=1::@1$3=@1$2+1'),
  T(ONE, '@1$2=@1$5'),
  T(ONE, '@2=3'),
  T(ONE, '@1$1001=1'),
  T(ONE, '$3=15'),
  T(ONE, '$3=15::@1$2=5'),
  T(ONE, '$2=1::@2$4=5'),
  T(TWO, '@1$2=9'),
  T(TWO, '@1$1..@3$2=9'),
  T(TWO, '@1$2..@3$3=9'),
  T(TWO, '@3$3=9'),
  T(TWO, '@1$3=9'),
  T(['| a | b | c |', '| 1 |'], '@1$3=9'),
  T(['| 1 |', '| a | b | c |'], '@1$3=9'),
  T(['| 1 | 2 | 3 |', '| 1 |'], '@1$3=9'),
  T(['| 1 | 2 | 3 |', '| 1 |'], '@2$3=9'),
  T(['| 1 |', '| 1 | 2 |', '| 1 |'], '@2$3=9'),
  T(HDR, '@1$2=5'),
  T(HDR, '@3$2=5'),
  T(HDR, '@2$2..@3$3=5'),
  T(['| # | 1 |', '| # | 2 |', '| x | 3 |'], '@1$3=5'),
  T(['| # | 1 |', '| x | 2 |', '| x | 3 |'], '@3$3=5'),
  T(['| # | 1 |', '| _ | 2 |', '| _ | 3 |'], '@2$3=5'),
  T(['| 1 | 2 |', '| _ | 3 |'], '@1$3=5'),
];
const CASES = [];
for (const org of TABLES) for (const [value, answer] of [['nil', 'yes'], ['t', 'yes'], ['warn', 'yes'], ['prompt', 'yes'], ['prompt', 'no']]) CASES.push({ org, value, answer });

const el = `
(require 'org) (require 'json)
(defun run-case (c)
  (let ((org (alist-get 'org c)) (value (intern (alist-get 'value c))) (yes (equal (alist-get 'answer c) "yes"))
        (warnings nil) (prompts nil))
    (with-temp-buffer
      (insert org) (org-mode) (goto-char (point-min))
      (let ((org-table-formula-create-columns value) (inhibit-message t) (message-log-max nil))
        (cl-letf (((symbol-function 'yes-or-no-p) (lambda (p) (push p prompts) yes))
                  ((symbol-function 'org-display-warning) (lambda (m) (push m warnings))))
          (let ((result (condition-case e (progn (org-table-recalculate-buffer-tables) (buffer-string))
                          (error (concat "ERROR " (error-message-string e))))))
            (list (cons 'emacs result) (cons 'warnings (vconcat (nreverse warnings))) (cons 'prompts (vconcat (nreverse prompts))))))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocreatecols-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(CASES));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', timeout: 120000 });
if (r.status !== 0) throw new Error('Emacs failed: ' + r.stderr);
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(new URL('../test/fixtures/table-create-columns-oracle.json', import.meta.url), JSON.stringify({ emacs: version, cases: CASES.map((c, i) => ({ ...c, ...out[i] })) }, null, 1) + '\n');
console.log(`wrote ${CASES.length} cases from Emacs ${version}, ${out.filter((x) => x.emacs.startsWith('ERROR')).length} errors`);
