
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrgTimestamp, findTimestamps, formatOrgTimestamp, parseDelay, dateKey, isSameDay } from '../src/org-timestamp.js';

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

// ---- delay/warning-period parsing ----------------------------------------

test('parses a delay suffix on its own', () => {
  const p = parseOrgTimestamp('<2025-01-01 Wed -3d>');
  assert.equal(p.delay, '-3d');
  assert.equal(p.repeater, null);
});

test('parses a repeater AND a delay together, repeater first', () => {
  const p = parseOrgTimestamp('<2025-01-01 Wed +1m -3d>');
  assert.equal(p.repeater, '+1m');
  assert.equal(p.delay, '-3d');
});

test('delay is null when absent, same as before this change', () => {
  const p = parseOrgTimestamp('<2025-01-01 Wed>');
  assert.equal(p.delay, null);
});

test('findTimestamps also picks up delay correctly when scanning within a larger string', () => {
  const results = findTimestamps('Renew passport <2026-01-01 Thu -14d>');
  assert.equal(results.length, 1);
  assert.equal(results[0].delay, '-14d');
});

// ---- formatOrgTimestamp ---------------------------------------------------

test('formatOrgTimestamp builds a plain date-only active timestamp', () => {
  const s = formatOrgTimestamp({ date: new Date(2026, 0, 5) }); // Mon Jan 5 2026
  assert.equal(s, '<2026-01-05 Mon>');
});

test('formatOrgTimestamp builds an inactive timestamp when active: false', () => {
  const s = formatOrgTimestamp({ date: new Date(2026, 0, 5), active: false });
  assert.equal(s, '[2026-01-05 Mon]');
});

test('formatOrgTimestamp includes a time when given', () => {
  const s = formatOrgTimestamp({ date: new Date(2026, 0, 5), time: '14:30' });
  assert.equal(s, '<2026-01-05 Mon 14:30>');
});

test('formatOrgTimestamp includes a repeater when both mark and value are given', () => {
  const s = formatOrgTimestamp({ date: new Date(2026, 0, 5), repeaterMark: '+', repeaterValue: '1w' });
  assert.equal(s, '<2026-01-05 Mon +1w>');
});

test('formatOrgTimestamp omits the repeater if only the mark or only the value is given (incomplete)', () => {
  assert.equal(formatOrgTimestamp({ date: new Date(2026, 0, 5), repeaterMark: '+' }), '<2026-01-05 Mon>');
  assert.equal(formatOrgTimestamp({ date: new Date(2026, 0, 5), repeaterValue: '1w' }), '<2026-01-05 Mon>');
});

test('formatOrgTimestamp includes a delay when given', () => {
  const s = formatOrgTimestamp({ date: new Date(2026, 0, 5), delayValue: '3d' });
  assert.equal(s, '<2026-01-05 Mon -3d>');
});

test('formatOrgTimestamp combines time, repeater, and delay all together, in the correct order', () => {
  const s = formatOrgTimestamp({
    date: new Date(2026, 0, 5),
    time: '09:00',
    repeaterMark: '++',
    repeaterValue: '2w',
    delayValue: '1d',
  });
  assert.equal(s, '<2026-01-05 Mon 09:00 ++2w -1d>');
});

test('formatOrgTimestamp throws on a missing or invalid date rather than building a malformed timestamp', () => {
  assert.throws(() => formatOrgTimestamp({}));
  assert.throws(() => formatOrgTimestamp({ date: new Date('not-a-date') }));
});

test('formatOrgTimestamp round-trips correctly through parseOrgTimestamp for every field combination', () => {
  const built = formatOrgTimestamp({
    date: new Date(2026, 5, 15),
    time: '08:15',
    repeaterMark: '.+',
    repeaterValue: '3d',
    delayValue: '2d',
  });
  const parsed = parseOrgTimestamp(built);
  assert.equal(parsed.active, true);
  assert.equal(parsed.hasTime, true);
  assert.equal(parsed.date.getHours(), 8);
  assert.equal(parsed.date.getMinutes(), 15);
  assert.equal(parsed.repeater, '.+3d');
  assert.equal(parsed.delay, '-2d');
});

// ---- parseDelay -----------------------------------------------------------

test('parseDelay parses a valid delay string', () => {
  assert.deepEqual(parseDelay('-3d'), { amount: 3, unit: 'd' });
  assert.deepEqual(parseDelay('-14d'), { amount: 14, unit: 'd' });
  assert.deepEqual(parseDelay('-2w'), { amount: 2, unit: 'w' });
});

test('parseDelay returns null for garbage or a repeater-shaped string', () => {
  assert.equal(parseDelay(null), null);
  assert.equal(parseDelay(''), null);
  assert.equal(parseDelay('+3d'), null); // that's a repeater, not a delay
  assert.equal(parseDelay('not-a-delay'), null);
});
