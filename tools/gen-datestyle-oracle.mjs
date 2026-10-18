#!/usr/bin/env node
/**
 * Writes test/fixtures/datestyle/expected.json: for each expression in exprs.json (grouped by calendar-date-style), the days from
 * 2026-01-01 to 2029-12-31 on which Emacs's diary-anniversary / diary-cyclic / diary-block / diary-date are non-nil.
 *
 *   node tools/gen-datestyle-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exprs = JSON.parse(fs.readFileSync('test/fixtures/datestyle/exprs.json', 'utf8'));
const el = `
(require 'diary-lib) (require 'json)
(defvar date) (defvar entry)
(let ((groups (json-parse-string (getenv "DS_EXPRS") :object-type 'alist :array-type 'list)) (out '()))
  (dolist (g groups)
    (let ((calendar-date-style (intern (symbol-name (car g)))))
      (dolist (src (cdr g))
        (let ((form (car (read-from-string src))) (days '())
              (abs (calendar-absolute-from-gregorian '(1 1 2026)))
              (end (calendar-absolute-from-gregorian '(12 31 2029))))
          (while (<= abs end)
            (let* ((gr (calendar-gregorian-from-absolute abs)) (date (list (nth 0 gr) (nth 1 gr) (nth 2 gr))) (entry "ENTRY"))
              (when (eval form nil) (push (format "%04d-%02d-%02d" (nth 2 gr) (nth 0 gr) (nth 1 gr)) days)))
            (setq abs (1+ abs)))
          (push (list (symbol-name (car g)) src (vconcat (nreverse days))) out)))))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (mapcar (lambda (r) (vector (nth 0 r) (nth 1 r) (nth 2 r))) (nreverse out)))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-oracle-'));
const elFile = path.join(dir, 'run.el');
const outFile = path.join(dir, 'out.json');
fs.writeFileSync(elFile, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, DS_EXPRS: JSON.stringify(exprs), ORACLE_OUT: outFile }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr || r.error); process.exit(1); }
const rows = JSON.parse(fs.readFileSync(outFile, 'utf8')).map(([style, src, days]) => ({ style, src, days }));
fs.writeFileSync('test/fixtures/datestyle/expected.json', JSON.stringify({ emacs: '29.3', rows }, null, 1) + '\n');
console.log(rows.length + ' expressions, ' + rows.reduce((n, x) => n + x.days.length, 0) + ' matching days');
