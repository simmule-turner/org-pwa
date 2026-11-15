// Summary functions of the user's own in column view, held to Emacs 29.3: test/fixtures/columns-types-oracle.json was made by
// tools/gen-columns-types-oracle.mjs (org-columns-summary-types and org-columns-modify-value-for-display-function set, then org-update-dblock).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { updateAllColumnviewBlocks } from '../src/org-columns.js';
import { modifyValueFunction, summaryTypes } from '../src/column-summary-types.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/columns-types-oracle.json', import.meta.url), 'utf8'));

/** @param {{ text: string, types: string, modify: string | null }} c */
function update(c) {
  const doc = parseOrg(c.text);
  try {
    updateAllColumnviewBlocks(doc, { category: '???', now: new Date(2026, 10, 13, 18, 30), summaryTypes: summaryTypes(c.types) ?? undefined, modifyValue: modifyValueFunction(c.modify) ?? undefined });
  } catch (e) {
    return 'ERROR ' + /** @type {Error} */ (e).message;
  }
  return serializeOrg(doc);
}

test('a summary type of the user is run as Emacs runs it', () => {
  const wrong = [];
  oracle.cases.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
    const got = update(c);
    if (got !== c.emacs) wrong.push({ i, types: c.types, got, emacs: c.emacs });
  });
  assert.deepEqual(wrong.slice(0, 3), []);
});
