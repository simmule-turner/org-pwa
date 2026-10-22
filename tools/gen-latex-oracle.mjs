#!/usr/bin/env node
/**
 * Writes test/fixtures/latex/NAME.tex for every test/fixtures/latex/NAME.org: what real Emacs (ox-latex, Org 9.6.15) writes for it.
 * test/export-latex.test.js holds src/export-latex.js to these files, so run this again only when a fixture is added or changed.
 *
 *   node tools/gen-latex-oracle.mjs [name ...]        (needs emacs on the PATH)
 *
 * The "% Created" line is dropped; everything else is Emacs's own output (the unit test ignores the reference hashes).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'latex');
const wanted = process.argv.slice(2);
const names = fs.readdirSync(dir).filter((f) => f.endsWith('.org')).map((f) => f.slice(0, -4)).filter((n) => !wanted.length || wanted.includes(n));
let failed = 0;
for (const name of names) {
  const init = path.join(dir, name + '.el'); // settings for this fixture, as an init file would set them (also given to the app as its LaTeX init text)
  const lisp = `(progn (require 'org) (require 'ox-latex) ${name.startsWith('inline-') ? "(require 'org-inlinetask)" : ''} (setq org-export-with-broken-links nil) ${fs.existsSync(init) ? `(load-file ${JSON.stringify(init)})` : ''} (find-file ${JSON.stringify(path.join(dir, name + '.org'))}) (org-latex-export-to-latex))`;
  const run = spawnSync('emacs', ['-Q', '--batch', '--eval', lisp], { encoding: 'utf8' });
  const out = path.join(dir, name + '.tex');
  if (run.status !== 0 || !fs.existsSync(out)) {
    failed++;
    console.error(`${name}: emacs failed\n${run.stderr.slice(-400)}`);
    continue;
  }
  const text = fs.readFileSync(out, 'utf8').replace(/^% Created .*\n/, '');
  fs.writeFileSync(out, text);
  console.log(`wrote ${name}.tex`);
}
process.exit(failed ? 1 : 0);
