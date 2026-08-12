
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import {
  buildAgendaItems,
  buildTaskList,
  itemsForDate,
  itemsInRange,
  groupByDay,
  dayView,
  weekView,
  monthView,
  parseRepeater,
  expandRepeats,
  carryForwardOccurrences,
  delayToDays,
  startOfDay,
  endOfDay,
  startOfWeek,
  isContactsAnniversariesTrigger,
  parseContactEvent,
  contactEventAge,
  formatContactEventLine,
  expandContactEventOccurrences,
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

test('THE BUG THIS FIXES: weekView aligns to an actual week boundary (Monday by default), not just "whatever date you passed in as day 1"', () => {
  const items = buildAgendaItems(docsFixture());
  // Wed 2026-07-22 is mid-week — the old, buggy behavior treated this as
  // day 1 of a 7-day span (July 22-28). The fix: it should resolve to the
  // week actually containing July 22, which starts Monday July 20.
  const week = weekView(items, new Date(2026, 6, 22));
  assert.equal(week.length > 0 ? week[0].date >= '2026-07-20' : true, true);
  for (const day of week) {
    assert.ok(day.date >= '2026-07-20' && day.date <= '2026-07-26', `${day.date} outside Mon-Sun window`);
  }
});

test('weekView returns the same week no matter which day within it you pass', () => {
  const items = buildAgendaItems(docsFixture());
  const fromMonday = weekView(items, new Date(2026, 6, 20));
  const fromWednesday = weekView(items, new Date(2026, 6, 22));
  const fromSunday = weekView(items, new Date(2026, 6, 26));
  assert.deepEqual(fromMonday, fromWednesday);
  assert.deepEqual(fromMonday, fromSunday);
});

test('weekView respects a configured startOnWeekday (e.g. 0 = Sunday)', () => {
  const items = buildAgendaItems(docsFixture());
  const week = weekView(items, new Date(2026, 6, 22), 0); // Wed, Sunday-start
  for (const day of week) {
    assert.ok(day.date >= '2026-07-19' && day.date <= '2026-07-25', `${day.date} outside Sun-Sat window`);
  }
});

// ---- startOfDay / endOfDay / startOfWeek ---------------------------------

test('startOfDay zeroes out the time-of-day', () => {
  const d = startOfDay(new Date(2026, 6, 22, 21, 41, 33));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getDate(), 22);
});

test('endOfDay is the last instant of the same calendar day', () => {
  const d = endOfDay(new Date(2026, 6, 22, 3, 0));
  assert.equal(d.getDate(), 22);
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 59);
});

test('startOfWeek(Monday-anchor, Wednesday) resolves to that week\'s Monday', () => {
  const monday = startOfWeek(new Date(2026, 6, 22), 1); // Wed -> Mon
  assert.equal(monday.getDate(), 20);
  assert.equal(monday.getDay(), 1);
});

test('startOfWeek already on the start day is a no-op', () => {
  const monday = startOfWeek(new Date(2026, 6, 20), 1); // already Monday
  assert.equal(monday.getDate(), 20);
});

test('startOfWeek supports Sunday-start (0) and Tuesday-start (2) too', () => {
  const wed = new Date(2026, 6, 22);
  assert.equal(startOfWeek(wed, 0).getDate(), 19); // preceding Sunday
  assert.equal(startOfWeek(wed, 2).getDate(), 21); // preceding Tuesday
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

// ---- plain timestamps embedded in heading titles (the reported gap) -----

test('THE BUG THIS FIXES: a birthday timestamp written directly in the heading title now produces an agenda item', () => {
  const doc = parseOrg('**** Jennifer and Simmule <1989-11-02 Thu +1y>:ANNIV:'.replace(':ANNIV:', ''));
  // (tag omitted here since — see the response to the user — a tag with
  // no preceding space isn't valid org tag syntax and won't parse as a
  // tag; that's unrelated to this fix, which only concerns the timestamp.)
  const items = buildAgendaItems([{ documentId: 'x.org', doc }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'timestamp');
  assert.equal(items[0].date.getFullYear(), 1989);
  assert.equal(items[0].repeater, '+1y');
});

test('a title timestamp expands with its repeater the same as SCHEDULED/DEADLINE do, when a range is given', () => {
  const doc = parseOrg('**** Jennifer <1989-11-02 Thu +1y>');
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: new Date(2026, 0, 1),
    rangeEnd: new Date(2027, 0, 1),
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].date.getFullYear(), 2026);
  assert.equal(items[0].date.getMonth(), 10);
  assert.equal(items[0].date.getDate(), 2);
});

test('an inactive timestamp in a title does NOT produce an agenda item, matching real org\'s own rule', () => {
  const doc = parseOrg('**** Logged [2026-01-01 Thu]');
  const items = buildAgendaItems([{ documentId: 'x.org', doc }]);
  assert.equal(items.length, 0);
});

test('a heading with BOTH a title timestamp and its own SCHEDULED does not double-count — SCHEDULED wins', () => {
  const doc = parseOrg(['**** Something <2026-01-01 Thu>', 'SCHEDULED: <2026-02-01 Sun>'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'x.org', doc }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'scheduled');
});

test('a heading with no timestamp anywhere produces nothing, as before', () => {
  const doc = parseOrg('**** Just a plain heading');
  assert.deepEqual(buildAgendaItems([{ documentId: 'x.org', doc }]), []);
});

test('title-timestamp items still respect todoFilter/archived filtering like every other agenda item', () => {
  const doc = parseOrg('**** Archived birthday <2026-01-01 Thu>                      :ARCHIVE:');
  const items = buildAgendaItems([{ documentId: 'x.org', doc }]);
  assert.equal(items.length, 0); // excluded by default (includeArchived: false)
});

// ---- buildAgendaItems must itself respect the requested range -----------

test('THE BUG THIS FIXES: a non-repeating item outside the requested range is excluded by buildAgendaItems itself, not just by a later dayView/weekView/monthView call', () => {
  const doc = parseOrg(['* Something far away', 'SCHEDULED: <2030-01-01 Tue>'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: new Date(2026, 0, 1),
    rangeEnd: new Date(2026, 0, 31),
  });
  assert.deepEqual(items, []);
});

test('a non-repeating item inside the requested range is still included', () => {
  const doc = parseOrg(['* Something soon', 'SCHEDULED: <2026-01-15 Thu>'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: new Date(2026, 0, 1),
    rangeEnd: new Date(2026, 0, 31),
  });
  assert.equal(items.length, 1);
});

test('without a range at all, a non-repeating item is still included regardless of its date (unchanged, existing behavior)', () => {
  const doc = parseOrg(['* Whenever', 'SCHEDULED: <2030-01-01 Tue>'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'x.org', doc }]);
  assert.equal(items.length, 1);
});

// ---- carry-forward for incomplete SCHEDULED/DEADLINE (the real bug) -----

test('THE EXACT BUG: an undone SCHEDULED item from over a year ago still shows up when viewing "today"', () => {
  const doc = parseOrg(
    ['** change to Maritime hotel in NYC.', 'SCHEDULED: <2025-07-07 Mon>'].join('\n')
  );
  const today = new Date(2026, 6, 22); // over a year after the scheduled date
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: today,
    rangeEnd: today,
    today,
    isDone: (todo) => todo === 'DONE' || todo === 'KILL',
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'scheduled');
  assert.ok(items[0].daysOverdue > 300); // roughly 380 days, don't hardcode the exact count
});

test('a DONE heading\'s SCHEDULED does NOT carry forward — it only ever shows on its literal date', () => {
  const doc = parseOrg(
    ['** DONE get clearance to contribute to organics.', 'SCHEDULED: <2025-07-07 Mon>'].join('\n')
  );
  const today = new Date(2026, 6, 22);
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: today,
    rangeEnd: today,
    today,
    isDone: (todo) => todo === 'DONE',
  });
  assert.deepEqual(items, []); // not shown today; would only show on 2025-07-07 itself
});

test('a plain title timestamp does NOT carry forward, even when undone and isDone/today are provided — matching real org\'s explicit rule', () => {
  const doc = parseOrg('**** Someone <2025-07-07 Mon>'); // no repeater, no SCHEDULED/DEADLINE
  const today = new Date(2026, 6, 22);
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: today,
    rangeEnd: today,
    today,
    isDone: () => false,
  });
  assert.deepEqual(items, []); // correctly absent -- it was over a year ago and plain timestamps never carry forward
});

test('carry-forward is opt-in: without isDone, behavior is unchanged from before (no carry-forward at all)', () => {
  const doc = parseOrg(['** Something', 'SCHEDULED: <2025-07-07 Mon>'].join('\n'));
  const today = new Date(2026, 6, 22);
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: today,
    rangeEnd: today,
    // isDone deliberately omitted
  });
  assert.deepEqual(items, []); // old behavior: literal date only, and today isn't that date
});

test('a future SCHEDULED item (not yet due) shows only on its own date, not "carried forward" before it happens', () => {
  const doc = parseOrg(['** Something upcoming', 'SCHEDULED: <2026-08-01 Sat>'].join('\n'));
  const today = new Date(2026, 6, 22); // before the scheduled date
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: new Date(2026, 6, 1),
    rangeEnd: new Date(2026, 7, 31),
    today,
    isDone: () => false,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].date.getDate(), 1);
  assert.equal(items[0].daysOverdue, 0);
});

test('an overdue DEADLINE carries forward too, not just SCHEDULED', () => {
  const doc = parseOrg(['** Something due', 'DEADLINE: <2026-07-01 Wed>'].join('\n'));
  const today = new Date(2026, 6, 22);
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: today,
    rangeEnd: today,
    today,
    isDone: () => false,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'deadline');
  assert.equal(items[0].daysOverdue, 21);
});

test('carry-forward respects a full week view: the overdue item appears on every day of the week through today, but not into the week\'s still-future days', () => {
  const doc = parseOrg(['** Overdue task', 'SCHEDULED: <2026-07-01 Wed>'].join('\n'));
  const today = new Date(2026, 6, 22); // Wed, mid-week
  const weekStart = new Date(2026, 6, 20); // Mon
  const weekEnd = new Date(2026, 6, 26); // Sun
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: weekStart,
    rangeEnd: weekEnd,
    today,
    isDone: () => false,
  });
  // Mon(20)/Tue(21)/Wed(22, today) show it as overdue; Thu-Sun (23-26)
  // are still in the future relative to "today" and correctly don't,
  // since nothing can be "overdue" on a day that hasn't happened yet.
  assert.equal(items.length, 3);
});

test('a repeating SCHEDULED item does not ALSO get carry-forward — stays scoped to its own repeat expansion', () => {
  const doc = parseOrg(['** Weekly task', 'SCHEDULED: <2026-01-05 Mon +1w>'].join('\n'));
  const today = new Date(2026, 6, 22);
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: today,
    rangeEnd: today,
    today,
    isDone: () => false,
  });
  // Jan 5 + 1w repeats land on Mondays; July 22 2026 is a Wednesday, so no occurrence lands exactly today.
  assert.deepEqual(items, []);
});

test('carryForwardOccurrences: a same-day item (not yet overdue) returns just that one day', () => {
  const today = new Date(2026, 6, 22);
  const days = carryForwardOccurrences(today, today, today, today);
  assert.equal(days.length, 1);
});

test('carryForwardOccurrences: intersects correctly with a narrower range than the full overdue window', () => {
  const itemDate = new Date(2026, 0, 1);
  const today = new Date(2026, 6, 22);
  const days = carryForwardOccurrences(itemDate, today, new Date(2026, 6, 20), new Date(2026, 6, 22));
  assert.equal(days.length, 3); // just the 3 days of the requested range, not the full ~200-day overdue span
});

test('carryForwardOccurrences: a future item returns just its own day, nothing before it', () => {
  const itemDate = new Date(2026, 7, 1);
  const today = new Date(2026, 6, 22);
  const days = carryForwardOccurrences(itemDate, today, new Date(2026, 6, 1), new Date(2026, 7, 31));
  assert.equal(days.length, 1);
  assert.equal(days[0].getDate(), 1);
  assert.equal(days[0].getMonth(), 7);
});

// ---- commented headings excluded from agenda by default -----------------

test('THE EXACT REPORTED BUG: a heading whose title starts with "#" is excluded from the agenda by default', () => {
  const doc = parseOrg(['** # fix documentation for ignore #, archive.', 'DEADLINE: <2025-06-21 Sat>'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'x.org', doc }]);
  assert.deepEqual(items, []);
});

test('a commented heading is included when includeCommented is explicitly true', () => {
  const doc = parseOrg(['** # fix documentation for ignore #, archive.', 'DEADLINE: <2025-06-21 Sat>'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], { includeCommented: true });
  assert.equal(items.length, 1);
});

test('a normal (non-commented) heading is unaffected by the commented-heading filter', () => {
  const doc = parseOrg(['** Something normal', 'SCHEDULED: <2026-01-05 Mon>'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'x.org', doc }]);
  assert.equal(items.length, 1);
});

test('a commented heading with a plain title timestamp is also excluded (not just SCHEDULED/DEADLINE)', () => {
  const doc = parseOrg('** # Someone <2026-01-05 Mon>');
  const items = buildAgendaItems([{ documentId: 'x.org', doc }]);
  assert.deepEqual(items, []);
});

// ---- delayToDays -----------------------------------------------------

test('delayToDays converts hours/days/weeks exactly', () => {
  assert.equal(delayToDays({ amount: 3, unit: 'd' }), 3);
  assert.equal(delayToDays({ amount: 2, unit: 'w' }), 14);
  assert.equal(delayToDays({ amount: 12, unit: 'h' }), 0.5);
});

test('delayToDays approximates months/years and returns 0 for null', () => {
  assert.equal(delayToDays({ amount: 1, unit: 'm' }), 30);
  assert.equal(delayToDays({ amount: 1, unit: 'y' }), 365);
  assert.equal(delayToDays(null), 0);
});

// ---- carryForwardOccurrences with an early-warning window ---------------

test('carryForwardOccurrences with earlyWarningDays starts the window before the literal date', () => {
  const itemDate = new Date(2026, 0, 10); // Jan 10
  const today = new Date(2026, 0, 5); // Jan 5 -- before the item is even due
  const days = carryForwardOccurrences(itemDate, today, new Date(2026, 0, 1), new Date(2026, 0, 31), 3);
  // Should start Jan 7 (10 - 3) and end Jan 10 (the literal date, since it's not yet overdue)
  assert.equal(days[0].getDate(), 7);
  assert.equal(days[days.length - 1].getDate(), 10);
  assert.equal(days.length, 4); // Jan 7, 8, 9, 10
});

test('carryForwardOccurrences with earlyWarningDays: 0 (default) behaves exactly as before', () => {
  const itemDate = new Date(2026, 0, 10);
  const today = new Date(2026, 0, 5);
  const days = carryForwardOccurrences(itemDate, today, new Date(2026, 0, 1), new Date(2026, 0, 31));
  assert.equal(days.length, 1);
  assert.equal(days[0].getDate(), 10);
});

// ---- buildAgendaItems: delay makes an upcoming deadline show up early ---

test('THE FEATURE THIS ADDS: a DEADLINE with a delay shows up before its literal date, with negative daysOverdue ("days until due")', () => {
  const doc = parseOrg(['** Something due soon', 'DEADLINE: <2026-01-10 Sat -3d>'].join('\n'));
  const today = new Date(2026, 0, 8); // 2 days before the deadline, within the 3-day warning window
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: today,
    rangeEnd: today,
    today,
    isDone: () => false,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].daysOverdue, -2); // 2 days until due
});

test('a DEADLINE with a delay does NOT show up before the warning window starts', () => {
  const doc = parseOrg(['** Something due later', 'DEADLINE: <2026-01-10 Sat -3d>'].join('\n'));
  const today = new Date(2026, 0, 5); // 5 days before the deadline -- outside the 3-day window
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: today,
    rangeEnd: today,
    today,
    isDone: () => false,
  });
  assert.deepEqual(items, []);
});

test('a DEADLINE with a delay still correctly carries forward (positive daysOverdue) once actually overdue', () => {
  const doc = parseOrg(['** Overdue with a delay', 'DEADLINE: <2026-01-10 Sat -3d>'].join('\n'));
  const today = new Date(2026, 0, 15); // 5 days past the deadline
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: today,
    rangeEnd: today,
    today,
    isDone: () => false,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].daysOverdue, 5);
});

test('a SCHEDULED item without any delay is completely unaffected by this feature', () => {
  const doc = parseOrg(['** Normal scheduled item', 'SCHEDULED: <2026-01-10 Sat>'].join('\n'));
  const today = new Date(2026, 0, 5);
  const items = buildAgendaItems([{ documentId: 'x.org', doc }], {
    rangeStart: today,
    rangeEnd: today,
    today,
    isDone: () => false,
  });
  assert.deepEqual(items, []); // correctly not yet shown -- 5 days before, no delay
});

// ---- buildTaskList (the date-independent global TODO list) --------------

test('THE EXACT REFERENCE SCENARIO: a TODO with no date at all shows up in the task list', () => {
  const doc = parseOrg('** TODO Something with no date attached at all');
  const items = buildTaskList([{ documentId: 'x.org', doc }], { isDone: (t) => t === 'DONE' });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Something with no date attached at all');
});

test('buildTaskList excludes DONE items, using the isDone predicate like buildAgendaItems does', () => {
  const doc = parseOrg(['** TODO Not done', '** DONE Finished'].join('\n'));
  const items = buildTaskList([{ documentId: 'x.org', doc }], { isDone: (t) => t === 'DONE' });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Not done');
});

test('buildTaskList excludes a heading with no TODO state at all', () => {
  const doc = parseOrg('** Just a normal heading, never a task');
  const items = buildTaskList([{ documentId: 'x.org', doc }], { isDone: () => false });
  assert.deepEqual(items, []);
});

test('buildTaskList without isDone includes every todo-state heading, done or not (matching buildAgendaItems\' own opt-in pattern)', () => {
  const doc = parseOrg(['** TODO Not done', '** DONE Finished'].join('\n'));
  const items = buildTaskList([{ documentId: 'x.org', doc }]);
  assert.equal(items.length, 2);
});

test('buildTaskList excludes archived and commented headings by default, same as buildAgendaItems', () => {
  const doc = parseOrg(
    ['** TODO Archived task :ARCHIVE:', '** TODO # Commented-out task'].join('\n')
  );
  const items = buildTaskList([{ documentId: 'x.org', doc }], { isDone: () => false });
  assert.deepEqual(items, []);
});

test('buildTaskList respects a tagFilter, same shape as buildAgendaItems', () => {
  const doc = parseOrg(['** TODO Tagged :work:', '** TODO Untagged'].join('\n'));
  const items = buildTaskList([{ documentId: 'x.org', doc }], {
    isDone: () => false,
    tagFilter: (tags) => tags.includes('work'),
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Tagged');
});

test('buildTaskList is completely independent of SCHEDULED/DEADLINE -- a dated TODO shows up too', () => {
  const doc = parseOrg(['** TODO Has a date', 'SCHEDULED: <2026-01-10 Sat>'].join('\n'));
  const items = buildTaskList([{ documentId: 'x.org', doc }], { isDone: () => false });
  assert.equal(items.length, 1);
});


// ---- org-contacts-anniversaries -------------------------------------------

test('isContactsAnniversariesTrigger recognizes the trigger line', () => {
  assert.equal(isContactsAnniversariesTrigger('%%(org-contacts-anniversaries)'), true);
  assert.equal(isContactsAnniversariesTrigger('  %%(org-contacts-anniversaries)  '), true);
});

test('isContactsAnniversariesTrigger rejects other lines', () => {
  assert.equal(isContactsAnniversariesTrigger('just a regular line'), false);
  assert.equal(isContactsAnniversariesTrigger('%%(org-anniversary 1990 5 15) old format'), false);
  assert.equal(isContactsAnniversariesTrigger('%%(org-contacts-anniversaries) extra text'), false);
});

test('parseContactEvent parses a valid entry with a known year', () => {
  const result = parseContactEvent('1990-05-15 Birthday');
  assert.deepEqual(result, { year: 1990, month: 5, day: 15, description: 'Birthday' });
});

test('parseContactEvent parses a nil-year entry', () => {
  const result = parseContactEvent('nil-08-22 Wedding Anniversary');
  assert.deepEqual(result, { year: null, month: 8, day: 22, description: 'Wedding Anniversary' });
});

test('parseContactEvent returns null for an out-of-range month or day', () => {
  assert.equal(parseContactEvent('1990-13-01 Birthday'), null);
  assert.equal(parseContactEvent('1990-01-32 Birthday'), null);
});

test('parseContactEvent returns null for a bare date with no description at all', () => {
  assert.equal(parseContactEvent('1990-05-15'), null);
  assert.equal(parseContactEvent('1990-05-15   '), null);
});

test('parseContactEvent returns null for garbage input', () => {
  assert.equal(parseContactEvent('not a date at all'), null);
  assert.equal(parseContactEvent(''), null);
});

test('contactEventAge computes elapsed years from the occurrence date', () => {
  assert.equal(contactEventAge(1990, new Date(2026, 4, 15)), 36);
  assert.equal(contactEventAge(2015, new Date(2026, 7, 22)), 11);
});

test('contactEventAge returns null for a null (nil) year', () => {
  assert.equal(contactEventAge(null, new Date(2026, 4, 15)), null);
});

test('formatContactEventLine builds the correct display string', () => {
  assert.equal(formatContactEventLine('John Doe', 'Birthday', 36), 'John Doe: Birthday (36)');
  assert.equal(formatContactEventLine('Mary & Jim', 'Wedding Anniversary', 11), 'Mary & Jim: Wedding Anniversary (11)');
});

test('formatContactEventLine shows "(??)" for a null (unknown) age', () => {
  assert.equal(formatContactEventLine('Someone', 'Birthday', null), 'Someone: Birthday (??)');
});

test('expandContactEventOccurrences produces one occurrence per year across a multi-year range', () => {
  const dates = expandContactEventOccurrences(5, 15, new Date(2024, 0, 1), new Date(2026, 11, 31), new Date());
  assert.deepEqual(
    dates.map((d) => d.getFullYear()),
    [2024, 2025, 2026]
  );
});

test('expandContactEventOccurrences without a range falls back to the single occurrence in today\u2019s year', () => {
  const today = new Date(2026, 6, 24);
  const dates = expandContactEventOccurrences(5, 15, null, null, today);
  assert.equal(dates.length, 1);
  assert.equal(dates[0].getFullYear(), 2026);
});

// ---- org-contacts-anniversaries: buildAgendaItems integration -------------

test('no anniversary items are produced when the trigger is absent, even with a matching property present', () => {
  const doc = parseOrg('* John Doe\n:PROPERTIES:\n:BIRTHDAY: 1990-05-15 Birthday\n:END:');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 4, 1),
    rangeEnd: new Date(2026, 4, 31),
  });
  assert.equal(items.filter((i) => i.kind === 'anniversary').length, 0);
});

test('the trigger activates a scan producing the correctly formatted agenda line, using the default BIRTHDAY property', () => {
  const doc = parseOrg(
    [
      '* John Doe',
      ':PROPERTIES:',
      ':BIRTHDAY: 1990-05-15 Birthday',
      ':END:',
      '* Anniversaries & Birthdays',
      '%%(org-contacts-anniversaries)',
    ].join('\n')
  );
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 4, 1),
    rangeEnd: new Date(2026, 4, 31),
  });
  const anniv = items.find((i) => i.kind === 'anniversary');
  assert.ok(anniv);
  assert.equal(anniv.title, 'John Doe: Birthday (36)');
  assert.equal(anniv.age, 36);
  assert.equal(anniv.hasTime, false);
});

test('a nil-year event shows "(??)" in the agenda line', () => {
  const doc = parseOrg(
    [
      '* Mary & Jim',
      ':PROPERTIES:',
      ':BIRTHDAY: nil-08-22 Wedding Anniversary',
      ':END:',
      '* Trigger',
      '%%(org-contacts-anniversaries)',
    ].join('\n')
  );
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 7, 1),
    rangeEnd: new Date(2026, 7, 31),
  });
  const anniv = items.find((i) => i.kind === 'anniversary');
  assert.ok(anniv);
  assert.equal(anniv.title, 'Mary & Jim: Wedding Anniversary (??)');
  assert.equal(anniv.age, null);
});

test('a multi-year range produces one item per year, each with the correct age', () => {
  const doc = parseOrg(
    [
      '* Person',
      ':PROPERTIES:',
      ':BIRTHDAY: 2000-03-10 Birthday',
      ':END:',
      '* Trigger',
      '%%(org-contacts-anniversaries)',
    ].join('\n')
  );
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2024, 0, 1),
    rangeEnd: new Date(2026, 11, 31),
  });
  const annivs = items.filter((i) => i.kind === 'anniversary');
  assert.equal(annivs.length, 3);
  assert.deepEqual(
    annivs.map((i) => i.age).sort((a, b) => a - b),
    [24, 25, 26]
  );
});

test('a custom birthdayProperty option is respected, case-insensitively', () => {
  const doc = parseOrg(
    ['* John Doe', ':PROPERTIES:', ':event: 1990-05-15 Birthday', ':END:', '* Trigger', '%%(org-contacts-anniversaries)'].join(
      '\n'
    )
  );
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 4, 1),
    rangeEnd: new Date(2026, 4, 31),
    birthdayProperty: 'EVENT',
  });
  const anniv = items.find((i) => i.kind === 'anniversary');
  assert.ok(anniv, 'should match :event: against birthdayProperty "EVENT" case-insensitively');
  assert.equal(anniv.title, 'John Doe: Birthday (36)');
});

test('a heading with the property in an unparseable format is silently skipped, not an error', () => {
  const doc = parseOrg(
    ['* Bad Entry', ':PROPERTIES:', ':BIRTHDAY: not a valid date', ':END:', '* Trigger', '%%(org-contacts-anniversaries)'].join(
      '\n'
    )
  );
  assert.doesNotThrow(() => {
    const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
      rangeStart: new Date(2026, 4, 1),
      rangeEnd: new Date(2026, 4, 31),
    });
    assert.equal(items.filter((i) => i.kind === 'anniversary').length, 0);
  });
});

test('a heading without the birthday property at all produces no anniversary item', () => {
  const doc = parseOrg(['* No Birthday Here', 'just a regular heading', '* Trigger', '%%(org-contacts-anniversaries)'].join('\n'));
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 4, 1),
    rangeEnd: new Date(2026, 4, 31),
  });
  assert.equal(items.filter((i) => i.kind === 'anniversary').length, 0);
});

test('the trigger works regardless of where in the document it sits, and multiple contacts all get picked up', () => {
  const doc = parseOrg(
    [
      '* Trigger heading at the top',
      '%%(org-contacts-anniversaries)',
      '* Alice',
      ':PROPERTIES:',
      ':BIRTHDAY: 1985-05-15 Birthday',
      ':END:',
      '* Bob',
      ':PROPERTIES:',
      ':BIRTHDAY: 1990-05-15 Birthday',
      ':END:',
    ].join('\n')
  );
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 4, 1),
    rangeEnd: new Date(2026, 4, 31),
  });
  const annivs = items.filter((i) => i.kind === 'anniversary');
  assert.equal(annivs.length, 2);
  assert.deepEqual(
    annivs.map((i) => i.age).sort((a, b) => a - b),
    [36, 41]
  );
});

test('anniversary items respect includeArchived (excluded by default)', () => {
  const doc = parseOrg(
    ['* Archived Person :ARCHIVE:', ':PROPERTIES:', ':BIRTHDAY: 1990-05-15 Birthday', ':END:', '* Trigger', '%%(org-contacts-anniversaries)'].join(
      '\n'
    )
  );
  const itemsDefault = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 4, 1),
    rangeEnd: new Date(2026, 4, 31),
  });
  assert.equal(itemsDefault.filter((i) => i.kind === 'anniversary').length, 0);

  const itemsIncluded = buildAgendaItems([{ documentId: 'test.org', doc }], {
    includeArchived: true,
    rangeStart: new Date(2026, 4, 1),
    rangeEnd: new Date(2026, 4, 31),
  });
  assert.equal(itemsIncluded.filter((i) => i.kind === 'anniversary').length, 1);
});

// ---- LOGBOOK entries as agenda items (includeLogbook) --------------------

test('LOGBOOK entries are excluded by default (includeLogbook defaults to false)', () => {
  const doc = parseOrg('* Order parts\n:LOGBOOK:\n- State "DONE"       from "TODO"       [2026-07-31 Fri 14:22]\n:END:\n');
  const items = buildAgendaItems([{ documentId: 't.org', doc }], {});
  assert.deepEqual(items, []);
});

test('a state-change LOGBOOK entry becomes an agenda item when includeLogbook is true', () => {
  const doc = parseOrg('* Order parts\n:LOGBOOK:\n- State "DONE"       from "TODO"       [2026-07-31 Fri 14:22]\n:END:\n');
  const items = buildAgendaItems([{ documentId: 't.org', doc }], { includeLogbook: true });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'logbook');
  assert.equal(items[0].title, 'Order parts: TODO \u2192 DONE');
  assert.equal(items[0].logNote, null);
  assert.equal(items[0].hasTime, true);
});

test('a state-change entry with NO "from" clause omits the arrow in its title, matching the LOGBOOK line itself', () => {
  const doc = parseOrg('* Order parts\n:LOGBOOK:\n- State "TODO"       [2026-07-31 Fri 08:00]\n:END:\n');
  const items = buildAgendaItems([{ documentId: 't.org', doc }], { includeLogbook: true });
  assert.equal(items[0].title, 'Order parts: TODO');
});

test('a note-carrying entry exposes the note text via logNote', () => {
  const doc = parseOrg(
    '* Order parts\n:LOGBOOK:\n- State "WAIT"       from "TODO"       [2026-07-30 Thu 09:10] \\\n  Waiting on vendor.\n:END:\n'
  );
  const items = buildAgendaItems([{ documentId: 't.org', doc }], { includeLogbook: true });
  assert.equal(items[0].logNote, 'Waiting on vendor.');
});

test('multiple LOGBOOK entries on the same heading each become their own item, sorted chronologically', () => {
  const doc = parseOrg(
    '* Order parts\n:LOGBOOK:\n- State "DONE"       from "WAIT"       [2026-07-31 Fri 14:22]\n- State "WAIT"       from "TODO"       [2026-07-30 Thu 09:10]\n:END:\n'
  );
  const items = buildAgendaItems([{ documentId: 't.org', doc }], { includeLogbook: true });
  assert.equal(items.length, 2);
  assert.ok(items[0].date < items[1].date); // sorted chronologically, oldest first, even though the file itself lists newest-first
  assert.equal(items[0].title, 'Order parts: TODO \u2192 WAIT');
  assert.equal(items[1].title, 'Order parts: WAIT \u2192 DONE');
});

test('a bare "Note taken on" entry (not tied to a state change) also becomes an agenda item', () => {
  const doc = parseOrg('* Heading\n:LOGBOOK:\n- Note taken on [2026-07-30 Thu 09:15] \\\n  A standalone note.\n:END:\n');
  const items = buildAgendaItems([{ documentId: 't.org', doc }], { includeLogbook: true });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Heading: note');
  assert.equal(items[0].logNote, 'A standalone note.');
});

test('a CLOCK entry is excluded even with includeLogbook true -- clocking isn\u0027t built yet', () => {
  const doc = parseOrg('* Heading\n:LOGBOOK:\nCLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 10:30] =>  1:30\n:END:\n');
  const items = buildAgendaItems([{ documentId: 't.org', doc }], { includeLogbook: true });
  assert.deepEqual(items, []);
});

test('LOGBOOK items respect rangeStart/rangeEnd filtering, same as other agenda item kinds', () => {
  const doc = parseOrg('* Order parts\n:LOGBOOK:\n- State "DONE"       from "TODO"       [2026-07-31 Fri 14:22]\n:END:\n');
  const inRange = buildAgendaItems([{ documentId: 't.org', doc }], {
    includeLogbook: true,
    rangeStart: new Date(2026, 6, 1),
    rangeEnd: new Date(2026, 6, 31, 23, 59, 59),
  });
  assert.equal(inRange.length, 1);

  const outOfRange = buildAgendaItems([{ documentId: 't.org', doc }], {
    includeLogbook: true,
    rangeStart: new Date(2026, 5, 1),
    rangeEnd: new Date(2026, 5, 30, 23, 59, 59),
  });
  assert.equal(outOfRange.length, 0);
});

test('a heading with no LOGBOOK content at all produces no logbook items, even with includeLogbook true', () => {
  const doc = parseOrg('* Just a heading\n');
  const items = buildAgendaItems([{ documentId: 't.org', doc }], { includeLogbook: true });
  assert.deepEqual(items, []);
});

test('LOGBOOK items still respect archived/commented exclusion, same as every other item kind', () => {
  const archived = parseOrg('* Order parts :ARCHIVE:\n:LOGBOOK:\n- State "DONE"       from "TODO"       [2026-07-31 Fri 14:22]\n:END:\n');
  const items = buildAgendaItems([{ documentId: 't.org', doc: archived }], { includeLogbook: true });
  assert.deepEqual(items, []);
});

test('LOGBOOK items interleave correctly by date with other item kinds (SCHEDULED, etc.) in the same result set', () => {
  const doc = parseOrg(
    '* A\nSCHEDULED: <2026-07-31 Fri 10:00>\n* B\n:LOGBOOK:\n- State "DONE"       from "TODO"       [2026-07-31 Fri 14:22]\n:END:\n'
  );
  const items = buildAgendaItems([{ documentId: 't.org', doc }], { includeLogbook: true });
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, 'scheduled'); // 10:00 comes before 14:22
  assert.equal(items[1].kind, 'logbook');
});

test('a real bug this coverage caught: LOGBOOK entries for a DONE heading still show in Log mode even when todoFilter excludes done headings from the normal agenda -- Log mode\u2019s whole purpose is showing history for headings that ARE now done', () => {
  const doc = parseOrg('* DONE Order parts\n:LOGBOOK:\n- State "DONE"       from "TODO"       [2026-07-31 Fri 14:22]\n:END:\n');
  const items = buildAgendaItems([{ documentId: 't.org', doc }], {
    includeLogbook: true,
    todoFilter: (todo) => todo !== 'DONE', // matches the real app's own main-agenda-call-site exclusion
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'logbook');
});

test('meanwhile, the SAME DONE heading\u2019s SCHEDULED/DEADLINE items ARE correctly still excluded by todoFilter -- only LOGBOOK items bypass it', () => {
  const doc = parseOrg('* DONE Order parts\nSCHEDULED: <2026-07-31 Fri>\n:LOGBOOK:\n- State "DONE"       from "TODO"       [2026-07-31 Fri 14:22]\n:END:\n');
  const items = buildAgendaItems([{ documentId: 't.org', doc }], {
    includeLogbook: true,
    todoFilter: (todo) => todo !== 'DONE',
  });
  assert.equal(items.length, 1); // only the logbook item, not the scheduled one
  assert.equal(items[0].kind, 'logbook');
});

// ---- THE FIX: deadline warning defaults to 14 days, matching real org -------

test('THE FIX: a DEADLINE with no explicit delay cookie starts appearing 14 days before its due date by default (real org\u2019s own confirmed default), not 0', () => {
  const doc = parseOrg('* TODO Something\nDEADLINE: <2026-08-20 Thu>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 6), // 2026-08-06 -- 14 days before the deadline
    rangeEnd: new Date(2026, 7, 6),
    today: new Date(2026, 7, 6),
  });
  const deadlineItems = items.filter((i) => i.kind === 'deadline');
  assert.equal(deadlineItems.length, 1, 'the deadline should already be showing 14 days early, by default');
});

test('THE FIX: a DEADLINE does NOT appear 15 days before its due date -- the 14-day window has a real edge, not unbounded', () => {
  const doc = parseOrg('* TODO Something\nDEADLINE: <2026-08-20 Thu>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 5), // 2026-08-05 -- 15 days before the deadline
    rangeEnd: new Date(2026, 7, 5),
    today: new Date(2026, 7, 5),
  });
  const deadlineItems = items.filter((i) => i.kind === 'deadline');
  assert.equal(deadlineItems.length, 0);
});

test('THE FIX: an explicit delay cookie on the DEADLINE itself still overrides the 14-day default, exactly as before', () => {
  const doc = parseOrg('* TODO Something\nDEADLINE: <2026-08-20 Thu -3d>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 17), // 2026-08-17 -- 3 days before, matches the explicit cookie
    rangeEnd: new Date(2026, 7, 17),
    today: new Date(2026, 7, 17),
  });
  assert.equal(items.filter((i) => i.kind === 'deadline').length, 1);

  const itemsTooEarly = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 6), // 2026-08-06 -- 14 days before, should NOT show since the explicit -3d cookie overrides the 14-day default
    rangeEnd: new Date(2026, 7, 6),
    today: new Date(2026, 7, 6),
  });
  assert.equal(itemsTooEarly.filter((i) => i.kind === 'deadline').length, 0);
});

test('THE FIX: deadlineWarningDays is explicitly configurable via the deadlineWarningDays option', () => {
  const doc = parseOrg('* TODO Something\nDEADLINE: <2026-08-20 Thu>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 13), // 7 days before
    rangeEnd: new Date(2026, 7, 13),
    today: new Date(2026, 7, 13),
    deadlineWarningDays: 7,
  });
  assert.equal(items.filter((i) => i.kind === 'deadline').length, 1);
});

test('THE FIX: SCHEDULED is deliberately unaffected by the deadline-warning default -- real org\u2019s org-deadline-warning-days only applies to DEADLINE', () => {
  const doc = parseOrg('* TODO Something\nSCHEDULED: <2026-08-20 Thu>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 13), // 7 days before -- SCHEDULED should NOT show this early with no explicit cookie
    rangeEnd: new Date(2026, 7, 13),
    today: new Date(2026, 7, 13),
  });
  assert.equal(items.filter((i) => i.kind === 'scheduled').length, 0);
});

// ---- THE FIX: SCHEDULED's own "-Nd" suffix delays, DEADLINE's own "-Nd" warns early --

test('THE FIX: a SCHEDULED "-Nd" suffix does NOT show the item early -- confirmed against the Org manual, "-Nd" delays SCHEDULED\u2019s appearance instead', () => {
  const doc = parseOrg('* TODO Something\nSCHEDULED: <2026-08-20 Thu -2d>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 18), // 2 days before -- the OLD, buggy behavior would show it here
    rangeEnd: new Date(2026, 7, 18),
    today: new Date(2026, 7, 18),
  });
  assert.equal(items.filter((i) => i.kind === 'scheduled').length, 0);
});

test('THE FIX: a SCHEDULED "-Nd" suffix does not even show on its own literal date -- the appearance is delayed past it, not just "no early warning"', () => {
  const doc = parseOrg('* TODO Something\nSCHEDULED: <2026-08-20 Thu -2d>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 20), // the literal SCHEDULED date itself
    rangeEnd: new Date(2026, 7, 20),
    today: new Date(2026, 7, 20),
  });
  assert.equal(items.filter((i) => i.kind === 'scheduled').length, 0);
});

test('THE FIX: a SCHEDULED "-Nd" suffix DOES show once the delay has actually elapsed (N days after the literal date)', () => {
  const doc = parseOrg('* TODO Something\nSCHEDULED: <2026-08-20 Thu -2d>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 22), // exactly 2 days after -- the delay has now elapsed
    rangeEnd: new Date(2026, 7, 22),
    today: new Date(2026, 7, 22),
  });
  assert.equal(items.filter((i) => i.kind === 'scheduled').length, 1);
});

test('THE FIX: once a delayed SCHEDULED item starts showing, normal carry-forward/overdue behavior continues from there', () => {
  const doc = parseOrg('* TODO Something\nSCHEDULED: <2026-08-20 Thu -2d>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 25), // well after the delayed appearance date
    rangeEnd: new Date(2026, 7, 25),
    today: new Date(2026, 7, 25),
  });
  assert.equal(items.filter((i) => i.kind === 'scheduled').length, 1);
});

test('DEADLINE\u2019s own "-Nd" suffix is completely unaffected by this fix -- it still means early warning, the opposite direction from SCHEDULED', () => {
  const doc = parseOrg('* TODO Something\nDEADLINE: <2026-08-20 Thu -3d>\n');
  const early = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 17), // 3 days before -- should show, matching DEADLINE's own early-warning direction
    rangeEnd: new Date(2026, 7, 17),
    today: new Date(2026, 7, 17),
  });
  assert.equal(early.filter((i) => i.kind === 'deadline').length, 1);

  const tooEarly = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 16), // 4 days before -- should NOT show yet
    rangeEnd: new Date(2026, 7, 16),
    today: new Date(2026, 7, 16),
  });
  assert.equal(tooEarly.filter((i) => i.kind === 'deadline').length, 0);
});

test('a SCHEDULED item with NO delay suffix at all is completely unaffected -- shows on its own literal date as always', () => {
  const doc = parseOrg('* TODO Something\nSCHEDULED: <2026-08-20 Thu>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    todoFilter: () => true,
    isDone: () => false,
    rangeStart: new Date(2026, 7, 20),
    rangeEnd: new Date(2026, 7, 20),
    today: new Date(2026, 7, 20),
  });
  assert.equal(items.filter((i) => i.kind === 'scheduled').length, 1);
});

// ---- <%%(sexp)> timestamps (real org's own general sexp timestamp form) ----

test('THE EXACT REQUEST: <%%(when (today-p) (diary-sunrise-sunset))> shows sunrise/sunset ONLY on today\u2019s own agenda entry', () => {
  const doc = parseOrg("* Today's Sun Times <%%(when (today-p) (diary-sunrise-sunset))>\n");
  const today = new Date(2026, 7, 12);
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 7, 10),
    rangeEnd: new Date(2026, 7, 14),
    today,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].date.toDateString(), today.toDateString());
  assert.equal(items[0].kind, 'sexp-timestamp');
  assert.match(items[0].title, /^Today's Sun Times: Sunrise/);
});

test('THE EXACT EXAMPLE: weekly sunrise/sunset combining when + org-cyclic + diary-sunrise-sunset', () => {
  const doc = parseOrg('* Weekly Sunrise/Sunset <%%(when (org-cyclic 7 2026 8 9) (diary-sunrise-sunset))>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 7, 1),
    rangeEnd: new Date(2026, 7, 16),
  });
  const dates = items.map((i) => i.date.getDate());
  assert.deepEqual(dates, [9, 16]); // every 7 days from the Aug 9 baseline
  assert.match(items[0].title, /^Weekly Sunrise\/Sunset: Sunrise/);
});

test('THE EXACT EXAMPLE: <%%(diary-float t 6 1)> -- first Saturday of every month, as a heading\u2019s own timestamp', () => {
  const doc = parseOrg('* TODO Team Sync <%%(diary-float t 6 1)>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 7, 1),
    rangeEnd: new Date(2026, 8, 30),
  });
  assert.equal(items.length, 2); // one per month
  assert.equal(items[0].date.getDate(), 1); // Aug 1, 2026 is a Saturday
  assert.equal(items[0].todo, 'TODO');
  assert.equal(items[0].title, 'Team Sync'); // the raw <%%(...)> text is stripped from the display title
});

test('THE EXACT EXAMPLE: <%%(org-cyclic 3 2026 1 1)> -- every 3 days, as a heading\u2019s own timestamp', () => {
  const doc = parseOrg('* Water the plants <%%(org-cyclic 3 2026 1 1)>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 0, 1),
    rangeEnd: new Date(2026, 0, 10),
  });
  const dates = items.map((i) => i.date.getDate());
  assert.deepEqual(dates, [1, 4, 7, 10]);
});

test('THE EXACT EXAMPLE: <%%(org-anniversary 2018 5 14)> -- yearly anniversary as a heading\u2019s own timestamp', () => {
  const doc = parseOrg('* Company Anniversary <%%(org-anniversary 2018 5 14)>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 4, 1),
    rangeEnd: new Date(2026, 4, 31),
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].date.getDate(), 14);
  assert.equal(items[0].title, 'Company Anniversary');
});

test('a heading with SCHEDULED/DEADLINE already set is not double-shown via the sexp-timestamp path too', () => {
  const doc = parseOrg('* Meeting <%%(org-anniversary 2018 5 14)>\nSCHEDULED: <2026-05-14 Thu>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 4, 14),
    rangeEnd: new Date(2026, 4, 14),
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'scheduled');
});

test('a sexp-timestamp result never carries forward -- it only shows on days it actually matches, unlike SCHEDULED/DEADLINE', () => {
  const doc = parseOrg('* Water the plants <%%(org-cyclic 3 2026 1 1)>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 0, 2), // the day AFTER a match (Jan 1), which would carry forward if this behaved like SCHEDULED
    rangeEnd: new Date(2026, 0, 2),
  });
  assert.equal(items.length, 0);
});

test('a plain <2026-01-01> title timestamp is completely unaffected by the new sexp-timestamp scanning', () => {
  const doc = parseOrg('* Meeting <2026-01-01 Thu>\n');
  const items = buildAgendaItems([{ documentId: 'test.org', doc }], {
    rangeStart: new Date(2026, 0, 1),
    rangeEnd: new Date(2026, 0, 1),
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'timestamp');
});
