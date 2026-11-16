#!/usr/bin/env node
/**
 * Writes test/fixtures/emacs-undo-oracle.json: what Emacs 29.3 does for runs of editing commands followed by undo (C-/), as keys fed to a
 * keyboard macro in an org-mode buffer, so that the command loop adds the undo boundaries and groups typed characters as it does for a
 * person. test/emacs-undo-oracle.test.js holds src/emacs-undo.js and src/emacs-edit.js to it.
 *
 *   node tools/gen-emacs-undo-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEYS = {
  'forward-char': 'C-f', 'backward-char': 'C-b', 'org-beginning-of-line': 'C-a', 'org-end-of-line': 'C-e', 'forward-word': 'M-f',
  'backward-word': 'M-b', 'org-delete-char': 'C-d', 'org-delete-backward-char': 'DEL', 'kill-word': 'M-d', 'backward-kill-word': 'M-DEL',
  'org-kill-line': 'C-k', 'kill-region': 'C-w', 'org-yank': 'C-y', 'org-open-line': 'C-o', 'transpose-chars': 'C-t', 'org-transpose-words': 'M-t',
  'upcase-word': 'M-u', 'downcase-word': 'M-l', 'capitalize-word': 'M-c', 'delete-horizontal-space': 'M-\\', 'undo': 'C-/',
  'set-mark-command': 'C-@', 'exchange-point-and-mark': 'C-x C-x', 'mark-whole-buffer': 'C-x h', 'kill-ring-save': 'M-w', 'next-line': 'C-n', 'previous-line': 'C-p',
};
const texts = ['foo bar baz', 'one\ntwo\nthree', 'aa ab  cd'];
const scripts = [
  ['org-delete-char', 'undo'], ['org-delete-char', 'org-delete-char', 'undo'], ['org-delete-char', 'org-delete-char', 'undo', 'undo'],
  ['org-delete-backward-char', 'undo'], ['org-delete-backward-char', 'org-delete-backward-char', 'org-delete-backward-char', 'undo'],
  ['kill-word', 'undo'], ['kill-word', 'kill-word', 'undo'], ['backward-kill-word', 'undo'], ['org-kill-line', 'org-kill-line', 'undo'],
  ['org-kill-line', 'undo', 'undo'], ['org-kill-line', 'undo', 'forward-char', 'undo'], ['org-kill-line', 'undo', 'forward-char', 'undo', 'undo'],
  ['org-kill-line', 'forward-char', 'org-kill-line', 'undo', 'undo', 'undo'], ['kill-word', 'undo', 'undo', 'undo'],
  ['org-open-line', 'undo'], ['transpose-chars', 'undo'], ['org-transpose-words', 'undo'], ['upcase-word', 'undo'], ['capitalize-word', 'undo'],
  ['downcase-word', 'forward-word', 'upcase-word', 'undo', 'undo'], ['delete-horizontal-space', 'undo'], ['org-yank', 'undo'],
  ['org-kill-line', 'org-yank', 'undo', 'undo'], ['forward-char', 'undo'], ['undo'], ['org-end-of-line', 'org-delete-backward-char', 'undo', 'undo', 'forward-char', 'undo'],
  ['kill-word', 'kill-word', 'undo', 'forward-char', 'undo', 'undo', 'undo'],
  ['next-line', 'org-kill-line', 'undo'], ['transpose-chars', 'transpose-chars', 'undo', 'undo'],
  ['self:x', 'undo'], ['self:x', 'self:y', 'self:z', 'undo'], ['self:x', 'self:y', 'self:z', 'undo', 'undo'],
  ['self:a', 'forward-char', 'self:b', 'undo', 'undo'], ['self:a', 'org-delete-char', 'self:b', 'undo'],
  ['self:x', 'self:y', 'org-delete-backward-char', 'org-delete-backward-char', 'undo'],
  ['self:x', 'self:y', 'undo', 'self:z', 'undo', 'undo'],
  Array.from({ length: 25 }, (_, i) => `self:${String.fromCharCode(97 + (i % 26))}`).concat(['undo', 'undo']),
  Array.from({ length: 45 }, (_, i) => `self:${String.fromCharCode(97 + (i % 26))}`).concat(['undo', 'undo', 'undo']),
];
const regionScripts = [
  ['set-mark-command'], ['set-mark-command', 'forward-char'], ['set-mark-command', 'forward-char', 'exchange-point-and-mark'],
  ['set-mark-command', 'forward-char', 'exchange-point-and-mark', 'exchange-point-and-mark'], ['set-mark-command', 'forward-word', 'kill-region'],
  ['set-mark-command', 'forward-word', 'kill-ring-save'], ['set-mark-command', 'forward-word', 'kill-ring-save', 'exchange-point-and-mark'],
  ['set-mark-command', 'forward-char', 'org-delete-char'], ['set-mark-command', 'forward-char', 'self:x'], ['set-mark-command', 'forward-char', 'upcase-word'],
  ['set-mark-command', 'forward-char', 'next-line'], ['set-mark-command', 'set-mark-command'], ['set-mark-command', 'forward-char', 'set-mark-command', 'forward-char'],
  ['set-mark-command', 'forward-char', 'kill-region', 'undo'], ['set-mark-command', 'forward-char', 'self:x', 'undo'],
  ['set-mark-command', 'forward-char', 'forward-char', 'org-kill-line'], ['set-mark-command', 'forward-char', 'org-yank'], ['set-mark-command', 'org-open-line'],
  ['set-mark-command', 'forward-char', 'transpose-chars'], ['set-mark-command', 'forward-word', 'org-transpose-words'],
  ['mark-whole-buffer'], ['mark-whole-buffer', 'kill-region'], ['mark-whole-buffer', 'kill-ring-save'], ['forward-word', 'mark-whole-buffer', 'exchange-point-and-mark'], ['mark-whole-buffer', 'set-mark-command'], ['exchange-point-and-mark'], ['exchange-point-and-mark', 'exchange-point-and-mark'], ['kill-region'], ['kill-ring-save'],
];
const cases = [];
for (const text of ['foo bar baz', 'one\ntwo']) for (let pos = 0; pos <= text.length; pos++) for (const cmds of regionScripts) {
  cases.push({ text, pos, cmds, mark: null });
  cases.push({ text, pos, cmds, mark: (pos + 3) % (text.length + 1) });
}
for (const text of texts) for (let pos = 0; pos <= text.length; pos++) for (const cmds of scripts) cases.push({ text, pos, cmds, mark: null });
// with a mark: kill-region then undo then exchange point and mark
for (const text of ['foo bar', 'ab\ncd']) for (let pos = 0; pos <= text.length; pos++) for (let mark = 0; mark <= text.length; mark++) {
  for (const cmds of [['kill-region', 'undo'], ['kill-region', 'undo', 'exchange-point-and-mark'], ['kill-region', 'undo', 'undo', 'exchange-point-and-mark']]) cases.push({ text, pos, cmds, mark });
}
// random runs: a fixed seed keeps the fixture stable
let seed = 20261116;
const rnd = (n) => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return Math.floor((seed / 4294967296) * n);
};
const pool = ['forward-char', 'backward-char', 'org-end-of-line', 'org-beginning-of-line', 'forward-word', 'backward-word', 'org-delete-char',
  'org-delete-backward-char', 'kill-word', 'backward-kill-word', 'org-kill-line', 'org-yank', 'org-open-line', 'transpose-chars', 'org-transpose-words',
  'upcase-word', 'capitalize-word', 'delete-horizontal-space', 'next-line', 'previous-line', 'undo', 'undo', 'undo', 'self:q', 'self:r', 'self:s'];
for (let i = 0; i < 1200; i++) {
  const text = texts[rnd(texts.length)];
  const cmds = Array.from({ length: 3 + rnd(8) }, () => pool[rnd(pool.length)]);
  cases.push({ text, pos: rnd(text.length + 1), cmds, mark: null });
}
const keys = (cmds) => cmds.map((c) => (c.startsWith('self:') ? c.slice(5) : KEYS[c])).join(' ');
for (const c of cases) c.keys = keys(c.cmds);

const el = `;; -*- lexical-binding: t -*-
(require 'org) (require 'json)
(transient-mark-mode 1)
(setq line-move-visual nil)
(defun run-case (c)
  (let ((text (cdr (assq 'text c))) (pos (cdr (assq 'pos c))) (mark (cdr (assq 'mark c))) (keys (cdr (assq 'keys c))) (err nil))
    (let ((buf (generate-new-buffer "undo-oracle")))
      (switch-to-buffer buf)
      (insert text)
      (org-mode)
      (buffer-enable-undo)
      (setq buffer-undo-list nil)
      (setq kill-ring (list "KILL"))
      (goto-char (1+ pos))
      (when (numberp mark) (set-mark (1+ mark)) (deactivate-mark))
      (setq last-command nil this-command nil real-last-command nil temporary-goal-column 0)
      (let ((inhibit-message t) (message-log-max nil) (undo-in-region nil))
        (condition-case e (execute-kbd-macro (kbd keys)) (error (setq err (error-message-string e)))))
      (prog1 (list (cons 'text (buffer-substring-no-properties (point-min) (point-max))) (cons 'pos (1- (point)))
            (cons 'mark (if (mark t) (1- (mark t)) -1)) (cons 'active (if (region-active-p) 1 0)) (cons 'error (or err "")))
        (set-buffer-modified-p nil) (kill-buffer buf)))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emacs-undo-oracle-'));
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
fs.writeFileSync('test/fixtures/emacs-undo-oracle.json', JSON.stringify({ emacs: '29.3', cases: out }) + '\n');
console.log(`${out.length} cases written`);
