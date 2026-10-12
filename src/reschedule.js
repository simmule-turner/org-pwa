// @ts-check
// Moving a SCHEDULED or DEADLINE to another day without losing the rest of it: its time, repeater and warning stay.

const DATE_RE = /\d{4}-\d{2}-\d{2}(?: [^\s\d<>\]+.-]+\.?)?/;

/**
 * `existing` with its date replaced by the one in `picked`; everything else in `existing` is kept. With no `existing`, `picked`
 * as it is.
 * @param {string | null | undefined} existing  e.g. "<2026-10-11 Sun 09:00 ++14d -2d>"
 * @param {string} picked  e.g. "<2026-10-25 Sun>"
 * @returns {string}
 */
export function rescheduleTimestamp(existing, picked) {
  const target = DATE_RE.exec(picked);
  if (!existing || !target || !DATE_RE.test(existing)) return picked;
  return existing.replace(DATE_RE, target[0]);
}

/** Whether a SCHEDULED/DEADLINE timestamp repeats, so that marking it done moves it on rather than finishing it.
 * @param {string | null | undefined} raw */
export function hasRepeater(raw) {
  return !!raw && /\s(?:\+\+|\.\+|\+)\d+[hdwmy]/.test(raw);
}
