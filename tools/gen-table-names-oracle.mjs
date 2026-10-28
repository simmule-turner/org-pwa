#!/usr/bin/env node
/**
 * Writes test/fixtures/table-names.json: what Emacs's org-table-recalculate-buffer-tables does to the tables of tools/table-names-cases.mjs
 * (field names as formula targets, the `%` default format). An Emacs error is kept as its message.
 *   node tools/gen-table-names-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASES } from './table-names-cases.mjs';

const el = `
(require 'org) (require 'json)
(defun run-case (org)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (let ((inhibit-message t))
      (condition-case e (progn (org-table-recalculate-buffer-tables) (buffer-string))
        (error (concat "ERROR " (error-message-string e)))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnames-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(CASES));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr);
  process.exit(1);
}
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(new URL('../test/fixtures/table-names.json', import.meta.url), JSON.stringify({ emacs: version, cases: CASES.map((org, i) => ({ org, emacs: out[i] })) }, null, 1) + '\n');
console.log(`wrote ${CASES.length} cases from Emacs ${version}`);
