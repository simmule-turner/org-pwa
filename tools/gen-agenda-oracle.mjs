#!/usr/bin/env node
/**
 * Writes test/fixtures/agenda/a1.expected.json: for each day after "today", which headings of a1.org real Emacs puts in the
 * agenda (org-agenda-get-day-entries) and as what (scheduled, deadline or a plain time stamp). test/agenda-oracle.test.js
 * holds buildAgendaItems to it. Today is 2026-10-11 16:30, New York time.
 *
 *   node tools/gen-agenda-oracle.mjs        (needs emacs and faketime (libfaketime) on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TZ = 'America/New_York';
const NOW = '2026-10-11 16:30:00';
const FIRST = [10, 12, 2026]; // month day year, as Emacs calendar functions want
const DAYS = 63;
const org = path.resolve('test/fixtures/agenda/a1.org');
const el = `
(require 'org) (require 'org-agenda) (require 'json)
(setq org-agenda-skip-scheduled-if-done t org-agenda-skip-deadline-if-done t)
(let ((out '()) (abs (calendar-absolute-from-gregorian '(${FIRST[0]} ${FIRST[1]} ${FIRST[2]}))))
  (dotimes (i ${DAYS})
    (let* ((g (calendar-gregorian-from-absolute (+ abs i)))
           (date (list (nth 0 g) (nth 1 g) (nth 2 g)))
           (rows '()))
      (dolist (e (org-agenda-get-day-entries ${JSON.stringify(org)} date :deadline :scheduled :timestamp))
        (let ((extra (or (get-text-property 0 'extra e) "")) (txt (get-text-property 0 'txt e)))
          (push (cons txt extra) rows)))
      (push (vector (format "%04d-%02d-%02d" (nth 2 date) (nth 0 date) (nth 1 date))
                    (vconcat (mapcar (lambda (r) (vector (car r) (cdr r))) (nreverse rows)))) out)))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-oracle-'));
const elFile = path.join(dir, 'run.el');
const outFile = path.join(dir, 'out.json');
fs.writeFileSync(elFile, el);
const r = spawnSync('faketime', ['-f', `@${NOW}`, 'emacs', '--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ, ORACLE_OUT: outFile }, encoding: 'utf8', input: '' });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const days = {};
for (const [date, rows] of JSON.parse(fs.readFileSync(outFile, 'utf8'))) {
  days[date] = rows.map(([txt, extra]) => {
    const e = extra.trim();
    const kind = /^(Deadline|In|\d+ d\. ago)/.test(e) ? 'deadline' : /^Sched/.test(e) ? 'scheduled' : 'timestamp';
    return `${txt.replace(/\s*[<[][^>\]]*[>\]](--[<[][^>\]]*[>\]])?/g, '').trim()}|${kind}`;
  }).sort();
}
fs.writeFileSync('test/fixtures/agenda/a1.expected.json', JSON.stringify({ emacs: '29.3', tz: TZ, now: NOW, days }, null, 1) + '\n');
console.log(`${Object.keys(days).length} days, ${Object.values(days).reduce((n, d) => n + d.length, 0)} entries`);
