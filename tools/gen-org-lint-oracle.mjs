#!/usr/bin/env node
/**
 * Writes test/fixtures/org-lint-oracle.json: the reports Emacs 29.3's `org-lint` (all checkers) gives for a set of texts: the
 * strings of Org's own test-org-lint.el, tools/org-lint-cases.mjs and the example documents of the app. Each report is
 * [line, trust, warning, checker]. Files the cases name (tools/org-lint-cases.mjs LINT_FILES) are made in the working directory.
 *   node tools/gen-org-lint-oracle.mjs [path/to/test-org-lint.el]   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LINT_CASES, LINT_FILES } from './org-lint-cases.mjs';

const testEl = process.argv[2] || '/tmp/orgsrc/testing/lisp/test-org-lint.el';
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lintcwd-')) + '/';
for (const [name, text] of Object.entries(LINT_FILES)) fs.writeFileSync(cwd + name, text);

const q = (s) => JSON.stringify(s);
const exampleDir = new URL('../examples/', import.meta.url);
const examples = fs.readdirSync(exampleDir).filter((f) => f.endsWith('.org')).map((f) => fs.readFileSync(new URL(f, exampleDir), 'utf8'));
const readme = fs.readFileSync(new URL('../README.org', import.meta.url), 'utf8').split('\n').slice(0, 400).join('\n') + '\n';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-'));
const textsFile = path.join(dir, 'texts.json');
fs.writeFileSync(textsFile, JSON.stringify([...LINT_CASES, ...examples, readme]));
const el = `
(require 'org) (require 'org-lint) (require 'json) (require 'cl-lib)
(require 'oc-basic) (require 'oc-bibtex) (require 'oc-biblatex) (require 'oc-csl) (require 'oc-natbib)
(setq org-id-locations nil org-id-locations-file ${q(dir + '/ids')})
(defun test-strings ()
  (let (strs)
    (with-temp-buffer
      (insert-file-contents ${q(testEl)})
      (goto-char (point-min))
      (condition-case nil
          (while t
            (let ((form (read (current-buffer))))
              (cl-labels ((walk (f)
                            (when (consp f)
                              (if (and (memq (car f) '(org-test-with-temp-text)) (stringp (cadr f)))
                                  (push (cadr f) strs)
                                (while (consp f) (walk (car f)) (setq f (cdr f)))))))
                (walk form))))
        (end-of-file nil)))
    (nreverse strs)))
(defun run (text)
  (condition-case err
      (with-temp-buffer
        (setq default-directory ${q(cwd)})
        (insert text) (org-mode)
        (vconcat
         (mapcar (lambda (e)
                   (let ((v (cadr e)))
                     (vector (string-to-number (aref v 0)) (aref v 1) (aref v 2)
                             (symbol-name (org-lint-checker-name (aref v 3))))))
                 (org-lint))))
    (error (concat "ERROR " (error-message-string err)))))
(let* ((json-array-type 'list)
       (texts (append (test-strings) (json-read-file ${q(textsFile)})))
       out)
  (dolist (tx texts) (push (list (cons 'text tx) (cons 'emacs (run tx))) out))
  (princ (json-encode (vconcat (nreverse out)))))
`;
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = r.stdout.match(/\[\{.*\}\]$/s);
if (!m) { console.error(r.stdout.slice(-2000), r.stderr.slice(-3000)); process.exit(1); }
const cases = JSON.parse(m[0]);
const files = LINT_FILES;
fs.writeFileSync(new URL('../test/fixtures/org-lint-oracle.json', import.meta.url), JSON.stringify({ files, cwd: 'CWD/', cases }, null, 1).split(cwd).join('CWD/') + '\n');
console.log(`${cases.length} cases`);
