#!/usr/bin/env node
/**
 * Writes test/fixtures/agenda/a1.expected.json: for each day from "today" on, which headings of a1.org real Emacs puts in the
 * agenda (org-agenda-get-day-entries) and as what: scheduled, deadline or a plain time stamp, and how many days overdue
 * (negative: due in N days; Emacs shows both only on today). test/agenda-oracle.test.js
 * holds buildAgendaItems to it. Today is 2026-10-11 16:30, New York time.
 *
 *   node tools/gen-agenda-oracle.mjs [name]   (name: a1 or b1; needs emacs and faketime (libfaketime) on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TZ = 'America/New_York';
const NOW = '2026-10-11 16:30:00';
const FIRST = [10, 11, 2026]; // month day year, as Emacs calendar functions want
const DAYS = 64;
const NAME = process.argv[2] || 'a1';
const org = path.resolve(`test/fixtures/agenda/${NAME}.org`);
const el = `
(require 'org) (require 'org-agenda) (require 'json)
(setq org-agenda-skip-scheduled-if-done t org-agenda-skip-deadline-if-done t)
(org-agenda-get-day-entries ${JSON.stringify(org)} '(${FIRST[0]} ${FIRST[1]} ${FIRST[2]}) :deadline :scheduled :timestamp) ; the first call in a session skips deadlines, so make it a throwaway
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
    const n = /Sched\.\s*(\d+)x/.exec(e)?.[1] ?? /(\d+) d\. ago/.exec(e)?.[1] ?? (/In\s+(\d+) d\./.exec(e) ? -/In\s+(\d+) d\./.exec(e)[1] : 0);
    return `${txt.replace(/\s*[<[][^>\]]*[>\]](--[<[][^>\]]*[>\]])?/g, '').trim()}|${kind}|${Number(n)}`;
  }).sort();
}
fs.writeFileSync(`test/fixtures/agenda/${NAME}.expected.json`, JSON.stringify({ emacs: '29.3', tz: TZ, now: NOW, days }, null, 1) + '\n');
console.log(`${Object.keys(days).length} days, ${Object.values(days).reduce((n, d) => n + d.length, 0)} entries`);
