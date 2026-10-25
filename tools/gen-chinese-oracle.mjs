#!/usr/bin/env node
/**
 * Writes test/fixtures/chinese.json: what Emacs 29.3's cal-china.el computes: the structure of each Chinese year 1850-2150
 * (`calendar-chinese-compute-year`) and `calendar-chinese-date-string` for a day every 101 days of the same span, plus every
 * day of 2026-2027.
 *
 *   node tools/gen-chinese-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const lisp = `(progn (require 'cal-china)
  (let ((y 1850)) (while (<= y 2150) (princ (format "Y|%d|%S\\n" y (calendar-chinese-compute-year y))) (setq y (1+ y))))
  (let* ((abs (calendar-absolute-from-gregorian '(1 1 1850))) (end (calendar-absolute-from-gregorian '(12 31 2150))))
    (while (<= abs end)
      (let ((g (calendar-gregorian-from-absolute abs)))
        (princ (format "D|%d-%d-%d|%s\\n" (nth 2 g) (nth 0 g) (nth 1 g) (calendar-chinese-date-string g))))
      (setq abs (+ abs (if (and (>= abs 739617) (< abs 740348)) 1 101))))))`;
const r = spawnSync('emacs', ['--batch', '-Q', '--eval', lisp], { encoding: 'utf8', maxBuffer: 1e9 });
if (r.status !== 0) throw new Error(r.stderr);
const years = {};
const days = {};
for (const line of r.stdout.split('\n')) {
  const [kind, key, value] = line.split('|');
  if (kind === 'Y') years[key] = value;
  else if (kind === 'D') days[key] = value;
}
fs.writeFileSync('test/fixtures/chinese.json', JSON.stringify({ years, days }) + '\n');
console.log(`${Object.keys(years).length} years, ${Object.keys(days).length} days`);
