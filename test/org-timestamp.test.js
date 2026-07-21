
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrgTimestamp, dateKey, isSameDay } from '../src/org-timestamp.js';

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
