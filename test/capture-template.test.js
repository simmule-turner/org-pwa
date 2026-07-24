import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { editListItemText, setTableCell } from '../src/body-edit.js';
import {
  formatTime,
  scanPrompts,
  expandTemplate,
  resolveOlpTarget,
  mergeFragmentInto,
  insertCapture,
} from '../src/capture-template.js';

const NOW = new Date(2026, 6, 24, 14, 30, 5); // July 24 2026, 14:30:05, a Friday

// ---- formatTime (%<FORMAT>) -----------------------------------------------

test('formatTime supports the common date/time specifiers', () => {
  assert.equal(formatTime(NOW, '%Y-%m-%d'), '2026-07-24');
  assert.equal(formatTime(NOW, '%H:%M:%S'), '14:30:05');
  assert.equal(formatTime(NOW, '%Y-%m'), '2026-07');
});

test('formatTime supports weekday/month names, 12-hour time, and AM/PM', () => {
  assert.equal(formatTime(NOW, '%A, %B %d'), 'Friday, July 24');
  assert.equal(formatTime(NOW, '%a %b'), 'Fri Jul');
  assert.equal(formatTime(NOW, '%I:%M %p'), '02:30 PM');
});

test('formatTime supports %F (ISO shorthand), %R, %T, and a literal %%', () => {
  assert.equal(formatTime(NOW, '%F'), '2026-07-24');
  assert.equal(formatTime(NOW, '%R'), '14:30');
  assert.equal(formatTime(NOW, '%T'), '14:30:05');
  assert.equal(formatTime(NOW, '100%%'), '100%');
});

test('formatTime leaves an unrecognized specifier untouched rather than silently dropping it', () => {
  assert.equal(formatTime(NOW, 'value: %Z'), 'value: %Z');
});

test('formatTime zero-pads single-digit values correctly', () => {
  const earlyMorning = new Date(2026, 0, 5, 3, 7, 9); // Jan 5, 03:07:09
  assert.equal(formatTime(earlyMorning, '%Y-%m-%d %H:%M:%S'), '2026-01-05 03:07:09');
});

// ---- scanPrompts (%^{...}) -------------------------------------------------

test('scanPrompts finds a bare prompt with no default or completions', () => {
  const prompts = scanPrompts('%^{Item description}');
  assert.deepEqual(prompts, [{ prompt: 'Item description', default: '', completions: [] }]);
});

test('scanPrompts finds a prompt with a default value', () => {
  const prompts = scanPrompts('%^{Status|Pending}');
  assert.deepEqual(prompts, [{ prompt: 'Status', default: 'Pending', completions: [] }]);
});

test('scanPrompts finds a prompt with a default and completion choices', () => {
  const prompts = scanPrompts('%^{Status|Pending|Done|Cancelled}');
  assert.deepEqual(prompts, [{ prompt: 'Status', default: 'Pending', completions: ['Done', 'Cancelled'] }]);
});

test('scanPrompts finds multiple prompts in order', () => {
  const prompts = scanPrompts('%^{First} and then %^{Second}');
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].prompt, 'First');
  assert.equal(prompts[1].prompt, 'Second');
});

test('scanPrompts returns an empty array for a template with no prompts', () => {
  assert.deepEqual(scanPrompts('Just plain text, no escapes at all.'), []);
});

// ---- expandTemplate: prompts, positional matching ------------------------

test('expandTemplate substitutes prompt answers by position, not by prompt text', () => {
  const { text } = expandTemplate('%^{Name}: %^{Name}', { now: NOW, promptAnswers: ['first answer', 'second answer'] });
  // Two prompts with identical text are still two SEPARATE answers, matched by order
  assert.equal(text, 'first answer: second answer');
});

test('expandTemplate leaves a missing prompt answer as empty text rather than throwing', () => {
  const { text } = expandTemplate('%^{Name}', { now: NOW, promptAnswers: [] });
  assert.equal(text, '');
});

// ---- expandTemplate: timestamps -------------------------------------------

test('expandTemplate %t is an active, date-only timestamp', () => {
  const { text } = expandTemplate('%t', { now: NOW });
  assert.equal(text, '<2026-07-24 Fri>');
});

test('expandTemplate %T is an active timestamp with date AND time', () => {
  const { text } = expandTemplate('%T', { now: NOW });
  assert.equal(text, '<2026-07-24 Fri 14:30>');
});

test('expandTemplate %u is an INACTIVE, date-only timestamp', () => {
  const { text } = expandTemplate('%u', { now: NOW });
  assert.equal(text, '[2026-07-24 Fri]');
});

test('expandTemplate %U is an inactive timestamp with date and time', () => {
  const { text } = expandTemplate('%U', { now: NOW });
  assert.equal(text, '[2026-07-24 Fri 14:30]');
});

// ---- expandTemplate: %N (table row number) --------------------------------

test('expandTemplate %N substitutes the table row number', () => {
  const { text } = expandTemplate('Row %N', { now: NOW, tableRowNumber: 7 });
  assert.equal(text, 'Row 7');
});

test('expandTemplate %N is empty when no table row number is given (not a table-line capture)', () => {
  const { text } = expandTemplate('Row %N', { now: NOW });
  assert.equal(text, 'Row ');
});

// ---- expandTemplate: %<FORMAT> embedded in a template ---------------------

test('expandTemplate handles %<FORMAT> the same way formatTime does directly', () => {
  const { text } = expandTemplate('Filed on %<%Y-%m-%d>', { now: NOW });
  assert.equal(text, 'Filed on 2026-07-24');
});

// ---- expandTemplate: %? cursor position ------------------------------------

test('expandTemplate records the character offset where %? appeared, and removes it from the text', () => {
  const { text, cursorOffset } = expandTemplate('before %? after', { now: NOW });
  assert.equal(text, 'before  after');
  assert.equal(cursorOffset, 7);
});

test('expandTemplate cursorOffset is null when the template has no %?', () => {
  const { cursorOffset } = expandTemplate('no cursor marker here', { now: NOW });
  assert.equal(cursorOffset, null);
});

test('expandTemplate %? at the very start gives cursorOffset 0', () => {
  const { text, cursorOffset } = expandTemplate('%?trailing text', { now: NOW });
  assert.equal(cursorOffset, 0);
  assert.equal(text, 'trailing text');
});

// ---- expandTemplate: %% literal percent -----------------------------------

test('expandTemplate %% becomes a literal percent sign', () => {
  const { text } = expandTemplate('100%% complete', { now: NOW });
  assert.equal(text, '100% complete');
});

// ---- expandTemplate: THE EXACT REQUEST EXAMPLES ----------------------------

test('THE EXACT MEETING TEMPLATE: multiple prompt types, %U, and %? all together', () => {
  const template =
    '* %^{Meeting Title} :meeting:\n:PROPERTIES:\n:CREATED: %U\n:END:\n** Attendees\n- %?\n** Notes\n- \n** Action Items\n*** TODO [#A] %^{Top Priority Task}';
  const prompts = scanPrompts(template);
  assert.deepEqual(
    prompts.map((p) => p.prompt),
    ['Meeting Title', 'Top Priority Task']
  );
  const { text, cursorOffset } = expandTemplate(template, {
    now: NOW,
    promptAnswers: ['Q3 Planning', 'Finalize budget'],
  });
  assert.match(text, /^\* Q3 Planning :meeting:/);
  assert.match(text, /:CREATED: \[2026-07-24 Fri 14:30\]/);
  assert.match(text, /\*\*\* TODO \[#A\] Finalize budget$/);
  assert.ok(cursorOffset > 0 && cursorOffset < text.length, 'cursorOffset should be a valid index into the expanded text');
});

test('THE EXACT TABLE TEMPLATE: %N, %U, and two prompts in one row', () => {
  const template = '| %N | %U | %^{Description} | %^{Amount} |';
  const { text } = expandTemplate(template, {
    now: NOW,
    promptAnswers: ['Bought groceries', '45.00'],
    tableRowNumber: 3,
  });
  assert.equal(text, '| 3 | [2026-07-24 Fri 14:30] | Bought groceries | 45.00 |');
});

// ---- resolveOlpTarget ------------------------------------------------------

test('resolveOlpTarget creates the full outline path when none of it exists yet', () => {
  const doc = parseOrg('');
  const target = resolveOlpTarget(doc, ['heading 1', 'heading n'], { now: NOW });
  assert.equal(target.title, 'heading n');
  assert.equal(target.level, 2);
  assert.equal(doc.children.length, 1);
  assert.equal(doc.children[0].title, 'heading 1');
  assert.equal(doc.children[0].children[0], target);
});

test('resolveOlpTarget finds an existing path rather than creating a duplicate', () => {
  const doc = parseOrg('* heading 1\n** heading n\nexisting body content');
  const target = resolveOlpTarget(doc, ['heading 1', 'heading n'], { now: NOW });
  assert.equal(doc.children.length, 1); // no duplicate top-level heading created
  assert.equal(target.bodyLines[0], 'existing body content'); // it's the SAME heading, not a fresh empty one
});

test('resolveOlpTarget creates only the missing tail of a partially-existing path', () => {
  const doc = parseOrg('* heading 1');
  const target = resolveOlpTarget(doc, ['heading 1', 'heading n'], { now: NOW });
  assert.equal(doc.children.length, 1); // "heading 1" was reused, not duplicated
  assert.equal(doc.children[0].children.length, 1);
  assert.equal(target.title, 'heading n');
});

test('THE EXACT TABLE EXAMPLE: a %<%Y-%m> OLP segment expands to a plain, literal heading title', () => {
  const doc = parseOrg('* heading 1');
  const target = resolveOlpTarget(doc, ['heading 1', '%<%Y-%m>'], { now: NOW });
  assert.equal(target.title, '2026-07'); // not the literal string "%<%Y-%m>"
});

test('resolveOlpTarget leaves a plain (non-%<...>-wrapped) segment completely literal', () => {
  const doc = parseOrg('');
  const target = resolveOlpTarget(doc, ['100% Done'], { now: NOW }); // contains a literal % that isn't a %<...> wrapper
  assert.equal(target.title, '100% Done');
});

// ---- mergeFragmentInto -----------------------------------------------------

test('mergeFragmentInto appends heading-producing content as children with levels correctly offset', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  const fragment = parseOrg('* Sub A\n** Sub A1\n* Sub B');
  mergeFragmentInto(target, fragment);
  assert.equal(target.children.length, 2);
  assert.equal(target.children[0].level, 2); // was 1 in the fragment, offset by target's level (1)
  assert.equal(target.children[0].children[0].level, 3); // was 2, same offset
  assert.equal(target.children[1].level, 2);
});

test('mergeFragmentInto appends body-only content (no headings) directly to the target body', () => {
  const doc = parseOrg('* Target\nexisting line');
  const target = doc.children[0];
  const fragment = parseOrg('new paragraph\n- a list item');
  mergeFragmentInto(target, fragment);
  assert.equal(target.children.length, 0); // no new headings created
  assert.deepEqual(target.bodyLines, ['existing line', 'new paragraph', '- a list item']);
});

// ---- insertCapture: item -----------------------------------------------

test('insertCapture item adds a plain bullet, with the bullet syntax supplied by the type (not the template)', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  insertCapture(target, 'item', 'A captured note');
  const text = serializeOrg(doc);
  assert.match(text, /^- A captured note$/m);
});

test('insertCapture item called twice extends the same list rather than creating two separate ones', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  insertCapture(target, 'item', 'First');
  insertCapture(target, 'item', 'Second');
  const reparsed = parseOrg(serializeOrg(doc));
  const list = reparsed.children[0].body.find((n) => n.type === 'list');
  assert.equal(list.items.length, 2);
});

// ---- insertCapture: checkitem -------------------------------------------

test('insertCapture checkitem adds a checkbox item, unchecked, with the checkbox syntax supplied by the type', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  insertCapture(target, 'checkitem', 'Buy milk');
  const text = serializeOrg(doc);
  assert.match(text, /^- \[ \] Buy milk$/m);
});

// ---- insertCapture: plain ------------------------------------------------

test('insertCapture plain inserts full heading structure, correctly nested under the target', () => {
  const doc = parseOrg('* Meeting Notes');
  const target = doc.children[0];
  insertCapture(target, 'plain', '* Team Sync :meeting:\n** Attendees\n- Alice');
  const text = serializeOrg(doc);
  assert.match(text, /\*\* Team Sync :meeting:\n\*\*\* Attendees\n- Alice/);
});

test('insertCapture plain with no heading syntax at all falls back to body content', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  insertCapture(target, 'plain', 'Just a loose paragraph.');
  assert.equal(target.bodyLines[0], 'Just a loose paragraph.');
  assert.equal(target.children.length, 0);
});

// ---- insertCapture: table-line -- THE BUG THIS FOUND AND FIXED ---------

test('insertCapture table-line creates a new table when the target has none yet', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  insertCapture(target, 'table-line', '| 1 | first | 45.00 |');
  const reparsed = parseOrg(serializeOrg(doc));
  const table = reparsed.children[0].body.find((n) => n.type === 'table');
  assert.ok(table);
  const dataRow = table.rows.find((r) => r.type === 'row');
  assert.deepEqual(dataRow.cells, ['1', 'first', '45.00']);
});

test('THE BUG THIS FOUND AND FIXED: three sequential table-line captures produce three clean rows, not garbled/duplicated ones', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  insertCapture(target, 'table-line', '| 1 | first | 45.00 |');
  insertCapture(target, 'table-line', '| 2 | second | 32.50 |');
  insertCapture(target, 'table-line', '| 3 | third | 4.50 |');

  const text = serializeOrg(doc);
  const dataLines = text.split('\n').filter((l) => l.startsWith('|') && !l.includes('---'));
  assert.equal(dataLines.length, 3); // not 5+ garbled/duplicated rows
  assert.equal(dataLines[0], '| 1 | first | 45.00 |');
  assert.equal(dataLines[1], '| 2 | second | 32.50 |');
  assert.equal(dataLines[2], '| 3 | third | 4.50 |');
});

test('insertCapture table-line: each cell is set correctly, not just the first one, across many sequential captures', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  for (let i = 1; i <= 5; i++) {
    insertCapture(target, 'table-line', `| ${i} | item ${i} | ${i}.00 |`);
  }
  const reparsed = parseOrg(serializeOrg(doc));
  const table = reparsed.children[0].body.find((n) => n.type === 'table');
  const dataRows = table.rows.filter((r) => r.type === 'row');
  assert.equal(dataRows.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(dataRows[i].cells, [String(i + 1), `item ${i + 1}`, `${i + 1}.00`]);
  }
});

// ---- full end-to-end: expand + resolve + insert, using the exact request examples ----

test('END TO END: Bullet List example, exactly as specified', () => {
  const doc = parseOrg('* heading 1\n** heading n');
  const target = resolveOlpTarget(doc, ['heading 1', 'heading n'], { now: NOW });
  const { text } = expandTemplate('%? [The captured text or note]', { now: NOW, promptAnswers: [] });
  insertCapture(target, 'item', text);
  assert.match(serializeOrg(doc), /^- {2}\[The captured text or note\]$/m);
});

test('END TO END: Check List example, exactly as specified', () => {
  const doc = parseOrg('* heading 1\n** heading n');
  const target = resolveOlpTarget(doc, ['heading 1', 'heading n'], { now: NOW });
  const { text } = expandTemplate('%^{Item description}', { now: NOW, promptAnswers: ['Buy milk'] });
  insertCapture(target, 'checkitem', text);
  assert.match(serializeOrg(doc), /^- \[ \] Buy milk$/m);
});

test('END TO END: Table Insert example with dynamic %<%Y-%m> OLP segment, exactly as specified', () => {
  const doc = parseOrg('* heading 1');
  const target = resolveOlpTarget(doc, ['heading 1', '%<%Y-%m>'], { now: NOW });
  assert.equal(target.title, '2026-07');
  const { text } = expandTemplate('| %N | %U | %^{Description} | %^{Amount} |', {
    now: NOW,
    promptAnswers: ['Bought groceries', '45.00'],
    tableRowNumber: 1,
  });
  insertCapture(target, 'table-line', text);
  const result = serializeOrg(doc);
  assert.match(result, /\*\* 2026-07/);
  assert.match(result, /\| 1 \| \[2026-07-24 Fri 14:30\] \| Bought groceries \| 45\.00 \|/);
});

// ---- insertCapture return values (used by the UI for cursor positioning) --

test('insertCapture item returns the inserted list item', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  const item = insertCapture(target, 'item', 'A captured note');
  assert.equal(item.text, 'A captured note');
});

test('insertCapture checkitem returns the inserted list item, with its checkbox set', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  const item = insertCapture(target, 'checkitem', 'Buy milk');
  assert.equal(item.text, 'Buy milk');
  assert.equal(item.checkbox, ' ');
});

test('insertCapture plain returns the newly-created heading when the fragment produced one', () => {
  const doc = parseOrg('* Meeting Notes');
  const target = doc.children[0];
  const heading = insertCapture(target, 'plain', '* Team Sync :meeting:\n** Attendees\n- Alice');
  assert.equal(heading.title, 'Team Sync');
  assert.deepEqual(heading.tags, ['meeting']);
});

test('insertCapture plain returns null when the fragment was body-only (no heading produced)', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  const result = insertCapture(target, 'plain', 'Just a loose paragraph.');
  assert.equal(result, null);
});

test('insertCapture table-line returns the table', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  const table = insertCapture(target, 'table-line', '| 1 | first | 45.00 |');
  assert.equal(table.type, 'table');
});

// ---- REGRESSION: capturing into a heading with pre-existing content must -----
// ---- never corrupt/delete that content when the captured item is later edited ----
// A real, serious bug: mergeFragmentInto used to append fragment.body directly,
// but a fragment's own AST nodes carry lineIndex values relative to the
// FRAGMENT itself (starting at 0), not offset for the target's own
// pre-existing bodyLines length. Editing the captured item afterward (which
// looks up its line by lineIndex) would silently overwrite whatever
// pre-existing content actually sat at that too-low index -- data loss,
// not just a cosmetic glitch. Fixed by re-deriving target.body via
// parseBody(target.bodyLines) instead of naively appending fragment.body.

test('REGRESSION: item capture into a heading with existing content, then editing the captured item, preserves everything else', () => {
  const doc = parseOrg('* Target\nExisting first line.\nExisting second line.');
  const target = doc.children[0];
  const item = insertCapture(target, 'item', 'captured item text');
  assert.equal(item.lineIndex, 2, 'the captured item must know its REAL position, not the fragment-relative one');

  // Simulate what happens when the user edits the captured item afterward
  // (exactly what the auto-opened editor after a capture lets them do)
  editListItemText(target, item, 'EDITED');

  const text = serializeOrg(doc);
  assert.match(text, /Existing first line\./, 'first pre-existing line must survive');
  assert.match(text, /Existing second line\./, 'second pre-existing line must survive');
  assert.match(text, /EDITED/, 'the edit itself must have applied');
  assert.equal(text.split('\n').filter((l) => l.trim() !== '').length, 4); // heading + 2 existing + 1 edited item, nothing duplicated or lost
});

test('REGRESSION: checkitem capture into a heading with existing content, then editing, preserves everything else', () => {
  const doc = parseOrg('* Target\nExisting first line.\nExisting second line.');
  const target = doc.children[0];
  const item = insertCapture(target, 'checkitem', 'Buy milk');
  assert.equal(item.lineIndex, 2);
  editListItemText(target, item, 'Buy oat milk');
  const text = serializeOrg(doc);
  assert.match(text, /Existing first line\./);
  assert.match(text, /Existing second line\./);
  assert.match(text, /- \[ \] Buy oat milk/);
});

test('REGRESSION: three sequential item captures each get a correctly-offset lineIndex, and editing any one only affects that one line', () => {
  const doc = parseOrg('* Target\nExisting line.');
  const target = doc.children[0];
  const a = insertCapture(target, 'item', 'item A');
  const b = insertCapture(target, 'item', 'item B');
  const c = insertCapture(target, 'item', 'item C');
  assert.deepEqual([a.lineIndex, b.lineIndex, c.lineIndex], [1, 2, 3]);

  editListItemText(target, b, 'EDITED B ONLY');
  const text = serializeOrg(doc);
  assert.match(text, /Existing line\./);
  assert.match(text, /- item A/);
  assert.match(text, /- EDITED B ONLY/);
  assert.match(text, /- item C/);
  assert.equal(text.split('\n').filter((l) => l.trim() !== '').length, 5); // heading + existing + 3 items, nothing lost or duplicated
});

test('REGRESSION: plain capture producing body-only content (no heading) into a heading with existing content preserves it, and later edits target the right line', () => {
  const doc = parseOrg('* Target\nExisting paragraph.');
  const target = doc.children[0];
  insertCapture(target, 'plain', '- a captured list item');
  const list = target.body.find((n) => n.type === 'list');
  assert.ok(list, 'a list should have been parsed from the captured content');
  const item = list.items[0];
  editListItemText(target, item, 'EDITED plain item');
  const text = serializeOrg(doc);
  assert.match(text, /Existing paragraph\./);
  assert.match(text, /EDITED plain item/);
});

test('REGRESSION: table-line capture into a heading with existing content preserves it when a captured cell is later edited', () => {
  const doc = parseOrg('* Target\nExisting note before the table.');
  const target = doc.children[0];
  insertCapture(target, 'table-line', '| 1 | first |');
  insertCapture(target, 'table-line', '| 2 | second |');
  const table = target.body.find((n) => n.type === 'table');
  const dataRowIndices = table.rows.map((r, i) => (r.type === 'row' ? i : -1)).filter((i) => i !== -1);
  setTableCell(target, table, dataRowIndices[1], 1, 'EDITED');
  const text = serializeOrg(doc);
  assert.match(text, /Existing note before the table\./);
  assert.match(text, /\| 1 \| first \|/);
  assert.match(text, /\| 2 \| EDITED \|/);
});
