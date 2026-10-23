#!/usr/bin/env node
/**
 * Writes test/fixtures/storelink-oracle.json: the link Emacs stores for a heading (org-store-link, which for a heading with an
 * :ID: is [[id:ID][Title]]), for headings with a TODO keyword, priority, tags, cookies, brackets, links and odd spacing.
 *   node tools/gen-storelink-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const heads = [
  'Plain title', 'TODO Task title', 'TODO [#A] Prioritized :work:', 'Title with [1/3] cookie', 'Title [50%]',
  'Brackets [in] title', 'Trailing bracket [x]', '[Leading] bracket', 'Link [[https://example.org][text]] inside', 'Plain [[https://example.org]] link',
  'Spaces   inside    title', 'Title with trailing tags    :a:b:', 'COMMENT Commented', 'Percent 100% done', 'Backslash \\ here',
  'Timestamp <2026-10-11 Sun> in', 'Inactive [2026-10-11 Sun] in', 'Code ~tilde~ and *bold*', 'Quote "double" and \'single\'',
  'Colon: inside', 'Ends with backslash \\', 'Two [a][b] pairs', 'Footnote[fn:1] ref', 'Unicode café ☕',
];
const cases = heads.map((h) => ({ heading: h }));
const el = `
(require 'org) (require 'org-id) (require 'json)
(defun run-case (h)
  (let ((f (make-temp-file "sl" nil ".org")))
    (with-temp-file f (insert "* " h "\n:PROPERTIES:\n:ID: abc-123\n:END:\nbody\n"))
    (with-current-buffer (find-file-noselect f)
      (org-mode) (goto-char (point-min))
      (let ((inhibit-message t) (org-id-link-to-org-use-id t))
        (prog1 (let ((l (org-id-store-link))) (org-link-make-string l (plist-get org-store-link-plist :description))) (set-buffer-modified-p nil) (kill-buffer))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs)
      (setq org-stored-links nil)
      (push (condition-case e (run-case (cdr (assq 'heading c))) (error (format "ERROR %S" e))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/storelink-oracle.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }, null, 1) + '\n');
console.log(cases.length, 'cases');
