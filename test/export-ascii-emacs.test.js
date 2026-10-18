import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { exportToAscii } from '../src/export-ascii.js';

// test/fixtures/ascii/NAME[.CHARSET].txt are what Emacs 29.3 (ox-ascii) writes for NAME.org; tools/gen-ascii-oracle.mjs makes them.
const dir = new URL('./fixtures/ascii/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, dir), 'utf8');

/** Finds the heading titled "Chosen" anywhere in the tree (the one the subtree-* fixtures export). */
const findChosen = (nodes) => {
  for (const h of nodes) {
    if (h.title === 'Chosen') return h;
    const inner = findChosen(h.children || []);
    if (inner) return inner;
  }
  return null;
};

const names = fs.readdirSync(dir).filter((f) => f.endsWith('.org') && f !== 'blocks.org').map((f) => f.slice(0, -4));
for (const name of names) {
  for (const [charset, suffix] of [['ascii', ''], ['utf-8', '.utf-8'], ['latin1', '.latin1']]) {
    if (!fs.existsSync(new URL(`${name}${suffix}.txt`, dir))) continue;
    test(`ASCII export of ${name} matches Emacs (${charset})`, () => {
      const doc = parseOrg(read(`${name}.org`));
      const scope = name.startsWith('subtree-') ? findChosen(doc.children) : null;
      assert.equal(exportToAscii(doc, scope, 72, { charset }), read(`${name}${suffix}.txt`));
    });
  }
}
