// @ts-check
// What the date pickers' "type a date" box fills in: the answer of `org-read-date` (src/read-date.js) as the picker's own fields.
import { readDate, readDateSettings } from './read-date.js';

/**
 * The fields of a date picker for a typed date, as Emacs's date prompt reads it (`+1w`, `fri`, `3 2`, `2025-12-24 14:30-15:30` ...).
 * An empty answer is today (or the default); text Emacs would not read is an error message, not a guess.
 * @param {string} text
 * @param {{ now?: Date, vars?: Record<string, string>, defaultTime?: Date | null }} [options]
 * @returns {{ date: string, time: string | null, endTime: string | null } | { error: string }}
 */
export function typedDateFields(text, options = {}) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  try {
    const r = readDate(text, { now: options.now ?? new Date(), defaultTime: options.defaultTime ?? null, ...readDateSettings(options.vars), endBound: true });
    const d = r.date;
    const end = r.endTimeGiven ? /([0-9]+):([0-9]+)/.exec(r.endTimeGiven) : null;
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: r.timeGiven ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : null,
      endTime: end ? `${pad(Number(end[1]))}:${pad(Number(end[2]))}` : null,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
