
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import {
  isArchivedInPlace,
  archiveInPlace,
  unarchiveInPlace,
  archiveToSiblingFile,
  restoreFromArchive,
  findAncestorPath,
} from '../src/archive-model.js';

const FIXED_DATE = new Date('2026-07-20T14:32:00');

function docWithProject() {
  const text = [
    '* Projects',
    '** NRP',
    '*** TODO Ship v0.1.0',
    'Some notes.',
    '*** DONE Set up test suite',
  ].join('\n');
  return parseOrg(text);
}

test('archiveInPlace tags the heading and stamps ARCHIVE_TIME', () => {
  const doc = docWithProject();
  const target = doc.children[0].children[0].children[1]; // "DONE Set up test suite"

  assert.equal(isArchivedInPlace(target), false);
  archiveInPlace(target, { now: FIXED_DATE });

  assert.equal(isArchivedInPlace(target), true);
  assert.ok(target.tags.includes('ARCHIVE'));
  assert.equal(target.properties.ARCHIVE_TIME, '[2026-07-20 Mon 14:32]');
});

test('unarchiveInPlace removes the tag but keeps ARCHIVE_TIME as history', () => {
  const doc = docWithProject();
  const target = doc.children[0].children[0].children[1];
  archiveInPlace(target, { now: FIXED_DATE });
  unarchiveInPlace(target);

  assert.equal(isArchivedInPlace(target), false);
  assert.equal(target.properties.ARCHIVE_TIME, '[2026-07-20 Mon 14:32]');
});

test('findAncestorPath returns the correct outline path', () => {
  const doc = docWithProject();
  const target = doc.children[0].children[0].children[0]; // "TODO Ship v0.1.0"
  const path = findAncestorPath(doc, target);
  assert.deepEqual(path.map((h) => h.title), ['Projects', 'NRP']);
});

test('archiveToSiblingFile removes from source, stamps metadata, and lands in archive doc at level 1', () => {
  const sourceDoc = docWithProject();
  const archiveDoc = { type: 'document', keywords: [], children: [] };
  const target = sourceDoc.children[0].children[0].children[1]; // "DONE Set up test suite" (level 3)

  const extracted = archiveToSiblingFile(sourceDoc, archiveDoc, target, 'nrp.org', { now: FIXED_DATE });

  // Removed from source.
  const nrpNode = sourceDoc.children[0].children[0];
  assert.equal(nrpNode.children.length, 1);
  assert.equal(nrpNode.children[0].title, 'Ship v0.1.0');

  // Landed in archive doc, level shifted to 1.
  assert.equal(archiveDoc.children.length, 1);
  assert.equal(archiveDoc.children[0], extracted);
  assert.equal(extracted.level, 1);

  // Metadata stamped correctly.
  assert.equal(extracted.properties.ARCHIVE_TIME, '[2026-07-20 Mon 14:32]');
  assert.equal(extracted.properties.ARCHIVE_FILE, 'nrp.org');
  assert.equal(extracted.properties.ARCHIVE_OLPATH, 'Projects/NRP');
  assert.equal(extracted.properties.ARCHIVE_CATEGORY, 'Projects');
  assert.equal(extracted.todo, 'DONE'); // preserved as-is since markDone defaults to false
  assert.equal('ARCHIVE_TODO' in extracted.properties, false);

  // Archive doc serializes cleanly.
  const serialized = serializeOrg(archiveDoc);
  assert.match(serialized, /^\* DONE Set up test suite/m);
  assert.match(serialized, /:ARCHIVE_OLPATH: Projects\/NRP/);
});

test('archiveToSiblingFile with markDone stores original TODO state in ARCHIVE_TODO', () => {
  const sourceDoc = docWithProject();
  const archiveDoc = { type: 'document', keywords: [], children: [] };
  const target = sourceDoc.children[0].children[0].children[0]; // "TODO Ship v0.1.0"

  const extracted = archiveToSiblingFile(sourceDoc, archiveDoc, target, 'nrp.org', {
    now: FIXED_DATE,
    markDone: true,
  });

  assert.equal(extracted.properties.ARCHIVE_TODO, 'TODO');
  assert.equal(extracted.todo, 'DONE');
});

test('restoreFromArchive strips ARCHIVE_* properties and restores original todo state', () => {
  const sourceDoc = docWithProject();
  const archiveDoc = { type: 'document', keywords: [], children: [] };
  const target = sourceDoc.children[0].children[0].children[0];

  archiveToSiblingFile(sourceDoc, archiveDoc, target, 'nrp.org', { now: FIXED_DATE, markDone: true });
  const archivedNode = archiveDoc.children[0];

  const restored = restoreFromArchive(archiveDoc, archivedNode);

  assert.equal(archiveDoc.children.length, 0);
  assert.equal(restored.todo, 'TODO');
  assert.equal('ARCHIVE_TIME' in restored.properties, false);
  assert.equal('ARCHIVE_FILE' in restored.properties, false);
  assert.equal('ARCHIVE_OLPATH' in restored.properties, false);
  assert.equal('ARCHIVE_CATEGORY' in restored.properties, false);
  assert.equal('ARCHIVE_TODO' in restored.properties, false);
});
