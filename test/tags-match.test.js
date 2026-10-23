import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { searchDocumentsByMatchQuery } from '../src/search.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/tags-match-oracle.json', import.meta.url), 'utf8'));
const doc = parseOrg(oracle.org);

for (const { query, emacs } of oracle.cases) {
  test(`match query ${JSON.stringify(query)} selects what Emacs selects`, () => {
    const got = searchDocumentsByMatchQuery([{ documentId: 'fx.org', doc }], query, { doneKeywords: ['DONE'] }).map((r) => r.heading.title.replace(/\s+:[\w:@]+:$/, ''));
    if (emacs.length === 1 && emacs[0] === 'ERR') return; // Emacs signals an error; this app leaves such text unread
    assert.deepEqual(got, emacs);
  });
}
