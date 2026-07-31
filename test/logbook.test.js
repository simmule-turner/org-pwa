import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLogbookEntries, formatStateLogLine } from '../src/logbook.js';

// ---- state-change lines --------------------------------------------------

test('parses a plain state-change line with a "from" clause', () => {
  const entries = parseLogbookEntries(['- State "DONE"       from "TODO"       [2026-07-31 Fri 14:22]']);
  assert.deepEqual(entries, [{ type: 'state', newState: 'DONE', oldState: 'TODO', timestamp: '[2026-07-31 Fri 14:22]', note: null }]);
});

test('parses a state-change line with NO "from" clause (no previous keyword)', () => {
  const entries = parseLogbookEntries(['- State "TODO"       [2026-07-31 Fri 08:00]']);
  assert.deepEqual(entries, [{ type: 'state', newState: 'TODO', oldState: null, timestamp: '[2026-07-31 Fri 08:00]', note: null }]);
});

test('parses a state-change line WITH a note continuation (single line)', () => {
  const entries = parseLogbookEntries([
    '- State "WAIT"       from "TODO"       [2026-07-30 Thu 09:10] \\',
    '  Blocked on vendor response.',
  ]);
  assert.deepEqual(entries, [
    { type: 'state', newState: 'WAIT', oldState: 'TODO', timestamp: '[2026-07-30 Thu 09:10]', note: 'Blocked on vendor response.' },
  ]);
});

test('parses a state-change note continuation spanning multiple lines', () => {
  const entries = parseLogbookEntries([
    '- State "WAIT"       from "TODO"       [2026-07-30 Thu 09:10] \\',
    '  First line of the note.',
    '  Second line, still part of it.',
  ]);
  assert.equal(entries[0].note, 'First line of the note.\nSecond line, still part of it.');
});

test('a state-change line with a trailing backslash but nothing indented after it has note: null, not an error', () => {
  const entries = parseLogbookEntries(['- State "DONE"       from "TODO"       [2026-07-31 Fri 14:22] \\']);
  assert.equal(entries[0].note, null);
});

test('note-continuation collection correctly stops at the next non-indented line, not consuming past the actual entry', () => {
  const entries = parseLogbookEntries([
    '- State "WAIT"       from "TODO"       [2026-07-30 Thu 09:10] \\',
    '  The note text.',
    '- State "TODO"       [2026-07-29 Wed 08:00]',
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].note, 'The note text.');
  assert.equal(entries[1].newState, 'TODO');
});

// ---- bare "Note taken on" lines ------------------------------------------

test('parses a bare "Note taken on" line with its continuation', () => {
  const entries = parseLogbookEntries(['- Note taken on [2026-07-30 Thu 09:15] \\', '  A standalone note, not tied to a state change.']);
  assert.deepEqual(entries, [{ type: 'note', timestamp: '[2026-07-30 Thu 09:15]', note: 'A standalone note, not tied to a state change.' }]);
});

// ---- CLOCK lines (recognized structurally, not acted on yet) ------------

test('parses a completed CLOCK line (start--end => duration)', () => {
  const entries = parseLogbookEntries(['CLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 10:30] =>  1:30']);
  assert.deepEqual(entries, [{ type: 'clock', start: '[2026-07-31 Fri 09:00]', end: '[2026-07-31 Fri 10:30]', duration: '1:30' }]);
});

test('parses a still-running CLOCK line (start only, no end/duration)', () => {
  const entries = parseLogbookEntries(['CLOCK: [2026-07-31 Fri 09:00]']);
  assert.deepEqual(entries, [{ type: 'clock', start: '[2026-07-31 Fri 09:00]', end: null, duration: null }]);
});

// ---- multiple entries, document order ------------------------------------

test('parses multiple entries of different types in the given order, most-recent-first matching real org', () => {
  const entries = parseLogbookEntries([
    '- State "DONE"       from "WAIT"       [2026-07-31 Fri 14:22]',
    '- State "WAIT"       from "TODO"       [2026-07-30 Thu 09:10] \\',
    '  Blocked on vendor response.',
    'CLOCK: [2026-07-29 Wed 09:00]--[2026-07-29 Wed 11:00] =>  2:00',
  ]);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].type, 'state');
  assert.equal(entries[0].newState, 'DONE');
  assert.equal(entries[1].type, 'state');
  assert.equal(entries[1].newState, 'WAIT');
  assert.equal(entries[2].type, 'clock');
});

// ---- unrecognized lines: skipped in the derived view, not an error ------

test('an unrecognized line is silently skipped in the derived entries (still present in the raw lines elsewhere)', () => {
  const entries = parseLogbookEntries(['Some completely unexpected line this parser has no idea about.']);
  assert.deepEqual(entries, []);
});

test('unrecognized lines interspersed with recognized ones only skip the unrecognized ones', () => {
  const entries = parseLogbookEntries([
    'Some weird custom line.',
    '- State "DONE"       from "TODO"       [2026-07-31 Fri 14:22]',
    'Another weird line.',
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].newState, 'DONE');
});

test('an empty drawer (no lines at all) parses to an empty array', () => {
  assert.deepEqual(parseLogbookEntries([]), []);
});

// ---- formatStateLogLine --------------------------------------------------

test('formatStateLogLine produces a single line for a bare timestamp (no note)', () => {
  const lines = formatStateLogLine('DONE', 'TODO', '[2026-07-31 Fri 14:22]');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^- State "DONE"\s+from "TODO"\s+\[2026-07-31 Fri 14:22\]$/);
});

test('formatStateLogLine omits the "from" clause when oldState is null', () => {
  const lines = formatStateLogLine('TODO', null, '[2026-07-31 Fri 08:00]');
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /from/);
  assert.match(lines[0], /^- State "TODO"\s+\[2026-07-31 Fri 08:00\]$/);
});

test('formatStateLogLine produces a trailing-backslash line plus indented continuation when a note is given', () => {
  const lines = formatStateLogLine('WAIT', 'TODO', '[2026-07-30 Thu 09:10]', 'Blocked on vendor response.');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\\$/);
  assert.equal(lines[1], '  Blocked on vendor response.');
});

test('formatStateLogLine correctly indents every line of a multi-line note', () => {
  const lines = formatStateLogLine('WAIT', 'TODO', '[2026-07-30 Thu 09:10]', 'Line one.\nLine two.');
  assert.equal(lines.length, 3);
  assert.equal(lines[1], '  Line one.');
  assert.equal(lines[2], '  Line two.');
});

test('formatStateLogLine left-justifies each quoted keyword to at least 12 characters, matching real org\u2019s own default format exactly', () => {
  const lines = formatStateLogLine('DONE', 'TODO', '[2026-07-31 Fri 14:22]');
  // "DONE" quoted is 6 chars -- padded to 12 means 6 trailing spaces before "from"
  assert.match(lines[0], /^- State "DONE" {7}from/);
});

test('a keyword whose quoted form is already >= 12 characters gets no extra padding (just the natural length)', () => {
  const lines = formatStateLogLine('WAITING-ON-REVIEW', null, '[2026-07-31 Fri 14:22]');
  assert.match(lines[0], /^- State "WAITING-ON-REVIEW" \[/);
});

// ---- round-trip: format then re-parse produces the exact same entry -----

test('round-trip: formatStateLogLine\u2019s output re-parses to the exact same entry (bare timestamp)', () => {
  const lines = formatStateLogLine('DONE', 'TODO', '[2026-07-31 Fri 14:22]');
  const reparsed = parseLogbookEntries(lines);
  assert.deepEqual(reparsed, [{ type: 'state', newState: 'DONE', oldState: 'TODO', timestamp: '[2026-07-31 Fri 14:22]', note: null }]);
});

test('round-trip: formatStateLogLine\u2019s output re-parses to the exact same entry (with a note)', () => {
  const lines = formatStateLogLine('WAIT', 'TODO', '[2026-07-30 Thu 09:10]', 'Blocked on vendor response.');
  const reparsed = parseLogbookEntries(lines);
  assert.deepEqual(reparsed, [
    { type: 'state', newState: 'WAIT', oldState: 'TODO', timestamp: '[2026-07-30 Thu 09:10]', note: 'Blocked on vendor response.' },
  ]);
});

test('round-trip: formatStateLogLine\u2019s output re-parses correctly with no oldState', () => {
  const lines = formatStateLogLine('TODO', null, '[2026-07-31 Fri 08:00]');
  const reparsed = parseLogbookEntries(lines);
  assert.deepEqual(reparsed, [{ type: 'state', newState: 'TODO', oldState: null, timestamp: '[2026-07-31 Fri 08:00]', note: null }]);
});

test('round-trip: a multi-line note formats and re-parses back to the exact same joined text', () => {
  const lines = formatStateLogLine('WAIT', 'TODO', '[2026-07-30 Thu 09:10]', 'Line one.\nLine two.');
  const reparsed = parseLogbookEntries(lines);
  assert.equal(reparsed[0].note, 'Line one.\nLine two.');
});
