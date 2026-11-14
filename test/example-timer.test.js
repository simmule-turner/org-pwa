// examples/timer.org: its lists are timer lists (org-at-item-timer-p), and the shift in it does what the text says.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { appendTimerItem, changeTimes, isTimerItem } from '../src/org-timer.js';

const text = fs.readFileSync(new URL('../examples/timer.org', import.meta.url), 'utf8');
const items = text.split('\n').filter((l) => /^- \d+:\d\d:\d\d ::/.test(l));

test('the example lists are timer lists, and another item follows the last one', () => {
  assert.equal(items.length, 6);
  assert.ok(items.every(isTimerItem));
  assert.equal(appendTimerItem(items.join('\n'), '0:15:00 ').split('\n').pop(), '- 0:15:00 :: ');
});

test('shifting the stamps by 8:26 puts the late list right', () => {
  assert.equal(changeTimes('- 0:00:12 :: Welcome\n- 0:03:40 :: Status\n', '0:08:26'), '- 0:08:38 :: Welcome\n- 0:12:06 :: Status\n');
});
