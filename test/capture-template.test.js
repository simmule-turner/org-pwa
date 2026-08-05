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
  resolveCaptureFileId,
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

// ---- expandTemplate: @# (real org's table row-number constant) ------------

test('expandTemplate @# substitutes the table row number', () => {
  const { text } = expandTemplate('Row @#', { now: NOW, tableRowNumber: 7 });
  assert.equal(text, 'Row 7');
});

test('expandTemplate @# is empty when no table row number is given (not a table-line capture)', () => {
  const { text } = expandTemplate('Row @#', { now: NOW });
  assert.equal(text, 'Row ');
});

test('expandTemplate @# + n adds a positive offset', () => {
  const { text } = expandTemplate('ID: @# + 3', { now: NOW, tableRowNumber: 5 });
  assert.equal(text, 'ID: 8');
});

test('expandTemplate @# - n subtracts an offset', () => {
  const { text } = expandTemplate('ID: @# - 2', { now: NOW, tableRowNumber: 5 });
  assert.equal(text, 'ID: 3');
});

test('expandTemplate @# + 0 is a no-op offset, still just the row number', () => {
  const { text } = expandTemplate('ID: @# + 0', { now: NOW, tableRowNumber: 5 });
  assert.equal(text, 'ID: 5');
});

test('expandTemplate @#+n and @#-n work with no whitespace around the operator', () => {
  assert.equal(expandTemplate('@#+3', { tableRowNumber: 5 }).text, '8');
  assert.equal(expandTemplate('@#-2', { tableRowNumber: 5 }).text, '3');
});

test('expandTemplate @# with an offset is still empty when no table row number is given', () => {
  const { text } = expandTemplate('ID: @# + 3', { now: NOW });
  assert.equal(text, 'ID: ');
});

test('expandTemplate no longer recognizes %N at all -- left as literal text, matching its replacement by @#', () => {
  const { text } = expandTemplate('Row %N', { now: NOW, tableRowNumber: 7 });
  assert.equal(text, 'Row %N');
});

// ---- expandTemplate: %<FORMAT> embedded in a template ---------------------

test('expandTemplate handles %<FORMAT> the same way formatTime does directly', () => {
  const { text } = expandTemplate('Filed on %<%Y-%m-%d>', { now: NOW });
  assert.equal(text, 'Filed on 2026-07-24');
});

// ---- expandTemplate: %? is now a prompt, gathered like any other ----------

test('a bare %? is scanned as a prompt too, labeled "Text", in document order alongside %^{...}', () => {
  const prompts = scanPrompts('before %^{First} and %? and %^{Last}');
  assert.deepEqual(
    prompts.map((p) => p.prompt),
    ['First', 'Text', 'Last']
  );
});

test('expandTemplate substitutes %?\u2019s gathered answer directly into the text', () => {
  const { text } = expandTemplate('before %? after', { now: NOW, promptAnswers: ['FILLED'] });
  assert.equal(text, 'before FILLED after');
});

test('expandTemplate leaves %? as empty text when no answer was provided for it, same as any other prompt', () => {
  const { text } = expandTemplate('before %? after', { now: NOW });
  assert.equal(text, 'before  after');
});

test('expandTemplate %? at the very start substitutes correctly there too', () => {
  const { text } = expandTemplate('%?trailing text', { now: NOW, promptAnswers: ['Start'] });
  assert.equal(text, 'Starttrailing text');
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
    ['Meeting Title', 'Text', 'Top Priority Task']
  );
  const { text } = expandTemplate(template, {
    now: NOW,
    promptAnswers: ['Q3 Planning', 'Alice, Bob', 'Finalize budget'],
  });
  assert.match(text, /^\* Q3 Planning :meeting:/);
  assert.match(text, /:CREATED: \[2026-07-24 Fri 14:30\]/);
  assert.match(text, /- Alice, Bob/);
  assert.match(text, /\*\*\* TODO \[#A\] Finalize budget$/);
});

test('THE EXACT TABLE TEMPLATE: @#, %U, and two prompts in one row', () => {
  const template = '| @# | %U | %^{Description} | %^{Amount} |';
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

// ---- resolveOlpTarget: prepend -----------------------------------------------

test('resolveOlpTarget prepend: a new top-level heading lands before existing siblings', () => {
  const doc = parseOrg('* Existing 1\n* Existing 2\n');
  resolveOlpTarget(doc, ['New Heading'], { now: NOW, prepend: true });
  assert.equal(doc.children[0].title, 'New Heading');
  assert.equal(doc.children[1].title, 'Existing 1');
  assert.equal(doc.children[2].title, 'Existing 2');
});

test('resolveOlpTarget prepend: applies independently at EVERY newly-created level of a multi-segment path', () => {
  const doc = parseOrg('* Logs\n** Existing Month\n');
  resolveOlpTarget(doc, ['Logs', 'New Month'], { now: NOW, prepend: true });
  assert.equal(doc.children[0].title, 'Logs'); // "Logs" already existed -- reused, not duplicated or reordered
  assert.equal(doc.children[0].children[0].title, 'New Month'); // the newly-created segment is first among ITS siblings
  assert.equal(doc.children[0].children[1].title, 'Existing Month');
});

test('resolveOlpTarget prepend: default (unset) is completely unaffected -- still appends, exactly as before this option existed', () => {
  const doc = parseOrg('* Existing 1\n');
  resolveOlpTarget(doc, ['New Heading'], { now: NOW });
  assert.equal(doc.children[0].title, 'Existing 1');
  assert.equal(doc.children[1].title, 'New Heading');
});

test('resolveOlpTarget prepend: an ALREADY-EXISTING segment is matched and reused as-is, never reordered or duplicated, regardless of prepend', () => {
  const doc = parseOrg('* Logs\n** March\n*** Task\n');
  const target = resolveOlpTarget(doc, ['Logs', 'March'], { now: NOW, prepend: true });
  assert.equal(doc.children.length, 1); // still just one "Logs"
  assert.equal(doc.children[0].children.length, 1); // still just one "March"
  assert.equal(target, doc.children[0].children[0]); // the SAME heading object, not a fresh duplicate
  assert.equal(target.children[0].title, 'Task'); // its own existing content untouched
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
  const { text } = expandTemplate('| @# | %U | %^{Description} | %^{Amount} |', {
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

// ---- insertCapture: prepend (real org's :prepend t) -------------------------

test('prepend item: new item lands before existing items, not after', () => {
  const doc = parseOrg('* H\n- existing item\n');
  insertCapture(doc.children[0], 'item', 'new item', true);
  const list = doc.children[0].body[0];
  assert.equal(list.items[0].text, 'new item');
  assert.equal(list.items[1].text, 'existing item');
});

test('prepend item: append (the default) is completely unaffected -- still lands after', () => {
  const doc = parseOrg('* H\n- existing item\n');
  insertCapture(doc.children[0], 'item', 'new item');
  const list = doc.children[0].body[0];
  assert.equal(list.items[0].text, 'existing item');
  assert.equal(list.items[1].text, 'new item');
});

test('prepend item: returns the prepended item itself (the first one now), not the last', () => {
  const doc = parseOrg('* H\n- existing item\n');
  const inserted = insertCapture(doc.children[0], 'item', 'new item', true);
  assert.equal(inserted.text, 'new item');
});

test('prepend checkitem: lands before existing checkitems', () => {
  const doc = parseOrg('* H\n- [ ] existing\n');
  insertCapture(doc.children[0], 'checkitem', 'new checkitem', true);
  const list = doc.children[0].body[0];
  assert.equal(list.items[0].text, 'new checkitem');
  assert.equal(list.items[1].text, 'existing');
});

test('prepend plain (producing a heading): new heading lands before existing subheadings', () => {
  const doc = parseOrg('* H\n** Existing subheading\n');
  insertCapture(doc.children[0], 'plain', '* New heading', true);
  assert.equal(doc.children[0].children[0].title, 'New heading');
  assert.equal(doc.children[0].children[1].title, 'Existing subheading');
});

test('prepend plain: returns the prepended (first) heading, not the last', () => {
  const doc = parseOrg('* H\n** Existing subheading\n');
  const inserted = insertCapture(doc.children[0], 'plain', '* New heading', true);
  assert.equal(inserted.title, 'New heading');
});

test('prepend plain (body-only, no heading produced): new text lands before existing text -- merges into the same paragraph when there\u0027s no blank line between them, matching real org\u0027s own "a blank line separates paragraphs" rule (the same as the existing append path already does)', () => {
  const doc = parseOrg('* H\nExisting paragraph.\n');
  insertCapture(doc.children[0], 'plain', 'New paragraph.', true);
  assert.equal(doc.children[0].body[0].lines.join(' '), 'New paragraph. Existing paragraph.');
});

test('prepend table-line, NO header/rule: new row lands at the very top', () => {
  const doc = parseOrg('* H\n| a | b |\n| c | d |\n');
  insertCapture(doc.children[0], 'table-line', '| x | y |', true);
  const table = doc.children[0].body[0];
  assert.deepEqual(table.rows[0].cells, ['x', 'y']);
  assert.deepEqual(table.rows[1].cells, ['a', 'b']);
});

test('prepend table-line, WITH a header row followed by a rule: new row lands right after the rule, not above the header -- this exact case surfaced a real bug during manual testing (checked the wrong row index for the rule)', () => {
  const doc = parseOrg('* H\n| col1 | col2 |\n|---+---|\n| c | d |\n');
  insertCapture(doc.children[0], 'table-line', '| x | y |', true);
  const table = doc.children[0].body[0];
  assert.deepEqual(table.rows[0].cells, ['col1', 'col2']); // header still first
  assert.equal(table.rows[1].type, 'rule'); // rule still right after the header
  assert.deepEqual(table.rows[2].cells, ['x', 'y']); // new row is the first DATA row
  assert.deepEqual(table.rows[3].cells, ['c', 'd']);
});

test('prepend table-line, brand-new table (none exists yet): prepend has nothing to prepend relative to, behaves the same as append', () => {
  const doc = parseOrg('* H\n');
  const withPrepend = insertCapture(doc.children[0], 'table-line', '| x | y |', true);
  assert.equal(withPrepend.type, 'table');
  assert.deepEqual(withPrepend.rows[0].cells, ['x', 'y']);
});

test('prepend table-line: returns the table containing the prepended row', () => {
  const doc = parseOrg('* H\n| a | b |\n');
  const table = insertCapture(doc.children[0], 'table-line', '| x | y |', true);
  assert.equal(table.type, 'table');
  assert.deepEqual(table.rows[0].cells, ['x', 'y']);
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

// ---- resolveCaptureFileId ---------------------------------------------

test('resolveCaptureFileId: a blank/unset file resolves to the current document itself', () => {
  assert.equal(resolveCaptureFileId('', 'notes.org'), 'notes.org');
  assert.equal(resolveCaptureFileId(null, 'notes.org'), 'notes.org');
  assert.equal(resolveCaptureFileId(undefined, 'notes.org'), 'notes.org');
});

test('resolveCaptureFileId: a bare filename (no "/") becomes a sibling of the current document', () => {
  assert.equal(resolveCaptureFileId('journal.org', 'notes.org'), 'journal.org');
  assert.equal(resolveCaptureFileId('journal.org', 'work/notes.org'), 'work/journal.org');
});

test('resolveCaptureFileId: a path already containing "/" is used as-is', () => {
  assert.equal(resolveCaptureFileId('archive/journal.org', 'notes.org'), 'archive/journal.org');
  assert.equal(resolveCaptureFileId('/home/user/journal.org', 'notes.org'), '/home/user/journal.org');
});

test('resolveCaptureFileId trims whitespace around the file field', () => {
  assert.equal(resolveCaptureFileId('  journal.org  ', 'notes.org'), 'journal.org');
});
