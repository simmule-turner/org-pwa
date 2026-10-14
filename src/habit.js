// @ts-check
/**
 * Habits, as in Emacs's org-habit: an open TODO with `:STYLE: habit` and a SCHEDULED date whose repeater says how often
 * (`.+2d/4d`: every 2 days, no later than every 4). The consistency graph is a row of days (org-habit-preceding-days before
 * today, today, org-habit-following-days after), each coloured by whether the habit could be done, should be done or is
 * overdue on that day. Pure: nothing here reads the DOM or the clock.
 *
 * The colours follow org-habit-get-faces: before the date it is next due, blue; from then until the last-chance day, green;
 * on the last-chance day, yellow; after it, red. For a past day "the date it is next due" is the previous completion plus the
 * repeat interval (not the heading's current SCHEDULED, which has moved on). A completion shows as `*`, today as `!`.
 * Completions are read from the `State "DONE"` lines of the heading's :LOGBOOK:, as org-habit does.
 */
/** @typedef {import('./types.js').Heading} Heading */
import { parseOrgTimestamp } from './org-timestamp.js';
import { parseRepeater } from './agenda.js';
import { parseLogbookEntries } from './logbook.js';

const DAY_MS = 86400000;
/** org-habit-duration-to-days: a month is 30 days and a year 365. Hours make no sense for a habit. */
const UNIT_DAYS = /** @type {Record<string, number>} */ ({ d: 1, w: 7, m: 30, y: 365 });

export const HABIT_DEFAULTS = Object.freeze({ precedingDays: 21, followingDays: 7, onlyForToday: true, showAllToday: false });

/** The day number (days since 1970, local calendar) of a Date.
 * @param {Date} d */
export function dayNumber(d) {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** @param {number} n */
export function dayNumberToDate(n) {
  const u = new Date(n * DAY_MS);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
}

/**
 * The STYLE property, case-insensitively, as org-is-habit-p reads it.
 * @param {Heading} heading
 */
function styleOf(heading) {
  const props = heading && heading.properties;
  if (!props) return undefined;
  const key = Object.keys(props).find((k) => k.toLowerCase() === 'style');
  return key === undefined ? undefined : String(props[key]).trim();
}

/**
 * What a heading says about being a habit, or null when it is not one: STYLE habit and a SCHEDULED with a repeater in days,
 * weeks, months or years. `minDays` is the repeater, `maxDays` the range after the slash (or the repeater itself).
 * @param {Heading} heading
 * @returns {{ scheduled: number, minDays: number, maxDays: number } | null}
 */
export function habitSpec(heading) {
  if (!heading || styleOf(heading) !== 'habit') return null;
  const raw = heading.planning && heading.planning.scheduled;
  const parsed = raw ? parseOrgTimestamp(raw) : null;
  if (!parsed || !parsed.active || !parsed.repeater) return null;
  const rep = parseRepeater(parsed.repeater);
  if (!rep || !UNIT_DAYS[rep.unit]) return null;
  const minDays = rep.amount * UNIT_DAYS[rep.unit];
  const maxDays = rep.range && UNIT_DAYS[rep.range.unit] ? Math.max(minDays, rep.range.amount * UNIT_DAYS[rep.range.unit]) : minDays;
  return { scheduled: dayNumber(parsed.date), minDays, maxDays };
}

/** The day numbers a habit was completed on: its `State "<done keyword>"` log lines.
 * @param {Heading} heading
 * @param {(keyword: string) => boolean} isDone
 * @returns {number[]} ascending, without repeats */
export function habitDoneDays(heading, isDone) {
  const days = new Set();
  for (const entry of parseLogbookEntries(heading.logbookLines || [])) {
    if (entry.type !== 'state' || !isDone(entry.newState || '')) continue;
    const ts = parseOrgTimestamp(entry.timestamp);
    if (ts) days.add(dayNumber(ts.date));
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * org-habit-get-faces for one day: 'b' blue, 'g' green, 'y' yellow, 'r' red.
 * @param {number} day @param {number} scheduled @param {number} deadline @param {boolean} done
 */
function faceFor(day, scheduled, deadline, done) {
  if (day < scheduled) return 'b';
  if (day < deadline) return 'g';
  if (day === deadline) return done ? 'g' : 'y';
  return done ? 'g' : 'r';
}

/**
 * The graph for one habit: `cells` for every day from today-precedingDays to today+followingDays, each
 * { day, face: 'b'|'g'|'y'|'r', future, mark: '*'|'!'|'' }.
 * @param {Heading} heading @param {(keyword: string) => boolean} isDone @param {Date} today
 * @param {{ precedingDays?: number, followingDays?: number }} [opts]
 */
export function buildHabitGraph(heading, isDone, today, opts = {}) {
  const spec = habitSpec(heading);
  if (!spec) return null;
  const preceding = opts.precedingDays ?? HABIT_DEFAULTS.precedingDays;
  const following = opts.followingDays ?? HABIT_DEFAULTS.followingDays;
  const now = dayNumber(today);
  const first = now - preceding;
  const doneAll = habitDoneDays(heading, isDone);
  const doneSet = new Set(doneAll);
  const slack = spec.maxDays - spec.minDays;
  const realDeadline = spec.scheduled + slack;

  /** @type {number | null} */
  let lastDone = null;
  for (const d of doneAll) if (d < first) lastDone = d;

  const cells = [];
  for (let day = first; day <= now + following; day++) {
    const past = day < now;
    const done = doneSet.has(day);
    let face;
    if (past && lastDone === null && !(spec.scheduled < now)) face = 'b'; // nothing done yet and not yet due: org-habit-clear-face
    else {
      const scheduled = past && lastDone !== null ? lastDone + spec.minDays : spec.scheduled;
      const deadline = past && lastDone !== null ? scheduled + slack : realDeadline;
      face = faceFor(day, scheduled, deadline, done);
    }
    cells.push({ day, face, future: day > now, mark: done ? '*' : day === now ? '!' : '' });
    if (done) lastDone = day;
  }

  const last = doneAll.length ? doneAll[doneAll.length - 1] : null;
  return { cells, minDays: spec.minDays, maxDays: spec.maxDays, scheduled: spec.scheduled, deadline: realDeadline, lastDone: last, todayIndex: preceding };
}
