// #+INCLUDE: as Emacs 29.3 expands it (tools/gen-oracle-include.mjs): the text of the document with the files in place, or the error Emacs stops with.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { expandIncludes } from '../src/export-include.js';

const suite = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-include.json', import.meta.url), 'utf8'));
const blank = (/** @type {string} */ s) => s.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, ''); // the Org back end spaces the footnote definitions its own way
const lower = (/** @type {string} */ s) => s.replace(/#\+(begin|end)_(\w+)/gi, (_m, a, b) => `#+${a.toLowerCase()}_${b.toLowerCase()}`);

for (const c of suite.cases) {
  test(`#+INCLUDE ${c.name} gives what Emacs gives`, async () => {
    let got;
    try {
      const fetch = async (/** @type {string} */ p) => {
        if (!(p in c.files)) throw new Error('missing');
        return { content: c.files[p] };
      };
      got = serializeOrg(await expandIncludes(parseOrg(c.main), fetch, parseOrg));
    } catch (err) {
      got = 'ERROR ' + /** @type {Error} */ (err).message;
    }
    assert.equal(blank(lower(got)), blank(lower(c.want)));
  });
}
