
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryAdapter } from '../src/kv-adapter.js';
import { enqueueChange, getPendingChange, clearPendingChange, hasPendingChange } from '../src/outbox.js';

test('enqueueChange then getPendingChange returns the queued content', async () => {
  const adapter = createInMemoryAdapter();
  await enqueueChange(adapter, 'nrp.org', '* Hello');
  const pending = await getPendingChange(adapter, 'nrp.org');
  assert.equal(pending.content, '* Hello');
  assert.ok(pending.queuedAt);
});

test('getPendingChange returns null when nothing is queued', async () => {
  const adapter = createInMemoryAdapter();
  assert.equal(await getPendingChange(adapter, 'never-touched.org'), null);
});

test('enqueueing again replaces the previous pending entry rather than appending', async () => {
  const adapter = createInMemoryAdapter();
  await enqueueChange(adapter, 'nrp.org', '* First edit');
  await enqueueChange(adapter, 'nrp.org', '* Second edit');
  const pending = await getPendingChange(adapter, 'nrp.org');
  assert.equal(pending.content, '* Second edit');
});

test('clearPendingChange empties the outbox for that document', async () => {
  const adapter = createInMemoryAdapter();
  await enqueueChange(adapter, 'nrp.org', '* Hello');
  await clearPendingChange(adapter, 'nrp.org');
  assert.equal(await getPendingChange(adapter, 'nrp.org'), null);
});

test('hasPendingChange reflects queued/cleared state', async () => {
  const adapter = createInMemoryAdapter();
  assert.equal(await hasPendingChange(adapter, 'nrp.org'), false);
  await enqueueChange(adapter, 'nrp.org', '* Hello');
  assert.equal(await hasPendingChange(adapter, 'nrp.org'), true);
  await clearPendingChange(adapter, 'nrp.org');
  assert.equal(await hasPendingChange(adapter, 'nrp.org'), false);
});

test('separate documents have independent outboxes', async () => {
  const adapter = createInMemoryAdapter();
  await enqueueChange(adapter, 'a.org', '* A');
  await enqueueChange(adapter, 'b.org', '* B');
  assert.equal((await getPendingChange(adapter, 'a.org')).content, '* A');
  assert.equal((await getPendingChange(adapter, 'b.org')).content, '* B');
});

test('getPendingChange fails safe (returns null) on corrupt stored data', async () => {
  const badAdapter = { get: async () => ({ key: 'x', value: '{not valid json' }) };
  assert.equal(await getPendingChange(badAdapter, 'whatever.org'), null);
});
