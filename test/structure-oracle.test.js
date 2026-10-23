// Holds heading structure edits to Emacs: test/fixtures/structure-oracle.json was made by tools/gen-structure-oracle.mjs, which
// runs the Org commands on a few outlines in Emacs 29.3. An edit Emacs refuses leaves the text as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { demoteHeading, insertHeadingAfter, moveHeadingDown, moveHeadingUp, promoteHeading, removeHeading } from '../src/heading-edit.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/structure-oracle.json', import.meta.url), 'utf8'));
const flat = (doc) => {
  const out = [];
  (function walk(n) {
    for (const c of n.children || []) {
      out.push(c);
      walk(c);
    }
  })(doc);
  return out;
};
function ours(c) {
  const doc = parseOrg(c.org);
  const h = flat(doc)[c.index];
  const edit = { promote: promoteHeading, demote: demoteHeading, up: moveHeadingUp, down: moveHeadingDown, delete: removeHeading, 'insert-after': insertHeadingAfter }[c.op];
  edit(doc, h);
  return squeezeTags(serializeOrg(doc));
}
// Emacs re-aligns a heading's tags to org-tags-column when its level changes; the app keeps their spacing
const squeezeTags = (t) => t.trimEnd().replace(/^(\*+ .*?\S)[ \t]{2,}(:[^\s:]+(?::[^\s:]+)*:)$/gm, '$1 $2');
const expected = (c) => squeezeTags(c.emacs.startsWith('ERROR') ? c.org : c.emacs);

for (const op of ['promote', 'demote', 'up', 'down', 'delete', 'insert-after']) {
  test(`${op} leaves the text Emacs leaves`, () => {
    const wrong = oracle.cases.filter((c) => c.op === op && ours(c) !== expected(c));
    assert.equal(wrong.length, 0, JSON.stringify(wrong[0]));
  });
}
