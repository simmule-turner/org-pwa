#!/usr/bin/env node
/**
 * Writes test/fixtures/babel-results-oracle.json: what real Emacs (ob-js, org-babel-execute-src-block) writes under #+RESULTS:
 * for JavaScript blocks with many values and :results / :wrap / :colnames / :rownames / :hlines headers.  test/babel-results.test.js
 * holds src/babel.js (formatResult and friends) to it.
 *
 *   node tools/gen-babel-results-oracle.mjs        (needs emacs and node on the PATH)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const values = [
  'return 42', 'return 1.5', 'return -0', 'return 1e21', 'return NaN', "return 'hello'", "return ''", "return ' lead'", "return 'a\\nb'", "return 'a\\n\\nb'",
  "return '*bold*'", "return 'a:b'", "return 'say \"hi\"'", 'return null', 'return true', 'return false', '/* nothing */', 'return undefined',
  'return [1,2,3]', 'return [[1,2],[3,4]]', "return ['a',['b']]", "return [1,'x',true,null]", "return [['a|b',null]]", 'return []', 'return [[]]', "return [[1,'a'],[2]]",
  "return ['x y', ' z ']", "return [['h1','h2'],[1,2],[3,4]]", "return [['h1','h2'],null,[1,2]]", "return [['n','v'],['a',1],['b',2]]",
  'return {k:1}', "return {a:[1,2],b:'x'}", "return [{k:1},{k:2}]", "return 'line1\\n* heading'", "return '#+begin_src x'", "return [['a\\nb']]",
  "console.log('out1'); console.log('out2'); return 7", "console.log('only output')", "console.log('a\\n\\nb')", "console.log(1, 'two', [3])", "console.log([1,2,3]); console.log({a:1})",
  "console.log('x'); return [1,2]",
];
const results = [
  '', 'value', 'output', 'table', 'vector', 'list', 'scalar', 'verbatim', 'raw', 'drawer', 'code', 'html', 'latex', 'org', 'pp', 'silent', 'none', 'replace',
  'output raw', 'output list', 'output table', 'output drawer', 'output code', 'value raw', 'value table', 'value list', 'value code', 'value drawer', 'value html', 'value org',
  'table raw', 'list raw', 'drawer raw', 'file', 'link', 'graphics',
];
const extras = ['', ':wrap quote', ':wrap src js', ':wrap example', ':wrap export html', ':colnames yes', ':colnames no', ':rownames yes', ':hlines yes', ':colnames nil :rownames yes',
  ':post "return result"', ':prologue "var q = 1;"', ':epilogue "var z = 2;"', ':results-extra x'];

const cases = [];
for (const code of values) for (const r of results) cases.push({ code, header: r ? `:results ${r}` : '' });
const tableValues = values.filter((v) => /\[\[|\[\{/.test(v) || /\[1,2,3\]/.test(v));
for (const code of values.slice(0, 30)) for (const e of extras.slice(0, 5)) cases.push({ code, header: e });
for (const code of tableValues) for (const e of extras.slice(5)) for (const r of ['', ':results table']) cases.push({ code, header: `${r} ${e}`.trim() });
// results inserted again over an earlier result
for (const code of ["return [1,2]", "return 'x'"]) for (const r of ['append', 'prepend', 'replace', 'append table', 'prepend list']) cases.push({ code, header: `:results ${r}`, twice: true });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-oracle-'));
fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
const lisp = `(progn (require 'org) (require 'ob-js) (require 'json)
 (setq org-confirm-babel-evaluate nil)
 (org-babel-do-load-languages 'org-babel-load-languages '((js . t)))
 (let ((cases (json-parse-string (with-temp-buffer (insert-file-contents "${dir}/cases.json") (buffer-string)) :object-type 'alist :array-type 'list)) (out nil))
  (dolist (c cases)
   (let* ((code (alist-get 'code c)) (header (alist-get 'header c)) (twice (alist-get 'twice c)) (res nil))
    (with-temp-buffer (org-mode)
      (insert (format "#+begin_src js %s\\n%s\\n#+end_src\\n" header code))
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
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'babel-results-oracle.json'), '[' + data.map((d) => JSON.stringify(d)).join(',\n') + ']\n');
console.log(`${data.length} cases`);
