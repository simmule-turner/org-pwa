
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrgTimestamp, findTimestamps, dateKey, isSameDay } from '../src/org-timestamp.js';

test('parses a basic active date-only timestamp', () => {
  const ts = parseOrgTimestamp('<2026-07-21 Tue>');
  assert.equal(ts.active, true);
  assert.equal(ts.hasTime, false);
  assert.equal(ts.repeater, null);
  assert.equal(ts.date.getFullYear(), 2026);
  assert.equal(ts.date.getMonth(), 6); // 0-indexed July
  assert.equal(ts.date.getDate(), 21);
});

test('parses an inactive timestamp', () => {
  const ts = parseOrgTimestamp('[2026-07-19 Sun]');
  assert.equal(ts.active, false);
});

test('parses a timestamp with a time component', () => {
  const ts = parseOrgTimestamp('<2026-07-21 Tue 14:30>');
  assert.equal(ts.hasTime, true);
  assert.equal(ts.date.getHours(), 14);
  assert.equal(ts.date.getMinutes(), 30);
});

test('parses a timestamp with a repeater', () => {
  const ts = parseOrgTimestamp('<2026-07-21 Tue +1w>');
  assert.equal(ts.repeater, '+1w');
});

test('parses a timestamp with a double-repeater style', () => {
  const ts = parseOrgTimestamp('<2026-07-21 Tue ++1m>');
  assert.equal(ts.repeater, '++1m');
});

test('returns null for garbage input', () => {
  assert.equal(parseOrgTimestamp('not a timestamp'), null);
  assert.equal(parseOrgTimestamp(''), null);
  assert.equal(parseOrgTimestamp(null), null);
});

test('rejects mismatched bracket types', () => {
  assert.equal(parseOrgTimestamp('<2026-07-21 Tue]'), null);
});

test('dateKey formats using local calendar fields', () => {
  const ts = parseOrgTimestamp('<2026-01-05 Mon>');
  assert.equal(dateKey(ts.date), '2026-01-05');
});

test('isSameDay ignores time-of-day differences', () => {
  const morning = parseOrgTimestamp('<2026-07-21 Tue 08:00>').date;
  const evening = parseOrgTimestamp('<2026-07-21 Tue 22:00>').date;
  assert.equal(isSameDay(morning, evening), true);
});

test('isSameDay distinguishes different days', () => {
  const a = parseOrgTimestamp('<2026-07-21 Tue>').date;
  const b = parseOrgTimestamp('<2026-07-22 Wed>').date;
  assert.equal(isSameDay(a, b), false);
});

// ---- findTimestamps -----------------------------------------------------

test('THE REAL-FILE CASE: finds a timestamp embedded directly in a heading title, tightly packed against a following tag', () => {
  const results = findTimestamps('Jennifer and Simmule <1989-11-02 Thu +1y>:ANNIV:');
  assert.equal(results.length, 1);
  assert.equal(results[0].active, true);
  assert.equal(results[0].repeater, '+1y');
  assert.equal(results[0].date.getFullYear(), 1989);
  assert.equal(results[0].date.getMonth(), 10); // November, 0-indexed
  assert.equal(results[0].date.getDate(), 2);
});

test('finds multiple timestamps in the same string', () => {
  const results = findTimestamps('Trip <2026-07-21 Tue> through <2026-07-25 Sat>');
  assert.equal(results.length, 2);
  assert.equal(results[0].date.getDate(), 21);
  assert.equal(results[1].date.getDate(), 25);
});

test('finds an inactive timestamp too (caller decides whether to act on active vs inactive)', () => {
  const results = findTimestamps('Logged on [2026-07-21 Tue]');
  assert.equal(results.length, 1);
  assert.equal(results[0].active, false);
});

test('returns an empty array for plain text with no timestamp at all', () => {
  assert.deepEqual(findTimestamps('Just a normal heading title'), []);
  assert.deepEqual(findTimestamps(''), []);
  assert.deepEqual(findTimestamps(null), []);
});

test('findTimestamps is reusable across repeated calls (no stale global regex state)', () => {
  // A global regex with .exec() carries lastIndex state between calls if
  // not reset properly — this would silently return wrong/empty results
  // on a second call if that state leaked.
  const first = findTimestamps('* A <2026-01-01 Thu>');
  const second = findTimestamps('* B <2026-06-01 Mon>');
  assert.equal(first[0].date.getMonth(), 0);
  assert.equal(second[0].date.getMonth(), 5);
});
