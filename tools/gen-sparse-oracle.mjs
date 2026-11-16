// Asks Emacs 29.3 (Org 9.6.15) which lines org-occur (and the sparse-tree commands built on it) match, and writes
// test/fixtures/sparse-oracle.json. Run: node tools/gen-sparse-oracle.mjs   (needs emacs on the path)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEXT = `#+TITLE: Sparse
Preamble with a foo and TODO word.
* TODO Write the foo report
DEADLINE: <2026-11-10 Tue>
Body mentioning Foo and foo bar 123.
** WAIT Check x
SCHEDULED: <2026-11-20 Fri>
Some text, deadline words DEADLINE: <2026-11-01 Sun> inside a line.
* DONE Old task :tag:
CLOSED: [2026-10-01 Thu] DEADLINE: <2026-10-02 Fri>
* Plain heading
A paragraph with <2026-11-30 Mon> active and [2026-11-02 Mon] inactive stamps.
** NEXT Later
DEADLINE: <2026-12-25 Fri -3d>
abab and y
* TODO Another
DEADLINE: <2027-01-01 Fri>
`;
const cases = [];
for (const regexp of ['foo', 'Foo', 'TODO', '^\\*+ ', '\\<foo\\>', '[0-9]+', 'x\\|y', '\\(?:ab\\)+', 'FOO'])
  for (const fold of ['t', 'nil', 'smart']) cases.push({ kind: 'regexp', regexp, fold });
for (const kwd of [null, 'TODO|WAIT', 'DONE', 'NEXT']) cases.push({ kind: 'todo', kwd });
for (const warn of [3, 14, 30, 100000]) cases.push({ kind: 'deadline', warn });
for (const type of ['', 'all', 'scheduled', 'deadline', 'active', 'inactive', 'closed'])
  for (const [kind, a, b] of [['before', '2026-11-20', ''], ['after', '2026-11-10', ''], ['between', '2026-11-01', '2026-12-01']]) cases.push({ kind, type, a, b });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparse-'));
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
fs.writeFileSync(path.join(dir, 'doc.org'), TEXT);
const el = `
(require 'org) (require 'json) (require 'cl-lib)
(setq org-todo-keywords '((sequence "TODO" "WAIT" "NEXT" "|" "DONE")))
(defun lines-of-highlights () (sort (mapcar (lambda (o) (line-number-at-pos (overlay-start o))) org-occur-highlights) #'<))
(defun run-case (c)
  (with-temp-buffer
    (insert-file-contents "${path.join(dir, 'doc.org')}")
    (org-mode)
    (cl-letf (((symbol-function 'current-time) (lambda () (encode-time 0 0 0 15 11 2026))))
      (let* ((kind (alist-get 'kind c))
             (org-highlight-sparse-tree-matches t)
             (org-todo-keywords '((sequence "TODO" "WAIT" "NEXT" "|" "DONE"))))
        (org-set-regexps-and-options)
        (cond
         ((equal kind "regexp")
          (let ((org-occur-case-fold-search (intern (alist-get 'fold c))))
            (org-occur (alist-get 'regexp c))))
         ((equal kind "todo")
          (let ((k (let ((v (alist-get 'kwd c))) (and (stringp v) v))))
            (cl-letf (((symbol-function 'completing-read) (lambda (&rest _) k)))
              (if (null k) (org-show-todo-tree nil) (org-show-todo-tree '(4))))))
         ((equal kind "deadline") (org-check-deadlines (alist-get 'warn c)))
         (t (setq org-ts-type (let ((ty (alist-get 'type c))) (if (equal ty "") nil (intern ty))))
            (cond ((equal kind "before") (org-check-before-date (alist-get 'a c)))
                  ((equal kind "after") (org-check-after-date (alist-get 'a c)))
                  (t (org-check-dates-range (alist-get 'a c) (alist-get 'b c))))))
        (vconcat (lines-of-highlights))))))
(let ((cases (json-parse-string (with-temp-buffer (insert-file-contents "${path.join(dir, 'cases.json')}") (buffer-string)) :object-type 'alist :array-type 'list)))
  (princ (json-encode (vconcat (mapcar #'run-case cases)))))
`;
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2500)); process.exit(1); }
const out = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/sparse-oracle.json', import.meta.url), JSON.stringify({ text: TEXT, cases: cases.map((c, i) => ({ ...c, lines: out[i] })) }) + '\n');
console.log(`${cases.length} cases, ${out.filter((l) => l.length).length} with matches`);
