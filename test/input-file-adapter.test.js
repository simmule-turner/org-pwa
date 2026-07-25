import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryAdapter } from '../src/kv-adapter.js';
import { createInputFileAdapter } from '../src-browser/input-file-adapter.js';

test('read returns null when nothing has been imported for this fileId yet', async () => {
  const kv = createInMemoryAdapter();
  const adapter = createInputFileAdapter(kv, () => {});
  assert.equal(await adapter.read('notes.org'), null);
});

test('write caches the content (so a later read returns it) and triggers the injected download function', async () => {
  const kv = createInMemoryAdapter();
  let downloadedWith = null;
  const adapter = createInputFileAdapter(kv, (fileId, content) => {
    downloadedWith = { fileId, content };
  });

  const result = await adapter.write('notes.org', '* Hello');
  assert.ok(result.hash);
  assert.deepEqual(downloadedWith, { fileId: 'notes.org', content: '* Hello' });

  const read = await adapter.read('notes.org');
  assert.equal(read.content, '* Hello');
  assert.equal(read.hash, result.hash);
});

test('exists reflects whether something has been imported/written for that fileId', async () => {
  const kv = createInMemoryAdapter();
  const adapter = createInputFileAdapter(kv, () => {});
  assert.equal(await adapter.exists('notes.org'), false);
  await adapter.write('notes.org', '* content');
  assert.equal(await adapter.exists('notes.org'), true);
});

test('separate fileIds are cached independently', async () => {
  const kv = createInMemoryAdapter();
  const adapter = createInputFileAdapter(kv, () => {});
  await adapter.write('a.org', '* A');
  await adapter.write('b.org', '* B');
  assert.equal((await adapter.read('a.org')).content, '* A');
  assert.equal((await adapter.read('b.org')).content, '* B');
});

test('a fresh write to the same fileId overwrites the cached content', async () => {
  const kv = createInMemoryAdapter();
  const adapter = createInputFileAdapter(kv, () => {});
  await adapter.write('notes.org', '* v1');
  await adapter.write('notes.org', '* v2');
  assert.equal((await adapter.read('notes.org')).content, '* v2');
});

test('read fails open (returns null) rather than throwing on a corrupt/erroring kv adapter', async () => {
  const badKv = { get: async () => { throw new Error('boom'); } };
  const adapter = createInputFileAdapter(badKv, () => {});
  assert.equal(await adapter.read('notes.org'), null);
});
