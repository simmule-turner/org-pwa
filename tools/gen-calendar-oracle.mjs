#!/usr/bin/env node
/**
 * Writes test/fixtures/calendar-lisp.json: what Emacs 29.3 answers for each case of tools/calendar-cases.mjs.
 *
 *   node tools/gen-calendar-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASES } from './calendar-cases.mjs';

const lispString = (/** @type {string} */ s) => JSON.stringify(s);

const driver = `;; -*- lexical-binding: nil -*-
(require 'calendar) (require 'holidays) (require 'cal-hebrew) (require 'cal-islam) (require 'cal-julian) (require 'cal-bahai)
(defvar my-cases (list ${CASES.map((c) => `(list ${c[0]} ${c[1]} ${lispString(c[2])} ${c[3] === 'list' ? 't' : 'nil'})`).join('\n')}))
(let ((i 0))
  (dolist (c my-cases)
    (let ((status "ok") (value ""))
      (condition-case err
          (let ((displayed-month (nth 0 c)) (displayed-year (nth 1 c)))
            (setq value
                  (prin1-to-string
                   (if (nth 3 c)
                       (let ((calendar-holidays (eval (car (read-from-string (nth 2 c))) nil)))
                         (calendar-holiday-list))
                     (eval (car (read-from-string (nth 2 c))) nil)))))
        (error (setq status "error" value (error-message-string err))))
      (princ (format "%c%d%c%s%c%s%c" 2 i 1 status 1 value 3)))
    (setq i (1+ i))))
`;
const file = path.join(os.tmpdir(), `calendar-oracle-${process.pid}.el`);
fs.writeFileSync(file, driver);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1e9, env: { ...process.env, LC_ALL: 'C.UTF-8' }, timeout: 300000 });
fs.unlinkSync(file);
if (r.status !== 0) throw new Error(r.stderr);
const results = [];
for (const rec of r.stdout.split('\x03')) {
  if (!rec.includes('\x02')) continue;
  const [idx, status, value] = rec.slice(rec.indexOf('\x02') + 1).split('\x01');
  const c = CASES[Number(idx)];
  results[Number(idx)] = { month: c[0], year: c[1], src: c[2], list: c[3] === 'list', status, value };
}
if (results.length !== CASES.length || results.some((x) => !x)) throw new Error(`got ${results.filter(Boolean).length} of ${CASES.length} results\n${r.stderr.slice(0, 500)}`);
fs.writeFileSync('test/fixtures/calendar-lisp.json', JSON.stringify(results).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${results.length} cases (${results.filter((x) => x.status === 'error').length} errors)`);
