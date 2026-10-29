// @ts-check
/**
 * The time ranges of a clock report as Org reads them: `org-clock-special-range` (the `:block` parameter: `today`, `thisweek`,
 * `2026-08`, `2026-W32`, `2026-Q3`, `lastmonth`, `today-2`, ...) and `org-matcher-time` (the text of `:tstart` and `:tend`: a date,
 * `<now>`, `<today>`, `<-1w>`, ...). Compared with Emacs 29.3 / Org 9.6 by test/oracle-todo-log-clock.test.js.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** An error Org reports to the person (`user-error`), by its message. */
export class ClockReportError extends Error {
  /** @param {string} message @param {boolean} [blankLine]  whether Org has already written the blank line of the block's body when it fails */
  constructor(message, blankLine = true) {
    super(message);
    this.blankLine = blankLine;
  }
}

/** @param {number} n @param {number} width */
const pad = (n, width = 2) => String(n).padStart(width, '0');

/** The ISO week of a date: its year and number (`%G` and `%V`). @param {Date} date @returns {{ year: number, week: number }} */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { year: d.getUTCFullYear(), week: Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7) };
}

/** The Monday that starts ISO week `week` of ISO year `year`. @param {number} year @param {number} week */
function isoWeekStart(year, week) {
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(year, 0, 4 - ((jan4.getDay() + 6) % 7));
  monday.setDate(monday.getDate() + (week - 1) * 7);
  return monday;
}

/** `[2026-08-03 Mon 09:00]` and the like: the inactive timestamp of a moment, with or without the time. @param {Date} date @param {boolean} withTime */
export function inactiveStamp(date, withTime) {
  return `[${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${DAYS[date.getDay()].slice(0, 3)}${withTime ? ` ${pad(date.getHours())}:${pad(date.getMinutes())}` : ''}]`;
}

/** @param {number} n */
const ordinal = (n) => ['', '1st', '2nd', '3rd', '4th'][n];

/**
 * The two moments around a named range, and the text that says which one it is. A range with no start (`untilnow`) has `start` null.
 * @param {string | number} key  the `:block` value
 * @param {Date} now
 * @param {{ wstart?: number | null, mstart?: number | null }} [options]
 * @returns {{ start: Date | null, end: Date, text: string }}
 */
export function clockSpecialRange(key, now, { wstart = null, mstart = null } = {}) {
  let m = now.getMinutes();
  let h = now.getHours();
  let d = now.getDate();
  let month = now.getMonth() + 1;
  let y = now.getFullYear();
  let dow = now.getDay();
  const skey = String(key);
  let shift = 0;
  let q = month >= 10 ? 4 : month >= 7 ? 3 : month >= 4 ? 2 : 1;
  /** @type {number | undefined} */ let h1;
  /** @type {number | undefined} */ let d1;
  /** @type {number | undefined} */ let month1;
  /** @type {number | undefined} */ let y1;
  let shiftedy = 0;
  let shiftedq = 0;
  /** @type {number} */ let shiftedm;
  /** @type {string} */
  let name = skey;
  let m1;
  if (/^[0-9]+$/.test(skey)) {
    y = Number(skey);
    month = 1;
    d = 1;
    name = 'year';
  } else if ((m1 = /^([0-9]+)-([0-9]{1,2})$/.exec(skey))) {
    y = Number(m1[1]);
    month = Number(m1[2]);
    d = 1;
    name = 'month';
  } else if ((m1 = /^([0-9]+)-[wW]([0-9]{1,2})$/.exec(skey))) {
    const date = isoWeekStart(Number(m1[1]), Number(m1[2]));
    d = date.getDate();
    month = date.getMonth() + 1;
    y = date.getFullYear();
    dow = 1;
    name = 'week';
  } else if ((m1 = /^([0-9]+)-[qQ]([1-4])$/.exec(skey))) {
    q = Number(m1[2]);
    y = Number(m1[1]);
    month = 3 * (q - 1) + 1;
    d = 1;
    dow = 1;
    name = 'quarter';
  } else if ((m1 = /^([0-9]+)-([0-9]{1,2})-([0-9]{1,2})$/.exec(skey))) {
    y = Number(m1[1]);
    month = Number(m1[2]);
    d = Number(m1[3]);
    name = 'day';
  } else if ((m1 = /([-+][0-9]+)$/.exec(skey))) {
    shift = Number(m1[1]);
    name = skey.slice(0, m1.index);
    if ((name === 'quarter' || name === 'thisq') && shift > 0) throw new ClockReportError("Looking forward with quarters isn't implemented");
  }
  if (shift === 0) {
    if (name === 'yesterday') [name, shift] = ['today', -1];
    else if (name === 'lastweek') [name, shift] = ['week', -1];
    else if (name === 'lastmonth') [name, shift] = ['month', -1];
    else if (name === 'lastyear') [name, shift] = ['year', -1];
    else if (name === 'lastq') [name, shift] = ['quarter', -1];
  }
  // org-extend-today-until is 0 here: a day starts at midnight
  switch (name) {
    case 'day':
    case 'today':
      m = 0;
      h = 0;
      h1 = 24;
      d += shift;
      break;
    case 'week':
    case 'thisweek': {
      const ws = wstart ?? 1;
      const diff = -7 * shift + (dow === 0 ? 7 - ws : dow - ws);
      m = 0;
      h = 0;
      d -= diff;
      d1 = 7 + d;
      break;
    }
    case 'month':
    case 'thismonth':
      h = 0;
      m = 0;
      d = mstart ?? 1;
      month += shift;
      month1 = month + 1;
      break;
    case 'quarter':
    case 'thisq':
      if (q - 1 + shift < 0) {
        const interval = -(q - 1 + shift);
        const quotient = Math.floor(interval / 4);
        const remainder = interval - quotient * 4;
        if (remainder === 0) [shiftedy, shiftedm, shiftedq] = [y - quotient, 1, 1];
        else [shiftedy, shiftedm, shiftedq] = [y - (1 + quotient), 13 - 3 * remainder, 5 - remainder];
        m = 0;
        h = 0;
        d = 1;
        month = shiftedm;
        month1 = 3 + shiftedm;
        y = shiftedy;
      } else if (q + shift > 0) {
        shiftedq = q + shift;
        shiftedy = y;
        const qshift = 3 * (q + shift - 1);
        m = 0;
        h = 0;
        d = 1;
        month = 1 + qshift;
        month1 = 4 + qshift;
      }
      break;
    case 'year':
    case 'thisyear':
      m = 0;
      h = 0;
      d = 1;
      month = 1;
      y += shift;
      y1 = y + 1;
      break;
    case 'untilnow':
      break;
    default:
      throw new ClockReportError(`No such time block ${name}`);
  }
  const at = (/** @type {number} */ yy, /** @type {number} */ mo, /** @type {number} */ dd, /** @type {number} */ hh, /** @type {number} */ mi) => new Date(yy, mo - 1, dd, hh, mi);
  const start = name === 'untilnow' ? null : at(y, month, d, h, m);
  const minute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()); // a stamp has no seconds
  const end = name === 'untilnow' ? minute : at(y1 ?? y, month1 ?? month, d1 ?? d, h1 ?? h, m);
  let text = '';
  const s = /** @type {Date} */ (start);
  switch (name) {
    case 'day':
    case 'today':
      text = `${DAYS[s.getDay()]}, ${MONTHS[s.getMonth()]} ${pad(s.getDate())}, ${s.getFullYear()}`;
      break;
    case 'week':
    case 'thisweek': {
      const w = isoWeek(s);
      text = `week ${w.year}-W${pad(w.week)}`;
      break;
    }
    case 'month':
    case 'thismonth':
      text = `${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
      break;
    case 'year':
    case 'thisyear':
      text = `the year ${s.getFullYear()}`;
      break;
    case 'quarter':
    case 'thisq':
      text = `${ordinal(shiftedq)} quarter of ${shiftedy}`;
      break;
    case 'untilnow':
      text = 'now';
      break;
  }
  return { start, end, text };
}

/**
 * Org's `org-matcher-time`: a moment from the text of `:tstart` / `:tend`, in milliseconds. `<now>`, `<today>`, `<tomorrow>`,
 * `<yesterday>`, `<+2d>` (hours from now, the rest from today's midnight) and anything holding a `YYYY-MM-DD [day] [H:MM]` date;
 * text that is none of these is 0.
 * @param {string} s
 * @param {Date} now
 */
export function matcherTime(s, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (s === '<now>') return now.getTime();
  if (s === '<today>') return today;
  if (s === '<tomorrow>') return today + 86400000;
  if (s === '<yesterday>') return today - 86400000;
  const rel = /^<([-+][0-9]+)([hdwmy])>$/.exec(s);
  if (rel) {
    const seconds = /** @type {Record<string, number>} */ ({ h: 3600, d: 86400, w: 604800, m: 2678400, y: 31557600 })[rel[2]];
    return (rel[2] === 'h' ? now.getTime() : today) + Number(rel[1]) * seconds * 1000;
  }
  const ts = /([0-9]{4})-([0-9]{2})-([0-9]{2})(?: +[^\]\r\n>0-9 ]+)?(?: +([0-9]{1,2}):([0-9]{2}))?/.exec(s);
  if (ts) return new Date(Number(ts[1]), Number(ts[2]) - 1, Number(ts[3]), Number(ts[4] || 0), Number(ts[5] || 0)).getTime();
  return 0;
}

/** The date of an absolute day number (`calendar-gregorian-from-absolute`: day 1 is 0001-01-01), as `YYYY-MM-DD`. @param {number} n */
export function dateOfAbsoluteDay(n) {
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(1, 0, 1);
  d.setUTCDate(d.getUTCDate() + n - 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
