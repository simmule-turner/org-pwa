#!/usr/bin/env node
/**
 * Writes test/fixtures/abbrev-oracle.json: what Emacs (org-link-expand-abbrev) makes of a link target given the #+LINK:
 * abbreviations a file defines.
 *   node tools/gen-abbrev-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const defs = [
  '#+LINK: gh https://github.com/%s',
  '#+LINK: two https://x.org/%s/and/%s',
  '#+LINK: enc https://x.org/q?=%h',
  '#+LINK: both https://x.org/%s?q=%h',
  '#+LINK: plain https://x.org/base/',
  '#+LINK: dup https://first/%s',
  '#+LINK: dup https://second/%s',
  '#+LINK: Case https://case/%s',
  '#+LINK: empty-tag https://t/%s/end',
  '#+LINK: pct https://x.org/100%25/%s',
  '#+LINK: fn https://x.org/%(someFunction)',
];
const targets = [
  'gh:org/repo', 'gh:', 'gh', 'gh::x', 'gh:a:b', 'gh:with space', 'two:one', 'enc:a b&c/d?e', 'enc:café ☕', 'both:x y', 'plain:index.html', 'plain:',
  'dup:z', 'Case:z', 'case:z', 'empty-tag:', 'pct:abc', 'fn:abc', 'unknown:abc', ':abc', 'gh:a::b', 'https://example.org', 'GH:org',
];
const cases = targets.map((t) => ({ target: t }));
const el = `
(require 'org) (require 'json)
(defun run-case (defs target)
  (with-temp-buffer
    (insert defs "\\n* H\\n") (org-mode) (goto-char (point-min))
    (let ((inhibit-message t))
      (org-link-expand-abbrev target))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-object-type 'alist) (json-array-type 'list) (cs (json-read-from-string (buffer-string))) (defs (cdr (assq 'defs cs))) (out '()))
    (dolist (c (cdr (assq 'cases cs)))
      (push (condition-case e (run-case defs (cdr (assq 'target c))) (error (format "ERROR %S" e))) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify({ defs: defs.join('\n'), cases }));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8', input: '' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const res = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
fs.writeFileSync('test/fixtures/abbrev-oracle.json', JSON.stringify({ emacs: '29.3', defs: defs.join('\n'), cases: cases.map((c, i) => ({ ...c, emacs: res[i] })) }, null, 1) + '\n');
console.log(cases.length, 'cases');
