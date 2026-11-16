#!/usr/bin/env node
/**
 * Writes test/fixtures/emacs-edit-oracle.json: what Emacs 29.3 (org-mode buffer, transient-mark-mode on) does for the editing commands
 * of Emacs mode, run singly at every caret position of a few texts and in short sequences (kill appending, goal column).
 * test/emacs-edit-oracle.test.js holds src/emacs-edit.js to it.
 *
 *   node tools/gen-emacs-edit-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const texts = [
  'foo bar baz',
  'Hello, world. don\'t stop_me x.y a-b\nsecond line here\n\nfourth',
  '  indented  text \t here  \nnext',
  'one\ntwo\nthree',
  '',
  'a',
  'été Ünï 日本語 words',
  'a *bold* b_c d/e f=g ~h~ +i+ j',
  '\nab\n\n',
];
const singles = [
  'forward-char', 'backward-char', 'org-beginning-of-line', 'org-end-of-line', 'forward-word', 'backward-word',
  'beginning-of-buffer', 'end-of-buffer', 'next-line', 'previous-line', 'org-delete-char', 'org-delete-backward-char',
  'kill-word', 'backward-kill-word', 'org-kill-line', 'org-open-line', 'transpose-chars', 'org-transpose-words', 'upcase-word',
  'downcase-word', 'capitalize-word', 'delete-horizontal-space', 'just-one-space', 'back-to-indentation', 'org-yank',
];
const sequences = [
  ['org-kill-line', 'org-kill-line'], ['kill-word', 'kill-word'], ['backward-kill-word', 'backward-kill-word'],
  ['kill-word', 'backward-kill-word'], ['backward-kill-word', 'kill-word'], ['org-kill-line', 'org-yank'], ['kill-word', 'org-yank'],
  ['next-line', 'next-line'], ['next-line', 'previous-line'], ['previous-line', 'next-line', 'next-line'],
  ['org-end-of-line', 'next-line', 'next-line'], ['forward-char', 'next-line'], ['org-kill-line', 'forward-char', 'org-kill-line'],
  ['kill-word', 'forward-char', 'kill-word'], ['org-transpose-words', 'org-transpose-words'], ['capitalize-word', 'capitalize-word'],
];
const cases = [];
for (const text of texts) {
  for (let pos = 0; pos <= text.length; pos++) {
    if (/[\ud800-\udfff]/.test(text[pos] ?? '')) continue;
    for (const cmd of singles) cases.push({ text, pos, cmds: [cmd], kill: cmd === 'org-yank' ? ['ring'] : [] });
    for (const cmds of sequences) cases.push({ text, pos, cmds, kill: [] });
  }
}
// prefix arguments: a number, or 'u' for C-u
const counted = ['forward-char', 'backward-char', 'forward-word', 'backward-word', 'next-line', 'previous-line', 'org-delete-char',
  'org-delete-backward-char', 'kill-word', 'backward-kill-word', 'org-kill-line', 'org-beginning-of-line', 'org-end-of-line', 'upcase-word',
  'downcase-word', 'capitalize-word', 'org-open-line', 'self-insert-command', 'org-yank'];
for (const text of texts.slice(0, 4).concat(texts[7])) {
  for (let pos = 0; pos <= text.length; pos++) {
    for (const cmd of counted) for (const prefix of [-3, -1, 0, 1, 2, 5, 'u']) cases.push({ text, pos, cmds: [cmd], kill: ['ring\nx'], prefix });
  }
}
for (const text of ['foo bar', '* H\nbody\n']) for (let pos = 0; pos <= text.length; pos++) {
  for (const prefix of [-1, 1, 2, 3, 5, 'u']) {
    cases.push({ text, pos, cmds: ['org-yank'], kill: ['aa', 'bb\n', '* T\n'], prefix });
    cases.push({ text, pos, cmds: ['org-yank', 'org-yank'], kill: ['aa', 'bb\n', '* T\n'], prefix });
  }
}
// region commands: every mark and caret pair on two texts
for (const text of ['foo bar\nbaz', 'ab']) {
  for (let pos = 0; pos <= text.length; pos++) {
    for (let mark = 0; mark <= text.length; mark++) {
      for (const cmds of [['kill-region'], ['kill-ring-save'], ['exchange-point-and-mark'], ['kill-ring-save', 'kill-ring-save'], ['kill-region', 'org-yank']]) {
        cases.push({ text, pos, mark, cmds, kill: [] });
      }
    }
  }
}
for (const text of ['foo bar', '']) for (let pos = 0; pos <= text.length; pos++) cases.push({ text, pos, cmds: ['set-mark-command', 'end-of-buffer', 'exchange-point-and-mark'], kill: [] });

const el = `;; -*- lexical-binding: t -*-
(require 'org) (require 'json)
(transient-mark-mode 1)
(setq line-move-visual nil)
(defun run-case (c)
  (let ((text (cdr (assq 'text c))) (pos (cdr (assq 'pos c))) (mark (cdr (assq 'mark c)))
        (cmds (cdr (assq 'cmds c))) (ring (cdr (assq 'kill c))) (prefix (cdr (assq 'prefix c))) (err nil))
    (with-temp-buffer
      (insert text)
      (org-mode)
      (setq kill-ring (copy-sequence ring) kill-ring-yank-pointer kill-ring)
      (goto-char (1+ pos))
      (when mark (set-mark (1+ mark)) (activate-mark))
      (setq last-command nil)
      (dolist (name cmds)
        (unless err
          (let ((cmd (intern name)) (inhibit-message t) (message-log-max nil))
            (setq this-command cmd)
            (condition-case e (let ((current-prefix-arg (cond ((null prefix) nil) ((equal prefix "u") (list 4)) (t prefix))) (last-command-event ?q))
                                (call-interactively cmd))
              (error (setq err (error-message-string e))))
            (setq last-command this-command))))
      (list (cons 'text (buffer-string)) (cons 'pos (1- (point)))
            (cons 'mark (if (mark t) (1- (mark t)) :null))
            (cons 'kill (vconcat kill-ring)) (cons 'error (or err :null))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emacs-edit-oracle-'));
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
fs.writeFileSync('test/fixtures/emacs-edit-oracle.json', JSON.stringify({ emacs: '29.3', cases: out }) + '\n');
console.log(`${out.length} cases written`);
