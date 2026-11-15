#!/usr/bin/env node
/**
 * Writes test/fixtures/timestamp-shift-oracle.json: the SCHEDULED stamps of a heading after org-timestamp-change by a day, seven days
 * (a week) and a month, up and down, for stamps with the time, a time range, a repeater, a warning period, an inactive one, and dates at
 * the end of a month and a year. test/timestamp-shift.test.js holds src/timestamp-shift.js (the planning dialog's steppers) to it.
 *   node tools/gen-timestamp-shift-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STAMPS = [
  '<2026-11-14 Sat>', '<2026-11-14 Sat 10:00>', '<2026-11-14 Sat 10:00-11:30>', '<2026-11-14 Sat +1w>', '<2026-11-14 Sat .+2d/4d>', '<2026-11-14 Sat -3d>',
  '<2026-11-14 Sat 09:30 ++1m -2d>', '[2026-11-14 Sat]', '<2026-01-31 Sat>', '<2026-03-31 Tue>', '<2026-12-31 Thu>', '<2026-01-01 Thu>', '<2028-02-29 Tue>', '<2027-02-28 Sun 23:30>',
];
const SHIFTS = [[1, 'day'], [-1, 'day'], [7, 'day'], [-7, 'day'], [1, 'month'], [-1, 'month']];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-'));
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(STAMPS.flatMap((s) => SHIFTS.map(([n, what]) => ({ stamp: s, n, what })))));
const el = String.raw`;;; -*- lexical-binding: t -*-
(require 'org) (require 'json) (require 'cl-lib)
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (json-key-type 'string)
         (cases (json-read-from-string (buffer-string))) (out nil))
    (dolist (c cases)
      (with-temp-buffer
        (insert "* TODO Task\nSCHEDULED: " (cdr (assoc "stamp" c)) "\n")
        (org-mode)
        (goto-char (point-min)) (re-search-forward "SCHEDULED: [<[]")
        (org-timestamp-change (cdr (assoc "n" c)) (intern (cdr (assoc "what" c))))
        (goto-char (point-min)) (re-search-forward "SCHEDULED: \\(.*\\)$")
        (push (list (cons "stamp" (cdr (assoc "stamp" c))) (cons "n" (cdr (assoc "n" c))) (cons "what" (cdr (assoc "what" c))) (cons "result" (match-string 1))) out)))
    (princ (json-encode (vconcat (nreverse out))))))
`;
fs.writeFileSync(path.join(dir, 'run.el'), el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), TZ: 'UTC' } });
const m = r.stdout.match(/\[\{.*\}\]$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2500)); process.exit(1); }
const rows = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/timestamp-shift-oracle.json', import.meta.url), JSON.stringify(rows, null, 1) + '\n');
console.log(`${rows.length} cases`);
