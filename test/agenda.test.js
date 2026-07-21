
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems, itemsForDate, itemsInRange, groupByDay, weekView } from '../src/agenda.js';

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
