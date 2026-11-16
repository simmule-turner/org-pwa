#!/usr/bin/env node
/**
 * Writes test/fixtures/isearch-oracle.json: what Emacs 29.3's incremental search (C-s, C-r, M-r, M-c, C-w, DEL, RET, C-g) leaves behind
 * for a sequence of keys typed in an Org buffer: where point is, where the mark was saved, whether the search is still going, what
 * the search string and its direction are, and whether the last match was found. test/isearch.test.js holds src/isearch.js to it.
 *
 *   node tools/gen-isearch-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const texts = [
  'foo bar Foo\nbaz  foo\n',
  '* Heading One\nbody text here\n** Sub heading\nmore Text\n* Two\nfoo.bar foo\n',
  'alpha beta\ngamma  delta  alpha\n(x) a.b\n',
];
// the keys of one search, after `C-s` or `C-r` has begun it (written with C-s; the backward variants are made by swapping the first key)
const scripts = [
  'C-s foo', 'C-s foo RET', 'C-s foo C-s', 'C-s foo C-s C-s', 'C-s foo C-s C-s C-s', 'C-s foo C-s C-s C-s C-s', 'C-s foo C-s C-s C-s C-s RET',
  'C-s Foo', 'C-s baz SPC foo', 'C-s a SPC b', 'C-s alpha SPC SPC beta', 'C-s alpha SPC beta', 'C-s gamma SPC delta', 'C-s o SPC', 'C-s SPC', 'C-s foo SPC b',
  'C-s f DEL', 'C-s fo DEL DEL', 'C-s foo DEL RET', 'C-s fo C-s DEL', 'C-s zzz', 'C-s zzz DEL', 'C-s fooz DEL', 'C-s foo C-s C-s DEL DEL',
  'C-s foo C-g', 'C-s foo C-s C-g', 'C-s zzz C-g', 'C-s foo C-r', 'C-s foo C-r C-r', 'C-s foo C-s C-r RET',
  'C-s foo RET C-s C-s', 'C-s foo RET C-s C-s RET', 'C-s foo RET C-r C-r', 'C-s C-s', 'C-s . ', 'C-s o RET',
  'C-s foo RET C-s bar RET C-s C-s',
  'C-s M-r fo+', 'C-s M-r a.b RET', 'C-s M-r \\(foo', 'C-s M-r \\(foo\\) RET', 'C-s M-r o* RET', 'C-s M-r foo$', 'C-s M-r a SPC b', 'C-s M-r [a-z]+ C-s C-s',
  'C-s M-c Foo', 'C-s M-c foo', 'C-s foo M-c', 'C-s Foo M-c', 'C-s foo M-c C-s', 'C-s Foo M-c C-s', 'C-s foo M-c o', 'C-s Foo M-c DEL', 'C-s zzz M-c', 'C-s a M-r SPC', 'C-s foo M-r C-s', 'C-s foo M-s w C-s', 'C-s foo M-s w o', 'C-s C-w', 'C-s C-w C-w', 'C-s b C-w', 'C-s M-s w baz SPC foo', 'C-s M-s w gamma SPC delta', 'C-s M-s w fo',
  'C-M-s fo+ RET', 'C-M-s o+ C-s',
];
const cases = [];
for (const text of texts) for (let pos = 0; pos <= text.length; pos++) for (const s of scripts) {
  cases.push({ text, pos, keys: s });
  cases.push({ text, pos, keys: s.replace(/^C-s/, 'C-r').replace(/^C-M-s/, 'C-M-r') });
}

const el = `;; -*- lexical-binding: t -*-
(require 'org) (require 'json)
(transient-mark-mode 1)
(setq ring-bell-function #'ignore)
(advice-add 'sit-for :override (lambda (&rest _) t)) ; no waiting after a message
(advice-add 'sleep-for :override (lambda (&rest _) nil))
(defvar trace nil)
(defun track ()
  (push (list (cons 'str (if isearch-mode isearch-string nil)) (cons 'pt (1- (point))) (cons 'success (if isearch-success 1 0)) (cons 'forward (if isearch-forward 1 0))
              (cons 'fold (if isearch-case-fold-search 1 0)) (cons 'regexp (if isearch-regexp 1 0)) (cons 'word (if isearch-regexp-function 1 0)) (cons 'wrapped (if isearch-wrapped 1 0)) (cons 'on (if isearch-mode 1 0)))
        trace))
(add-hook 'post-command-hook #'track)
(defun run-case (c)
  (let ((text (cdr (assq 'text c))) (pos (cdr (assq 'pos c))) (keys (cdr (assq 'keys c))) (err nil) (buf (generate-new-buffer "isearch")))
    (switch-to-buffer buf)
    (insert text)
    (let ((org-startup-folded 'showeverything)) (org-mode))
    (goto-char (1+ pos))
    (setq isearch-string "" isearch-last-case-fold-search t search-ring nil regexp-search-ring nil isearch-regexp nil isearch-forward nil isearch-case-fold-search nil isearch-word nil)
    (setq last-command nil this-command nil real-last-command nil trace nil)
    (let ((inhibit-message t) (message-log-max nil))
      (condition-case e (execute-kbd-macro (kbd keys))
        (quit (setq err "quit"))
        (error (setq err (error-message-string e)))))
    (prog1 (list (cons 'pt (1- (point))) (cons 'mark (and (mark t) (1- (mark t)))) (cons 'trace (vconcat (nreverse trace))) (cons 'error (or err "")))
      (when isearch-mode (let ((inhibit-quit t)) (isearch-done t)))
      (set-buffer-modified-p nil) (kill-buffer buf))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isearch-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', maxBuffer: 1 << 28 });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/isearch-oracle.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: results[i] })) }) + '\n');
console.log(`${cases.length} cases written`);
