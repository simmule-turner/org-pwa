#!/usr/bin/env node
/**
 * Writes test/fixtures/emacs-fold-motion-oracle.json: where point goes and what is killed or deleted when motion and editing keys run in an
 * org-mode buffer with headings folded, in Emacs 29.3. test/emacs-fold-motion.test.js holds src/emacs-fold.js to it.
 *
 *   node tools/gen-emacs-fold-motion-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const texts = [
  '* A\nbody a\n** A1\nx\n* B\nbody b\n* C\n',
  '* One\ntext one\n\n** Two\n\n*** Three\nthree\n\n* Four\nlast',
  '* A\n:PROPERTIES:\n:ID: 1\n:END:\nbody a\n** A1\nbody a1\n* B\n',
];
const folds = ['<backtab>', '<backtab> <backtab>', 'TAB'];
const scripts = ['C-f', 'C-b', 'C-n', 'C-p', 'C-e', 'C-a', 'C-d', 'DEL', 'C-k', 'M-f', 'M-b', 'C-f C-f', 'C-b C-b', 'C-n C-n', 'C-p C-p', 'C-n C-b', 'C-k C-k', 'C-SPC C-n C-w'];
const cases = [];
for (const text of texts) for (const fold of folds) for (let pos = 0; pos <= text.length; pos++) for (const keys of scripts) cases.push({ text, pos, fold, keys });

const el = `;; -*- lexical-binding: t -*-
(require 'org) (require 'json)
(setq line-move-visual nil)
(transient-mark-mode 1)
(defun runs ()
  (let ((r '()) (start nil))
    (dotimes (i (buffer-size))
      (let ((inv (invisible-p (1+ i))))
        (cond ((and inv (not start)) (setq start i))
              ((and (not inv) start) (push (vector start i) r) (setq start nil)))))
    (when start (push (vector start (buffer-size)) r))
    (vconcat (nreverse r))))
(defun run-case (c)
  (let ((text (cdr (assq 'text c))) (pos (cdr (assq 'pos c))) (fold (cdr (assq 'fold c))) (keys (cdr (assq 'keys c))) (err nil) (hid nil))
    (let ((buf (generate-new-buffer "fold-motion")))
      (switch-to-buffer buf)
      (insert text)
      (let ((org-startup-folded 'showeverything)) (org-mode))
      (setq kill-ring nil)
      (goto-char 1)
      (setq last-command nil this-command nil real-last-command nil temporary-goal-column 0)
      (let ((inhibit-message t) (message-log-max nil)) (condition-case e (execute-kbd-macro (kbd fold)) (error nil)))
      (setq hid (runs))
      (goto-char (1+ pos))
      (deactivate-mark)
      (setq last-command nil this-command nil real-last-command nil temporary-goal-column 0)
      (let ((inhibit-message t) (message-log-max nil))
        (condition-case e (execute-kbd-macro (kbd keys)) (error (setq err (error-message-string e)))))
      (prog1 (list (cons 'hidden hid) (cons 'pt (1- (point))) (cons 'text (buffer-substring-no-properties (point-min) (point-max)))
                   (cons 'kill (if kill-ring (substring-no-properties (car kill-ring)) nil)) (cons 'error (or err "")))
        (set-buffer-modified-p nil) (kill-buffer buf)))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emacs-fold-motion-'));
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', maxBuffer: 1 << 28 });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
// only places the caret can be: not strictly inside what a fold hides
const out = cases.map((c, i) => ({ ...c, emacs: results[i] })).filter((c) => !c.emacs.hidden.some(([a, b]) => c.pos > a && c.pos < b));
fs.writeFileSync('test/fixtures/emacs-fold-motion-oracle.json', JSON.stringify({ emacs: '29.3', cases: out }) + '\n');
console.log(`${out.length} cases written`);
