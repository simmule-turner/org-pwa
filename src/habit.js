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
import { allLogLines } from './logbook.js';

const DAY_MS = 86400000;
/** org-habit-repeater-to-days: a month is 30.4 days and a year 365.25 (floored); hours are not a unit of a habit. */
const UNIT_DAYS = /** @type {Record<string, number>} */ ({ d: 1, w: 7, m: 30.4, y: 365.25 });
const toDays = (/** @type {number} */ value, /** @type {string} */ unit) => Math.floor(value * UNIT_DAYS[unit]);

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
 * What a heading says about being a habit, or null when it is not one (Emacs stops with an error for a STYLE habit it cannot read:
 * no repeater, a repeat under a day, hours, a last-chance period no longer than the repeat): STYLE habit and a SCHEDULED whose
 * repeater is in days, weeks, months or years. `minDays` is the repeat, `maxDays` the last-chance period after the slash (or the
 * repeat itself); `deadline` is the last-chance day, `type` the repeater's mark (`+`, `++` or `.+`).
 * @param {Heading} heading
 * @returns {{ scheduled: number, minDays: number, maxDays: number, deadline: number, type: string } | null}
 */
export function habitSpec(heading) {
  if (!heading || styleOf(heading) !== 'habit') return null;
  const raw = heading.planning && heading.planning.scheduled;
  const parsed = raw ? parseOrgTimestamp(raw) : null;
  if (!parsed || !parsed.active || !parsed.repeater) return null;
  const rep = /([.+]?\+)(\d+)([dwmy])(?:\/(\d+)([dwmy]))?$/.exec(parsed.repeater);
  if (!rep) return null;
  const minDays = toDays(Number(rep[2]), rep[3]);
  if (minDays < 1) return null;
  const range = rep[4] ? toDays(Number(rep[4]), rep[5]) : null;
  if (range !== null && range <= minDays) return null;
  const scheduled = dayNumber(parsed.date);
  return { scheduled, minDays, maxDays: range ?? minDays, deadline: range === null ? scheduled : scheduled + (range - minDays), type: rep[1] };
}

/** The lines of a heading's own entry that can hold a completion, in file order. @param {Heading} heading */
function completionLines(heading) {
  return [...allLogLines(heading), ...(heading.bodyLines || [])];
}

/** The day numbers a habit was completed on: the first `limit` lines of its entry, top down, that read `- State "<done keyword>" ... [time stamp]` or
 * `- CLOSING NOTE [time stamp]` (org-habit-parse-todo), the last inactive time stamp of the line counting.
 * @param {Heading} heading
 * @param {(keyword: string) => boolean} isDone
 * @param {number} [limit]
 * @returns {number[]} ascending (a day completed twice is listed twice, as Emacs does) */
export function habitDoneDays(heading, isDone, limit = Infinity) {
  /** @type {number[]} */ const days = [];
  for (const line of completionLines(heading)) {
    if (days.length >= limit) break;
    const state = /^[ \t]*-[ \t]+State "([^"]*)".*\[(\d{4}-\d{2}-\d{2}[^\]\r\n>]*)\]/.exec(line);
    const note = /^[ \t]*-[ \t]+CLOSING NOTE \[(\d{4}-\d{2}-\d{2}[^\]\r\n>]*)\]/.exec(line);
    const stamp = state && isDone(state[1]) ? state[2] : note ? note[1] : null;
    const ts = stamp ? parseOrgTimestamp(`[${stamp}]`) : null;
    if (ts) days.push(dayNumber(ts.date));
  }
  return days.sort((a, b) => a - b);
}

/**
 * org-habit-get-faces for one day: 'b' blue, 'g' green, 'y' yellow, 'r' red.
 * @param {number} day @param {number} scheduled @param {number} deadline @param {boolean} done @param {boolean} alwaysGreen
 */
function faceFor(day, scheduled, deadline, done, alwaysGreen) {
  if (day < scheduled) return 'b';
  if (day < deadline) return 'g';
  if (day === deadline) return done ? 'g' : 'y';
  return alwaysGreen && done ? 'g' : 'r';
}

/**
 * The graph for one habit, org-habit-build-graph's: `cells` for every day from today-precedingDays to today+followingDays, each
 * { day, face: 'b'|'g'|'y'|'r', light (Emacs's lighter -future-face), future, mark: '*'|'!'|'' }. The last following day is not drawn, as in Emacs.
 * @param {Heading} heading @param {(keyword: string) => boolean} isDone @param {Date} today
 * @param {{ precedingDays?: number, followingDays?: number, doneAlwaysGreen?: boolean }} [opts]
 */
export function buildHabitGraph(heading, isDone, today, opts = {}) {
  const spec = habitSpec(heading);
  if (!spec) return null;
  const preceding = opts.precedingDays ?? HABIT_DEFAULTS.precedingDays;
  const following = opts.followingDays ?? HABIT_DEFAULTS.followingDays;
  const alwaysGreen = !!opts.doneAlwaysGreen;
  const now = dayNumber(today);
  const sRepeat = spec.minDays;
  const dRepeat = spec.maxDays;
  const allDone = habitDoneDays(heading, isDone, preceding + following);
  let pending = allDone;
  /** @type {number | null} */ let lastDone = null;
  const first = now - preceding;
  while (pending.length && pending[0] < first) {
    lastDone = pending[0];
    pending = pending.slice(1);
  }
  /** @param {number | null} override @returns {{ scheduled: number, deadline: number }} */
  const window = (override) => (override === null ? { scheduled: spec.scheduled, deadline: spec.deadline } : { scheduled: override, deadline: override + (dRepeat - sRepeat) });
  /** The date the habit is next due as of a past day, from the completions up to it (the cumulate, catch-up and restart repeaters differ). @returns {number} */
  const dueAfter = () => {
    if (!pending.length) return spec.scheduled;
    if (spec.type === '.+') return /** @type {number} */ (lastDone) + sRepeat;
    if (spec.type === '+') return spec.scheduled - pending.length * sRepeat;
    const firstDone = allDone[0];
    const shift = (((spec.scheduled - firstDone) % sRepeat) + sRepeat) % sRepeat;
    let due = (shift === 0 ? sRepeat : shift) + firstDone;
    if (firstDone === lastDone) return due;
    for (const d of allDone.slice(1)) {
      due += (1 + Math.trunc(Math.max(d - due, 0) / sRepeat)) * sRepeat;
      if (d === lastDone) return due;
    }
    return due;
  };

  const cells = [];
  // Emacs's graph string has preceding + following + 1 slots and leaves the last blank, so the last of the following days is not drawn
  for (let day = first; day < now + following; day++) {
    const past = day < now;
    const today_ = day === now;
    const done = pending.length > 0 && pending[0] === day;
    /** @type {{ face: string }} */ let chosen;
    if (past && lastDone === null && !(spec.scheduled < now)) chosen = { face: allDone.length && allDone[0] === day ? 'g' : 'b' }; // nothing done yet and not yet due: clear, except the first completion (ready)
    else {
      const { scheduled, deadline } = window(past && lastDone !== null ? dueAfter() : null);
      chosen = { face: faceFor(day, scheduled, deadline, done, alwaysGreen) };
    }
    let mark = '';
    if (done) {
      mark = '*';
      while (pending.length && pending[0] === day) {
        lastDone = pending[0];
        pending = pending.slice(1);
      }
    } else if (today_) mark = '!';
    // the plain face for today and the past days, the lighter -future-face otherwise; a past day not done keeps the plain face only when overdue
    let light = !(past || today_);
    if (past && chosen.face !== 'r' && !mark.startsWith('*')) light = true;
    cells.push({ day, face: chosen.face, light, future: day > now, mark });
  }

  // org-habit-get-priority: what the agenda ranks a habit's row by
  const slip = now - (spec.deadline - 1);
  const priority = 1000 + (now - spec.scheduled) * 10 + (spec.scheduled !== spec.deadline && now === spec.deadline ? 50 : 0) + (slip > 0 ? slip * 100 : slip * 10);
  const last = allDone.length ? allDone[allDone.length - 1] : null;
  return { priority, cells, minDays: spec.minDays, maxDays: spec.maxDays, scheduled: spec.scheduled, deadline: spec.deadline, lastDone: last, todayIndex: preceding };
}

/**
 * The longer view of one habit, from its whole log: the streak of completions in a row that were each no later than the
 * last-chance day after the one before (so the repeater's range is what counts as on time), the best such run, the completions
 * in the last `weeks` weeks, a week-by-week grid (Monday first, the last column holding today) and the latest completions.
 * @param {Heading} heading @param {(keyword: string) => boolean} isDone @param {Date} today
 * @param {number} [weeks]
 */
export function buildHabitHistory(heading, isDone, today, weeks = 12) {
  const spec = habitSpec(heading);
  if (!spec) return null;
  const now = dayNumber(today);
  const done = [...new Set(habitDoneDays(heading, isDone))];
  const onTime = (/** @type {number} */ i) => done[i] - done[i - 1] <= spec.maxDays; // does completion i follow i-1 in time?
  let best = 0;
  let run = 0;
  for (let i = 0; i < done.length; i++) {
    run = i > 0 && onTime(i) ? run + 1 : 1;
    best = Math.max(best, run);
  }
  let streak = 0;
  if (done.length && now - done[done.length - 1] <= spec.maxDays) {
    streak = 1;
    for (let i = done.length - 1; i > 0 && onTime(i); i--) streak++;
  }
  const mondayOffset = (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getDay() + 6) % 7;
  const firstMonday = now - mondayOffset - (weeks - 1) * 7;
  const doneSet = new Set(done);
  const grid = [];
  for (let c = 0; c < weeks; c++) {
    for (let r = 0; r < 7; r++) {
      const day = firstMonday + c * 7 + r;
      grid.push({ day, done: doneSet.has(day), today: day === now, future: day > now });
    }
  }
  const recent = done
    .slice(-5)
    .reverse()
    .map((day, i, list) => {
      const idx = done.length - 1 - i;
      return { day, gap: idx > 0 ? day - done[idx - 1] : null };
    });
  return {
    streak,
    best,
    doneInWindow: done.filter((d) => d >= firstMonday && d <= now).length,
    weeks,
    grid,
    recent,
    minDays: spec.minDays,
    maxDays: spec.maxDays,
    lastDone: done.length ? done[done.length - 1] : null,
    scheduled: spec.scheduled,
    deadline: spec.scheduled + (spec.maxDays - spec.minDays),
  };
}
