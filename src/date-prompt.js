// @ts-check
// The date prompt around `org-read-date` (Org 9.6): its prompt text, the live "=> <2026-11-24 Tue>" it shows while typing, and the calendar
// motions its minibuffer binds (S-arrows, M-S-arrows, `<`, `>`, `.`). What the typed text means is src/read-date.js; this is the rest of the question.
import { readDate } from './read-date.js';
import { formatStamp } from './timestamp-edit.js';

const pad2 = (/** @type {number} */ n) => String(n).padStart(2, '0');

/** `%Y-%m-%d` of a local Date. @param {Date} d */
export const isoDate = (d) => `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * The prompt `org-read-date` asks: the caller's word first (SCHEDULED, DEADLINE), then `Date+time [default]: ` where the default is the date
 * (and with `withTime`, the time) of `defaultTime`, or now. Before `extendTodayUntil` o'clock it is still the day before, at 23:59.
 * @param {{ prefix?: string | null, defaultTime?: Date | null, withTime?: boolean, now?: Date, extendTodayUntil?: number }} [o]
 */
export function datePromptLabel({ prefix = null, defaultTime = null, withTime = false, now = new Date(), extendTodayUntil = 0 } = {}) {
  let def = defaultTime ?? now;
  if (def.getHours() < extendTodayUntil) def = new Date(def.getFullYear(), def.getMonth(), def.getDate() - 1, 23, 59, def.getSeconds());
  return `${prefix ? `${prefix} ` : ''}Date+time [${isoDate(def)}${withTime ? ` ${pad2(def.getHours())}:${pad2(def.getMinutes())}` : ''}]: `;
}

/** What the prompt hands to the analysis: the text typed, a space, and the day picked in the calendar (a tap, or the last calendar motion) if any. @param {string} typed @param {string | null} picked */
export const dateAnswer = (typed, picked) => `${typed} ${picked ?? ''}`;

/**
 * The live display, as Emacs shows it after the input: `=> <2026-11-24 Tue>` (with the time when one was typed or the prompt takes one, and `(=>F)`
 * when the date was moved to the future). `answer` is `dateAnswer(...)`.
 * @param {string} answer @param {{ defaultTime?: Date | null, withTime?: boolean, now?: Date, vars?: { preferFuture?: boolean | 'time', extendTodayUntil?: number } }} [o]
 * @returns {{ date: Date, text: string }}
 */
export function describeDate(answer, { defaultTime = null, withTime = false, now = new Date(), vars = {} } = {}) {
  const r = readDate(answer, { now, defaultTime, ...vars, endBound: true });
  let text = formatStamp(r.date, withTime || r.timeGiven, false);
  if (r.endTimeGiven) text = text.replace(/( \d\d:\d\d)>$/, `$1-${r.endTimeGiven}>`);
  return { date: r.date, text: `=> ${text}${r.futurep ? ' (=>F)' : ''}` };
}

/** The last day of `month` (0-11) of `year`. @param {number} year @param {number} month */
const lastDay = (year, month) => new Date(year, month + 1, 0).getDate();

/**
 * Where the calendar cursor goes (`calendar-forward-day` and the others): `day`/`week` by `n` days or weeks, `month`/`year` by `n` months or years, the
 * day of the month kept unless the new month is shorter (the 31st goes to the last day, Feb 29 to Feb 28).
 * @param {Date} from @param {'day' | 'week' | 'month' | 'year'} unit @param {number} n
 */
export function moveCalendarDate(from, unit, n) {
  if (unit === 'day' || unit === 'week') return new Date(from.getFullYear(), from.getMonth(), from.getDate() + (unit === 'week' ? 7 * n : n));
  const months = from.getMonth() + (unit === 'year' ? 12 * n : n);
  const year = from.getFullYear() + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  return new Date(year, month, Math.min(from.getDate(), lastDay(year, month)));
}

/**
 * The calendar motion the minibuffer binds to a key of Emacs's `org-read-date-minibuffer-local-map`, or null for a key that is not one of them.
 * `S-<right>` and its kin move the cursor a day or a week, `M-S-<right>` a month, `M-S-<down>` a year (and `M-S-` is also `ESC S-`).
 * @param {string} key  e.g. 'S-<left>', 'M-S-<down>'
 * @returns {{ unit: 'day' | 'week' | 'month' | 'year', n: number } | null}
 */
export function calendarMotion(key) {
  /** @type {Record<string, { unit: 'day' | 'week' | 'month' | 'year', n: number }>} */
  const keys = {
    'S-<right>': { unit: 'day', n: 1 },
    'S-<left>': { unit: 'day', n: -1 },
    'S-<down>': { unit: 'week', n: 1 },
    'S-<up>': { unit: 'week', n: -1 },
    'M-S-<right>': { unit: 'month', n: 1 },
    'M-S-<left>': { unit: 'month', n: -1 },
    'M-S-<down>': { unit: 'year', n: 1 },
    'M-S-<up>': { unit: 'year', n: -1 },
  };
  return keys[key] ?? null;
}
