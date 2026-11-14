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

// Macros under a COMMENT heading are left alone; the rest of the file is expanded (test/fixtures/macro-comment-oracle.json).
const COMMENT_DOCS = [
  '#+MACRO: m X\n{{{m}}} pre\n* COMMENT C\n{{{m}}} a\n** Sub\n{{{m}}} b\n* D\n{{{m}}} d\n',
  '#+MACRO: m X\n* COMMENT {{{m}}} title\n{{{m}}}\n* {{{m}}} title\n',
  '#+MACRO: m X\n* TODO COMMENT x {{{m}}}\n{{{m}}}\n** TODO y\n{{{m}}}\n* DONE [#A] COMMENT z\n{{{m}}}\n',
  '#+MACRO: m X\n* COMMENTED {{{m}}}\n{{{m}}}\n* COMMENT\n{{{m}}}\n',
  '#+MACRO: m X\n* TODO {{{m}}} a\n** COMMENT b\n*** c\n{{{m}}}\n** d\n{{{m}}}\n',
  '#+MACRO: m X\n#+MACRO: n (eval (number-to-string (+ 1 1)))\n* COMMENT C\n{{{n}}}\n* D\n{{{n}}}\n',
];
const commentEl = `
(require 'org) (require 'org-macro) (require 'json)
(let (out)
  (dolist (text (json-parse-string (getenv "ORACLE_IN") :array-type 'list))
    (with-temp-buffer
      (insert text)
      (org-mode) (org-macro-initialize-templates) (org-macro-replace-all org-macro-templates)
      (push (buffer-substring-no-properties (point-min) (point-max)) out)))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out)))))
`;
fs.writeFileSync(path.join(dir, 'comment.el'), commentEl);
const rc = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'comment.el')], { env: { ...process.env, ORACLE_IN: JSON.stringify(COMMENT_DOCS), ORACLE_OUT: path.join(dir, 'comment-out.json') }, encoding: 'utf8' });
if (rc.status !== 0) {
  console.error(rc.stderr);
  process.exit(1);
}
const commentOut = JSON.parse(fs.readFileSync(path.join(dir, 'comment-out.json'), 'utf8'));
fs.writeFileSync(new URL('../test/fixtures/macro-comment-oracle.json', import.meta.url), JSON.stringify(COMMENT_DOCS.map((org, i) => ({ org, emacs: commentOut[i] })), null, 1) + '\n');
