import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryAdapter } from '../src/kv-adapter.js';
import { savePersistedHistory, loadPersistedHistory, clearPersistedHistory, HISTORY_STORE_LIMIT } from '../src/history-store.js';
import { createHistory, pushSnapshot } from '../src/undo-history.js';

test('save then load round-trips the history exactly', async () => {
  const adapter = createInMemoryAdapter();
  let history = createHistory('* A', 'Opened');
  history = pushSnapshot(history, '* A\nbody', 'Edited');
  await savePersistedHistory(adapter, 'nrp.org', history);
  const loaded = await loadPersistedHistory(adapter, 'nrp.org');
  assert.equal(loaded.entries.length, 2);
  assert.equal(loaded.index, 1);
  assert.equal(loaded.entries[0].text, '* A');
  assert.equal(loaded.entries[1].text, '* A\nbody');
  assert.equal(loaded.entries[0].label, 'Opened');
  assert.equal(loaded.entries[1].label, 'Edited');
});

test('loadPersistedHistory returns null when nothing was ever saved', async () => {
  const adapter = createInMemoryAdapter();
  assert.equal(await loadPersistedHistory(adapter, 'never-touched.org'), null);
});

test('timestamps round-trip as real Date objects, not strings', async () => {
  const adapter = createInMemoryAdapter();
  const now = new Date('2026-01-15T10:30:00.000Z');
  const history = createHistory('* A', 'Opened', now);
  await savePersistedHistory(adapter, 'nrp.org', history);
  const loaded = await loadPersistedHistory(adapter, 'nrp.org');
  assert.ok(loaded.entries[0].timestamp instanceof Date);
  assert.equal(loaded.entries[0].timestamp.toISOString(), now.toISOString());
});

test('history for one document is independent of another', async () => {
  const adapter = createInMemoryAdapter();
  await savePersistedHistory(adapter, 'a.org', createHistory('* A'));
  await savePersistedHistory(adapter, 'b.org', createHistory('* B'));
  const a = await loadPersistedHistory(adapter, 'a.org');
  const b = await loadPersistedHistory(adapter, 'b.org');
  assert.equal(a.entries[0].text, '* A');
  assert.equal(b.entries[0].text, '* B');
});

test('saving again for the same document replaces the previous save', async () => {
  const adapter = createInMemoryAdapter();
  await savePersistedHistory(adapter, 'nrp.org', createHistory('* First'));
  await savePersistedHistory(adapter, 'nrp.org', createHistory('* Second'));
  const loaded = await loadPersistedHistory(adapter, 'nrp.org');
  assert.equal(loaded.entries.length, 1);
  assert.equal(loaded.entries[0].text, '* Second');
});

test('clearPersistedHistory removes it -- load returns null afterward', async () => {
  const adapter = createInMemoryAdapter();
  await savePersistedHistory(adapter, 'nrp.org', createHistory('* A'));
  await clearPersistedHistory(adapter, 'nrp.org');
  assert.equal(await loadPersistedHistory(adapter, 'nrp.org'), null);
});

test('clearing one document\u2019s history leaves another untouched', async () => {
  const adapter = createInMemoryAdapter();
  await savePersistedHistory(adapter, 'a.org', createHistory('* A'));
  await savePersistedHistory(adapter, 'b.org', createHistory('* B'));
  await clearPersistedHistory(adapter, 'a.org');
  assert.equal(await loadPersistedHistory(adapter, 'a.org'), null);
  assert.equal((await loadPersistedHistory(adapter, 'b.org')).entries[0].text, '* B');
});

// ---- corruption / invalid-shape handling -----------------------------

test('malformed JSON in storage is treated as no history, not a thrown error', async () => {
  const adapter = createInMemoryAdapter();
  await adapter.set('history:nrp.org', 'not valid json{{{');
  assert.equal(await loadPersistedHistory(adapter, 'nrp.org'), null);
});

test('a stored value missing entries entirely is treated as no history', async () => {
  const adapter = createInMemoryAdapter();
  await adapter.set('history:nrp.org', JSON.stringify({ index: 0 }));
  assert.equal(await loadPersistedHistory(adapter, 'nrp.org'), null);
});

test('an empty entries array is treated as no history', async () => {
  const adapter = createInMemoryAdapter();
  await adapter.set('history:nrp.org', JSON.stringify({ entries: [], index: 0 }));
  assert.equal(await loadPersistedHistory(adapter, 'nrp.org'), null);
});

test('an out-of-range index is treated as no history rather than crashing a caller later', async () => {
  const adapter = createInMemoryAdapter();
  await adapter.set('history:nrp.org', JSON.stringify({ entries: [{ text: '* A', label: 'Opened', timestamp: new Date().toISOString() }], index: 5 }));
  assert.equal(await loadPersistedHistory(adapter, 'nrp.org'), null);
});

test('a negative index is treated as no history', async () => {
  const adapter = createInMemoryAdapter();
  await adapter.set('history:nrp.org', JSON.stringify({ entries: [{ text: '* A', label: 'Opened', timestamp: new Date().toISOString() }], index: -1 }));
  assert.equal(await loadPersistedHistory(adapter, 'nrp.org'), null);
});

// ---- trimming to the size cap -----------------------------------------

test('THE FEATURE: saving more than the cap trims to the most recent entries, adjusting index correctly', async () => {
  const adapter = createInMemoryAdapter();
  let history = createHistory('v0');
  for (let i = 1; i <= HISTORY_STORE_LIMIT + 50; i++) {
    history = pushSnapshot(history, 'v' + i, 'Edit ' + i);
  }
  assert.equal(history.entries.length, HISTORY_STORE_LIMIT + 51); // +1 for the initial "Opened" entry
  await savePersistedHistory(adapter, 'nrp.org', history);
  const loaded = await loadPersistedHistory(adapter, 'nrp.org');
  assert.equal(loaded.entries.length, HISTORY_STORE_LIMIT);
  // The most RECENT entries survive trimming, not the oldest.
  assert.equal(loaded.entries[loaded.entries.length - 1].text, 'v' + (HISTORY_STORE_LIMIT + 50));
  // index still points at the same logical (now-shifted) position -- the current/latest entry.
  assert.equal(loaded.index, loaded.entries.length - 1);
  assert.equal(loaded.entries[loaded.index].text, 'v' + (HISTORY_STORE_LIMIT + 50));
});

test('trimming when the history index points partway through (after an undo) still lands on the correct entry', async () => {
  const adapter = createInMemoryAdapter();
  let history = createHistory('v0');
  for (let i = 1; i <= HISTORY_STORE_LIMIT + 20; i++) {
    history = pushSnapshot(history, 'v' + i, 'Edit ' + i);
  }
  // Move the index back into what will become the trimmed-away region... and separately, into the surviving region.
  const survivingTargetIndex = history.entries.length - 10; // well within what will survive trimming
  history = { entries: history.entries, index: survivingTargetIndex };
  await savePersistedHistory(adapter, 'nrp.org', history);
  const loaded = await loadPersistedHistory(adapter, 'nrp.org');
  assert.equal(loaded.entries[loaded.index].text, history.entries[survivingTargetIndex].text);
});

test('saving fewer entries than the cap does not trim anything', async () => {
  const adapter = createInMemoryAdapter();
  let history = createHistory('v0');
  history = pushSnapshot(history, 'v1', 'Edit');
  await savePersistedHistory(adapter, 'nrp.org', history);
  const loaded = await loadPersistedHistory(adapter, 'nrp.org');
  assert.equal(loaded.entries.length, 2);
});
