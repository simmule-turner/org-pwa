#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-import.json: the diary text Emacs 29.3's `icalendar-import-buffer` makes of each calendar of
 * tools/oracle-import-cases.mjs (run in UTC).   node tools/gen-oracle-import.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASES } from './oracle-import-cases.mjs';

const el = `
(require 'icalendar) (require 'json)
(set-language-environment "UTF-8")
(setq coding-system-for-read 'utf-8 coding-system-for-write 'utf-8)
(defun run-case (ics)
  (let ((file (make-temp-file "cal" nil ".ics")) (diary (make-temp-file "diary")))
    (with-temp-file file (insert ics))
    (condition-case e
        (progn
          (with-current-buffer (find-file-noselect file)
            (let ((inhibit-message t)) (icalendar-import-buffer diary t)))
          (with-temp-buffer (insert-file-contents diary) (buffer-string)))
      (error (concat "ERROR " (error-message-string e))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(CASES));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ: 'UTC', ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(new URL('../test/fixtures/oracle-import.json', import.meta.url), JSON.stringify({ emacs: version, cases: CASES.map((ics, i) => ({ ics, emacs: out[i] })) }, null, 1) + '\n');
console.log(`wrote ${CASES.length} cases from Emacs ${version}`);
