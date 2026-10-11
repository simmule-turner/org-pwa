#!/usr/bin/env node
/**
 * Writes test/fixtures/repeat-oracle.json: what real Emacs (org-todo to DONE) does to a repeating SCHEDULED or DEADLINE
 * timestamp, for a grid of repeaters, dates and completion moments. test/repeat-oracle.test.js holds src/repeater-shift.js to it.
 *
 *   node tools/gen-repeat-oracle.mjs        (needs emacs and faketime (libfaketime) on the PATH; the clock is New York time)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TZ = 'America/New_York';
process.env.TZ = TZ; // for the offset check below
const nows = ['2026-10-11 16:30:00', '2026-10-11 23:50:00', '2026-03-08 12:00:00', '2026-11-01 08:15:00', '2024-02-29 09:00:00'];
const olds = [
  ['2026-10-01', 'Thu'], ['2026-10-11', 'Sun'], ['2026-10-20', 'Tue'], ['2026-01-31', 'Sat'], ['2026-03-31', 'Tue'],
  ['2024-02-29', 'Thu'], ['2025-12-31', 'Wed'], ['2026-03-07', 'Sat'], ['2026-10-31', 'Sat'],
];
const times = [null, '09:00', '23:30'];
const reps = [];
for (const mark of ['+', '++', '.+']) for (const unit of ['d', 'w', 'm', 'y']) for (const n of [1, 2, 3]) reps.push(`${mark}${n}${unit}`);
for (const mark of ['+', '++', '.+']) for (const n of [6, 30]) reps.push(`${mark}${n}h`);

const cases = [];
for (const [i, [date, dow]] of olds.entries()) {
  for (const [j, time] of times.entries()) {
    for (const [k, rep] of reps.entries()) {
      // a thinned grid: every old date meets every repeater, with the times and completion moments rotated through
      const now = nows[(i + j + k) % nows.length];
      if ((j === 1 || j === 2) && rep.endsWith('h') === false && k % 3 !== 0) continue;
      if (rep.endsWith('h') && !time) continue; // Emacs refuses an hour repeater on a date without a time
      // Emacs's `.+Nh` is an hour out when the completion and the timestamp's date are on different sides of a clock change
      // (it mixes the two zone offsets); that is its slip, not a rule, so those cases are left out.
      if (rep.startsWith('.+') && rep.endsWith('h') && new Date(date + 'T12:00:00').getTimezoneOffset() !== new Date(now.replace(' ', 'T')).getTimezoneOffset()) continue;
      const hasWarn = (i + k) % 5 === 0;
      const kind = (i + j + k) % 2 ? 'DEADLINE' : 'SCHEDULED';
      const ts = `<${date} ${dow}${time ? ' ' + time : ''} ${rep}${hasWarn && kind === 'DEADLINE' ? ' -2d' : ''}>`;
      cases.push({ kind, ts, now });
    }
  }
}

const el = `
(require 'org) (require 'cl-lib) (require 'json)
(setq org-log-repeat nil org-log-done nil org-todo-keywords '((sequence "TODO" "|" "DONE")))
(defun run-case (ts kind)
  (cl-letf (((symbol-function 'y-or-n-p) (lambda (&rest _) t)))
    (with-temp-buffer
      (org-mode)
      (insert "* TODO t\n" kind ": " ts "\n")
      (goto-char (point-min))
      (let ((inhibit-message t) (message-log-max nil)) (org-todo 'done))
      (forward-line 1)
      (buffer-substring (line-beginning-position) (line-end-position)))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (push (run-case (cdr (assq 'ts c)) (cdr (assq 'kind c))) out))
    (with-temp-file (getenv "ORACLE_OUT")
      (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repeat-oracle-'));
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);
const expectedFor = new Map();
for (const now of nows) {
  const group = cases.filter((c) => c.now === now);
  const inFile = path.join(dir, 'in.json');
  const outFile = path.join(dir, 'out.json');
  fs.writeFileSync(inFile, JSON.stringify(group));
  // libfaketime makes the whole Emacs process believe it is `now` (New York time)
  const r = spawnSync('faketime', ['-f', `@${now}`, 'emacs', '--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ, ORACLE_IN: inFile, ORACLE_OUT: outFile }, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr || r.error);
    process.exit(1);
  }
  const results = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  group.forEach((c, i) => expectedFor.set(c, results[i]));
}
const out = cases.map((c) => ({ ...c, expected: expectedFor.get(c) }));
fs.writeFileSync('test/fixtures/repeat-oracle.json', JSON.stringify({ emacs: '29.3', tz: TZ, cases: out }, null, 1) + '\n');
console.log(`${out.length} cases written`);
