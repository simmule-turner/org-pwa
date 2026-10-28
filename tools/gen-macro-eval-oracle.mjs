#!/usr/bin/env node
/**
 * Writes test/fixtures/macro-eval.json: what Emacs's org-macro-replace-all makes of the macros of tools/macro-eval-cases.mjs, whose
 * templates start with (eval ...). An Emacs error is kept as its message.
 *   node tools/gen-macro-eval-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASES } from './macro-eval-cases.mjs';

const el = `
(require 'org) (require 'org-macro) (require 'json)
(defun run-case (template use)
  (with-temp-buffer
    (insert "#+MACRO: m " template "\\n\\nbefore " use " after\\n")
    (let ((inhibit-message t))
      (condition-case e
          (progn (org-mode)
                 (org-macro-initialize-templates)
                 (org-macro-replace-all org-macro-templates)
                 (buffer-substring-no-properties (point-min) (point-max)))
        (error (concat "ERROR " (error-message-string e)))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-array-type 'list) (json-object-type 'alist) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case (cdr (assq 'template c)) (cdr (assq 'use c))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(CASES));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr);
  process.exit(1);
}
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(new URL('../test/fixtures/macro-eval.json', import.meta.url), JSON.stringify({ emacs: version, cases: CASES.map((c, i) => ({ ...c, emacs: out[i] })) }, null, 1) + '\n');
console.log(`wrote ${CASES.length} cases from Emacs ${version}`);
