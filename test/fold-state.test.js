
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import {
  buildFoldIndex,
  defaultCollapsed,
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

function docWithArchivedHeading() {
  const text = [
    '* Projects',
    '** DONE Old task :ARCHIVE:',
    ':PROPERTIES:',
    ':ARCHIVE_TIME: [2026-07-01 Wed]',
    ':END:',
    '*** A subtask that would otherwise show',
    '** NRP',
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

// ---- default-collapsed behavior ------------------------------------------

test('defaultCollapsed: everything defaults to collapsed, archived or not', () => {
  const regular = sampleDoc().children[0].children[0]; // "NRP", not archived
  const archived = docWithArchivedHeading().children[0].children[0]; // "Old task", archived
  assert.equal(defaultCollapsed(regular), true);
  assert.equal(defaultCollapsed(archived), true);
});

test('applyFoldState with no overrides collapses every heading, including non-archived ones', () => {
  const doc = docWithArchivedHeading();
  applyFoldState(doc, []);
  assert.equal(doc.children[0].children[0].collapsed, true); // archived heading
  assert.equal(doc.children[0].children[1].collapsed, true); // NRP, not archived — also collapsed now
  assert.equal(doc.children[0].collapsed, true); // top-level "Projects" too
});

test('an explicit override to expand a heading wins over the collapsed default', () => {
  const doc = sampleDoc();
  const index = buildFoldIndex(doc);
  const nrpId = index.find((e) => e.node.title === 'NRP').id;

  applyFoldState(doc, [{ id: nrpId, collapsed: false }]);
  assert.equal(doc.children[0].children[0].collapsed, false); // NRP: explicitly expanded
  assert.equal(doc.children[0].collapsed, true); // Projects: still at the collapsed default
});

// ---- extract/apply round-trip (new override format) ---------------------

test('extractFoldState stores headings explicitly expanded against the collapsed default', () => {
  const doc = sampleDoc();
  const index = buildFoldIndex(doc);
  const shipId = index.find((e) => e.node.title === 'Ship v0.1.0').id;

  applyFoldState(doc, []); // everything starts at default: collapsed
  doc.children[0].children[0].children[0].collapsed = false; // user expands "Ship v0.1.0"

  const extracted = extractFoldState(doc);
  assert.deepEqual(extracted, [{ id: shipId, collapsed: false }]);
});

test('extractFoldState omits a heading sitting at its own (collapsed) default', () => {
  const doc = sampleDoc();
  applyFoldState(doc, []); // everything at default: collapsed
  const extracted = extractFoldState(doc);
  assert.deepEqual(extracted, []); // nothing deviates, nothing to store
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

// ---- persistence ----------------------------------------------------------

test('loadFoldState / saveFoldState round-trip an explicit expand through an adapter', async () => {
  const adapter = createInMemoryAdapter();
  const doc = sampleDoc();
  const index = buildFoldIndex(doc);
  const nrpId = index.find((e) => e.node.title === 'NRP').id;
  applyFoldState(doc, [{ id: nrpId, collapsed: false }]); // NRP explicitly expanded

  await saveFoldState(doc, 'nrp.org', adapter);

  const freshDoc = sampleDoc();
  await loadFoldState(freshDoc, 'nrp.org', adapter);
  const freshIndex = buildFoldIndex(freshDoc);
  assert.equal(freshIndex.find((e) => e.node.title === 'NRP').node.collapsed, false); // preserved
  assert.equal(freshIndex.find((e) => e.node.title === 'Ship v0.1.0').node.collapsed, true); // still default
  assert.equal(freshIndex.find((e) => e.node.title === 'Projects').node.collapsed, true); // still default
});

test('loadFoldState on a brand new document (nothing stored) collapses everything, including non-archived headings', async () => {
  // This is the behavior the "nothing should be expanded by default" request
  // asked for: every heading starts collapsed on first open, not just
  // archived ones (a previous version only defaulted archived headings to
  // collapsed and left everything else expanded).
  const adapter = createInMemoryAdapter();
  const doc = docWithArchivedHeading();
  await loadFoldState(doc, 'never-saved.org', adapter);
  assert.equal(doc.children[0].collapsed, true); // Projects
  assert.equal(doc.children[0].children[0].collapsed, true); // archived
  assert.equal(doc.children[0].children[1].collapsed, true); // NRP, not archived
});

test('loadFoldState fails open (falls back to the collapsed default) on a throwing/corrupt adapter', async () => {
  const badAdapter = { get: async () => ({ key: 'x', value: '{not valid json' }) };
  const doc = docWithArchivedHeading();
  await assert.doesNotReject(loadFoldState(doc, 'whatever.org', badAdapter));
  assert.equal(doc.children[0].children[0].collapsed, true);
  assert.equal(doc.children[0].children[1].collapsed, true);
});
