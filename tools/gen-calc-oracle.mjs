// Regenerates test/fixtures/calc-oracle.json from real Emacs (needs `emacs` on PATH; org-table-recalculate does the work).
//   node tools/gen-calc-oracle.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPLEX_CASES as COMPLEX, VECTOR_CASES } from '../test/calc-oracle-cases.mjs';

const COMPLEX_CASES = [...COMPLEX, ...VECTOR_CASES];
const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'calc-oracle-'));
const lisp = `
(require 'org)(require 'org-table)(require 'calc)
(defun orc (cells formula)
  (with-temp-buffer
    (org-mode)
    (insert "| " (mapconcat #'identity cells " | ") " | |\\n#+TBLFM: " formula "\\n")
    (goto-char (point-min))
    (condition-case e
        (progn (org-table-recalculate 'all t)
               (replace-regexp-in-string "[ ]+" " " (buffer-substring (point-min) (line-end-position))))
      (error (format "ERR %s" (error-message-string e))))))
(let ((cases (with-temp-buffer (insert-file-contents (car command-line-args-left)) (read (current-buffer)))))
  (with-temp-file (cadr command-line-args-left)
    (dolist (c cases) (insert (replace-regexp-in-string "\\n" " " (orc (car c) (cadr c))) "\\n"))))
`;
writeFileSync(join(dir, 'run.el'), lisp);
const lispString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const eld = `(${COMPLEX_CASES.map(([cells, formula]) => `((${cells.map(lispString).join(' ')}) ${lispString(formula)})`).join('\n')})`;
writeFileSync(join(dir, 'cases.eld'), eld);
execFileSync('emacs', ['--batch', '-l', join(dir, 'run.el'), join(dir, 'cases.eld'), join(dir, 'out.txt')], { stdio: ['ignore', 'ignore', 'inherit'] });
const lines = readFileSync(join(dir, 'out.txt'), 'utf8').trimEnd().split('\n');
if (lines.length !== COMPLEX_CASES.length) throw new Error(`Emacs returned ${lines.length} rows for ${COMPLEX_CASES.length} cases`);
const fixture = COMPLEX_CASES.map(([cells, formula], i) => ({ cells, formula, expect: lines[i] }));
writeFileSync(join(here, '..', 'test', 'fixtures', 'calc-oracle.json'), `${JSON.stringify(fixture, null, 1)}\n`);
console.log(`wrote ${fixture.length} cases`);
