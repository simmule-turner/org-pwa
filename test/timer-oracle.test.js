// org-timer's stamps against Emacs 29.3 (tools/gen-timer-oracle.mjs): fixing, converting and shifting H:MM:SS, the value of the
// relative, paused and countdown timers, and what makes a list a timer list.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { changeTimes, fixIncomplete, hmsToSecs, isTimerItem, secsToHms, timerValueString } from '../src/org-timer.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/timer-oracle.json', import.meta.url), 'utf8'));

/** @param {any} c */
function run(c) {
  try {
    if (c.fn === 'fix') return fixIncomplete(c.in);
    if (c.fn === 'secs') return hmsToSecs(c.in);
    if (c.fn === 'hms') return secsToHms(c.in);
    if (c.fn === 'value') return timerValueString({ start: 1000 * 1000, pause: (1000 + c.elapsed) * 1000, countdown: c.countdown ? 'paused' : null }, 0, c.format);
    if (c.fn === 'change') return changeTimes(c.text, c.delta);
    return isTimerItem(c.line) ? 'yes' : 'no';
  } catch (e) {
    return 'ERROR ' + /** @type {Error} */ (e).message;
  }
}

test('org-timer stamps are what Emacs gives', () => {
  const wrong = cases.map((/** @type {any} */ c) => ({ c, got: run(c) })).filter(({ c, got }) => got !== c.expected);
  assert.deepEqual(wrong.slice(0, 5).map(({ c, got }) => ({ ...c, got })), []);
});
