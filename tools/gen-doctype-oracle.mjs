#!/usr/bin/env node
/**
 * Writes test/fixtures/html-doctype/emacs.json: for each doctype, the parts of the page that #+HTML_DOCTYPE: controls, as real Emacs
 * (ox-html) writes them for sample.org. test/html-doctype.test.js holds src/export-html.js to them.
 *
 *   node tools/gen-doctype-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctypeParts, DOCTYPE_NAMES } from '../test/support/doctype-parts.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'html-doctype');
const sample = fs.readFileSync(path.join(dir, 'sample.org'), 'utf8').replace(/^#\+HTML_DOCTYPE:.*\n/m, '');
const out = {};
for (const name of DOCTYPE_NAMES) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctype-'));
  const file = path.join(tmp, 'sample.org');
  fs.writeFileSync(file, sample);
  const lisp = `(progn (require 'org) (require 'ox-html) (setq org-html-doctype "${name}") (find-file "${file}") (org-html-export-to-html))`;
  const r = spawnSync('emacs', ['-Q', '--batch', '--eval', lisp], { encoding: 'utf8' });
  const html = path.join(tmp, 'sample.html');
  if (r.status !== 0 || !fs.existsSync(html)) {
    console.error(`${name}: emacs failed\n${r.stderr.slice(-400)}`);
    process.exit(1);
  }
  out[name] = doctypeParts(fs.readFileSync(html, 'utf8'));
  fs.rmSync(tmp, { recursive: true, force: true });
}
fs.writeFileSync(path.join(dir, 'emacs.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote emacs.json for ${DOCTYPE_NAMES.length} doctypes`);
