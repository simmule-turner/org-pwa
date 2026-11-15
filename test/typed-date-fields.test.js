import test from 'node:test';
import assert from 'node:assert/strict';
import { typedDateFields } from '../src/typed-date-fields.js';

const now = new Date(2026, 9, 8, 10, 30); // Thu 2026-10-08

test('typed dates fill the picker as the date prompt of Emacs reads them', () => {
  assert.deepEqual(typedDateFields('+1w', { now }), { date: '2026-10-15', time: null, endTime: null });
  assert.deepEqual(typedDateFields('fri', { now }), { date: '2026-10-09', time: null, endTime: null });
  assert.deepEqual(typedDateFields('2026-12-24 14:30-15:45', { now }), { date: '2026-12-24', time: '14:30', endTime: '15:45' });
  assert.deepEqual(typedDateFields('', { now }), { date: '2026-10-08', time: null, endTime: null });
  assert.deepEqual(typedDateFields('12', { now }), { date: '2026-10-12', time: null, endTime: null }); // the 12th, the next one with prefer-future
});

test('text the date prompt does not read leaves the default, as Emacs does', () => {
  assert.deepEqual(typedDateFields('not a date', { now }), { date: '2026-10-08', time: null, endTime: null });
});
