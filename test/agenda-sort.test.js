import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems, itemsForDate } from '../src/agenda.js';
import { sortAgendaItems, parseSortingStrategy, DEFAULT_STRATEGY } from '../src/agenda-sort.js';

// Emacs 29.3's order of one day's rows for each strategy (tools/gen-sort-oracle.mjs), over s1.org and s2.org.
const read = (name) => fs.readFileSync(new URL(`./fixtures/sort/${name}`, import.meta.url), 'utf8');
const cases = JSON.parse(read('cases.json'));
const { expected } = JSON.parse(read('expected.json'));
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

function dayItems() {
  const docs = ['s1.org', 's2.org'].map((documentId) => ({ documentId, doc: parseOrg(read(documentId)) }));
  const day = new Date(2027, 2, 15);
  const items = buildAgendaItems(docs, {
    today: new Date(2026, 9, 20),
    rangeStart: new Date(2027, 2, 15, 0, 0),
    rangeEnd: new Date(2027, 2, 15, 23, 59),
    isDone: (todo) => todo === 'DONE',
    todoFilter: (todo) => todo !== 'DONE',
  });
  return itemsForDate(items, day);
}
const nameOf = (item) => NAMES.find((n) => item.title.includes(n));

cases.forEach((keys, i) => {
  test(`orders rows as Emacs does for ${keys.join(' ')}`, () => {
    const items = dayItems();
    const sorted = sortAgendaItems(items, keys, { documentOrder: ['s1.org', 's2.org'], todoKeywords: ['TODO', 'NEXT', 'DONE'], doneKeywords: ['DONE'] });
    assert.deepEqual(sorted.map(nameOf), expected[i]);
  });
});

test('the strategy is read per view, and unknown words are dropped', () => {
  const raw = '((agenda habit-down time-up bogus priority-down category-keep) (todo priority-down))';
  assert.deepEqual(parseSortingStrategy(raw, 'agenda'), ['habit-down', 'time-up', 'priority-down', 'category-keep']);
  assert.deepEqual(parseSortingStrategy(raw, 'todo'), ['priority-down']);
  assert.equal(parseSortingStrategy(raw, 'search'), null);
  assert.equal(parseSortingStrategy('', 'agenda'), null);
  assert.deepEqual(DEFAULT_STRATEGY.agenda, ['habit-down', 'time-up', 'priority-down', 'category-keep']);
});
