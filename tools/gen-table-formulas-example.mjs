#!/usr/bin/env node
/**
 * Writes test/fixtures/table-formulas-example.json (what Emacs's org-table-recalculate-buffer-tables makes of the tables in
 * tools/table-formulas-example-cases.mjs) and puts those tables into the matching sections of examples/table-formulas.org.
 *   node tools/gen-table-formulas-example.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SECTIONS } from './table-formulas-example-cases.mjs';

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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfex-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(SECTIONS.map((s) => s.input)));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr);
  process.exit(1);
}
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
const cases = SECTIONS.map((s, i) => ({ ...s, emacs: out[i] }));
fs.writeFileSync(new URL('../test/fixtures/table-formulas-example.json', import.meta.url), JSON.stringify({ emacs: version, cases }, null, 1) + '\n');

// each section replaces the one of the same name, or goes before "Complex numbers" when the file has none
const file = new URL('../examples/table-formulas.org', import.meta.url);
let text = fs.readFileSync(file, 'utf8');
for (const c of cases) {
  const block = `* ${c.heading}\n${c.prose}\n\n${c.emacs}\n`;
  const re = new RegExp(`^\\* ${c.heading}\\n[\\s\\S]*?(?=^\\* )`, 'm');
  text = re.test(text) ? text.replace(re, () => block) : text.replace(/^\* Complex numbers\n/m, () => block + '* Complex numbers\n');
}
fs.writeFileSync(file, text);
console.log(`wrote ${cases.length} sections from Emacs ${version}`);
