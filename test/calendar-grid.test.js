import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthGrid, stepMonth, stepYear, MONTH_NAMES, buildDayMarkers } from '../src/calendar-grid.js';

// ---- buildMonthGrid ---------------------------------------------------------

test('grid length is always a multiple of 7 (padded to complete weeks)', () => {
  for (let month = 0; month < 12; month++) {
    assert.equal(buildMonthGrid(2026, month).length % 7, 0);
  }
});

test('August 2026 starts on a Saturday -- 6 leading blank cells before the 1st', () => {
  const grid = buildMonthGrid(2026, 7);
  assert.equal(new Date(2026, 7, 1).getDay(), 6); // confirm the premise
  assert.deepEqual(grid.slice(0, 6), [null, null, null, null, null, null]);
  assert.equal(grid[6].day, 1);
});

test('every real day of the month is present, in order, with the correct date', () => {
  const grid = buildMonthGrid(2026, 1); // February 2026 (28 days, not a leap year)
  const days = grid.filter((c) => c !== null);
  assert.equal(days.length, 28);
  assert.deepEqual(days.map((c) => c.day), Array.from({ length: 28 }, (_, i) => i + 1));
  assert.equal(days[0].date.getMonth(), 1);
  assert.equal(days[0].date.getDate(), 1);
});

test('leap year February has 29 days', () => {
  const grid = buildMonthGrid(2028, 1);
  assert.equal(grid.filter((c) => c !== null).length, 29);
});

test('isToday is true for exactly one cell when today falls within the displayed month', () => {
  const grid = buildMonthGrid(2026, 7, new Date(2026, 7, 12));
  const todayCells = grid.filter((c) => c && c.isToday);
  assert.equal(todayCells.length, 1);
  assert.equal(todayCells[0].day, 12);
});

test('isToday is false for every cell when today falls in a different month entirely', () => {
  const grid = buildMonthGrid(2026, 7, new Date(2026, 8, 12)); // today is September, grid is August
  assert.equal(grid.some((c) => c && c.isToday), false);
});

test('trailing cells after the last day of the month are blank, padding to a full week', () => {
  const grid = buildMonthGrid(2026, 7); // August 2026 ends on a Monday (31st)
  const lastDayIndex = grid.findIndex((c) => c && c.day === 31);
  const afterLastDay = grid.slice(lastDayIndex + 1);
  assert.ok(afterLastDay.every((c) => c === null));
});

// ---- stepMonth ---------------------------------------------------------------

test('stepMonth forward within the same year', () => {
  assert.deepEqual(stepMonth(2026, 0, 1), { year: 2026, month: 1 });
});

test('stepMonth backward within the same year', () => {
  assert.deepEqual(stepMonth(2026, 5, -1), { year: 2026, month: 4 });
});

test('stepMonth forward across a year boundary (December -> January)', () => {
  assert.deepEqual(stepMonth(2026, 11, 1), { year: 2027, month: 0 });
});

test('stepMonth backward across a year boundary (January -> December)', () => {
  assert.deepEqual(stepMonth(2026, 0, -1), { year: 2025, month: 11 });
});

test('stepMonth handles a multi-month delta that rolls over more than one year boundary', () => {
  assert.deepEqual(stepMonth(2026, 0, 14), { year: 2027, month: 2 }); // Jan 2026 + 14 months = March 2027
  assert.deepEqual(stepMonth(2026, 0, -14), { year: 2024, month: 10 }); // Jan 2026 - 14 months = Nov 2024
});

// ---- stepYear -----------------------------------------------------------------

test('stepYear forward keeps the same month', () => {
  assert.deepEqual(stepYear(2026, 7, 1), { year: 2027, month: 7 });
});

test('stepYear backward keeps the same month', () => {
  assert.deepEqual(stepYear(2026, 0, -1), { year: 2025, month: 0 });
});

// ---- MONTH_NAMES --------------------------------------------------------------

test('MONTH_NAMES has all 12 full month names in order, 0-indexed like JS Date', () => {
  assert.equal(MONTH_NAMES.length, 12);
  assert.equal(MONTH_NAMES[0], 'January');
  assert.equal(MONTH_NAMES[11], 'December');
});

// ---- buildDayMarkers ----------------------------------------------------------

function item(kind, dateStr) {
  return { kind, date: new Date(dateStr + 'T00:00:00') };
}

test('THE EXACT REQUEST: a day with a birthday AND some other event marks BOTH true (burnt orange in the UI)', () => {
  const markers = buildDayMarkers([item('anniversary', '2026-09-05'), item('scheduled', '2026-09-05')]);
  assert.deepEqual(markers.get('2026-09-05'), { hasBirthday: true, hasOther: true });
});

test('THE EXACT REQUEST: a day with only a birthday marks hasBirthday alone (green in the UI)', () => {
  const markers = buildDayMarkers([item('anniversary', '2026-09-05')]);
  assert.deepEqual(markers.get('2026-09-05'), { hasBirthday: true, hasOther: false });
});

test('THE EXACT REQUEST: a day with only some other event marks hasOther alone (blue in the UI)', () => {
  const markers = buildDayMarkers([item('scheduled', '2026-09-10')]);
  assert.deepEqual(markers.get('2026-09-10'), { hasBirthday: false, hasOther: true });
});

test('a day with nothing at all has no entry -- callers treat this as "no special color"', () => {
  const markers = buildDayMarkers([item('scheduled', '2026-09-10')]);
  assert.equal(markers.get('2026-09-15'), undefined);
});

test('deadline/timestamp/diary-sexp/sexp-timestamp all count as "other event", the same as scheduled', () => {
  for (const kind of ['deadline', 'timestamp', 'diary-sexp', 'sexp-timestamp']) {
    const markers = buildDayMarkers([item(kind, '2026-09-10')]);
    assert.equal(markers.get('2026-09-10').hasOther, true, `${kind} should count as an other-event`);
  }
});

test('THE FIX: ambient, every-day diary-sexp kinds (sunrise/sunset/civil-*/day-length/weather) and logbook entries are excluded entirely -- including them would color almost every day, making the distinction meaningless', () => {
  for (const kind of ['sunrise', 'sunset', 'civil-sunrise', 'civil-sunset', 'day-length', 'weather', 'logbook']) {
    const markers = buildDayMarkers([item(kind, '2026-09-10')]);
    assert.equal(markers.size, 0, `${kind} should be excluded from day markers entirely`);
  }
});

test('multiple different days are each classified independently', () => {
  const markers = buildDayMarkers([item('anniversary', '2026-09-05'), item('scheduled', '2026-09-10'), item('deadline', '2026-09-05')]);
  assert.deepEqual(markers.get('2026-09-05'), { hasBirthday: true, hasOther: true });
  assert.deepEqual(markers.get('2026-09-10'), { hasBirthday: false, hasOther: true });
});

test('an empty items array produces an empty map', () => {
  assert.equal(buildDayMarkers([]).size, 0);
});

test('two birthdays on the same day (e.g. two contacts) still just marks hasBirthday true once, not an error', () => {
  const markers = buildDayMarkers([item('anniversary', '2026-09-05'), item('anniversary', '2026-09-05')]);
  assert.deepEqual(markers.get('2026-09-05'), { hasBirthday: true, hasOther: false });
});
