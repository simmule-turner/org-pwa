#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-markup.json: what Emacs 29.3 (Org 9.6) finds in a line of text -- emphasis, code, scripts, LaTeX fragments,
 * links, targets, footnote references -- as a tree of tokens, how it classifies link targets, which lines above a paragraph are affiliated
 * keywords and how #+ATTR_*: options read, where a LaTeX environment ends, and Org's entity table (test/oracle-markup.test.js reads it).
 *   node tools/gen-oracle-markup.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emphasisCases, fixedCases, affiliatedCases, attrCases, linkCases, envCases } from './oracle-markup-cases.mjs';

const lines = [...new Set([...fixedCases, ...emphasisCases.map((c) => c.line)])].filter((l) => !/\\\\\s*$/.test(l) && !/^\*+ /.test(l) && !/\\begin\{/.test(l));
/** Runs `body` (Lisp; `run-case` is applied to each input alist) in Emacs and returns one result per case. */
function ask(prelude, runCase, cases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-'));
  const driver = `
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (condition-case e (run-case c) (error (format "ERROR %S" e))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
  fs.writeFileSync(path.join(dir, 'run.el'), `(require 'org) (require 'org-element) (require 'ox) (require 'org-attach) (require 'json)\n${prelude}\n${runCase}\n${driver}`);
  fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  const nulls = (v) => (v === '__NULL__' ? null : Array.isArray(v) ? v.map(nulls) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, nulls(x)])) : v);
  return nulls(JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8')));
}

// Org's entities: [name, latex, math, html, ascii, latin1, utf8]
const entities = ask('', `(defun run-case (c) (let (out) (dolist (e org-entities) (when (listp e) (push (vector (nth 0 e) (nth 1 e) (if (nth 2 e) t :json-false) (nth 3 e) (nth 4 e) (nth 5 e) (nth 6 e)) out))) (vconcat (nreverse out))))`, [{}])[0];

const entityLines = entities.filter((e) => /^[a-zA-Z0-9]+$/.test(e[0])).flatMap((e) => [`\\${e[0]}{*b*}x`, `\\${e[0]}*b*`, `a\\${e[0]}`]);
lines.push(...entityLines.filter((l) => !lines.includes(l)));
const INLINE_PRELUDE = `
(defun tok (type &rest kv) (append (list (cons 't type)) (cl-loop for (k v) on kv by #'cddr collect (cons k v))))
(defun ser-list (objs str) (vconcat (apply #'append (mapcar (lambda (o) (ser o str)) objs))))
(defun bsub (b e) (buffer-substring-no-properties b e))
(defun raw-of (o str) (bsub (org-element-property :begin o) (- (org-element-property :end o) (or (org-element-property :post-blank o) 0))))
(defun ser (o str)
  (if (stringp o) (list (tok "text" 'v (substring-no-properties o)))
    (let* ((ty (org-element-type o)) (pb (or (org-element-property :post-blank o) 0))
           (cb (org-element-property :contents-begin o)) (ce (org-element-property :contents-end o))
           (tail (if (> pb 0) (list (tok "text" 'v (bsub (- (org-element-property :end o) pb) (org-element-property :end o)))) nil))
           (me (cond
             ((memq ty '(bold italic underline strike-through))
              (tok (if (eq ty 'strike-through) "strike" (symbol-name ty)) 'c (ser-list (org-element-contents o) str)))
             ((memq ty '(code verbatim)) (tok (symbol-name ty) 'v (org-element-property :value o)))
             ((memq ty '(subscript superscript)) (tok (if (eq ty 'subscript) "sub" "sup") 'v (raw-of o str)))
             ((eq ty 'latex-fragment) (tok "latex" 'v (raw-of o str)))
             ((eq ty 'link) (tok "link" 'raw (org-element-property :raw-link o) 'd (if cb (bsub cb ce) "__NULL__")))
             ((memq ty '(target radio-target)) (tok "target" 'v (org-element-property :value o)))
             ((eq ty 'footnote-reference)
              (tok "fn" 'label (or (org-element-property :label o) "__NULL__") 'inline (if (eq (org-element-property :type o) 'inline) t :json-false)
                   'c (if (eq (org-element-property :type o) 'inline) (ser-list (org-element-contents o) str) [])))
             ((eq ty 'citation) (tok "cite" 'v (raw-of o str)))
             (t (tok "text" 'v (raw-of o str))))))
      (cons me tail))))
`;
const INLINE_CASE = `(defun run-case (c)
  (let* ((str (cdr (assq 'line c))) )
    (condition-case e
        (with-temp-buffer
          (org-mode) (insert "#+begin_verse\\n" str "\\n#+end_verse\\n")
          (let* ((v (org-element-map (org-element-parse-buffer) 'verse-block #'identity nil t))
                 (toks (append (ser-list (org-element-contents v) str) nil))
                 (last (car (last toks))))
            (when (and last (equal (cdr (assq 't last)) "text") (equal (cdr (assq 'v last)) "\\n")) (setq toks (butlast toks)))
            (when (and last (equal (cdr (assq 't last)) "text") (string-suffix-p "\\n" (cdr (assq 'v last))) (not (equal (cdr (assq 'v last)) "\\n")))
              (setq toks (append (butlast toks) (list (tok "text" 'v (substring (cdr (assq 'v last)) 0 -1))))))
            (vconcat toks)))
      (error (format "ERROR %S" e)))))
`;
const cases = lines.map((line) => ({ line }));
const inline = ask(INLINE_PRELUDE, INLINE_CASE, cases);

// Emacs parses sub/superscripts whatever org-use-sub-superscripts says; ox.el turns the ones the setting rules out back into text
// (org-export--remove-uninterpreted-data), so only the default is asked and test/oracle-markup.test.js applies the setting the same way.

// Affiliated keywords: how many lines above the first element are affiliated, and what that element is
const affiliated = ask('', `(defun run-case (c)
  (with-temp-buffer (org-mode) (insert (cdr (assq 'text c)) "\\n")
    (let ((el (car (org-element-contents (car (org-element-contents (org-element-parse-buffer)))))))
      (if (null el) (list (cons 'type "none") (cons 'lines 0))
        (list (cons 'type (symbol-name (org-element-type el)))
              (cons 'lines (if (org-element-property :post-affiliated el) (count-lines (org-element-property :begin el) (org-element-property :post-affiliated el)) 0)))))))`, affiliatedCases.map((text) => ({ text })));

// #+ATTR_*: options as org-export-read-attribute reads them
const attrs = ask('', `(defun run-case (c)
  (with-temp-buffer (org-mode) (insert "#+ATTR_X: " (cdr (assq 'text c)) "\\ntext\\n")
    (let* ((el (car (org-element-contents (car (org-element-contents (org-element-parse-buffer))))))
           (pl (org-export-read-attribute :attr_x el)) (out nil))
      (while pl (push (vector (substring (symbol-name (car pl)) 1) (let ((v (cadr pl))) (cond ((null v) "__NULL__") ((stringp v) v) (t (format "%S" v))))) out) (setq pl (cddr pl)))
      (vconcat (nreverse out)))))`, attrCases.map((text) => ({ text })));

// How a link target classifies
const links = ask('', `(defun run-case (c)
  (with-temp-buffer (org-mode) (insert "[[" (cdr (assq 'text c)) "]]\\n")
    (let ((l (org-element-map (org-element-parse-buffer) 'link #'identity nil t)))
      (if (null l) (list (cons 'type "none"))
        (list (cons 'type (org-element-property :type l)) (cons 'path (org-element-property :path l)) (cons 'search (or (org-element-property :search-option l) "__NULL__")))))))`, linkCases.map((text) => ({ text })));

// LaTeX environments: the text of each one in the paragraph structure
const envs = ask('', `(defun run-case (c)
  (with-temp-buffer (org-mode) (insert (cdr (assq 'text c)) "\\n")
    (vconcat (org-element-map (org-element-parse-buffer) 'latex-environment
      (lambda (el) (string-trim-right (buffer-substring-no-properties (org-element-property :begin el) (org-element-property :end el))))))))`, envCases.map((text) => ({ text })));

const out = path.resolve('test/fixtures/oracle-markup.json');
fs.writeFileSync(out, JSON.stringify({
  emacs: '29.3',
  inline: cases.map((c, i) => ({ ...c, emacs: inline[i] })),
  affiliated: affiliatedCases.map((text, i) => ({ text, emacs: affiliated[i] })),
  attrs: attrCases.map((text, i) => ({ text, emacs: attrs[i] })),
  links: linkCases.map((text, i) => ({ text, emacs: links[i] })),
  envs: envCases.map((text, i) => ({ text, emacs: envs[i] })),
  entities,
}) + '\n');
console.log(cases.length, 'inline,', affiliatedCases.length, 'affiliated,', attrCases.length, 'attribute,', linkCases.length, 'link,', envCases.length, 'environment cases,', entities.length, 'entities');
