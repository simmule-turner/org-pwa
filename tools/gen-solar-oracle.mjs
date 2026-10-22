#!/usr/bin/env node
/**
 * Writes test/fixtures/calendar/solar.json: Emacs 29.3's (solar-sunrise-sunset DATE) for five places and a spread of days in several years, in
 * standard time (no daylight saving). test/solar-emacs.test.js compares src/solar-emacs.js with it.
 *
 *   node tools/gen-solar-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLACES = [
  { name: 'Durham', lat: 35.994, lon: -78.8986, zone: -300 },
  { name: 'Sydney', lat: -33.87, lon: 151.21, zone: 600 },
  { name: 'Tromso', lat: 69.65, lon: 18.96, zone: 60 },
  { name: 'Honolulu', lat: 21.31, lon: -157.86, zone: -600 },
  { name: 'Wellington', lat: -41.29, lon: 174.78, zone: 720 },
];
const YEARS = [1950, 1999, 2026, 2027, 2060];
const el = `
(require 'solar) (require 'json) (defvar date)
(setq calendar-daylight-savings-starts nil calendar-daylight-savings-ends nil)
(let ((places (json-parse-string (getenv "PLACES") :array-type 'list :object-type 'alist)) (years (json-parse-string (getenv "YEARS") :array-type 'list)) (out '()))
  (dolist (p places)
    (setq calendar-latitude (alist-get 'lat p) calendar-longitude (alist-get 'lon p) calendar-time-zone (alist-get 'zone p)
          calendar-standard-time-zone-name "STD" calendar-daylight-time-zone-name "STD" calendar-daylight-time-offset 0)
    (dolist (y years)
      (let ((abs (calendar-absolute-from-gregorian (list 1 1 y))) (end (calendar-absolute-from-gregorian (list 12 31 y))))
        (while (<= abs end)
          (let* ((g (calendar-gregorian-from-absolute abs)) (r (solar-sunrise-sunset g)))
            (push (list (alist-get 'name p) (nth 2 g) (nth 0 g) (nth 1 g) (and (car r) (car (cdr (car r))) (car (car r))) (and (cadr r) (car (cadr r))) (nth 2 r)) out))
          (setq abs (+ abs 3))))))
  (princ (json-serialize (vconcat (mapcar (lambda (x) (vconcat (mapcar (lambda (v) (or v :null)) x))) (nreverse out)))))
)`;
const file = path.join(os.tmpdir(), 'gen-solar.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['-Q', '--batch', '-l', file], { encoding: 'utf8', env: { ...process.env, PLACES: JSON.stringify(PLACES), YEARS: JSON.stringify(YEARS) }, maxBuffer: 1 << 28 });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const rows = JSON.parse(r.stdout);
fs.writeFileSync(new URL('../test/fixtures/calendar/solar.json', import.meta.url), JSON.stringify({ places: PLACES, rows }));
console.log(rows.length, 'rows');
