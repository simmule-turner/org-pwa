#!/usr/bin/env node
/**
 * Writes test/fixtures/timestamp-edit-oracle.json: what Emacs 29.3 (Org 9.6) does for org-timestamp-change (with the point in every part of a
 * time stamp), org-clock-timestamps-change, org-time-stamp and org-time-stamp-inactive (with the prefixes, over a time stamp, and as a
 * range) and org-clone-subtree-with-time-shift. A buffer is given with `<point>` where the point is; the answer is the text and the point.
 * Run in UTC, so that no daylight saving gap is in the way. test/timestamp-edit-oracle.test.js holds src/timestamp-edit.js to it.
 *   node tools/gen-timestamp-edit-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INPUTS } from './gen-read-date-oracle.mjs';

const el = String.raw`;;; -*- lexical-binding: t -*-
(require 'org) (require 'org-clock) (require 'org-id) (require 'json) (require 'cl-lib)
(setq org-id-track-globally nil)
(defvar org-time-was-given) (defvar org-end-time-was-given)
(defun parse (s) (apply #'encode-time (list (string-to-number (substring s 17 19)) (string-to-number (substring s 14 16)) (string-to-number (substring s 11 13)) (string-to-number (substring s 8 10)) (string-to-number (substring s 5 7)) (string-to-number (substring s 0 4)) nil -1 nil)))
(defun norm (s) (replace-regexp-in-string "[0-9a-f]\\{8\\}-[0-9a-f]\\{4\\}-[0-9a-f]\\{4\\}-[0-9a-f]\\{4\\}-[0-9a-f]\\{12\\}" "<ID>" s))
(defun setup (text)
  (setq buffer-file-name "/tmp/clone-test.org") (insert text) (goto-char (point-min))
  (let ((p (when (search-forward "<point>" nil t) (delete-region (match-beginning 0) (match-end 0)) (point)))) (org-mode) (when p (goto-char p))))
(defun prefix-of (k) (pcase k ("single" '(4)) ("double" '(16)) ("number" 3) (_ nil)))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (json-key-type 'string)
         (cases (json-read-from-string (buffer-string))) (out nil))
    (dolist (c cases)
      (let* ((kind (cdr (assoc "kind" c))) (res nil) (err nil) (pt nil)
             (now (parse (concat (or (cdr (assoc "now" c)) "2026-11-14 10:08") ":00"))))
        (cl-letf (((symbol-function 'current-time) (lambda () now))
                  ((symbol-function 'decode-time) (let ((orig (symbol-function 'decode-time))) (lambda (&optional time zone form) (funcall orig (or time now) zone form))))
                  ((symbol-function 'format-time-string) (let ((orig (symbol-function 'format-time-string))) (lambda (format &optional time &rest args) (apply orig format (or time now) args)))))
          (with-temp-buffer
            (condition-case e
                (progn
                  (setup (cdr (assoc "text" c)))
                  (pcase kind
                    ("change"
                     (let ((current-prefix-arg (and (eq (cdr (assoc "prefix" c)) t) '(4))))
                       (org-timestamp-change (cdr (assoc "n" c)) (let ((w (cdr (assoc "what" c)))) (and w (intern w))) (and (eq (cdr (assoc "updown" c)) t) 'updown))))
                    ("clock"
                     (org-clock-timestamps-change (intern (cdr (assoc "updown" c))) (cdr (assoc "n" c))))
                    ("stamp"
                     (let* ((org-read-date-popup-calendar nil) (typed (cdr (assoc "typed" c)))
                            (last-command (and (eq (cdr (assoc "after" c)) t) 'org-time-stamp))
                            (this-command 'org-time-stamp))
                       (cl-letf (((symbol-function 'read-string) (lambda (&rest _) typed)))
                         (org-time-stamp (prefix-of (cdr (assoc "arg" c))) (and (eq (cdr (assoc "inactive" c)) t) t)))))
                    ("clone"
                     (let ((org-clone-delete-id (eq (cdr (assoc "deleteId" c)) t)))
                       (org-clone-subtree-with-time-shift (cdr (assoc "n" c)) (cdr (assoc "shift" c)))))))
              (error (setq err (error-message-string e))))
            (setq res (norm (buffer-substring-no-properties (point-min) (point-max))) pt (1- (point)))))
        (push (append c (list (cons "res" res) (cons "pt" pt) (cons "err" err))) out)))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (nreverse out)))))))
`;

const cases = [];
const STAMPS = ['<2026-11-14 Sat>', '<2026-11-14 Sat 10:23>', '[2026-11-14 Sat 10:23]', '<2026-11-14 Sat 10:00-11:30>', '<2026-11-14 Sat 10:00-11:30 +1w -2d>', '<2026-12-31 Thu 23:58 +1w>',
  '<2026-11-14 Sat .+2d/5d -3d>', '<2026-11-14 Sat ++1m --2d>', '<2026-03-31 Tue>', '<2024-02-29 Thu 00:02>', '<2026-11-14>', '<2026-11-14 Sat +1y>', '<2026-11-14 Sat 08:15 -1w>'];
for (const st of STAMPS) {
  const head = 'SCHEDULED: ';
  for (let k = 0; k <= st.length; k++) {
    const text = head + st.slice(0, k) + '<point>' + st.slice(k) + ' end';
    for (const n of [1, -1]) for (const updown of [false, true]) cases.push({ kind: 'change', text, n, what: null, updown });
    if (k % 3 === 0) cases.push({ kind: 'change', text, n: 3, what: null, updown: true, prefix: true });
  }
  for (const what of ['day', 'month', 'year', 'hour', 'minute']) for (const n of [1, -2, 26]) cases.push({ kind: 'change', text: head + '<2026-11-14 Sat 10:00-11:30 +1w -2d><point>', n, what, updown: false }, { kind: 'change', text: head + st.slice(0, 5) + '<point>' + st.slice(5), n, what, updown: true });
}
cases.push({ kind: 'change', text: 'no stamp<point> here', n: 1, what: null, updown: true });
cases.push({ kind: 'change', text: '<2026-11-14 Sat>--<2026-11-16 Mon><point>', n: 1, what: null, updown: false });
cases.push({ kind: 'change', text: '<2026-11-14 Sat><2026-11-1<point>6 Mon>', n: 1, what: null, updown: false });
const CLOCKS = ['CLOCK: [2023-02-19 Sun 22:30]--[2023-02-20 Mon 00:35] =>  2:05', 'CLOCK: [2023-02-19 Sun 23:55]--[2023-02-20 Mon 00:35] =>  0:40', 'CLOCK: [2023-02-19 Sun 23:30]--[2023-02-20 Mon 00:35] =>  1:05',
  '  CLOCK: [2026-11-14 Sat 10:00]--[2026-11-14 Sat 12:17] =>  2:17', 'CLOCK: [2026-11-14 Sat 10:00]', 'CLOCK: [2026-11-14 Sat 10:00]--[2026-11-14 Sat 09:00] =>  0:00'];
for (const line of CLOCKS) for (let k = 0; k <= line.length; k += 1) {
  const text = line.slice(0, k) + '<point>' + line.slice(k);
  for (const updown of ['up', 'down']) { cases.push({ kind: 'clock', text, updown, n: 1 }); if (k % 7 === 0) cases.push({ kind: 'clock', text, updown, n: null }); }
}
const STAMP_TEXTS = ['Te<point>xt', '<2012-03-29 Thu><point>', '<2012-03-29<point> thu.>', '<2012-03-29<point> thu.>--<2014-03-04 tue.>', '<2012-03-29<point> thu. +2y>', '<2012-03-29 Thu 10:15 +1w -2d><point>', '<2012-03-29 Thu>--<2014-03-04 Tue><point>', '[2012-03-29 Thu 9:30]<point>', '<2012-03-29 Thu>-<point>-<2014-03-04 Tue>', '<2012-03-29 Thu 10:00-11:00<point>>', 'a <2012-03-29 Thu> b <point>c'];
const TYPED = ['', '2014-03-04', '+1d', '12:30', '9:30-10:30', 'fri 9am', '+1w', 'dec 25 2027', '8:00+1:30', '25.12.', '2027-W10', '+2h', 'jan 5 7pm-9pm', '+1d 14:15', 'tomorrow'];
const NOWS = ['2026-11-14 10:08', '2026-12-31 23:50'];
for (const text of STAMP_TEXTS) for (const typed of TYPED) for (const arg of [null, 'single', 'number']) for (const inactive of [false, true]) for (const now of NOWS.slice(0, 1)) cases.push({ kind: 'stamp', text, typed, arg, inactive, after: false, now });
for (const text of STAMP_TEXTS.slice(0, 7)) for (const typed of TYPED.slice(0, 6)) cases.push({ kind: 'stamp', text, typed, arg: null, inactive: false, after: true, now: NOWS[0] });
for (const text of STAMP_TEXTS) for (const inactive of [false, true]) for (const now of NOWS) cases.push({ kind: 'stamp', text, typed: 'ignored', arg: 'double', inactive, after: false, now });
for (const typed of INPUTS) for (const now of NOWS) cases.push({ kind: 'stamp', text: 'x<point>y', typed, arg: null, inactive: false, after: false, now });
const CLONES = [
  ['* H1\n<2015-06-21 Sun>', 1, '+2d'], ['* H1\n<2015-06-21 Sun +1w>', 1, '+2d'], ['* H1\n<2015-06-21 Sun +1w>', 1, '-2d'], ['* H1\n<2015-06-21 Sun>', 0, '+2d'], ['* H1\n<2015-06-21 Sun +1w>', 0, '+2d'],
  ['* H <2012-03-29 Thu>', 1, ''], ['* H <2012-03-29 Thu>', 1, '+1d'], ['* H1\n<2015-06-21 Sun 20:00>', 2, '+3h'], ['* H1\n<2015-06-21 Sun 20:00>', 1, '-2h'], ['* H1\n<2015-06-21 Sun>', 3, '+1w'],
  ['* H1\n<2015-06-21 Sun>', 3, '+1m'], ['* H1\n<2015-01-31 Sat>', 3, '+1m'], ['* H1\n<2015-06-21 Sun>', 2, '+1y'], ['* H1\n<2015-06-21 Sun>', 2, ' +2d '], ['* H1\n<2015-06-21 Sun>', 2, 'x'], ['* H1\n<2015-06-21 Sun>', 2, '2'],
  ['* H1\n<2015-06-21 Sun .+1w>', 2, '+1d'], ['* H1\n<2015-06-21 Sun ++1w -2d>', 2, '+1d'], ['* H1\n<2015-06-21 Sun +1w>--<2015-06-23 Tue +1w>', 1, '+1d'], ['* H1\n[2015-06-21 Sun +1w]', 1, '+1d'],
  ['* H1\nSCHEDULED: <2015-06-21 Sun +1w> DEADLINE: <2015-06-25 Thu -2d>', 2, '+1w'], ['* H1\nSCHEDULED: <2015-06-21 Sun> DEADLINE: [2015-06-25 Thu]', 2, '+1w'],
  ['* H1\n:LOGBOOK:\nCLOCK: [2015-06-21 Sun 10:00]--[2015-06-21 Sun 11:00] =>  1:00\n:END:\n<2015-06-21 Sun>', 2, '+1d'],
  ['* H1\n:LOGBOOK:\nCLOCK: [2015-06-21 Sun 10:00]--[2015-06-21 Sun 11:00] =>  1:00\n- Note taken on [2015-06-21 Sun 11:00] \\\\\n  text\n:END:\n<2015-06-21 Sun>', 2, '+1d'],
  ['* H1\nCLOCK: [2015-06-21 Sun 10:00]--[2015-06-21 Sun 11:00] =>  1:00\n<2015-06-21 Sun>', 1, '+1d'],
  ['* H1\n:PROPERTIES:\n:ID: 11111111-2222-3333-4444-555555555555\n:END:\n<2015-06-21 Sun>', 2, '+1d'], ['* H1\n:PROPERTIES:\n:ID: 11111111-2222-3333-4444-555555555555\n:END:\n<2015-06-21 Sun>', 2, '+1d', true],
  ['* H1\n:PROPERTIES:\n:ID: 11111111-2222-3333-4444-555555555555\n:END:', 2, ''], ['* H1\n:PROPERTIES:\n:ID: 11111111-2222-3333-4444-555555555555\n:END:', 1, '', true],
  ['* H1\n:PROPERTIES:\n:FOO: bar\n:ID: 11111111-2222-3333-4444-555555555555\n:END:\ntext', 1, ''], ['* H1\n:PROPERTIES:\n:ID: 11111111-2222-3333-4444-555555555555\n:FOO: bar\n:END:\ntext <2015-06-21 Sun>', 1, '+1d'],
  ['* H1\n<2015-06-21 Sun>\n** Child <2015-06-22 Mon +1w>\ntext', 2, '+1d'], ['* H1\n<2015-06-21 Sun>\n** Child\n:PROPERTIES:\n:ID: 11111111-2222-3333-4444-555555555555\n:END:', 2, '+1d'],
  ['* TODO H1 [#A] :tag:\nSCHEDULED: <2015-06-21 Sun 10:00-11:00 +1w>\n:PROPERTIES:\n:FOO: x\n:END:\nbody', 2, '+3d'], ['* H1\n<2015-06-21 Sun 10:00 +2h>', 2, '+1d'],
  ['* H1\n:LOGBOOK:\n:END:\n<2015-06-21 Sun>', 2, '+1d'], ['* H1\n:PROPERTIES:\n:END:\n<2015-06-21 Sun>', 2, '+1d'], ['* H1\n<2015-06-21>', 2, '+1d'], ['* H1\n<2015-06-21 Sun> and <2015-07-01 Wed>', 2, '+10d'],
  ['* H1\n<2015-06-21 Sun +1w> and <2015-07-01 Wed>', 2, '+10d'], ['* H1\n<2015-06-21 Sun +1w +2d>', 2, '+1d'], ['* H1\n<2015-06-21 Sun -2d +1w>', 1, '+1d'], ['* H1\n<2015-06-21 Sun +1w>', 1, '+0d'], ['** H2\n<2015-06-21 Sun>', 1, '+1d'],
];
for (const [text, n, shift, deleteId] of CLONES) cases.push({ kind: 'clone', text: text + '<point>', n, shift, deleteId: !!deleteId }, { kind: 'clone', text: '<point>' + text, n, shift, deleteId: !!deleteId });
cases.push({ kind: 'clone', text: '<point>', n: 1, shift: '' }, { kind: 'clone', text: '* Clone me<point>', n: -1, shift: '' });

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tse-'));
  fs.writeFileSync(path.join(dir, 'run.el'), el);
  fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
  const out = path.join(dir, 'out.json');
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ: 'UTC', ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: out }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  fs.writeFileSync(new URL('../test/fixtures/timestamp-edit-oracle.json', import.meta.url), JSON.stringify(JSON.parse(fs.readFileSync(out, 'utf8'))));
  console.log('wrote', cases.length, 'cases');
}
