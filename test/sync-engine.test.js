
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryAdapter } from '../src/kv-adapter.js';
import { enqueueChange, hasPendingChange } from '../src/outbox.js';
import { SYNC_RESULT, syncDocument, createInMemoryDiskAdapter, getSyncMeta, setSyncMeta } from '../src/sync-engine.js';

test('up-to-date: nothing pending means nothing to sync', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  const result = await syncDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });
  assert.equal(result.status, SYNC_RESULT.UP_TO_DATE);
});

test('clean sync: first write to a file with no prior disk content', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await enqueueChange(kv, 'nrp.org', '* Hello');

  const result = await syncDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });
  assert.equal(result.status, SYNC_RESULT.SYNCED);
  assert.equal((await disk.read('nrp.org')).content, '* Hello');
});

test('clean sync: disk unchanged since last sync, no conflict', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await enqueueChange(kv, 'nrp.org', '* v1');
  await syncDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });

  await enqueueChange(kv, 'nrp.org', '* v2');
  const result = await syncDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });
  assert.equal(result.status, SYNC_RESULT.SYNCED);
  assert.equal((await disk.read('nrp.org')).content, '* v2');
});

test('conflict detected when disk changed externally since last sync', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await enqueueChange(kv, 'nrp.org', '* v1');
  await syncDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });

  // Simulate an edit made outside the app (e.g. directly in Emacs).
  disk._simulateExternalEdit('nrp.org', '* edited elsewhere');

  await enqueueChange(kv, 'nrp.org', '* my local edit');
  let resolveCalledWith = null;
  const result = await syncDocument({
    documentId: 'nrp.org',
    kvAdapter: kv,
    diskAdapter: disk,
    resolveConflict: async (ctx) => {
      resolveCalledWith = ctx;
      return 'mine';
    },
  });

  assert.equal(result.status, SYNC_RESULT.CONFLICT);
  // `base` is the text as of the last successful sync -- the common ancestor a merge needs.
  assert.deepEqual(resolveCalledWith, { mine: '* my local edit', disk: '* edited elsewhere', base: '* v1' });
});

test('conflict resolved keep-mine overwrites disk', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await enqueueChange(kv, 'nrp.org', '* v1');
  await syncDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });
  disk._simulateExternalEdit('nrp.org', '* edited elsewhere');
  await enqueueChange(kv, 'nrp.org', '* my local edit');

  await syncDocument({
    documentId: 'nrp.org',
    kvAdapter: kv,
    diskAdapter: disk,
    resolveConflict: async () => 'mine',
  });

  assert.equal((await disk.read('nrp.org')).content, '* my local edit');
});

test('conflict resolved keep-disk discards the local pending change', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await enqueueChange(kv, 'nrp.org', '* v1');
  await syncDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });
  disk._simulateExternalEdit('nrp.org', '* edited elsewhere');
  await enqueueChange(kv, 'nrp.org', '* my local edit');

  const result = await syncDocument({
    documentId: 'nrp.org',
    kvAdapter: kv,
    diskAdapter: disk,
    resolveConflict: async () => 'disk',
  });

  assert.equal(result.resolution, 'disk');
  assert.equal((await disk.read('nrp.org')).content, '* edited elsewhere');

  // Outbox should be cleared — no lingering pending change after keep-disk.
  assert.equal(await hasPendingChange(kv, 'nrp.org'), false);
});

test('no conflict when disk changed but nothing is pending locally', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await enqueueChange(kv, 'nrp.org', '* v1');
  await syncDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });

  disk._simulateExternalEdit('nrp.org', '* edited elsewhere');
  // No enqueueChange this time — nothing pending locally.

  const result = await syncDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });
  assert.equal(result.status, SYNC_RESULT.UP_TO_DATE);
});

test('throws if a conflict occurs but no resolveConflict callback is given', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await enqueueChange(kv, 'nrp.org', '* v1');
  await syncDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });
  disk._simulateExternalEdit('nrp.org', '* edited elsewhere');
  await enqueueChange(kv, 'nrp.org', '* my local edit');

  await assert.rejects(syncDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk }));
});

test('independent documents sync independently', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await enqueueChange(kv, 'a.org', '* A');
  await enqueueChange(kv, 'b.org', '* B');
  await syncDocument({ documentId: 'a.org', kvAdapter: kv, diskAdapter: disk });
  await syncDocument({ documentId: 'b.org', kvAdapter: kv, diskAdapter: disk });
  assert.equal((await disk.read('a.org')).content, '* A');
  assert.equal((await disk.read('b.org')).content, '* B');
});

// ---- common ancestor + richer conflict resolutions -------------------------

async function conflictedSetup() {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await enqueueChange(kv, 'a.org', 'base text');
  await syncDocument({ documentId: 'a.org', kvAdapter: kv, diskAdapter: disk });
  disk._simulateExternalEdit('a.org', 'their text');
  await enqueueChange(kv, 'a.org', 'my text');
  return { kv, disk };
}

test('a successful write records what was written as the new common ancestor', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await enqueueChange(kv, 'a.org', 'v1 text');
  await syncDocument({ documentId: 'a.org', kvAdapter: kv, diskAdapter: disk });
  const meta = await getSyncMeta(kv, 'a.org');
  assert.equal(meta.baseContent, 'v1 text');
  assert.equal(meta.lastSyncedHash, (await disk.read('a.org')).hash);
});

test('metadata written before baseContent existed still works: the callback just gets base: null', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  disk._simulateExternalEdit('a.org', 'their text');
  await setSyncMeta(kv, 'a.org', { lastSyncedHash: 'stale-hash' }); // the old shape
  await enqueueChange(kv, 'a.org', 'my text');
  let ctx;
  await syncDocument({ documentId: 'a.org', kvAdapter: kv, diskAdapter: disk, resolveConflict: async (c) => ((ctx = c), 'mine') });
  assert.equal(ctx.base, null);
});

test("resolving with { merged } writes the merged text, clears the pending edit, and makes it the new base", async () => {
  const { kv, disk } = await conflictedSetup();
  const result = await syncDocument({
    documentId: 'a.org',
    kvAdapter: kv,
    diskAdapter: disk,
    resolveConflict: async () => ({ merged: 'merged text' }),
  });
  assert.equal(result.status, SYNC_RESULT.CONFLICT);
  assert.equal(result.resolution, 'merged');
  assert.equal(result.content, 'merged text');
  assert.equal((await disk.read('a.org')).content, 'merged text');
  assert.equal(await hasPendingChange(kv, 'a.org'), false);
  const meta = await getSyncMeta(kv, 'a.org');
  assert.equal(meta.baseContent, 'merged text');
  assert.equal(meta.lastSyncedHash, (await disk.read('a.org')).hash);
});

test("resolving with 'cancel' changes nothing: disk untouched, the local edit still pending, no metadata change", async () => {
  const { kv, disk } = await conflictedSetup();
  const metaBefore = await getSyncMeta(kv, 'a.org');
  const result = await syncDocument({ documentId: 'a.org', kvAdapter: kv, diskAdapter: disk, resolveConflict: async () => 'cancel' });
  assert.equal(result.status, SYNC_RESULT.CONFLICT);
  assert.equal(result.resolution, 'cancelled');
  assert.equal((await disk.read('a.org')).content, 'their text');
  assert.equal(await hasPendingChange(kv, 'a.org'), true);
  assert.deepEqual(await getSyncMeta(kv, 'a.org'), metaBefore);
});

test("after 'cancel', a later sync detects the same conflict again -- nothing was silently accepted", async () => {
  const { kv, disk } = await conflictedSetup();
  await syncDocument({ documentId: 'a.org', kvAdapter: kv, diskAdapter: disk, resolveConflict: async () => 'cancel' });
  let asked = false;
  const result = await syncDocument({
    documentId: 'a.org',
    kvAdapter: kv,
    diskAdapter: disk,
    resolveConflict: async () => ((asked = true), 'mine'),
  });
  assert.equal(asked, true);
  assert.equal(result.resolution, 'mine');
});

test("keeping disk records disk's text as the new common ancestor", async () => {
  const { kv, disk } = await conflictedSetup();
  await syncDocument({ documentId: 'a.org', kvAdapter: kv, diskAdapter: disk, resolveConflict: async () => 'disk' });
  assert.equal((await getSyncMeta(kv, 'a.org')).baseContent, 'their text');
});

test('the three resolutions compose with the real merge: a clean merge of two different edits reaches disk', async () => {
  const { planConflict } = await import('../src/merge3.js');
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  const base = ['* A', 'a body', '* B', 'b body', '* C', 'c body', ''].join('\n');
  await enqueueChange(kv, 'a.org', base);
  await syncDocument({ documentId: 'a.org', kvAdapter: kv, diskAdapter: disk });
  disk._simulateExternalEdit('a.org', base.replace('c body', 'c body (edited elsewhere)'));
  await enqueueChange(kv, 'a.org', base.replace('a body', 'a body (edited here)'));
  const result = await syncDocument({
    documentId: 'a.org',
    kvAdapter: kv,
    diskAdapter: disk,
    resolveConflict: async ({ mine, disk: theirs, base: b }) => {
      const plan = planConflict(mine, theirs, b);
      assert.equal(plan.kind, 'auto');
      return { merged: plan.mergedText };
    },
  });
  assert.equal(result.resolution, 'merged');
  assert.equal((await disk.read('a.org')).content, base.replace('a body', 'a body (edited here)').replace('c body', 'c body (edited elsewhere)'));
});
