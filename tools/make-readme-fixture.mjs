#!/usr/bin/env node
// Refreshes test/fixtures/latex/readme.org from README.org, the largest real document the LaTeX exporter is checked on.
// Run tools/gen-latex-oracle.mjs readme afterwards to have Emacs write the expected readme.tex.
// Two things in README.org are valid in this app but read differently by Emacs, so the copy adjusts them:
//   - a line starting with * inside an example or source block is escaped as ,* (Emacs ends the block at a headline);
//   - the sample `term :: description` inside ~code~ would be a description-list tag in Emacs, so the copy writes `term \:: description`.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
let inBlock = false;
const lines = fs.readFileSync(root + 'README.org', 'utf8').split('\n').map((line) => {
  if (/^[ \t]*#\+begin_(example|src)\b/i.test(line)) inBlock = true;
  else if (/^[ \t]*#\+end_(example|src)\b/i.test(line)) inBlock = false;
  else if (inBlock && /^\*/.test(line)) return ',' + line;
  return line;
});
fs.writeFileSync(root + 'test/fixtures/latex/readme.org', lines.join('\n').replace('~term :: description~', '~term \\:: description~'));
console.log('wrote test/fixtures/latex/readme.org');
