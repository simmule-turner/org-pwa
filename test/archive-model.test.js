
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
  getPropertiesText,
  setPropertiesFromText,
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

// ---- property text editing ------------------------------------------------

test('getPropertiesText renders each property as one key: value line, in drawer order', () => {
  const doc = parseOrg(
    ['* Simmule', '  :PROPERTIES:', '  :fname: Simmule', '  :lname: Turner', '  :END:'].join('\n')
  );
  assert.equal(getPropertiesText(doc.children[0]), 'fname: Simmule\nlname: Turner');
});

test('getPropertiesText is empty for a heading with no property drawer', () => {
  const doc = parseOrg('* Plain heading');
  assert.equal(getPropertiesText(doc.children[0]), '');
});

test('setPropertiesFromText replaces the whole property set and round-trips through serialize -> reparse', () => {
  const doc = parseOrg('* Simmule');
  setPropertiesFromText(doc.children[0], 'fname: Simmule\nlname: Turner\ndob: 1965-01-27');

  const doc2 = parseOrg(serializeOrg(doc));
  const h = doc2.children[0];
  assert.equal(h.properties.fname, 'Simmule');
  assert.equal(h.properties.lname, 'Turner');
  assert.equal(h.properties.dob, '1965-01-27');
  assert.deepEqual(h.propertyOrder, ['fname', 'lname', 'dob']);
});

test('setPropertiesFromText is a full replace: a property missing from the new text is deleted, not kept', () => {
  const doc = parseOrg(
    ['* Simmule', '  :PROPERTIES:', '  :fname: Simmule', '  :lname: Turner', '  :END:'].join('\n')
  );
  setPropertiesFromText(doc.children[0], 'fname: Simmule'); // lname omitted
  assert.deepEqual(doc.children[0].properties, { fname: 'Simmule' });
  assert.deepEqual(doc.children[0].propertyOrder, ['fname']);
});

test('setPropertiesFromText skips malformed lines (no colon) instead of throwing', () => {
  const doc = parseOrg('* Test');
  setPropertiesFromText(doc.children[0], 'fname: Simmule\nthis line has no colon\nlname: Turner');
  assert.deepEqual(doc.children[0].propertyOrder, ['fname', 'lname']);
});

test('setPropertiesFromText with empty text clears all properties', () => {
  const doc = parseOrg(
    ['* Simmule', '  :PROPERTIES:', '  :fname: Simmule', '  :END:'].join('\n')
  );
  setPropertiesFromText(doc.children[0], '');
  assert.deepEqual(doc.children[0].properties, {});
  assert.deepEqual(doc.children[0].propertyOrder, []);
});

test('setPropertiesFromText collapses whitespace in a key to underscores (org keys cannot contain spaces)', () => {
  const doc = parseOrg('* Test');
  setPropertiesFromText(doc.children[0], 'my key: value');
  assert.deepEqual(doc.children[0].propertyOrder, ['my_key']);
});

test('getPropertiesText -> setPropertiesFromText round-trips a real multi-property drawer unchanged', () => {
  const doc = parseOrg(
    [
      '* Simmule',
      '  :PROPERTIES:',
      '  :fname:    Simmule',
      '  :mname:    Romero',
      '  :lname:    Turner',
      '  :dob:      1965-01-27',
      '  :END:',
    ].join('\n')
  );
  const heading = doc.children[0];
  const text = getPropertiesText(heading);
  setPropertiesFromText(heading, text); // no-op edit
  assert.deepEqual(heading.properties, { fname: 'Simmule', mname: 'Romero', lname: 'Turner', dob: '1965-01-27' });
});
