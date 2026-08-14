
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import {
  isArchivedInPlace,
  archiveInPlace,
  unarchiveInPlace,
  archiveToSiblingFile,
  buildRestoredClone,
  restoreFromArchive,
  findAncestorPath,
  getPropertiesText,
  setPropertiesFromText,
  extractForArchive,
  buildArchivedClone,
  appendToArchive,
  DEFAULT_ARCHIVE_LOCATION,
  parseArchiveLocation,
  resolveArchiveFileId,
  getArchiveLocation,
  insertAtArchiveLocation,
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
  assert.equal(target.properties.ARCHIVE_TIME, '2026-07-20 Mon 14:32');
});

test('THE FIX: ARCHIVE_TIME is written as a BARE date/day-name/time string, deliberately NOT wrapped in [] or <> -- confirmed against real, observed org-archive output (independent real-world examples both showed a bare, unbracketed value) and against the actual org-archive.el mechanism, which explicitly strips the enclosing angle brackets before writing this specific property', () => {
  const doc = docWithProject();
  const target = doc.children[0].children[0].children[1];
  archiveInPlace(target, { now: FIXED_DATE });
  const value = target.properties.ARCHIVE_TIME;
  assert.ok(!value.startsWith('['), 'must not be wrapped in square brackets (an inactive timestamp)');
  assert.ok(!value.startsWith('<'), 'must not be wrapped in angle brackets (an active timestamp) either');
  assert.equal(value, '2026-07-20 Mon 14:32');
});

test('unarchiveInPlace removes the tag but keeps ARCHIVE_TIME as history', () => {
  const doc = docWithProject();
  const target = doc.children[0].children[0].children[1];
  archiveInPlace(target, { now: FIXED_DATE });
  unarchiveInPlace(target);

  assert.equal(isArchivedInPlace(target), false);
  assert.equal(target.properties.ARCHIVE_TIME, '2026-07-20 Mon 14:32');
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
  assert.equal(extracted.properties.ARCHIVE_TIME, '2026-07-20 Mon 14:32');
  assert.equal(extracted.properties.ARCHIVE_FILE, 'nrp.org');
  assert.equal(extracted.properties.ARCHIVE_OLPATH, 'Projects/NRP');
  assert.equal(extracted.properties.ARCHIVE_CATEGORY, 'Projects');
  assert.equal(extracted.todo, 'DONE'); // preserved as-is since markDone defaults to false
  assert.equal(extracted.properties.ARCHIVE_TODO, 'DONE'); // THE FIX: recorded regardless of markDone -- real org's own default context-info always records the pre-archive state

  // Archive doc serializes cleanly.
  const serialized = serializeOrg(archiveDoc);
  assert.match(serialized, /^\* DONE Set up test suite/m);
  assert.match(serialized, /:ARCHIVE_OLPATH: Projects\/NRP/);
});

test('THE FIX: ARCHIVE_ITAGS records tags inherited from ancestors, colon-delimited, matching real org\u2019s own tag-storage convention', () => {
  const text = ['* Projects :work:', '** NRP :urgent:', '*** TODO Ship v0.1.0'].join('\n');
  const sourceDoc = parseOrg(text);
  const archiveDoc = { type: 'document', keywords: [], children: [] };
  const target = sourceDoc.children[0].children[0].children[0]; // "TODO Ship v0.1.0"

  const extracted = archiveToSiblingFile(sourceDoc, archiveDoc, target, 'nrp.org', { now: FIXED_DATE });
  assert.equal(extracted.properties.ARCHIVE_ITAGS, ':work:urgent:');
});

test('ARCHIVE_ITAGS is omitted entirely when there are no ancestor tags to inherit -- not stamped with an empty value', () => {
  const sourceDoc = docWithProject();
  const archiveDoc = { type: 'document', keywords: [], children: [] };
  const target = sourceDoc.children[0].children[0].children[1];

  const extracted = archiveToSiblingFile(sourceDoc, archiveDoc, target, 'nrp.org', { now: FIXED_DATE });
  assert.equal('ARCHIVE_ITAGS' in extracted.properties, false);
});

test('ARCHIVE_ITAGS only includes ANCESTOR tags, not the archived heading\u2019s own local tags', () => {
  const text = ['* Projects :work:', '** TODO Ship v0.1.0 :personal:'].join('\n');
  const sourceDoc = parseOrg(text);
  const archiveDoc = { type: 'document', keywords: [], children: [] };
  const target = sourceDoc.children[0].children[0];

  const extracted = archiveToSiblingFile(sourceDoc, archiveDoc, target, 'nrp.org', { now: FIXED_DATE });
  assert.equal(extracted.properties.ARCHIVE_ITAGS, ':work:');
  assert.ok(extracted.tags.includes('personal')); // the archived heading's own tag is preserved as-is, unrelated to ARCHIVE_ITAGS
});

test('a duplicate tag appearing on more than one ancestor is only listed once in ARCHIVE_ITAGS', () => {
  const text = ['* Projects :work:', '** NRP :work:', '*** TODO Ship v0.1.0'].join('\n');
  const sourceDoc = parseOrg(text);
  const archiveDoc = { type: 'document', keywords: [], children: [] };
  const target = sourceDoc.children[0].children[0].children[0];

  const extracted = archiveToSiblingFile(sourceDoc, archiveDoc, target, 'nrp.org', { now: FIXED_DATE });
  assert.equal(extracted.properties.ARCHIVE_ITAGS, ':work:');
});

test('restoring strips ARCHIVE_ITAGS along with every other ARCHIVE_* property', () => {
  const text = ['* Projects :work:', '** TODO Ship v0.1.0'].join('\n');
  const sourceDoc = parseOrg(text);
  const archiveDoc = { type: 'document', keywords: [], children: [] };
  const target = sourceDoc.children[0].children[0];
  const extracted = archiveToSiblingFile(sourceDoc, archiveDoc, target, 'nrp.org', { now: FIXED_DATE });

  const restored = buildRestoredClone(extracted);
  assert.equal('ARCHIVE_ITAGS' in restored.properties, false);
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
  assert.equal(restored.tags.includes('ARCHIVE'), false, 'a restored heading must not stay tagged :ARCHIVE: -- this was a real bug');
});

test('buildRestoredClone does NOT remove the heading from archiveDoc (non-mutating)', () => {
  const sourceDoc = docWithProject();
  const archiveDoc = { type: 'document', keywords: [], children: [] };
  const target = sourceDoc.children[0].children[0].children[0];
  archiveToSiblingFile(sourceDoc, archiveDoc, target, 'nrp.org', { now: FIXED_DATE });
  const archivedNode = archiveDoc.children[0];

  buildRestoredClone(archivedNode);

  assert.equal(archiveDoc.children.length, 1, 'archiveDoc must be completely untouched');
  assert.equal(archiveDoc.children[0], archivedNode, 'the original archived heading object must still be there, unmodified');
});

test('buildRestoredClone strips the ARCHIVE tag and all ARCHIVE_* properties, same as restoreFromArchive', () => {
  const sourceDoc = docWithProject();
  const archiveDoc = { type: 'document', keywords: [], children: [] };
  const target = sourceDoc.children[0].children[0].children[0];
  archiveToSiblingFile(sourceDoc, archiveDoc, target, 'nrp.org', { now: FIXED_DATE, markDone: true });
  const archivedNode = archiveDoc.children[0];

  const clone = buildRestoredClone(archivedNode);
  assert.equal(clone.todo, 'TODO');
  assert.equal(clone.tags.includes('ARCHIVE'), false);
  assert.equal('ARCHIVE_TIME' in clone.properties, false);
  assert.equal('ARCHIVE_FILE' in clone.properties, false);
  assert.equal('ARCHIVE_OLPATH' in clone.properties, false);
  assert.equal('ARCHIVE_CATEGORY' in clone.properties, false);
  assert.equal('ARCHIVE_TODO' in clone.properties, false);
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

// ---- parseArchiveLocation ---------------------------------------------

test('parseArchiveLocation: default "%s_archive::" splits into file part with %s and empty headline', () => {
  assert.deepEqual(parseArchiveLocation('%s_archive::'), { filePart: '%s_archive', headlinePart: '' });
});

test('parseArchiveLocation: "::* Archived Tasks" splits into empty file part and a headline path', () => {
  assert.deepEqual(parseArchiveLocation('::* Archived Tasks'), { filePart: '', headlinePart: '* Archived Tasks' });
});

test('parseArchiveLocation: "~/org/archive.org::" splits into a literal file part and empty headline', () => {
  assert.deepEqual(parseArchiveLocation('~/org/archive.org::'), { filePart: '~/org/archive.org', headlinePart: '' });
});

test('parseArchiveLocation: "~/org/archive.org::* %s" splits into both a literal file and a %s-containing headline', () => {
  assert.deepEqual(parseArchiveLocation('~/org/archive.org::* %s'), { filePart: '~/org/archive.org', headlinePart: '* %s' });
});

test('parseArchiveLocation: no "::" at all is treated as filePart-only rather than throwing', () => {
  assert.deepEqual(parseArchiveLocation('somefile.org'), { filePart: 'somefile.org', headlinePart: '' });
});

// ---- resolveArchiveFileId -----------------------------------------------

test('resolveArchiveFileId: %s substitutes the current basename WITH its extension', () => {
  assert.equal(resolveArchiveFileId('%s_archive', 'notes.org'), 'notes.org_archive');
});

test('resolveArchiveFileId: a %s-substituted result with no "/" is placed alongside the current file', () => {
  assert.equal(resolveArchiveFileId('%s_archive', 'journal/notes.org'), 'journal/notes.org_archive');
});

test('resolveArchiveFileId: an empty filePart resolves to null (archive within the current file)', () => {
  assert.equal(resolveArchiveFileId('', 'notes.org'), null);
});

test('resolveArchiveFileId: a literal path with no %s is used as-is', () => {
  assert.equal(resolveArchiveFileId('~/org/archive.org', 'notes.org'), '~/org/archive.org');
});

test('resolveArchiveFileId: a %s substitution can appear anywhere, not just as a prefix', () => {
  assert.equal(resolveArchiveFileId('archive/%s.bak', 'notes.org'), 'archive/notes.org.bak');
});

// ---- getArchiveLocation ---------------------------------------------------

test('getArchiveLocation: falls back to the documented default when nothing is configured', () => {
  const doc = parseOrg('* A');
  assert.equal(getArchiveLocation(doc, doc.children[0]), DEFAULT_ARCHIVE_LOCATION);
});

test('getArchiveLocation: uses the file-level #+ARCHIVE: keyword when present', () => {
  const doc = parseOrg('#+ARCHIVE: ::* Archived Tasks\n* A');
  assert.equal(getArchiveLocation(doc, doc.children[0]), '::* Archived Tasks');
});

test('getArchiveLocation: a heading\'s own ARCHIVE property overrides the file keyword', () => {
  const doc = parseOrg(
    ['#+ARCHIVE: ::* Archived Tasks', '* A', ':PROPERTIES:', ':ARCHIVE: ~/org/other.org::', ':END:'].join('\n')
  );
  assert.equal(getArchiveLocation(doc, doc.children[0]), '~/org/other.org::');
});

// ---- insertAtArchiveLocation ----------------------------------------------

test('insertAtArchiveLocation: a blank headlinePart appends as a new top-level entry', () => {
  const targetDoc = parseOrg('* Existing');
  const source = parseOrg('* Moved');
  const extracted = extractForArchive(source, source.children[0], 'src.org');
  insertAtArchiveLocation(targetDoc, extracted, '');
  assert.equal(targetDoc.children.length, 2);
  assert.equal(targetDoc.children[1].title, 'Moved');
  assert.equal(targetDoc.children[1].level, 1);
});

test('insertAtArchiveLocation: creates the target heading when it does not exist yet', () => {
  const targetDoc = parseOrg('* Something Else');
  const source = parseOrg('* Moved');
  const extracted = extractForArchive(source, source.children[0], 'src.org');
  insertAtArchiveLocation(targetDoc, extracted, '* Archived Tasks');
  const archivedHeading = targetDoc.children.find((h) => h.title === 'Archived Tasks');
  assert.ok(archivedHeading);
  assert.equal(archivedHeading.children.length, 1);
  assert.equal(archivedHeading.children[0].title, 'Moved');
  assert.equal(archivedHeading.children[0].level, 2);
});

test('insertAtArchiveLocation: appends to an EXISTING matching heading rather than creating a duplicate', () => {
  const targetDoc = parseOrg('* Archived Tasks\n** Already here');
  const source = parseOrg('* Newly moved');
  const extracted = extractForArchive(source, source.children[0], 'src.org');
  insertAtArchiveLocation(targetDoc, extracted, '* Archived Tasks');
  assert.equal(targetDoc.children.length, 1); // still just one "Archived Tasks" heading, not two
  assert.equal(targetDoc.children[0].children.length, 2);
  assert.equal(targetDoc.children[0].children[1].title, 'Newly moved');
});

test('insertAtArchiveLocation: strips leading asterisks/whitespace to get the bare target title', () => {
  const targetDoc = parseOrg('');
  const source = parseOrg('* X');
  const extracted = extractForArchive(source, source.children[0], 'src.org');
  insertAtArchiveLocation(targetDoc, extracted, '**   Weird Spacing');
  assert.equal(targetDoc.children[0].title, 'Weird Spacing');
});

// ---- THE FIX: the headline part's own asterisk count is the target's real, intended level ----

test('THE FIX: real org\u2019s own exact documented example -- "basement::** Finished Tasks" archives as level-3 trees below the level-2 heading', () => {
  const targetDoc = parseOrg('');
  const source = parseOrg('* Task A\nDone stuff.\n');
  const extracted = extractForArchive(source, source.children[0], 'src.org');
  insertAtArchiveLocation(targetDoc, extracted, '** Finished Tasks');
  const target = targetDoc.children.find((h) => h.title === 'Finished Tasks');
  assert.equal(target.level, 2, 'the target heading itself is created at level 2, not the previous, always-level-1 behavior');
  assert.equal(target.children[0].level, 3, 'the archived item becomes a level-3 child, one below its own level-2 target');
});

test('THE FIX: a level-2+ target is searched for ANYWHERE in the document, not just at the top level', () => {
  const targetDoc = parseOrg('* Some Project\n** Finished Tasks\n*** Old Item\n');
  const source = parseOrg('* Task B\n');
  const extracted = extractForArchive(source, source.children[0], 'src.org');
  insertAtArchiveLocation(targetDoc, extracted, '** Finished Tasks');
  const project = targetDoc.children.find((h) => h.title === 'Some Project');
  const target = project.children.find((h) => h.title === 'Finished Tasks');
  assert.equal(target.children.length, 2, 'appended to the EXISTING nested heading, not a newly-created top-level duplicate');
  assert.equal(target.children[1].title, 'Task B');
});

test('THE FIX: a bare single asterisk still means level 1, exactly the previous behavior -- no change for the common case', () => {
  const targetDoc = parseOrg('');
  const source = parseOrg('* X');
  const extracted = extractForArchive(source, source.children[0], 'src.org');
  insertAtArchiveLocation(targetDoc, extracted, '* Archived Tasks');
  assert.equal(targetDoc.children[0].level, 1);
});

test('THE FIX: matching by level AND title together -- a same-named heading at the WRONG level is correctly not matched', () => {
  const targetDoc = parseOrg('* Finished Tasks\n** Old (level 1, wrong level)\n');
  const source = parseOrg('* Task C\n');
  const extracted = extractForArchive(source, source.children[0], 'src.org');
  insertAtArchiveLocation(targetDoc, extracted, '** Finished Tasks'); // asks for LEVEL 2 specifically
  const level1Match = targetDoc.children.find((h) => h.level === 1 && h.title === 'Finished Tasks');
  const level2Match = targetDoc.children.find((h) => h.level === 2 && h.title === 'Finished Tasks');
  assert.equal(level1Match.children.length, 1, 'the pre-existing level-1 "Finished Tasks" is untouched');
  assert.ok(level2Match, 'a NEW, separate level-2 "Finished Tasks" was created instead of incorrectly reusing the level-1 one');
  assert.equal(level2Match.children[0].title, 'Task C');
});

// ---- full end-to-end scenarios matching each documented example -----------

test('EXAMPLE: default "%s_archive::" -- archives to a sibling file as a top-level entry', () => {
  const sourceDoc = parseOrg('* Keep this\n* DONE Finished task\nSome notes.');
  const heading = sourceDoc.children[1];
  const location = getArchiveLocation(sourceDoc, heading);
  assert.equal(location, DEFAULT_ARCHIVE_LOCATION);
  const { filePart, headlinePart } = parseArchiveLocation(location);
  const targetFileId = resolveArchiveFileId(filePart, 'notes.org');
  assert.equal(targetFileId, 'notes.org_archive');

  const archiveDoc = parseOrg(''); // archive file doesn't exist yet -- starts empty
  const extracted = extractForArchive(sourceDoc, heading, 'notes.org');
  insertAtArchiveLocation(archiveDoc, extracted, headlinePart);

  assert.equal(sourceDoc.children.length, 1); // removed from source
  assert.equal(sourceDoc.children[0].title, 'Keep this');
  assert.equal(archiveDoc.children.length, 1);
  assert.equal(archiveDoc.children[0].title, 'Finished task');
  assert.equal(archiveDoc.children[0].properties.ARCHIVE_FILE, 'notes.org');
});

test('EXAMPLE: "::* Archived Tasks" -- archives inside the SAME file under a top-level heading', () => {
  const sourceDoc = parseOrg('#+ARCHIVE: ::* Archived Tasks\n* Keep this\n* DONE Old task');
  const heading = sourceDoc.children[1];
  const location = getArchiveLocation(sourceDoc, heading);
  const { filePart, headlinePart } = parseArchiveLocation(location);
  const targetFileId = resolveArchiveFileId(filePart, 'notes.org');
  assert.equal(targetFileId, null, 'empty file part means archive within the current file');

  const extracted = extractForArchive(sourceDoc, heading, 'notes.org');
  insertAtArchiveLocation(sourceDoc, extracted, headlinePart); // same doc, since targetFileId is null

  const archivedSection = sourceDoc.children.find((h) => h.title === 'Archived Tasks');
  assert.ok(archivedSection);
  assert.equal(archivedSection.children[0].title, 'Old task');
});

test('EXAMPLE: "~/org/archive.org::" -- archives everything into one fixed central file, top-level', () => {
  const sourceDoc = parseOrg('#+ARCHIVE: ~/org/archive.org::\n* Keep this\n* DONE Old task');
  const heading = sourceDoc.children[1];
  const { filePart, headlinePart } = parseArchiveLocation(getArchiveLocation(sourceDoc, heading));
  assert.equal(resolveArchiveFileId(filePart, 'notes.org'), '~/org/archive.org');
  assert.equal(headlinePart, '');
});

test('EXAMPLE: "~/org/archive.org::* %s" -- central file, under a heading named after the source file', () => {
  const sourceDoc = parseOrg('#+ARCHIVE: ~/org/archive.org::* %s\n* Keep this\n* DONE Old task');
  const heading = sourceDoc.children[1];
  const { filePart, headlinePart } = parseArchiveLocation(getArchiveLocation(sourceDoc, heading));
  assert.equal(resolveArchiveFileId(filePart, 'notes.org'), '~/org/archive.org');
  // %s in the headline part names a heading after the SOURCE file's own basename
  const targetHeadingTitle = headlinePart.replace(/^\*+\s*/, '').split('%s').join('notes.org');
  assert.equal(targetHeadingTitle, 'notes.org');

  const archiveDoc = parseOrg('');
  const extracted = extractForArchive(sourceDoc, heading, 'notes.org');
  const resolvedHeadline = headlinePart.split('%s').join('notes.org');
  insertAtArchiveLocation(archiveDoc, extracted, resolvedHeadline);
  assert.equal(archiveDoc.children[0].title, 'notes.org');
  assert.equal(archiveDoc.children[0].children[0].title, 'Old task');
});

// ---- buildArchivedClone (non-mutating) -------------------------------

test('buildArchivedClone does NOT remove the heading from sourceDoc', () => {
  const sourceDoc = parseOrg('* Keep\n* Also archive me');
  const heading = sourceDoc.children[1];
  buildArchivedClone(sourceDoc, heading, 'src.org');
  assert.equal(sourceDoc.children.length, 2, 'sourceDoc must be completely untouched');
  assert.equal(sourceDoc.children[1], heading, 'the original heading object must still be there, unmodified');
});

test('buildArchivedClone produces the same stamped result as extractForArchive would, just without removing', () => {
  const sourceDoc = parseOrg('* Parent\n** Target heading');
  const heading = sourceDoc.children[0].children[0];
  const clone = buildArchivedClone(sourceDoc, heading, 'src.org', { now: new Date(2026, 0, 1, 12, 0) });
  assert.equal(clone.title, 'Target heading');
  assert.equal(clone.properties.ARCHIVE_FILE, 'src.org');
  assert.equal(clone.properties.ARCHIVE_OLPATH, 'Parent');
  assert.equal(clone.properties.ARCHIVE_CATEGORY, 'Parent');
  assert.ok(clone.tags.includes('ARCHIVE'), 'the archived clone must be tagged :ARCHIVE: -- this was a real bug (properties were stamped but the tag itself was never added)');
});

test('buildArchivedClone tags the clone :ARCHIVE:, matching real org-archive-subtree and what isArchivedInPlace/the Unarchive-button detection both rely on', () => {
  const sourceDoc = parseOrg('* A heading');
  const heading = sourceDoc.children[0];
  const clone = buildArchivedClone(sourceDoc, heading, 'src.org');
  assert.deepEqual(clone.tags, ['ARCHIVE']);
  assert.equal(isArchivedInPlace(clone), true);
});

test('buildArchivedClone does not duplicate the ARCHIVE tag if the original heading already had it', () => {
  const sourceDoc = parseOrg('* A heading :ARCHIVE:other:');
  const heading = sourceDoc.children[0];
  const clone = buildArchivedClone(sourceDoc, heading, 'src.org');
  assert.deepEqual(clone.tags.filter((t) => t === 'ARCHIVE').length, 1);
});

test('extractForArchive is equivalent to buildArchivedClone followed by an explicit removal', () => {
  const sourceDoc = parseOrg('* Keep\n* Archive me');
  const heading = sourceDoc.children[1];
  const extracted = extractForArchive(sourceDoc, heading, 'src.org');
  assert.equal(sourceDoc.children.length, 1, 'extractForArchive DOES remove, unlike buildArchivedClone');
  assert.equal(extracted.title, 'Archive me');
});
