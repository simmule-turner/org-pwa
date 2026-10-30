#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-capture-refile.json: what Emacs 29.3 does for archiving (org-archive-subtree), the archive tag
 * (org-toggle-archive-tag), org-refile, the targets org-refile-get-targets offers and the place org-capture files at
 * (file+olp targets, every entry type), for the cases of tools/oracle-capture-refile-cases.mjs.
 *   node tools/gen-oracle-capture-refile.mjs   (needs emacs and faketime on the PATH; clock 2026-10-11 16:30 New York)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FILE_CASES, TARGET_CASES, CAPTURE_CASES } from './oracle-capture-refile-cases.mjs';

export const DIR = '/home/me/org';
const el = `
(require 'org) (require 'org-capture) (require 'org-archive) (require 'json) (require 'cl-lib)
(setq org-tags-column 0 make-backup-files nil auto-save-default nil org-refile-use-outline-path t org-refile-use-cache nil)
(defun cr-dir () (file-name-as-directory (file-truename (make-temp-file "crdir" t))))
(defun cr-write (dir name text) (with-temp-file (expand-file-name name dir) (insert text)))
(defun cr-read-all (dir)
  (let (out)
    (dolist (f (directory-files dir nil "^[^.]"))
      (let ((txt (with-temp-buffer (insert-file-contents (expand-file-name f dir)) (buffer-string))))
        (push (cons f (replace-regexp-in-string (regexp-quote (directory-file-name dir)) "${DIR}" txt t t)) out)))
    (nreverse out)))
(defun cr-find (title)
  (goto-char (point-min))
  (re-search-forward (concat "^\\\\*+ \\\\(?:\\\\(?:TODO\\\\|DONE\\\\|NEXT\\\\|COMMENT\\\\) \\\\)?\\\\(?:\\\\[#.\\\\] \\\\)?" (regexp-quote title) "\\\\(?: +:[[:alnum:]_@#%:]+:\\\\)?$"))
  (line-beginning-position))
(defun cr-cleanup () (dolist (b (buffer-list)) (when (buffer-file-name b) (with-current-buffer b (set-buffer-modified-p nil)) (kill-buffer b))))
(defun cr-file-case (c)
  (let* ((dir (cr-dir)) (kind (cdr (assq 'kind c))) (files (cdr (assq 'files c))) (err nil))
    (dolist (f files) (cr-write dir (symbol-name (car f)) (cdr f)))
    (condition-case e
        (let* ((buf (find-file-noselect (expand-file-name "notes.org" dir))))
          (with-current-buffer buf
            (cr-find (cdr (assq 'find c)))
            (cond ((equal kind "archive") (org-archive-subtree))
                  ((equal kind "toggle") (org-toggle-archive-tag))
                  (t (let* ((tf (cdr (assq 'toFile c)))
                            (tbuf (if tf (find-file-noselect (expand-file-name tf dir)) buf))
                            (pos (with-current-buffer tbuf (save-excursion (cr-find (cdr (assq 'to c)))))))
                       (org-refile nil nil (list (cdr (assq 'to c)) (buffer-file-name tbuf) nil pos)))))))
      (error (setq err (error-message-string e))))
    (save-some-buffers t)
    (let ((res (cr-read-all dir))) (cr-cleanup) (list (cons 'files res) (cons 'error err)))))
(defun cr-targets-case (c)
  (let* ((dir (cr-dir)) (files (cdr (assq 'files c))) (err nil) (names nil))
    (dolist (f files) (cr-write dir (symbol-name (car f)) (cdr f)))
    (setq org-agenda-files (mapcar (lambda (f) (expand-file-name (symbol-name (car f)) dir)) files))
    (condition-case e
        (with-current-buffer (find-file-noselect (expand-file-name (cdr (assq 'current c)) dir))
          (setq org-refile-targets
                (mapcar (lambda (s)
                          (let* ((file (cdr (assq 'file s))) (crit (cdr (assq 'criteria s)))
                                 (k (car (car crit))) (v (cdr (car crit)))
                                 (files (cond ((equal file "current") nil) ((equal file "agenda-files") 'org-agenda-files) (t (list (expand-file-name file dir)))))
                                 (key (and k (intern (concat ":" (symbol-name k))))))
                            (if key (cons files (cons key v)) (cons files (cons :maxlevel 1000)))))
                        (cdr (assq 'spec c))))
          (setq names (mapcar (lambda (x) (vector (file-name-nondirectory (nth 1 x)) (nth 0 x))) (org-refile-get-targets))))
      (error (setq err (error-message-string e))))
    (cr-cleanup)
    (list (cons 'names names) (cons 'error err))))
(defun cr-capture-case (c)
  (let* ((f (make-temp-file "cap" nil ".org")) (olp (cdr (assq 'target c))) (o (cdr (assq 'opts c)))
         (kw (append (and (eq (cdr (assq 'prepend o)) t) '(:prepend t))
                     (and (assq 'emptyLines o) (list :empty-lines (cdr (assq 'emptyLines o))))))
         (org-capture-templates (list (append (list "t" "T" (intern (cdr (assq 'type c))) (append (list 'file+olp f) olp) (cdr (assq 'template c))) kw (list :immediate-finish t)))))
    (with-temp-file f (insert (cdr (assq 'init c))))
    (condition-case err
        (progn (org-capture nil "t")
               (with-current-buffer (find-buffer-visiting f)
                 (prog1 (substring-no-properties (buffer-string)) (set-buffer-modified-p nil))))
      (error (concat "ERROR " (error-message-string err))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (json-key-type 'symbol)
         (in (json-read-from-string (buffer-string))) (out nil))
    (dolist (c (cdr (assq 'cases in)))
      (let ((kind (cdr (assq 'kind c))))
        (push (cond ((equal kind "targets") (cr-targets-case c))
                    ((equal kind "capture") (list (cons 'text (cr-capture-case c))))
                    (t (cr-file-case c)))
              out)))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const all = [...FILE_CASES, ...TARGET_CASES, ...CAPTURE_CASES].map((c) => {
  if (c.kind === 'targets') return { ...c, spec: c.spec.map((s) => ({ file: s.file, criteria: Object.fromEntries(Object.entries(s.criteria).map(([k, v]) => [k, v])) })) };
  return c;
});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crorc-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
const started = Date.now();
/** @param {any[]} cases @param {boolean} fake */
function run(cases, fake) {
  const name = fake ? 'in-fake.json' : 'in-real.json';
  fs.writeFileSync(path.join(dir, name), JSON.stringify({ cases }));
  const args = ['--batch', '-Q', '-l', path.join(dir, 'run.el')];
  const [cmd, argv] = fake ? ['faketime', ['-f', '@2026-10-11 16:30:00', 'emacs', ...args]] : ['emacs', args];
  const r = spawnSync(cmd, argv, { env: { ...process.env, TZ: 'America/New_York', ORACLE_IN: path.join(dir, name), ORACLE_OUT: path.join(dir, name + '.out') }, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 1800000 });
  if (r.status !== 0) { console.error(r.stderr.slice(-3000)); process.exit(1); }
  return JSON.parse(fs.readFileSync(path.join(dir, name + '.out'), 'utf8'));
}
// faketime would skew the modification times Emacs compares when it files a capture, so captures run on the real clock (none of them reads it)
const faked = all.filter((c) => c.kind !== 'capture');
const real = all.filter((c) => c.kind === 'capture');
const r1 = run(faked, true);
const r2 = run(real, false);
const withResult = [...faked.map((c, i) => ({ ...c, emacs: r1[i] })), ...real.map((c, i) => ({ ...c, emacs: r2[i] }))];
fs.writeFileSync(new URL('../test/fixtures/oracle-capture-refile.json', import.meta.url), JSON.stringify({ emacs: '29.3', cases: withResult }, null, 1) + '\n');
const errs = withResult.filter((c) => c.emacs.error || (typeof c.emacs.text === 'string' && c.emacs.text.startsWith('ERROR'))).length;
console.log(`${all.length} cases, ${errs} errors, ${Math.round((Date.now() - started) / 1000)}s`);
