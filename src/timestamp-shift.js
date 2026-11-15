// @ts-check
// The steppers of the planning dialog: a SCHEDULED or DEADLINE stamp moved by a day, a week or a month, as S-up and S-down move it in
// Emacs (org-timestamp-change on the day, or on the month). A week is seven days. The change itself is src/timestamp-edit.js's.
import { timestampChange } from './timestamp-edit.js';

/** @type {[label: string, n: number, what: 'day' | 'month'][]} */
export const DATE_SHIFTS = [
  ['+1 day', 1, 'day'],
  ['-1 day', -1, 'day'],
  ['+1 week', 7, 'day'],
  ['-1 week', -7, 'day'],
  ['+1 month', 1, 'month'],
  ['-1 month', -1, 'month'],
];

/**
 * A time stamp with its date moved: `n` days or months (org-timestamp-change with the point inside the stamp).
 * @param {string} stamp e.g. "<2026-11-14 Sat 10:00 +1w>" @param {number} n @param {'day' | 'month'} what
 */
export function shiftTimestamp(stamp, n, what) {
  return timestampChange(stamp, 1, n, { what }).text;
}
