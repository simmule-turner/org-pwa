// The planning dialog's steppers (src/timestamp-shift.js) against Emacs 29.3: test/fixtures/timestamp-shift-oracle.json, from
// tools/gen-timestamp-shift-oracle.mjs, holds the SCHEDULED stamp after org-timestamp-change by a day, a week (7 days) and a month.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DATE_SHIFTS, shiftTimestamp } from '../src/timestamp-shift.js';

const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/timestamp-shift-oracle.json', import.meta.url), 'utf8'));

test('a stamp moved by a day, a week or a month is the stamp Emacs gives', () => {
  assert.ok(rows.length >= 80);
  const bad = rows.map((r) => ({ ...r, got: shiftTimestamp(r.stamp, r.n, r.what) })).filter((r) => r.got !== r.result);
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} of ${rows.length} differ`);
});

test('the steppers are +1 and -1 for a day, a week and a month, in that order', () => {
  assert.deepEqual(DATE_SHIFTS.map(([label]) => label), ['+1 day', '-1 day', '+1 week', '-1 week', '+1 month', '-1 month']);
  assert.deepEqual(DATE_SHIFTS.map(([, n, what]) => `${n} ${what}`), ['1 day', '-1 day', '7 day', '-7 day', '1 month', '-1 month']);
});
