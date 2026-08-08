/**
 * Real org's own repeater-shift-on-DONE behavior: completing a heading
 * with a repeating SCHEDULED and/or DEADLINE timestamp doesn't actually
 * finish it -- it shifts the timestamp's own date forward by the
 * repeater interval, stamps LAST_REPEAT with when this happened, and
 * immediately bounces the state back to the first TODO-type keyword,
 * keeping the task alive and recurring rather than marking it done for
 * good.
 *
 * The three repeater marks are genuinely different from each other,
 * not just cosmetically -- confirmed directly against multiple
 * real-world examples and the Org manual's own description:
 *
 *   +N<unit>   Cumulate: adds one interval to the OLD date. A single
 *              step, even if the result is still in the past -- no
 *              catch-up. Missing several occurrences in a row means
 *              marking it done that many times in a row to catch up.
 *
 *   ++N<unit>  Catch-up: adds the interval to the OLD date repeatedly
 *              until the result lands strictly after today -- the
 *              first FUTURE occurrence on the timestamp's own original
 *              schedule (same day-of-week/time-of-day it always had),
 *              not just one interval forward.
 *
 *   .+N<unit>  Restart: bases the new date off TODAY (the actual
 *              completion date) plus one interval, ignoring the old
 *              scheduled date's own position entirely -- "N<unit>
 *              from whenever I actually got to it," not from whenever
 *              it was originally due.
 *
 * A heading can have a repeater on SCHEDULED, DEADLINE, or both
 * independently -- each is shifted on its own terms if it has one.
 */

import { parseOrgTimestamp, formatOrgTimestamp } from './org-timestamp.js';
import { parseRepeater, addInterval, startOfDay } from './agenda.js';
import { setProperty } from './archive-model.js';

/** The shifted Date for one repeater application, given `mark`
 *  ('+' / '++' / '.+'), the interval (`amount`/`unit`), the
 *  timestamp's own current `oldDate`, and `now` (the actual moment of
 *  completion). Pure -- no knowledge of which planning field this is
 *  for, or how the result gets serialized back. */
function computeShiftedDate(mark, amount, unit, oldDate, now) {
  if (mark === '.+') {
    // Restart: today's own date, keeping the timestamp's own original
    // time-of-day (if it had one) rather than the moment-of-day
    // completion happened to occur at, then add one interval.
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), oldDate.getHours(), oldDate.getMinutes());
    return addInterval(base, amount, unit);
  }
  if (mark === '++') {
    // Catch-up: keep adding the interval to the OLD date (preserving
    // its own day-of-week/time-of-day throughout) until the result's
    // own calendar day is strictly after today's -- comparing whole
    // days, not exact instants, so completing something at 11pm still
    // correctly catches up to "tomorrow" rather than being thrown off
    // by a same-day time-of-day comparison.
    const todayDay = startOfDay(now);
    let next = addInterval(oldDate, amount, unit);
    let guard = 0; // a sane upper bound -- amount is always >= 1 by REPEATER_RE, so this always terminates well before this point in any real use
    while (startOfDay(next) <= todayDay && guard < 10000) {
      next = addInterval(next, amount, unit);
      guard++;
    }
    return next;
  }
  // '+' (cumulate): one interval forward from the old date, no catch-up.
  return addInterval(oldDate, amount, unit);
}

/** Re-serializes `raw` (an existing SCHEDULED/DEADLINE timestamp
 *  string with a repeater) with its own date shifted to `newDate` --
 *  every other part (active/inactive, time-of-day, the repeater
 *  itself, a delay/warning-period suffix) preserved exactly as it
 *  already was. Returns null if `raw` doesn't actually have a
 *  repeater at all (nothing for this module to do with it). */
function shiftTimestampString(raw, now) {
  const parsed = parseOrgTimestamp(raw);
  if (!parsed || !parsed.repeater) return null;
  const rep = parseRepeater(parsed.repeater);
  if (!rep) return null;

  const newDate = computeShiftedDate(rep.mark, rep.amount, rep.unit, parsed.date, now);
  return formatOrgTimestamp({
    date: newDate,
    time: parsed.hasTime ? `${String(newDate.getHours()).padStart(2, '0')}:${String(newDate.getMinutes()).padStart(2, '0')}` : null,
    repeaterMark: rep.mark,
    repeaterValue: `${rep.amount}${rep.unit}`,
    delayValue: parsed.delay ? parsed.delay.slice(1) : null, // parsed.delay keeps its own leading "-"; formatOrgTimestamp re-adds it
    active: parsed.active,
  });
}

/**
 * Applies real org's own repeater-shift-on-DONE behavior to `heading`,
 * given it just transitioned INTO a done-type keyword in `sequence`.
 * Mutates `heading` in place: shifts SCHEDULED and/or DEADLINE
 * (independently, whichever actually has a repeater), stamps
 * LAST_REPEAT with `now`, and bounces `heading.todo` back to
 * `sequence`'s own first TODO-type keyword -- real org's own "sets
 * the entry state back to TODO" (the FIRST keyword specifically, the
 * natural starting point of the sequence, not just any not-done one).
 *
 * Returns true if a shift actually happened (heading had at least one
 * repeating SCHEDULED/DEADLINE), false otherwise -- callers use this
 * to decide whether the surrounding done-transition's own CLOSED/
 * LOGBOOK logging should treat this as an immediate, follow-up
 * DONE-to-TODO transition too (the heading isn't actually staying
 * done, so a CLOSED timestamp shouldn't remain on it).
 */
function applyRepeaterShiftOnDone(heading, sequence, now = new Date()) {
  let shifted = false;

  if (heading.planning && heading.planning.scheduled) {
    const next = shiftTimestampString(heading.planning.scheduled, now);
    if (next) {
      heading.planning.scheduled = next;
      shifted = true;
    }
  }
  if (heading.planning && heading.planning.deadline) {
    const next = shiftTimestampString(heading.planning.deadline, now);
    if (next) {
      heading.planning.deadline = next;
      shifted = true;
    }
  }

  if (!shifted) return false;

  setProperty(
    heading,
    'LAST_REPEAT',
    formatOrgTimestamp({
      date: now,
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      active: false,
    })
  );

  heading.todo = sequence.todoKeywords[0] || null;
  return true;
}

export { computeShiftedDate, shiftTimestampString, applyRepeaterShiftOnDone };
