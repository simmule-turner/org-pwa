#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-org-settings.json: Emacs 29.3's answer for each document of tools/oracle-org-settings-cases.mjs
 * (macro expansion, file-local variables, #+OPTIONS, #+STARTUP).   node tools/gen-oracle-org-settings.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASES } from './oracle-org-settings-cases.mjs';

const el = `
(require 'org) (require 'ox) (require 'org-macro) (require 'json)
(defun run-macro (src)
  (with-temp-buffer
    (insert src)
    (let ((inhibit-message t))
      (condition-case e
          (progn (org-mode) (org-macro-initialize-templates) (org-macro-replace-all org-macro-templates)
                 (buffer-substring-no-properties (point-min) (point-max)))
        (error (concat "ERROR " (error-message-string e)))))))
(defun run-locals (src)
  (with-temp-buffer
    (insert src)
    (let ((inhibit-message t) (acc nil))
      (org-mode)
      (dolist (v (condition-case nil (reverse (hack-local-variables-prop-line)) (error nil))) (push v acc))
      (dolist (v (condition-case nil (reverse (hack-local-variables--find-variables)) (error nil))) (push v acc))
      (mapconcat (lambda (p) (format "%S=%S" (car p) (cdr p))) (reverse acc) (string 1)))))
(defun run-options (src)
  (with-temp-buffer
    (insert src)
    (let ((inhibit-message t) (s ""))
      (org-mode)
      (condition-case e
          (let ((pl (org-export-get-environment 'html)))
            (dolist (k '(:with-toc :section-numbers :with-author :with-date :with-creator :with-sub-superscript :with-broken-links))
              (setq s (concat s (format "%s=%S\\n" k (plist-get pl k)))))
            s)
        (error (concat "ERROR " (error-message-string e)))))))
(defun run-startup (src)
  (with-temp-buffer
    (insert src)
    (let ((inhibit-message t))
      (condition-case e
          (progn (org-mode)
                 (format "folded=%S log-done=%S images=%S drawer=%S repeat=%S" org-startup-folded org-log-done org-startup-with-inline-images org-log-into-drawer org-log-repeat))
        (error (concat "ERROR " (error-message-string e)))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-array-type 'list) (json-object-type 'alist) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (let ((k (cdr (assq 'kind c))) (s (cdr (assq 'src c))))
        (push (cond ((equal k "macro") (run-macro s)) ((equal k "locals") (run-locals s))
                    ((equal k "options") (run-options s)) (t (run-startup s))) out)))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orgset-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(CASES));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
fs.writeFileSync(new URL('../test/fixtures/oracle-org-settings.json', import.meta.url), JSON.stringify({ emacs: version, cases: CASES.map((c, i) => ({ ...c, emacs: out[i] })) }, null, 1) + '\n');
console.log(`wrote ${CASES.length} cases from Emacs ${version}`);
