#!/usr/bin/env node
/**
 * Writes test/fixtures/lisp-init-example.json (what Emacs 29.3 makes of the Lisp in tools/lisp-init-example-cases.mjs) and
 * examples/lisp-init.org from it.
 *   node tools/gen-lisp-init-example.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SECTIONS } from './lisp-init-example-cases.mjs';

const el = `
(require 'org) (require 'ox-latex) (require 'org-capture) (require 'holidays) (require 'json)
(defun run-case (c)
  (let ((errors nil) (shown nil))
    (with-temp-buffer
      (insert (cdr (assq 'init c)))
      (goto-char (point-min))
      (condition-case nil
          (while t
            (let ((form (read (current-buffer))))
              (condition-case e (eval form t) (error (push (error-message-string e) errors)))))
        (end-of-file nil)))
    (dolist (expr (cdr (assq 'show c)))
      (push (condition-case e (prin1-to-string (eval (read expr) t)) (error (concat "ERROR " (error-message-string e)))) shown))
    (list (cons 'shown (nreverse shown)) (cons 'errors (nreverse errors)))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-array-type 'list) (json-object-type 'alist) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liex-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(SECTIONS.map(({ init, show }) => ({ init, show }))));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr);
  process.exit(1);
}
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();
const cases = SECTIONS.map((s, i) => ({ ...s, emacs: { shown: out[i].shown || [], errors: out[i].errors || [] } }));
fs.writeFileSync(new URL('../test/fixtures/lisp-init-example.json', import.meta.url), JSON.stringify({ emacs: version, cases }, null, 1) + '\n');

let text = `#+TITLE: Lisp init
#+STARTUP: showall

Settings → Advanced → *Lisp init* takes Emacs Lisp, run as Emacs runs an init file. Each section below shows the Lisp to type and, under it, what Emacs 29.3 (Org 9.6.15) gives for the expressions listed after it; the app gives the same. A form that fails does not stop the ones after it.

`;
for (const c of cases) {
  text += `* ${c.heading}\n${c.prose}\n\n#+begin_src emacs-lisp\n${c.init}\n#+end_src\n\n`;
  text += `Values:\n#+begin_example\n${c.show.map((e, i) => `${e}\n  => ${c.emacs.shown[i]}`).join('\n')}\n#+end_example\n\n`;
  if (c.emacs.errors.length) text += `Messages:\n#+begin_example\n${c.emacs.errors.join('\n')}\n#+end_example\n\n`;
}
text += `* Reading more from a file
=(load "github:file.el")= reads another file as part of the init, and the Agenda's *Refresh* reads it again. Emacs loads a file of your disk instead.

* Where the app differs from Emacs
The init runs on the app's own interpreter, which has the common functions and the Org read-only functions, not all of Emacs. A function it lacks fails with Emacs's message for a void function. A program that never ends stops with a message.

App only: =(load "github:file.el")= and the settings the app adds (\`org-xx-…\`).
`;
fs.writeFileSync(new URL('../examples/lisp-init.org', import.meta.url), text);
console.log(`wrote ${cases.length} sections from Emacs ${version}`);
