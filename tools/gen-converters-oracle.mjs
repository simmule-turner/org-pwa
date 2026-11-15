#!/usr/bin/env node
/**
 * Writes test/fixtures/converters-oracle.json: what Emacs 29.3 (Org 9.6.15) answers for the table and list converters (orgtbl-to-*,
 * org-table-to-lisp, org-table-collapse-header, org-list-to-*) on every call in Org's own test-org-table.el and test-org-list.el
 * (found by reading the test files) and on the cases of tools/converter-cases.mjs. Each case is Lisp source; the value is printed with
 * prin1, or the error message is kept. test/converters-oracle.test.js holds the app to it.
 *
 *   node tools/gen-converters-oracle.mjs     (needs emacs on the PATH; /tmp/orgsrc/testing/lisp holds Org's tests)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXTRA_CASES } from './converter-cases.mjs';

const TESTS = process.env.ORG_TESTS || '/tmp/orgsrc/testing/lisp';
const driver = `;; -*- lexical-binding: t -*-
(require 'org) (require 'ox) (require 'ox-html) (require 'ox-latex) (require 'ox-ascii) (require 'ox-org) (require 'cl-lib)
(setq org-export-use-babel nil)
(defmacro org-test-with-temp-text (text &rest body)
  (declare (indent 1))
  ;; the app has no org-mode: the text is put in a buffer, with point at <point> or at the start
  \`(with-temp-buffer
     (let ((org-inhibit-startup t)) (org-mode))
     (insert ,text)
     (goto-char (point-min))
     (when (search-forward "<point>" nil t) (replace-match ""))
     ,@body))
(defvar found nil)
(defun mentions (f)
  (cond ((consp f) (or (and (symbolp (car f)) (string-match-p "\\\\\`\\\\(orgtbl-to-\\\\|org-list-to-\\\\|org-table-to-lisp\\\\|org-table-collapse\\\\)" (symbol-name (car f))))
                       (let ((l f) (r nil)) (while (and (consp l) (not r)) (setq r (mentions (car l)) l (cdr l))) r)))))
(defun collect (f)
  (when (consp f)
    (cond ((and (eq (car f) 'equal) (= (length f) 3) (mentions (nth 2 f))) (push (nth 2 f) found))
          ((and (memq (car f) '(should should-not should-error)) (mentions (cadr f)) (not (eq (car-safe (cadr f)) 'equal))) (push (cadr f) found))
          (t (let ((l f)) (while (consp l) (collect (car l)) (setq l (cdr l))))))))
(dolist (file (list (concat (getenv "TESTS") "/test-org-table.el") (concat (getenv "TESTS") "/test-org-list.el")))
  (with-temp-buffer (insert-file-contents file) (goto-char (point-min))
    (condition-case nil (while t (collect (read (current-buffer)))) (end-of-file nil))))
(setq found (cl-remove-if (lambda (f) (string-match-p "texinfo" (prin1-to-string f))) (nreverse found)))
(defun src-of (form) (let ((print-length nil) (print-level nil)) (prin1-to-string form)))
(defun run-one (src)
  (let ((inhibit-message t) (message-log-max nil))
    (condition-case e (concat "V" (let ((print-length nil) (print-level nil)) (prin1-to-string (eval (car (read-from-string src)) t))))
      (error (concat "E" (error-message-string e))))))
(with-temp-buffer
  (insert-file-contents (getenv "EXTRA"))
  (let* ((extra (split-string (buffer-string) "\\n\\\\{2\\\\}" t)) (all (append (mapcar #'src-of found) (mapcar (lambda (s) (replace-regexp-in-string "\\x01" "\\n" s)) extra))))
    (dolist (s all) (princ (format "%c%s%c%s%c" 2 s 1 (run-one s) 3)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oconv-'));
fs.writeFileSync(path.join(dir, 'run.el'), driver);
fs.writeFileSync(path.join(dir, 'extra.txt'), EXTRA_CASES.map((s) => s.replace(/\n/g, '\x01')).join('\n\n'));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { encoding: 'utf8', maxBuffer: 1e9, env: { ...process.env, LC_ALL: 'C.UTF-8', TESTS, EXTRA: path.join(dir, 'extra.txt') }, timeout: 900000 });
if (r.status !== 0) throw new Error(r.stderr.slice(-2000));
const cases = [];
for (const rec of r.stdout.split('\x03')) {
  if (!rec.includes('\x02')) continue;
  const [src, out] = rec.slice(rec.indexOf('\x02') + 1).split('\x01');
  cases.push(out[0] === 'E' ? { src, error: out.slice(1) } : { src, value: out.slice(1) });
}
fs.rmSync(dir, { recursive: true });
fs.writeFileSync('test/fixtures/converters-oracle.json', JSON.stringify(cases, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${cases.length} cases (${cases.filter((c) => c.error).length} errors)`);
