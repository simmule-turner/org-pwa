#!/usr/bin/env node
/**
 * Writes test/fixtures/org-lisp.json: what Emacs 29.3 answers for each form of tools/org-lisp-cases.mjs with the cursor on each heading.
 *
 *   node tools/gen-org-lisp-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DOC, FORMS } from './org-lisp-cases.mjs';

const lispString = (/** @type {string} */ s) => JSON.stringify(s);
const headings = DOC.split('\n').filter((l) => /^\*+ /.test(l)).length;

const driver = `;; -*- lexical-binding: nil -*-
(require 'org)
(defun my-strip (x) (cond ((stringp x) (substring-no-properties x)) ((consp x) (cons (my-strip (car x)) (my-strip (cdr x)))) (t x)))
(defvar my-forms (list ${FORMS.map(lispString).join(' ')}))
(defvar my-doc ${lispString(DOC)})
(dotimes (h ${headings})
  (let ((i 0))
    (dolist (f my-forms)
      (let ((status "ok") (value ""))
        (with-temp-buffer
          (insert my-doc)
          (org-mode)
          (goto-char (point-min))
          (dotimes (_ (1+ h)) (re-search-forward "^\\\\*+ " nil t))
          (beginning-of-line)
          (condition-case err
              (setq value (prin1-to-string (my-strip (eval (car (read-from-string f)) nil))))
            (error (setq status "error" value (error-message-string err)))))
        (princ (format "%c%d%c%d%c%s%c%s%c" 2 h 1 i 1 status 1 value 3)))
      (setq i (1+ i)))))
`;
const file = path.join(os.tmpdir(), `org-lisp-oracle-${process.pid}.el`);
fs.writeFileSync(file, driver);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1e9, env: { ...process.env, LC_ALL: 'C.UTF-8' }, timeout: 300000 });
fs.unlinkSync(file);
if (r.status !== 0) throw new Error(r.stderr);
const results = [];
for (const rec of r.stdout.split('\x03')) {
  if (!rec.includes('\x02')) continue;
  const [h, i, status, value] = rec.slice(rec.indexOf('\x02') + 1).split('\x01');
  results.push({ heading: Number(h), form: FORMS[Number(i)], status, value });
}
if (results.length !== headings * FORMS.length) throw new Error(`got ${results.length} results\n${r.stderr.slice(0, 500)}`);
fs.writeFileSync('test/fixtures/org-lisp.json', JSON.stringify(results).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${results.length} cases (${results.filter((x) => x.status === 'error').length} errors)`);
