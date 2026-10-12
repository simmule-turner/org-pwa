import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRepeater, rescheduleTimestamp } from '../src/reschedule.js';

test('only the date changes: the time, repeater and warning stay', () => {
  assert.equal(rescheduleTimestamp('<2026-10-11 Sun>', '<2026-10-25 Sun>'), '<2026-10-25 Sun>');
  assert.equal(rescheduleTimestamp('<2026-10-11 Sun 09:00 ++14d -2d>', '<2026-10-28 Wed>'), '<2026-10-28 Wed 09:00 ++14d -2d>');
  assert.equal(rescheduleTimestamp('<2026-10-11 Sun 09:00-10:30 .+1w>', '<2026-11-02 Mon>'), '<2026-11-02 Mon 09:00-10:30 .+1w>');
});

test('with nothing to keep, the picked date is used as it is', () => {
  assert.equal(rescheduleTimestamp(null, '<2026-10-25 Sun>'), '<2026-10-25 Sun>');
  assert.equal(rescheduleTimestamp('not a stamp', '<2026-10-25 Sun>'), '<2026-10-25 Sun>');
});

test('a date with no day name is still moved', () => {
  assert.equal(rescheduleTimestamp('<2026-10-11>', '<2026-10-25 Sun>'), '<2026-10-25 Sun>');
});

test('repeaters are recognised, a warning alone is not one', () => {
  for (const r of ['<2026-10-11 Sun +1d>', '<2026-10-11 Sun 09:00 ++2w>', '<2026-10-11 Sun .+1m>']) assert.equal(hasRepeater(r), true);
  for (const r of ['<2026-10-11 Sun>', '<2026-10-11 Sun -3d>', null]) assert.equal(hasRepeater(r), false);
});
