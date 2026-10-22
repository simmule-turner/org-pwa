import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { exportToBeamer } from '../src/export-latex.js';
import { setInlineTaskLevel } from '../src/inline-tasks.js';

// The .tex files beside each .org are what Emacs 29.3's ox-beamer wrote (tools/gen-beamer-oracle.mjs makes them).
// `normalize` drops what differs on purpose: Org's random label hashes (renumbered by first use), the creator line,
// and the author Emacs invents from the user's name when the file has none.
const dir = new URL('./fixtures/beamer/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, dir), 'utf8');

function normalize(tex) {
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

const names = ['basic', 'p1', 'p2', 'frames', 'levels', 'levels2', 'columns', 'special', 'overlays', 'toc', 'header', 'classarticle', 'vars', 'inline-tasks', 'blanks', 'emphasis'];

for (const name of names) {
  test(`Beamer export matches Emacs: ${name}`, () => {
    setInlineTaskLevel(name.startsWith('inline-') ? 15 : null); // org-inlinetask is loaded for these only
    const doc = parseOrg(read(`${name}.org`));
    const init = fs.existsSync(new URL(`${name}.el`, dir)) ? read(`${name}.el`) : undefined; // the ox-latex and ox-beamer settings Emacs ran with
    const got = normalize(exportToBeamer(doc, null, { defaults: { init } })).split('\n');
    const want = normalize(read(`${name}.tex`)).split('\n');
    const at = got.findIndex((line, i) => line !== want[i]);
    assert.equal(at < 0 && got.length === want.length ? '' : `line ${at < 0 ? got.length : at + 1}: got ${JSON.stringify(got[at])} want ${JSON.stringify(want[at])}`, '');
  });
}

test.after(() => setInlineTaskLevel(null));
