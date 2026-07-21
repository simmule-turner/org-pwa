
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryAdapter } from '../src/kv-adapter.js';
import { enqueueChange, hasPendingChange } from '../src/outbox.js';
import { SYNC_RESULT, syncDocument, createInMemoryDiskAdapter } from '../src/sync-engine.js';

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
  assert.deepEqual(resolveCalledWith, { mine: '* my local edit', disk: '* edited elsewhere' });
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
