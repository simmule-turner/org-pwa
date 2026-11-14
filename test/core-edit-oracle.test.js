// Holds three editing commands to real Emacs: test/fixtures/core-edit-oracle.json was made by tools/gen-core-edit-oracle.mjs, which runs
// org-archive-subtree, org-paste-subtree and org-set-property in Emacs 29.3. Archiving is held to the cookies of the entries it leaves
// (the heading lines that hold one); pasting and setting a property to the text they leave, or the error.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { buildArchivedClone, insertAtArchiveLocation, setProperty } from '../src/archive-model.js';
import { headingAfterSubtree, updateCookiesAfterArchive } from '../src/checkbox-cookie.js';
import { pasteSubtreeAfter, removeHeading } from '../src/heading-edit.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/core-edit-oracle.json', import.meta.url), 'utf8'));
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
const cookieLines = (text) => text.split('\n').filter((l) => /^\*+ .*\[\d*[/%]\d*\]/.test(l));
const trimEnd = (text) => text.replace(/\n+$/, '');

function ours(c) {
  const doc = parseOrg(c.org);
  const h = flat(doc)[c.index];
  if (c.kind === 'archive') {
    const next = headingAfterSubtree(doc, h); // before the subtree goes, as the archive flow does
    const clone = buildArchivedClone(doc, h, '/tmp/core-edit-oracle-buffer.org', { infile: true });
    removeHeading(doc, h);
    insertAtArchiveLocation(doc, clone, '* Archive', { sourceFileId: '/tmp/core-edit-oracle-buffer.org' });
    updateCookiesAfterArchive(doc, next, ['DONE']);
    return cookieLines(serializeOrg(doc)).join('\n');
  }
  if (c.kind === 'paste') {
    pasteSubtreeAfter(doc, h, c.tree, c.level ?? undefined, true); // the oracle's point is at the end of the heading line
    return trimEnd(serializeOrg(doc));
  }
  try {
    setProperty(h, c.name, c.value);
  } catch (e) {
    return `ERROR ${e.message}\n${trimEnd(serializeOrg(doc))}`;
  }
  return trimEnd(serializeOrg(doc));
}

for (const kind of ['archive', 'paste', 'property']) {
  test(`${kind} leaves what Emacs leaves (${oracle.cases.filter((c) => c.kind === kind).length} cases)`, () => {
    const wrong = [];
    for (const c of oracle.cases.filter((x) => x.kind === kind)) {
      const want = kind === 'archive' ? cookieLines(c.emacs).join('\n') : trimEnd(c.emacs);
      const got = ours(c);
      if (got !== want) wrong.push({ org: c.org, index: c.index, level: c.level, name: c.name, got, want });
    }
    assert.deepEqual(wrong.slice(0, 5), []);
  });
}
