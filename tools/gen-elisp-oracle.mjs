#!/usr/bin/env node
/**
 * Writes test/fixtures/elisp.json: what Emacs 29.3 answers for each expression of tools/elisp-cases.mjs (value or error text,
 * the error object, `princ`/`print` output, `message` lines).
 *
 *   node tools/gen-elisp-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASES } from './elisp-cases.mjs';

/** @param {string} s */
const lispString = (s) => JSON.stringify(s);

const driver = `;; -*- lexical-binding: t -*-
(require 'cl-lib) (require 'subr-x) (require 'seq)
(defvar my-cases (list ${CASES.map((c) => {
  const o = typeof c === 'string' ? { src: c, lexical: true } : c;
  return `(list ${lispString(o.src)} ${o.lexical ? 't' : 'nil'})`;
}).join('\n')}))
(defun my-run (src lex)
  (let ((msgs nil) (status "ok") (value "") (errdata "") (out ""))
    (cl-letf (((symbol-function 'message)
               (lambda (f &rest a) (when f (let ((s (apply #'format-message f a))) (push s msgs) s)))))
      (setq out
            (with-output-to-string
             (with-temp-buffer
              (condition-case err
                  (let ((pos 0) (v nil))
                    (while (string-match-p "[^ \\t\\n]" (substring src pos))
                      (let ((r (read-from-string src pos)))
                        (setq v (eval (car r) lex) pos (cdr r))))
                    (setq value (prin1-to-string v)))
                (t (setq status "error" value (error-message-string err) errdata (prin1-to-string err))))))))
    (list status value errdata out (mapconcat #'identity (nreverse msgs) (string 4)))))
(let ((i 0))
  (dolist (c my-cases)
    (let ((r (my-run (car c) (cadr c))))
      (princ (format "%c%d%c%s%c%s%c%s%c%s%c%s%c" 2 i 1 (nth 0 r) 1 (nth 1 r) 1 (nth 2 r) 1 (nth 3 r) 1 (nth 4 r) 3)))
    (setq i (1+ i))))
`;
const file = path.join(os.tmpdir(), `elisp-oracle-${process.pid}.el`);
fs.writeFileSync(file, driver);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1e9, env: { ...process.env, LC_ALL: 'C.UTF-8' }, timeout: 300000 });
fs.unlinkSync(file);
if (r.status !== 0) throw new Error(r.stderr);
const results = [];
for (const rec of r.stdout.split('\x03')) {
  if (!rec.includes('\x02')) continue;
  const [idx, status, value, errdata, output, messages] = rec.slice(rec.indexOf('\x02') + 1).split('\x01');
  const c = CASES[Number(idx)];
  const o = typeof c === 'string' ? { src: c, lexical: true } : c;
  results[Number(idx)] = { src: o.src, lexical: o.lexical, status, value, errdata, output, messages: messages ? messages.split('\x04') : [] };
}
if (results.length !== CASES.length || results.some((x) => !x)) throw new Error(`got ${results.filter(Boolean).length} of ${CASES.length} results\n${r.stderr.slice(0, 500)}`);
fs.writeFileSync('test/fixtures/elisp.json', JSON.stringify(results, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${results.length} cases (${results.filter((x) => x.status === 'error').length} errors)`);
