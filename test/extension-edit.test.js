import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { setProperty, deleteProperty } from '../src/archive-model.js';
import { applyEdits, headingsInOrder, snapshotDocument, snapshotStillMatches, validateEdits } from '../src/extension-edit.js';

const SOURCE = ['* TODO Plan trip :travel:', 'SCHEDULED: <2026-10-12 Mon>', ':PROPERTIES:', ':EFFORT: 2h', ':END:', 'Book flights.', '** Hotels', 'Compare prices.', '* Notes', ''].join('\n');

test('a snapshot is plain data in outline order, with paths and the focused heading', () => {
  const doc = parseOrg(SOURCE);
  const all = headingsInOrder(doc);
  const snap = snapshotDocument(doc, { name: 'trip.org', focusedHeading: all[1] });
  assert.equal(snap.name, 'trip.org');
  assert.equal(snap.focused, 1);
  assert.deepEqual(snap.headings.map((h) => [h.index, h.level, h.title]), [[0, 1, 'Plan trip'], [1, 2, 'Hotels'], [2, 1, 'Notes']]);
  assert.equal(snap.headings[0].todo, 'TODO');
  assert.deepEqual(snap.headings[0].tags, ['travel']);
  assert.equal(snap.headings[0].properties.EFFORT, '2h');
  assert.equal(snap.headings[0].scheduled && snap.headings[0].scheduled.includes('2026-10-12'), true);
  assert.equal(snap.headings[0].body, 'Book flights.');
  assert.deepEqual(snap.headings[1].path, ['Plan trip']);
  JSON.parse(JSON.stringify(snap)); // survives structured cloning
  assert.equal(snapshotDocument(doc, {}).focused, null);
});

test('edits are checked before anything is applied', () => {
  const ok = [{ op: 'set-title', heading: 0, title: 'New' }, { op: 'set-todo', heading: 1, todo: null }, { op: 'set-tags', heading: 2, tags: ['a', 'b_c'] }];
  assert.equal(validateEdits(ok, 3), null);
  const cases = [
    [[{ op: 'set-title', heading: 3, title: 'x' }], /no heading number 3/],
    [[{ op: 'set-title', heading: 0, title: 'two\nlines' }], /one non-empty line/],
    [[{ op: 'set-todo', heading: 0, todo: 'todo' }], /not a TODO keyword/],
    [[{ op: 'set-tags', heading: 0, tags: ['bad tag'] }], /tags must be/],
    [[{ op: 'set-property', heading: 0, name: 'A B', value: 'x' }], /simple name/],
    [[{ op: 'nope', heading: 0 }], /unknown edit/],
    ['x', /must be a list/],
    [Array.from({ length: 501 }, () => ({ op: 'append-body', heading: 0, text: '' })), /too many edits/],
  ];
  for (const [edits, pattern] of cases) assert.match(validateEdits(edits, 3), pattern);
});

test('edits change the live headings, and the file serializes the way the edits say', () => {
  const doc = parseOrg(SOURCE);
  const deps = {
    setTodo: (h, todo) => { h.todo = todo; },
    setProperty,
    deleteProperty,
    appendBody: (h, lines) => h.bodyLines.push(...lines),
  };
  applyEdits(doc, [
    { op: 'set-title', heading: 0, title: 'Plan the trip' },
    { op: 'set-tags', heading: 0, tags: ['travel', 'fun'] },
    { op: 'set-property', heading: 0, name: 'EFFORT', value: '3h' },
    { op: 'set-property', heading: 1, name: 'STARS', value: '4' },
    { op: 'delete-property', heading: 0, name: 'NOPE' },
    { op: 'set-todo', heading: 2, todo: 'NEXT' },
    { op: 'append-body', heading: 1, text: 'Booked.' },
  ], deps);
  const text = serializeOrg(doc);
  assert.match(text, /^\* TODO Plan the trip\s+:travel:fun:$/m);
  assert.match(text, /:EFFORT: 3h/);
  assert.match(text, /:STARS: 4/);
  assert.match(text, /^\* NEXT Notes$/m);
  assert.match(text, /Compare prices\.\nBooked\./);
  assert.match(text, /SCHEDULED: <2026-10-12 Mon>/);
});

test('edits made against a snapshot are refused when the document has changed', () => {
  const doc = parseOrg(SOURCE);
  const snap = snapshotDocument(doc, {});
  assert.equal(snapshotStillMatches(doc, snap), true);
  headingsInOrder(doc)[1].title = 'Hostels';
  assert.equal(snapshotStillMatches(doc, snap), false);
});
