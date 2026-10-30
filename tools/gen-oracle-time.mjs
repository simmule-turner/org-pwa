#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-time.json: what Emacs 29.3 answers for the calendar conversions (Gregorian, Julian, Hebrew, Islamic,
 * Bahai, Chinese: from an absolute day number, and to one from valid and invalid dates), the day of the week, and
 * org-duration-to-minutes. The cases come from tools/oracle-time-cases.mjs; test/oracle-time.test.js holds the app to the answers.
 *   node tools/gen-oracle-time.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { absoluteDays, durationStrings, oddDates, oddTimestamps, sexpExpressions } from './oracle-time-cases.mjs';

const el = String.raw`
(require 'org) (require 'org-duration) (require 'calendar) (require 'cal-hebrew) (require 'cal-islam) (require 'cal-julian) (require 'cal-bahai) (require 'cal-china) (require 'json) (require 'diary-lib) (require 'holidays) (require 'solar) (require 'org-agenda)
(defvar date) (defvar entry)
(defun fld (k p) (let ((v (org-element-property k p))) (if v v :json-false)))
(defun sym (k p) (let ((v (org-element-property k p))) (if v (symbol-name v) :json-false)))
(defun parse-ts (str)
  (with-temp-buffer
    (insert str) (org-mode) (goto-char (point-min))
    (let ((ctx (condition-case nil (org-element-context) (error nil))))
      (if (and ctx (eq (org-element-type ctx) 'timestamp) (equal (org-element-property :raw-value ctx) str))
          (list (cons 'type (symbol-name (org-element-property :type ctx)))
                (cons 'ys (fld :year-start ctx)) (cons 'ms (fld :month-start ctx)) (cons 'ds (fld :day-start ctx))
                (cons 'hs (fld :hour-start ctx)) (cons 'is (fld :minute-start ctx))
                (cons 'ye (fld :year-end ctx)) (cons 'me (fld :month-end ctx)) (cons 'de (fld :day-end ctx))
                (cons 'he (fld :hour-end ctx)) (cons 'ie (fld :minute-end ctx))
                (cons 'rt (sym :repeater-type ctx)) (cons 'rv (fld :repeater-value ctx)) (cons 'ru (sym :repeater-unit ctx))
                (cons 'wt (sym :warning-type ctx)) (cons 'wv (fld :warning-value ctx)) (cons 'wu (sym :warning-unit ctx)))
        :json-false))))
(defun safe (thunk) (condition-case e (funcall thunk) (error (list :error (error-message-string e)))))
(defun lst (v) (if (and (consp v) (eq (car v) :error)) (vector "ERROR") (vconcat v)))
(defun to-abs (cal d)
  (safe (lambda ()
    (pcase cal
      ("gregorian" (calendar-absolute-from-gregorian d))
      ("julian" (calendar-julian-to-absolute d))
      ("hebrew" (calendar-hebrew-to-absolute d))
      ("islamic" (calendar-islamic-to-absolute d))
      ("bahai" (calendar-bahai-to-absolute d))
      ("chinese" (calendar-chinese-to-absolute d))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (json-key-type 'string) (in (json-read-from-string (buffer-string)))
         (days (cdr (assoc "days" in))) (odd (cdr (assoc "odd" in))) (durs (cdr (assoc "durs" in))) (sexps (cdr (assoc "sexps" in))) (tss (cdr (assoc "tss" in))))
    (with-temp-file (getenv "ORACLE_OUT")
      (insert (json-encode
        (list (cons "days" (vconcat (mapcar (lambda (a)
                  (list (cons "abs" a)
                        (cons "dow" (calendar-day-of-week (calendar-gregorian-from-absolute a)))
                        (cons "g" (lst (safe (lambda () (calendar-gregorian-from-absolute a)))))
                        (cons "j" (lst (safe (lambda () (calendar-julian-from-absolute a)))))
                        (cons "h" (lst (safe (lambda () (calendar-hebrew-from-absolute a)))))
                        (cons "i" (lst (safe (lambda () (calendar-islamic-from-absolute a)))))
                        (cons "b" (lst (safe (lambda () (calendar-bahai-from-absolute a)))))
                        (cons "c" (lst (safe (lambda () (calendar-chinese-from-absolute a)))))))
                days)))
              (cons "odd" (vconcat (mapcar (lambda (o) (let ((r (to-abs (car o) (cadr o)))) (if (consp r) "ERROR" r))) odd)))
              (cons "sexps" (vconcat (mapcar (lambda (src)
                  (let ((form (car (read-from-string src))) (days '()) (abs (calendar-absolute-from-gregorian '(1 1 2026))) (end (calendar-absolute-from-gregorian '(12 31 2029))))
                    (while (<= abs end)
                      (let* ((g (calendar-gregorian-from-absolute abs)) (date (list (nth 0 g) (nth 1 g) (nth 2 g))) (entry "ENTRY")
                             (v (condition-case nil (eval form nil) (error nil))))
                        (when v (push (vector (format "%04d-%02d-%02d" (nth 2 g) (nth 0 g) (nth 1 g)) (cond ((and (consp v) (stringp (cdr v))) (cdr v)) ((stringp v) v) (t "t"))) days)))
                      (setq abs (1+ abs)))
                    (vconcat (nreverse days))))
                sexps)))
              (cons "tss" (vconcat (mapcar (lambda (s) (condition-case nil (parse-ts s) (error :json-false))) tss)))
              (cons "durs" (vconcat (mapcar (lambda (s)
                  (let ((r (safe (lambda () (org-duration-to-minutes s))))) (if (consp r) "ERROR" r)))
                durs)))))))))
`;
const days = absoluteDays();
const odd = oddDates();
const sexps = sexpExpressions();
const tss = oddTimestamps();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otime-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify({ days, odd, durs: durationStrings, sexps, tss }));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ: 'America/New_York', ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 600000 });
if (r.status !== 0) { console.error(r.stderr || r.error); process.exit(1); }
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(new URL('../test/fixtures/oracle-time.json', import.meta.url), JSON.stringify({ emacs: version, days: out.days, odd: odd.map((o, i) => ({ cal: o[0], date: o[1], abs: out.odd[i] })), durations: durationStrings.map((s, i) => ({ text: s, minutes: out.durs[i] })), timestamps: tss.map((ts, i) => ({ ts, emacs: out.tss[i] === false ? null : out.tss[i] })), sexps: Object.fromEntries(sexps.map((src, i) => [src, Object.fromEntries(out.sexps[i])])) }) + '\n');
console.log(`${days.length} days, ${odd.length} odd dates, ${durationStrings.length} durations, ${sexps.length} sexps, ${tss.length} timestamps from Emacs ${version}`);
