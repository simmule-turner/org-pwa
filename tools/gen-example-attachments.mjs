#!/usr/bin/env node
/**
 * Writes examples/attachments.org: the folder Emacs 29.3 (org-attach-dir) keeps a heading's files in, and what org-attach-attach
 * and org-attach-delete-all leave in the heading and on disk. test/example-attachments.test.js holds the app to them.
 *   node tools/gen-example-attachments.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = '/home/me/org';
export const SAMPLE = `* Taxes :work:
:PROPERTIES:
:ID: 7a3b9c4e-5d6f-4a8b-9c0d-1e2f3a4b5c6d
:END:
** Form 1040
** Receipts
:PROPERTIES:
:ID: 11223344-5d6f-4a8b-9c0d-1e2f3a4b5c6d
:END:
* Trips
:PROPERTIES:
:DIR: files/trips
:END:
** Packing list
* Ideas
`;
/** Headings whose folder is listed. */
export const FOLDERS = ['Taxes', 'Form 1040', 'Receipts', 'Trips', 'Packing list', 'Ideas'];
/** [heading, files to attach, in order] */
export const ATTACHES = [
  ['Taxes', ['w2.pdf']],
  ['Taxes', ['w2.pdf', 'notes.txt']],
  ['Trips', ['ticket.pdf']],
  ['Taxes', ['my report (final).pdf', 'a?b.txt']],
];

const el = `
(require 'org) (require 'org-attach) (require 'json) (require 'cl-lib)
(defun file-list (dir)
  (let (r) (dolist (f (directory-files-recursively dir "" nil)) (push (file-relative-name f dir) r)) (sort r #'string<)))
(let* ((dir (getenv "AT_DIR")) (cases (json-parse-string (getenv "AT_CASES") :object-type 'alist :array-type 'list))
       (default-directory (file-name-as-directory dir)) (out '()))
  (dolist (c cases)
    (let ((kind (alist-get 'kind c)) (b (find-file-noselect (expand-file-name "notes.org" dir))))
      (with-current-buffer b
        (org-mode) (erase-buffer) (insert-file-contents (expand-file-name "sample.org" dir))
        (goto-char (point-min))
        (re-search-forward (concat "^\\\\*+ " (regexp-quote (alist-get 'heading c))))
        (cond
         ((equal kind "dir")
          (let ((d (org-attach-dir nil t)))
            (push (list (cons 'dir (and d (file-relative-name d dir)))) out)))
         (t
          (dolist (f (alist-get 'files c))
            (let ((src (expand-file-name f (concat dir "/src"))))
              (make-directory (file-name-directory src) t)
              (with-temp-file src (insert "x"))
              (let ((inhibit-message t)) (org-attach-attach src nil 'cp))))
          (let ((inhibit-message t)) (when (equal kind "delete-all") (org-attach-delete-all t)))
          (let ((left (cl-remove-if (lambda (f) (or (string-prefix-p "src/" f) (string-prefix-p ".#" f) (member f '("notes.org" "sample.org" "run.el")))) (file-list dir))))
            (push (list (cons 'text (buffer-substring-no-properties (point-min) (point-max))) (cons 'files (vconcat left))) out))
          (dolist (f (directory-files dir t "^\\\\(data\\\\|files\\\\)$")) (delete-directory f t)))))))
  (with-temp-file (getenv "AT_OUT") (insert (json-encode (vconcat (nreverse out))))))
`;

/** @param {object[]} cases */
export function runCases(cases) {
  const results = [];
  for (const c of cases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-attach-'));
    fs.writeFileSync(path.join(dir, 'sample.org'), SAMPLE);
    fs.writeFileSync(path.join(dir, 'run.el'), el);
    const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, AT_DIR: dir, AT_CASES: JSON.stringify([c]), AT_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
    if (r.status !== 0) throw new Error(r.stderr);
    results.push(JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'))[0]);
  }
  return results;
}

if (process.argv[1] && new URL(import.meta.url).pathname === path.resolve(process.argv[1])) {
  const cases = [
    ...FOLDERS.map((heading) => ({ kind: 'dir', heading })),
    ...ATTACHES.map(([heading, files]) => ({ kind: 'attach', heading, files })),
    { kind: 'delete-all', heading: 'Taxes', files: ['w2.pdf', 'notes.txt'] },
  ];
  const res = runCases(cases);
  const escape = (/** @type {string} */ s) => s.replace(/^(\*|#\+)/gm, ',$1');
  let i = 0;
  /** @type {string} */
  let out = `#+TITLE: Attachments
#+STARTUP: showall

Where a heading keeps its files, and what attaching one writes. The results are what Emacs 29.3 (Org 9.6.15) gave for the outline below, kept in =${DIR}/notes.org=; the app gives the same where the last section does not say otherwise. Choosing files, the camera and recording are the app's own and are not here.

The outline:
#+BEGIN_SRC org
${escape(SAMPLE.trimEnd())}
#+END_SRC

* Where the files go
A heading with an =ID= keeps its files in =data/= with the first two characters of the ID as a folder, and the rest as a folder under it. A =DIR= property names a folder of your choosing, relative to the file. A heading with neither has no folder, and a sub-heading does not use its parent's.

`;
  for (const h of FOLDERS) out += `- =${h}= :: ${res[i++].dir ?? '(none)'}\n`;
  out += `
* Attaching
Attaching a file copies it into the folder and puts the =ATTACH= tag on the heading. The files are listed with their folder; the outline is shown after the last file is attached.

`;
  for (const [h, files] of ATTACHES) {
    const r = res[i++];
    out += `Attach ${files.map((f) => '=' + f + '=').join(' and ')} to =${h}=:\n#+BEGIN_SRC org\n${escape(r.text.split('\n').filter((l) => /^\*+ /.test(l)).join('\n'))}\n#+END_SRC\nFiles:\n${r.files.map((f) => `- ${f}`).join('\n')}\n\n`;
  }
  out += `Attaching a name that is already in the folder stops with "File already exists" and the path, in Emacs and in the app; neither renames or overwrites.

* Deleting
Deleting all the attachments removes the folder and the =ATTACH= tag.

`;
  const del = res[i];
  out += `Attach =w2.pdf= and =notes.txt= to =Taxes=, then delete all:\n#+BEGIN_SRC org\n${escape(del.text.split('\n').filter((l) => /^\*+ /.test(l)).join('\n'))}\n#+END_SRC\nFiles left: ${del.files.length ? del.files.join(', ') : '(none)'}\n\n`;
  out += `* Where the app differs from Emacs
- *Link text*: attaching can add an =[[attachment:name]]= link to the text (Settings → Attachments); Emacs only adds the tag.
`;
  fs.writeFileSync(new URL('../examples/attachments.org', import.meta.url), out.replace(/\n+$/, '\n'));
  console.log('wrote examples/attachments.org');
}
