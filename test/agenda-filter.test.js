import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { buildTaskList } from '../src/agenda.js';
import { applyViewFilter, describeTaskDate, emptyViewFilter, sortTasksByDate, taskDateInfo, viewFilterChoices } from '../src/agenda-filter.js';

const today = new Date(2026, 9, 11, 12);
const doc = parseOrg(
  [
    '#+CATEGORY: home',
    '#+TODO: TODO NEXT | DONE',
    '* TODO Plain :errands:',
    '* TODO Late :home:',
    'SCHEDULED: <2026-10-01 Thu>',
    '* NEXT Soon :home:errands:',
    'DEADLINE: <2026-10-14 Wed>',
    '* TODO Both',
    'SCHEDULED: <2026-10-20 Tue> DEADLINE: <2026-10-15 Thu>',
  ].join('\n')
);
const tasks = () => buildTaskList([{ documentId: 'home.org', doc }], { isDone: (t) => t === 'DONE' });

test('a task carries its category', () => {
  assert.deepEqual([...new Set(tasks().map((t) => t.category))], ['home']);
});

test('no choices made keeps everything; fields combine, choices inside a field alternate', () => {
  const items = tasks();
  assert.equal(applyViewFilter(items, emptyViewFilter()).length, 4);
  assert.deepEqual(applyViewFilter(items, { ...emptyViewFilter(), tags: ['home'] }).map((t) => t.title), ['Late', 'Soon']);
  assert.deepEqual(applyViewFilter(items, { ...emptyViewFilter(), tags: ['home', 'errands'] }).map((t) => t.title), ['Plain', 'Late', 'Soon']);
  assert.deepEqual(applyViewFilter(items, { tags: ['home'], todos: ['NEXT'], categories: [] }).map((t) => t.title), ['Soon']);
  assert.deepEqual(applyViewFilter(items, { ...emptyViewFilter(), categories: ['work'] }), []);
});

test('an item with no heading behind it is never filtered out', () => {
  const lines = [{ title: 'Sunrise' }];
  assert.equal(applyViewFilter(lines, { ...emptyViewFilter(), tags: ['home'] }).length, 1);
});

test('the choices are what the items carry, most used first', () => {
  const c = viewFilterChoices(tasks());
  assert.deepEqual(c.tags, [['errands', 2], ['home', 2]]);
  assert.deepEqual(c.todos, [['TODO', 3], ['NEXT', 1]]);
  assert.deepEqual(c.categories, [['home', 4]]);
});

test('a row shows the earlier of SCHEDULED and DEADLINE, in the Agenda wording', () => {
  const [plain, late, soon, both] = tasks();
  assert.equal(taskDateInfo(plain.heading, today), null);
  assert.deepEqual(describeTaskDate(taskDateInfo(late.heading, today)), { text: 'Scheduled Thu, Oct 1 · 10 days overdue', overdue: true });
  assert.deepEqual(describeTaskDate(taskDateInfo(soon.heading, today)), { text: 'Deadline Wed, Oct 14 · due in 3 days', overdue: false });
  assert.equal(taskDateInfo(both.heading, today).kind, 'deadline');
});

test('sorting by date puts the most overdue first and undated tasks last, keeping document order for ties', () => {
  assert.deepEqual(sortTasksByDate(tasks(), today).map((t) => t.title), ['Late', 'Soon', 'Both', 'Plain']);
});
