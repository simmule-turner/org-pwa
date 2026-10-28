#!/usr/bin/env node
/**
 * Writes test/fixtures/babel-elisp-oracle.json: what real Emacs (ob-emacs-lisp, org-babel-execute-src-block) writes under #+RESULTS:
 * for emacs-lisp blocks with many values and headers.  test/babel-elisp.test.js holds src/babel-elisp.js to it.
 *
 *   node tools/gen-babel-elisp-oracle.mjs        (needs emacs and node on the PATH)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const values = [
  '42', '1.5', '-0.0', '1e21', '(/ 0.0 0.0)', '"hello"', '""', '" lead"', '"a\\nb"', '"a\\n\\nb"', '"*bold*"', '"a:b"', '"say \\"hi\\""', '"back\\\\slash"', '"a|b"',
  'nil', 't', "'sym", "'(1 2 3)", "'((1 2) (3 4))", "'(\"a\" (\"b\"))", "'(1 \"x\" t nil)", "'((\"a|b\" nil))", "'()", "'(())", "'((1 \"a\") (2))",
  "'((\"h1\" \"h2\") (1 2) (3 4))", "'((\"h1\" \"h2\") hline (1 2))", "'(a b c)", "'(a . b)", "[1 2 3]", "'(1 (2 (3 4)))", '(list 1 2.5 "s")', '(+ 1 2)',
  '(mapcar (lambda (x) (* x x)) (number-sequence 1 5))', '(format "%d items" 3)', '(concat "a" "b")', '(upcase "x")',
  '(progn (setq zz 1) (+ zz 1))', '(let ((x 2)) (* x x))', '"line1\\n* heading"', '"#+begin_src x"', "'((\"a\\nb\"))", "'(\"x y\" \" z \")",
  '(princ "out1") (princ "out2") 7', '(message "m") 1', '(print "p") 2', '(princ "only output")', '(princ "a\\n\\nb")', '(princ 1) (princ (list 1 "two"))', '(prin1 "q") nil',
  '(car 5)', '(error "boom %d" 1)', '(/ 1 0)', 'undefined-var', '(undefined-fn)', '(+ 1', '1 2 3', '(defun my-sq (x) (* x x)) (my-sq 7)',
  "'(1 2) (list 3 4)", '(string-to-number "12")', '(number-to-string 5)', "(symbol-name 'abc)", "(intern \"qq\")", ':kw', '?a',
];
const results = [
  '', 'value', 'output', 'table', 'vector', 'list', 'scalar', 'verbatim', 'raw', 'drawer', 'code', 'html', 'latex', 'org', 'pp', 'silent', 'none', 'replace',
  'output raw', 'output list', 'output table', 'output drawer', 'output code', 'value raw', 'value table', 'value list', 'value code', 'value drawer', 'value html', 'value org',
  'table raw', 'list raw', 'drawer raw', 'file', 'link', 'graphics', 'output scalar', 'output verbatim',
];
const extras = ['', ':wrap quote', ':wrap src elisp', ':wrap example', ':wrap export html', ':colnames yes', ':colnames no', ':rownames yes', ':hlines yes', ':colnames nil :rownames yes',
  ':lexical yes', ':lexical no', ':var x=5', ':var x=5 :var y="s"', ":var l='(1 2 3)", ':prologue "(setq pp 1)"', ':epilogue "(setq ee 2)"'];

const cases = [];
for (const code of values) for (const r of results) cases.push({ code, header: r ? `:results ${r}` : '' });
for (const code of values.slice(0, 40)) for (const e of extras.slice(0, 5)) cases.push({ code, header: e });
for (const e of extras.slice(5)) for (const code of ['(list 1 2 3)', "'((1 2) (3 4))", '"s"', 'x', "(if (boundp 'x) (list x) 'none)", '(let ((f (lambda () x))) (funcall f))', "(if (boundp 'y) (list x y) 'none)", "(if (boundp 'l) (apply #'+ l) 'none)", "(list (boundp 'pp) (boundp 'ee))"]) for (const r of ['', ':results table']) cases.push({ code, header: `${r} ${e}`.trim() });
for (const code of ["'(1 2)", '"x"']) for (const r of ['append', 'prepend', 'replace', 'append table', 'prepend list']) cases.push({ code, header: `:results ${r}`, twice: true });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bel-oracle-'));
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
const lisp = `(progn (require 'org) (require 'ob-emacs-lisp) (require 'json)
 (setq org-confirm-babel-evaluate nil)
 (org-babel-do-load-languages 'org-babel-load-languages '((emacs-lisp . t)))
 (let ((cases (json-parse-string (with-temp-buffer (insert-file-contents "${dir}/cases.json") (buffer-string)) :object-type 'alist :array-type 'list)) (out nil))
  (dolist (c cases)
   (let* ((code (alist-get 'code c)) (header (alist-get 'header c)) (twice (alist-get 'twice c)) (res nil))
    (with-temp-buffer (org-mode)
      (insert (format "#+begin_src emacs-lisp %s\\n%s\\n#+end_src\\n" header code))
      (goto-char (point-min))
      (condition-case e
          (progn (org-babel-execute-src-block)
                 (when twice (goto-char (point-min)) (org-babel-execute-src-block))
                 (setq res (buffer-substring-no-properties (point-min) (point-max))))
        (error (setq res (format "ERROR %S" e)))))
    (push res out)))
  (with-temp-file "${dir}/out.json" (insert (json-encode (vconcat (nreverse out)))))))`;
execFileSync('emacs', ['-Q', '--batch', '--eval', lisp], { stdio: 'ignore', timeout: 1_200_000 });
const outs = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const data = cases.map((c, i) => ({ ...c, emacs: outs[i] }));
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'babel-elisp-oracle.json'), '[' + data.map((d) => JSON.stringify(d)).join(',\n') + ']\n');
console.log(`${data.length} cases`);
