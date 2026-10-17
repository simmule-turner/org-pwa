import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { exportToLatex } from '../src/export-latex.js';

// The .tex files beside each .org are what Emacs 29.3's ox-latex wrote (tools/gen-latex-oracle.mjs makes them).
// `normalize` drops what differs on purpose: Org's random label hashes (renumbered by first use), the creator line,
// and the author Emacs invents from the user's name when the file has none.
const dir = new URL('./fixtures/latex/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, dir), 'utf8');

export function normalize(tex) {
  const ids = new Map();
  return tex
    .replace(/org[0-9a-f]{7}/g, (id) => {
      if (!ids.has(id)) ids.set(id, 'org' + String(ids.size + 1).padStart(3, '0'));
      return ids.get(id);
    })
    .replace(/^% Created .*\n/m, '')
    .replace(/ pdfcreator=\{[^}]*\}, ?\n/, ' pdfcreator={X},\n')
    .replace(/\\author\{root\}/, '\\author{}')
    .replace(/pdfauthor=\{root\}/, 'pdfauthor={}');
}

// readme.org is README.org itself (tools/make-readme-fixture.mjs refreshes it); the other fixtures are small and each aims at one feature.
// Covered by the first release; the rest of the fixtures (images, entities, citations ...) wait for the next one.
const covered = ['fixed', 'texttt', 'readme', 'headings', 'options-nonum', 'options-nonum-toc', 'options-toc2', 'inline', 'lists', 'tables', 'tables2', 'blocks', 'planning', 'math', 'specials', 'headers', 'noexport', 'latex-env', 'timestamps', 'notitle', 'footnotes-basic', 'links'];

for (const name of covered) {
  test(`LaTeX export matches Emacs: ${name}`, () => {
    const doc = parseOrg(read(`${name}.org`));
    const got = normalize(exportToLatex(doc)).split('\n');
    const want = normalize(read(`${name}.tex`)).split('\n');
    const at = got.findIndex((line, i) => line !== want[i]);
    assert.equal(at < 0 && got.length === want.length ? '' : `line ${at < 0 ? got.length : at + 1}: got ${JSON.stringify(got[at])} want ${JSON.stringify(want[at])}`, '');
  });
}

test('LaTeX export is the same every time', () => {
  const doc = parseOrg(read('headings.org'));
  assert.equal(exportToLatex(doc), exportToLatex(doc));
});
