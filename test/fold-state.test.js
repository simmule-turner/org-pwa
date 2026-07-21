
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import {
  buildFoldIndex,
  applyFoldState,
  extractFoldState,
  createInMemoryAdapter,
  loadFoldState,
  saveFoldState,
} from '../src/fold-state.js';

function sampleDoc() {
  const text = [
    '* Projects',
    '** NRP',
    '*** TODO Ship v0.1.0',
    '*** DONE Set up test suite',
    '* Reading list',
    ':PROPERTIES:',
    ':ID: reading-list-abc',
    ':END:',
    '- one',
  ].join('\n');
  return parseOrg(text);
}

test('buildFoldIndex assigns a stable positional id to headings without :ID:', () => {
  const doc = sampleDoc();
  const index = buildFoldIndex(doc);
  const ship = index.find((e) => e.node.title === 'Ship v0.1.0');
  assert.ok(ship.id.startsWith('p:'));

  // Re-parsing identical text should produce the same id.
  const doc2 = sampleDoc();
  const index2 = buildFoldIndex(doc2);
  const ship2 = index2.find((e) => e.node.title === 'Ship v0.1.0');
  assert.equal(ship.id, ship2.id);
});

test('buildFoldIndex prefers the :ID: property when present', () => {
  const doc = sampleDoc();
  const index = buildFoldIndex(doc);
  const readingList = index.find((e) => e.node.title === 'Reading list');
  assert.equal(readingList.id, 'id:reading-list-abc');
});

test('duplicate sibling titles get distinct ids via sibling index', () => {
  const text = ['* Notes', '** Draft', '** Draft'].join('\n');
  const doc = parseOrg(text);
  const index = buildFoldIndex(doc);
  const drafts = index.filter((e) => e.node.title === 'Draft');
  assert.equal(drafts.length, 2);
  assert.notEqual(drafts[0].id, drafts[1].id);
});

test('applyFoldState / extractFoldState round-trip: only collapsed headings are stored', () => {
  const doc = sampleDoc();
  const index = buildFoldIndex(doc);
  const shipId = index.find((e) => e.node.title === 'Ship v0.1.0').id;

  applyFoldState(doc, [shipId]);
  assert.equal(index.find((e) => e.node.title === 'Ship v0.1.0').node.collapsed, true);
  assert.equal(index.find((e) => e.node.title === 'NRP').node.collapsed, false);

  const extracted = extractFoldState(doc);
  assert.deepEqual(extracted, [shipId]);
});

test('a heading rename changes its positional id (documented limitation)', () => {
  const doc = sampleDoc();
  const before = buildFoldIndex(doc).find((e) => e.node.title === 'Ship v0.1.0').id;

  const renamed = parseOrg(
    ['* Projects', '** NRP', '*** TODO Ship v0.2.0', '*** DONE Set up test suite'].join('\n')
  );
  const after = buildFoldIndex(renamed).find((e) => e.node.title === 'Ship v0.2.0').id;

  assert.notEqual(before, after);
});

test('loadFoldState / saveFoldState round-trip through an adapter', async () => {
  const adapter = createInMemoryAdapter();
  const doc = sampleDoc();
  const index = buildFoldIndex(doc);
  const nrpId = index.find((e) => e.node.title === 'NRP').id;
  applyFoldState(doc, [nrpId]);

  await saveFoldState(doc, 'nrp.org', adapter);

  const freshDoc = sampleDoc();
  await loadFoldState(freshDoc, 'nrp.org', adapter);
  const freshIndex = buildFoldIndex(freshDoc);
  assert.equal(freshIndex.find((e) => e.node.title === 'NRP').node.collapsed, true);
  assert.equal(freshIndex.find((e) => e.node.title === 'Ship v0.1.0').node.collapsed, false);
});

test('loadFoldState fails open (leaves doc expanded) when the adapter has nothing stored', async () => {
  const adapter = createInMemoryAdapter();
  const doc = sampleDoc();
  await loadFoldState(doc, 'never-saved.org', adapter);
  const index = buildFoldIndex(doc);
  assert.ok(index.every((e) => e.node.collapsed === false));
});

test('loadFoldState fails open on a throwing/corrupt adapter rather than throwing', async () => {
  const badAdapter = { get: async () => ({ key: 'x', value: '{not valid json' }) };
  const doc = sampleDoc();
  await assert.doesNotReject(loadFoldState(doc, 'whatever.org', badAdapter));
});
