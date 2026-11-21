#!/usr/bin/env node
/**
 * Writes test/fixtures/date-prompt-oracle.json: what Emacs 29.3 (Org 9.6) shows around the date prompt -- the prompt text `org-read-date` asks (read-string's
 * prompt), the live "=> <date>" it displays while a date is typed, and where the calendar cursor goes for each motion key. test/date-prompt-oracle.test.js
 * holds src/date-prompt.js to it. Run in UTC.
 *   node tools/gen-date-prompt-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INPUTS, NOWS } from './gen-read-date-oracle.mjs';

const el = String.raw`;;; -*- lexical-binding: t -*-
(require 'org) (require 'json) (require 'cl-lib) (require 'calendar)
(defvar org-time-was-given) (defvar org-end-time-was-given)
(setq org-read-date-popup-calendar nil)
(defun parse (s) (apply #'encode-time (list (string-to-number (substring s 17 19)) (string-to-number (substring s 14 16)) (string-to-number (substring s 11 13)) (string-to-number (substring s 8 10)) (string-to-number (substring s 5 7)) (string-to-number (substring s 0 4)) nil -1 nil)))
(defvar cap nil)
(advice-add 'read-string :override (lambda (prompt &rest _) (setq cap prompt) ""))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (json-key-type 'string)
         (cases (json-read-from-string (buffer-string))) (out nil))
    (calendar)
    (dolist (c cases)
      (let* ((kind (cdr (assoc "kind" c)))
             (now (parse (concat (cdr (assoc "now" c)) ":00")))
             (def (let ((d (cdr (assoc "def" c)))) (and d (parse (concat d ":00")))))
             (ext (or (cdr (assoc "ext" c)) 0))
             (pf (pcase (cdr (assoc "pf" c)) ("t" t) ("time" 'time) (_ nil)))
             (with-time (eq (cdr (assoc "withTime" c)) t))
             (org-extend-today-until ext) (org-read-date-prefer-future pf)
             (res nil))
        (cl-letf (((symbol-function 'current-time) (lambda () now))
                  ((symbol-function 'decode-time) (let ((orig (symbol-function 'decode-time))) (lambda (&optional time zone form) (funcall orig (or time now) zone form))))
                  ((symbol-function 'format-time-string) (let ((orig (symbol-function 'format-time-string))) (lambda (format &optional time &rest args) (apply orig format (or time now) args)))))
          (cond
           ((equal kind "label")
            (setq cap nil)
            (org-read-date with-time t nil (cdr (assoc "prefix" c)) def nil)
            (setq res cap))
           ((equal kind "describe")
            (let* ((org-def (or def now)) (org-defdecode (decode-time org-def)) (org-time-was-given nil) (org-end-time-was-given nil)
                   (org-with-time with-time))
              (when (< (nth 2 org-defdecode) org-extend-today-until) (setf (nth 2 org-defdecode) -1) (setf (nth 1 org-defdecode) 59) (setq org-def (org-encode-time org-defdecode) org-defdecode (decode-time org-def)))
              (let* ((f (org-read-date-analyze (cdr (assoc "ans" c)) org-def org-defdecode))
                     (fmt (org-time-stamp-format (or with-time org-time-was-given) nil nil))
                     (txt (concat "=> " (format-time-string fmt (org-encode-time f)))))
                (when (and org-end-time-was-given (string-match org-plain-time-of-day-regexp txt))
                  (setq txt (concat (substring txt 0 (match-end 0)) "-" org-end-time-was-given (substring txt (match-end 0)))))
                (when org-read-date-analyze-futurep (setq txt (concat txt " (=>F)")))
                (setq res txt))))
           ((equal kind "move")
            (let* ((d (cdr (assoc "from" c))) (ymd (list (nth 1 d) (nth 2 d) (nth 0 d))))
              (calendar-goto-date ymd)
              (eval (car (read-from-string (cdr (assoc "form" c)))) t)
              (let ((cur (calendar-cursor-to-date)))
                (setq res (format "%04d-%02d-%02d" (nth 2 cur) (nth 0 cur) (nth 1 cur)))))))
          (push (append c (list (cons "res" res))) out))))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (nreverse out)))))))
`;

const cases = [];
for (const now of NOWS) for (const ext of [0, 4]) for (const withTime of [false, true]) for (const prefix of [null, 'SCHEDULED', 'DEADLINE']) for (const def of [null, '2027-02-27 14:05', '2026-11-14 02:30', '2026-12-31 23:59', '2026-11-14 00:05']) cases.push({ kind: 'label', now, ext, withTime, prefix, def });
const ANSWERS = [...INPUTS.filter((_, i) => i % 3 === 0), '+1d 2026-12-24', ' 2026-12-24', 'fri 2026-12-24', '9:30 2027-01-05', '+2d  ', '2026-12-24 9:30-10:45', '9:30-10:45', '10:00+1:30'];
for (const now of NOWS.slice(0, 4)) for (const pf of ['nil', 't', 'time']) for (const withTime of [false, true]) for (const a of ANSWERS) cases.push({ kind: 'describe', now, pf, ext: 0, withTime, ans: `${a} `, def: null });
for (const a of ANSWERS) cases.push({ kind: 'describe', now: NOWS[1], pf: 't', ext: 0, withTime: false, ans: `${a} `, def: '2027-02-27 14:05' });
const FROMS = [[2026, 1, 31], [2028, 2, 29], [2026, 12, 31], [2026, 3, 1], [2026, 11, 20], [2024, 2, 29], [2026, 1, 1], [2026, 5, 31]];
const FORMS = { 'S-<right>': '(calendar-forward-day 1)', 'S-<left>': '(calendar-backward-day 1)', 'S-<down>': '(calendar-forward-week 1)', 'S-<up>': '(calendar-backward-week 1)', 'M-S-<right>': '(calendar-forward-month 1)', 'M-S-<left>': '(calendar-backward-month 1)', 'M-S-<down>': '(calendar-forward-year 1)', 'M-S-<up>': '(calendar-backward-year 1)' };
for (const from of FROMS) for (const [key, form] of Object.entries(FORMS)) cases.push({ kind: 'move', now: NOWS[0], from, key, form });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const out = path.join(dir, 'out.json');
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ: 'UTC', ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: out }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
fs.writeFileSync(new URL('../test/fixtures/date-prompt-oracle.json', import.meta.url), JSON.stringify(JSON.parse(fs.readFileSync(out, 'utf8'))));
console.log('wrote', cases.length, 'cases');
