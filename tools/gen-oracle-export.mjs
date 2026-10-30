#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-export.json: what Emacs 29.3 (Org 9.6) exports for every document of tools/oracle-export-cases.mjs
 * with the ASCII (ascii and utf-8 character sets), HTML, LaTeX and Org back ends.  A Lisp error is kept as "ERROR message".
 * test/oracle-export.test.js holds the exporters to it.
 *   node tools/gen-oracle-export.mjs   (needs emacs on the PATH)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CASES } from './oracle-export-cases.mjs';

const BACKENDS = {
  ascii: "(org-export-as 'ascii nil nil nil '(:ascii-charset ascii))",
  utf8: "(org-export-as 'ascii nil nil nil '(:ascii-charset utf-8))",
  html: "(org-export-as 'html)",
  latex: "(org-export-as 'latex)",
  orgx: "(org-export-as 'org)",
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oexport-'));
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(CASES.map((c) => c.org)));
const el = (name, call) => `
(require 'org) (require 'ox) (require 'ox-ascii) (require 'ox-html) (require 'ox-latex) (require 'ox-org) (require 'json)
(setq org-export-use-babel nil org-export-with-broken-links nil user-full-name "" user-mail-address "" make-backup-files nil
      org-html-validation-link nil org-tags-column 0)
(defun run-case (org i)
  (with-temp-buffer
    (setq buffer-file-name ${JSON.stringify(path.join(dir, 'case.org'))})
    (insert org) (org-mode) (setq buffer-file-name nil)
    (let ((inhibit-message t) (message-log-max nil))
      (condition-case e
          (with-timeout (20 "ERROR TIMEOUT")
            (substring-no-properties ${call}))
        (error (concat "ERROR " (error-message-string e)))))))
(with-temp-buffer
  (insert-file-contents ${JSON.stringify(path.join(dir, 'in.json'))})
  (let* ((cases (json-parse-string (buffer-string) :array-type 'list)) (out '()) (i 0))
    (dolist (c cases) (push (run-case c i) out) (setq i (1+ i)))
    (with-temp-file ${JSON.stringify(path.join(dir, name + '.out.json'))} (insert (json-encode (nreverse out))))))
`;
const runs = Object.entries(BACKENDS).map(([name, call]) => new Promise((resolve, reject) => {
  const file = path.join(dir, name + '.el');
  fs.writeFileSync(file, el(name, call));
  const p = spawn('emacs', ['--batch', '-Q', '-l', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => (code === 0 ? resolve(name) : reject(new Error(`${name}: emacs exited ${code}\n${err.slice(-600)}`))));
}));
await Promise.all(runs);
const out = Object.fromEntries(Object.keys(BACKENDS).map((n) => [n, JSON.parse(fs.readFileSync(path.join(dir, n + '.out.json'), 'utf8'))]));
const version = await new Promise((resolve) => {
  const p = spawn('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let s = '';
  p.stdout.on('data', (d) => { s += d; });
  p.on('close', () => resolve(s.trim()));
});
const cases = CASES.map((c, i) => ({ name: c.name, org: c.org, ...Object.fromEntries(Object.keys(BACKENDS).map((n) => [n, out[n][i]])) }));
fs.writeFileSync(new URL('../test/fixtures/oracle-export.json', import.meta.url), JSON.stringify({ emacs: version, cases }, null, 0).replace(/\},\{/g, '},\n{') + '\n');
const errors = Object.fromEntries(Object.keys(BACKENDS).map((n) => [n, out[n].filter((x) => x.startsWith('ERROR')).length]));
console.log(`wrote ${cases.length} cases from Emacs ${version}; errors per back end ${JSON.stringify(errors)}`);
