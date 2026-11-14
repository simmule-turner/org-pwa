#!/usr/bin/env node
/**
 * Writes test/fixtures/ical-recurrence-oracle.json: for recurrence rules the iCalendar import turns into a `<%%(...)>` expression,
 * the days (2026-01-01 to 2028-03-31) on which Emacs 29.3 finds that expression true (org-cyclic, org-date, org-block
 * and diary-float, evaluated with `date` set to each day).
 *   node tools/gen-ical-recurrence-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importIcalendarAsOrgText } from '../src/import-icalendar.js';

export const RULES = [
  { start: '20261006', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10', ex: ['20261012'] },
  { start: '20261006', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261130' },
  { start: '20261005', rrule: 'FREQ=WEEKLY;BYDAY=MO,TH' },
  { start: '20261005', rrule: 'FREQ=WEEKLY;INTERVAL=2;COUNT=6' },
  { start: '20261005', rrule: 'FREQ=WEEKLY;UNTIL=20261231' },
  { start: '20261013', rrule: 'FREQ=MONTHLY;BYDAY=2TU' },
  { start: '20261013', rrule: 'FREQ=MONTHLY;BYDAY=2TU;COUNT=5' },
  { start: '20261030', rrule: 'FREQ=MONTHLY;BYDAY=-1FR' },
  { start: '20261001', rrule: 'FREQ=MONTHLY;BYDAY=1TH;UNTIL=20270601' },
  { start: '20261015', rrule: 'FREQ=MONTHLY;COUNT=4' },
  { start: '20261015', rrule: 'FREQ=MONTHLY;UNTIL=20270315' },
  { start: '20261015', rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', ex: ['20261115'] },
  { start: '20261001', rrule: 'FREQ=DAILY;COUNT=10' },
  { start: '20261001', rrule: 'FREQ=DAILY;INTERVAL=3;UNTIL=20261101' },
  { start: '20261001', rrule: 'FREQ=DAILY;INTERVAL=2', ex: ['20261003', '20261007'] },
  { start: '20261105', rrule: 'FREQ=YEARLY;COUNT=2' },
  { start: '20261105', rrule: 'FREQ=YEARLY', ex: ['20271105'] },
  { start: '20261105', rrule: 'FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=5;UNTIL=20271231' },
  { start: '20260131', rrule: 'FREQ=MONTHLY;COUNT=3' },
];

/** The expression the import writes for one rule. @param {{ start: string, rrule: string, ex?: string[] }} c */
export function sexpOf(c) {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:X', `DTSTART;VALUE=DATE:${c.start}`, `RRULE:${c.rrule}`, ...(c.ex || []).map((d) => `EXDATE;VALUE=DATE:${d}`), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const m = /<%%(\(.*\))>/.exec(importIcalendarAsOrgText(ics, { zone: 'UTC' }).orgText);
  return m ? m[1] : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cases = RULES.map((c) => ({ ...c, sexp: sexpOf(c) }));
  const el = `
(require 'org) (require 'org-agenda) (require 'diary-lib) (require 'json)
(let ((out nil))
  (dolist (c (json-parse-string (with-temp-buffer (insert-file-contents (getenv "CASES")) (buffer-string)) :object-type 'alist :array-type 'list))
    (let* ((form (read (alist-get 'sexp c))) (days nil)
           (abs (calendar-absolute-from-gregorian '(1 1 2026))) (end (calendar-absolute-from-gregorian '(3 31 2028))))
      (while (<= abs end)
        (let* ((date (calendar-gregorian-from-absolute abs)))
          (when (let ((date date) (entry "")) (eval form))
            (push (format "%04d-%02d-%02d" (nth 2 date) (nth 0 date) (nth 1 date)) days)))
        (setq abs (1+ abs)))
      (push (vconcat (nreverse days)) out)))
  (princ (json-encode (vconcat (nreverse out)))))`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ical-'));
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
  fs.writeFileSync(path.join(dir, 'run.el'), ';;; -*- lexical-binding: nil -*-\n' + el);
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, CASES: path.join(dir, 'cases.json') }, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
  const days = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
  fs.writeFileSync(path.join(import.meta.dirname, '..', 'test', 'fixtures', 'ical-recurrence-oracle.json'), JSON.stringify(cases.map((c, i) => ({ ...c, days: days[i] })), null, 1) + '\n');
  console.log(`wrote ${cases.length} cases`);
}
