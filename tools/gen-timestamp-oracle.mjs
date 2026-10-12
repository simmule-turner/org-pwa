#!/usr/bin/env node
/**
 * Writes test/fixtures/timestamp-oracle.json: how real Emacs (org-element, Emacs 29.3) reads a grid of timestamp strings (with and
 * without a weekday, single-digit hours, time ranges, repeaters and warnings in either order, bad brackets, date ranges) and how it
 * names the weekday of a date. test/timestamp-oracle.test.js holds src/org-timestamp.js to it.
 *
 *   node tools/gen-timestamp-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const strings = [];
const dates = ['2026-10-11', '2024-02-29', '2100-03-01', '2026-01-31'];
const dows = ['', ' Sun', ' Mon', ' Xyz'];
const times = ['', ' 09:00', ' 9:05', ' 09:00-10:30', ' 9:00-9:30', ' 23:59'];
const reps = ['', ' +1w', ' ++2m', ' .+3d', ' +1h', ' +10y'];
const warns = ['', ' -3d', ' --2d'];
let n = 0;
for (const [open, close] of [['<', '>'], ['[', ']']]) {
  for (const date of dates) for (const dow of dows) for (const time of times) for (const rep of reps) for (const warn of warns) {
    const orders = rep && warn ? [rep + warn, warn + rep] : [rep + warn];
    for (const tail of orders) {
      n++;
      // a thinned grid: every value meets the others, but not all combinations
      if (open === '[') { if (n % 7 !== 0) continue; } else if (n % 2 !== 0) continue;
      strings.push(`${open}${date}${dow}${time}${tail}${close}`);
    }
  }
}
for (const s of ['<2026-10-11 Sun>--<2026-10-13 Tue>', '[2026-10-11 Sun]--[2026-10-13 Tue]', '<2026-10-11 Sun 10:00>--<2026-10-11 Sun 12:00>', '<2026-10-11 Sun> text', 'x <2026-10-11 Sun>', '<2026-10-11  Sun>', '<2026-10-11 Sun  09:00>', '<2026-10-11>', '<2026-10-1 Sun>', '<26-10-11 Sun>', '<2026-10-11 Sun 09:00 +1w -2d>', '<2026-10-11 Sun +1w 09:00>']) strings.push(s);

// weekdays: every date over a spread of years, named by Emacs
const weekdayDates = [];
for (const y of [1999, 2000, 2024, 2026, 2100]) for (const [m, d] of [[1, 1], [2, 28], [3, 1], [12, 31], [7, 4]]) weekdayDates.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
weekdayDates.push('2024-02-29');

const el = `
(require 'org) (require 'org-element) (require 'cl-lib) (require 'json)
(setq system-time-locale "C")
(defun f (k p) (let ((v (org-element-property k p))) (if v v :json-false)))
(defun parse (str)
  (with-temp-buffer
    (insert str) (org-mode) (goto-char (point-min))
    (let ((ctx (org-element-context)))
      (if (and (eq (org-element-type ctx) 'timestamp) (equal (org-element-property :raw-value ctx) str))
          (list (cons 'type (symbol-name (org-element-property :type ctx)))
                (cons 'ys (f :year-start ctx)) (cons 'ms (f :month-start ctx)) (cons 'ds (f :day-start ctx))
                (cons 'hs (f :hour-start ctx)) (cons 'is (f :minute-start ctx))
                (cons 'ye (f :year-end ctx)) (cons 'me (f :month-end ctx)) (cons 'de (f :day-end ctx))
                (cons 'he (f :hour-end ctx)) (cons 'ie (f :minute-end ctx))
                (cons 'rt (let ((v (org-element-property :repeater-type ctx))) (if v (symbol-name v) :json-false)))
                (cons 'rv (f :repeater-value ctx))
                (cons 'ru (let ((v (org-element-property :repeater-unit ctx))) (if v (symbol-name v) :json-false)))
                (cons 'wt (let ((v (org-element-property :warning-type ctx))) (if v (symbol-name v) :json-false)))
                (cons 'wv (f :warning-value ctx))
                (cons 'wu (let ((v (org-element-property :warning-unit ctx))) (if v (symbol-name v) :json-false))))
        :json-false))))
(defun weekday (d)
  (let ((p (mapcar #'string-to-number (split-string d "-"))))
    (format-time-string "%a" (encode-time 0 0 12 (nth 2 p) (nth 1 p) (nth 0 p)) t)))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (in (json-read-from-string (buffer-string))))
    (with-temp-file (getenv "ORACLE_OUT")
      (insert (json-encode (list (cons 'parsed (mapcar #'parse (cdr (assq 'strings in))))
                                 (cons 'weekdays (mapcar #'weekday (cdr (assq 'dates in))))))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-oracle-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify({ strings, dates: weekdayDates }));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ: 'America/New_York', ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr || r.error); process.exit(1); }
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const cases = strings.map((s, i) => ({ ts: s, emacs: out.parsed[i] === false ? null : out.parsed[i] }));
const weekdays = weekdayDates.map((d, i) => ({ date: d, weekday: out.weekdays[i] }));
fs.writeFileSync('test/fixtures/timestamp-oracle.json', JSON.stringify({ emacs: '29.3', cases, weekdays }) + '\n');
console.log(`${cases.length} strings (${cases.filter((c) => c.emacs).length} read as timestamps), ${weekdays.length} weekdays`);
