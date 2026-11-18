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
  'undo-redo': 'C-?', 'yank-pop': 'M-y', 'delete-blank-lines': 'C-x C-o', 'cycle-spacing': 'M-SPC', 'org-forward-sentence': 'M-e', 'org-backward-sentence': 'M-a',
  'beginning-of-buffer': 'M-<', 'end-of-buffer': 'M->',
  'set-mark-command': 'C-@', 'exchange-point-and-mark': 'C-x C-x', 'mark-whole-buffer': 'C-x h', 'kill-ring-save': 'M-w', 'next-line': 'C-n', 'previous-line': 'C-p',
};
const texts = ['foo bar baz', 'one\ntwo\nthree', 'aa ab  cd', 'a. b  c\n\n\nd.  e \t x\n'];
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
const newScripts = [
  ['org-kill-line', 'undo', 'undo-redo'], ['org-kill-line', 'undo', 'undo-redo', 'undo-redo'], ['kill-word', 'kill-word', 'undo', 'undo', 'undo-redo'],
  ['kill-word', 'kill-word', 'undo', 'undo', 'undo-redo', 'undo-redo'], ['org-delete-char', 'undo', 'undo-redo', 'undo'], ['undo-redo'], ['org-kill-line', 'undo-redo'],
  ['org-kill-line', 'undo', 'forward-char', 'undo-redo'], ['org-kill-line', 'undo', 'undo', 'undo-redo'], ['self:x', 'self:y', 'undo', 'undo-redo', 'undo-redo'],
  ['kill-word', 'undo', 'undo-redo', 'undo', 'undo-redo'], ['kill-word', 'undo', 'undo-redo', 'undo-redo'], ['org-kill-line', 'undo', 'undo-redo', 'undo', 'undo', 'undo-redo'],
  ['org-open-line', 'undo', 'undo-redo', 'forward-char', 'undo'], ['kill-word', 'forward-char', 'kill-word', 'undo', 'undo', 'undo-redo', 'undo-redo', 'undo'],
  ['org-kill-line', 'org-yank', 'yank-pop', 'undo'], ['kill-word', 'org-kill-line', 'org-yank', 'yank-pop', 'undo', 'undo'], ['org-kill-line', 'org-yank', 'yank-pop', 'yank-pop', 'undo'],
  ['kill-word', 'org-kill-line', 'org-yank', 'yank-pop', 'undo', 'undo-redo'], ['yank-pop'], ['org-yank', 'yank-pop', 'undo'],
  ['cycle-spacing', 'undo'], ['cycle-spacing', 'cycle-spacing', 'undo'], ['cycle-spacing', 'cycle-spacing', 'cycle-spacing', 'undo', 'undo'], ['cycle-spacing', 'cycle-spacing', 'cycle-spacing', 'cycle-spacing'],
  ['delete-blank-lines', 'undo'], ['delete-blank-lines', 'delete-blank-lines'], ['cycle-spacing', 'undo', 'undo-redo'],
  ['org-forward-sentence', 'undo'], ['org-backward-sentence', 'org-forward-sentence'], ['end-of-buffer', 'exchange-point-and-mark'], ['beginning-of-buffer', 'undo'],
  ['end-of-buffer', 'beginning-of-buffer', 'exchange-point-and-mark'], ['set-mark-command', 'end-of-buffer', 'beginning-of-buffer', 'exchange-point-and-mark'],
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
for (const text of texts) for (let pos = 0; pos <= text.length; pos++) for (const cmds of scripts.concat(newScripts)) cases.push({ text, pos, cmds, mark: null });
// undo in the region: some edits, then a region marked over other text, then undos (and a redo)
const histories = [
  ['kill-word', 'forward-char', 'kill-word'], ['self:x', 'forward-word', 'self:y', 'forward-word', 'self:z'], ['org-kill-line', 'forward-word', 'upcase-word', 'forward-word', 'kill-word'],
  ['forward-word', 'org-delete-backward-char', 'forward-word', 'org-delete-backward-char'], ['transpose-chars', 'forward-word', 'org-open-line', 'forward-word', 'self:q'],
  ['kill-word', 'org-yank', 'forward-word', 'capitalize-word'],
];
const regions = [
  ['set-mark-command', 'forward-word', 'undo'], ['set-mark-command', 'forward-word', 'undo', 'undo'], ['set-mark-command', 'end-of-buffer', 'undo'],
  ['beginning-of-buffer', 'set-mark-command', 'forward-word', 'forward-word', 'undo'], ['beginning-of-buffer', 'set-mark-command', 'forward-word', 'forward-word', 'undo', 'undo', 'undo'],
  ['set-mark-command', 'backward-word', 'undo', 'undo-redo'], ['mark-whole-buffer', 'undo'], ['mark-whole-buffer', 'undo', 'undo'],
  ['set-mark-command', 'forward-word', 'undo', 'forward-char', 'undo'], ['set-mark-command', 'backward-word', 'backward-word', 'undo', 'undo'],
];
for (const text of ['foo bar baz', 'one\ntwo\nthree', 'aa ab  cd']) for (let pos = 0; pos <= text.length; pos += 2) for (const h of histories) for (const r of regions) cases.push({ text, pos, cmds: h.concat(r), mark: null });
// a pasted subtree, adjusted to the level where it lands or not, and what undo takes back
for (const text of ['* A\nbody\n* C\n', '* A\n** A1\nx\n* B\n', 'plain\n* H\n']) for (let pos = 0; pos <= text.length; pos += 1) for (const kill of ['*** T\nt1\nt2\n', '** T\n', '* T\nbody\n', 'plain line\n']) for (const adjusted of [0, 1]) {
  for (const cmds of [['org-yank', 'undo'], ['org-yank', 'undo', 'undo'], ['org-yank', 'undo', 'undo-redo'], ['org-yank', 'forward-char', 'undo']]) cases.push({ text, pos, cmds, mark: null, kill, adjusted });
}
// moving over table fields aligns the table, which undo takes back
for (const text of ['| a | bb |\n| ccc | d |\n', '| a |\n|---|\n| xxxx |\n']) for (let pos = 0; pos <= text.length; pos++) {
  for (const cmds of [['org-backward-sentence', 'undo'], ['org-forward-sentence', 'org-forward-sentence', 'undo'], ['org-forward-sentence', 'org-forward-sentence', 'undo', 'undo-redo'], ['org-backward-sentence', 'org-backward-sentence', 'undo', 'undo']]) cases.push({ text, pos, cmds, mark: null });
}
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
  'upcase-word', 'capitalize-word', 'delete-horizontal-space', 'next-line', 'previous-line', 'undo', 'undo', 'undo', 'self:q', 'self:r', 'self:s',
  'undo-redo', 'undo-redo', 'yank-pop', 'cycle-spacing', 'delete-blank-lines', 'org-forward-sentence', 'org-backward-sentence', 'beginning-of-buffer', 'end-of-buffer'];
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
(dolist (f '(sit-for sleep-for)) (advice-add f :override (lambda (&rest _) t)))
(dolist (f '(read-from-minibuffer completing-read read-string read-key read-event)) (advice-add f :override (lambda (&rest _) (error "minibuffer"))))
(defun run-case (c)
  (let ((text (cdr (assq 'text c))) (pos (cdr (assq 'pos c))) (mark (cdr (assq 'mark c))) (keys (cdr (assq 'keys c))) (err nil))
    (let ((buf (generate-new-buffer "undo-oracle")))
      (switch-to-buffer buf)
      (insert text)
      (org-mode)
      (buffer-enable-undo)
      (setq buffer-undo-list nil)
      (setq kill-ring (list (or (cdr (assq 'kill c)) "KILL")))
      (setq org-yank-adjusted-subtrees (eq 1 (cdr (assq 'adjusted c))))
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
