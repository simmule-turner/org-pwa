// Asks Emacs 29.3 (Org 9.6.15) which tags a state change gives a heading under org-todo-state-tags-triggers, and writes
// test/fixtures/todo-triggers-oracle.json. Run: node tools/gen-todo-triggers-oracle.mjs   (needs emacs on the path)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TRIGGERS = [
  '(("WAIT" ("WAIT" . t)))',
  '(("WAIT" ("WAIT" . t) ("next")) ("DONE" ("WAIT") ("next") ("ARCHIVE" . t)))',
  '((done ("flag" . t)) (todo ("flag")) ("" ("none" . t)))',
  '(("TODO" ("a" . t) ("b" . t) ("c" . t)) ("NEXT" ("b" . nil)))',
  '((todo ("x" . t)) ("DONE" ("x")))',
];
const TAG_SETS = [[], ['a'], ['WAIT', 'next'], ['b', 'x', 'flag'], ['ARCHIVE', 'z']];
const STATES = ['TODO', 'WAIT', 'NEXT', 'DONE', 'CANCELED', ''];
/** @type {object[]} */
const cases = [];
for (const triggers of TRIGGERS) for (const tags of TAG_SETS) for (const from of ['TODO', 'DONE']) for (const to of STATES) cases.push({ triggers, tags, from, to });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trig-'));
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
const el = `
(require 'org) (require 'json) (require 'cl-lib)
(defun run-case (c)
  (with-temp-buffer
    (org-mode)
    (let* ((org-todo-keywords '((sequence "TODO" "WAIT" "NEXT" "|" "DONE" "CANCELED")))
           (org-todo-state-tags-triggers (car (read-from-string (alist-get 'triggers c))))
           (org-log-done nil) (org-tags-column 0) (org-use-tag-inheritance nil)
           (tags (alist-get 'tags c)))
      (setq-local org-todo-keywords org-todo-keywords)
      (org-set-regexps-and-options)
      (insert (format "* %s item%s\\n" (alist-get 'from c) (if tags (concat " :" (mapconcat #'identity tags ":") ":") "")))
      (goto-char (point-min))
      (org-todo (if (equal (alist-get 'to c) "") 'none (alist-get 'to c)))
      (string-trim-right (buffer-string)))))
(let ((cases (json-parse-string (with-temp-buffer (insert-file-contents "${path.join(dir, 'cases.json')}") (buffer-string)) :object-type 'alist :array-type 'list)))
  (princ (json-encode (vconcat (mapcar #'run-case cases)))))
`;
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2500)); process.exit(1); }
const out = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/todo-triggers-oracle.json', import.meta.url), JSON.stringify(cases.map((c, i) => ({ ...c, result: out[i] }))) + '\n');
console.log(`${cases.length} cases`);
