
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import {
  flattenVisibleRows,
  toggleFold,
  cycleHeadingTodo,
  cycleItemCheckbox,
} from '../src/outline-view-model.js';

function sampleDoc() {
  const text = [
    '* Projects',
    '** NRP',
    '*** TODO Ship v0.1.0',
    '*** DONE Set up test suite',
    '* Reading list',
    '- [ ] Org manual',
    '- [X] PWA patterns',
  ].join('\n');
  return parseOrg(text);
}

test('flattenVisibleRows includes every heading when nothing is collapsed', () => {
  const doc = sampleDoc();
  const rows = flattenVisibleRows(doc);
  const headingTitles = rows.filter((r) => r.rowType === 'heading').map((r) => r.node.title);
  assert.deepEqual(headingTitles, ['Projects', 'NRP', 'Ship v0.1.0', 'Set up test suite', 'Reading list']);
});

test('flattenVisibleRows omits descendants of a collapsed heading entirely', () => {
  const doc = sampleDoc();
  const projects = doc.children[0];
  projects.collapsed = true;

  const rows = flattenVisibleRows(doc);
  const headingTitles = rows.filter((r) => r.rowType === 'heading').map((r) => r.node.title);
  assert.deepEqual(headingTitles, ['Projects', 'Reading list']);
});

test('flattenVisibleRows includes list-item rows with increasing depth for nesting', () => {
  const doc = sampleDoc();
  const rows = flattenVisibleRows(doc);
  const items = rows.filter((r) => r.rowType === 'list-item');
  assert.equal(items.length, 2);
  assert.equal(items[0].item.text, 'Org manual');
  assert.equal(items[1].item.text, 'PWA patterns');
  // Both items sit one level deeper than their parent heading ("Reading list" is depth 0).
  assert.equal(items[0].depth, 1);
});

test('computeIds: false skips id computation (ids come back null) but everything else still works', () => {
  const doc = sampleDoc();
  const rows = flattenVisibleRows(doc, { computeIds: false });
  const headingRows = rows.filter((r) => r.rowType === 'heading');
  const itemRows = rows.filter((r) => r.rowType === 'list-item');
  assert.ok(headingRows.every((r) => r.id === null));
  assert.ok(itemRows.every((r) => r.id === null));
  // Structure/content is identical either way.
  assert.deepEqual(
    headingRows.map((r) => r.node.title),
    ['Projects', 'NRP', 'Ship v0.1.0', 'Set up test suite', 'Reading list']
  );
});

test('computeIds defaults to true (backward compatible) when omitted', () => {
  const doc = sampleDoc();
  const rows = flattenVisibleRows(doc);
  const nrpRow = rows.find((r) => r.rowType === 'heading' && r.node.title === 'NRP');
  assert.ok(nrpRow.id.startsWith('p:'));
});

test('flattenVisibleRows assigns stable heading row ids matching fold-state ids', () => {
  const doc = sampleDoc();
  const rows = flattenVisibleRows(doc);
  const nrpRow = rows.find((r) => r.rowType === 'heading' && r.node.title === 'NRP');
  assert.ok(nrpRow.id.startsWith('p:'));
});

test('toggleFold flips collapsed and changes what flattenVisibleRows returns', () => {
  const doc = sampleDoc();
  const nrp = doc.children[0].children[0];
  assert.equal(toggleFold(nrp), true);
  const rows = flattenVisibleRows(doc);
  assert.ok(!rows.some((r) => r.rowType === 'heading' && r.node.title === 'Ship v0.1.0'));
  assert.equal(toggleFold(nrp), false);
});

test('list-item rows carry a reference to their owning heading', () => {
  const doc = sampleDoc();
  const rows = flattenVisibleRows(doc);
  const itemRow = rows.find((r) => r.rowType === 'list-item');
  assert.equal(itemRow.heading, doc.children[1]); // "Reading list"
});

test('table/paragraph/block rows carry a reference to their owning heading', () => {
  const doc = parseOrg(['* Notes', 'A paragraph.', '', '| a | b |'].join('\n'));
  const rows = flattenVisibleRows(doc);
  const paraRow = rows.find((r) => r.rowType === 'paragraph');
  const tableRow = rows.find((r) => r.rowType === 'table');
  assert.equal(paraRow.heading, doc.children[0]);
  assert.equal(tableRow.heading, doc.children[0]);
});

test('displayNumber increments for ordered items and is null for unordered ones', () => {
  const doc = parseOrg(['* Notes', '1. first', '2. second', '3. third'].join('\n'));
  const rows = flattenVisibleRows(doc);
  const items = rows.filter((r) => r.rowType === 'list-item');
  assert.deepEqual(
    items.map((r) => r.displayNumber),
    [1, 2, 3]
  );
});

test('displayNumber is null for every item in an unordered list', () => {
  const doc = parseOrg(['* Notes', '- one', '- two'].join('\n'));
  const rows = flattenVisibleRows(doc);
  const items = rows.filter((r) => r.rowType === 'list-item');
  assert.deepEqual(
    items.map((r) => r.displayNumber),
    [null, null]
  );
});

test('displayNumber respects a [@N] start-value cookie mid-list', () => {
  const doc = parseOrg(['* Notes', '1. first', '20. [@20] twentieth', '21. twenty-first'].join('\n'));
  const rows = flattenVisibleRows(doc);
  const items = rows.filter((r) => r.rowType === 'list-item');
  assert.deepEqual(
    items.map((r) => r.displayNumber),
    [1, 20, 21]
  );
});

test('nested ordered lists number independently from their parent', () => {
  const doc = parseOrg(['* Notes', '1. top one', '   1. nested one', '   2. nested two', '2. top two'].join('\n'));
  const rows = flattenVisibleRows(doc);
  const items = rows.filter((r) => r.rowType === 'list-item');
  assert.deepEqual(
    items.map((r) => r.displayNumber),
    [1, 1, 2, 2]
  );
});

test('cycleHeadingTodo uses the resolved sequence (file #+TODO: wins over global default)', () => {
  const doc = parseOrg(['#+TODO: NEXT WAITING | DONE', '* NEXT Something'].join('\n'));
  const heading = doc.children[0];
  const globalDefault = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };
  assert.equal(cycleHeadingTodo(doc, heading, globalDefault), 'WAITING');
});

test('cycleItemCheckbox cycles the in-memory state', () => {
  const doc = sampleDoc();
  const readingList = doc.children[1];
  const item = readingList.body[0].items[0];
  assert.equal(item.checkbox, ' ');
  assert.equal(cycleItemCheckbox(readingList, item), '-');
  assert.equal(cycleItemCheckbox(readingList, item), 'X');
  assert.equal(cycleItemCheckbox(readingList, item), ' ');
});

test('cycleItemCheckbox patches bodyLines so the edit survives serialize -> reparse', () => {
  const doc = sampleDoc();
  const readingList = doc.children[1];
  const item = readingList.body[0].items[0]; // "Org manual", starts ' '

  cycleItemCheckbox(readingList, item); // ' ' -> '-'

  const text2 = serializeOrg(doc);
  assert.match(text2, /- \[-\] Org manual/);

  const doc2 = parseOrg(text2);
  const reparsedItem = doc2.children[1].body[0].items[0];
  assert.equal(reparsedItem.checkbox, '-');
});

test('cycleItemCheckbox throws on a list item with no checkbox', () => {
  const doc = parseOrg(['* Notes', '- plain item, no checkbox'].join('\n'));
  const item = doc.children[0].body[0].items[0];
  assert.equal(item.checkbox, null);
  assert.throws(() => cycleItemCheckbox(doc.children[0], item));
});
