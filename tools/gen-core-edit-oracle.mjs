#!/usr/bin/env node
/**
 * Writes test/fixtures/core-edit-oracle.json: what Emacs 29.3 does for three editing commands, on a few outlines each:
 *  - org-archive-subtree: the statistics cookie of the parent the subtree leaves (the heading lines that hold a cookie are recorded),
 *  - org-paste-subtree on an empty heading, or with a level (the text it leaves),
 *  - org-set-property with names that are not valid (the text, or the error).
 * test/core-edit-oracle.test.js holds src/checkbox-cookie.js (updateCookiesAfterArchive), src/heading-edit.js and src/archive-model.js to it.
 *
 *   node tools/gen-core-edit-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const archive = [
  ['* Top [%]\n** DONE One\n** TODO Two\n', 1],
  ['* Top [%]\n** TODO Two\n', 1],
  ['* Top [/]\n** DONE One\n** DONE Two\n** TODO Three\n', 3],
  ['* Top [/]\n** DONE One\n** DONE Two\n** TODO Three\n', 1],
  ['* Top [/]\n- [X] a\n- [ ] b\n** TODO Two\n', 1],
  ['* Top [%]\n- [X] a\n- [ ] b\n** TODO Two\n', 1],
  ['* Top [/]\n:PROPERTIES:\n:COOKIE_DATA: todo\n:END:\n- [X] a\n** TODO Two\n** DONE Three\n', 1],
  ['* Top [%]\n:PROPERTIES:\n:COOKIE_DATA: recursive\n:END:\n** Mid\n*** DONE a\n*** TODO b\n** TODO c\n', 2],
  ['* Top [/]\n:PROPERTIES:\n:COOKIE_DATA: recursive\n:END:\n** Mid\n*** TODO b\n** DONE c\n', 2],
  ['* Top [%]\n** TODO a\n** plain\n', 1],
  ['* Top\n** TODO a\n', 1],
  ['* Top [0/2] and [50%]\n** DONE a\n** TODO b\n** TODO c\n', 1],
  ['* Top [/]\n** TODO a\n*** DONE a1\n', 2],
  ['* Top [/]\n** TODO a\n*** DONE a1\n*** TODO a2\n', 3],
  ['* A\n* Top [/]\n** DONE a\n** TODO b\n', 3],
  ['* TODO Top [/]\n** DONE a\n', 1],
  ['* Top [/]\n** DONE a\n   - [ ] x\n** TODO b\n', 1],
].map(([org, index]) => ({ kind: 'archive', org, index }));
const paste = [
  ['*** ', '* Text', null, 0],
  ['*** ', '** Text\n*** Sub', null, 0],
  ['* ', '*** Text', null, 0],
  ['* A\n** \n* B\n', '* Text', null, 1],
  ['* A\n* \n', '* Text\nbody', null, 1],
  ['* A\n** \n* B\n', '* T1\n* T2', null, 1],
  ['* H', '* Text', 3, 0],
  ['* H\nbody\n* Z\n', '* Text', 3, 0],
  ['* H\nbody\n* Z\n', '** Text\n*** Sub', 2, 0],
  ['** H\n', '* Text', 1, 0],
  ['* H\nbody\n', '* Text', null, 0],
  ['* H\n* Z\n', '** Text', null, 0],
].map(([org, tree, level, index]) => ({ kind: 'paste', org, tree, level, index }));
const props = [];
for (const name of ['TEST', 'no space', '', 'tab\tname', 'a-b', 'a+', 'x_y', '1', 'é']) {
  for (const org of ['* H\n', '* H\n:PROPERTIES:\n:test: 1\n:END:\n']) props.push({ kind: 'property', org, name, value: 'v', index: 0 });
}
const cases = [...archive, ...paste, ...props];

const el = `;; -*- lexical-binding: t -*-
(require 'org) (require 'org-archive) (require 'cl-lib) (require 'json)
(setq org-archive-subtree-save-file-p nil)
(defun goto-heading (n)
  (goto-char (point-min))
  (dotimes (_ (1+ n)) (re-search-forward "^\\\\*+ ?" nil t))
  (beginning-of-line))
(defun run-case (c)
  (let ((kind (cdr (assq 'kind c))) (org (cdr (assq 'org c))) (index (cdr (assq 'index c))))
    (with-temp-buffer
      (insert org)
      (org-mode)
      (setq buffer-file-name "/tmp/core-edit-oracle-buffer.org")
      (goto-heading index)
      (let ((inhibit-message t) (message-log-max nil) (org-archive-location "::* Archive"))
        (cl-letf (((symbol-function 'y-or-n-p) (lambda (&rest _) t)))
          (condition-case e
              (cond ((string= kind "archive") (org-archive-subtree))
                    ((string= kind "paste")
                     (end-of-line)
                     (let ((level (cdr (assq 'level c))))
                       (org-paste-subtree (and (numberp level) level) (cdr (assq 'tree c)))))
                    ((string= kind "property") (org-set-property (cdr (assq 'name c)) (cdr (assq 'value c)))))
            (user-error (goto-char (point-min)) (insert (format "ERROR %s\\n" (error-message-string e))))
            (error (goto-char (point-min)) (insert (format "ERROR %s\\n" (error-message-string e)))))))
      (set-buffer-modified-p nil)
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (run-case c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-edit-oracle-'));
const elFile = path.join(dir, 'run.el');
fs.writeFileSync(elFile, el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const out = cases.map((c, i) => ({ ...c, emacs: results[i] }));
fs.writeFileSync('test/fixtures/core-edit-oracle.json', JSON.stringify({ emacs: '29.3', cases: out }, null, 1) + '\n');
console.log(`${out.length} cases written`);
