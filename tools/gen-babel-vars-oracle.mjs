#!/usr/bin/env node
/**
 * Writes test/fixtures/babel-vars-oracle.json: the value real Emacs (ob-js) gives a JavaScript block for `:var x=TABLE` with
 * :colnames, :rownames and :hlines headers, shown as the JSON the block prints.  test/babel-vars.test.js holds src/babel.js to it.
 *
 *   node tools/gen-babel-vars-oracle.mjs        (needs emacs and node on the PATH)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tables = {
  header: '| a | b |\n|---+---|\n| 1 | 2 |\n| 3 | 4 |',
  plain: '| 1 | 2 |\n| 3 | 4 |',
  names: '| name | n |\n|------+---|\n| x | 1.5 |\n| y | -2 |\n| z | 1e3 |',
  midrule: '| 1 | 2 |\n|---+---|\n| 3 | 4 |\n|---+---|\n| 5 | 6 |',
  column: '| h |\n|---|\n| 1 |\n| 2 |',
  mixed: '| a | b | c |\n|---+---+---|\n| 1 | two | 3.0 |\n|   | 0x10 | -  |\n| 007 | 1,5 | a b |',
  single: '| 7 |',
  twoheader: '| a | b |\n| c | d |\n|---+---|\n| 1 | 2 |',
};
const headers = ['', ':colnames yes', ':colnames no', ':colnames nil', ':hlines yes', ':hlines yes :colnames no', ':hlines yes :colnames yes', ':hlines no', ':rownames yes', ':rownames yes :colnames no', ':rownames no',
  ':rownames yes :colnames yes', ':rownames yes :hlines yes', ':rownames yes :hlines yes :colnames no'];
const cases = [];
for (const name of Object.keys(tables)) for (const h of headers) cases.push({ table: name, header: h, ref: '' });
const refs = ['[0]', '[1]', '[-1]', '[1,0]', '[0,1]', '[-1,-1]', '[0:1]', '[1:2,0]', '[*,1]', '[0,*]', '[*]', '[5]', '[1,5]', '[]'];
for (const name of ['plain', 'header', 'mixed', 'midrule']) for (const r of refs) for (const h of ['', ':colnames yes', ':hlines yes :colnames no']) cases.push({ table: name, header: h, ref: r });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-oracle-'));
cases.forEach((c, i) => fs.writeFileSync(path.join(dir, `${i}.org`), `#+NAME: t\n${tables[c.table]}\n\n#+begin_src js :var x=t${c.ref} ${c.header} :results output\nconsole.log(JSON.stringify(x));\n#+end_src\n`));
const lisp = `(progn (require 'org) (require 'ob-js) (setq org-confirm-babel-evaluate nil)
 (org-babel-do-load-languages 'org-babel-load-languages '((js . t)))
 (dolist (f (directory-files "${dir}" t "\\\\.org$"))
  (with-current-buffer (find-file-noselect f) (org-mode)
   (condition-case e (org-babel-execute-buffer) (error (goto-char (point-max)) (insert (format "\\nERROR %S\\n" e))))
   (let ((text (buffer-string))) (with-temp-file (concat f ".out") (insert text))) (set-buffer-modified-p nil) (kill-buffer))))`;
execFileSync('emacs', ['-Q', '--batch', '--eval', lisp], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600_000 });
const out = cases.map((c, i) => {
  const text = fs.readFileSync(path.join(dir, `${i}.org.out`), 'utf8');
  const m = /#\+RESULTS:\n: (.*)\n/.exec(text);
  return { ...c, table: tables[c.table], emacs: m ? m[1] : /ERROR.*/.exec(text)?.[0] ?? text };
});
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'babel-vars-oracle.json'), '[' + out.map((o) => JSON.stringify(o)).join(',\n') + ']\n');
console.log(`${out.length} cases`);
