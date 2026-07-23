
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import {
  flattenVisibleRows,
  toggleFold,
  cycleHeadingTodo,
  toggleHeadingTodo,
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

test('flattenVisibleRows assigns a unique, within-render key to every row', () => {
  const doc = sampleDoc();
  const rows = flattenVisibleRows(doc);
  const keys = rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length); // all unique
  assert.ok(keys.every((k) => typeof k === 'string' && k.length > 0));
});

test('flattenVisibleRows no longer requires an options argument (id computation was removed)', () => {
  const doc = sampleDoc();
  const rows = flattenVisibleRows(doc); // single-argument call, matches every real call site now
  assert.ok(rows.length > 0);
});

test('bodyHidden hides only this heading\'s own body content, not its child headings', () => {
  const doc = parseOrg(['* Projects', '- a list item', '** NRP', 'NRP body text'].join('\n'));
  const projects = doc.children[0];
  projects.collapsed = false;
  projects.bodyHidden = true; // content-mode-style: children visible, body hidden
  projects.children[0].collapsed = false;
  projects.children[0].bodyHidden = false;

  const rows = flattenVisibleRows(doc);
  const rowTypes = rows.map((r) => r.rowType);
  // "Projects" heading shows, its list item does NOT (bodyHidden), but
  // "NRP" (a child heading) and NRP's own body text DO show.
  assert.deepEqual(rowTypes, ['heading', 'heading', 'paragraph']);
  assert.equal(rows[1].node.title, 'NRP');
});

test('bodyHidden on a heading with bodyHidden: false still shows its body normally (sanity check for the default case)', () => {
  const doc = parseOrg(['* Notes', 'Some text.'].join('\n'));
  const heading = doc.children[0];
  heading.bodyHidden = false;
  const rows = flattenVisibleRows(doc);
  assert.deepEqual(
    rows.map((r) => r.rowType),
    ['heading', 'paragraph']
  );
});

test('toggleFold flips collapsed and changes what flattenVisibleRows returns', () => {
  const doc = sampleDoc();
  const nrp = doc.children[0].children[0];
  assert.equal(toggleFold(nrp), true);
  const rows = flattenVisibleRows(doc);
  assert.ok(!rows.some((r) => r.rowType === 'heading' && r.node.title === 'Ship v0.1.0'));
  assert.equal(toggleFold(nrp), false);
});

test('THE BUG THIS FIXES: toggleFold clears bodyHidden on expand, so a leaf heading (body content, no sub-headings) can actually have its content revealed', () => {
  // Reproduces the reported #+STARTUP: content bug exactly: before this
  // fix, a heading with only body content and no sub-headings showed
  // literally zero visible change when its chevron was tapped, because
  // bodyHidden stayed stuck true regardless of collapsed.
  const doc = parseOrg(['* Parent B', 'Body text, no sub-headings.'].join('\n'));
  const heading = doc.children[0];
  heading.collapsed = false;
  heading.bodyHidden = true; // simulates the #+STARTUP: content default

  const before = flattenVisibleRows(doc);
  assert.deepEqual(before.map((r) => r.rowType), ['heading']); // body invisible

  toggleFold(heading); // collapses (was already expanded) — no visible content either way
  toggleFold(heading); // expands again

  assert.equal(heading.bodyHidden, false); // the fix: expanding cleared it
  const after = flattenVisibleRows(doc);
  assert.deepEqual(after.map((r) => r.rowType), ['heading', 'paragraph']); // body now visible
});

test('toggleFold does not touch bodyHidden when collapsing (only clears it on expand)', () => {
  const doc = parseOrg(['* Notes', 'Some text.'].join('\n'));
  const heading = doc.children[0];
  heading.collapsed = false;
  heading.bodyHidden = false; // already revealed
  toggleFold(heading); // collapse
  assert.equal(heading.bodyHidden, false); // stays as it was — collapsing doesn't re-hide it
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

test('cycleItemCheckbox cycles a leaf item (no nested sub-items) through just two states', () => {
  const doc = sampleDoc();
  const readingList = doc.children[1];
  const item = readingList.body[0].items[0]; // "Org manual" -- no nested sub-items
  assert.equal(item.checkbox, ' ');
  assert.equal(cycleItemCheckbox(readingList, item), 'X'); // straight to checked, no partial state
  assert.equal(cycleItemCheckbox(readingList, item), ' ');
  assert.equal(cycleItemCheckbox(readingList, item), 'X');
});

test('cycleItemCheckbox cycles an item WITH nested sub-items through all three states', () => {
  const doc = parseOrg(
    ['* Notes', '- [ ] Parent task', '  - [ ] Sub-task one', '  - [ ] Sub-task two'].join('\n')
  );
  const item = doc.children[0].body[0].items[0]; // "Parent task" -- has nested sub-items
  assert.equal(item.checkbox, ' ');
  assert.equal(cycleItemCheckbox(doc.children[0], item), '-');
  assert.equal(cycleItemCheckbox(doc.children[0], item), 'X');
  assert.equal(cycleItemCheckbox(doc.children[0], item), ' ');
});

test('cycleItemCheckbox on a leaf item currently showing "-" (e.g. hand-edited) moves to checked, skipping back to the ambiguous state', () => {
  const doc = parseOrg(['* Notes', '- [-] A leaf item somehow left partial'].join('\n'));
  const item = doc.children[0].body[0].items[0];
  assert.equal(cycleItemCheckbox(doc.children[0], item), 'X');
});

test('cycleItemCheckbox patches bodyLines so the edit survives serialize -> reparse', () => {
  const doc = sampleDoc();
  const readingList = doc.children[1];
  const item = readingList.body[0].items[0]; // "Org manual", starts ' ', a leaf item

  cycleItemCheckbox(readingList, item); // ' ' -> 'X' (2-state cycle, no nested sub-items)

  const text2 = serializeOrg(doc);
  assert.match(text2, /- \[X\] Org manual/);

  const doc2 = parseOrg(text2);
  const reparsedItem = doc2.children[1].body[0].items[0];
  assert.equal(reparsedItem.checkbox, 'X');
});

test('cycleItemCheckbox throws on a list item with no checkbox', () => {
  const doc = parseOrg(['* Notes', '- plain item, no checkbox'].join('\n'));
  const item = doc.children[0].body[0].items[0];
  assert.equal(item.checkbox, null);
  assert.throws(() => cycleItemCheckbox(doc.children[0], item));
});

// ---- toggleHeadingTodo (Mark as TODO action) -----------------------------

test('toggleHeadingTodo on a heading with no TODO state sets it to the sequence\'s first keyword', () => {
  const doc = sampleDoc();
  const heading = doc.children[0];
  const globalDefault = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };
  heading.todo = null;
  assert.equal(toggleHeadingTodo(doc, heading, globalDefault), 'TODO');
});

test('toggleHeadingTodo on a heading already in TODO state clears it directly to null', () => {
  const doc = sampleDoc();
  const heading = doc.children[0];
  const globalDefault = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };
  heading.todo = 'TODO';
  assert.equal(toggleHeadingTodo(doc, heading, globalDefault), null);
});

test('toggleHeadingTodo on a heading in DONE state ALSO clears it directly to null -- not one more cycle step forward', () => {
  const doc = sampleDoc();
  const heading = doc.children[0];
  const globalDefault = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };
  heading.todo = 'DONE';
  assert.equal(toggleHeadingTodo(doc, heading, globalDefault), null);
});

test('toggleHeadingTodo on a custom keyword mid-sequence (e.g. WAIT) also clears directly to null', () => {
  const doc = parseOrg(['#+TODO: TODO WAIT | DONE', '* Something', 'body'].join('\n'));
  const heading = doc.children[0];
  const globalDefault = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };
  heading.todo = 'WAIT';
  assert.equal(toggleHeadingTodo(doc, heading, globalDefault), null);
});

test('toggleHeadingTodo is a true two-state toggle when called repeatedly, not a multi-step cycle', () => {
  const doc = sampleDoc();
  const heading = doc.children[0];
  const globalDefault = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };
  heading.todo = null;
  assert.equal(toggleHeadingTodo(doc, heading, globalDefault), 'TODO');
  assert.equal(toggleHeadingTodo(doc, heading, globalDefault), null);
  assert.equal(toggleHeadingTodo(doc, heading, globalDefault), 'TODO');
  assert.equal(toggleHeadingTodo(doc, heading, globalDefault), null);
});
