import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { buildHabitGraph, habitSpec, habitDoneDays } from '../src/habit.js';
import { parseRepeater, buildAgendaItems } from '../src/agenda.js';
import { parseOrgTimestamp } from '../src/org-timestamp.js';

const isDone = (k) => k === 'DONE';
const doc = (text) => parseOrg(text);
const first = (d) => d.children[0];

test('a repeater may carry a /max range', () => {
  assert.deepEqual(parseRepeater('.+2d/4d'), { mark: '.+', amount: 2, unit: 'd', range: { amount: 4, unit: 'd' } });
  assert.equal(parseRepeater('+1w').range, null);
  assert.equal(parseOrgTimestamp('<2026-10-13 Tue .+2d/4d>').repeater, '.+2d/4d');
});

const HABIT = `* TODO Shave
SCHEDULED: <2026-10-13 Tue .+2d/4d>
:PROPERTIES:
:STYLE: habit
:END:
:LOGBOOK:
- State "DONE"       from "TODO"       [2026-10-11 Sun 20:14]
- State "DONE"       from "TODO"       [2026-10-08 Thu 08:00]
:END:
`;

test('habitSpec needs STYLE habit and a day-based repeater', () => {
  assert.deepEqual(habitSpec(first(doc(HABIT))) && { min: habitSpec(first(doc(HABIT))).minDays, max: habitSpec(first(doc(HABIT))).maxDays }, { min: 2, max: 4 });
  assert.equal(habitSpec(first(doc(HABIT.replace(':STYLE: habit', ':STYLE: other')))), null);
  assert.equal(habitSpec(first(doc(HABIT.replace('.+2d/4d', '.+2h')))), null);
});

test('done days come from State lines', () => {
  const days = habitDoneDays(first(doc(HABIT)), isDone);
  assert.equal(days.length, 2);
});

test('graph colours follow org-habit', () => {
  const g = buildHabitGraph(first(doc(HABIT)), isDone, new Date(2026, 9, 13), { precedingDays: 6, followingDays: 4 });
  const faces = g.cells.map((c) => c.face + c.mark).join(' ');
  // Oct 7..17. Oct 8 done; due again Oct 10 (green), last chance Oct 12 (yellow on 12? 8+2=10..deadline 12); Oct 11 done; next due 13 (green), last chance 15.
  assert.equal(g.cells.length, 10);
  assert.equal(g.cells[g.todayIndex].mark, '!');
  assert.match(faces, /g\*/);
  assert.equal(g.cells[4].face, 'g'); // Oct 11 done
  assert.equal(g.cells[4].mark, '*');
  assert.equal(g.cells[6].face, 'g'); // Oct 13 today: due, can be done
  assert.equal(g.cells[8].face, 'y'); // Oct 15 last chance
  assert.equal(g.cells[9].face, 'r'); // Oct 16 overdue
  assert.equal(g.cells[9].future, true);
});

test('agenda shows one habit entry on today, with its graph, and hides it when toggled off', () => {
  const d = doc(HABIT);
  const today = new Date(2026, 9, 13, 10, 0);
  const common = { rangeStart: new Date(2026, 9, 13), rangeEnd: new Date(2026, 9, 13, 23, 59), isDone: (k) => k === 'DONE', today };
  const on = buildAgendaItems([{ documentId: 'a.org', doc: d }], { ...common, habits: { enabled: true, onlyForToday: true, showAllToday: false, precedingDays: 21, followingDays: 7 } });
  const habit = on.filter((i) => i.habit);
  assert.equal(habit.length, 1);
  assert.equal(habit[0].habit.cells.length, 28);
  const off = buildAgendaItems([{ documentId: 'a.org', doc: d }], { ...common, habits: { enabled: false } });
  assert.equal(off.filter((i) => i.title === 'Shave').length, 0);
});

test('history: streak counts completions each within the last-chance gap, best run, and a 12-week grid ending this week', async () => {
  const { buildHabitHistory } = await import('../src/habit.js');
  const log = ['2026-10-11', '2026-10-08', '2026-10-05', '2026-09-20', '2026-09-18'].map((d) => `- State "DONE"       from "TODO"       [${d} 10:00]`);
  const text = `* TODO Shave\nSCHEDULED: <2026-10-13 Tue .+2d/4d>\n:PROPERTIES:\n:STYLE: habit\n:END:\n:LOGBOOK:\n${log.join('\n')}\n:END:\n`;
  const h = buildHabitHistory(first(doc(text)), isDone, new Date(2026, 9, 13));
  assert.equal(h.streak, 3); // Oct 5, 8, 11 each within 4 days; Sep 20 -> Oct 5 is too long
  assert.equal(h.best, 3);
  assert.equal(h.grid.length, 84);
  assert.equal(h.grid.filter((c) => c.today).length, 1);
  assert.equal(h.doneInWindow, 5);
  assert.equal(h.recent[0].gap, 3);
  const late = buildHabitHistory(first(doc(text)), isDone, new Date(2026, 9, 20));
  assert.equal(late.streak, 0); // last done Oct 11, past the last-chance day
});
