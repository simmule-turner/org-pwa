#!/usr/bin/env node
/**
 * Writes test/fixtures/columns-display-oracle.json: what Emacs 29.3's column view (org-columns) shows and keeps, as test/columns-display-oracle.test.js
 * holds src/org-columns.js to it: the displayed value of each cell and the width of each column; the text after a column is moved, widened,
 * deleted or added (values are not recomputed by a move); the rows around an inline task.
 *   node tools/gen-columns-display-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AB = '* H\n:PROPERTIES:\n:A: 1\n:END:\n** S1\n:PROPERTIES:\n:A: 99\n:END:';
const AB2 = '* H\n:PROPERTIES:\n:A: 1\n:B: 2\n:END:';
const MM = '* H\n** S1\n:PROPERTIES:\n:A: 1\n:END:\n** S1\n:PROPERTIES:\n:A: 2\n:END:';
const cases = [];
const display = (org, fmt, extra = {}) => cases.push({ kind: 'display', org, fmt, ...extra });
display('* Head', '%ITEM');
display('* [[https://orgmode.org][123]]', '%ITEM');
display('* [[https://orgmode.org]] and [[file:a.org][b]]', '%ITEM');
display('* [[https://orgmode.org][A long description]]', '%12ITEM');
display('** Deep :t:\n*** Deeper', '%ITEM %TAGS');
display('* H\n:PROPERTIES:\n:P: 123456\n:END:', '%5P');
display('* H\n:PROPERTIES:\n:P: 12\n:END:', '%P(Title)');
display('* Head', '%ITEM %ITEM(Name)');
display('* H\n*************** Inline task\n:PROPERTIES:\n:A: 2\n:END:\n*************** END\n** Children\n:PROPERTIES:\n:A: 3\n:END:\n', '%ITEM %A{min}', { inline: 15 });
display('* H\n*************** TODO Task\n:PROPERTIES:\n:A: 5\n:END:\nbody\n*************** END\n* Next\n', '%ITEM %A{max}', { inline: 15 });
for (const [org, fmt, op, col] of [
  [AB, '%A %A{max}', 'left', 1],
  [AB2, '%A %B', 'left', 1],
  [AB2, '%A %B', 'right', 0],
  [MM, '%ITEM %A{min} %A{max}', 'left', 2],
  [MM, '%ITEM %A{min} %A{max}', 'right', 1],
  [MM, '%ITEM %A{min} %A{max}', 'widen', 1],
  [MM, '%ITEM %A{min} %A{max}', 'narrow', 2],
  [MM, '%ITEM %A{min} %A{max}', 'delete', 1],
  [AB, '%A %A{max}', 'delete', 0],
]) cases.push({ kind: 'edit', org, fmt, op, col });
for (const [org, fmt, name, col] of [
  ['#+COLUMNS: %ITEM %BAR\n* H', '%ITEM %BAR', 'Foo', 1],
  ['#+columns: %ITEM %BAR\n* H', '%ITEM %BAR', 'Foo', 1],
  ['* H', '%ITEM', 'Foo', 0],
  ['* H', '%ITEM', 'FOO', 0],
  ['* H\n:PROPERTIES:\n:COLUMNS: %ITEM\n:END:', '%ITEM', 'Foo', 0],
]) cases.push({ kind: 'new', org, fmt, name, col });

const el = `
(require 'org) (require 'org-colview) (require 'org-inlinetask) (require 'json)
(defun overlay-rows ()
  (let (rows)
    (dolist (o org-columns-overlays)
      (when (overlay-buffer o)
        (let ((s (overlay-start o)))
          (when (overlay-get o 'org-columns-key) (push (list (save-excursion (goto-char s) (line-number-at-pos)) s (overlay-get o 'org-columns-value) (overlay-get o 'org-columns-value-modified)) rows)))))
    (let ((by (make-hash-table)) out)
      (dolist (r rows) (push (cdr r) (gethash (car r) by)))
      (maphash (lambda (k v) (push (cons k (sort v (lambda (a b) (< (car a) (car b))))) out)) by)
      (mapcar (lambda (row) (vconcat (mapcar (lambda (c) (vector (nth 1 c) (nth 2 c))) (cdr row)))) (sort out (lambda (a b) (< (car a) (car b))))))))
(defun run-case (c)
  (let ((kind (cdr (assq 'kind c))) (org-columns-default-format (cdr (assq 'fmt c))) (org-columns-ellipses "..")
        (org-inlinetask-min-level (or (cdr (assq 'inline c)) 15)))
    (with-temp-buffer
      (insert (cdr (assq 'org c)))
      (org-mode)
      (when (assq 'inline c) (org-element-update-syntax))
      (goto-char (point-min))
      (when (re-search-forward "^\\\\*+ " nil t) (beginning-of-line))
      (org-columns)
      (pcase kind
        ("display" (list (cons 'rows (overlay-rows)) (cons 'widths (vconcat org-columns-current-maxwidths))))
        ("edit" (forward-char (cdr (assq 'col c)))
         (pcase (cdr (assq 'op c))
           ("left" (org-columns-move-left)) ("right" (org-columns-move-right))
           ("widen" (org-columns-widen 1)) ("narrow" (org-columns-narrow 1)) ("delete" (cl-letf (((symbol-function 'y-or-n-p) (lambda (&rest _) t))) (org-columns-delete))))
         (list (cons 'text (substring-no-properties (buffer-string))) (cons 'rows (overlay-rows))))
        ("new" (forward-char (cdr (assq 'col c)))
         (let ((n (cdr (assq 'name c)))) (org-columns-new nil n n nil nil nil))
         (list (cons 'text (substring-no-properties (buffer-string)))))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-array-type 'list) (json-object-type 'alist) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (condition-case e (run-case c) (error (list (cons 'error (error-message-string e))))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coldisplay-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr.slice(-3000));
  process.exit(1);
}
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync(new URL('../test/fixtures/columns-display-oracle.json', import.meta.url), JSON.stringify(cases.map((c, i) => ({ ...c, emacs: out[i] })), null, 1) + '\n');
console.log(`${cases.length} cases`);
