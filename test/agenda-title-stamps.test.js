import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { buildAgendaItems, stripTitleStamps } from '../src/agenda.js';

test('stripTitleStamps takes active timestamps and ranges out of a title and closes the gap', () => {
  assert.equal(stripTitleStamps('Do task <2026-10-11 Sun 10:00 +14d>'), 'Do task');
  assert.equal(stripTitleStamps('Call <2026-10-12 Mon> about the quote'), 'Call about the quote');
  assert.equal(stripTitleStamps('Trip <2026-10-12 Mon>--<2026-10-14 Wed> north'), 'Trip north');
  assert.equal(stripTitleStamps('Twice <2026-10-12 Mon> and <2026-10-13 Tue>'), 'Twice and');
});

test('stripTitleStamps keeps [inactive] stamps, and a title of only stamps keeps its text', () => {
  assert.equal(stripTitleStamps('Seen [2026-10-12 Mon] <2026-10-13 Tue>'), 'Seen [2026-10-12 Mon]');
  assert.equal(stripTitleStamps('<2026-10-12 Mon>'), '<2026-10-12 Mon>');
});

test('each day of a range says which day of how many it is', () => {
  const doc = parseOrg('* Trip <2026-10-12 Mon>--<2026-10-14 Wed>');
  const items = buildAgendaItems([{ documentId: 'x.org', doc }]).sort((a, b) => a.date - b.date);
  assert.deepEqual(items.map((i) => [i.rangeDay, i.rangeDays]), [[1, 3], [2, 3], [3, 3]]);
});
