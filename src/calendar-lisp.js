// @ts-check
/**
 * Emacs's calendar and holiday functions as built-ins of the Lisp interpreter (`calendar-*`, `holiday-*`, `solar-equinoxes-solstices`),
 * and the evaluation of `calendar-holidays` the way `calendar-holiday-list` does it: every entry is a Lisp form evaluated with
 * `displayed-month` and `displayed-year` bound, so `if`, `let`, `mapcar` and the user's own functions work in a holiday list.
 */
import { Cons, NIL, T, intern, list, signal, toArray, wrongType } from './elisp-data.js';
import { defun, evalForm, withDynamic } from './elisp-core.js';
import { fromObject } from './lisp-init.js';
import { describeFailure } from './elisp.js';
import {
  absoluteFromGregorian, daynameOnOrBefore, nthNamedAbsday, dayNumber, lastDayOfMonth, incrementMonth, dateIsVisible,
  hebrewToAbsolute, hebrewFromAbsolute, hebrewLeapYear, hebrewLastMonthOfYear, hebrewLastDayOfMonth,
  islamicToAbsolute, islamicFromAbsolute, islamicLeapYear, islamicLastDayOfMonth, julianToAbsolute, julianFromAbsolute,
} from './calendar-conv.js';
import { HOLIDAY_FUNCTIONS, holidayCall, filterVisible } from './calendar-holidays.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */
/** @typedef {import('./calendar-holidays.js').Holiday} Holiday */
/** @typedef {import('./calendar-holidays.js').Solar} Solar */
/**
 * @typedef {object} HolidayEnvironment  what a holiday list may ask the app about
 * @property {Solar} [solar]  the time zone, latitude and solar-time-string of the sun-related holidays
 * @property {(year: number) => Record<string, LObj>} [dst]  the daylight saving variables (cal-dst.el) for a year
 */

const DISPLAYED_MONTH = intern('displayed-month');
const DISPLAYED_YEAR = intern('displayed-year');
const YEAR = intern('year');
const DATE = intern('date');
for (const s of [DISPLAYED_MONTH, DISPLAYED_YEAR, YEAR, DATE]) s.special = true;

const FLAGS = ['calendar-christian-all-holidays-flag', 'calendar-hebrew-all-holidays-flag', 'calendar-islamic-all-holidays-flag', 'calendar-bahai-all-holidays-flag', 'calendar-chinese-all-holidays-flag'];

/** The holiday environment of the evaluation in progress. @type {HolidayEnvironment} */
let environment = {};

/** @param {LObj} x @returns {number} */
function intOf(x) {
  if (typeof x === 'number') return x;
  throw wrongType('number-or-marker-p', x);
}
/** (month day year) from a date list. @param {LObj} x @returns {[number, number, number]} */
function dateOf(x) {
  const items = x instanceof Cons ? toArray(x) : null;
  if (!items || items.length !== 3 || !items.every((n) => typeof n === 'number')) throw wrongType('listp', x);
  return /** @type {[number, number, number]} */ (items);
}
/** @param {[number, number, number] | number[]} d @returns {LObj} */
const dateList = (d) => list([...d]);

/** The value of a variable that must be bound (`displayed-month`), or `void-variable`. @param {import('./elisp-data.js').Sym} s @returns {number} */
function displayed(s) {
  if (typeof s.value !== 'number') throw signal('void-variable', [s]);
  return s.value;
}

/** The window the holiday functions look at, from the dynamic variables, as Emacs's holiday functions read them. @returns {import('./calendar-holidays.js').Window} */
function currentWindow() {
  const month = displayed(DISPLAYED_MONTH);
  const year = displayed(DISPLAYED_YEAR);
  /** @type {Map<string, import('./lisp-read.js').Lisp>} */
  const vars = new Map();
  for (const name of FLAGS) {
    const v = intern(name).value;
    if (v !== undefined) vars.set(name, fromObject(v));
  }
  return { month, year, vars, sexp: null, solar: environment.solar };
}

/** @param {Holiday[]} holidays @returns {LObj} */
const holidaysToLisp = (holidays) => list(holidays.map((h) => list([dateList(h.date), h.name])));

/** The holidays a list of `((m d y) "name")` entries holds, ignoring anything else. @param {LObj} value @returns {Holiday[]} */
function holidaysFromLisp(value) {
  if (!(value instanceof Cons)) return [];
  /** @type {Holiday[]} */
  const out = [];
  for (const item of toArray(value)) {
    if (!(item instanceof Cons)) continue;
    const [date, name] = toArray(item);
    const parts = date instanceof Cons ? toArray(date) : [];
    if (parts.length === 3 && parts.every((n) => typeof n === 'number') && typeof name === 'string') out.push({ date: /** @type {[number, number, number]} */ (parts), name });
  }
  return out;
}

// ---- the holiday functions ----------------------------------------------------------------------

for (const name of HOLIDAY_FUNCTIONS) {
  defun(name, 0, -1, (args) => holidaysToLisp(holidayCall(name, args.map(fromObject), currentWindow()) || []));
}

defun('holiday-filter-visible-calendar', 1, 1, ([l]) => {
  const w = currentWindow();
  return holidaysToLisp(filterVisible(holidaysFromLisp(l), w));
});

// holiday-sexp (holidays.el): SEXP is evaluated with `year` bound to the year before the window's first month and the one after, and gives
// `date`; STRING is evaluated with `date` bound for the name. A date outside the window, or nil, is no holiday.
defun('holiday-sexp', 2, 2, ([sexp, string]) => {
  const w = currentWindow();
  const [, y] = incrementMonth(w.month, w.year, -1);
  /** @type {Holiday[]} */
  const found = [];
  withDynamic([[YEAR, y], [DATE, NIL]], () => {
    for (const year of [y, y + 1]) {
      YEAR.value = year;
      const date = evalForm(sexp, null);
      DATE.value = date;
      const name = date === NIL ? NIL : evalForm(string, null);
      const parts = date instanceof Cons ? toArray(date) : [];
      if (parts.length === 3 && parts.every((n) => typeof n === 'number') && typeof name === 'string') found.push({ date: /** @type {[number, number, number]} */ (parts), name });
    }
  });
  return holidaysToLisp(filterVisible(found, w));
});

// The variables cal-dst.el sets are sexps in `year`: this one gives the date of the change in the device's time zone (nil when it has none).
defun('org-xx-dst-date', 2, 2, ([which, year]) => {
  const vars = environment.dst ? environment.dst(intOf(year)) : {};
  const v = vars[which === intern('ends') ? 'calendar-daylight-savings-ends' : 'calendar-daylight-savings-starts'];
  return v === undefined ? NIL : v;
});

// ---- the calendar functions ---------------------------------------------------------------------

defun('calendar-dayname-on-or-before', 2, 2, ([dayname, abs]) => daynameOnOrBefore(intOf(dayname), intOf(abs)));
defun('calendar-nth-named-absday', 4, 5, ([n, dayname, month, year, day]) => nthNamedAbsday(intOf(n), intOf(dayname), intOf(month), intOf(year), day === undefined || day === NIL ? undefined : intOf(day)));
defun('calendar-day-number', 1, 1, ([date]) => dayNumber(dateOf(date)));
defun('calendar-date-equal', 2, 2, ([a, b]) => (dateOf(a).join() === dateOf(b).join() ? T : NIL));
defun('calendar-date-is-valid-p', 1, 1, ([date]) => {
  if (!(date instanceof Cons) && date !== NIL) throw wrongType('listp', date);
  const items = date instanceof Cons ? toArray(date) : [];
  if (items.length !== 3 || !items.every((n) => typeof n === 'number')) return NIL;
  const [m, d, y] = /** @type {number[]} */ (items);
  return m >= 1 && m <= 12 && d >= 1 && d <= lastDayOfMonth(m, y) && y > 0 ? T : NIL;
});
defun('calendar-date-is-visible-p', 1, 1, ([date]) => (dateIsVisible(dateOf(date), displayed(DISPLAYED_MONTH), displayed(DISPLAYED_YEAR)) ? T : NIL));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** @param {string[]} names @param {number} n */
const abbrev = (names, n) => names.map((s) => s.slice(0, n));
for (const [name, value] of /** @type {[string, string[]][]} */ ([
  ['calendar-month-name-array', MONTHS], ['calendar-day-name-array', DAYS], ['calendar-month-abbrev-array', abbrev(MONTHS, 3)], ['calendar-day-abbrev-array', abbrev(DAYS, 3)],
])) {
  const s = intern(name);
  s.value = value;
  s.special = true;
}
defun('calendar-month-name', 1, 2, ([month, short]) => {
  const m = intOf(month);
  if (m < 1 || m > 12) throw signal('args-out-of-range', [intern('calendar-month-name-array').value ?? NIL, m - 1]);
  return short === undefined || short === NIL ? MONTHS[m - 1] : MONTHS[m - 1].slice(0, 3);
});
defun('calendar-day-name', 1, 3, ([date, short, absolute]) => {
  const abs = absolute !== undefined && absolute !== NIL ? intOf(date) : absoluteFromGregorian(dateOf(date));
  const name = DAYS[((abs % 7) + 7) % 7];
  return short === undefined || short === NIL ? name : name.slice(0, 3);
});

defun('calendar-julian-to-absolute', 1, 1, ([d]) => julianToAbsolute(dateOf(d)));
defun('calendar-julian-from-absolute', 1, 1, ([a]) => dateList(julianFromAbsolute(intOf(a))));
defun('calendar-hebrew-to-absolute', 1, 1, ([d]) => hebrewToAbsolute(dateOf(d)));
defun('calendar-hebrew-from-absolute', 1, 1, ([a]) => dateList(hebrewFromAbsolute(intOf(a))));
defun('calendar-hebrew-leap-year-p', 1, 1, ([y]) => (hebrewLeapYear(intOf(y)) ? T : NIL));
defun('calendar-hebrew-last-month-of-year', 1, 1, ([y]) => hebrewLastMonthOfYear(intOf(y)));
defun('calendar-hebrew-last-day-of-month', 2, 2, ([m, y]) => hebrewLastDayOfMonth(intOf(m), intOf(y)));
defun('calendar-islamic-to-absolute', 1, 1, ([d]) => islamicToAbsolute(dateOf(d)));
defun('calendar-islamic-from-absolute', 1, 1, ([a]) => dateList(islamicFromAbsolute(intOf(a))));
defun('calendar-islamic-leap-year-p', 1, 1, ([y]) => (islamicLeapYear(intOf(y)) ? T : NIL));
defun('calendar-islamic-last-day-of-month', 2, 2, ([m, y]) => islamicLastDayOfMonth(intOf(m), intOf(y)));

// ---- evaluating calendar-holidays ---------------------------------------------------------------

/**
 * The holidays of the three months around `month` and `year`: each entry of `calendar-holidays` is evaluated as Lisp, with `bindings`
 * (the variables of the Lisp init) bound dynamically, and the results joined as `calendar-holiday-list` joins them. An entry that fails
 * is skipped, as Emacs does after its "Bad holiday list item" warning, and its message is returned in `errors`.
 * @param {LObj[]} entries @param {[import('./elisp-data.js').Sym, LObj][]} bindings @param {number} month @param {number} year @param {HolidayEnvironment} env
 * @returns {{ holidays: Holiday[], errors: string[] }}
 */
export function evalHolidayList(entries, bindings, month, year, env) {
  const outer = environment;
  environment = env;
  const given = new Set(bindings.map(([s]) => s.name));
  /** @type {[import('./elisp-data.js').Sym, LObj][]} */
  const pairs = [...bindings.filter(([s]) => !s.constant)];
  for (const name of FLAGS) if (!given.has(name) && intern(name).value === undefined) pairs.push([intern(name), NIL]);
  for (const [name, value] of Object.entries(env.dst ? env.dst(year) : {})) if (!given.has(name)) pairs.push([intern(name), value]);
  pairs.push([intern('calendar-daylight-savings-starts'), list([intern('org-xx-dst-date'), list([intern('quote'), intern('starts')]), intern('year')])]);
  pairs.push([intern('calendar-daylight-savings-ends'), list([intern('org-xx-dst-date'), list([intern('quote'), intern('ends')]), intern('year')])]);
  pairs.push([DISPLAYED_MONTH, month], [DISPLAYED_YEAR, year]);
  for (const [s] of pairs) s.special = true;
  /** @type {Holiday[]} */
  let res = [];
  /** @type {string[]} */
  const errors = [];
  try {
    withDynamic(pairs, () => {
      for (const entry of entries) {
        try {
          res = [...holidaysFromLisp(evalForm(entry, null)), ...res];
        } catch (raw) {
          const { message, kind } = describeFailure(raw);
          errors.push(message);
          if (kind === 'budget') break;
        }
      }
    });
  } finally {
    environment = outer;
  }
  return { holidays: res.sort((x, y) => absoluteFromGregorian(x.date) - absoluteFromGregorian(y.date)), errors };
}
