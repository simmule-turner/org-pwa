// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
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
import { parseRepeater, addInterval, bodyLinesWithoutStamps, withoutInlineLiterals } from './agenda.js';
import { setProperty } from './archive-model.js';

/** The shifted Date for one repeater application, given `mark`
 *  ('+' / '++' / '.+'), the interval (`amount`/`unit`), the
 *  timestamp's own current `oldDate`, and `now` (the actual moment of
 *  completion). Pure -- no knowledge of which planning field this is
 *  for, or how the result gets serialized back. */
/** @param {string} mark @param {number} amount @param {string} unit @param {Date} oldDate @param {Date} now @returns {Date} */
function computeShiftedDate(mark, amount, unit, oldDate, now) {
  if (mark === '.+') {
    // Restart. For hours the base is the moment of completion itself (an hour repeater counts from now, minutes
    // included). For longer units it is today's own date, keeping the timestamp's original time-of-day (if it had one)
    // rather than the moment-of-day completion happened to occur at, then one interval is added.
    if (unit === 'h') return addInterval(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()), amount, unit);
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), oldDate.getHours(), oldDate.getMinutes());
    return addInterval(base, amount, unit);
  }
  if (mark === '++') {
    // Catch-up: keep adding the interval to the OLD date (preserving its own day-of-week/time-of-day throughout) until
    // the result is after the moment of completion, as Emacs does. A date without a time sits at midnight, so it has to
    // land on a later day; a timed one may land later today.
    let next = addInterval(oldDate, amount, unit);
    let guard = 0; // a sane upper bound -- amount is always >= 1 by REPEATER_RE, so this always terminates well before this point in any real use
    while (next.getTime() <= now.getTime() && guard < 100000) {
      next = addInterval(next, amount, unit);
      guard++;
    }
    return next;
  }
  // '+' (cumulate): one interval forward from the old date, no catch-up.
  return addInterval(oldDate, amount, unit);
}

/** What Emacs signals (a `user-error`) when a repeating entry cannot be moved on; the message is Emacs's own. */
export class RepeatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'RepeatError';
    /** The log note the state change still asks for (set by the caller that met the error). @type {import('./todo-transition.js').PendingNote | null} */
    this.pendingNote = null;
  }
}

/** The start of a time stamp as Emacs rewrites it on a shift: the delimiter, the date, the day name and the time (range). Everything
 *  after it (a repeater, a warning period, in whatever order) stays as written. */
const STAMP_HEAD_RE = /^[<[]\d{4}-\d\d-\d\d(?: +[A-Za-z.\u00c0-\uffff]+)?(?: +\d{1,2}:\d\d(?:-\d{1,2}:\d\d)?)?/;

/** Re-serializes `raw` (an existing SCHEDULED/DEADLINE timestamp
 *  string with a repeater) with its own date shifted to `newDate` --
 *  every other part (active/inactive, time-of-day, the repeater
 *  itself, a delay/warning-period suffix, and their order) preserved
 *  exactly as it already was. Returns null if `raw` doesn't actually have a
 *  repeater at all (nothing for this module to do with it). An hour repeater
 *  on a time stamp without a time is Emacs's user error. */
/** @param {string} raw @param {Date} now @returns {string | null} */
function shiftTimestampString(raw, now) {
  const parsed = parseOrgTimestamp(raw);
  if (!parsed || !parsed.repeater) return null;
  const rep = parseRepeater(parsed.repeater);
  if (!rep) return null;
  if (rep.unit === 'h' && !/\d{1,2}:\d{2}/.test(raw)) throw new RepeatError(`Cannot repeat in ${rep.amount} hour(s) because no hour has been set`);
  const head = STAMP_HEAD_RE.exec(raw);
  if (!head) return null;

  const newDate = computeShiftedDate(rep.mark, rep.amount, rep.unit, parsed.date, now);
  const shifted = formatOrgTimestamp({
    date: newDate,
    time: parsed.hasTime ? `${String(newDate.getHours()).padStart(2, '0')}:${String(newDate.getMinutes()).padStart(2, '0')}` : null,
    endTime: parsed.endDate ? `${String(parsed.endDate.getHours()).padStart(2, '0')}:${String(parsed.endDate.getMinutes()).padStart(2, '0')}` : null, // the end of a time range stays as written
    active: parsed.active,
  });
  return shifted.slice(0, -1) + raw.slice(head[0].length);
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
 * @param {Heading} heading
 * @param {any} [sequence]
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

/** org-repeat-re: an active time stamp with a repeater anywhere before its `>`. */
const REPEAT_RE = /<\d{4}-\d\d-\d\d [^>\n]*?(?:[.+]?\+\d+[hdwmy](?:\/\d+[hdwmy])?)/;
const ACTIVE_STAMP_RE = /<\d{4}-\d\d-\d\d[^>\n]*>/g;

/** @param {string} stamp @returns {boolean} */
export function hasRepeater(stamp) {
  return REPEAT_RE.test(stamp);
}

/**
 * One piece of an entry's text as Emacs reads it for time stamps, with the way to write it back.
 * @typedef {{ text: string, skip: boolean, set: (text: string) => void }} StampSegment
 */

/** The entry's text in file order (title, planning line, property values, log items, body) as pieces. Emacs takes no time stamp from a
 *  comment line, a #+KEYWORD line, a source, example or export block, or a fixed-width (": ") line.
 *  @param {Heading} heading @returns {StampSegment[]} */
function entrySegments(heading) {
  /** @type {StampSegment[]} */
  const segs = [{ text: heading.title, skip: false, set: (t) => (heading.title = t) }];
  const planning = heading.planning;
  for (const key of (planning.order || ['scheduled', 'deadline']).filter((/** @type {string} */ k) => k === 'scheduled' || k === 'deadline')) {
    const k = /** @type {'scheduled' | 'deadline'} */ (key);
    if (planning[k]) segs.push({ text: /** @type {string} */ (planning[k]), skip: false, set: (t) => (planning[k] = t) });
  }
  for (const key of heading.propertyOrder || Object.keys(heading.properties)) {
    const old = heading.properties[key];
    if (old == null) continue;
    segs.push({
      text: old,
      skip: false,
      set: (t) => {
        heading.properties[key] = t;
        // Emacs changes the time stamp in place: the line keeps its own spacing
        const lines = heading.raw && heading.raw.propertyLines;
        const kept = lines && lines[key];
        if (lines && kept && kept.value === old && kept.line.endsWith(old)) lines[key] = { line: kept.line.slice(0, kept.line.length - old.length) + t, value: t };
      },
    });
  }
  /** @param {string[]} lines */
  const addLines = (lines) => {
    const skipped = bodyLinesWithoutStamps(lines);
    lines.forEach((text, i) => segs.push({ text, skip: skipped.has(i) || /^[ \t]*:(?: |$)/.test(text), set: (t) => (lines[i] = t) }));
  };
  addLines(heading.preLogLines || []);
  addLines(heading.logbookLines);
  addLines(heading.bodyLines);
  return segs;
}

/** Whether the entry has a clock line Emacs counts (not one in a block or comment). @param {Heading} heading */
export function hasClockLine(heading) {
  return entrySegments(heading).some((s) => !s.skip && /^[ \t]*CLOCK:/.test(s.text));
}

/** The time stamps of the entry that repeat, in file order, as Emacs counts them; empty when the entry does not repeat (none, or the first is +0d).
 *  @param {Heading} heading @returns {{ seg: StampSegment, index: number, stamp: string }[]} */
function repeatingStamps(heading) {
  const live = entrySegments(heading).filter((s) => !s.skip);
  const masked = withoutInlineLiterals(live.map((s) => s.text).join('\n'));
  let offset = 0;
  /** @type {{ seg: StampSegment, index: number, stamp: string }[]} */
  const stamps = [];
  for (const seg of live) {
    for (const m of seg.text.matchAll(ACTIVE_STAMP_RE)) if (masked.slice(offset + m.index, offset + m.index + m[0].length) === m[0] && REPEAT_RE.test(m[0])) stamps.push({ seg, index: m.index, stamp: m[0] });
    offset += seg.text.length + 1;
  }
  const first = stamps.length ? /\+(\d+)[hdwmy]/.exec(stamps[0].stamp) : null;
  return first && Number(first[1]) === 0 ? [] : stamps;
}

/** Whether the entry repeats (org-get-repeat is not nil and not zero). @param {Heading} heading */
export function entryRepeats(heading) {
  return repeatingStamps(heading).length > 0;
}

/**
 * `org-auto-repeat-maybe` for the time stamps: every active time stamp with a repeater in the entry (title, planning line,
 * drawers and text, not the sub-headings, and not the places Emacs reads no time stamp in) moves on, and a SCHEDULED without a repeater
 * is removed, as it no longer applies. The first repeater of the entry decides: a zero one (+0d) repeats nothing.
 * Returns false, and changes nothing, when the entry does not repeat. Throws RepeatError when Emacs signals one: the stamps before it have moved.
 * @param {Heading} heading
 * @param {Date} now
 */
export function shiftEntryRepeaters(heading, now) {
  const stamps = repeatingStamps(heading);
  if (!stamps.length) return false;
  if (heading.planning.scheduled && !REPEAT_RE.test(heading.planning.scheduled)) heading.planning.scheduled = null;
  // the stamps move on in file order; one that Emacs refuses stops it there, the ones before it already moved
  /** @type {Error | null} */
  let failure = null;
  /** @type {Map<StampSegment, { index: number, stamp: string, next: string }[]>} */
  const bySeg = new Map();
  for (const s of stamps) {
    try {
      bySeg.set(s.seg, [...(bySeg.get(s.seg) || []), { index: s.index, stamp: s.stamp, next: shiftTimestampString(s.stamp, now) || s.stamp }]);
    } catch (err) {
      failure = /** @type {Error} */ (err);
      break;
    }
  }
  for (const [seg, edits] of bySeg) {
    let text = seg.text;
    for (const e of [...edits].reverse()) text = text.slice(0, e.index) + e.next + text.slice(e.index + e.stamp.length);
    seg.set(text);
  }
  if (failure) throw failure;
  return true;
}

export { computeShiftedDate, shiftTimestampString, applyRepeaterShiftOnDone };
