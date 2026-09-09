
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryAdapter } from '../src/kv-adapter.js';
import { saveNarrowState, loadNarrowState } from '../src/narrow-state.js';

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
