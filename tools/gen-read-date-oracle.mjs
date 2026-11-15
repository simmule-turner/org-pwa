#!/usr/bin/env node
/**
 * Writes test/fixtures/read-date-oracle.json: what Emacs 29.3 (Org 9.6) answers for `org-read-date` given typed text, at several current
 * times, with org-read-date-prefer-future nil / t / time, org-extend-today-until 0 / 4, a default time, and with the time range bound as
 * org-time-stamp binds it. Run in UTC so that no daylight saving gap is in the way. test/read-date-oracle.test.js holds src/read-date.js to it.
 *   node tools/gen-read-date-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const INPUTS = ['', '.', 'tomorrow', 'yesterday', 'today', '+1', '-1', '+2d', '-2d', '+1w', '-1w', '++1w', '++2d', '+3m', '-1m', '+1y', '++1y', '-1y', '+0d', '+1h', '++2h', '-3h', '+25h', '++-1h',
  'fri', 'FRI', '+fri', '-fri', '+2fri', '-2mon', '+1mon', 'sun', 'mon', 'tue', 'wed', 'thu', 'sat', 'monday', 'Friday', '++fri', '++2fri', '-3sat', 'w', 'wed 14:30', '+1D',
  '2/5', '2-5', '12/25', '1/31', '2/30', '2/29', '13/1', '5/30/7', '5/30/2031', '1', '5', '13', '15', '29', '30', '31', '32', '0',
  '12:30', '9:05', '9', '0:30', '00:40', '23:59', '24:00', '5pm', '9am', '12:30pm', '12am', '12pm', '1130', '11.30', '9h', '9h30', '9H30', '9:30-10:30', '9:30pm', '9am-5pm', '9:30+1:15', '8:00-9:15pm', '9:30+2',
  '+1d 9:00', 'fri 9:00', '+2d 14:15', '2026-12-01', '2026-12-1', '26-12-1', '12-1-5', '2026-12-01 9:05', '2026-12-01 09:05', '2026-12-01 Tue', '<2026-12-01 Tue>', '[2026-12-01 Tue 10:00]',
  'dec 25', '25 dec', 'Dec 25', 'december 25', 'dec 25 2027', '25 dec 2027', '2027 dec 25', '25 dec 27', 'dec 25 27', '25.12.', '25.12.2027', '25.12.27', '3 feb', 'feb 3', 'feb', '3 febr', '2027-W10', '2027-w10-3', 'w10', 'W1', '10-W5', '2027-W10-0', '2027-W53',
  '10 oct 14:30', '1.2.', '1.2.2028', '12.31', '2026', '2027', '2040', '1960', '27', '12-25', '1-1', '2-29', '2028-2-29', '2027-2-29', '+2', '++2', '-2', '+2 9:00', '+1d+1d', '+1w fri', '+2w mon', '. 9:00', '18:00 +1d', 'mon 8', 'foo', '+x', '9:61', '2026-13-01', '2026-12-32',
  '20261201', '2026-12', '2026335', '2027W10', 'jan 5 9:00', 'sep 12 9', '22 sept 0:34', 'sat 9am', '  fri', 'Tue 5pm', '+3d 5pm', '12/25 8:00', 'mar 31', 'feb 30', 'nov 14', 'nov 13', 'nov 15', '14', '13 9:00', '-0', '+0', '+1m 3', '++1m'];
export const NOWS = ['2026-11-13 20:36', '2026-11-14 10:08', '2026-11-01 00:05', '2024-02-29 12:00', '2026-12-31 23:50', '2026-01-31 10:00', '2026-11-15 01:30', '2026-03-01 03:00'];
const DEFAULTS = [null, '2027-02-27 14:05', '2026-11-14 02:30'];

const el = String.raw`;;; -*- lexical-binding: t -*-
(require 'org) (require 'json) (require 'cl-lib)
(defvar org-time-was-given) (defvar org-end-time-was-given)
(defun fmt (tm) (format-time-string "%Y-%m-%d %H:%M:%S" tm))
(defun parse (s) (apply #'encode-time (list (string-to-number (substring s 17 19)) (string-to-number (substring s 14 16)) (string-to-number (substring s 11 13)) (string-to-number (substring s 8 10)) (string-to-number (substring s 5 7)) (string-to-number (substring s 0 4)) nil -1 nil)))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (json-key-type 'string)
         (cases (json-read-from-string (buffer-string))) (out nil))
    (dolist (c cases)
      (let* ((now (parse (concat (cdr (assoc "now" c)) ":00")))
             (pf (pcase (cdr (assoc "pf" c)) ("nil" nil) ("t" t) (_ 'time)))
             (ext (cdr (assoc "ext" c)))
             (def (let ((d (cdr (assoc "def" c)))) (and d (parse (concat d ":00")))))
             (endb (eq (cdr (assoc "endb" c)) t))
             (text (cdr (assoc "in" c)))
             (org-read-date-prefer-future pf) (org-extend-today-until ext)
             (org-time-was-given nil) (org-end-time-was-given nil) (res nil) (err nil))
        (cl-letf (((symbol-function 'current-time) (lambda () now))
                  ((symbol-function 'decode-time) (let ((orig (symbol-function 'decode-time))) (lambda (&optional time zone form) (funcall orig (or time now) zone form))))
                  ((symbol-function 'format-time-string) (let ((orig (symbol-function 'format-time-string))) (lambda (format &optional time &rest args) (apply orig format (or time now) args)))))
          (condition-case e
              (setq res (fmt (if endb (org-read-date nil t text nil def) (let ((org-end-time-was-given nil)) (makunbound 'org-end-time-was-given) (org-read-date nil t text nil def)))))
            (error (setq err (error-message-string e)))))
        (push (append c (list (cons "res" res) (cons "given" (if org-time-was-given t :json-false)) (cons "endGiven" (or (and endb org-end-time-was-given) :json-false)) (cons "err" err))) out)))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (nreverse out)))))))
`;

const cases = [];
for (const now of NOWS) for (const pf of ['nil', 't', 'time']) for (const ext of [0, 4]) {
  if (ext === 4 && pf === 'time') continue;
  for (const text of INPUTS) cases.push({ now, pf, ext, in: text, def: null, endb: false });
}
for (const now of NOWS.slice(0, 3)) for (const def of DEFAULTS.slice(1)) for (const text of INPUTS) cases.push({ now, pf: 'nil', ext: 0, in: text, def, endb: false });
for (const now of NOWS.slice(1, 3)) for (const pf of ['nil', 't']) for (const text of INPUTS) cases.push({ now, pf, ext: 0, in: text, def: DEFAULTS[1], endb: true });
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-'));
  fs.writeFileSync(path.join(dir, 'run.el'), el);
  fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
  const out = path.join(dir, 'out.json');
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ: 'UTC', ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: out }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  fs.writeFileSync(new URL('../test/fixtures/read-date-oracle.json', import.meta.url), JSON.stringify(JSON.parse(fs.readFileSync(out, 'utf8'))));
  console.log('wrote', cases.length, 'cases');
}
