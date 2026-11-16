// Asks Emacs 29.3 (Org 9.6.15) what promoting and demoting a subtree, and inserting a subheading, do to the stars when
// org-odd-levels-only is t; writes test/fixtures/odd-levels-oracle.json. Run: node tools/gen-odd-levels-oracle.mjs   (needs emacs)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DOCS = [
  ['*', '***', '*****', '***', '*'],
  ['*', '**', '***', '****', '*****', '**', '*'],
  ['***', '*****', '*', '**', '*******', '****'],
  ['*', '***', '**', '*****', '****', '***', '*'],
];
const cases = [];
for (const levels of DOCS) for (let at = 0; at < levels.length; at++) for (const op of ['promote', 'demote', 'subheading']) cases.push({ levels, at, op });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odd-'));
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
const el = `
(require 'org) (require 'json) (require 'cl-lib)
(defun run-case (c)
  (with-temp-buffer
    (org-mode)
    (let ((org-odd-levels-only t) (org-adapt-indentation nil) (org-auto-align-tags nil) (org-allow-promoting-top-level-subtree nil)
          (levels (alist-get 'levels c)) (op (alist-get 'op c)))
      (dolist (s levels) (insert s " h\\n"))
      (goto-char (point-min))
      (forward-line (alist-get 'at c)) (end-of-line)
      (condition-case err
          (progn
            (cond ((equal op "promote") (org-promote-subtree))
                  ((equal op "demote") (org-demote-subtree))
                  (t (org-insert-subheading nil)))
            (vconcat (mapcar (lambda (l) (if (string-match "^\\\\(\\\\*+\\\\) " l) (length (match-string 1 l)) 0)) (split-string (buffer-string) "\\n" t))))
        (error (format "error: %s" (error-message-string err)))))))
(let ((cases (json-parse-string (with-temp-buffer (insert-file-contents "${path.join(dir, 'cases.json')}") (buffer-string)) :object-type 'alist :array-type 'list)))
  (princ (json-encode (vconcat (mapcar #'run-case cases)))))
`;
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2500)); process.exit(1); }
const out = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/odd-levels-oracle.json', import.meta.url), JSON.stringify(cases.map((c, i) => ({ ...c, result: out[i] }))) + '\n');
console.log(`${cases.length} cases, ${out.filter((x) => typeof x === 'string').length} refused`);
