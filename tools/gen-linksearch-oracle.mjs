#!/usr/bin/env node
/**
 * Writes test/fixtures/linksearch-oracle.json: where Emacs (org-link-search) lands for an internal link such as
 * [[*Heading]], [[#custom-id]], [[Fuzzy text]] or [[(coderef)]], reported as the heading that contains the match.
 *   node tools/gen-linksearch-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const doc = `Preamble line with the word zebra and <<top target>>.
* TODO Heading One :tag:
Some body mentioning alpha beta.
<<dedicated>> and <<spaced   out target>>
* [#A] Second Heading [1/2]
:PROPERTIES:
:CUSTOM_ID: cid-1
:END:
#+NAME: tbl1
| a | b |
#+NAME: spaced   name
| c | d |
** Child heading
text with Mixed Case Phrase
#+begin_src js -n
let x = 1; // (ref:one)
#+end_src
* COMMENT Hidden Heading
* Third   heading with   spaces
<<<radio target>>>
see here
* DONE Done thing :a:b:
`;
const queries = [
  '*Heading One', '*heading one', '*TODO Heading One', '*Second Heading', '*Second Heading [1/2]', '*Child heading', '*Third heading with spaces',
  '*Hidden Heading', '*COMMENT Hidden Heading', '*Done thing', '*Nonexistent', '*Heading', '*  Heading   One ',
  '#cid-1', '#CID-1', '#nope',
  'dedicated', 'Dedicated', 'spaced out target', 'top target', 'radio target',
  'tbl1', 'TBL1', 'spaced name', 'spaced   name',
  'Heading One', 'heading one', 'Second Heading', 'Child heading', 'Third heading with spaces', 'Done thing',
  'alpha beta', 'zebra', 'Mixed Case Phrase', 'nonexistent text',
  '(one)', '(two)', '/alpha/',
];
const cases = queries.map((q) => ({ query: q }));
const el = `
(require 'org) (require 'json)
(setq org-link-search-must-match-exact-headline t)
(defun run-case (org q)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (let ((inhibit-message t))
      (org-link-search q)
      (if (org-before-first-heading-p) "(top)" (org-get-heading t t t t)))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (org (cdr (assq 'doc cs))) (out '()))
    (dolist (c (cdr (assq 'cases cs)))
      (push (condition-case e (run-case org (cdr (assq 'query c))) (error (format "ERROR %s" (error-message-string e)))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify({ doc, cases }));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/linksearch-oracle.json', JSON.stringify({ emacs: '29.3', doc, cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }, null, 1) + '\n');
console.log(cases.length, 'cases');
