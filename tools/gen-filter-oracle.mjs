#!/usr/bin/env node
/**
 * Writes test/fixtures/filter/expected.json: which rows of test/fixtures/filter/cases.json real Emacs's agenda filter keeps for each
 * tag, category and regexp preset (org-agenda-filter-make-matcher, the same form org-agenda-filter-apply evaluates), alone and
 * combined. test/agenda-variables.test.js holds presetViewFilter + applyViewFilter to it.
 *
 *   node tools/gen-filter-oracle.mjs     (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cases = JSON.parse(fs.readFileSync('test/fixtures/filter/cases.json', 'utf8'));
const el = `
(require 'org-agenda) (require 'json)
(defvar tags) (defvar cat) (defvar txt)
(let* ((cases (json-parse-string (getenv "FILTER_CASES") :object-type 'alist :array-type 'list :null-object nil :false-object nil))
       (rows (alist-get 'rows cases)) (out '()))
  (cl-flet ((keep (forms)
              (let (res (i 0))
                (dolist (r rows)
                  (let ((tags (alist-get 'tags r)) (cat (alist-get 'cat r)) (txt (alist-get 'txt r)))
                    (when (cl-every #'eval forms) (push i res)))
                  (setq i (1+ i)))
                (vconcat (nreverse res))))
            (form (filter type) (and filter (org-agenda-filter-make-matcher filter type))))
    (dolist (type '(tag category regexp))
      (dolist (f (alist-get type cases))
        (push (list (format "%s:%s" type (json-encode f)) (keep (list (form f type)))) out)))
    (dolist (c (alist-get 'combined cases))
      (push (list (format "combined:%s" (json-encode c))
                  (keep (delq nil (list (form (alist-get 'tag c) 'tag) (form (alist-get 'category c) 'category) (form (alist-get 'regexp c) 'regexp))))) out)))
  (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (vconcat (mapcar (lambda (r) (vector (car r) (cadr r))) (nreverse out)))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filter-oracle-'));
const elFile = path.join(dir, 'run.el');
const outFile = path.join(dir, 'out.json');
fs.writeFileSync(elFile, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', elFile], { env: { ...process.env, FILTER_CASES: JSON.stringify(cases), ORACLE_OUT: outFile }, encoding: 'utf8', input: '' });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  process.exit(1);
}
const expected = Object.fromEntries(JSON.parse(fs.readFileSync(outFile, 'utf8')));
fs.writeFileSync('test/fixtures/filter/expected.json', JSON.stringify({ emacs: '29.3', expected }, null, 1) + '\n');
console.log(`${Object.keys(expected).length} filters`);
