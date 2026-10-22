#!/usr/bin/env node
/**
 * Writes test/fixtures/calendar/hebrew-diary.json: for each Hebrew diary function (the weekly portion, Rosh Hodesh, the omer, and the birthday
 * and yahrzeit of some tricky civil dates) and each Gregorian year from 1900 to 2100, a SHA-1 of the lines "YYYY-MM-DD text" that real Emacs 29.3
 * produces for the year's days. test/hebrew-diary.test.js computes the same lines with the app and compares the digests.
 *
 *   node tools/gen-hebrew-diary-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FUNCTIONS = [
  '(diary-hebrew-parasha)', '(diary-hebrew-rosh-hodesh)', '(diary-hebrew-omer)',
  ...['(3 14 1980)', '(11 28 2019)', '(12 4 2021)', '(3 10 2024)', '(3 24 2024)', '(3 25 2020)', '(2 29 2000)', '(9 1 1999)'].flatMap((d) => {
    const [m, day, y] = d.slice(1, -1).split(' ');
    return [`(diary-hebrew-birthday ${m} ${day} ${y})`, `(diary-hebrew-yahrzeit ${m} ${day} ${y})`, `(diary-hebrew-yahrzeit ${m} ${day} ${y} nil t)`];
  }),
];

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const el = `
(require 'diary-lib) (require 'json) (require 'cl-lib)
(defvar date) (defvar entry)
(let ((exprs (json-parse-string (getenv "FUNCS") :array-type 'list)) (out '()))
  (dolist (src exprs)
    (let ((form (car (read-from-string src))) (years '()))
      (dotimes (i 201)
        (let* ((year (+ 1900 i))
               (abs (calendar-absolute-from-gregorian (list 1 1 year)))
               (end (calendar-absolute-from-gregorian (list 12 31 year)))
               (lines '()))
          (while (<= abs end)
            (let* ((g (calendar-gregorian-from-absolute abs))
                   (date (list (nth 0 g) (nth 1 g) (nth 2 g))) (entry "ENTRY")
                   (v (eval form nil)))
              (when v (push (format "%04d-%02d-%02d %s" (nth 2 g) (nth 0 g) (nth 1 g) (cond ((and (consp v) (stringp (cdr v))) (cdr v)) ((stringp v) v) (t "t"))) lines)))
            (setq abs (1+ abs)))
          (push (secure-hash 'sha1 (mapconcat #'identity (nreverse lines) "\\n")) years)))
      (push (list src (vconcat (nreverse years))) out)))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (mapcar (lambda (r) (vector (car r) (cadr r))) (nreverse out)))))))
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hebrew-oracle-'));
  const outFile = path.join(dir, 'out.json');
  fs.writeFileSync(path.join(dir, 'run.el'), el);
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ: 'America/New_York', FUNCS: JSON.stringify(FUNCTIONS), ORACLE_OUT: outFile }, encoding: 'utf8', input: '', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error(r.stderr || r.error); process.exit(1); }
  const expected = Object.fromEntries(JSON.parse(fs.readFileSync(outFile, 'utf8')));
  fs.writeFileSync('test/fixtures/calendar/hebrew-diary.json', JSON.stringify({ emacs: '29.3', first: 1900, last: 2100, expected }) + '\n');
  console.log(`${Object.keys(expected).length} functions, 201 years each`);
}
