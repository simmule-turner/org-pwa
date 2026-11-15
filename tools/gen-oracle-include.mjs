#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-include.json: what Emacs 29.3 (Org 9.6) does with #+INCLUDE: keywords, as `org-export-as` with the Org back end
 * leaves the text (or the error it stops with): the corpus is in tools/oracle-include-cases.json, each case a main document and the files it
 * includes. test/oracle-include.test.js holds src/export-include.js to it.
 *   node tools/gen-oracle-include.mjs   (needs emacs on the PATH)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(here, 'oracle-include-cases.json'), 'utf8'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-include-'));
const out = [];
for (const [name, c] of Object.entries(cases)) {
  for (const [file, text] of Object.entries(c.files || {})) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const main = path.join(root, `${name}.org`);
  fs.writeFileSync(main, c.main);
  const lisp = `(progn (require 'org)(require 'ox-org)(find-file ${JSON.stringify(main)})(condition-case e (princ (org-export-as 'org nil nil t)) (error (princ (format "ERROR %s" (error-message-string e))))))`;
  const run = spawnSync('emacs', ['-Q', '--batch', '--eval', lisp], { encoding: 'utf8', timeout: 60000 });
  out.push({ name, files: c.files || {}, main: c.main, want: run.stdout.split(root + '/').join('') });
}
fs.writeFileSync(path.join(here, '..', 'test', 'fixtures', 'oracle-include.json'), JSON.stringify({ emacs: 'Emacs 29.3, Org 9.6.15', cases: out }, null, 1) + '\n');
console.log(`wrote ${out.length} cases`);
