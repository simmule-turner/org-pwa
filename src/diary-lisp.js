// @ts-check
/**
 * The diary's Lisp environment: the interpreter (elisp.js) with the diary and calendar functions of Emacs as built-ins, and the
 * variables `date` and `entry` bound to the day being evaluated. A program is evaluated with Emacs's plain `eval` (dynamic binding),
 * under a step budget and `max-lisp-eval-depth`.
 */
import { BudgetExceeded, Cons, Flt, LispSignal, NIL, Special, Sym, T, intern, list, print, signal, toArray, wrongType } from './elisp-data.js';
import { Reader } from './elisp-read.js';
import { defSpecial, defun, evalForm, funcall, resetRun, state, withDynamic } from './elisp-core.js';
import { describeFailure } from './elisp.js';
import { DEFAULT_TIME_DISPLAY_FORM } from './local-variables.js';
import { startOfDay } from './agenda.js';
import { holidaysOn, initBindings } from './holidays.js';
import { nthNamedDay } from './calendar-conv.js';
import { nonGregorianDateLine } from './diary-nongregorian.js';
import { hebrewBirthday, hebrewYahrzeit, hebrewOmer, hebrewRoshHodesh, hebrewParasha, isFriday } from './diary-hebrew.js';
import { chineseDateString } from './calendar-chinese.js';
import { astroDayNumberLine, dayOfYearLine, isoDateLine, julianDateLine, lunarPhasesLine } from './diary-calendar.js';
import { diaryEntryTime } from './diary-file.js';
import { formatWeatherLine } from './org-weather.js';
import { expandOrgAnniversaryOccurrences, expandOrgCyclicOccurrences, diaryFloatMatches, solarSunriseSunset } from './diary-sexp.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */
/**
 * @typedef {object} Context  what a diary program may ask about: the day, the place, the settings, and extra variables
 * @property {Date} [candidateDate]  the day being evaluated (default: today)
 * @property {Date} [today]
 * @property {string} [entryText]
 * @property {number} [calendarLatitude]
 * @property {number} [calendarLongitude]
 * @property {string | null} [calendarLocationName]
 * @property {string} [calendarDateStyle]
 * @property {number} [diaryHebrewSabbathCandlesMinutes]
 * @property {string} [calendarTimeDisplayForm]
 * @property {string} [timeZone]
 * @property {Record<string, unknown>} [env]  variables bound for the program (holiday rules)
 * @property {unknown} [weatherData]
 * @property {string} [orgWeatherFormat]
 * @property {string} [orgWeatherTemperatureUnit]
 * @property {string} [orgWeatherSpeedUnit]
  */
/** @typedef {Context & { candidateDate: Date, today: Date, calendarLatitude: number, calendarLongitude: number }} Full  a Context with its defaults filled in */

/** One day's evaluation may not run longer than this many steps. */
export const MAX_STEPS = 20000;
/** Evaluation depth `emacs --batch --eval` already uses when a program starts. */
const BASE_DEPTH = 20;
/** Where the sun is computed for when a context names no place (the app's default location). */
const DEFAULT_LATITUDE = 35.994;
const DEFAULT_LONGITUDE = -78.8986;

/** The context of the evaluation in progress: `{ candidateDate, today, calendarLatitude, ... }`. @type {Full | null} */
let current = null;

/** @returns {Full} */
function ctx() {
  if (!current) throw signal('error', ['No diary day is being evaluated']);
  return current;
}

// ---- plain JS values <-> Lisp --------------------------------------------------------------------

/** A JS value as the Lisp object it stands for. @param {unknown} v @returns {LObj} */
export function fromJs(v) {
  if (v === false || v === null || v === undefined) return NIL;
  if (v === true) return T;
  if (typeof v === 'number') return Number.isInteger(v) ? v : new Flt(v);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return list(v.map(fromJs));
  return NIL;
}

/** A Lisp object as a plain JS value: nil false, t true, numbers, strings, lists as arrays. @param {LObj} x @returns {unknown} */
export function toJs(x) {
  if (x === NIL) return false;
  if (x === T) return true;
  if (typeof x === 'number' || typeof x === 'string') return x;
  if (typeof x === 'bigint') return Number(x);
  if (x instanceof Flt) return x.v;
  if (x instanceof Cons) return toArray(x).map(toJs);
  if (Array.isArray(x)) return x.map(toJs);
  return true;
}

/** An unevaluated argument as the plain value `sexpArgToValue` gives: symbols by name, nil as null. @param {LObj} x @returns {unknown} */
function argToValue(x) {
  if (x === NIL) return null;
  if (x === T) return true;
  if (typeof x === 'number' || typeof x === 'string') return x;
  if (x instanceof Flt) return x.v;
  if (x instanceof Cons) {
    if (x.car === intern('quote') && x.cdr instanceof Cons) return argToValue(x.cdr.car);
    return toArray(x).map(argToValue);
  }
  if (x instanceof Sym) return x.name;
  return null;
}

// ---- reading ------------------------------------------------------------------------------------

/** A list of numbers or strings written without a quote, `(1 4 7 10)`, is data: the diary has always read it so. @param {LObj} f @returns {LObj} */
function literalize(f) {
  if (!(f instanceof Cons)) return f;
  if (f.car === intern('quote')) return f;
  if (typeof f.car === 'number' || typeof f.car === 'string' || f.car instanceof Flt) return list([intern('quote'), f]);
  /** @type {LObj[]} */
  const items = [];
  /** @type {LObj} */
  let p = f;
  while (p instanceof Cons) {
    items.push(literalize(p.car));
    p = p.cdr;
  }
  return list(items, p);
}

/** A fresh copy of a form, so a program that changes a quoted list cannot change the cached form. @param {LObj} x @returns {LObj} */
function copyLisp(x) {
  if (x instanceof Cons) return new Cons(copyLisp(x.car), copyLisp(x.cdr));
  if (Array.isArray(x)) return x.map(copyLisp);
  return x;
}

/** @type {Map<string, LObj>} */
const formCache = new Map();

/** The form written in `source`, a fresh copy. @param {string} source @returns {LObj} */
export function readForm(source) {
  let form = formCache.get(source);
  if (form === undefined) {
    form = literalize(new Reader(source).read());
    if (formCache.size > 500) formCache.clear();
    formCache.set(source, form);
  }
  return copyLisp(form);
}

// ---- running ------------------------------------------------------------------------------------

/** @param {Date} d */
const dateList = (d) => list([d.getMonth() + 1, d.getDate(), d.getFullYear()]);

const DATE = intern('date');
const ENTRY = intern('entry');
DATE.special = true;
ENTRY.special = true;

/** Runs `fn` for the day of `context`, nested inside a running evaluation or as a new one. @template T @param {Context} context @param {() => T} fn */
export function withContext(context, fn) {
  const outer = current;
  const today = context.today instanceof Date ? context.today : new Date();
  /** @type {Full} */
  const full = {
    ...context,
    today,
    candidateDate: context.candidateDate instanceof Date ? context.candidateDate : today,
    calendarLatitude: context.calendarLatitude ?? DEFAULT_LATITUDE,
    calendarLongitude: context.calendarLongitude ?? DEFAULT_LONGITUDE,
  };
  context = full;
  if (outer === null) {
    resetRun({ budget: MAX_STEPS });
    state.depth = BASE_DEPTH;
  }
  current = full;
  /** @type {[import('./elisp.js').Sym, LObj][]} */
  const pairs = [...initBindings().filter(([s]) => s !== DATE && s !== ENTRY), [DATE, dateList(full.candidateDate)], [ENTRY, typeof context.entryText === 'string' ? context.entryText : NIL]];
  for (const [name, value] of Object.entries(context.env || {})) pairs.push([intern(name), fromJs(value)]);
  try {
    return withDynamic(pairs, fn);
  } finally {
    current = outer;
  }
}

/**
 * Evaluates the Lisp form in `source` for the day of `context`.
 * @param {string} source @param {Context} context
 * @returns {{ value: LObj } | { error: string, kind: string }}
 */
export function evalSource(source, context) {
  try {
    return { value: withContext(context, () => evalForm(readForm(source), null)) };
  } catch (e) {
    const { message, kind } = describeFailure(e);
    return { error: message, kind };
  }
}

/** Evaluates an already-built form the same way. @param {LObj} form @param {Context} context */
export function evalLisp(form, context) {
  try {
    return { value: withContext(context, () => evalForm(literalize(form), null)) };
  } catch (e) {
    const { message, kind } = describeFailure(e);
    return { error: message, kind };
  }
}

// ---- helpers for the built-ins ------------------------------------------------------------------

/** @param {LObj} x @returns {number} */
function intOf(x) {
  if (typeof x === 'number') return x;
  throw wrongType('integerp', x);
}
/** @param {LObj} x @returns {number} */
function numOf(x) {
  if (typeof x === 'number') return x;
  if (x instanceof Flt) return x.v;
  throw wrongType('numberp', x);
}
/** (month day year) from a date list. @param {LObj} x @returns {[number, number, number]} */
function dateParts(x) {
  const items = x instanceof Cons ? toArray(x) : null;
  if (!items || items.length !== 3 || !items.every((n) => typeof n === 'number')) throw wrongType('listp', x);
  return /** @type {[number, number, number]} */ (items);
}
/** A real Date, or null for an impossible day. @param {number} year @param {number} month @param {number} day */
function realDate(year, month, day) {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}
/** @param {Date} date */
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
}
/** @param {number} y @param {number} m @param {number} d */
function absoluteDay(y, m, d) {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return Math.round(t.getTime() / 86400000) + 719163;
}
/** @param {number} abs */
function gregorianFromAbsolute(abs) {
  const t = new Date((abs - 719163) * 86400000);
  return [t.getUTCMonth() + 1, t.getUTCDate(), t.getUTCFullYear()];
}
/** calendar-location-name's default: "40.7N, 74.0W". @param {number} lat @param {number} lon */
function defaultLocationName(lat, lon) {
  return `${Math.abs(lat).toFixed(1)}${lat > 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}${lon > 0 ? 'E' : 'W'}`;
}

/** Order of [month, day, year] within a diary date for each calendar-date-style. */
export const DATE_STYLE_ORDER = { american: [0, 1, 2], european: [1, 0, 2], iso: [2, 0, 1] };

/**
 * Turns the arguments of a diary-anniversary, diary-cyclic, diary-block or diary-date (dates written in `style` order) into the
 * year-month-day order of the org-* twins.
 * @template T @param {string} name @param {T[]} args @param {string} [style] @returns {T[]}
 */
export function reorderDiaryDates(name, args, style) {
  const order = /** @type {Record<string, number[]>} */ (DATE_STYLE_ORDER)[style || 'american'] || DATE_STYLE_ORDER.american;
  /** @param {T[]} d */
  const ymd = (d) => [d[order.indexOf(2)], d[order.indexOf(0)], d[order.indexOf(1)]];
  if (name === 'diary-cyclic') return args.length < 4 ? args : [args[0], ...ymd(args.slice(1, 4))];
  if (name === 'diary-block') return args.length < 6 ? args : [...ymd(args.slice(0, 3)), ...ymd(args.slice(3, 6))];
  return args.length < 3 ? args : ymd(args.slice(0, 3));
}

// ---- solar-time-string --------------------------------------------------------------------------

/**
 * Emacs's solar-time-string: TIME in decimal hours, shown by evaluating each element of calendar-time-display-form, with
 * 12-hours, 24-hours, minutes, am-pm and time-zone bound the way solar.el binds them.
 * @param {number} time @param {unknown} zone @param {Context} context
 */
export function solarTimeString(time, zone, context) {
  const total = Math.round(time * 60);
  const hours24 = Math.trunc(total / 60);
  /** @type {[import('./elisp.js').Sym, LObj][]} */
  const vars = [
    [intern('minutes'), String(total % 60).padStart(2, '0')],
    [intern('12-hours'), String(1 + ((hours24 + 11) % 12))],
    [intern('am-pm'), hours24 >= 12 ? 'pm' : 'am'],
    [intern('24-hours'), String(hours24).padStart(2, '0')],
    [intern('time-zone'), fromJs(zone)],
  ];
  /** @param {string} text @returns {LObj[] | null} */
  const elements = (text) => {
    try {
      const form = new Reader(text).read();
      return form instanceof Cons ? toArray(form) : null;
    } catch {
      return null;
    }
  };
  const items = elements(context.calendarTimeDisplayForm || DEFAULT_TIME_DISPLAY_FORM) ?? elements(DEFAULT_TIME_DISPLAY_FORM) ?? [];
  return withContext(current ? { ...current, ...context } : context, () => withDynamic(vars, () => items.map((e) => {
    const value = evalForm(literalize(e), null);
    return value === NIL ? '' : print(value, false);
  }).join('')));
}

// ---- the built-ins ------------------------------------------------------------------------------

defun('today-p', 0, 0, () => (startOfDay(ctx().candidateDate).getTime() === startOfDay(ctx().today).getTime() ? T : NIL));

defun('org-block', 6, 6, (a) => {
  const n = a.map(intOf);
  const start = realDate(n[0], n[1], n[2]);
  const end = realDate(n[3], n[4], n[5]);
  if (!start || !end) return NIL;
  const [from, to] = start <= end ? [start, end] : [end, start];
  const day = startOfDay(ctx().candidateDate);
  return day >= from && day <= to ? T : NIL;
});

/** @param {LObj} node @param {number} value */
function fieldMatches(node, value) {
  if (node instanceof Cons) return toArray(node).some((n) => n === value);
  return node === T || node === value;
}
defun('org-date', 3, 3, ([y, m, d]) => {
  const c = ctx().candidateDate;
  return fieldMatches(y, c.getFullYear()) && fieldMatches(m, c.getMonth() + 1) && fieldMatches(d, c.getDate()) ? T : NIL;
});

// (org-class Y1 M1 D1 Y2 M2 D2 DAYNAME SKIP-WEEK...): the bare symbol `holidays` among the weeks is read as the symbol, as always
defSpecial('org-class', (args, scope) => {
  const holidays = intern('holidays');
  const raw = toArray(args);
  if (raw.length < 7) throw signal('wrong-number-of-arguments', [intern('org-class'), raw.length]);
  const skipHolidays = raw.slice(7).some((f) => f === holidays || (f instanceof Cons && f.car === intern('quote') && f.cdr instanceof Cons && f.cdr.car === holidays));
  const values = raw.filter((f, i) => i < 7 || !(f === holidays || (f instanceof Cons && f.car === intern('quote') && f.cdr instanceof Cons && f.cdr.car === holidays))).map((f) => evalForm(f, scope));
  const n = values.map(intOf);
  const start = realDate(n[0], n[1], n[2]);
  const end = realDate(n[3], n[4], n[5]);
  const dayname = n[6];
  if (!start || !end || dayname < 0 || dayname > 6) return NIL;
  const skip = n.slice(7);
  const day = startOfDay(ctx().candidateDate);
  if (day < start || day > end || day.getDay() !== dayname) return NIL;
  if (skipHolidays && holidaysOn(day).length) return NIL;
  return skip.includes(isoWeekNumber(day)) ? NIL : T;
});

defun('calendar-check-holidays', 1, 1, ([d]) => {
  const [m, day, y] = dateParts(d);
  const names = holidaysOn(new Date(y, m - 1, day));
  return names.length ? list(names) : NIL;
});

defun('org-cyclic', 4, 4, (a) => {
  const [n, year, month, day] = a.map(intOf);
  return expandOrgCyclicOccurrences(n, new Date(year, month - 1, day), ctx().candidateDate, ctx().candidateDate).length > 0 ? T : NIL;
});
defun('org-anniversary', 3, 3, (a) => {
  const [year, month, day] = a.map(intOf);
  return expandOrgAnniversaryOccurrences(month, day, ctx().candidateDate, ctx().candidateDate, year).length > 0 ? T : NIL;
});

for (const name of ['diary-anniversary', 'diary-cyclic', 'diary-block', 'diary-date']) {
  defun(name, 0, -1, (a) => funcall(intern(name.replace('diary-', 'org-')), reorderDiaryDates(name, a, ctx().calendarDateStyle)));
}

defun('diary-float', 3, 5, ([month, dayname, n, day]) => {
  const monthSpec = month === T ? 't' : month instanceof Cons ? toArray(month).map(Number) : intOf(month);
  const dayOverride = typeof day === 'number' ? day : null;
  return diaryFloatMatches(ctx().candidateDate, monthSpec, intOf(dayname), intOf(n), dayOverride) ? T : NIL;
});

/** The sexp of `diary-offset` and `diary-remind`, with a quote taken off. @param {LObj} f */
const unquote = (f) => (f instanceof Cons && f.car === intern('quote') && f.cdr instanceof Cons ? f.cdr.car : f);

/** Evaluates `form` as it is `days` days from the day being evaluated. @param {LObj} form @param {number} days */
function onDay(form, days) {
  const c = ctx();
  const shifted = new Date(c.candidateDate.getFullYear(), c.candidateDate.getMonth(), c.candidateDate.getDate() + days);
  return withContext({ ...c, candidateDate: shifted }, () => evalForm(form, null));
}

// (diary-offset SEXP DAYS): SEXP as it was DAYS days ago
defSpecial('diary-offset', (args, scope) => {
  const items = toArray(args);
  if (items.length < 2) throw signal('wrong-number-of-arguments', [intern('diary-offset'), items.length]);
  const days = intOf(evalForm(items[1], scope));
  return onDay(unquote(items[0]), -days);
});

defun('diary-ordinal-suffix', 1, 1, ([x]) => {
  const n = intOf(x);
  return n % 100 === 11 || n % 100 === 12 || n % 100 === 13 || n % 10 > 3 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10];
});
defun('calendar-nth-named-day', 4, 5, (a) => {
  const v = a.map((x, i) => (i === 4 && x === NIL ? undefined : intOf(x)));
  return fromJs(nthNamedDay(/** @type {number} */ (v[0]), /** @type {number} */ (v[1]), /** @type {number} */ (v[2]), /** @type {number} */ (v[3]), /** @type {number} */ (v[4])));
});

/** @param {string} name @param {(c: Date, y: number, m: number, d: number, context: Context) => string | false | null | undefined} line */
function dayLine(name, line) {
  defun(name, 0, -1, () => {
    const c = ctx().candidateDate;
    return fromJs(line(c, c.getFullYear(), c.getMonth() + 1, c.getDate(), ctx()) || false);
  });
}
dayLine('diary-day-of-year', (c, y, m, d) => dayOfYearLine(y, m, d));
dayLine('diary-iso-date', (c, y, m, d) => isoDateLine(y, m, d));
dayLine('diary-julian-date', (c, y, m, d) => julianDateLine(y, m, d));
dayLine('diary-astro-day-number', (c, y, m, d) => astroDayNumberLine(y, m, d));
dayLine('diary-hebrew-date', (c) => nonGregorianDateLine('hebrew', c));
dayLine('diary-islamic-date', (c) => nonGregorianDateLine('islamic', c));
dayLine('diary-bahai-date', (c) => nonGregorianDateLine('bahai', c));
dayLine('diary-chinese-date', (c, y, m, d) => `Chinese date: ${chineseDateString([m, d, y])}`);
dayLine('diary-lunar-phases', (c, y, m, d, context) => lunarPhasesLine(y, m, d, context.timeZone));
dayLine('diary-hebrew-omer', (c) => hebrewOmer(startOfDay(c)));
dayLine('diary-hebrew-rosh-hodesh', (c) => hebrewRoshHodesh(startOfDay(c)));
dayLine('diary-hebrew-parasha', (c) => hebrewParasha(startOfDay(c)));

// The Hebrew-calendar entries of cal-hebrew.el. The birth or death date is written in calendar-date-style order; AFTER-SUNSET moves it a day.
for (const name of ['diary-hebrew-birthday', 'diary-hebrew-yahrzeit']) {
  defun(name, 0, -1, (a) => {
    if (a.length < 3 || !a.slice(0, 3).every((n) => typeof n === 'number')) return NIL;
    const context = ctx();
    const order = /** @type {Record<string, number[]>} */ (DATE_STYLE_ORDER)[context.calendarDateStyle || 'american'] || DATE_STYLE_ORDER.american;
    const at = (/** @type {number} */ kind) => /** @type {number} */ (a[order.indexOf(kind)]);
    const when = /** @type {[number, number, number]} */ ([at(0), at(1), at(2)]);
    const birthday = name === 'diary-hebrew-birthday';
    const flag = birthday ? a[3] : a[4];
    const afterSunset = flag !== undefined && flag !== NIL;
    return fromJs((birthday ? hebrewBirthday : hebrewYahrzeit)(startOfDay(context.candidateDate), when, afterSunset, context.entryText || '') || false);
  });
}

defun('diary-hebrew-sabbath-candles', 0, -1, () => {
  // On a Friday: the local sunset time less diary-hebrew-sabbath-candles-minutes (18 unless set).
  const context = ctx();
  const day = startOfDay(context.candidateDate);
  if (!isFriday(day)) return NIL;
  const sun = solarSunriseSunset(day, context.calendarLatitude, context.calendarLongitude);
  if (sun.set === null) return NIL;
  const minutes = typeof context.diaryHebrewSabbathCandlesMinutes === 'number' ? context.diaryHebrewSabbathCandlesMinutes : 18;
  return `${solarTimeString(Math.round(sun.set * 60) / 60 - minutes / 60.0, sun.setZone, context)} Sabbath candle lighting`;
});

// Emacs's (solar-sunrise-sunset DATE): ((RISE ZONE) (SET ZONE) "H:MM"), nil for an event the day lacks. The optional second
// argument is this app's own: the sun's height in degrees (-6 civil, -12 nautical, -18 astronomical twilight).
defun('solar-sunrise-sunset', 0, 2, ([date, height]) => {
  const [m, d, y] = date === undefined ? dateParts(dateList(ctx().candidateDate)) : dateParts(date);
  const day = realDate(y, m, d);
  if (!day) throw signal('error', ['Not a date']);
  const sun = solarSunriseSunset(day, ctx().calendarLatitude, ctx().calendarLongitude, height === undefined ? undefined : numOf(height));
  return list([sun.rise === null ? NIL : fromJs([sun.rise, sun.riseZone]), sun.set === null ? NIL : fromJs([sun.set, sun.setZone]), sun.daylight]);
});

// (diary-entry-time STRING): hhmm at the start of the entry, or -9999
defun('diary-entry-time', 0, 1, ([text]) => (typeof text === 'string' ? diaryEntryTime(text) : NIL));

// solar-sunrise-sunset-string for the entry's day: "Sunrise 7:18am (EDT), sunset 6:01pm (EDT) at Home (10:42 hrs daylight)"
defun('diary-sunrise-sunset', 0, -1, () => {
  const context = ctx();
  const sun = solarSunriseSunset(context.candidateDate, context.calendarLatitude, context.calendarLongitude);
  const at = (/** @type {number | null} */ t, /** @type {string} */ zone) => (t === null ? '' : solarTimeString(t, zone, context));
  const place = typeof context.calendarLocationName === 'string' ? context.calendarLocationName : defaultLocationName(context.calendarLatitude, context.calendarLongitude);
  return `${sun.rise === null ? 'No sunrise' : 'Sunrise ' + at(sun.rise, sun.riseZone)}, ${sun.set === null ? 'no sunset' : 'sunset ' + at(sun.set, sun.setZone)} at ${place} (${sun.daylight} hrs daylight)`;
});

defun('solar-time-string', 0, 2, ([time, zone]) => {
  if (time === undefined || time === NIL) return NIL;
  return solarTimeString(numOf(time), zone === undefined ? false : toJs(zone), ctx());
});

defun('org-weather', 0, -1, () => {
  const c = ctx();
  if (!c.weatherData) return NIL;
  return fromJs(formatWeatherLine(/** @type {string} */ (c.orgWeatherFormat), /** @type {never} */ (c.weatherData), /** @type {string} */ (c.orgWeatherTemperatureUnit), /** @type {string} */ (c.orgWeatherSpeedUnit), c.today) || false);
});

defun('calendar-current-date', 0, 1, () => dateList(ctx().today));
defun('calendar-day-of-week', 1, 1, ([date]) => {
  const [m, d, y] = dateParts(date);
  return realDate(y, m, d)?.getDay() ?? NIL;
});
defun('calendar-last-day-of-month', 2, 2, ([m, y]) => {
  const month = intOf(m);
  if (month < 1 || month > 12) throw signal('args-out-of-range', [m]);
  return new Date(intOf(y), month, 0).getDate();
});
defun('calendar-leap-year-p', 1, 1, ([year]) => {
  const y = intOf(year);
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? T : NIL;
});
defun('calendar-extract-month', 1, 1, ([d]) => dateParts(d)[0]);
defun('calendar-extract-day', 1, 1, ([d]) => dateParts(d)[1]);
defun('calendar-extract-year', 1, 1, ([d]) => dateParts(d)[2]);
defun('calendar-absolute-from-gregorian', 1, 1, ([date]) => {
  const [m, d, y] = dateParts(date);
  return absoluteDay(y, m, d);
});
defun('calendar-gregorian-from-absolute', 1, 1, ([abs]) => fromJs(gregorianFromAbsolute(intOf(abs))));

/** diary-remind's own logic (diary-lib.el): the entry itself when SEXP matches the day, else the reminder when it matches DAYS later. @param {LObj} sexp @param {LObj} daysArg @returns {LObj} */
function remind(sexp, daysArg) {
  let days = daysArg;
  if (typeof days === 'number' && days < 0) days = list(Array.from({ length: -days }, (_, i) => i + 1));
  const entry = evalForm(sexp, null);
  if (entry !== NIL) return entry;
  if (typeof days === 'number') {
    const later = onDay(sexp, days);
    if (later === NIL) return NIL;
    const what = typeof later === 'string' ? later : ctx().entryText || '';
    const span = days % 7 === 0 ? `${days / 7} week${days === 7 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'}`;
    return `Reminder: Only ${span} until ${what}`;
  }
  if (days instanceof Cons) {
    const first = remind(sexp, days.car);
    return first !== NIL ? first : remind(sexp, days.cdr);
  }
  if (days !== NIL) throw wrongType('integerp', days);
  return NIL;
}
// (diary-remind SEXP DAYS): the entry on the day itself, and "Reminder: Only N days until ..." on the DAYS before it
// (a number, a list, or a negative number for every day up to it).
defSpecial('diary-remind', (args, scope) => {
  const items = toArray(args);
  if (items.length < 2) throw signal('wrong-number-of-arguments', [intern('diary-remind'), items.length]);
  return remind(unquote(items[0]), evalForm(items[1], scope));
}, 2, 3);

// ---- functions a script registered (extensions.js) -----------------------------------------------

/** @type {string[]} */
let userNames = [];

/**
 * Installs (or, with no arguments, removes) the user-defined diary functions. The handler gets the name, the plain arguments
 * (not evaluated) and the day, and answers false, true or a string.
 * @param {string[]} [names] @param {((name: string, args: unknown[], date: Date) => unknown) | null} [handler]
 */
export function installUserFunctions(names = [], handler = null) {
  for (const name of userNames) {
    const s = intern(name);
    if (s.fn instanceof Special && s.fn.user) s.fn = undefined;
  }
  userNames = [];
  if (!handler) return;
  for (const name of names) {
    const s = intern(name);
    if (s.fn !== undefined) continue; // the evaluator's own function comes first
    const special = new Special(name, (/** @type {LObj} */ args) => fromJs(handler(name, toArray(args).map(argToValue), ctx().candidateDate)));
    special.user = true;
    s.fn = special;
    userNames.push(name);
  }
}

export { BudgetExceeded, LispSignal };
