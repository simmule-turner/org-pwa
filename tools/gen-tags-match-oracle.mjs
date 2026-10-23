#!/usr/bin/env node
/**
 * Writes test/fixtures/tags-match-oracle.json: the headings real Emacs (org-map-entries with a match string, the engine of
 * org-make-tags-matcher) selects for each query in tools/match-cases.json.  test/tags-match.test.js holds src/tags-match.js to it.
 *
 *   node tools/gen-tags-match-oracle.mjs        (needs emacs on the PATH)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { org, queries } = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'match-cases.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-oracle-'));
fs.writeFileSync(path.join(dir, 'fx.org'), org);
fs.writeFileSync(path.join(dir, 'qs.json'), JSON.stringify(queries));
const lisp = `(progn (require 'org) (require 'json) (setq org-use-tag-inheritance t)
 (let ((qs (json-read-file "${dir}/qs.json")) (out nil))
  (find-file "${dir}/fx.org") (org-mode)
  (mapc (lambda (q) (push (condition-case e (vconcat (org-map-entries (lambda () (org-get-heading t t t t)) q)) (error (vector (format "ERR")))) out)) qs)
  (with-temp-file "${dir}/out.json" (insert (json-encode (vconcat (nreverse out)))))))`;
execFileSync('emacs', ['-Q', '--batch', '--eval', lisp], { stdio: 'ignore' });
const results = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const out = { org, cases: queries.map((query, i) => ({ query, emacs: results[i].map((/** @type {string} */ t) => t.replace(/\s+:[\w:@]+:$/, '')) })) };
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'tags-match-oracle.json'), JSON.stringify(out).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${out.cases.length} cases`);
