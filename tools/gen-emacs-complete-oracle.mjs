import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const sets = [
  ['org-todo', 'org-toggle-checkbox', 'org-table-align', 'org-time-stamp', 'forward-word', 'forward-char', 'backward-char', 'Foo', 'foobar', 'foo'],
  ['abc', 'abd', 'abe'], ['same', 'same'], ['One', 'one', 'ONE'], ['x'], [], ['alpha', 'alphabet', 'alpha beta'],
];
const inputs = ['', 'o', 'org-t', 'org-to', 'org-tod', 'org-todo', 'for', 'forward-', 'ab', 'abc', 'abx', 'F', 'f', 'fo', 'foo', 'one', 'On', 'ONE', 'x', 'xy', 'same', 'alpha', 'alpha ', 'z'];
const cases = [];
for (const c of sets) for (const i of inputs) for (const fold of [false, true]) cases.push({ c, i, fold });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-'));
const el = `(require 'json)
(with-temp-buffer (insert-file-contents (getenv "ORACLE_IN"))
 (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
  (dolist (c cs)
    (let* ((cands (cdr (assq 'c c))) (i (cdr (assq 'i c))) (completion-ignore-case (eq t (cdr (assq 'fold c))))
           (tc (try-completion i cands)) (ac (all-completions i cands)))
      (push (list (cons 'try (cond ((null tc) :json-false) ((eq tc t) t) (t tc))) (cons 'all (vconcat ac))) out)))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))`;
fs.writeFileSync(`${dir}/run.el`, el); fs.writeFileSync(`${dir}/in.json`, JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', `${dir}/run.el`], { env: { ...process.env, ORACLE_IN: `${dir}/in.json`, ORACLE_OUT: `${dir}/out.json` }, encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(`${dir}/out.json`, 'utf8'));
fs.writeFileSync('test/fixtures/emacs-complete-oracle.json', JSON.stringify({ emacs: '29.3', cases: cases.map((c, k) => ({ ...c, emacs: res[k] })) }) + '\n');
console.log(cases.length);
