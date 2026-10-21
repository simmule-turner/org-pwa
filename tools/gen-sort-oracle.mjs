#!/usr/bin/env node
/**
 * Writes test/fixtures/sort/expected.json: the order of one day's agenda rows that Emacs gives for each org-agenda-sorting-strategy
 * (agenda entry) in test/fixtures/sort/cases.json, over s1.org and s2.org.
 *
 *   node tools/gen-sort-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cases = JSON.parse(fs.readFileSync('test/fixtures/sort/cases.json', 'utf8'));
const files = ['s1.org', 's2.org'].map((f) => path.resolve('test/fixtures/sort', f));
const el = `
(require 'org-agenda) (require 'json)
(setq org-agenda-files (split-string (getenv "FILES") ":") org-agenda-use-time-grid nil org-agenda-span 'day
      org-agenda-tags-column 0 org-agenda-window-setup 'current-window org-agenda-sticky nil)
(org-agenda-list nil "2027-03-15" 'day) (kill-buffer (current-buffer)) ; the first run of a session leaves the deadlines out
(let ((cases (json-parse-string (getenv "CASES") :array-type 'list)) (out '())
      (names '("Alpha" "Bravo" "Charlie" "Delta" "Echo" "Foxtrot" "Golf" "Hotel")))
  (dolist (keys cases)
    (setq org-agenda-sorting-strategy (list (cons 'agenda (mapcar #'intern keys))))
    (org-agenda-list nil "2027-03-15" 'day)
    (let (rows)
      (dolist (line (split-string (buffer-string) "\\n"))
        (let ((hit (seq-find (lambda (n) (string-match-p n line)) names)))
          (when hit (push hit rows))))
      (push (nreverse rows) out))
    (kill-buffer (current-buffer)))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (mapcar #'vconcat (nreverse out)))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sort-oracle-'));
const elFile = path.join(dir, 'run.el');
const outFile = path.join(dir, 'out.json');
fs.writeFileSync(elFile, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ: 'America/New_York', FILES: files.join(':'), CASES: JSON.stringify(cases), ORACLE_OUT: outFile }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr || r.error); process.exit(1); }
const expected = JSON.parse(fs.readFileSync(outFile, 'utf8'));
fs.writeFileSync('test/fixtures/sort/expected.json', JSON.stringify({ emacs: '29.3', expected }, null, 1) + '\n');
console.log(expected.length + ' orders');
