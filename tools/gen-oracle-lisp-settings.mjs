#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-lisp-settings.json: what Emacs 29.3 answers for each expression of tool./oracle-lisp-settings-cases.mjs (value or error text,
 * the error object, `princ`/`print` output, `message` lines).
 *
 *   node tools/gen-oracle-lisp-settings.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASES } from './oracle-lisp-settings-cases.mjs';

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
    (list status value errdata out (mapconcat #'identity (nreverse msgs) (string #xE004)))))
(let ((i 0))
  (dolist (c my-cases)
    (let ((r (my-run (car c) (cadr c))))
      (princ (format "%c%d%c%s%c%s%c%s%c%s%c%s%c" #xE002 i #xE001 (nth 0 r) #xE001 (nth 1 r) #xE001 (nth 2 r) #xE001 (nth 3 r) #xE001 (nth 4 r) #xE003)))
    (setq i (1+ i))))
`;
const file = path.join(os.tmpdir(), `oracle-lisp-settings-${process.pid}.el`);
fs.writeFileSync(file, driver);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1e9, env: { ...process.env, LC_ALL: 'C.UTF-8' }, timeout: 300000 });
fs.unlinkSync(file);
if (r.status !== 0) throw new Error(r.stderr);
const results = [];
for (const rec of r.stdout.split('\ue003')) {
  if (!rec.includes('\ue002')) continue;
  const [idx, status, value, errdata, output, messages] = rec.slice(rec.indexOf('\ue002') + 1).split('\ue001');
  const c = CASES[Number(idx)];
  const o = typeof c === 'string' ? { src: c, lexical: true } : c;
  results[Number(idx)] = { src: o.src, lexical: o.lexical, status, value, errdata, output, messages: messages ? messages.split('\ue004') : [] };
}
if (results.length !== CASES.length || results.some((x) => !x)) throw new Error(`got ${results.filter(Boolean).length} of ${CASES.length} results\n${r.stderr.slice(0, 500)}`);
fs.writeFileSync('test/fixtures/oracle-lisp-settings.json', JSON.stringify(results, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${results.length} cases (${results.filter((x) => x.status === 'error').length} errors)`);
