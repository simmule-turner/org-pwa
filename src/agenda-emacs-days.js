// The day-by-day rules of the Emacs 29.3 agenda for one SCHEDULED, DEADLINE, plain time stamp or date range: on which day of a
// view it shows, with what time and how many days late or early. A port of org-agenda-get-scheduled, -get-deadlines, -get-timestamps
// and -get-blocks, org-closest-date and org-get-wdays (org.el, org-agenda.el); the names follow them. Days are numbers (days since
// 1970-01-01, local calendar day), as Emacs's absolute day numbers are.

const MS_PER_DAY = 86400000;

/** The day number of a local calendar day (month 1-12; a day past the month's end spills into the next, as in Emacs). @param {number} y @param {number} m @param {number} d */
export function absoluteDay(y, m, d) {
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export { dayNumber as dayNumberOf, dayNumberToDate as dateOfDay } from './habit.js';
import { dayNumber as dayNumberOf, dayNumberToDate as dateOfDay } from './habit.js';

/**
 * org-closest-date: the occurrence of a repeating time stamp nearest to day `cday` ('past: on or before it, 'future: on or
 * after it, otherwise the nearest). A stamp without a `+Nu` (or with +0) stays on its own day. The first `+Nu` of the repeater text
 * counts, whatever its mark (`+`, `++`, `.+`).
 * @param {{ date: Date, repeater?: string | null }} stamp
 * @param {number} cday
 * @param {'past' | 'future' | null} prefer
 */
export function closestDate(stamp, cday, prefer) {
  const start = stamp.date;
  const sday = dayNumberOf(start);
  const m = /\+(\d+)([hdwmy])/.exec(stamp.repeater || '');
  const value = m ? Number(m[1]) : 0;
  if (!m || value === 0) return sday;
  if (cday <= sday) return sday;
  const type = m[2];
  const [by, bm, bd] = [start.getFullYear(), start.getMonth() + 1, start.getDate()];
  const t = dateOfDay(cday);
  const [ty, tm, td] = [t.getFullYear(), t.getMonth() + 1, t.getDate()];
  /** @type {number} */ let n1;
  /** @type {number} */ let n2;
  // (calendar-absolute-from-gregorian (month day year)) with the month 0 org-closest-date can make: December of the year before
  /** @param {number} month @param {number} day @param {number} year */
  const absolute = (month, day, year) => (month === 0 ? absoluteDay(year - 1, 12, day) : absoluteDay(year, month, day));
  /** @param {number[]} d @param {number} n */
  const addMonths = (d, n) => {
    const total = d[0] + n;
    return [((total % 12) + 12) % 12, d[1], Math.trunc(total / 12) + d[2]];
  };
  if (type === 'h') {
    const missing = (((24 * (cday - sday) - start.getHours()) % value) + value) % value;
    n1 = missing === 0 ? cday : cday - (1 + Math.trunc(missing / 24));
    n2 = cday + Math.trunc((value - missing) / 24);
  } else if (type === 'd' || type === 'w') {
    const v = type === 'w' ? value * 7 : value;
    n1 = sday + v * Math.trunc((cday - sday) / v);
    n2 = n1 + v;
  } else if (type === 'm') {
    const months = Math.trunc((12 * (ty - by) + (tm - bm) + (td > bd ? 0 : -1)) / value) * value;
    const before = addMonths([bm, bd, by], months);
    n1 = absolute(before[0], before[1], before[2]);
    const after = addMonths(before, value);
    n2 = absolute(after[0], after[1], after[2]);
  } else {
    const years = Math.trunc((ty - by - (tm > bm || (tm === bm && td > bd) ? 0 : 1)) / value) * value;
    n1 = absolute(bm, bd, by + years);
    n2 = absolute(bm, bd, by + years + value);
  }
  if (prefer === 'past') return cday === n2 ? n2 : n1;
  if (prefer === 'future') return cday === n1 ? n1 : n2;
  return Math.abs(cday - n1) > Math.abs(cday - n2) ? n2 : n1;
}

/** @type {Record<string, number>} */
const UNIT_DAYS = { d: 1, w: 7, m: 30.4, y: 365.25, h: 0.041667 };

/**
 * org-get-wdays: the lead time of a DEADLINE (its own `-Nu` cookie, else org-deadline-warning-days) or, with `delay`, the delay of
 * a SCHEDULED (its `--Nu` cookie, else org-scheduled-delay-days). A default of 0 or less is always used as it stands (negated).
 * @param {string} raw the time stamp text, without its brackets
 * @param {{ delay?: boolean, zeroDelay?: boolean, warningDays: number, delayDays: number }} o
 */
export function getWdays(raw, o) {
  const tv = o.delay ? o.delayDays : o.warningDays;
  if ((o.delay && tv < 0) || (o.delay && o.zeroDelay && tv <= 0) || (!o.delay && tv <= 0)) return -tv;
  const m = /-(\d+)([hdwmy])(?:$|>| )/.exec(raw);
  if (m) return Math.floor(Number(m[1]) * UNIT_DAYS[m[2]]);
  return tv;
}

/**
 * @typedef {{
 *   warningDays: number, delayDays: number, deadlinePastDays: number, scheduledPastDays: number,
 *   showFutureRepeats: boolean | 'next', preferLastRepeat: boolean | string[],
 *   skipScheduledIfDeadlineIsShown: null | true | 'repeated-after-deadline' | 'not-today',
 *   skipDeadlinePrewarningIfScheduled: null | true | number | 'pre-scheduled',
 *   skipScheduledDelayIfDeadline: null | true | number | 'post-deadline',
 *   skipTimestampIfDeadlineIsShown: boolean, skipAdditionalTimestampsSameEntry: boolean, includeInactiveTimestamps: boolean, skipScheduledIfDone: boolean, skipDeadlineIfDone: boolean, skipTimestampIfDone: boolean,
 * }} DaySettings
 */

/** A Lisp value as a settings file writes it: nil, t, a number, a symbol (quoted or not) or a list of strings. @param {string | undefined} raw @returns {null | true | number | string | string[]} */
export function lispValue(raw) {
  if (raw === undefined) return null;
  const str = /^\s*"(.*)"\s*$/.exec(String(raw));
  if (str) return str[1];
  const v = String(raw).trim().replace(/^'/, '');
  if (v === '' || v === 'nil') return null;
  if (v === 't') return true;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^\(.*\)$/.test(v)) return v.slice(1, -1).split(/\s+/).map((x) => x.replace(/^"|"$/g, '')).filter(Boolean);
  return v;
}

/** The agenda's day-by-day settings from the variables of a file (org-deadline-warning-days, org-agenda-skip-*, org-agenda-show-future-repeats ...), Emacs's defaults where unset. @param {Record<string, string> | undefined} vars @returns {DaySettings} */
export function readDaySettings(vars) {
  const v = vars || {};
  const num = (/** @type {string} */ k, /** @type {number} */ d) => {
    const x = lispValue(v[k]);
    return typeof x === 'number' ? x : d;
  };
  const shown = lispValue(v['org-agenda-skip-scheduled-if-deadline-is-shown']);
  const pre = lispValue(v['org-agenda-skip-deadline-prewarning-if-scheduled']);
  const delay = lispValue(v['org-agenda-skip-scheduled-delay-if-deadline']);
  const future = v['org-agenda-show-future-repeats'] === undefined ? true : lispValue(v['org-agenda-show-future-repeats']);
  const last = lispValue(v['org-agenda-prefer-last-repeat']);
  return {
    warningDays: num('org-deadline-warning-days', 14),
    delayDays: num('org-scheduled-delay-days', 0),
    deadlinePastDays: num('org-deadline-past-days', 10000),
    scheduledPastDays: num('org-scheduled-past-days', 10000),
    showFutureRepeats: future === 'next' ? 'next' : future !== null,
    preferLastRepeat: Array.isArray(last) ? last : last === true,
    skipScheduledIfDeadlineIsShown: shown === true || shown === 'repeated-after-deadline' || shown === 'not-today' ? shown : shown === null ? null : true,
    skipDeadlinePrewarningIfScheduled: pre === true || typeof pre === 'number' || pre === 'pre-scheduled' ? pre : pre === null ? null : true,
    skipScheduledDelayIfDeadline: delay === true || typeof delay === 'number' || delay === 'post-deadline' ? delay : delay === null ? null : true,
    skipTimestampIfDeadlineIsShown: lispValue(v['org-agenda-skip-timestamp-if-deadline-is-shown']) !== null,
    skipAdditionalTimestampsSameEntry: lispValue(v['org-agenda-skip-additional-timestamps-same-entry']) !== null,
    includeInactiveTimestamps: lispValue(v['org-agenda-include-inactive-timestamps']) !== null,
    skipScheduledIfDone: lispValue(v['org-agenda-skip-scheduled-if-done']) !== null,
    skipDeadlineIfDone: lispValue(v['org-agenda-skip-deadline-if-done']) !== null,
    skipTimestampIfDone: lispValue(v['org-agenda-skip-timestamp-if-done']) !== null,
  };
}

/** @param {{ raw?: string }} p */
const rawOf = (p) => String(p.raw || '').replace(/^[<[]|[>\]]$/g, '');

/** The settings of Emacs's defaults. @returns {DaySettings} */
export const defaultDaySettings = () => readDaySettings({});

/**
 * Whether a SCHEDULED or DEADLINE shows on day `current` of an agenda, and how, the way Emacs does it. null: not on that day.
 * `other` is the entry's other planning stamp (a SCHEDULED for a DEADLINE and the reverse); `state` its TODO keyword.
 * @param {'scheduled' | 'deadline'} kind
 * @param {{ date: Date, hasTime: boolean, repeater?: string | null, delay?: string | null, raw?: string }} parsed
 * @param {number} current the day being listed
 * @param {number} today
 * @param {DaySettings} o
 * @param {{ other?: { date: Date, raw?: string } | null, state?: string | null, deadlineShown?: boolean }} [ctx]
 * @returns {{ daysOverdue: number, showTime: boolean, ownDay: boolean, pastScheduled: boolean, day: number } | null}
 */
export function planningOnDay(kind, parsed, current, today, o, ctx = {}) {
  const raw = rawOf(parsed) || `${parsed.repeater || ''} ${parsed.delay || ''}`;
  const lastRepeat = o.preferLastRepeat === true || (Array.isArray(o.preferLastRepeat) && !!ctx.state && o.preferLastRepeat.includes(ctx.state));
  const day = lastRepeat ? closestDate(parsed, today, 'past') : dayNumberOf(parsed.date);
  /** @returns {number} */
  const repeatOf = () => {
    if (current <= today || !o.showFutureRepeats) return day;
    return closestDate(parsed, o.showFutureRepeats === 'next' ? today + 1 : current, 'future');
  };
  const repeat = repeatOf();
  const otherDay = ctx.other ? dayNumberOf(ctx.other.date) : null;
  if (kind === 'deadline') {
    const diff = day - current;
    const pre = o.skipDeadlinePrewarningIfScheduled;
    const suppress = otherDay === null || pre === null ? null : typeof pre === 'number' ? pre : pre === 'pre-scheduled' ? Math.min(day - otherDay, o.warningDays) : 0;
    const wdays = suppress ?? getWdays(raw, { warningDays: o.warningDays, delayDays: o.delayDays });
    const todayp = current === today;
    if (current !== day && current !== repeat) {
      if (!todayp) return null;
      if (day > current) {
        if (diff > wdays) return null;
      } else if (o.deadlinePastDays < -diff) return null;
    }
    const own = current === day || current === repeat;
    return { daysOverdue: todayp ? -diff : 0, showTime: own && parsed.hasTime, ownDay: own, pastScheduled: false, day };
  }
  const diff = current - day;
  const dl = o.skipScheduledDelayIfDeadline;
  const suppressDelay = otherDay === null || dl === null ? null : typeof dl === 'number' ? -dl : dl === 'post-deadline' ? Math.min(day - otherDay, o.delayDays) : 0;
  const ddays = suppressDelay !== null ? getWdays(raw, { delay: true, zeroDelay: true, warningDays: o.warningDays, delayDays: suppressDelay }) : getWdays(raw, { delay: true, warningDays: o.warningDays, delayDays: o.delayDays });
  if ((ddays > 0 && diff < ddays) || diff > o.scheduledPastDays || day > current || (current !== day && current !== today && current !== repeat)) return null;
  const mode = o.skipScheduledIfDeadlineIsShown;
  if (mode && ctx.deadlineShown) {
    if (mode === true) return null;
    if (mode === 'not-today' && day < today) return null;
    if (mode === 'repeated-after-deadline' && otherDay !== null && day <= otherDay && current > otherDay) return null;
  }
  const own = current === day || current === repeat;
  const pastScheduled = day < today;
  return { daysOverdue: current === today && pastScheduled ? diff : 0, showTime: own && parsed.hasTime, ownDay: own, pastScheduled, day };
}

/**
 * Whether a plain active time stamp shows on day `current`: on its own date, or on a repeat of it (Emacs repeats only a stamp whose
 * repeater comes last before the `>`).
 * @param {{ date: Date, repeater?: string | null }} parsed
 * @param {number} current
 * @param {number} today
 * @param {DaySettings} [o]
 * @param {string | null} [state] the TODO keyword of the entry
 */
export function timestampOnDay(parsed, current, today, o = defaultDaySettings(), state = null) {
  if (!parsed.repeater) return dayNumberOf(parsed.date) === current;
  const last = o.preferLastRepeat === true || (Array.isArray(o.preferLastRepeat) && !!state && o.preferLastRepeat.includes(state));
  const past = closestDate(parsed, current > today || last ? today : current, 'past');
  const future = current <= today || !o.showFutureRepeats ? past : closestDate(parsed, o.showFutureRepeats === 'next' ? today + 1 : current, 'future');
  return current === past || current === future;
}

/**
 * The time a day of a date range shows (org-agenda-get-blocks): the same time on every day when both ends have it alike, else the
 * start on the first day, the end on the last day (both on a one-day range), none between.
 * @param {{ date: Date, hasTime: boolean }} from
 * @param {{ date: Date, hasTime: boolean }} to
 * @param {number} current
 * @returns {Date | null} the day with the time, or null for no time
 */
export function blockTimeOnDay(from, to, current) {
  const d1 = dayNumberOf(from.date);
  const d2 = dayNumberOf(to.date);
  const clock = (/** @type {{ date: Date, hasTime: boolean }} */ s) => (s.hasTime ? s.date.getHours() * 60 + s.date.getMinutes() : null);
  const at = (/** @type {{ date: Date, hasTime: boolean }} */ s) => (s.hasTime ? new Date(dateOfDay(current).getTime() + (s.date.getHours() * 60 + s.date.getMinutes()) * 60000) : null);
  if (clock(from) === clock(to)) return at(from);
  if (d1 === current && d2 === current) return at(from);
  if (d1 === current) return at(from);
  if (d2 === current) return at(to);
  return null;
}

const CLOCK = '[012]?\\d(?::[0-5]\\d(?:am|pm)?|am|pm)';
const FIRST_TIME = /\b([012]?\d)(?::([0-5]\d)(am|pm)?|(am|pm))\b/i;
const TIME_RANGE = new RegExp(`\\b(${CLOCK})\\b(?:--?\\b(${CLOCK})\\b)?`, 'i');

/** A time such as `9am`, `14:30` or `8:15pm` as hours and minutes the way org-get-time-of-day reads it (no check that hours are below 24). @param {string} text @returns {{ hour: number, minute: number } | null} */
function readClock(text) {
  const m = FIRST_TIME.exec(text);
  if (!m) return null;
  const ampm = (m[3] || m[4] || '').toLowerCase();
  const h = Number(m[1]);
  const hour = !ampm ? h : h === 12 ? (ampm === 'am' ? 0 : 12) : h + (ampm === 'am' ? 0 : 12);
  return { hour, minute: m[2] ? Number(m[2]) : 0 };
}

/**
 * The time of day a heading's text gives (org-agenda-search-headline-for-time): the first time in it, with the end of a range written
 * after it (`16:00-17:00`). null when there is none.
 * @param {string} text
 * @returns {{ hour: number, minute: number, end: { hour: number, minute: number } | null } | null}
 */
export function headlineTime(text) {
  const start = readClock(text);
  if (!start) return null;
  const range = TIME_RANGE.exec(text.slice(Math.max(0, text.search(FIRST_TIME))));
  const end = range && range[2] ? readClock(range[2]) : null;
  return { ...start, end };
}
