#!/usr/bin/env node
/**
 * Writes test/fixtures/emacs-keymap-oracle.json: the command Emacs 29.3 binds to each key sequence of Emacs mode in an Org buffer
 * (`key-binding`), and what a prefix key sequence is (a keymap). test/emacs-keymap.test.js holds src/emacs-keymap.js to it.
 *
 *   node tools/gen-emacs-keymap-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KEY_SEQUENCES } from '../src/emacs-keymap.js';

const el = `;; -*- lexical-binding: t -*-
(require 'org) (require 'json)
(with-temp-buffer
  (org-mode)
  (let ((out '()))
    (dolist (k (split-string (getenv "KEYS") "\\n" t))
      (let ((b (key-binding (kbd k))))
        (push (vector k (cond ((keymapp b) "keymap") ((symbolp b) (symbol-name b)) (t "other"))) out)))
    (let ((runs '()))
      (dolist (k (split-string (getenv "RUNS") "\n" t))
        (let ((b (generate-new-buffer "k")))
          (switch-to-buffer b) (insert (make-string 100 ?x)) (org-mode)
          (goto-char 51) (setq last-command nil)
          (let ((inhibit-message t) (err nil))
            (condition-case e (execute-kbd-macro (kbd k)) (error (setq err (error-message-string e))))
            (push (vector k (1- (point)) (buffer-size) (or err "")) runs))
          (kill-buffer b)))
      (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vector (vconcat (nreverse out)) (vconcat (nreverse runs)))))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emacs-keymap-oracle-'));
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);
const keys = [...KEY_SEQUENCES, 'C-x', 'ESC', 'C-u', 'C-c', 'M-SPC', 'C-?', 'M-x', 'C-M-_', 'C-x C-s', 'M-%', 'C-s', 'C-r', 'C-l', 'C-v', 'M-v', 'M-q', 'C-q', 'M-^', 'M-m', 'C-x h', 'C-x C-o', 'C-x u', 'M-y', 'C-M-w', 'M-z', 'M-@', 'M-h'];
const runs = ['C-u C-f', 'C-u C-u C-f', 'C-u C-u C-u C-f', 'C-u 5 C-f', 'C-u 1 2 C-f', 'C-u - C-f', 'C-u - 3 C-f', 'C-u - 1 2 C-f', 'M-5 C-f', 'M-- C-f', 'M-- 3 C-f',
  'M-1 2 C-f', 'ESC 5 C-f', 'ESC - 4 C-f', 'C-u 4 C-u C-f', 'C-u C-u 3 C-f', 'C-u 3 C-u C-f', 'C-u 0 C-f', 'C-u 2 0 C-f', 'C-u - - C-f', 'C-u 5 - C-f', 'C-u M-3 C-f', 'C-u C-u - C-f',
  'M-3 M-4 C-f', 'C-u 3 M-4 C-f', 'C-u 3 C-b', 'C-u 3 M-f', 'C-u 3 C-d', 'C-u 3 q', 'C-u q', 'C-u - 2 q', 'C-u 7 C-x C-x C-f', 'ESC f', 'ESC d', 'ESC DEL', 'ESC ESC f', 'C-x C-x C-f'];
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, KEYS: [...new Set(keys)].join('\n'), RUNS: runs.join('\n'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const [out, runOut] = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/emacs-keymap-oracle.json', JSON.stringify({ emacs: '29.3', bindings: out, runs: runOut }, null, 1) + '\n');
console.log(`${out.length} key sequences and ${runOut.length} key runs written`);
