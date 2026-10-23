#!/usr/bin/env node
/**
 * Writes test/fixtures/clocktable-oracle.json: the clocktable block real Emacs (org-update-all-dblocks) writes for each
 * { org, params } in tools/clocktable-cases.json. test/clocktable.test.js holds src/clocktable.js to it.
 *
 *   node tools/gen-clocktable-oracle.mjs        (needs emacs on the PATH)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'clocktable-cases.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clocktable-oracle-'));
cases.forEach((c, i) => fs.writeFileSync(path.join(dir, `${i}.org`), `${c.org}#+BEGIN: clocktable ${c.params}\n#+END:\n`));
const lisp = `(progn (require 'org) (require 'org-clock)
 (dolist (f (directory-files "${dir}" t "\\\\.org$")) (with-current-buffer (find-file-noselect f) (org-update-all-dblocks)
  (let ((s (buffer-string))) (with-temp-file (concat f ".out") (insert s))) (set-buffer-modified-p nil) (kill-buffer))))`;
execFileSync('emacs', ['-Q', '--batch', '--eval', lisp], { stdio: 'ignore' });
const out = cases.map((c, i) => {
  const text = fs.readFileSync(path.join(dir, `${i}.org.out`), 'utf8');
  // the time of the report is not part of the table
  const block = text.slice(text.indexOf('#+BEGIN: clocktable')).trimEnd().replace(/Clock summary at \[[^\]]*\]/, 'Clock summary at [X]');
  return { ...c, emacs: block };
});
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'clocktable-oracle.json'), JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${out.length} cases`);
