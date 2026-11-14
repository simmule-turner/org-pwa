#!/usr/bin/env node
/**
 * Writes test/fixtures/timer-oracle.json: what org-timer.el (Emacs 29.3) gives for the stamps and the shifting of stamps:
 * org-timer-fix-incomplete, org-timer-hms-to-secs, org-timer-secs-to-hms, org-timer-value-string (relative, paused and countdown),
 * org-timer-change-times-in-region and org-at-item-timer-p.
 *   node tools/gen-timer-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cases = [];
for (const s of ['5', '65', '1:05', '1:2:3', '10:00:00', '0:00:00', ' 12 ', 'x', '', '-0:05', '3600', '1:30:00 extra']) cases.push({ fn: 'fix', in: s });
for (const s of ['1:02:05', '-1:02:05', '+0:00:09', '0:00:00', 'at 12:34:56 then', '00:01:00', '5', '1:2:3', '100:00:00']) cases.push({ fn: 'secs', in: s });
for (const n of [0, 5, 59, 60, 61, 3599, 3600, 3725, -5, -3725, 360000]) cases.push({ fn: 'hms', in: n });
for (const [elapsed, countdown] of [[0, false], [5, false], [3725, false], [3725.9, false], [90, true], [90.5, true], [0.4, true], [7200, true]]) cases.push({ fn: 'value', elapsed, countdown });
cases.push({ fn: 'value', elapsed: 65, countdown: false, format: 'Elapsed %s -' });
const text = '0:00:10 start\n0:01:30 middle\n1:00:00 end\n';
for (const d of ['-0:00:10', '0:00:10', '', ' ', '1:00', '-90', '0:00:00', '0', 'x']) cases.push({ fn: 'change', text, delta: d });
cases.push({ fn: 'change', text: '-0:00:05 before\n0:00:05 after\n', delta: '' });
cases.push({ fn: 'change', text: 'no stamps here\n', delta: '' });
cases.push({ fn: 'change', text: '0:00:01 and 9:59:59', delta: '0:00:01' });
for (const l of ['- 0:00:05 :: first', '+ 0:01:00 :: x', '1. 0:00:05 :: numbered', '  - 0:00:05 :: indented', '- 0:00:05:: nospace', '- 0:00:05 ::', '- [ ] 0:00:05 :: box', '- term :: not a stamp', '- plain item', '- -0:00:05 :: negative', '0:00:05 :: no bullet']) cases.push({ fn: 'item', line: l });

const el = `
(require 'org) (require 'org-timer) (require 'json)
(defun my-run (c)
  (let ((fn (alist-get 'fn c)))
    (condition-case err
        (cond
         ((string= fn "fix") (org-timer-fix-incomplete (alist-get 'in c)))
         ((string= fn "secs") (org-timer-hms-to-secs (alist-get 'in c)))
         ((string= fn "hms") (org-timer-secs-to-hms (alist-get 'in c)))
         ((string= fn "value")
          (let* ((org-timer-format (or (alist-get 'format c) "%s "))
                 (e (alist-get 'elapsed c))
                 (org-timer-start-time (seconds-to-time 1000))
                 (org-timer-pause-time (seconds-to-time (+ 1000 e)))
                 (org-timer-countdown-timer (if (eq (alist-get 'countdown c) t) 'paused nil)))
            (org-timer-value-string)))
         ((string= fn "change")
          (with-temp-buffer (insert (alist-get 'text c))
            (org-timer-change-times-in-region (point-min) (point-max) (alist-get 'delta c))
            (buffer-string)))
         ((string= fn "item")
          (with-temp-buffer (org-mode) (insert (alist-get 'line c)) (if (org-at-item-timer-p) "yes" "no"))))
      (error (concat "ERROR " (error-message-string err))))))
(let ((out nil))
  (dolist (c (json-parse-string (with-temp-buffer (insert-file-contents (getenv "CASES")) (buffer-string)) :object-type 'alist :array-type 'list :false-object nil))
    (push (my-run c) out))
  (princ (json-encode (nreverse out))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timer-'));
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
fs.writeFileSync(path.join(dir, 'run.el'), el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, CASES: path.join(dir, 'cases.json') }, encoding: 'utf8', maxBuffer: 1 << 26 });
if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
const results = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
fs.writeFileSync(path.join(import.meta.dirname, '..', 'test', 'fixtures', 'timer-oracle.json'), JSON.stringify(cases.map((c, i) => ({ ...c, expected: results[i] })), null, 1) + '\n');
console.log(`wrote ${cases.length} cases`);
