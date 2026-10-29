#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-outline.json: what Emacs 29.3 / Org 9.6 makes of heading lines (level, TODO keyword, priority,
 * title, tags, COMMENT, ARCHIVE) and what its structure commands leave in an outline (promote and demote subtree and heading,
 * move, delete, insert, copy, paste, clone). The cases come from tools/oracle-outline-cases.mjs; test/oracle-outline.test.js
 * holds the app to the answers.
 *   node tools/gen-oracle-outline.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { docs, headingKeywordLines, headingLines, ops, tagColumns, tagDocs, todoSettings } from './oracle-outline-cases.mjs';

const cases = [];
for (const line of headingLines) cases.push({ kind: 'parse', header: '', text: line + '\nbody\n' });
for (const s of todoSettings) for (const line of headingKeywordLines) cases.push({ kind: 'parse', header: s.header, text: s.header + line + '\nbody\n', setting: s.name });
for (const [name, org] of Object.entries(docs)) {
  const n = (org.match(/^\*+ /gm) || []).length;
  for (let i = 0; i < n; i++) for (const op of ops) for (const column of tagDocs.includes(name) ? tagColumns : [0]) cases.push({ kind: 'edit', doc: name, org, index: i, op, column });
}
const el = String.raw`
(require 'org) (require 'org-element) (require 'json) (require 'cl-lib)
(setq org-adapt-indentation nil inhibit-message t)
(defun parse-case (text)
  (with-temp-buffer
    (insert text) (org-mode) (goto-char (point-min))
    (let ((h (org-element-map (org-element-parse-buffer) 'headline #'identity nil t)))
      (if (null h) (list :heading nil)
        (list :heading t
              :level (org-element-property :level h)
              :todo (org-element-property :todo-keyword h)
              :priority (let ((p (org-element-property :priority h))) (and p (if (< p 48) (char-to-string p) (char-to-string p))))
              :title (org-element-property :raw-value h)
              :commented (and (org-element-property :commentedp h) t)
              :archived (and (org-element-property :archivedp h) t)
              :tags (vconcat (org-element-property :tags h)))))))
(defun comp-case (text)
  (with-temp-buffer
    (insert text) (org-mode) (goto-char (point-min))
    (when (re-search-forward "^\\*+ \\|^\\*+$" nil t) (beginning-of-line))
    (if (not (looking-at org-complex-heading-regexp)) (list :heading nil)
      (let ((c (org-heading-components)))
        (list :heading t :level (nth 0 c) :todo (nth 2 c)
              :priority (and (nth 3 c) (char-to-string (nth 3 c)))
              :title (nth 4 c)
              :tags (vconcat (and (nth 5 c) (split-string (nth 5 c) ":" t))))))))
(defun to-obj (pl)
  (let (o) (while pl (push (cons (substring (symbol-name (car pl)) 1) (let ((v (cadr pl))) (if (eq v nil) :json-false (if (eq v t) t v)))) o) (setq pl (cddr pl))) (nreverse o)))
(defun goto-nth-heading (index)
  (goto-char (point-min))
  (dotimes (_ (1+ index)) (re-search-forward "^\\*+ " nil t))
  (beginning-of-line))
(defun edit-case (org index op column)
  (with-temp-buffer
    (insert org) (org-mode) (setq-local org-tags-column column) (goto-char (point-min))
    (goto-nth-heading index)
    (let ((lvl (org-current-level)))
      (cond ((string= op "promote") (org-promote-subtree))
            ((string= op "demote") (org-demote-subtree))
            ((string= op "promote-heading") (org-promote))
            ((string= op "demote-heading") (org-demote))
            ((string= op "up") (org-move-subtree-up))
            ((string= op "down") (org-move-subtree-down))
            ((string= op "delete") (org-cut-subtree))
            ((string= op "insert-after") (end-of-line) (org-insert-heading-respect-content))
            ((string= op "insert-before") (org-insert-heading))
            ((string= op "copy") (org-copy-subtree) (org-paste-subtree)))
      (buffer-string))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (push (condition-case e
                (if (string= (cdr (assq 'kind c)) "parse")
                    (append (to-obj (parse-case (cdr (assq 'text c)))) (list (cons "comp" (to-obj (comp-case (cdr (assq 'text c)))))))
                  (list (cons "text" (edit-case (cdr (assq 'org c)) (cdr (assq 'index c)) (cdr (assq 'op c)) (cdr (assq 'column c))))))
              (error (list (cons "error" (format "%S" e))))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outline-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases.map((c) => (c.org ? { ...c, org: c.org.replace(/\r\n/g, '\n') } : c))));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/oracle-outline.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }, null, 1) + '\n');
console.log(cases.length, 'cases', res.filter((x) => x.error).length, 'errors');
