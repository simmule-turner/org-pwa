
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryAdapter } from '../src/kv-adapter.js';
import { createInMemoryDiskAdapter } from '../src/sync-engine.js';
import { hasPendingChange } from '../src/outbox.js';
import {
  openDocument,
  saveDocument,
  saveAndSync,
  listOpenDocuments,
  markDocumentOpen,
  markDocumentClosed,
  openAllDocuments,
} from '../src/document-store.js';

test('opening a document that exists on disk parses and caches it', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await disk.write('nrp.org', '* TODO Ship it');

  const { doc, source } = await openDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });
  assert.equal(source, 'disk');
  assert.equal(doc.children[0].todo, 'TODO');

  // Second open should hit the cache, not disk.
  const second = await openDocument({ documentId: 'nrp.org', kvAdapter: kv, diskAdapter: disk });
  assert.equal(second.source, 'cache');
});

test('opening a document that exists nowhere returns a fresh empty document', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  const { doc, source } = await openDocument({ documentId: 'brand-new.org', kvAdapter: kv, diskAdapter: disk });
  assert.equal(source, 'new');
  assert.deepEqual(doc.children, []);
});

test('saveDocument writes to the cache and enqueues an outbox entry, but does not touch disk', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  const { doc } = await openDocument({ documentId: 'new.org', kvAdapter: kv, diskAdapter: disk });
  doc.children.push({
    type: 'heading',
    level: 1,
    todo: 'TODO',
    priority: null,
    title: 'Buy milk',
    tags: [],
    planning: { scheduled: null, deadline: null, closed: null },
    properties: {},
    propertyOrder: [],
    bodyLines: [],
    body: [],
    collapsed: false,
    children: [],
  });

  await saveDocument({ documentId: 'new.org', doc, kvAdapter: kv });

  assert.equal(await disk.exists('new.org'), false);
  assert.equal(await hasPendingChange(kv, 'new.org'), true);

  const reopened = await openDocument({ documentId: 'new.org', kvAdapter: kv, diskAdapter: disk });
  assert.equal(reopened.source, 'cache');
  assert.equal(reopened.doc.children[0].title, 'Buy milk');
});

test('saveAndSync writes through to disk', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  const { doc } = await openDocument({ documentId: 'new.org', kvAdapter: kv, diskAdapter: disk });
  doc.keywords.push({ key: 'title', value: 'New doc' });

  const result = await saveAndSync({ documentId: 'new.org', doc, kvAdapter: kv, diskAdapter: disk });
  assert.equal(result.status, 'synced');
  const diskContent = (await disk.read('new.org')).content;
  assert.match(diskContent, /#\+title: New doc/);
});

test('open/close document registry', async () => {
  const kv = createInMemoryAdapter();
  assert.deepEqual(await listOpenDocuments(kv), []);

  await markDocumentOpen(kv, 'a.org');
  await markDocumentOpen(kv, 'b.org');
  assert.deepEqual(await listOpenDocuments(kv), ['a.org', 'b.org']);

  // Opening the same doc twice doesn't duplicate it.
  await markDocumentOpen(kv, 'a.org');
  assert.deepEqual(await listOpenDocuments(kv), ['a.org', 'b.org']);

  await markDocumentClosed(kv, 'a.org');
  assert.deepEqual(await listOpenDocuments(kv), ['b.org']);
});

test('openAllDocuments opens every registered document', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await disk.write('a.org', '* A heading');
  await disk.write('b.org', '* B heading');
  await markDocumentOpen(kv, 'a.org');
  await markDocumentOpen(kv, 'b.org');

  const results = await openAllDocuments({ kvAdapter: kv, diskAdapter: disk });
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => r.doc.children[0].title),
    ['A heading', 'B heading']
  );
});

test('archive file is just another documentId — no special-casing needed to open/save it', async () => {
  const kv = createInMemoryAdapter();
  const disk = createInMemoryDiskAdapter();
  await markDocumentOpen(kv, 'nrp.org');
  await markDocumentOpen(kv, 'nrp_archive.org');
  const ids = await listOpenDocuments(kv);
  assert.deepEqual(ids, ['nrp.org', 'nrp_archive.org']);
});
