import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems, itemEffortText, itemEffortMinutes, summarizeDayEffort } from '../src/agenda.js';

const TODAY = new Date(2026, 8, 28); // 2026-09-28
const doc = (text) => parseOrg('#+TODO: TODO NEXT | DONE\n' + text);
const items = (text, opts = {}) =>
  buildAgendaItems([{ documentId: 'a.org', doc: doc(text) }], {
    today: TODAY,
    rangeStart: new Date(2026, 8, 28),
    rangeEnd: new Date(2026, 8, 28, 23, 59),
    isDone: (t) => t === 'DONE',
    ...opts,
  });
const task = (title, effort, planning = 'SCHEDULED: <2026-09-28 Mon>') =>
  `* TODO ${title}\n${planning}\n:PROPERTIES:\n${effort ? `:EFFORT: ${effort}\n` : ''}:END:\n`;

test('itemEffortText / itemEffortMinutes read the heading\'s EFFORT, in any org-duration form', () => {
  const [a, b, c] = items(task('A', '1:30') + task('B', '2h') + task('C', '1d 3h'));
  assert.equal(itemEffortText(a), '1:30');
  assert.equal(itemEffortMinutes(a), 90);
  assert.equal(itemEffortMinutes(b), 120);
  assert.equal(itemEffortMinutes(c), 1440 + 180);
});

test('no EFFORT, an empty one, or an invalid one is null -- never a guess', () => {
  const [none, bad] = items(task('A', null) + task('B', 'soon'));
  assert.equal(itemEffortText(none), null);
  assert.equal(itemEffortMinutes(none), null);
  assert.equal(itemEffortText(bad), 'soon');
  assert.equal(itemEffortMinutes(bad), null);
});

test('the property key is found case-insensitively', () => {
  const [a] = items('* TODO A\nSCHEDULED: <2026-09-28 Mon>\n:PROPERTIES:\n:Effort: 0:45\n:END:\n');
  assert.equal(itemEffortMinutes(a), 45);
});

test('an item with no heading behind it has no effort', () => {
  assert.equal(itemEffortText({ kind: 'sunrise' }), null);
  assert.equal(itemEffortMinutes(null), null);
});

test('summarizeDayEffort totals every estimated task', () => {
  const day = items(task('A', '1:30') + task('B', '2h') + task('C', '0:30'));
  assert.deepEqual(summarizeDayEffort(day), { minutes: 240, estimated: 3, unestimated: 0 });
});

test('a TODO without an estimate is counted as unestimated, not as zero', () => {
  const day = items(task('A', '1h') + task('B', null) + task('C', 'bogus'));
  assert.deepEqual(summarizeDayEffort(day), { minutes: 60, estimated: 1, unestimated: 2 });
});

test('an appointment with no TODO keyword and no effort is NOT a gap in the estimates', () => {
  const day = items('* Dentist <2026-09-28 Mon 10:00>\n' + task('A', '1h'));
  assert.deepEqual(summarizeDayEffort(day), { minutes: 60, estimated: 1, unestimated: 0 });
});

test('an appointment WITH an effort does count toward the total', () => {
  const day = items('* Workshop <2026-09-28 Mon 10:00>\n:PROPERTIES:\n:EFFORT: 3:00\n:END:\n');
  assert.deepEqual(summarizeDayEffort(day), { minutes: 180, estimated: 1, unestimated: 0 });
});

test('a heading that is both SCHEDULED and DEADLINE the same day is counted once', () => {
  const day = items('* TODO Report\nSCHEDULED: <2026-09-28 Mon> DEADLINE: <2026-09-28 Mon>\n:PROPERTIES:\n:EFFORT: 2:00\n:END:\n');
  assert.ok(day.length >= 2, 'expected the heading to appear twice');
  assert.deepEqual(summarizeDayEffort(day), { minutes: 120, estimated: 1, unestimated: 0 });
});

test('an overdue task carried forward counts on the day it is shown', () => {
  const day = items(task('Late', '1:00', 'SCHEDULED: <2026-09-20 Sun>'));
  assert.equal(day.length, 1);
  assert.deepEqual(summarizeDayEffort(day), { minutes: 60, estimated: 1, unestimated: 0 });
});

test('logged past events and non-heading lines never count', () => {
  const day = [
    { kind: 'logbook', heading: { propertyOrder: ['EFFORT'], properties: { EFFORT: '5:00' } }, todo: 'TODO' },
    { kind: 'sunrise' },
    { kind: 'diary-sexp' },
  ];
  assert.deepEqual(summarizeDayEffort(day), { minutes: 0, estimated: 0, unestimated: 0 });
});

test('a day with nothing on it is all zeros', () => {
  assert.deepEqual(summarizeDayEffort([]), { minutes: 0, estimated: 0, unestimated: 0 });
});

test('fractional efforts add up exactly enough (2.35h = 141 min)', () => {
  const day = items(task('A', '2.35h') + task('B', '0:30'));
  assert.ok(Math.abs(summarizeDayEffort(day).minutes - 171) < 1e-9);
});

test('an explicit zero estimate is an estimate (of nothing), not a missing one', () => {
  const day = items(task('Trivial', '0:00') + task('Unknown', null));
  assert.deepEqual(summarizeDayEffort(day), { minutes: 0, estimated: 1, unestimated: 1 });
});

// ---- sort / filter / limit (org-agenda.el's own rules) ------------------------

import { sortItemsByEffort, filterItemsByEffort, limitItemsByEffort, applyAgendaEffortView } from '../src/agenda.js';

const trio = () => items(task('Two hours', '2h') + task('None', null) + task('Half hour', '0:30'));
const titlesOf = (list) => list.map((i) => i.title.replace(/^TODO /, ''));

test('sort up: least effort first, and a task with no effort counts as HIGH effort (last)', () => {
  assert.deepEqual(titlesOf(sortItemsByEffort(trio(), 'up')), ['Half hour', 'Two hours', 'None']);
});

test('sort down: most effort first, no-effort first of all', () => {
  assert.deepEqual(titlesOf(sortItemsByEffort(trio(), 'down')), ['None', 'Two hours', 'Half hour']);
});

test('with noEffortIsHigh off, a task with no effort sorts as the least', () => {
  assert.deepEqual(titlesOf(sortItemsByEffort(trio(), 'up', false)), ['None', 'Half hour', 'Two hours']);
});

test('sorting is stable, does not modify its input, and equal efforts keep their order', () => {
  const day = items(task('B', '1h') + task('A', '1h') + task('C', '1h'));
  const before = titlesOf(day);
  assert.deepEqual(titlesOf(sortItemsByEffort(day, 'up')), before);
  assert.deepEqual(titlesOf(day), before);
});

test('filter <: at most -- INCLUSIVE, and no-effort tasks are excluded', () => {
  const day = items(task('Half', '0:30') + task('Hour', '1:00') + task('Two', '2h') + task('None', null));
  assert.deepEqual(titlesOf(filterItemsByEffort(day, { op: '<', minutes: 60 })), ['Half', 'Hour']);
});

test('filter >: at least -- inclusive, and no-effort tasks are KEPT (they count as high)', () => {
  const day = items(task('Half', '0:30') + task('Hour', '1:00') + task('Two', '2h') + task('None', null));
  assert.deepEqual(titlesOf(filterItemsByEffort(day, { op: '>', minutes: 60 })), ['Hour', 'Two', 'None']);
});

test('filter =: exactly, no-effort excluded', () => {
  const day = items(task('Half', '0:30') + task('Hour', '1:00') + task('AlsoHour', '60') + task('None', null));
  assert.deepEqual(titlesOf(filterItemsByEffort(day, { op: '=', minutes: 60 })), ['Hour', 'AlsoHour']);
});

test('with noEffortIsHigh off, a no-effort task is below everything: kept by <, excluded by >', () => {
  const day = items(task('Hour', '1:00') + task('None', null));
  assert.deepEqual(titlesOf(filterItemsByEffort(day, { op: '<', minutes: 60 }, false)), ['Hour', 'None']);
  assert.deepEqual(titlesOf(filterItemsByEffort(day, { op: '>', minutes: 60 }, false)), ['Hour']);
});

test('no filter, or an unknown operator, leaves everything', () => {
  const day = trio();
  assert.equal(filterItemsByEffort(day, null).length, 3);
  assert.equal(filterItemsByEffort(day, { op: '?', minutes: 1 }).length, 3);
});

test('items with no heading (sunrise, anniversaries) are never filtered or counted', () => {
  const day = [{ kind: 'sunrise', title: 'Sunrise' }, ...items(task('Two', '2h'))];
  assert.deepEqual(titlesOf(filterItemsByEffort(day, { op: '<', minutes: 30 })), ['Sunrise']);
  assert.deepEqual(titlesOf(limitItemsByEffort(day, 10)), ['Sunrise']);
});

test('limit: keeps items while the running total fits (org-agenda-max-effort)', () => {
  const day = items(task('A', '0:30') + task('B', '1:00') + task('C', '2h'));
  assert.deepEqual(titlesOf(limitItemsByEffort(day, 90)), ['A', 'B']);
  assert.deepEqual(titlesOf(limitItemsByEffort(day, 89)), ['A']);
  assert.deepEqual(titlesOf(limitItemsByEffort(day, 210)), ['A', 'B', 'C']);
  assert.deepEqual(titlesOf(limitItemsByEffort(day, 10)), []);
});

test('limit keeps a PREFIX, as Emacs does: after the total passes the maximum, even a small task is dropped', () => {
  const day = items(task('Big', '3h') + task('Tiny', '0:05'));
  assert.deepEqual(titlesOf(limitItemsByEffort(day, 60)), [], 'Big does not fit, and the running total never comes back down');
});

test('limit: a task with no effort counts as unbounded, so it and everything after it goes', () => {
  const day = items(task('A', '0:30') + task('None', null) + task('B', '0:05'));
  assert.deepEqual(titlesOf(limitItemsByEffort(day, 600)), ['A']);
});

test('limit with noEffortIsHigh off: a no-effort task counts as -1 minute and stays', () => {
  const day = items(task('A', '0:30') + task('None', null) + task('B', '0:05'));
  assert.deepEqual(titlesOf(limitItemsByEffort(day, 60, false)), ['A', 'None', 'B']);
});

test('no limit means no limit', () => {
  assert.equal(limitItemsByEffort(trio(), null).length, 3);
});

test('applyAgendaEffortView: sort, then limit, then filter -- so "shortest tasks that fit in 1h30" works', () => {
  const day = items(task('Two', '2h') + task('Hour', '1:00') + task('Half', '0:30') + task('None', null));
  assert.deepEqual(titlesOf(applyAgendaEffortView(day, { sort: 'up', maxMinutes: 90 })), ['Half', 'Hour']);
  assert.deepEqual(titlesOf(applyAgendaEffortView(day, { sort: 'up', maxMinutes: 90, filter: { op: '>', minutes: 60 } })), ['Hour']);
  assert.equal(applyAgendaEffortView(day).length, 4, 'with nothing set the day is untouched');
});
