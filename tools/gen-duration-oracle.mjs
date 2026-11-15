#!/usr/bin/env node
/**
 * Writes test/fixtures/duration-format-oracle.json: what Emacs 29.3 answers for `org-duration-from-minutes` under many values of
 * org-duration-format (and two of org-duration-units), with an explicit format and with the canonical units, errors included.
 * test/duration-format-oracle.test.js holds src/org-duration.js to it.
 *   node tools/gen-duration-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FORMATS = ["h:mm", "h:mm:ss", '(("d" . nil) (special . h:mm))', '(("h") ("min"))', '(("h" . t) ("min" . t))', '(("d" . nil) ("h" . t) ("min" . t))', '(("d" . nil) ("min" . nil))',
  '(("d" . nil) ("h" . nil) (special . 2))', '(("d") ("h") (special . 0))', '(("h") (special . 3))', '(("min") (special . 1))', '(("d") ("h") ("min") compact)', '(("d" . t) ("h" . t) ("min" . t) compact)',
  '(("w") ("d") ("h") ("min"))', '(("y") ("m") ("w") ("d") ("h") ("min"))', '(("h") (special . h:mm))', '(("d") ("h") (special . h:mm) compact)', '(("d") (special . h:mm:ss))', '(("w") ("d") (special . h:mm:ss) compact)',
  '(("min" . t))', '(("h" . t))', '(("d" . t) (special . h:mm))', '(("w") (special . h:mm))', '(special . h:mm)', '(special . 2)', '(("d" "x") ("h"))', '(compact)', '(("h") compact)', '(("x") ("h"))', 'nil', '(("d") (special . x))', '(("h") (special . -1))', '(("min") (special . 1.5))',
  '(("h") (special . h:mm) (special . 2))', '(("h") (special . 2) (special . h:mm))', '(("min") ("h") ("d"))', '(("s"))', '(("d") foo)', '(("y") (special . 2))', '(("m") ("y") (special . 4))'];
export const MINUTES = [0, 1, 5, 30, 59, 60, 61, 90, 119.99, 120, 599, 600, 1439, 1440, 1441, 1500, 2880, 2881, 4000, 10080, 10081, 20161, 43200, 43201, 100000, 525960, 525961, 1000000, 59.5, 61.5, 0.5, 0.25, 3599.9, 12345.678, 1.5, -1, -61, -1500, 2.5, 90.125];
export const UNITS = [null, '(("min" . 1) ("h" . 60) ("d" . 480) ("w" . 2400) ("m" . 9600) ("y" . 115200))'];

const el = String.raw`;;; -*- lexical-binding: t -*-
(require 'org) (require 'org-duration) (require 'json)
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (json-key-type 'string)
         (cases (json-read-from-string (buffer-string))) (out nil))
    (dolist (c cases)
      (let* ((org-duration-units (let ((u (cdr (assoc "units" c)))) (if u (car (read-from-string u)) org-duration-units)))
             (org-duration-format (car (read-from-string (cdr (assoc "fmt" c)))))
             (canonical (eq (cdr (assoc "canonical" c)) t))
             (explicit (eq (cdr (assoc "explicit" c)) t))
             (m (cdr (assoc "m" c))) (res nil) (err nil))
        (org-duration-set-regexps)
        (condition-case e (setq res (if explicit (org-duration-from-minutes m org-duration-format canonical) (org-duration-from-minutes m nil canonical)))
          (error (setq err (error-message-string e))))
        (push (append c (list (cons "res" res) (cons "err" err))) out)))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (nreverse out)))))))
`;
const cases = [];
for (const fmt of FORMATS) for (const m of MINUTES) cases.push({ fmt, m, units: null, canonical: false, explicit: false });
for (const fmt of FORMATS.slice(0, 20)) for (const m of MINUTES.slice(0, 30)) cases.push({ fmt, m, units: UNITS[1], canonical: false, explicit: false }, { fmt, m, units: UNITS[1], canonical: true, explicit: false });
for (const fmt of FORMATS.slice(0, 12)) for (const m of MINUTES.slice(0, 20)) cases.push({ fmt, m, units: null, canonical: false, explicit: true });
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dur-'));
  fs.writeFileSync(path.join(dir, 'run.el'), el);
  fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
  const out = path.join(dir, 'out.json');
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: out }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  fs.writeFileSync(new URL('../test/fixtures/duration-format-oracle.json', import.meta.url), JSON.stringify(JSON.parse(fs.readFileSync(out, 'utf8'))));
  console.log('wrote', cases.length, 'cases');
}
