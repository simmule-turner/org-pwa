#!/usr/bin/env node
/**
 * Writes test/fixtures/cookie-oracle.json: each org text in tools/cookie-cases.json after real Emacs ran
 * org-update-checkbox-count at every heading and then org-update-parent-todo-statistics for every heading (what
 * org-update-statistics-cookies does with a prefix argument, except that it reads COOKIE_DATA at point-min for all).  test/checkbox-cookie.test.js holds src/checkbox-cookie.js to it.
 *
 *   node tools/gen-cookie-oracle.mjs        (needs emacs on the PATH)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'cookie-cases.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-oracle-'));
cases.forEach((c, i) => fs.writeFileSync(path.join(dir, `${i}.org`), c.org));
const lisp = `(progn (require 'org)
 (dolist (f (directory-files "${dir}" t "\\\\.org$")) (with-current-buffer (find-file-noselect f) (org-mode) (org-with-wide-buffer (goto-char (point-min)) (while (re-search-forward org-heading-regexp nil t) (end-of-line) (org-update-checkbox-count))) (org-map-region (function org-update-parent-todo-statistics) (point-min) (point-max))
  (let ((s (buffer-string))) (with-temp-file (concat f ".out") (insert s))) (set-buffer-modified-p nil) (kill-buffer))))`;
execFileSync('emacs', ['-Q', '--batch', '--eval', lisp], { stdio: 'ignore' });
const out = cases.map((c, i) => ({ ...c, emacs: fs.readFileSync(path.join(dir, `${i}.org.out`), 'utf8') }));
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'cookie-oracle.json'), JSON.stringify(out) .replace(/\},\{/g, '},\n{') + '\n');
console.log(`${out.length} cases`);
