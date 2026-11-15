#!/usr/bin/env node
/**
 * Writes test/fixtures/capture-columns-oracle.json: the file Emacs's org-capture leaves after adding a row to a table whose #+TBLFM has a
 * formula for a column the table lacks, for each value of org-table-formula-create-columns (nil, t, warn), and the messages Emacs showed.
 *   node tools/gen-capture-columns-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const INITS = [
  '* Tr\n| 1 |\n|---|\n| 9 |\n#+TBLFM: $2=$1*2\n',
  '* Tr\n| a | b |\n|---+---|\n| 1 | 2 |\n#+TBLFM: $3=$1+$2\n',
  '* Tr\n| a | b |\n|---+---|\n| 1 | 2 |\n#+TBLFM: $2=$1*2\n',
  '* Tr\n| a |\n|---|\n| 1 |\n#+TBLFM: @2$3=7\n',
];
const cases = [];
for (const init of INITS) for (const create of ['nil', 't', 'warn']) cases.push({ init, create, template: '| 5 |' });
const q = (s) => JSON.stringify(s);
const el = `
(require 'org) (require 'org-capture) (require 'json)
(defun run-case (init create template)
  (let* ((f (make-temp-file "cols" nil ".org")) (msgs nil)
         (org-table-formula-create-columns (car (read-from-string create)))
         (org-capture-templates (list (list "t" "T" 'table-line (list 'file+headline f "Tr") template :immediate-finish t))))
    (with-temp-file f (insert init))
    (advice-add 'message :before (lambda (fmt &rest args) (when fmt (push (apply #'format-message fmt args) msgs))))
    (let ((text (condition-case err
        (progn (org-capture nil "t")
               (with-current-buffer (find-buffer-visiting f)
                 (prog1 (substring-no-properties (buffer-string)) (set-buffer-modified-p nil))))
      (error (concat "ERROR " (error-message-string err))))))
      (advice-remove 'message (lambda (fmt &rest args) nil))
      (list text (vconcat (nreverse msgs))))))
(let (out)
  ${cases.map((c) => `(push (run-case ${q(c.init)} ${q(c.create)} ${q(c.template)}) out)`).join('\n  ')}
  (princ (json-encode (vconcat (nreverse out)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cols-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stderr.slice(-2000)); process.exit(1); }
const outs = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/capture-columns-oracle.json', import.meta.url), JSON.stringify({ cases: cases.map((c, i) => ({ ...c, emacs: outs[i][0], messages: outs[i][1] })) }, null, 1) + '\n');
console.log(`${cases.length} cases`);
