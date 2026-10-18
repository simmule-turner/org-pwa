#!/usr/bin/env node
/**
 * Writes test/fixtures/prefix/expected.json: the prefix Emacs's org-agenda-format-item builds for each
 * [format, category, time, scheduling label, effort] in cases.json.
 *
 *   node tools/gen-prefix-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cases = JSON.parse(fs.readFileSync('test/fixtures/prefix/cases.json', 'utf8'));
const el = `
(require 'org-agenda) (require 'json)
(setq org-agenda-current-span 'day org-agenda-tags-column 0)
(defun try (fmt cat time extra eff)
  (let ((org-agenda-prefix-format (list (cons 'agenda fmt))) (org-prefix-format-compiled nil)
        (org-agenda-remove-times-when-in-prefix nil) (org-agenda-use-time-grid nil))
    (with-temp-buffer
      (org-mode) (insert "* TODO x\\n") (goto-char (point-min))
      (org-compile-prefix-format 'agenda)
      (let* ((m (point-marker))
             (txt (propertize (if time "10:00 TITLE" "TITLE") 'org-marker m 'org-hd-marker m 'time-of-day (and time 1000) 'effort eff))
             (s (substring-no-properties (org-agenda-format-item extra txt "" cat nil (and time t)))))
        (let ((suffix (if time "10:00 TITLE" "TITLE"))) (if (string-suffix-p suffix s) (substring s 0 (- (length s) (length suffix))) s))))))
(let ((cases (json-parse-string (getenv "CASES") :array-type 'list :null-object nil)) (out '()))
  (dolist (c cases) (push (apply #'try c) out))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-oracle-'));
const elFile = path.join(dir, 'run.el');
const outFile = path.join(dir, 'out.json');
fs.writeFileSync(elFile, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, CASES: JSON.stringify(cases), ORACLE_OUT: outFile }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr || r.error); process.exit(1); }
const expected = JSON.parse(fs.readFileSync(outFile, 'utf8'));
fs.writeFileSync('test/fixtures/prefix/expected.json', JSON.stringify({ emacs: '29.3', expected }, null, 1) + '\n');
console.log(expected.length + ' prefixes');
