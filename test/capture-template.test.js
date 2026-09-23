import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { editListItemText, setTableCell } from '../src/body-edit.js';
import {
  formatTime,
  scanPrompts,
  expandTemplate,
  expandCaptureText,
  resolveOlpTarget,
  mergeFragmentInto,
  insertCapture,
  resolveCaptureFileId,
  getCaptureFileScheme,
  computeNonCollidingKeys,
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
  assert.equal(formatTime(NOW, 'value: %Q'), 'value: %Q');
});

test('THE FEATURE: %Z (alphabetic timezone abbreviation) matches the machine\u2019s own actual timezone, computed independently -- not just re-calling formatTime() itself', () => {
  const expected = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(NOW).find((p) => p.type === 'timeZoneName').value;
  assert.equal(formatTime(NOW, '%Z'), expected);
});

test('THE FEATURE: %z (numeric \u00b1HHMM UTC offset) matches the machine\u2019s own actual offset, computed independently via the opposite sign convention getTimezoneOffset() itself uses', () => {
  const totalMinutes = -NOW.getTimezoneOffset();
  const sign = totalMinutes < 0 ? '-' : '+';
  const abs = Math.abs(totalMinutes);
  const expected = sign + String(Math.floor(abs / 60)).padStart(2, '0') + String(abs % 60).padStart(2, '0');
  assert.equal(formatTime(NOW, '%z'), expected);
  assert.match(formatTime(NOW, '%z'), /^[+-]\d{4}$/); // always exactly this shape, regardless of which zone the test happens to run in
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

// ---- expandTemplate: %\N backreferences -----------------------------------

test('THE FEATURE: %\\N re-inserts an already-given prompt answer, matching real org-mode\u2019s own capture-template backreference convention exactly', () => {
  const { text } = expandTemplate('%^{Name}: %\\1', { promptAnswers: ['Alice'] });
  assert.equal(text, 'Alice: Alice');
});

test('%\\N is 1-based and does not consume its own slot in promptAnswers -- it is a reference to an existing answer, not a new prompt', () => {
  const { text } = expandTemplate('%^{First}-%^{Second}: %\\1 / %\\2', { promptAnswers: ['A', 'B'] });
  assert.equal(text, 'A-B: A / B');
});

test('%\\N used more than once re-inserts the same answer every time', () => {
  const { text } = expandTemplate('%\\1, %\\1, %\\1', { promptAnswers: ['echo'] });
  assert.equal(text, 'echo, echo, echo');
});

test('%\\N referencing an answer that was never given (out of range) resolves to empty text, the same graceful-fallback convention every other token here already uses', () => {
  const { text } = expandTemplate('%\\5', { promptAnswers: ['only one'] });
  assert.equal(text, '');
});

test('%\\N alongside @# -- confirms the two capture groups don\u2019t collide after %\\N\u2019s own group was added ahead of @#\u2019s in the token pattern', () => {
  const { text } = expandTemplate('%\\1 row @#+3', { promptAnswers: ['Name'], tableRowNumber: 5 });
  assert.equal(text, 'Name row 8');
});

test('THE FEATURE (the exact real-world vCard template that motivated this): first/last name given once each, reused for FN and the reversed N field, without asking the person twice', () => {
  const template =
    '* %^{First Name} %^{Last Name} :%^{Category/Tag}:\n' +
    ':PROPERTIES:\n' +
    ':FN:        %\\1 %\\2\n' +
    ':N:         %\\2;%\\1;;;\n' +
    ':EMAIL:     %^{Email}\n' +
    ':END:\n';
  const answers = ['Jordan', 'Rivera', 'Work', 'jordan.rivera@example.com'];
  const { text } = expandTemplate(template, { promptAnswers: answers });
  assert.equal(
    text,
    '* Jordan Rivera :Work:\n:PROPERTIES:\n:FN:        Jordan Rivera\n:N:         Rivera;Jordan;;;\n:EMAIL:     jordan.rivera@example.com\n:END:\n'
  );
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

// ---- resolveOlpTarget: allowCreate -------------------------------------------

test('allowCreate: false, a missing segment returns null instead of creating it', () => {
  const doc = parseOrg('* Existing\n');
  const target = resolveOlpTarget(doc, ['Existing', 'Missing'], { now: NOW, allowCreate: false });
  assert.equal(target, null);
});

test('allowCreate: false leaves doc completely untouched when resolution fails', () => {
  const doc = parseOrg('* Existing\n');
  const before = serializeOrg(doc);
  resolveOlpTarget(doc, ['Existing', 'Missing'], { now: NOW, allowCreate: false });
  assert.equal(serializeOrg(doc), before);
});

test('allowCreate: false still correctly finds and returns a FULLY existing path', () => {
  const doc = parseOrg('* Logs\n** March\n*** Task\n');
  const target = resolveOlpTarget(doc, ['Logs', 'March'], { now: NOW, allowCreate: false });
  assert.equal(target, doc.children[0].children[0]);
  assert.equal(target.title, 'March');
});

test('allowCreate: false returns null even if only the LAST segment is missing (the rest of the path exists)', () => {
  const doc = parseOrg('* Logs\n** March\n');
  const target = resolveOlpTarget(doc, ['Logs', 'April'], { now: NOW, allowCreate: false });
  assert.equal(target, null);
  assert.equal(doc.children[0].children.length, 1); // "April" was NOT created
});

test('allowCreate defaults to true -- every existing caller (capture templates, etc.) is completely unaffected by this new parameter', () => {
  const doc = parseOrg('');
  const target = resolveOlpTarget(doc, ['heading 1', 'heading n'], { now: NOW }); // no allowCreate passed at all
  assert.notEqual(target, null);
  assert.equal(target.title, 'heading n');
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

// ---- insertCapture: omitEmptyEntries --------------------------------------

test('THE FEATURE: omitEmptyEntries strips a property whose own expanded value came out empty, per direct request', () => {
  const doc = parseOrg('* Contacts');
  const target = doc.children[0];
  const template = '* Jordan Rivera\n:PROPERTIES:\n:EMAIL:     jordan@example.com\n:CELL:      \n:END:\n';
  insertCapture(target, 'plain', template, false, true);
  const contact = target.children[0];
  assert.equal(contact.properties.EMAIL, 'jordan@example.com');
  assert.equal('CELL' in contact.properties, false);
  assert.equal(contact.propertyOrder.includes('CELL'), false);
});

test('omitEmptyEntries off (the default) leaves an empty property in place, matching existing behavior exactly', () => {
  const doc = parseOrg('* Contacts');
  const target = doc.children[0];
  const template = '* Jordan Rivera\n:PROPERTIES:\n:EMAIL:     jordan@example.com\n:CELL:      \n:END:\n';
  insertCapture(target, 'plain', template);
  const contact = target.children[0];
  assert.equal(contact.properties.CELL, '');
});

test('omitEmptyEntries treats a whitespace-only value the same as a truly empty one', () => {
  const doc = parseOrg('* Contacts');
  const target = doc.children[0];
  const template = '* Jordan Rivera\n:PROPERTIES:\n:NOTE:      \t \n:END:\n';
  insertCapture(target, 'plain', template, false, true);
  const contact = target.children[0];
  assert.equal('NOTE' in contact.properties, false);
});

test('omitEmptyEntries recurses into every sub-heading a plain-type capture produces, not just the top one', () => {
  const doc = parseOrg('* Root');
  const target = doc.children[0];
  const template = '* Alice\n:PROPERTIES:\n:EMAIL: alice@example.com\n:END:\n** Work\n:PROPERTIES:\n:PHONE:  \n:END:\n';
  insertCapture(target, 'plain', template, false, true);
  const alice = target.children[0];
  const work = alice.children[0];
  assert.equal('PHONE' in work.properties, false);
});

test('THE FIX: omitEmptyEntries also strips an empty plain-body "KEY:value" line, per direct follow-up report -- a template that puts its own fields directly in the body text (raw vCard content, not a :PROPERTIES: drawer) previously had nothing stripped at all', () => {
  const doc = parseOrg('* Contacts');
  const target = doc.children[0];
  const template = '* Simmule Turner\nBEGIN:VCARD\nVERSION:3.0\nFN:Simmule Turner\nEMAIL:\nTEL;TYPE=cell:\nEND:VCARD\n';
  insertCapture(target, 'plain', template, false, true);
  const contact = target.children[0];
  assert.deepEqual(contact.bodyLines, ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Simmule Turner', 'END:VCARD', '']);
});

test('omitEmptyEntries treats a multi-field vCard line (ADR, N) as empty when every field within it is blank, even though its own structural semicolons remain', () => {
  const doc = parseOrg('* Contacts');
  const target = doc.children[0];
  const template = '* Simmule Turner\nBEGIN:VCARD\nADR;TYPE=home:;;;;;;\nN:Turner;Simmule;;;\nEND:VCARD\n';
  insertCapture(target, 'plain', template, false, true);
  const contact = target.children[0];
  assert.deepEqual(contact.bodyLines, ['BEGIN:VCARD', 'N:Turner;Simmule;;;', 'END:VCARD', '']);
});

test('omitEmptyEntries leaves a non-empty plain-body line completely alone, matching real content correctly (not just detecting emptiness)', () => {
  const doc = parseOrg('* Contacts');
  const target = doc.children[0];
  const template = '* Alice\nBEGIN:VCARD\nEMAIL:alice@example.com\nEND:VCARD\n';
  insertCapture(target, 'plain', template, false, true);
  const contact = target.children[0];
  assert.deepEqual(contact.bodyLines, ['BEGIN:VCARD', 'EMAIL:alice@example.com', 'END:VCARD', '']);
});

test('THE FIX: omitEmptyEntries strips an entirely empty trailing tag ("Title ::") from the heading title, per direct follow-up report -- real org tag syntax needs at least one real tag between the colons, so an empty one was never recognized as a tag list at all and stayed as literal title text', () => {
  const doc = parseOrg('* Contacts');
  const target = doc.children[0];
  insertCapture(target, 'plain', '* Simmule Turner ::\nSome body\n', false, true);
  const contact = target.children[0];
  assert.equal(contact.title, 'Simmule Turner');
  assert.deepEqual(contact.tags, []);
});

test('a real, filled-in tag survives omitEmptyEntries untouched, alongside an empty body line stripped from the same capture', () => {
  const doc = parseOrg('* Contacts');
  const target = doc.children[0];
  const template = '* Jordan Rivera :Work:\nBEGIN:VCARD\nEMAIL:jordan@example.com\nNOTE:\nEND:VCARD\n';
  insertCapture(target, 'plain', template, false, true);
  const contact = target.children[0];
  assert.equal(contact.title, 'Jordan Rivera');
  assert.deepEqual(contact.tags, ['Work']);
  assert.deepEqual(contact.bodyLines, ['BEGIN:VCARD', 'EMAIL:jordan@example.com', 'END:VCARD', '']);
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

test('THE BUG THIS FOUND AND FIXED: a table-line capture creating a brand-new table never adds a header rule -- the captured row is plain data (e.g. a timestamp log entry), not a header, and shouldn\u2019t render bold just because it\u2019s the table\u2019s first row; no row should look like a header unless the person deliberately builds one', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  insertCapture(target, 'table-line', '| 1 | 2026-09-04 | 1200 |');
  const reparsed = parseOrg(serializeOrg(doc));
  const table = reparsed.children[0].body.find((n) => n.type === 'table');
  assert.equal(table.rows.length, 1); // the one data row, and nothing else -- specifically no trailing/leading rule row
  assert.equal(table.rows[0].type, 'row');
});

test('THE BUG THIS FOUND AND FIXED: a second table-line capture into that same newly-created (rule-free) table still appends cleanly, in both append and prepend order', () => {
  const doc = parseOrg('* Target');
  const target = doc.children[0];
  insertCapture(target, 'table-line', '| 1 | 2026-09-04 |');
  insertCapture(target, 'table-line', '| 2 | 2026-09-05 |');
  let reparsed = parseOrg(serializeOrg(doc));
  let table = reparsed.children[0].body.find((n) => n.type === 'table');
  assert.deepEqual(table.rows.map((r) => r.cells), [['1', '2026-09-04'], ['2', '2026-09-05']]);

  const doc2 = parseOrg('* Target');
  const target2 = doc2.children[0];
  insertCapture(target2, 'table-line', '| 1 | 2026-09-04 |', true);
  insertCapture(target2, 'table-line', '| 2 | 2026-09-05 |', true);
  reparsed = parseOrg(serializeOrg(doc2));
  table = reparsed.children[0].body.find((n) => n.type === 'table');
  assert.deepEqual(table.rows.map((r) => r.cells), [['2', '2026-09-05'], ['1', '2026-09-04']]);
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

test('THE BUG THIS FIXES: a relative file target no longer crashes when currentFileId is null (an unsaved, in-memory-only document)', () => {
  assert.equal(resolveCaptureFileId('journal.org', null), 'journal.org');
  assert.equal(resolveCaptureFileId('journal.org', undefined), 'journal.org');
  // A blank file still correctly resolves to "the current document itself" -- null, in this case.
  assert.equal(resolveCaptureFileId('', null), null);
  // An already-slashed path or scheme-prefixed one never needed currentFileId anyway, and still doesn't.
  assert.equal(resolveCaptureFileId('archive/journal.org', null), 'archive/journal.org');
  assert.equal(resolveCaptureFileId('github:notes.org', null), 'notes.org');
});

// ---- resolveCaptureFileId: scheme prefix (THE DATA-LOSS BUG FIX) ------------

test('THE BUG: "github:foo" now correctly resolves to match the currently-open "foo" -- previously the whole string was treated as one literal filename, meaning it NEVER matched the current document even when it was actually the exact same file, silently forcing a same-file capture down the dangerous cross-file write path', () => {
  assert.equal(resolveCaptureFileId('github:foo', 'foo'), 'foo');
});

test('scheme matching is case-insensitive, matching how a person would naturally type it', () => {
  assert.equal(resolveCaptureFileId('GitHub:foo', 'foo'), 'foo');
  assert.equal(resolveCaptureFileId('WEBDAV:foo', 'foo'), 'foo');
});

test('webdav: scheme works the same way as github:', () => {
  assert.equal(resolveCaptureFileId('webdav:notes.org', 'notes.org'), 'notes.org');
});

test('a scheme prefix combined with a bare sibling filename still resolves relative to the current directory', () => {
  assert.equal(resolveCaptureFileId('github:sibling.org', 'journal/2026.org'), 'journal/sibling.org');
});

test('a scheme prefix combined with a full path is used as-is, same as without the scheme', () => {
  assert.equal(resolveCaptureFileId('github:archive/old.org', 'notes.org'), 'archive/old.org');
});

test('an unrecognized scheme-like prefix is NOT silently stripped -- ambiguous whether ":" is a typo\u2019d scheme or a genuine (if unusual) filename character, so the safer choice is to keep treating the whole original string literally, exactly as before this fix existed', () => {
  assert.equal(resolveCaptureFileId('dropbox:foo', 'foo'), 'dropbox:foo');
});

test('bare filenames with no scheme at all are completely unaffected by this change', () => {
  assert.equal(resolveCaptureFileId('foo', 'foo'), 'foo');
  assert.equal(resolveCaptureFileId('journal.org', 'work/notes.org'), 'work/journal.org');
});

// ---- getCaptureFileScheme ----------------------------------------------------

test('getCaptureFileScheme: recognizes github and webdav, lowercased regardless of input casing', () => {
  assert.deepEqual(getCaptureFileScheme('github:foo'), { scheme: 'github', path: 'foo' });
  assert.deepEqual(getCaptureFileScheme('GitHub:foo'), { scheme: 'github', path: 'foo' });
  assert.deepEqual(getCaptureFileScheme('webdav:foo'), { scheme: 'webdav', path: 'foo' });
  assert.deepEqual(getCaptureFileScheme('WebDAV:foo'), { scheme: 'webdav', path: 'foo' });
});

test('getCaptureFileScheme: an unrecognized prefix is returned verbatim (original casing), not lowercased or normalized -- the caller decides what to do with it', () => {
  assert.deepEqual(getCaptureFileScheme('Dropbox:foo'), { scheme: 'Dropbox', path: 'foo' });
});

test('getCaptureFileScheme: no colon at all -- scheme is null, path is the whole original string', () => {
  assert.deepEqual(getCaptureFileScheme('journal/2026.org'), { scheme: null, path: 'journal/2026.org' });
  assert.deepEqual(getCaptureFileScheme('notes.org'), { scheme: null, path: 'notes.org' });
});

// ---- computeNonCollidingKeys -------------------------------------------------

test('THE EXACT REQUEST: a key claimed by more than one item is excluded entirely, not "first one wins"', () => {
  const items = [{ key: 'm', label: 'Meeting' }, { key: 'n', label: 'Note' }, { key: 'm', label: 'Memo' }];
  const result = computeNonCollidingKeys(items, (i) => i.key);
  assert.equal(result.size, 1);
  assert.equal(result.get(items[1]), 'n');
  assert.equal(result.has(items[0]), false);
  assert.equal(result.has(items[2]), false);
});

test('computeNonCollidingKeys: every key unique -- every item included', () => {
  const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  const result = computeNonCollidingKeys(items, (i) => i.key);
  assert.equal(result.size, 3);
});

test('computeNonCollidingKeys: an item with no key (empty/undefined) is skipped, doesn\u2019t count as a collision', () => {
  const items = [{ key: '' }, { key: undefined }, { key: 'a' }];
  const result = computeNonCollidingKeys(items, (i) => i.key);
  assert.equal(result.size, 1);
  assert.equal(result.get(items[2]), 'a');
});

test('computeNonCollidingKeys: empty list returns an empty map', () => {
  assert.equal(computeNonCollidingKeys([], (i) => i.key).size, 0);
});

// ---- preText/postText: expandCaptureText -----------------------------

test('THE FEATURE: expandCaptureText numbers prompts continuously across preText, template, and postText -- a %^{...} in preText is prompt #1, not restarted at 0 for each piece', () => {
  const result = expandCaptureText('#+PLOT: title:"%^{Title}"', '| %^{Week} | %^{Amount} |', 'note: %\\1', {
    promptAnswers: ['Weekly Expenses', '1', '42.5'],
  });
  assert.equal(result.preText, '#+PLOT: title:"Weekly Expenses"');
  assert.equal(result.text, '| 1 | 42.5 |');
  assert.equal(result.postText, 'note: Weekly Expenses'); // %\1 correctly reaches back into preText's own answer
});

test('expandCaptureText with no preText/postText matches a bare expandTemplate call exactly', () => {
  const bare = expandTemplate('| %^{Week} |', { promptAnswers: ['3'] });
  const combined = expandCaptureText('', '| %^{Week} |', '', { promptAnswers: ['3'] });
  assert.equal(combined.text, bare.text);
  assert.equal(combined.preText, '');
  assert.equal(combined.postText, '');
});

test('expandCaptureText passes tableRowNumber (@#) through to every piece, not just the main template', () => {
  const result = expandCaptureText('row @#', 'main @#', 'end @#', { tableRowNumber: 5 });
  assert.equal(result.preText, 'row 5');
  assert.equal(result.text, 'main 5');
  assert.equal(result.postText, 'end 5');
});

// ---- preText/postText: insertCapture, table-line (once-only) ---------

test('THE FEATURE (the exact motivating example): the first table-line capture for a target with no existing table inserts preText, the table, and postText, with the header/hline from preText merging into the SAME table as the first row', () => {
  const doc = parseOrg('* Expenses\n');
  const target = doc.children[0];
  insertCapture(
    target,
    'table-line',
    '| 1 | 42.5 |',
    false,
    false,
    '#+PLOT: title:"Weekly Expenses" ind:1 type:2d with:lines\n| Week | Amount |\n|------+--------|',
    '#+TBLFM: $2=$2;%.2f'
  );
  const lines = serializeOrg(doc).split('\n');
  assert.deepEqual(lines, [
    '* Expenses',
    '',
    '#+PLOT: title:"Weekly Expenses" ind:1 type:2d with:lines',
    '| Week | Amount |',
    '|------+--------|',
    '| 1 | 42.5 |',
    '#+TBLFM: $2=$2;%.2f',
  ]);
  // Confirms the header+hline genuinely merged into ONE table with the
  // data row (not left as separate, disconnected content): exactly one
  // table node, holding all of header/rule/data.
  assert.equal(target.body.filter((n) => n.type === 'table').length, 1);
  assert.equal(target.body[0].plot, 'title:"Weekly Expenses" ind:1 type:2d with:lines');
  assert.equal(target.body[0].tblfm, '$2=$2;%.2f');
});

test('THE FEATURE: a second table-line capture into the SAME target (table already exists) adds only a row -- preText/postText are never repeated', () => {
  const doc = parseOrg('* Expenses\n');
  const target = doc.children[0];
  insertCapture(target, 'table-line', '| 1 | 42.5 |', false, false, '#+PLOT: title:"X" ind:1', '#+TBLFM: $2=$2;%.2f');
  insertCapture(target, 'table-line', '| 2 | 18.0 |', false, false, '#+PLOT: title:"X" ind:1', '#+TBLFM: $2=$2;%.2f');
  const lines = serializeOrg(doc).split('\n');
  assert.deepEqual(lines, ['* Expenses', '', '#+PLOT: title:"X" ind:1', '| 1 | 42.5 |', '| 2 | 18.0 |', '#+TBLFM: $2=$2;%.2f']);
  assert.equal(lines.filter((l) => l.startsWith('#+PLOT:')).length, 1);
  assert.equal(lines.filter((l) => l.startsWith('#+TBLFM:')).length, 1);
});

test('table-line preText/postText do nothing at all when omitted -- matches the exact prior behavior for a template with no preText/postText fields', () => {
  const doc = parseOrg('* T\n');
  const target = doc.children[0];
  insertCapture(target, 'table-line', '| a | b |', false, false);
  assert.deepEqual(serializeOrg(doc).split('\n'), ['* T', '', '| a | b |']);
});

test('a blank-line separator is still added between preText and unrelated content that already precedes it, even though there\u2019s no separator between preText and the table itself', () => {
  const doc = parseOrg('* T\nSome existing paragraph.\n');
  const target = doc.children[0];
  insertCapture(target, 'table-line', '| a |', false, false, '#+TITLE: X');
  assert.deepEqual(serializeOrg(doc).split('\n'), ['* T', 'Some existing paragraph.', '', '#+TITLE: X', '| a |']);
});

// ---- preText/postText: insertCapture, item/checkitem/plain (every time) --

test('THE FEATURE (the exact motivating example): checkitem wraps preText/postText around EVERY invocation, not just the first', () => {
  const doc = parseOrg('* Tasks\n');
  const target = doc.children[0];
  insertCapture(target, 'checkitem', 'Buy milk', false, false, '[#A] ', ' :quick:');
  insertCapture(target, 'checkitem', 'Call dentist', false, false, '[#A] ', ' :quick:');
  assert.deepEqual(serializeOrg(doc).split('\n'), ['* Tasks', '', '- [ ] [#A] Buy milk :quick:', '- [ ] [#A] Call dentist :quick:']);
});

test('item wraps preText/postText the same way checkitem does', () => {
  const doc = parseOrg('* Notes\n');
  const target = doc.children[0];
  insertCapture(target, 'item', 'apples', false, false, 'Buy: ', ' (urgent)');
  assert.deepEqual(serializeOrg(doc).split('\n'), ['* Notes', '', '- Buy: apples (urgent)']);
});

test('plain concatenates preText + expandedText + postText directly, then parses the combined result as one fragment', () => {
  const doc = parseOrg('* Meetings\n');
  const target = doc.children[0];
  insertCapture(target, 'plain', '* Standup\nDiscussed X.\n', false, false, '', 'Filed under #+standup\n');
  const lines = serializeOrg(doc).split('\n');
  assert.ok(lines.includes('Filed under #+standup'));
  assert.ok(lines.includes('** Standup')); // nested one level under target (level 1), matching mergeFragmentInto's own level-offset behavior
});

// ---- %^t/%^T/%^u/%^U -- interactive timestamp prompts ------------------

test('THE FEATURE: scanPrompts recognizes %^t/%^T/%^u/%^U, each with the correct active/hasTime discriminator for the capture form\u2019s own date/time-picker button', () => {
  const prompts = scanPrompts('%^t %^T %^u %^U');
  assert.deepEqual(
    prompts.map((p) => p.timestamp),
    [
      { active: true, hasTime: false },
      { active: true, hasTime: true },
      { active: false, hasTime: false },
      { active: false, hasTime: true },
    ]
  );
  assert.deepEqual(
    prompts.map((p) => p.prompt),
    ['Date', 'Date & time', 'Date', 'Date & time']
  );
});

test('%^t/%^T/%^u/%^U consume promptAnswers by position exactly like %^{...}/%? already do -- whatever was typed or picked into that field is substituted verbatim', () => {
  const { text } = expandTemplate('Meeting on %^t at %^T, review by %^u, follow-up %^U', {
    promptAnswers: ['<2026-09-22 Tue>', '<2026-09-22 Tue 18:00>', '[2026-09-25 Fri]', '[2026-09-30 Wed 09:00]'],
  });
  assert.equal(text, 'Meeting on <2026-09-22 Tue> at <2026-09-22 Tue 18:00>, review by [2026-09-25 Fri], follow-up [2026-09-30 Wed 09:00]');
});

test('%^t/%^T/%^u/%^U share the same promptIndex counter as ordinary %^{...} prompts -- numbered together in reading order, not counted separately', () => {
  const prompts = scanPrompts('%^{Name} met %^t');
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].prompt, 'Name');
  assert.equal(prompts[1].timestamp.active, true);
  const { text } = expandTemplate('%^{Name} met %^t', { promptAnswers: ['Alice', '<2026-01-01 Thu>'] });
  assert.equal(text, 'Alice met <2026-01-01 Thu>');
});

test('the existing, non-interactive %t/%T/%u/%U (no caret) are unaffected -- still substitute "now" directly, never treated as prompts', () => {
  const prompts = scanPrompts('%t %T %u %U');
  assert.equal(prompts.length, 0);
});
