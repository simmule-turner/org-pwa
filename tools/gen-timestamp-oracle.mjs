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

// days and times that do not exist, kept as written; zero-padded and capital-letter repeaters
for (const s of ['<2021-02-29>', '<2020-13-01>', '<2020-00-10>', '<2020-01-32 Wed>', '<2020-02-30 Sun 10:00>', '[2021-04-31]', '<2020-01-01 24:00>', '<2020-01-01 25:00>', '<2020-01-01 10:60>', '<2020-01-01 Wed 9:05-10:75>',
  '<2020-01-01 Wed 99:99>', '<2020-01-01 Wed 10:00-24:00>', '<2020-01-01 Wed 23:00-25:00>', '<2020-01-01 +01d>', '<2020-01-01 Wed +007w>', '<2020-01-01 Wed ++02m -03d>', '<2020-01-01 Wed .+1y>', '<2020-01-01 +1d/2d>', '<2020-01-01 Wed +01d/02d>',
  '<2020-01-01 Wed .+1w/2w>', '<2020-01-01 +1H>', '<2020-01-01 +1D>', '<2020-01-01 +1Y>', '<2020-01-01 -0d>', '<2020-01-01 --01d>', '<2020-01-01 -1M>']) strings.push(s);

// timestamps found in running text: where Org has objects and where it has none
const contexts = ['a <2020-01-01> b', 'a <2020-01-01 Wed 10:00> b [2020-02-02]', '=<2020-01-01>= x', 'x ~<2020-01-01>~ y', '*<2020-01-01>*', '#+begin_src\n<2020-01-01>\n#+end_src\n<2020-02-02>',
  '#+begin_example\n<2020-01-01>\n#+end_example', '#+begin_comment\n<2020-01-01>\n#+end_comment', '#+begin_quote\n<2020-01-01>\n#+end_quote', '#+begin_export html\n<2020-01-01>\n#+end_export', '# <2020-01-01>', ': <2020-01-01>', '#+KEY: <2020-01-01>',
  '#+TITLE: <2020-01-01>', '#+CAPTION: <2020-01-01>\nx', '[[<2020-01-01>]]', '[[a][<2020-01-01>]]', '[[a][b <2020-01-01> c]]', '<<2020-01-01>>', '<<<2020-01-01>>>', 'CLOCK: [2020-01-01 Wed 10:00]--[2020-01-01 Wed 11:00] =>  1:00',
  '<2020-01-01>--<2020-01-02>', '[2020-01-01]--[2020-01-02]', '<2020-01-01>--[2020-01-02]', '[2020-01-01]--<2020-01-02>', '<2020-01-01>--<2020-01-03> and <2020-01-05>', '<2020-01-01> -- <2020-01-02>', '<2020-01-01>-<2020-01-02>',
  '<2020-01-01 Wed 10:00>--<2020-01-01 Wed 11:00>', '<2020-01-01 Wed 10:00-11:00>', '- <2020-01-01>', '- [ ] a <2020-01-01 +1w>', '| <2020-01-01> | x |', '1. a\n   <2020-01-01>', ':PROPERTIES:\n:A: <2020-01-01>\n:END:\n<2020-02-02>',
  ':LOGBOOK:\n- State "DONE" from "TODO" [2020-01-01 Wed 10:00]\n:END:', '* H <2020-01-01>', '* TODO H [2020-01-01]--[2020-01-02]\nbody <2020-02-02>', 'x\\\n<2020-01-01>', 'a [fn:1: <2020-01-01>] b', '\\begin{x}\n<2020-01-01>\n\\end{x}',
  '$<2020-01-01>$', 'src_x{<2020-01-01>}', '{{{m(<2020-01-01>)}}}', '=a= <2020-01-01> ~b~', '<2020-01-01><2020-01-02>', '<2020-01-01> <2020-01-02>', '<2021-02-29>--<2021-02-30>'];

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
(defun found (str)
  (with-temp-buffer
    (insert str "\\n") (org-mode)
    (vconcat (org-element-map (org-element-parse-buffer) 'timestamp
      (lambda (ctx)
        (list (cons 'raw (org-element-property :raw-value ctx)) (cons 'type (symbol-name (org-element-property :type ctx)))
              (cons 'ys (f :year-start ctx)) (cons 'ms (f :month-start ctx)) (cons 'ds (f :day-start ctx))
              (cons 'hs (f :hour-start ctx)) (cons 'is (f :minute-start ctx))
              (cons 'ye (f :year-end ctx)) (cons 'me (f :month-end ctx)) (cons 'de (f :day-end ctx))
              (cons 'he (f :hour-end ctx)) (cons 'ie (f :minute-end ctx))))))))
(defun weekday (d)
  (let ((p (mapcar #'string-to-number (split-string d "-"))))
    (format-time-string "%a" (encode-time 0 0 12 (nth 2 p) (nth 1 p) (nth 0 p)) t)))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (in (json-read-from-string (buffer-string))))
    (with-temp-file (getenv "ORACLE_OUT")
      (insert (json-encode (list (cons 'parsed (mapcar #'parse (cdr (assq 'strings in))))
                                 (cons 'weekdays (mapcar #'weekday (cdr (assq 'dates in))))
                                 (cons 'found (mapcar #'found (cdr (assq 'contexts in))))))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-oracle-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify({ strings, dates: weekdayDates, contexts }));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ: 'America/New_York', ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr || r.error); process.exit(1); }
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const cases = strings.map((s, i) => ({ ts: s, emacs: out.parsed[i] === false ? null : out.parsed[i] }));
const weekdays = weekdayDates.map((d, i) => ({ date: d, weekday: out.weekdays[i] }));
const found = contexts.map((text, i) => ({ text, emacs: out.found[i] }));
fs.writeFileSync('test/fixtures/timestamp-oracle.json', JSON.stringify({ emacs: '29.3', cases, weekdays, found }) + '\n');
console.log(`${cases.length} strings (${cases.filter((c) => c.emacs).length} read as timestamps), ${weekdays.length} weekdays`);
