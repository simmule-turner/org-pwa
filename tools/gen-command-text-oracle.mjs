#!/usr/bin/env node
/**
 * Writes test/fixtures/command-text.json: the *Org Agenda* buffer Emacs 29.3 makes for each custom command of tools/command-text-cases.mjs
 * (the lines you can see: a row a filter preset hides is left out, and so are the "Press ..." hints Emacs adds under a single command's
 * heading). Today is 2026-10-11 16:30, New York time. test/command-text.test.js holds the app to it.
 *   node tools/gen-command-text-oracle.mjs   (needs emacs and faketime on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASES, FILES } from './command-text-cases.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-command-text-'));
for (const [name, text] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, name), text);
const el = `
(require 'org) (require 'org-agenda) (require 'org-habit) (require 'json)
(setq org-agenda-window-setup 'current-window org-agenda-sticky nil inhibit-message t org-agenda-use-time-grid nil org-agenda-tags-column 0)
(setq default-directory (concat (getenv "ORACLE_DIR") "/"))
(defun visible-lines ()
  (with-current-buffer "*Org Agenda*"
    (let (acc)
      (goto-char (point-min))
      (while (not (eobp))
        (unless (invisible-p (point))
          (let ((line (string-trim-right (buffer-substring-no-properties (line-beginning-position) (line-end-position)))))
            (unless (string-match-p "^\\\\(Press \`\\\\|  +([0-9]+)[A-Z]\\\\)" line) (push line acc))))
        (forward-line 1))
      (nreverse acc))))
(let* ((cases (with-temp-buffer (insert-file-contents (getenv "ORACLE_IN")) (json-parse-string (buffer-string) :object-type 'alist :array-type 'list :null-object nil)))
       (out '()))
  (ignore-errors (let ((org-agenda-files (list (expand-file-name "mini.org")))) (org-agenda-list nil "2026-10-11" 'day)) (when (get-buffer "*Org Agenda*") (kill-buffer "*Org Agenda*")))
  (dolist (c cases)
    (let* ((vars (cdr (assq 'vars c)))
           (binds (append (list (list 'org-agenda-files (list 'quote (list (expand-file-name "mini.org"))))
                                (list 'org-agenda-custom-commands (list 'quote (car (read-from-string (cdr (assq 'commands c)))))))
                          (mapcar (lambda (v) (let ((x (car (read-from-string (cdr v))))) (list (car v) (if (and (consp x) (not (eq (car x) 'quote))) (list 'quote x) x)))) vars))))
      (condition-case e
          (progn
            (eval \`(let ,binds (org-agenda nil "x")) t)
            (push (list (cons 'id (cdr (assq 'id c))) (cons 'lines (vconcat (visible-lines)))) out))
        (error (push (list (cons 'id (cdr (assq 'id c))) (cons 'error (error-message-string e))) out)))
      (when (get-buffer "*Org Agenda*") (kill-buffer "*Org Agenda*"))))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (nreverse out))))))
`;
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);
const inFile = path.join(dir, 'in.json');
const outFile = path.join(dir, 'out.json');
fs.writeFileSync(inFile, JSON.stringify(CASES.map(([id, commands, vars]) => ({ id, commands: commands.replace(/"(mini|other)\.org"/g, (_, n) => JSON.stringify(path.join(dir, `${n}.org`))), vars }))));
const r = spawnSync('faketime', ['-f', '@2026-10-11 16:30:00', 'emacs', '--batch', '-Q', '-l', elFile], { env: { ...process.env, TZ: 'America/New_York', ORACLE_IN: inFile, ORACLE_OUT: outFile, ORACLE_DIR: dir }, encoding: 'utf8', maxBuffer: 1 << 28 });
if (!fs.existsSync(outFile)) { console.error(r.stderr || r.stdout); process.exit(1); }
const emacs = JSON.parse(fs.readFileSync(outFile, 'utf8'));
const fixture = { generatedBy: 'tools/gen-command-text-oracle.mjs', emacs: 'GNU Emacs 29.3', now: '2026-10-11 16:30', tz: 'America/New_York', cases: emacs };
fs.writeFileSync(new URL('../test/fixtures/command-text.json', import.meta.url), JSON.stringify(fixture, null, 1) + '\n');
console.log(`${emacs.length} cases, ${emacs.filter((c) => c.error).length} errors`);
