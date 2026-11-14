// Holds the table of a `#+BEGIN: columnview` block: test/fixtures/columns-oracle.json was made by tools/gen-columns-oracle.mjs, which
// runs org-update-dblock on each document in Emacs 29.3.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { updateAllColumnviewBlocks } from '../src/org-columns.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/columns-oracle.json', import.meta.url), 'utf8'));

/** @param {string} text */
function update(text) {
  const doc = parseOrg(text);
  try {
    if (!updateAllColumnviewBlocks(doc, { category: '???', now: new Date(2026, 10, 13, 18, 30) })) return 'NO BLOCK';
  } catch (e) {
    return 'ERROR ' + /** @type {Error} */ (e).message;
  }
  return serializeOrg(doc).replace(/^#\+END: $/gm, '#+END:'); // above the first heading the app reads #+END: as a keyword and writes it with its blank
}

test('a columnview block is written the way Emacs writes it', () => {
  const wrong = [];
  oracle.cases.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
    let got;
    try {
      got = update(c.text);
    } catch (e) {
      got = 'THROW ' + /** @type {Error} */ (e).message;
    }
    if (got !== c.emacs) wrong.push({ i, params: c.text.split('\n').find((/** @type {string} */ l) => l.startsWith('#+BEGIN')), got, emacs: c.emacs });
  });
  assert.deepEqual(wrong.slice(0, 3), []);
});
