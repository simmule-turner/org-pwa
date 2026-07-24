import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import {
  createHeading,
  renameHeading,
  parseTagsInput,
  setHeadingTags,
  getPlanningText,
  setPlanningFromText,
  getPlainTimestampInTitle,
  setPlainTimestampInTitle,
  insertTopLevelHeading,
  insertChildHeading,
  removeHeading,
  moveHeadingUp,
  moveHeadingDown,
  promoteHeading,
  demoteHeading,
} from '../src/heading-edit.js';

test('createHeading builds a complete, valid heading with sane defaults', () => {
  const h = createHeading({ level: 2, title: 'Hello' });
  assert.equal(h.type, 'heading');
  assert.equal(h.level, 2);
  assert.equal(h.title, 'Hello');
  assert.equal(h.todo, null);
  assert.equal(h.priority, null);
  assert.deepEqual(h.tags, []);
  assert.deepEqual(h.planning, { scheduled: null, deadline: null, closed: null });
  assert.deepEqual(h.properties, {});
  assert.deepEqual(h.propertyOrder, []);
  assert.deepEqual(h.bodyLines, []);
  assert.deepEqual(h.body, []);
  assert.equal(h.collapsed, false);
  assert.deepEqual(h.children, []);
});

test('createHeading throws on an invalid level', () => {
  assert.throws(() => createHeading({ level: 0 }));
  assert.throws(() => createHeading({ level: 1.5 }));
});

test('a freshly created heading round-trips through serialize/parse', () => {
  const doc = parseOrg('');
  const h = insertTopLevelHeading(doc, { title: 'Buy milk', todo: 'TODO' });
  const text = serializeOrg(doc);
  assert.match(text, /^\* TODO Buy milk$/m);
  const doc2 = parseOrg(text);
  assert.equal(doc2.children[0].title, 'Buy milk');
  assert.equal(doc2.children[0].todo, 'TODO');
});

test('renameHeading strips newlines and trims whitespace', () => {
  const h = createHeading({ level: 1, title: 'old' });
  const result = renameHeading(h, '  New title\nwith a newline  ');
  assert.equal(result, 'New title with a newline');
  assert.equal(h.title, 'New title with a newline');
});

test('insertTopLevelHeading appends at level 1', () => {
  const doc = parseOrg('* Existing');
  const h = insertTopLevelHeading(doc, { title: 'New one' });
  assert.equal(doc.children.length, 2);
  assert.equal(doc.children[1], h);
  assert.equal(h.level, 1);
});

test('insertChildHeading is one level deeper and un-collapses the parent', () => {
  const doc = parseOrg('* Parent');
  const parent = doc.children[0];
  parent.collapsed = true;

  const child = insertChildHeading(parent, { title: 'Child' });
  assert.equal(child.level, 2);
  assert.equal(parent.children[0], child);
  assert.equal(parent.collapsed, false);
});

test('removeHeading removes a top-level heading', () => {
  const doc = parseOrg('* A\n* B');
  const b = doc.children[1];
  const removed = removeHeading(doc, b);
  assert.equal(removed, true);
  assert.equal(doc.children.length, 1);
  assert.equal(doc.children[0].title, 'A');
});

test('removeHeading removes a nested heading', () => {
  const doc = parseOrg('* Parent\n** Child');
  const child = doc.children[0].children[0];
  removeHeading(doc, child);
  assert.equal(doc.children[0].children.length, 0);
});

test('removeHeading returns false for a heading not in the doc', () => {
  const doc = parseOrg('* A');
  const orphan = createHeading({ level: 1, title: 'Not in doc' });
  assert.equal(removeHeading(doc, orphan), false);
});

test('a newly inserted-then-removed heading leaves no trace after serialize', () => {
  const doc = parseOrg('* Existing');
  const h = insertTopLevelHeading(doc, { title: 'Oops' });
  removeHeading(doc, h);
  const text = serializeOrg(doc);
  assert.equal(text, '* Existing');
});

// ---- tag editing --------------------------------------------------------

test('parseTagsInput splits on whitespace or colons and drops empties', () => {
  assert.deepEqual(parseTagsInput('urgent home01'), ['urgent', 'home01']);
  assert.deepEqual(parseTagsInput(':urgent:home01:'), ['urgent', 'home01']);
  assert.deepEqual(parseTagsInput('  urgent   home01  '), ['urgent', 'home01']);
  assert.deepEqual(parseTagsInput(''), []);
});

test('setHeadingTags replaces tags outright and strips stray colons that would corrupt serialization', () => {
  const h = createHeading({ level: 1, title: 'Test' });
  setHeadingTags(h, ['urgent', 'ho:me01']);
  assert.deepEqual(h.tags, ['urgent', 'home01']);
});

test('setHeadingTags with an empty array clears all tags', () => {
  const doc = parseOrg('* Heading :a:b:');
  setHeadingTags(doc.children[0], []);
  assert.deepEqual(doc.children[0].tags, []);
});

test('tags set via setHeadingTags round-trip correctly through serialize -> reparse', () => {
  const doc = parseOrg('* Heading');
  setHeadingTags(doc.children[0], parseTagsInput('urgent home01'));
  const doc2 = parseOrg(serializeOrg(doc));
  assert.deepEqual(doc2.children[0].tags, ['urgent', 'home01']);
  assert.equal(doc2.children[0].title, 'Heading'); // title itself is untouched by the tag change
});

// ---- planning text editing (minimal SCHEDULED/DEADLINE editor) ----------

test('getPlanningText shows SCHEDULED and DEADLINE as separate lines', () => {
  const doc = parseOrg(['* Task', 'SCHEDULED: <2026-01-05 Mon> DEADLINE: <2026-01-10 Sat>'].join('\n'));
  assert.equal(getPlanningText(doc.children[0]), 'SCHEDULED: <2026-01-05 Mon>\nDEADLINE: <2026-01-10 Sat>');
});

test('getPlanningText is empty for a heading with neither', () => {
  const doc = parseOrg('* Task');
  assert.equal(getPlanningText(doc.children[0]), '');
});

test('getPlanningText omits CLOSED even if present — not shown by this editor', () => {
  const doc = parseOrg(['* Task', 'CLOSED: [2026-01-05 Mon] SCHEDULED: <2026-01-01 Thu>'].join('\n'));
  assert.equal(getPlanningText(doc.children[0]), 'SCHEDULED: <2026-01-01 Thu>');
});

test('setPlanningFromText sets both and round-trips through serialize -> reparse', () => {
  const doc = parseOrg('* Task');
  setPlanningFromText(doc.children[0], 'SCHEDULED: <2026-01-05 Mon>\nDEADLINE: <2026-01-10 Sat>');
  const doc2 = parseOrg(serializeOrg(doc));
  assert.equal(doc2.children[0].planning.scheduled, '<2026-01-05 Mon>');
  assert.equal(doc2.children[0].planning.deadline, '<2026-01-10 Sat>');
});

test('setPlanningFromText with empty text clears both fields (a full replace)', () => {
  const doc = parseOrg(['* Task', 'SCHEDULED: <2026-01-05 Mon>'].join('\n'));
  setPlanningFromText(doc.children[0], '');
  assert.equal(doc.children[0].planning.scheduled, null);
});

test('setPlanningFromText never touches CLOSED, even on a full replace', () => {
  const doc = parseOrg(['* Task', 'CLOSED: [2026-01-05 Mon] SCHEDULED: <2026-01-01 Thu>'].join('\n'));
  setPlanningFromText(doc.children[0], 'DEADLINE: <2026-02-01 Sun>');
  assert.equal(doc.children[0].planning.closed, '[2026-01-05 Mon]');
  assert.equal(doc.children[0].planning.scheduled, null); // omitted from the text -> cleared
  assert.equal(doc.children[0].planning.deadline, '<2026-02-01 Sun>');
});

test('setPlanningFromText skips a malformed/unparseable timestamp rather than corrupting planning', () => {
  const doc = parseOrg('* Task');
  setPlanningFromText(doc.children[0], 'SCHEDULED: not-a-real-timestamp');
  assert.equal(doc.children[0].planning.scheduled, null);
});

test('setPlanningFromText only sets one field when only one line is given', () => {
  const doc = parseOrg(['* Task', 'SCHEDULED: <2026-01-05 Mon> DEADLINE: <2026-01-10 Sat>'].join('\n'));
  setPlanningFromText(doc.children[0], 'DEADLINE: <2026-02-01 Sun>');
  assert.equal(doc.children[0].planning.scheduled, null);
  assert.equal(doc.children[0].planning.deadline, '<2026-02-01 Sun>');
});

// ---- plain timestamp in title (not SCHEDULED/DEADLINE) -------------------

test('getPlainTimestampInTitle finds an existing active timestamp in the title', () => {
  const doc = parseOrg('**** Jennifer <1989-11-02 Thu +1y>');
  assert.equal(getPlainTimestampInTitle(doc.children[0]), '<1989-11-02 Thu +1y>');
});

test('getPlainTimestampInTitle returns null when there is none', () => {
  const doc = parseOrg('**** Just a heading');
  assert.equal(getPlainTimestampInTitle(doc.children[0]), null);
});

test('getPlainTimestampInTitle ignores an inactive timestamp', () => {
  const doc = parseOrg('**** Logged [2026-01-01 Thu]');
  assert.equal(getPlainTimestampInTitle(doc.children[0]), null);
});

test('setPlainTimestampInTitle appends when the title has none yet', () => {
  const doc = parseOrg('**** Jennifer');
  setPlainTimestampInTitle(doc.children[0], '<1989-11-02 Thu +1y>');
  assert.equal(doc.children[0].title, 'Jennifer <1989-11-02 Thu +1y>');
});

test('setPlainTimestampInTitle replaces an existing one in place, preserving surrounding text', () => {
  const doc = parseOrg('**** Jennifer <1989-11-02 Thu +1y> and Simmule');
  setPlainTimestampInTitle(doc.children[0], '<1990-05-01 Tue>');
  assert.equal(doc.children[0].title, 'Jennifer <1990-05-01 Tue> and Simmule');
});

test('setPlainTimestampInTitle with null clears an existing timestamp, leaving the rest of the title', () => {
  const doc = parseOrg('**** Jennifer <1989-11-02 Thu +1y> and Simmule');
  setPlainTimestampInTitle(doc.children[0], null);
  assert.equal(doc.children[0].title, 'Jennifer and Simmule');
});

test('setPlainTimestampInTitle with null on a title with no timestamp is a no-op', () => {
  const doc = parseOrg('**** Just a heading');
  setPlainTimestampInTitle(doc.children[0], null);
  assert.equal(doc.children[0].title, 'Just a heading');
});

test('round-trips correctly through serialize -> reparse', () => {
  const doc = parseOrg('**** Jennifer');
  setPlainTimestampInTitle(doc.children[0], '<1989-11-02 Thu +1y>');
  const doc2 = parseOrg(serializeOrg(doc));
  assert.equal(getPlainTimestampInTitle(doc2.children[0]), '<1989-11-02 Thu +1y>');
});

// ---- moveHeadingUp / moveHeadingDown -------------------------------------

test('moveHeadingUp swaps a heading with its previous sibling', () => {
  const doc = parseOrg('* A\n* B\n* C');
  const result = moveHeadingUp(doc, doc.children[1]); // B
  assert.equal(result, true);
  assert.deepEqual(doc.children.map((h) => h.title), ['B', 'A', 'C']);
});

test('moveHeadingUp on the first sibling is a no-op and returns false', () => {
  const doc = parseOrg('* A\n* B\n* C');
  const result = moveHeadingUp(doc, doc.children[0]); // A, already first
  assert.equal(result, false);
  assert.deepEqual(doc.children.map((h) => h.title), ['A', 'B', 'C']);
});

test('moveHeadingDown swaps a heading with its next sibling', () => {
  const doc = parseOrg('* A\n* B\n* C');
  const result = moveHeadingDown(doc, doc.children[1]); // B
  assert.equal(result, true);
  assert.deepEqual(doc.children.map((h) => h.title), ['A', 'C', 'B']);
});

test('moveHeadingDown on the last sibling is a no-op and returns false', () => {
  const doc = parseOrg('* A\n* B\n* C');
  const result = moveHeadingDown(doc, doc.children[2]); // C, already last
  assert.equal(result, false);
  assert.deepEqual(doc.children.map((h) => h.title), ['A', 'B', 'C']);
});

test('moveHeadingUp/Down carries a heading\u2019s whole subtree along automatically', () => {
  const doc = parseOrg('* A\n** A1\n** A2\n* B');
  moveHeadingDown(doc, doc.children[0]); // A (with children A1/A2) moves after B
  assert.deepEqual(doc.children.map((h) => h.title), ['B', 'A']);
  assert.deepEqual(doc.children[1].children.map((h) => h.title), ['A1', 'A2']);
  assert.match(serializeOrg(doc), /\* B\n\* A\n\*\* A1\n\*\* A2/);
});

test('moveHeadingUp/Down only reorders among the SAME parent\u2019s children, not globally', () => {
  const doc = parseOrg('* A\n** A1\n** A2\n* B');
  const result = moveHeadingUp(doc, doc.children[0].children[1]); // A2, sibling of A1
  assert.equal(result, true);
  assert.deepEqual(doc.children[0].children.map((h) => h.title), ['A2', 'A1']);
  assert.deepEqual(doc.children.map((h) => h.title), ['A', 'B']); // top level untouched
});

// ---- promoteHeading --------------------------------------------------

test('promoteHeading makes a heading a sibling of its former parent, right after it', () => {
  const doc = parseOrg('* A\n** A1\n* B');
  const a1 = doc.children[0].children[0];
  const result = promoteHeading(doc, a1);
  assert.equal(result, true);
  assert.deepEqual(doc.children.map((h) => h.title), ['A', 'A1', 'B']);
  assert.equal(doc.children[1].level, 1);
  assert.equal(doc.children[0].children.length, 0); // removed from its old parent
});

test('promoteHeading on an already-top-level heading is a no-op and returns false', () => {
  const doc = parseOrg('* A\n* B');
  const result = promoteHeading(doc, doc.children[1]);
  assert.equal(result, false);
  assert.deepEqual(doc.children.map((h) => h.title), ['A', 'B']);
});

test('promoteHeading shifts every descendant\u2019s level by the same amount, recursively', () => {
  const doc = parseOrg('* A\n** A1\n*** A1a\n* B');
  const a1 = doc.children[0].children[0];
  promoteHeading(doc, a1);
  assert.equal(a1.level, 1);
  assert.equal(a1.children[0].level, 2); // A1a was 3, now 2 -- same -1 shift
  assert.match(serializeOrg(doc), /\* A\n\* A1\n\*\* A1a\n\* B/);
});

test('promoteHeading twice moves a deeply-nested heading up two levels total', () => {
  const doc = parseOrg('* A\n** B\n*** C');
  const c = doc.children[0].children[0].children[0];
  promoteHeading(doc, c); // C becomes sibling of B, under A
  promoteHeading(doc, c); // C becomes sibling of A, top-level
  assert.equal(c.level, 1);
  assert.deepEqual(doc.children.map((h) => h.title), ['A', 'C']);
});

// ---- demoteHeading -----------------------------------------------------

test('demoteHeading makes a heading the last child of its preceding sibling', () => {
  const doc = parseOrg('* A\n* B\n* C');
  const result = demoteHeading(doc, doc.children[1]); // B, preceded by A
  assert.equal(result, true);
  assert.deepEqual(doc.children.map((h) => h.title), ['A', 'C']);
  assert.deepEqual(doc.children[0].children.map((h) => h.title), ['B']);
  assert.equal(doc.children[0].children[0].level, 2);
});

test('demoteHeading on the first heading (no preceding sibling) is a no-op and returns false', () => {
  const doc = parseOrg('* A\n* B');
  const result = demoteHeading(doc, doc.children[0]);
  assert.equal(result, false);
  assert.deepEqual(doc.children.map((h) => h.title), ['A', 'B']);
});

test('demoteHeading appends after any EXISTING children of the new parent, not before', () => {
  const doc = parseOrg('* A\n** A1\n* B');
  demoteHeading(doc, doc.children[1]); // B becomes a child of A, after A1
  assert.deepEqual(doc.children[0].children.map((h) => h.title), ['A1', 'B']);
});

test('demoteHeading shifts every descendant\u2019s level by the same amount, recursively', () => {
  const doc = parseOrg('* A\n* B\n** B1');
  demoteHeading(doc, doc.children[1]); // B (with child B1) becomes child of A
  assert.equal(doc.children[0].children[0].level, 2); // B
  assert.equal(doc.children[0].children[0].children[0].level, 3); // B1
  assert.match(serializeOrg(doc), /\* A\n\*\* B\n\*\*\* B1/);
});

test('demoteHeading un-collapses the new parent, so the demoted heading doesn\u2019t vanish from view', () => {
  const doc = parseOrg('* A\n* B');
  doc.children[0].collapsed = true; // A was collapsed (had no children before, so this was moot until now)
  demoteHeading(doc, doc.children[1]);
  assert.equal(doc.children[0].collapsed, false);
});

// ---- move/promote/demote: round-trip fidelity ----------------------------

test('moveHeadingDown then serializeOrg->parseOrg round-trips correctly', () => {
  const doc = parseOrg('* A\n:PROPERTIES:\n:ID: abc\n:END:\n* B\nsome body text');
  moveHeadingDown(doc, doc.children[0]);
  const text = serializeOrg(doc);
  const reparsed = parseOrg(text);
  assert.deepEqual(
    reparsed.children.map((h) => h.title),
    ['B', 'A']
  );
  assert.equal(reparsed.children[1].properties.ID, 'abc');
});
