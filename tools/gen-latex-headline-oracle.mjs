#!/usr/bin/env node
/**
 * Writes test/fixtures/latex-headline.json: the body of the LaTeX export Emacs makes of the texts of tools/latex-headline-cases.mjs
 * with org-latex-format-headline-function set by an init. An Emacs error is kept as its message.
 *   node tools/gen-latex-headline-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASES } from './latex-headline-cases.mjs';

const el = `
(require 'org) (require 'ox-latex) (require 'json)
(defun run-case (init org)
  (with-temp-buffer
    (insert org)
    (org-mode)
    (let ((inhibit-message t) (org-latex-format-headline-function #'org-latex-format-headline-default-function))
      (condition-case e
          (progn (eval (read (concat "(progn " init ")")) nil)
                 (org-export-as 'latex nil nil t))
        (error (concat "ERROR " (error-message-string e)))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-array-type 'list) (json-object-type 'alist) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case (cdr (assq 'init c)) (cdr (assq 'org c))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(CASES));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr);
  process.exit(1);
}
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(new URL('../test/fixtures/latex-headline.json', import.meta.url), JSON.stringify({ emacs: version, cases: CASES.map((c, i) => ({ ...c, emacs: out[i] })) }, null, 1) + '\n');
console.log(`wrote ${CASES.length} cases from Emacs ${version}`);
