#!/usr/bin/env node
/**
 * Writes test/fixtures/org-fold-oracle.json: what Emacs 29.3 (Org 9.6) hides, where point goes and what it says after TAB, S-TAB, C-u N S-TAB and
 * C-c C-r in an org-mode buffer, one snapshot after each command of a keyboard macro (so the commands know their predecessor, as when typed),
 * and what a buffer shows when it opens under each `org-startup-folded` value. test/org-fold-oracle.test.js holds src/org-fold.js to it.
 *
 *   node tools/gen-org-fold-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const texts = [
  '* A\n:PROPERTIES:\n:ID: 1\n:END:\nbody a\n** A1\nbody a1\n*** A1x\nxx\n** A2\n* B\nbody b\n',
  'Preamble line\n\n* One\ntext one\n\n** Two\n\n*** Three\nthree\n\n* Four\n- item\n  - sub\n#+begin_src js\nx\n#+end_src\n',
  '* TODO Task :tag:\nSCHEDULED: <2026-01-01 Thu>\n:LOGBOOK:\n- note\n:END:\ntext\n** Child\n*** Grandchild\n**** Deep\nd\n* Last',
  '* A\n* B\n** C\n* D\n',
];
const scripts = [
  'TAB', 'TAB TAB', 'TAB TAB TAB', 'TAB TAB TAB TAB', '<backtab>', '<backtab> <backtab>', '<backtab> <backtab> <backtab>', '<backtab> <backtab> <backtab> <backtab>',
  'C-u 1 <backtab>', 'C-u 2 <backtab>', 'C-u 3 <backtab>', 'C-u 4 <backtab>', 'C-u C-u C-u TAB', 'C-u TAB', 'C-u C-u TAB', '<backtab> TAB', 'TAB <backtab>',
  '<backtab> TAB TAB', 'C-u 1 <backtab> C-c C-r', '<backtab> C-c C-r', 'C-u 2 <backtab> TAB', '<backtab> <backtab> TAB TAB', 'C-c C-r',
];
const startups = ['overview', 'content', 'showall', 'showeverything', 'show2levels', 'show3levels', 'show4levels', 'show5levels', 't', 'nil'];
const cases = [];
for (const text of texts) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n' && i + 1 <= text.length) starts.push(i + 1);
  const heads = new Set(starts.filter((p) => text[p] === '*'));
  const positions = new Set(starts);
  for (const p of heads) positions.add(p + 2);
  positions.add(text.length);
  for (const pos of [...positions].filter((p) => p <= text.length)) for (const keys of scripts) cases.push({ kind: 'keys', text, pos, keys });
  for (const startup of startups) cases.push({ kind: 'startup', text, pos: 0, startup });
}

const el = `;; -*- lexical-binding: t -*-
(require 'org) (require 'json)
(setq line-move-visual nil)
(defvar msgs nil)
(defvar snaps nil)
(advice-add 'message :before (lambda (fmt &rest args) (when fmt (push (apply #'format-message fmt args) msgs))))
(defun runs ()
  (let ((r '()) (start nil))
    (dotimes (i (buffer-size))
      (let ((inv (invisible-p (1+ i))))
        (cond ((and inv (not start)) (setq start i))
              ((and (not inv) start) (push (vector start i) r) (setq start nil)))))
    (when start (push (vector start (buffer-size)) r))
    (vconcat (nreverse r))))
(defun snap ()
  (push (list (cons 'pt (1- (point))) (cons 'runs (runs)) (cons 'msg (mapconcat #'identity (reverse msgs) "|"))) snaps)
  (setq msgs nil))
(defun run-case (c)
  (let ((text (cdr (assq 'text c))) (pos (cdr (assq 'pos c))) (keys (cdr (assq 'keys c))) (startup (cdr (assq 'startup c))) (err nil))
    (setq snaps nil msgs nil)
    (let ((buf (generate-new-buffer "fold-oracle")))
      (switch-to-buffer buf)
      (insert text)
      (cond (startup (setq org-startup-folded (cond ((equal startup "t") t) ((equal startup "nil") nil) (t (intern startup)))))
            (t (setq org-startup-folded 'showeverything)))
      (org-mode)
      (goto-char (1+ pos))
      (setq last-command nil this-command nil real-last-command nil temporary-goal-column 0)
      (if startup
          (snap)
        (add-hook 'post-command-hook #'snap)
        (let ((inhibit-message t) (message-log-max nil))
          (condition-case e (execute-kbd-macro (kbd keys)) (error (setq err (error-message-string e)))))
        (remove-hook 'post-command-hook #'snap))
      (prog1 (list (cons 'steps (vconcat (reverse snaps))) (cons 'error (or err "")) (cons 'text (buffer-substring-no-properties (point-min) (point-max))))
        (set-buffer-modified-p nil) (kill-buffer buf)))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-fold-oracle-'));
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', maxBuffer: 1 << 28 });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const out = cases.map((c, i) => ({ ...c, emacs: results[i] }));
fs.writeFileSync('test/fixtures/org-fold-oracle.json', JSON.stringify({ emacs: '29.3', cases: out }) + '\n');
console.log(`${out.length} cases written`);
