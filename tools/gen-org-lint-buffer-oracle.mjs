#!/usr/bin/env node
/**
 * Writes test/fixtures/org-lint-buffer-oracle.json: what Emacs 29.3 does in the *Org Lint* buffer (org-lint--report-mode). It holds
 * (1) the names `completing-read` offers for `C-u M-x org-lint` (categories) and `C-u C-u M-x org-lint` (checker names), and the checkers
 * of each category; (2) for texts of tools/org-lint-cases.mjs that give several reports from several checkers, the entries after
 * each step of a sequence of `h` (org-lint--hide-checker), `i` (org-lint--ignore-checker), `S` (tabulated-list-sort, by column
 * number) and `g` (org-lint--refresh-reports); (3) the column named by the text property at each offset of a report row.
 * A step names its report as a number, "last" or "mid" (the middle one).
 *   node tools/gen-org-lint-buffer-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LINT_CASES, LINT_FILES } from './org-lint-cases.mjs';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lintbufcwd-')) + '/';
for (const [name, text] of Object.entries(LINT_FILES)) fs.writeFileSync(cwd + name, text);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lintbuf-'));
const q = (s) => JSON.stringify(s);
const SEQUENCES = [
  [['h', 0]],
  [['h', 'last']],
  [['i', 'mid'], ['g']],
  [['i', 0], ['h', 'last']],
  [['S', 0]],
  [['S', 1]],
  [['S', 2]],
  [['S', 1], ['S', 1]],
  [['S', 2], ['S', 2], ['S', 0]],
  [['S', 1], ['h', 0], ['g']],
  [['i', 0], ['S', 2], ['g'], ['S', 2]],
  [['S', 0], ['S', 0], ['h', 'mid']],
];
fs.writeFileSync(path.join(dir, 'texts.json'), JSON.stringify(LINT_CASES));
fs.writeFileSync(path.join(dir, 'seqs.json'), JSON.stringify(SEQUENCES));
const el = `;;; -*- lexical-binding: t -*-
(require 'org) (require 'org-lint) (require 'json) (require 'cl-lib)
(require 'oc-basic) (require 'oc-bibtex) (require 'oc-biblatex) (require 'oc-csl) (require 'oc-natbib)
(setq org-id-locations nil org-id-locations-file ${q(dir + '/ids')})
(defun snapshot ()
  (list (cons 'entries (vconcat (mapcar (lambda (e) (let ((v (cadr e))) (vector (string-to-number (aref v 0)) (aref v 1) (aref v 2) (symbol-name (org-lint-checker-name (aref v 3)))))) tabulated-list-entries)))
        (cons 'ignored (vconcat (mapcar (lambda (c) (symbol-name (org-lint-checker-name c))) (cl-set-difference org-lint--checkers org-lint--local-checkers))))))
(defun session (text steps)
  (condition-case err
      (with-temp-buffer
        (setq default-directory ${q(cwd)})
        (insert text) (org-mode)
        (let ((source (current-buffer)) (out nil))
          (org-lint--display-reports source org-lint--checkers)
          (with-current-buffer "*Org Lint*"
            (push (snapshot) out)
            (dolist (step steps)
              (let* ((n (length tabulated-list-entries))
                     (arg (cadr step))
                     (i (cond ((equal arg "last") (1- n)) ((equal arg "mid") (/ (1- n) 2)) (t arg)))
                     (kind (car step)))
                (cond
                 ((string= kind "g") (org-lint--refresh-reports))
                 ((string= kind "S") (tabulated-list-sort i))
                 ((> n 0)
                  (goto-char (point-min)) (forward-line i)
                  (if (string= kind "h") (org-lint--hide-checker) (org-lint--ignore-checker)))
                 (t nil))
                (push (snapshot) out)))
            (push (list (cons 'text (buffer-substring-no-properties (point-min) (point-max)))) out))
          (prog1 (nreverse out) (kill-buffer "*Org Lint*"))))
    (error (list (cons 'error (error-message-string err))))))
(defun cols ()
  (with-temp-buffer
    (insert "* A\\n:PROPERTIES:\\n:CUSTOM_ID: x\\n:END:\\n* B\\n:PROPERTIES:\\n:CUSTOM_ID: x\\n:END:\\n") (org-mode)
    (org-lint--display-reports (current-buffer) org-lint--checkers)
    (with-current-buffer "*Org Lint*"
      (goto-char (point-min))
      (let ((n (- (line-end-position) (line-beginning-position))) r)
        (dotimes (i (1+ n)) (push (get-text-property (+ (point) i) 'tabulated-list-column-name) r))
        (list (cons 'length n) (cons 'columns (vconcat (nreverse r))))))))
(let* ((json-array-type 'list)
       (texts (json-read-file ${q(path.join(dir, 'texts.json'))}))
       (seqs (json-read-file ${q(path.join(dir, 'seqs.json'))}))
       (all (mapcar #'org-lint-checker-categories org-lint--checkers))
       (cats (delete-dups (all-completions "" all)))
       out)
  (dolist (tx texts)
    (let ((base (session tx nil)))
      (when (and (< (length out) 300) (not (assq 'error base))
                 (let ((es (append (cdr (assq 'entries (car base))) nil)))
                   (and (>= (length es) 3)
                        (>= (length (delete-dups (mapcar (lambda (e) (aref e 3)) es))) 2))))
        (dolist (s seqs)
          (push (list (cons 'text tx) (cons 'steps (vconcat s)) (cons 'emacs (vconcat (session tx s)))) out)))))
  (princ (json-encode
          (list (cons 'categories (vconcat cats))
                (cons 'checkers (vconcat (mapcar (lambda (c) (symbol-name (org-lint-checker-name c))) org-lint--checkers)))
                (cons 'byCategory (mapcar (lambda (cat) (cons cat (vconcat (mapcar (lambda (c) (symbol-name (org-lint-checker-name c))) (cl-remove-if-not (lambda (c) (assoc-string cat (org-lint-checker-categories c))) org-lint--checkers))))) (append cats '("zzz" "" "quote"))))
                (cons 'row (cols))
                (cons 'cases (vconcat (nreverse out)))))))
`;
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
const m = r.stdout.match(/\{"categories".*\}$/s);
if (!m) { console.error(r.stdout.slice(-2000), r.stderr.slice(-3000)); process.exit(1); }
const data = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/org-lint-buffer-oracle.json', import.meta.url), JSON.stringify({ files: LINT_FILES, ...data }, null, 1).split(cwd).join('CWD/') + '\n');
console.log(`${data.cases.length} cases`);
