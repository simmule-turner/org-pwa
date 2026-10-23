#!/usr/bin/env node
/**
 * Writes test/fixtures/org-export-oracle.json: what real Emacs (ox-org, `org-org-export-as-org`) writes for each text in
 * tools/org-export-cases.json. test/org-export-oracle.test.js holds src/export-org.js (exportOrgText) to it.
 *
 *   node tools/gen-org-export-oracle.mjs        (needs emacs on the PATH)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'org-export-cases.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-oracle-'));
fs.copyFileSync(path.join(root, 'test', 'fixtures', 'html', 'refs.bib'), path.join(dir, 'refs.bib'));
cases.forEach((c, i) => fs.writeFileSync(path.join(dir, `${String(i).padStart(4, '0')}.org`), c + '\n'));
const lisp = `(progn (require 'ox-org) (setq org-export-use-babel nil org-export-with-broken-links t)
 (dolist (f (directory-files "${dir}" t "\\\\.org$")) (with-current-buffer (find-file-noselect f)
  (let ((s (condition-case e (org-export-as 'org nil nil nil nil) (error (format "ERR %S" e))))) (with-temp-file (concat f ".out") (insert s))) (kill-buffer))))`;
execFileSync('emacs', ['-Q', '--batch', '--eval', lisp], { stdio: 'ignore' });
const out = cases.map((c, i) => {
  const text = fs.readFileSync(path.join(dir, `${String(i).padStart(4, '0')}.org.out`), 'utf8');
  // the creation time and the system user's name are not part of the document
  return { org: c, emacs: text.replace(/^# Created .*\n/, '').replace(/^#\+title: *\n/m, '').replace(/^#\+author: root\n?/m, '') };
});
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'org-export-oracle.json'), JSON.stringify(out, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${out.length} cases`);
