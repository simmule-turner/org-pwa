// @ts-check
/**
 * The holidays `org-class` skips for the symbol `holidays`, and `calendar-check-holidays` lists: Emacs's `calendar-holidays`, the
 * general (US), Christian, Hebrew, Islamic and Bahá'í groups, each a variable (`holiday-general-holidays` ...) an init text can
 * replace or set to nil (see calendar-holidays.js).
 */

import { setInlineTaskLevel, readInlineTaskLevel } from './inline-tasks.js';
import { holidayList, DEFAULT_LISTS, HOLIDAY_GROUPS } from './calendar-holidays.js';
import { runInit, listItems } from './lisp-read.js';
import { lispStringValue } from './export-defaults.js';
import { evaluateSexprValue, parseSexpr, solarTimeString } from './sexp-eval.js';
import { daylightSaving } from './solar-holidays.js';
import { getCalendarLatitude, getTimeDisplayForm } from './local-variables.js';

/** @typedef {import('./lisp-read.js').Lisp} Lisp */

/** @type {Map<string, Lisp> | null} */
let defaults = null;
/** @type {Map<string, Lisp> | null} */
let vars = null;
/** @type {Lisp[] | null} */
let forms = null;
/** @type {Map<string, string[]>} */
let cache = new Map();
/** The time zone of the sun-related holidays (an IANA name): the device's, unless a test or a setting picks one. @type {string | null} */
let zoneOverride = null;
let latitude = 35.994;
/** @type {string | undefined} */
let timeDisplayForm;

/** Pins the time zone the solar holidays use; null goes back to the device's. @param {string | null} zone */
export function setHolidayZone(zone) {
  zoneOverride = zone;
  cache = new Map();
}

const zone = () => zoneOverride || Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Sets the init text (`holiday-*` variables) the holidays follow; empty for Emacs's defaults.
 * @param {string | undefined} init */
export function setHolidayConfig(init) {
  if (!defaults) defaults = runInit(DEFAULT_LISTS);
  vars = init && init.trim() ? runInit(init, defaults) : defaults;
  const explicit = vars.get('calendar-holidays');
  const groups = explicit ? [explicit] : HOLIDAY_GROUPS.map((g) => /** @type {Lisp} */ (vars && vars.get(g))).filter(Boolean);
  forms = groups.flatMap((g) => listItems(g) || []);
  cache = new Map();
}

/** Follows the Lisp init text kept in `org-xx-lisp-init` (Settings → Advanced). @param {Record<string, string> | null | undefined} vars */
export function applyHolidayVariables(vars) {
  const raw = (vars || {})['org-xx-lisp-init'];
  latitude = getCalendarLatitude(vars || {});
  timeDisplayForm = getTimeDisplayForm(vars || {});
  setHolidayConfig(lispStringValue(raw) || raw || '');
  setInlineTaskLevel(readInlineTaskLevel(vars));
}

/** The days in the window around a month hold these names; computed once per month. @param {number} year @param {number} month */
function monthHolidays(year, month) {
  const key = `${year}-${month}`;
  let hit = cache.get(key);
  if (hit) return hit;
  if (!forms || !vars) setHolidayConfig('');
  const list = holidayList(forms || [], { month, year, vars: vars || new Map(), sexp: holidaySexp, solar: { zone: zone(), latitude, timeString: (hours, name) => solarTimeString(hours, name, { calendarTimeDisplayForm: timeDisplayForm }) } });
  hit = list.filter((h) => h.date[0] === month && h.date[2] === year).map((h) => `${h.date[1]}\t${h.name}`);
  cache.set(key, hit);
  return hit;
}

/** The variables daylight saving time sets in Emacs (cal-dst.el), for `year`, as the sexp evaluator sees them.
 * @param {number} year */
function dstVariables(year) {
  const d = daylightSaving(zone(), year);
  return {
    'calendar-daylight-savings-starts': d.starts || false,
    'calendar-daylight-savings-ends': d.ends || false,
    'calendar-daylight-savings-starts-time': d.startsTime,
    'calendar-daylight-savings-ends-time': d.endsTime,
    'calendar-standard-time-zone-name': d.standardName,
    'calendar-daylight-time-zone-name': d.daylightName,
  };
}

/** `holiday-sexp`: the expression with `year` bound gives a date, (month day year), or nil; the name is a string or an expression with `date` bound.
 * @param {Lisp} expr @param {Lisp} nameForm @param {number} year @returns {{ date: [number, number, number], name: string } | null} */
function holidaySexp(expr, nameForm, year) {
  const env = { ...dstVariables(year), year };
  const timeForm = { calendarTimeDisplayForm: timeDisplayForm };
  try {
    const value = evaluateSexprValue(parseSexpr(printLisp(expr)), { env, candidateDate: new Date(year, 0, 1), today: new Date(), ...timeForm });
    if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === 'number')) return null;
    const date = /** @type {[number, number, number]} */ (value);
    if (nameForm.k === 'str') return { date, name: nameForm.v };
    const name = evaluateSexprValue(parseSexpr(printLisp(nameForm)), { env, candidateDate: new Date(date[2], date[0] - 1, date[1]), today: new Date(), ...timeForm });
    return typeof name === 'string' ? { date, name } : null;
  } catch {
    return null; // an expression the evaluator cannot read gives no holiday
  }
}

/** A Lisp datum as source text. @param {Lisp} f @returns {string} */
function printLisp(f) {
  if (f.k === 'str') return JSON.stringify(f.v);
  if (f.k === 'num' || f.k === 'sym') return String(f.v);
  return `(${f.items.map(printLisp).join(' ')}${f.tail ? ' . ' + printLisp(f.tail) : ''})`;
}

/**
 * The names of the holidays on `date`, as `calendar-check-holidays` returns them (empty when none).
 * @param {Date} date
 * @returns {string[]}
 */
export function holidaysOn(date) {
  const d = date.getDate();
  return monthHolidays(date.getFullYear(), date.getMonth() + 1).filter((x) => x.startsWith(d + '\t')).map((x) => x.slice(x.indexOf('\t') + 1));
}
