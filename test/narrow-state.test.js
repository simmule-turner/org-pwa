
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryAdapter } from '../src/kv-adapter.js';
import { saveNarrowState, loadNarrowState, saveSparseNarrowState, loadSparseNarrowState, outlineKeyForHeading, findHeadingByOutlineKey } from '../src/narrow-state.js';
import { parseOrg } from '../src/org-parser.js';

test('saveNarrowState then loadNarrowState returns the same outline path', async () => {
  const adapter = createInMemoryAdapter();
  await saveNarrowState(adapter, 'notes.org', ['Project Plan', 'Phase One']);
  const path = await loadNarrowState(adapter, 'notes.org');
  assert.deepEqual(path, ['Project Plan', 'Phase One']);
});

test('loadNarrowState returns null when a document was never narrowed', async () => {
  const adapter = createInMemoryAdapter();
  assert.equal(await loadNarrowState(adapter, 'never-narrowed.org'), null);
});

test('saveNarrowState with a null outlinePath (widened) deletes the key entirely, not just stores an empty value', async () => {
  const adapter = createInMemoryAdapter();
  await saveNarrowState(adapter, 'notes.org', ['Some Heading']);
  await saveNarrowState(adapter, 'notes.org', null);
  assert.equal(await loadNarrowState(adapter, 'notes.org'), null);
  // Confirm the key is genuinely gone, not just holding a falsy value --
  // a raw adapter.get should behave exactly as if it were never set.
  const raw = await adapter.get('narrowState:notes.org');
  assert.equal(raw, null);
});

test('narrow state is scoped per document -- narrowing one document leaves another untouched', async () => {
  const adapter = createInMemoryAdapter();
  await saveNarrowState(adapter, 'a.org', ['Heading A']);
  await saveNarrowState(adapter, 'b.org', ['Heading B']);
  assert.deepEqual(await loadNarrowState(adapter, 'a.org'), ['Heading A']);
  assert.deepEqual(await loadNarrowState(adapter, 'b.org'), ['Heading B']);
});

test('re-saving for the same document replaces the previous outline path rather than appending', async () => {
  const adapter = createInMemoryAdapter();
  await saveNarrowState(adapter, 'notes.org', ['First']);
  await saveNarrowState(adapter, 'notes.org', ['Second', 'Nested']);
  assert.deepEqual(await loadNarrowState(adapter, 'notes.org'), ['Second', 'Nested']);
});

test('loadNarrowState tolerates malformed stored data (a corrupt/foreign value) by returning null rather than throwing', async () => {
  const adapter = createInMemoryAdapter();
  await adapter.set('narrowState:notes.org', 'not valid json {{{');
  assert.equal(await loadNarrowState(adapter, 'notes.org'), null);
});

// ---- Search's Narrow (the sparse set of matching headings) -----------------------

test('the Search-Narrow headings round-trip as keys: the titles down to each, and the position at each level', async () => {
  const adapter = createInMemoryAdapter();
  const keys = [{ path: ['Projects', 'Alpha'], idx: [0, 1] }, { path: ['Inbox'], idx: [2] }];
  await saveSparseNarrowState(adapter, 'notes.org', keys);
  assert.deepEqual(await loadSparseNarrowState(adapter, 'notes.org'), keys);
});

test('widening (null or no keys) deletes the saved Search-Narrow entirely', async () => {
  const adapter = createInMemoryAdapter();
  await saveSparseNarrowState(adapter, 'notes.org', [{ path: ['A'], idx: [0] }]);
  await saveSparseNarrowState(adapter, 'notes.org', null);
  assert.equal(await loadSparseNarrowState(adapter, 'notes.org'), null);
  assert.equal(await adapter.get('sparseNarrow:notes.org'), null, 'the key is gone, not holding an empty value');
  await saveSparseNarrowState(adapter, 'notes.org', [{ path: ['A'], idx: [0] }]);
  await saveSparseNarrowState(adapter, 'notes.org', []);
  assert.equal(await adapter.get('sparseNarrow:notes.org'), null);
});

test('Search-Narrow and the subtree narrow are saved independently, per document', async () => {
  const adapter = createInMemoryAdapter();
  await saveNarrowState(adapter, 'a.org', ['Subtree']);
  await saveSparseNarrowState(adapter, 'a.org', [{ path: ['Match'], idx: [0] }]);
  await saveSparseNarrowState(adapter, 'b.org', [{ path: ['Other'], idx: [3] }]);
  assert.deepEqual(await loadNarrowState(adapter, 'a.org'), ['Subtree']);
  assert.deepEqual(await loadSparseNarrowState(adapter, 'a.org'), [{ path: ['Match'], idx: [0] }]);
  assert.deepEqual(await loadSparseNarrowState(adapter, 'b.org'), [{ path: ['Other'], idx: [3] }]);
  await saveSparseNarrowState(adapter, 'a.org', null);
  assert.deepEqual(await loadNarrowState(adapter, 'a.org'), ['Subtree'], 'widening one never touches the other');
});

test('a document that was never Search-narrowed, or whose saved value is unusable, loads as null', async () => {
  const adapter = createInMemoryAdapter();
  assert.equal(await loadSparseNarrowState(adapter, 'never.org'), null);
  for (const bad of ['not json', '{}', '{"headings":"x"}', '{"headings":[]}', '{"headings":[{"path":[]},{"path":[1]}]}', '{"outlinePaths":"x"}', '{"outlinePaths":[[],[1]]}']) {
    await adapter.set('sparseNarrow:bad.org', bad);
    assert.equal(await loadSparseNarrowState(adapter, 'bad.org'), null, bad);
  }
  await adapter.set('sparseNarrow:mixed.org', JSON.stringify({ headings: [{ path: ['Keep'], idx: [0] }, { path: [] }, { path: ['Also', 'Keep'], idx: [1, 0] }, { path: ['No', 'Idx'] }] }));
  assert.deepEqual(await loadSparseNarrowState(adapter, 'mixed.org'), [{ path: ['Keep'], idx: [0] }, { path: ['Also', 'Keep'], idx: [1, 0] }, { path: ['No', 'Idx'] }], 'unusable entries are dropped, usable ones kept, and idx is optional');
});

test('a save made by the earlier version (bare title paths) still loads, as keys without positions', async () => {
  const adapter = createInMemoryAdapter();
  await adapter.set('sparseNarrow:old.org', JSON.stringify({ outlinePaths: [['Keep'], [], [1], ['Also', 'Keep']] }));
  assert.deepEqual(await loadSparseNarrowState(adapter, 'old.org'), [{ path: ['Keep'] }, { path: ['Also', 'Keep'] }]);
});

// ---- outline keys: telling apart headings that share a title ------------------------------------

const DUPLICATES = ['* Group', '** Dup apple', '** Other', '* Group', '** Dup apple', '* Dup apple', '* Dup apple', ''].join('\n');

test('a key records the titles and the position at each level, so duplicates get different keys', () => {
  const doc = parseOrg(DUPLICATES);
  const [firstGroup, secondGroup, thirdTop, fourthTop] = doc.children;
  assert.deepEqual(outlineKeyForHeading(doc, firstGroup.children[0]), { path: ['Group', 'Dup apple'], idx: [0, 0] });
  assert.deepEqual(outlineKeyForHeading(doc, secondGroup.children[0]), { path: ['Group', 'Dup apple'], idx: [1, 0] });
  assert.deepEqual(outlineKeyForHeading(doc, thirdTop), { path: ['Dup apple'], idx: [2] });
  assert.deepEqual(outlineKeyForHeading(doc, fourthTop), { path: ['Dup apple'], idx: [3] });
});

test('every heading is found again from its own key, including each one of a set of identical titles', () => {
  const doc = parseOrg(DUPLICATES);
  const all = [];
  const collect = (children) => children.forEach((h) => { all.push(h); collect(h.children); });
  collect(doc.children);
  for (const heading of all) assert.equal(findHeadingByOutlineKey(doc, outlineKeyForHeading(doc, heading)), heading, heading.title);
});

test('a key survives being re-resolved against a freshly parsed copy of the same text', () => {
  const before = parseOrg(DUPLICATES);
  const key = outlineKeyForHeading(before, before.children[1].children[0]);
  const after = parseOrg(DUPLICATES);
  assert.equal(findHeadingByOutlineKey(after, key), after.children[1].children[0]);
});

test('a heading that is not in the document has no key', () => {
  assert.equal(outlineKeyForHeading(parseOrg('* A\n'), parseOrg('* A\n').children[0]), null);
  assert.equal(outlineKeyForHeading(null, {}), null);
});

test('after the document is edited, a position that now holds a different title is NOT trusted: it falls back to the titles', () => {
  const doc = parseOrg('* Alpha\n* Beta\n* Gamma\n');
  const key = outlineKeyForHeading(doc, doc.children[2]); // Gamma at position 2
  const edited = parseOrg('* New first\n* Alpha\n* Beta\n* Gamma\n'); // Gamma is now at position 3
  assert.equal(findHeadingByOutlineKey(edited, key), edited.children[3], 'found by its title, not by the stale position');
  const renamed = parseOrg('* Alpha\n* Beta\n* Renamed\n');
  assert.equal(findHeadingByOutlineKey(renamed, key), null, 'a heading renamed or removed drops out instead of matching something else by position');
});

test('a key with no positions (an older save) resolves by titles alone, the first match at each level', () => {
  const doc = parseOrg(DUPLICATES);
  assert.equal(findHeadingByOutlineKey(doc, { path: ['Group', 'Dup apple'] }), doc.children[0].children[0]);
  assert.equal(findHeadingByOutlineKey(doc, { path: ['Nope'] }), null);
  assert.equal(findHeadingByOutlineKey(doc, { path: [] }), null);
  assert.equal(findHeadingByOutlineKey(doc, null), null);
});

test('positions of the wrong length or with an out-of-range index are ignored rather than trusted', () => {
  const doc = parseOrg('* A\n** B\n');
  assert.equal(findHeadingByOutlineKey(doc, { path: ['A', 'B'], idx: [0] }), doc.children[0].children[0], 'too short: falls back to titles');
  assert.equal(findHeadingByOutlineKey(doc, { path: ['A', 'B'], idx: [0, 9] }), doc.children[0].children[0], 'out of range: falls back to titles');
});
