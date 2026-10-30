// The time span of an agenda the way the Emacs 29.3 agenda has it (org-agenda.el): org-agenda-span (day, week, fortnight, month, year or a
// number of days), org-agenda-start-day and org-agenda-start-on-weekday, the days a span covers (org-agenda-list), the day a view switch
// starts on (org-agenda-compute-starting-span) and what a step forward or back does (org-agenda-later). The names follow Emacs's.
// A span starts AT its start day: a month is the days of the start day's month counted from the start day, which is why Emacs's own
// month view (`v m`) first moves the start day to the 1st.
import { dateOfDay, dayNumberOf, lispValue } from './agenda-emacs-days.js';

/** @typedef {'day' | 'week' | 'fortnight' | 'month' | 'year' | number} AgendaSpan */

const SPAN_NAMES = ['day', 'week', 'fortnight', 'month', 'year'];

/** org-agenda-ndays-to-span: 1, 7 and 14 days are the day, week and fortnight. @param {AgendaSpan} span @returns {AgendaSpan} */
export function normalizeSpan(span) {
  if (span === 1) return 'day';
  if (span === 7) return 'week';
  if (span === 14) return 'fortnight';
  return span;
}

/** A span from a name or text ("month", "10", 10); null when it is none. @param {unknown} value @returns {AgendaSpan | null} */
export function parseSpan(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? normalizeSpan(value) : null;
  const text = String(value ?? '').trim().replace(/^'/, '');
  if (SPAN_NAMES.includes(text)) return /** @type {AgendaSpan} */ (text);
  return /^\d+$/.test(text) && Number(text) > 0 ? normalizeSpan(Number(text)) : null;
}

/** org-agenda-span, week when unset or unreadable. @param {Record<string, string> | undefined} vars @returns {AgendaSpan} */
export function readAgendaSpan(vars) {
  const raw = (vars || {})['org-agenda-span'];
  if (raw === undefined) return 'week';
  const v = lispValue(raw);
  return parseSpan(typeof v === 'string' ? v : v) ?? 'week';
}

/** org-agenda-start-on-weekday: 0 (Sunday) to 6, nil for none, 1 (Monday) when unset. @param {Record<string, string> | undefined} vars @returns {number | null} */
export function readStartOnWeekday(vars) {
  const raw = (vars || {})['org-agenda-start-on-weekday'];
  if (raw === undefined) return 1;
  const v = lispValue(raw);
  if (v === null) return null;
  return typeof v === 'number' && v >= 0 && v <= 6 ? v : 1;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** @param {number} y @param {number} m 1-12 @param {number} d */
const dayOf = (y, m, d) => dayNumberOf(new Date(y, m - 1, d));

/**
 * What `(org-read-date nil t TEXT)` makes of the start-day text, for the forms an agenda start day is written in: an ISO date, `.`/today,
 * a relative `+2d` `-1` `+1w` `-1m` `+1y` (with `++`), a weekday (`fri`, `+2fri`, `-1mon`: the n-th one on from or back from today),
 * a bare day of the month, and month-day (`10-20`, `oct 20`, `20 oct`; a date already past is the next year's, a day of month the next month's).
 * Emacs reads `tomorrow` and `yesterday` as today. null: the text is none of these.
 * @param {string} text @param {Date} today @returns {Date | null}
 */
export function parseStartDay(text, today) {
  const t = text.trim().toLowerCase();
  const todayN = dayNumberOf(today);
  const y = today.getFullYear();
  const m0 = today.getMonth() + 1;
  const d0 = today.getDate();
  let r;
  if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) return dateOfDay(dayOf(Number(r[1]), Number(r[2]), Number(r[3])));
  if (t === '' || t === '.' || t === 'today' || t === 'tomorrow' || t === 'yesterday') return dateOfDay(todayN);
  if ((r = /^(\+\+|\+|-)(\d*)([dwmy])?$/.exec(t))) {
    const sign = r[1] === '-' ? -1 : 1;
    const n = (r[2] === '' ? 1 : Number(r[2])) * sign;
    const unit = r[3] || 'd';
    if (unit === 'd') return dateOfDay(todayN + n);
    if (unit === 'w') return dateOfDay(todayN + 7 * n);
    if (unit === 'm') return dateOfDay(dayOf(y, m0 + n, d0));
    return dateOfDay(dayOf(y + n, m0, d0));
  }
  if ((r = /^(\+\+|\+|-)?(\d*)(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(t))) {
    const wanted = WEEKDAYS.indexOf(r[3]);
    const back = r[1] === '-';
    let count = r[2] === '' ? 1 : Number(r[2]);
    let n = todayN;
    while (count > 0) {
      n += back ? -1 : 1;
      if (dateOfDay(n).getDay() === wanted) count--;
    }
    return dateOfDay(n);
  }
  if ((r = /^(\d{1,2})$/.exec(t))) {
    const day = Number(r[1]);
    return dateOfDay(day >= d0 ? dayOf(y, m0, day) : dayOf(y, m0 + 1, day));
  }
  let month = 0;
  let day = 0;
  if ((r = /^(\d{1,2})[-/](\d{1,2})$/.exec(t))) [month, day] = [Number(r[1]), Number(r[2])];
  else if ((r = /^([a-z]{3})[a-z]*\.? (\d{1,2})$/.exec(t)) && MONTHS.includes(r[1])) [month, day] = [MONTHS.indexOf(r[1]) + 1, Number(r[2])];
  else if ((r = /^(\d{1,2}) ([a-z]{3})[a-z]*\.?$/.exec(t)) && MONTHS.includes(r[2])) [month, day] = [MONTHS.indexOf(r[2]) + 1, Number(r[1])];
  if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
    const same = dayOf(y, month, day);
    return dateOfDay(same >= todayN ? same : dayOf(y + 1, month, day));
  }
  return null;
}

/**
 * org-agenda-start-day: the day an agenda starts on, instead of today. null when it is nil, or none this reads.
 * @param {Record<string, string> | undefined} vars @param {Date} today @returns {Date | null}
 */
export function readAgendaStartDay(vars, today) {
  const raw = (vars || {})['org-agenda-start-day'];
  if (raw === undefined) return null;
  const v = lispValue(raw);
  return typeof v === 'string' ? parseStartDay(v, today) : null;
}

/** org-agenda-span-to-ndays. @param {AgendaSpan} span @param {Date} start */
export function spanDayCount(span, start) {
  if (typeof span === 'number') return span;
  if (span === 'day') return 1;
  if (span === 'week') return 7;
  if (span === 'fortnight') return 14;
  if (span === 'month') return new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const leap = new Date(start.getFullYear(), 1, 29).getDate() === 29;
  return leap ? 366 : 365;
}

/**
 * The days an agenda of `span` from `startDay` lists (org-agenda-list): from the start day itself, back to `startOnWeekday` (0-6, null: no
 * moving) for a week or a fortnight, and `ndays` of them.
 * @param {AgendaSpan} span @param {Date} startDay @param {number | null} startOnWeekday
 * @returns {{ start: Date, end: Date, ndays: number }} `end` is the last day, at the start of that day
 */
export function spanRange(span, startDay, startOnWeekday = 1) {
  const sd = dayNumberOf(startDay);
  const ndays = spanDayCount(normalizeSpan(span), startDay);
  const aligned = ndays === 7 || ndays === 14 ? startOnWeekday : null;
  let first = sd;
  if (aligned !== null && ndays >= 7) {
    const d = dateOfDay(sd).getDay() - aligned;
    first = sd - ((d < 0 ? 7 : 0) + d);
  }
  return { start: dateOfDay(first), end: dateOfDay(first + ndays - 1), ndays };
}

/**
 * The start day after switching an agenda to `span` while it shows `day` (org-agenda-compute-starting-span without a number): the start
 * of the week or fortnight (per `startOnWeekday`), the 1st of the month, the 1st of January; a day or a number of days keep the day.
 * @param {Date} day @param {AgendaSpan} span @param {number | null} startOnWeekday @returns {Date}
 */
export function startingDayForSpan(day, span, startOnWeekday = 1) {
  const s = normalizeSpan(span);
  if (s === 'week' || s === 'fortnight') {
    const d = startOnWeekday === null ? 0 : day.getDay() - startOnWeekday;
    return dateOfDay(dayNumberOf(day) - ((d < 0 ? 7 : 0) + d));
  }
  if (s === 'month') return new Date(day.getFullYear(), day.getMonth(), 1);
  if (s === 'year') return new Date(day.getFullYear(), 0, 1);
  return dateOfDay(dayNumberOf(day));
}

/**
 * The start day `direction` spans on (org-agenda-later with 1, org-agenda-earlier with -1): a month or a year moves by calendar month or
 * year, keeping the day of the month (a 31st past the end of the month runs into the next).
 * @param {AgendaSpan} span @param {Date} startDay @param {number} direction @returns {Date}
 */
export function stepStartDay(span, startDay, direction) {
  const s = normalizeSpan(span);
  const sd = dayNumberOf(startDay);
  if (s === 'month') return new Date(startDay.getFullYear(), startDay.getMonth() + direction, startDay.getDate());
  if (s === 'year') return new Date(startDay.getFullYear() + direction, startDay.getMonth(), startDay.getDate());
  const n = typeof s === 'number' ? s : s === 'day' ? 1 : s === 'week' ? 7 : 14;
  return dateOfDay(sd + n * direction);
}

/** org-agenda-span-name. @param {AgendaSpan} span */
export function spanName(span) {
  const s = normalizeSpan(span);
  return typeof s === 'number' ? `${s} days` : s.charAt(0).toUpperCase() + s.slice(1);
}

/** The text a view is kept under in the app's state: the span's name, or its number of days. @param {AgendaSpan} span */
export function spanKey(span) {
  return String(normalizeSpan(span));
}
