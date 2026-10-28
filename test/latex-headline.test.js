// org-latex-format-headline-function against Emacs 29.3 (test/fixtures/latex-headline.json, from tools/gen-latex-headline-oracle.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { exportToLatex } from '../src/export-latex.js';

const { cases } = JSON.parse(fs.readFileSync(new URL('./fixtures/latex-headline.json', import.meta.url), 'utf8'));
const body = (/** @type {string} */ tex) => tex.slice(tex.indexOf('\\begin{document}') + '\\begin{document}'.length, tex.indexOf('\\end{document}')).replace(/^\s*\n/, '').replace(/\n\s*$/, '\n');
const strip = (/** @type {string} */ s) => s.replace(/^\n+/, '').replace(/sec:org[0-9a-f]+/g, 'sec:X').replace(/\n+$/, '\n');

cases.forEach((c, i) => {
  test(`headline function case ${i}: ${c.org.split('\n')[0].slice(0, 40)}`, () => {
    let got;
    try {
      got = body(exportToLatex(parseOrg(c.org), null, { defaults: { init: c.init } }));
    } catch (e) {
      got = 'ERROR ' + /** @type {Error} */ (e).message;
    }
    if (c.emacs.startsWith('ERROR')) assert.equal(got.replace(/’/g, "'"), c.emacs) // Emacs in a batch locale writes plain quotes;
    else assert.equal(strip(got.replace(/^\s*\\tableofcontents\n?/, '')), strip(c.emacs));
  });
});
