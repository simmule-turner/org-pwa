import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import {
  serializeTableRow,
  serializeTableRule,
  serializeTable,
  setTableCell,
  insertTableRow,
  deleteTableRow,
  insertTableColumn,
  deleteTableColumn,
  insertTable,
  editParagraphText,
  insertParagraph,
  insertParagraphAfter,
  deleteListItem,
  deleteTable,
  deleteParagraph,
  editListItemText,
  insertListItem,
  getHeadingText,
  setHeadingText,
} from '../src/body-edit.js';

function docWithTable() {
  const text = [
    '* Notes',
    '| Name  | Age |',
    '|-------+-----|',
    '| Alice | 30  |',
    '| Bob   | 25  |',
  ].join('\n');
  return parseOrg(text);
}

// ---- serialization helpers ---------------------------------------------

test('serializeTableRow formats cells with single-space padding', () => {
  assert.equal(serializeTableRow(['a', 'b', 'c']), '| a | b | c |');
});

test('serializeTableRule matches the column count', () => {
  assert.equal(serializeTableRule(3), '|---+---+---|');
  assert.equal(serializeTableRule(1), '|---|');
});

test('serializeTable reconstructs rows, rule, and TBLFM in order', () => {
  const doc = docWithTable();
  const table = doc.children[0].body[0];
  const lines = serializeTable(table);
  assert.deepEqual(lines, ['| Name | Age |', '|---+---|', '| Alice | 30 |', '| Bob | 25 |']);
});

// ---- setTableCell --------------------------------------------------------

test('setTableCell updates the cell and survives serialize -> reparse', () => {
  const doc = docWithTable();
  const heading = doc.children[0];
  const table = heading.body[0];

  setTableCell(heading, table, 2, 1, '31');

  const text2 = serializeOrg(doc);
  assert.match(text2, /\| Alice \| 31 \|/);

  const doc2 = parseOrg(text2);
  const reparsedTable = doc2.children[0].body[0];
  assert.equal(reparsedTable.rows[2].cells[1], '31');
});

test('setTableCell strips newlines and pipes from the value', () => {
  const doc = docWithTable();
  const heading = doc.children[0];
  const table = heading.body[0];
  setTableCell(heading, table, 2, 0, 'Weird\nName|here');
  assert.equal(heading.body[0].rows[2].cells[0], 'Weird Name here');
});

test('setTableCell throws when targeting a rule row', () => {
  const doc = docWithTable();
  const heading = doc.children[0];
  const table = heading.body[0];
  assert.throws(() => setTableCell(heading, table, 1, 0, 'x'));
});

// ---- row/column insert & delete -----------------------------------------

test('insertTableRow adds a blank row with the right column count', () => {
  const doc = docWithTable();
  const heading = doc.children[0];
  let table = heading.body[0];
  insertTableRow(heading, table, 3); // after Bob, i.e. at the end

  table = heading.body[0]; // reread after commit's reparse
  assert.equal(table.rows.length, 5);
  assert.deepEqual(table.rows[4].cells, ['', '']);
});

test('deleteTableRow removes the targeted row', () => {
  const doc = docWithTable();
  const heading = doc.children[0];
  deleteTableRow(heading, heading.body[0], 3); // Bob

  const table = heading.body[0];
  const names = table.rows.filter((r) => r.type === 'row').map((r) => r.cells[0]);
  assert.deepEqual(names, ['Name', 'Alice']);
});

test('deleteTableRow refuses to delete the last remaining row', () => {
  const doc = parseOrg(['* Notes', '| only |'].join('\n'));
  const heading = doc.children[0];
  assert.throws(() => deleteTableRow(heading, heading.body[0], 0));
});

test('insertTableColumn adds a blank cell to every data row, leaves the rule alone', () => {
  const doc = docWithTable();
  const heading = doc.children[0];
  insertTableColumn(heading, heading.body[0], 1); // after "Age"

  const table = heading.body[0];
  assert.deepEqual(table.rows[0].cells, ['Name', 'Age', '']);
  assert.deepEqual(table.rows[2].cells, ['Alice', '30', '']);
  assert.equal(table.rows[1].type, 'rule');

  const text = serializeOrg(doc);
  assert.match(text, /\|---\+---\+---\|/);
});

test('deleteTableColumn removes that column from every data row', () => {
  const doc = docWithTable();
  const heading = doc.children[0];
  deleteTableColumn(heading, heading.body[0], 1); // "Age"

  const table = heading.body[0];
  assert.deepEqual(table.rows[0].cells, ['Name']);
  assert.deepEqual(table.rows[2].cells, ['Alice']);
});

test('deleteTableColumn refuses to delete the last remaining column', () => {
  const doc = parseOrg(['* Notes', '| onlycol |', '| val |'].join('\n'));
  const heading = doc.children[0];
  assert.throws(() => deleteTableColumn(heading, heading.body[0], 0));
});

// ---- insertTable ----------------------------------------------------------

test('insertTable appends a fresh table with a header rule', () => {
  const doc = parseOrg('* Notes');
  const heading = doc.children[0];
  insertTable(heading, { rows: 2, cols: 3 });

  const table = heading.body[0];
  assert.equal(table.type, 'table');
  assert.equal(table.rows[0].type, 'row');
  assert.equal(table.rows[1].type, 'rule');
  assert.equal(table.rows[2].type, 'row');
  assert.equal(table.rows[0].cells.length, 3);
});

test('insertTable adds a blank-line separator when the heading already has content', () => {
  const doc = parseOrg(['* Notes', 'Some existing text.'].join('\n'));
  const heading = doc.children[0];
  insertTable(heading, {});
  const text = serializeOrg(doc);
  assert.match(text, /Some existing text\.\n\n\|/);
});

test('deleteTable removes the whole table and survives serialize -> reparse', () => {
  const doc = docWithTable();
  const heading = doc.children[0];
  deleteTable(heading, heading.body[0]);
  assert.equal(heading.body.length, 0);

  const doc2 = parseOrg(serializeOrg(doc));
  assert.deepEqual(doc2.children[0].body, []);
});

test('deleteTable leaves unrelated content before/after intact', () => {
  const doc = parseOrg(['* Notes', 'Before.', '', '| a | b |', '', 'After.'].join('\n'));
  const heading = doc.children[0];
  const table = heading.body.find((n) => n.type === 'table');
  deleteTable(heading, table);

  const types = heading.body.map((n) => n.type);
  assert.deepEqual(types, ['paragraph', 'paragraph']);
  assert.equal(heading.body[0].lines[0], 'Before.');
  assert.equal(heading.body[1].lines[0], 'After.');
});

test('deleteParagraph removes the paragraph and survives serialize -> reparse', () => {
  const doc = parseOrg(['* Notes', 'Some text.'].join('\n'));
  const heading = doc.children[0];
  deleteParagraph(heading, heading.body[0]);
  assert.equal(heading.body.length, 0);

  const doc2 = parseOrg(serializeOrg(doc));
  assert.deepEqual(doc2.children[0].body, []);
});

test('deleteParagraph leaves unrelated content before/after intact', () => {
  const doc = parseOrg(['* Notes', 'Before.', '', 'Delete this one.', '', '| a | b |'].join('\n'));
  const heading = doc.children[0];
  const target = heading.body.find((n) => n.type === 'paragraph' && n.lines[0] === 'Delete this one.');
  deleteParagraph(heading, target);

  const types = heading.body.map((n) => n.type);
  assert.deepEqual(types, ['paragraph', 'table']);
  assert.equal(heading.body[0].lines[0], 'Before.');
});

// ---- editListItemText ------------------------------------------------

test('editListItemText replaces the text and survives serialize -> reparse', () => {
  const doc = parseOrg(['* Notes', '- one', '- two', '- three'].join('\n'));
  const heading = doc.children[0];
  editListItemText(heading, heading.body[0].items[1], 'TWO (edited)');

  const text2 = serializeOrg(doc);
  assert.match(text2, /^- TWO \(edited\)$/m);

  const doc2 = parseOrg(text2);
  assert.deepEqual(
    doc2.children[0].body[0].items.map((i) => i.text),
    ['one', 'TWO (edited)', 'three']
  );
});

test('editListItemText preserves checkbox and marker', () => {
  const doc = parseOrg(['* Notes', '- [ ] buy milk'].join('\n'));
  const heading = doc.children[0];
  editListItemText(heading, heading.body[0].items[0], 'buy oat milk');

  const item = heading.body[0].items[0];
  assert.equal(item.checkbox, ' ');
  assert.equal(item.text, 'buy oat milk');
  assert.match(serializeOrg(doc), /^- \[ \] buy oat milk$/m);
});

test('editListItemText preserves a tag prefix', () => {
  const doc = parseOrg(['* Notes', '- fruit :: apples'].join('\n'));
  const heading = doc.children[0];
  editListItemText(heading, heading.body[0].items[0], 'pears and plums');

  assert.equal(heading.body[0].items[0].tag, 'fruit');
  assert.equal(heading.body[0].items[0].text, 'pears and plums');
});

test('editListItemText preserves original indentation on a nested item', () => {
  const doc = parseOrg(['* Notes', '- one', '  - nested'].join('\n'));
  const heading = doc.children[0];
  const nested = heading.body[0].items[0].children[0].items[0];
  editListItemText(heading, nested, 'nested (edited)');

  const text2 = serializeOrg(doc);
  assert.match(text2, /^  - nested \(edited\)$/m);
});

test('editListItemText only touches the targeted line, leaving siblings and nesting intact', () => {
  const doc = parseOrg(
    ['* Notes', '- keep-1', '- edit-me', '  - nested-under-edit-me', '- keep-2'].join('\n')
  );
  const heading = doc.children[0];
  editListItemText(heading, heading.body[0].items[1], 'edited');

  const list = heading.body[0];
  assert.deepEqual(list.items.map((i) => i.text), ['keep-1', 'edited', 'keep-2']);
  assert.equal(list.items[1].children[0].items[0].text, 'nested-under-edit-me');
});

test('editListItemText preserves a [@N] start-value cookie', () => {
  const doc = parseOrg(['* Notes', '20. [@20] twentieth item'].join('\n'));
  const heading = doc.children[0];
  editListItemText(heading, heading.body[0].items[0], 'twentieth item, revised');

  const item = heading.body[0].items[0];
  assert.equal(item.startValue, 20);
  assert.equal(item.text, 'twentieth item, revised');
  assert.match(serializeOrg(doc), /^20\. \[@20\] twentieth item, revised$/m);
});

// ---- insertListItem --------------------------------------------------

test('insertListItem adds a sibling right after the target and survives serialize -> reparse', () => {
  const doc = parseOrg(['* Notes', '- one', '- three'].join('\n'));
  const heading = doc.children[0];
  const newItem = insertListItem(heading, heading.body[0].items[0], 'two');

  assert.equal(newItem.text, 'two');
  assert.deepEqual(
    heading.body[0].items.map((i) => i.text),
    ['one', 'two', 'three']
  );

  const doc2 = parseOrg(serializeOrg(doc));
  assert.deepEqual(
    doc2.children[0].body[0].items.map((i) => i.text),
    ['one', 'two', 'three']
  );
});

test('insertListItem inserts after a subtree, not inside it', () => {
  const doc = parseOrg(['* Notes', '- one', '  - nested', '- three'].join('\n'));
  const heading = doc.children[0];
  insertListItem(heading, heading.body[0].items[0], 'two');

  const list = heading.body[0];
  assert.deepEqual(
    list.items.map((i) => i.text),
    ['one', 'two', 'three']
  );
  assert.equal(list.items[0].children[0].items[0].text, 'nested');
});

test('insertListItem gives the new item an unchecked checkbox when the sibling has one', () => {
  const doc = parseOrg(['* Notes', '- [X] done thing'].join('\n'));
  const heading = doc.children[0];
  const newItem = insertListItem(heading, heading.body[0].items[0], 'new thing');
  assert.equal(newItem.checkbox, ' ');
});

test('insertListItem does not inherit the sibling tag', () => {
  const doc = parseOrg(['* Notes', '- fruit :: apples'].join('\n'));
  const heading = doc.children[0];
  const newItem = insertListItem(heading, heading.body[0].items[0], 'plain new item');
  assert.equal(newItem.tag, null);
  assert.equal(newItem.text, 'plain new item');
});

test('insertListItem preserves indentation for a nested sibling', () => {
  const doc = parseOrg(['* Notes', '- one', '  - nested-a'].join('\n'));
  const heading = doc.children[0];
  const nestedA = heading.body[0].items[0].children[0].items[0];
  insertListItem(heading, nestedA, 'nested-b');

  const text = serializeOrg(doc);
  assert.match(text, /^  - nested-b$/m);
});

// ---- deleteListItem --------------------------------------------------

test('deleteListItem removes a simple item and survives serialize -> reparse', () => {
  const doc = parseOrg(['* Notes', '- one', '- two', '- three'].join('\n'));
  const heading = doc.children[0];
  const list = heading.body[0];
  deleteListItem(heading, list.items[1]); // "two"

  const remaining = heading.body[0].items.map((i) => i.text);
  assert.deepEqual(remaining, ['one', 'three']);

  const doc2 = parseOrg(serializeOrg(doc));
  assert.deepEqual(
    doc2.children[0].body[0].items.map((i) => i.text),
    ['one', 'three']
  );
});

test('deleteListItem takes nested sub-items with it', () => {
  const doc = parseOrg(
    ['* Notes', '- one', '  - one-a', '  - one-b', '- two'].join('\n')
  );
  const heading = doc.children[0];
  const list = heading.body[0];
  deleteListItem(heading, list.items[0]); // "one", with its nested one-a/one-b

  const remaining = heading.body[0].items.map((i) => i.text);
  assert.deepEqual(remaining, ['two']);
});

test('deleteListItem only removes the targeted item, leaving unrelated siblings intact', () => {
  const doc = parseOrg(
    ['* Notes', '- keep-1', '- delete-me', '  - nested-under-delete-me', '- keep-2'].join('\n')
  );
  const heading = doc.children[0];
  deleteListItem(heading, heading.body[0].items[1]);

  const remaining = heading.body[0].items.map((i) => i.text);
  assert.deepEqual(remaining, ['keep-1', 'keep-2']);
});

test('deleteListItem on the last remaining item leaves an empty body (no crash)', () => {
  const doc = parseOrg(['* Notes', '- only item'].join('\n'));
  const heading = doc.children[0];
  deleteListItem(heading, heading.body[0].items[0]);
  assert.deepEqual(heading.body, []);
  assert.equal(serializeOrg(doc), '* Notes');
});

// ---- paragraph edits -----------------------------------------------------

test('editParagraphText replaces the text and survives serialize -> reparse', () => {
  const doc = parseOrg(['* Notes', 'Original text.'].join('\n'));
  const heading = doc.children[0];
  const paragraph = heading.body[0];

  editParagraphText(heading, paragraph, 'Updated text.');

  const text2 = serializeOrg(doc);
  assert.match(text2, /Updated text\./);
  assert.doesNotMatch(text2, /Original text\./);

  const doc2 = parseOrg(text2);
  assert.equal(doc2.children[0].body[0].lines[0], 'Updated text.');
});

test('editParagraphText with an embedded blank line splits into two paragraphs on reparse', () => {
  const doc = parseOrg(['* Notes', 'One line.'].join('\n'));
  const heading = doc.children[0];
  editParagraphText(heading, heading.body[0], 'First para.\n\nSecond para.');

  const paragraphs = heading.body.filter((n) => n.type === 'paragraph');
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].lines[0], 'First para.');
  assert.equal(paragraphs[1].lines[0], 'Second para.');
});

test('editParagraphText that looks like a list reparses as a list, not a paragraph', () => {
  const doc = parseOrg(['* Notes', 'Plain text.'].join('\n'));
  const heading = doc.children[0];
  editParagraphText(heading, heading.body[0], '- now a list item');
  assert.equal(heading.body[0].type, 'list');
});

test('insertParagraph appends new text with a blank-line separator', () => {
  const doc = parseOrg(['* Notes', 'Existing.'].join('\n'));
  const heading = doc.children[0];
  insertParagraph(heading, 'New note.');

  assert.equal(heading.body.length, 2);
  assert.equal(heading.body[1].lines[0], 'New note.');
  const text = serializeOrg(doc);
  assert.match(text, /Existing\.\n\nNew note\./);
});

// ---- insertParagraphAfter ---------------------------------------------

test('insertParagraphAfter inserts a sibling right after the target, separated from what follows', () => {
  const doc = parseOrg(['* Notes', 'First.', '', 'Third.'].join('\n'));
  const heading = doc.children[0];
  const first = heading.body[0];
  const newPara = insertParagraphAfter(heading, first, 'Second.');

  assert.equal(newPara.lines[0], 'Second.');
  assert.deepEqual(
    heading.body.map((n) => n.lines[0]),
    ['First.', 'Second.', 'Third.']
  );

  const text2 = serializeOrg(doc);
  const doc2 = parseOrg(text2);
  assert.deepEqual(
    doc2.children[0].body.map((n) => n.lines[0]),
    ['First.', 'Second.', 'Third.']
  );
});

test('insertParagraphAfter at the very end of the body needs no trailing separator', () => {
  const doc = parseOrg(['* Notes', 'Only paragraph.'].join('\n'));
  const heading = doc.children[0];
  insertParagraphAfter(heading, heading.body[0], 'New last paragraph.');

  assert.equal(serializeOrg(doc), '* Notes\nOnly paragraph.\n\nNew last paragraph.');
});

test('insertParagraphAfter adds a trailing separator before immediately-following non-blank content (e.g. a list)', () => {
  const doc = parseOrg(['* Notes', 'A paragraph.', '- a list item'].join('\n'));
  const heading = doc.children[0];
  insertParagraphAfter(heading, heading.body[0], 'Inserted paragraph.');

  const text2 = serializeOrg(doc);
  const doc2 = parseOrg(text2);
  const types = doc2.children[0].body.map((n) => n.type);
  assert.deepEqual(types, ['paragraph', 'paragraph', 'list']);
  assert.equal(doc2.children[0].body[1].lines[0], 'Inserted paragraph.');
});

// ---- heading text (entire body content) -----------------------------

test('getHeadingText returns every line of body content, not just paragraphs', () => {
  // The user's own second example — pure paragraph content, the case the
  // old leading-only version happened to get right.
  const doc = parseOrg(
    [
      '* My Project Tasks',
      'This is the initial overview text.',
      '',
      'This text is separated by a blank line, but still belongs to the headline.',
      '',
      '',
      'Even with multiple blank lines, this text stays inside the "My Project Tasks" section.',
      '',
      '** This is a Subheading',
      'Now this sub-task belongs to the subheading above, not the parent.',
    ].join('\n')
  );
  const heading = doc.children[0];
  assert.equal(
    getHeadingText(heading),
    'This is the initial overview text.\n\n' +
      'This text is separated by a blank line, but still belongs to the headline.\n\n\n' +
      'Even with multiple blank lines, this text stays inside the "My Project Tasks" section.\n'
  );
});

test('getHeadingText does not pull in text belonging to a sub-heading', () => {
  const doc = parseOrg(
    ['* Parent', 'Parent text.', '** Child', 'Child text — must not appear in parent.'].join('\n')
  );
  const heading = doc.children[0];
  assert.equal(getHeadingText(heading), 'Parent text.');
});

test('getHeadingText: the exact bug report — a heading whose body starts with a list, then a paragraph, then another list', () => {
  // Built directly from "Fix organice issues": the old leading-paragraph-only
  // version returned '' here, since body[0] is a list, not a paragraph —
  // missing essentially all of the heading's actual content.
  const doc = parseOrg(
    [
      '* Fix organice issues',
      '',
      '- [X] first item',
      '- [X] second item',
      '**Release Notes**',
      '- Added more raw entries',
      '  - nested detail',
      '- Added repeating timestamps',
    ].join('\n')
  );
  const heading = doc.children[0];
  assert.equal(heading.body.map((n) => n.type).join(','), 'list,paragraph,list');
  const text = getHeadingText(heading);
  assert.match(text, /- \[X\] first item/);
  assert.match(text, /- \[X\] second item/);
  assert.match(text, /\*\*Release Notes\*\*/);
  assert.match(text, /- Added more raw entries/);
  assert.match(text, /  - nested detail/);
  assert.match(text, /- Added repeating timestamps/);
});

test('getHeadingText is empty only when the heading truly has no body content', () => {
  const doc = parseOrg(['* Empty heading', '** Child'].join('\n'));
  assert.equal(getHeadingText(doc.children[0]), '');
});

test('setHeadingText replaces the entire body and survives serialize -> reparse, including list/paragraph/list content', () => {
  const doc = parseOrg(
    ['* Fix organice issues', '- [X] old item', '**Release Notes**', '- old note'].join('\n')
  );
  const heading = doc.children[0];
  setHeadingText(
    heading,
    '- [ ] new item one\n- [X] new item two\n**Updated Notes**\n- a new note\n- another note'
  );

  const text2 = serializeOrg(doc);
  const doc2 = parseOrg(text2);
  const reheading = doc2.children[0];
  assert.equal(reheading.body.map((n) => n.type).join(','), 'list,paragraph,list');
  assert.equal(reheading.body[0].items.map((i) => i.text).join(','), 'new item one,new item two');
  assert.equal(reheading.body[2].items.length, 2);
});

test('setHeadingText on a heading with existing list content fully replaces it, not just prepends', () => {
  const doc = parseOrg(['* Notes', '- existing item'].join('\n'));
  const heading = doc.children[0];
  setHeadingText(heading, 'Now just plain text, no list at all.');

  assert.equal(heading.body.length, 1);
  assert.equal(heading.body[0].type, 'paragraph');
  assert.equal(heading.body[0].lines[0], 'Now just plain text, no list at all.');
});

test('setHeadingText with empty text clears all body content, of any kind', () => {
  const doc = parseOrg(
    ['* Fix organice issues', '- [X] item one', '**Release Notes**', '- a note'].join('\n')
  );
  const heading = doc.children[0];
  setHeadingText(heading, '   '); // effectively empty after trim

  assert.deepEqual(heading.body, []);
  assert.deepEqual(heading.bodyLines, []);
});

test('setHeadingText leaves a sub-heading and its own text completely untouched', () => {
  const doc = parseOrg(['* Parent', '- parent list item', '** Child', 'Child text.'].join('\n'));
  const heading = doc.children[0];
  setHeadingText(heading, 'Replaced with plain text.');

  assert.equal(getHeadingText(heading), 'Replaced with plain text.');
  assert.equal(heading.children[0].title, 'Child');
  assert.equal(getHeadingText(heading.children[0]), 'Child text.');
});

// ---- the multi-edit sequencing hazard -------------------------------------

test('editing two body nodes in sequence, always re-reading from heading.body, keeps everything consistent', () => {
  const doc = parseOrg(['* Notes', 'A paragraph.', '', '| a | b |'].join('\n'));
  const heading = doc.children[0];

  // Edit the paragraph first (changes line count if text grows).
  editParagraphText(heading, heading.body[0], 'A much longer paragraph than before.');

  // Re-read the table fresh from heading.body (NOT a reference captured
  // before the paragraph edit) — this is the correct usage pattern the
  // module docstring calls for.
  const freshTable = heading.body.find((n) => n.type === 'table');
  setTableCell(heading, freshTable, 0, 0, 'x');

  const text = serializeOrg(doc);
  assert.match(text, /A much longer paragraph than before\./);
  assert.match(text, /\| x \| b \|/);

  // Round-trips cleanly.
  const doc2 = parseOrg(text);
  assert.equal(doc2.children[0].body[0].lines[0], 'A much longer paragraph than before.');
});
