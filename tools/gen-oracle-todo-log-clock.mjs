#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-todo-log-clock.json: what Emacs 29.3 (Org 9.6) does for TODO cycling, logging on a change of state,
 * priorities, clocking in and out, durations, scheduling and clock tables. Cases are in tools/oracle-tlc-cases.mjs;
 * test/oracle-todo-log-clock.test.js holds the app to the results.
 *
 *   node tools/gen-oracle-todo-log-clock.mjs        (needs emacs and faketime on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCases, NOW, TZ } from './oracle-tlc-cases.mjs';

const lispString = (/** @type {string} */ s) => JSON.stringify(s);
const cases = buildCases().map((c) => {
  if (c.kind !== 'clocktable') return c;
  const params = c.params.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const second = c.org2 !== undefined;
  return {
    ...c,
    lisp: `(let* ((d (progn (make-directory "/tmp/ct" t) "/tmp/ct")) (f (expand-file-name "ct.org" d)) (f2 (expand-file-name "other.org" d)) (org-agenda-files ${second ? '(list f f2)' : 'nil'}) (org-agenda-skip-unavailable-files nil)) (with-temp-file f (insert ${lispString(c.org)} "#+BEGIN: clocktable ${params}\\n#+END:\\n")) ${second ? `(with-temp-file f2 (insert ${lispString(c.org2)}))` : ''} (let ((b (find-file-noselect f))) (with-current-buffer b (condition-case e (org-update-all-dblocks) (error (set-buffer-modified-p nil) (kill-buffer b) (signal (car e) (cdr e)))) (let* ((s (buffer-string)) (r (substring s (string-match "#\\\\+BEGIN: clocktable" s)))) (set-buffer-modified-p nil) (kill-buffer b) (dolist (x (buffer-list)) (when (and (buffer-file-name x) (string-prefix-p d (buffer-file-name x))) (with-current-buffer x (set-buffer-modified-p nil)) (kill-buffer x))) (delete-directory d t) r))))`,
    ctOrg: c.org,
    ctOrg2: c.org2,
    org: '',
  };
});

const el = `
(require 'org) (require 'org-clock) (require 'cl-lib) (require 'json)
(setq org-startup-folded nil org-adapt-indentation nil)
(defun oc-reset () (when (markerp org-clock-marker) (set-marker org-clock-marker nil)) (setq org-clock-current-task nil org-clock-start-time 0))
(defun oc-run (c)
  (let ((org (cdr (assq 'org c))) (form (cdr (assq 'lisp c))))
    (with-temp-buffer
      (insert org) (org-mode) (goto-char (point-min))
      (let ((inhibit-message t) (message-log-max nil))
        (condition-case e (cl-letf (((symbol-function 'y-or-n-p) (lambda (&rest _) t)) ((symbol-function 'yes-or-no-p) (lambda (&rest _) t))) (with-timeout (5 "TIMEOUT") (eval (read form) t)))
          (error (concat "ERROR " (error-message-string e))))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (oc-run c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-tlc-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
const groups = new Map();
cases.forEach((c, i) => {
  const now = c.now || NOW;
  if (!groups.has(now)) groups.set(now, []);
  groups.get(now).push(i);
});
const results = new Array(cases.length);
for (const [now, idxs] of groups) {
  // a thinner batch per process keeps one hanging case from stalling everything
  for (let b = 0; b < idxs.length; b += 150) {
    const batch = idxs.slice(b, b + 150);
    fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(batch.map((i) => ({ org: cases[i].org, lisp: cases[i].lisp }))));
    const r = spawnSync('faketime', ['-f', `@${now}`, 'emacs', '--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, TZ, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '', timeout: 600000 });
    if (r.status !== 0) {
      console.error(r.stderr || r.error);
      process.exit(1);
    }
    const got = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
    batch.forEach((ci, k) => (results[ci] = got[k]));
  }
}
const out = cases.map((c, i) => {
  const { lisp: _lisp, ...rest } = c;
  return { ...rest, emacs: results[i] };
});
fs.writeFileSync('test/fixtures/oracle-todo-log-clock.json', JSON.stringify({ emacs: '29.3', tz: TZ, now: NOW, cases: out }, null, 0).replace(/\},\{"kind"/g, '},\n{"kind"') + '\n');
const byKind = {};
for (const c of out) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
console.log(`${out.length} cases written`, byKind);
