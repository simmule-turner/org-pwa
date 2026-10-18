#!/usr/bin/env node
/**
 * Writes test/fixtures/sexp/general.expected.json: for each Lisp expression in test/fixtures/sexp/general.exprs.json, the days
 * from 2026-01-01 to 2029-12-31 on which real Emacs's diary evaluator (date bound to (month day year)) says it is non-nil.
 * test/sexp-oracle.test.js holds evaluateSexpr to it.
 *
 *   node tools/gen-sexp-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exprs = JSON.parse(fs.readFileSync('test/fixtures/sexp/general.exprs.json', 'utf8'));
const el = `
(require 'diary-lib) (require 'json) (require 'cl-lib)
(defvar date) (defvar entry)
(let ((exprs (json-parse-string (getenv "SEXP_EXPRS") :array-type 'list)) (out '()))
  (dolist (src exprs)
    (let ((form (car (read-from-string src))) (days '())
          (abs (calendar-absolute-from-gregorian '(1 1 2026)))
          (end (calendar-absolute-from-gregorian '(12 31 2029))))
      (while (<= abs end)
        (let* ((g (calendar-gregorian-from-absolute abs))
               (date (list (nth 0 g) (nth 1 g) (nth 2 g))) (entry ""))
          (when (eval form nil) (push (format "%04d-%02d-%02d" (nth 2 g) (nth 0 g) (nth 1 g)) days)))
        (setq abs (1+ abs)))
      (push (list src (vconcat (nreverse days))) out)))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (mapcar (lambda (r) (vector (car r) (cadr r))) (nreverse out)))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sexp-oracle-'));
const elFile = path.join(dir, 'run.el');
const outFile = path.join(dir, 'out.json');
fs.writeFileSync(elFile, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, SEXP_EXPRS: JSON.stringify(exprs), ORACLE_OUT: outFile }, encoding: 'utf8', input: '' });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const expected = {};
for (const [src, days] of JSON.parse(fs.readFileSync(outFile, 'utf8'))) expected[src] = days;
fs.writeFileSync('test/fixtures/sexp/general.expected.json', JSON.stringify({ emacs: '29.3', first: '2026-01-01', last: '2029-12-31', expected }, null, 1) + '\n');
console.log(`${Object.keys(expected).length} expressions, ${Object.values(expected).reduce((n, d) => n + d.length, 0)} matching days`);
