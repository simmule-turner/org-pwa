import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { collectIds, recordIds } from '../src/id-locations.js';

const doc = (text) => parseOrg(text);

test('id locations: collects every heading ID in document order', () => {
  const d = doc('* A\n:PROPERTIES:\n:ID: aaa\n:END:\n** B\n:PROPERTIES:\n:ID: bbb\n:END:\n* C\n');
  assert.deepEqual(collectIds(d), ['aaa', 'bbb']);
});

test('id locations: records where each ID is, comparing without case, and reports a change only when there was one', () => {
  const table = {};
  const d = doc('* A\n:PROPERTIES:\n:ID: AbC\n:END:\n');
  assert.equal(recordIds(table, d, 'webdav', 'a.org'), true);
  assert.deepEqual(table, { abc: { scheme: 'webdav', documentId: 'a.org' } });
  assert.equal(recordIds(table, d, 'webdav', 'a.org'), false);
});

test('id locations: an ID that moves to another file is pointed at the new one; one that leaves its file is forgotten', () => {
  const table = {};
  recordIds(table, doc('* A\n:PROPERTIES:\n:ID: x1\n:END:\n* B\n:PROPERTIES:\n:ID: x2\n:END:\n'), 'github', 'one.org');
  recordIds(table, doc('* A\n:PROPERTIES:\n:ID: x1\n:END:\n'), 'github', 'two.org');
  assert.deepEqual(table.x1, { scheme: 'github', documentId: 'two.org' });
  recordIds(table, doc('* only\n'), 'github', 'one.org'); // x2 is gone from one.org
  assert.equal(table.x2, undefined);
  assert.deepEqual(table.x1, { scheme: 'github', documentId: 'two.org' }); // not one.org's to drop
});
