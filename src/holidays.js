// @ts-check
/**
 * The holidays `org-class` skips for the symbol `holidays`, and `calendar-check-holidays` lists: Emacs's `calendar-holidays`, the
 * general (US), Christian, Hebrew, Islamic and Bahá'í groups, each a variable (`holiday-general-holidays` ...) an init text can
 * replace or set to nil (see calendar-holidays.js).
 */

import { setInlineTaskLevel, readInlineTaskLevel } from './inline-tasks.js';
import { DEFAULT_LISTS, HOLIDAY_GROUPS } from './calendar-holidays.js';
import { evalHolidayList } from './calendar-lisp.js';
import { withContext } from './diary-lisp.js';
import { NIL, intern, list } from './elisp-data.js';
import { listItems } from './lisp-read.js';
import { runInit, keepInitFunctions, toObject } from './lisp-init.js';
import { lispStringValue } from './export-defaults.js';
import { solarTimeString } from './sexp-eval.js';
import { daylightSaving } from './solar-holidays.js';
import { getCalendarLatitude, getTimeDisplayForm } from './local-variables.js';

/** @typedef {import('./lisp-read.js').Lisp} Lisp */

/** @type {Map<string, Lisp> | null} */
let defaults = null;
/** @type {Map<string, Lisp> | null} */
let vars = null;
/** The entries of `calendar-holidays` and the init's variables, as the interpreter's objects. @type {import('./elisp-data.js').LObj[] | null} */
let forms = null;
/** @type {[import('./elisp-data.js').Sym, import('./elisp-data.js').LObj][]} */
let bindings = [];
/** The variables the user's init sets, for Lisp that runs outside the holiday lists (diary entries). @type {[import('./elisp-data.js').Sym, import('./elisp-data.js').LObj][]} */
let userBindings = [];
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
  vars = keepInitFunctions(init && init.trim() ? init : '', defaults);
  const base = defaults;
  userBindings = [...vars].filter(([name, value]) => base.get(name) !== value).map(([name, value]) => [intern(name), toObject(value)]);
  const explicit = vars.get('calendar-holidays');
  const groups = explicit ? [explicit] : HOLIDAY_GROUPS.map((g) => /** @type {Lisp} */ (vars && vars.get(g))).filter(Boolean);
  forms = groups.flatMap((g) => listItems(g) || []).map(toObject);
  bindings = [...vars].map(([name, value]) => [intern(name), toObject(value)]);
  cache = new Map();
}

/** A variable the Lisp init set, as the Lisp object it holds (a function included); undefined when it set none. @param {string} name */
export const initValue = (name) => /** @type {{ raw?: Map<string, import('./elisp-data.js').LObj> } | null} */ (vars)?.raw?.get(name);

/** The variables the Lisp init sets, as dynamic bindings. */
export const initBindings = () => userBindings;

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
  const solar = { zone: zone(), latitude, timeString: (/** @type {number} */ hours, /** @type {string} */ name) => solarTimeString(hours, name, { calendarTimeDisplayForm: timeDisplayForm }) };
  const { holidays: list, errors } = withContext({ calendarTimeDisplayForm: timeDisplayForm }, () => evalHolidayList(forms || [], bindings, month, year, { solar, dst: dstVariables }));
  for (const message of errors) list.push({ date: [month, 1, year], name: `Holiday list error: ${message}` });
  hit = list.filter((h) => h.date[0] === month && h.date[2] === year).map((h) => `${h.date[1]}\t${h.name}`);
  cache.set(key, hit);
  return hit;
}

/** The variables daylight saving time sets in Emacs (cal-dst.el), for `year`, as the interpreter sees them.
 * @param {number} year @returns {Record<string, import('./elisp-data.js').LObj>} */
function dstVariables(year) {
  const d = daylightSaving(zone(), year);
  return {
    'calendar-daylight-savings-starts': d.starts ? list([...d.starts]) : NIL,
    'calendar-daylight-savings-ends': d.ends ? list([...d.ends]) : NIL,
    'calendar-daylight-savings-starts-time': d.startsTime,
    'calendar-daylight-savings-ends-time': d.endsTime,
    'calendar-standard-time-zone-name': d.standardName,
    'calendar-daylight-time-zone-name': d.daylightName,
  };
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * list-holidays: a line for each holiday from the first year to the last, as `Saturday, July 4, 2026: Independence Day`, in date order.
 * @param {number} startYear
 * @param {number} endYear
 * @returns {string}
 */
export function listHolidays(startYear, endYear) {
  /** @type {string[]} */ const lines = [];
  for (let year = startYear; year <= endYear; year++) {
    for (let month = 0; month < 12; month++) {
      for (let day = 1; ; day++) {
        const date = new Date(2000, month, day);
        date.setFullYear(year);
        if (date.getMonth() !== month) break;
        for (const name of holidaysOn(date)) lines.push(`${WEEKDAYS[date.getDay()]}, ${MONTHS[month]} ${day}, ${year}: ${name}`);
      }
    }
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}
