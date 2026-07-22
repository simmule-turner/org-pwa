
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import {
  buildAgendaItems,
  itemsForDate,
  itemsInRange,
  groupByDay,
  dayView,
  weekView,
  monthView,
  parseRepeater,
  expandRepeats,
} from '../src/agenda.js';

function docsFixture() {
  const nrp = parseOrg(
    [
      '* Projects',
      '** TODO Ship v0.1.0',
      'SCHEDULED: <2026-07-21 Tue>',
      '** DONE Set up test suite',
      'CLOSED: <2026-07-19 Sun>',
      '** TODO Overdue task',
      'DEADLINE: <2026-07-10 Fri>',
      '** TODO Archived-in-place task :ARCHIVE:',
      'SCHEDULED: <2026-07-22 Wed>',
    ].join('\n')
  );

  const personal = parseOrg(
    ['* TODO Dentist appointment', 'SCHEDULED: <2026-07-21 Tue 09:00>', '* TODO Pay rent', 'DEADLINE: <2026-08-01 Sat>'].join(
      '\n'
    )
  );

  return [
    { documentId: 'nrp.org', doc: nrp },
    { documentId: 'personal.org', doc: personal },
  ];
}

test('aggregates scheduled/deadline items across multiple documents', () => {
  const items = buildAgendaItems(docsFixture());
  const titles = items.map((i) => i.title);
  assert.ok(titles.includes('Ship v0.1.0'));
  assert.ok(titles.includes('Dentist appointment'));
  assert.ok(titles.includes('Pay rent'));
});

test('excludes archived (in-place) items by default', () => {
  const items = buildAgendaItems(docsFixture());
  assert.ok(!items.some((i) => i.title === 'Archived-in-place task'));
});

test('includeArchived: true includes archived items', () => {
  const items = buildAgendaItems(docsFixture(), { includeArchived: true });
  assert.ok(items.some((i) => i.title === 'Archived-in-place task'));
});

test('CLOSED-only headings (no SCHEDULED/DEADLINE) do not produce agenda items', () => {
  const items = buildAgendaItems(docsFixture());
  assert.ok(!items.some((i) => i.title === 'Set up test suite'));
});

test('items are sorted chronologically across files', () => {
  const items = buildAgendaItems(docsFixture());
  for (let i = 1; i < items.length; i++) {
    assert.ok(items[i].date >= items[i - 1].date);
  }
  assert.equal(items[0].title, 'Overdue task');
});

test('todoFilter keeps only matching headings', () => {
  const items = buildAgendaItems(docsFixture(), { todoFilter: (t) => t === 'TODO' });
  assert.ok(items.every((i) => i.todo === 'TODO'));
});

test('itemsForDate returns only items on that calendar day, across files', () => {
  const items = buildAgendaItems(docsFixture());
  const july21 = itemsForDate(items, new Date(2026, 6, 21));
  const titles = july21.map((i) => i.title).sort();
  assert.deepEqual(titles, ['Dentist appointment', 'Ship v0.1.0']);
});

test('itemsInRange returns items within an inclusive date range', () => {
  const items = buildAgendaItems(docsFixture());
  const range = itemsInRange(items, new Date(2026, 6, 20), new Date(2026, 6, 22));
  const titles = range.map((i) => i.title).sort();
  assert.deepEqual(titles, ['Dentist appointment', 'Ship v0.1.0']);
});

test('groupByDay groups and sorts by calendar day', () => {
  const items = buildAgendaItems(docsFixture());
  const grouped = groupByDay(items);
  const dates = grouped.map((g) => g.date);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted);
  const july21 = grouped.find((g) => g.date === '2026-07-21');
  assert.equal(july21.items.length, 2);
});

test('weekView returns 7 days of grouped items starting from the given date', () => {
  const items = buildAgendaItems(docsFixture());
  const week = weekView(items, new Date(2026, 6, 19)); // Sun 2026-07-19 -> Sat 2026-07-25
  for (const day of week) {
    assert.ok(day.date >= '2026-07-19' && day.date <= '2026-07-25');
  }
  // "Pay rent" (Aug 1) should not appear in this week.
  const allTitles = week.flatMap((d) => d.items.map((i) => i.title));
  assert.ok(!allTitles.includes('Pay rent'));
});

// ---- parseRepeater / expandRepeats -----------------------------------

test('parseRepeater handles all three marks and every unit', () => {
  assert.deepEqual(parseRepeater('+1w'), { mark: '+', amount: 1, unit: 'w' });
  assert.deepEqual(parseRepeater('++3d'), { mark: '++', amount: 3, unit: 'd' });
  assert.deepEqual(parseRepeater('.+1m'), { mark: '.+', amount: 1, unit: 'm' });
  assert.deepEqual(parseRepeater('+2y'), { mark: '+', amount: 2, unit: 'y' });
  assert.deepEqual(parseRepeater('+8h'), { mark: '+', amount: 8, unit: 'h' });
});

test('parseRepeater returns null for garbage input', () => {
  assert.equal(parseRepeater(null), null);
  assert.equal(parseRepeater(''), null);
  assert.equal(parseRepeater('not-a-repeater'), null);
});

test('expandRepeats: a weekly repeater produces one occurrence per week within range', () => {
  const base = new Date(2026, 0, 5); // Mon Jan 5 2026
  const rangeStart = new Date(2026, 0, 1);
  const rangeEnd = new Date(2026, 0, 31);
  const occurrences = expandRepeats(base, { amount: 1, unit: 'w' }, rangeStart, rangeEnd);
  assert.equal(occurrences.length, 4); // Jan 5, 12, 19, 26 (Feb 2 falls outside the range)
  for (let i = 1; i < occurrences.length; i++) {
    const diffDays = (occurrences[i] - occurrences[i - 1]) / (24 * 60 * 60 * 1000);
    assert.equal(diffDays, 7);
  }
});

test('expandRepeats: THE POINT OF THIS FEATURE — a repeater whose base date is years in the past still expands efficiently into a recent range', () => {
  const base = new Date(2020, 0, 1); // years before the range
  const rangeStart = new Date(2026, 6, 1);
  const rangeEnd = new Date(2026, 6, 7);
  const occurrences = expandRepeats(base, { amount: 1, unit: 'd' }, rangeStart, rangeEnd);
  assert.equal(occurrences.length, 7);
  assert.ok(occurrences[0] >= rangeStart);
  assert.ok(occurrences[occurrences.length - 1] <= rangeEnd);
});

test('expandRepeats: monthly repeater lands on the same day-of-month each time', () => {
  const base = new Date(2026, 0, 15); // Jan 15
  const occurrences = expandRepeats(base, { amount: 1, unit: 'm' }, new Date(2026, 0, 1), new Date(2026, 5, 30));
  assert.equal(occurrences.length, 6);
  for (const d of occurrences) assert.equal(d.getDate(), 15);
});

test('expandRepeats returns an empty array when nothing falls in range', () => {
  const base = new Date(2020, 0, 1);
  // Yearly from Jan 1 2020 lands on Jan 1 every year — pick a range that
  // deliberately falls *between* two of those occurrences.
  const occurrences = expandRepeats(base, { amount: 1, unit: 'y' }, new Date(2026, 5, 1), new Date(2026, 5, 2));
  assert.deepEqual(occurrences, []);
});

test('expandRepeats returns an empty array for a null/invalid repeater rather than throwing', () => {
  assert.deepEqual(expandRepeats(new Date(), null, new Date(), new Date()), []);
});

// ---- buildAgendaItems with a range (repeater expansion) -----------------

test('buildAgendaItems without a range does NOT expand repeaters (backward compatible)', () => {
  const doc = parseOrg(['* TODO Standup', 'SCHEDULED: <2026-01-05 Mon +1d>'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'x.org', doc }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].date.getDate(), 5);
});

test('buildAgendaItems with a range expands a repeating timestamp into every occurrence', () => {
  const doc = parseOrg(['* TODO Standup', 'SCHEDULED: <2026-01-05 Mon +1d>'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: new Date(2026, 0, 1),
    rangeEnd: new Date(2026, 0, 10),
  });
  assert.equal(items.length, 6); // Jan 5,6,7,8,9,10
  assert.ok(items.every((i) => i.title === 'Standup'));
});

test('buildAgendaItems with a range leaves a non-repeating item as a single occurrence', () => {
  const doc = parseOrg(['* TODO Ship it', 'SCHEDULED: <2026-01-05 Mon>'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: new Date(2026, 0, 1),
    rangeEnd: new Date(2026, 0, 31),
  });
  assert.equal(items.length, 1);
});

// ---- dayView / monthView -------------------------------------------------

test('dayView returns just the one requested day, in the same shape as weekView/monthView', () => {
  const items = buildAgendaItems(docsFixture());
  const day = dayView(items, new Date(2026, 6, 21));
  assert.equal(day.length, 1);
  assert.equal(day[0].date, '2026-07-21');
  assert.equal(day[0].items.length, 2);
});

test('monthView returns every day with items in the given calendar month, respecting month length', () => {
  const items = buildAgendaItems(docsFixture());
  const month = monthView(items, new Date(2026, 6, 1)); // July 2026 (31 days)
  for (const day of month) {
    assert.ok(day.date >= '2026-07-01' && day.date <= '2026-07-31');
  }
  const allTitles = month.flatMap((d) => d.items.map((i) => i.title));
  assert.ok(!allTitles.includes('Pay rent')); // Aug 1, outside July
});

test('monthView correctly handles a shorter month (February, including a leap year)', () => {
  const doc = parseOrg(['* TODO Leap day task', 'SCHEDULED: <2028-02-29 Tue>'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'x.org', doc }]);
  const month = monthView(items, new Date(2028, 1, 1)); // Feb 2028, a leap year
  const allDates = month.map((d) => d.date);
  assert.ok(allDates.every((d) => d <= '2028-02-29'));
  assert.ok(allDates.includes('2028-02-29'));
});
