// @ts-check
/**
 * Org durations (Emacs's org-duration.el), as used by the EFFORT
 * property. Accepted forms, matching that library's own documented set:
 *
 *   3:12            H:MM
 *   1:23:45         H:MM:SS
 *   1y 3d 3h 4min   any of the default units, in any order
 *   1d3h5min        the same, with no spaces (the Org manual's own example)
 *   3d 13:35        units followed by an H:MM(:SS) part
 *   2.35h           decimal numbers
 *   30              a bare number is minutes
 *   (empty)         0
 *
 * Anything else is invalid (null here; an error in Emacs). Units are
 * Emacs's default org-duration-units: min=1, h=60, d=24h, w=7d,
 * m=30d (a MONTH -- minutes are "min"), y=365.25d. org-duration-units
 * changes them (applyDurationVariables). Range durations are not supported.
 *
 * Returns minutes as a number (fractional for decimals or seconds), or
 * null when `text` isn't a valid duration.
 */
import { datum, isNil, lispSyntaxError, listItems, readLisp, stringValue } from './lisp-read.js';
import { VariableValueError } from './variable-error.js';

/** org-duration-units as Emacs ships it: [name, minutes] in order. */
const DEFAULT_UNITS = /** @type {[string, number][]} */ ([
  ['min', 1],
  ['h', 60],
  ['d', 60 * 24],
  ['w', 60 * 24 * 7],
  ['m', 60 * 24 * 30],
  ['y', 60 * 24 * 365.25],
]);

/** @param {[string, number][]} units */
function unitTable(units) {
  const names = units.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((x, y) => y.length - x.length).join('|') || '(?!)'; // no units: nothing matches
  const one = `[ \\t]*(\\d+(?:\\.\\d*)?)[ \\t]*(${names})`;
  return {
    minutes: new Map(units),
    unit: new RegExp(one, 'y'),
    // org-duration--full-re and org-duration--mixed-re: blanks mean spaces and tabs only, and the string is matched whole
    full: new RegExp(`^(?:${one})+[ \\t]*$`),
    mixed: new RegExp(`^((?:${one})+)[ \\t]*(\\d+(?::\\d\\d){1,2})[ \\t]*$`),
  };
}

/** The units in force; changed by org-duration-units (applyDurationVariables). */
const current = { table: unitTable(DEFAULT_UNITS) };

/** A form as Lisp prints it, for the error. @param {import('./lisp-read.js').Lisp} f @returns {string} */
function shownRow(f) {
  if (f.k === 'str') return JSON.stringify(f.v);
  if (f.k === 'list') return '(' + f.items.map(shownRow).join(' ') + (f.tail ? ' . ' + shownRow(f.tail) : '') + ')';
  return String(f.v);
}

/**
 * The value of org-duration-units: an alist such as (("min" . 1) ("h" . 60) ("d" . 480)), used as given as Emacs uses it (nil is
 * no units at all, "min" need not be there, a repeated name counts its first row). Anything that is not an alist of names and
 * numbers is a VariableValueError in Emacs's words (wrong-type-argument listp).
 * @param {string} text
 * @returns {[string, number][]}
 */
function parseDurationUnits(text) {
  const source = String(text == null ? '' : text);
  const syntax = lispSyntaxError(source);
  if (syntax) throw new VariableValueError('org-duration-units', source, 'a list', `org-duration-units: ${syntax}`);
  const forms = readLisp(source);
  const wrong = (/** @type {string} */ shown) => new VariableValueError('org-duration-units', source, 'a list of ("UNIT" . MINUTES)', `org-duration-units: Wrong type argument: listp, ${shown}`);
  if (forms.length !== 1) throw wrong(source.trim() || 'nil');
  const data = datum(forms[0]) || forms[0];
  if (isNil(data)) return [];
  const rows = listItems(data);
  if (!rows) throw wrong(source.trim());
  /** @type {[string, number][]} */ const units = [];
  for (const row of rows) {
    const name = row.k === 'list' && row.items.length === 1 ? stringValue(row.items[0]) : null;
    const tail = row.k === 'list' ? row.tail : null;
    if (name === null || !tail || tail.k !== 'num') throw wrong(shownRow(row));
    if (!units.some(([n]) => n === name)) units.push([name, tail.v]);
  }
  return units;
}

/**
 * Takes org-duration-units from the Global Variables; Emacs's default when it is unset. A value that cannot be used is a
 * VariableValueError and the units stay as they were.
 * @param {Record<string, string> | undefined} vars
 */
function applyDurationVariables(vars) {
  const raw = vars && vars['org-duration-units'];
  current.table = unitTable(raw === undefined || String(raw).trim() === '' ? DEFAULT_UNITS : parseDurationUnits(raw));
}

const BARE_NUMBER_RE = /^\d+(?:\.\d*)?$/;
const HMM_RE = /^[ \t]*(\d+)((?::\d{2}){1,2})[ \t]*$/;

/** The minutes of an H:MM or H:MM:SS part. @param {string} hours @param {string} rest */
const hms = (hours, rest) => {
  const [minutes, seconds] = rest.split(':').slice(1).map(Number);
  return Number(hours) * 60 + minutes + (seconds || 0) / 60;
};

/**
 * org-duration-to-minutes, branch for branch: empty is 0; H:MM(:SS); units alone; units then H:MM(:SS); a bare number. Only
 * spaces and tabs count as blanks, and a bare number takes none. Anything else is null (an error in Emacs).
 * @param {string} text
 */
function parseOrgDuration(text) {
  const s = String(text == null ? '' : text);
  if (s === '') return 0;
  const clock = HMM_RE.exec(s);
  if (clock) return hms(clock[1], clock[2]);
  const { full, mixed, unit, minutes } = current.table;
  /** @param {string} units */
  const sum = (units) => {
    let total = 0;
    unit.lastIndex = 0;
    for (let m = unit.exec(units); m; m = unit.exec(units)) total += Number(m[1]) * /** @type {number} */ (minutes.get(m[2]));
    return total;
  };
  if (full.test(s)) return sum(s);
  const both = mixed.exec(s);
  if (both) {
    const t = /(\d+)((?::\d\d){1,2})[ \t]*$/.exec(s);
    return sum(both[1]) + (t ? hms(t[1], t[2]) : 0);
  }
  return BARE_NUMBER_RE.test(s) ? Number(s) : null;
}

/**
 * org-duration-h:mm-only-p: every duration is H:MM or H:MM:SS, none written with units. Returns 'h:mm:ss' when any has seconds.
 * @param {string[]} times @returns {'h:mm' | 'h:mm:ss' | null}
 */
function durationHmmOnly(times) {
  const { full, mixed } = current.table;
  let seconds = false;
  for (const time of times) {
    if (full.test(time) || mixed.test(time)) return null;
    if (/^[ \t]*\d+:\d{2}:\d{2}[ \t]*$/.test(time)) seconds = true;
  }
  return seconds ? 'h:mm:ss' : 'h:mm';
}

/**
 * org-duration-from-minutes with the default org-duration-format `(("d" . nil) (special . h:mm))`: "H:MM", and with whole days
 * "1d 2:00". `mode` (from durationHmmOnly) forces plain H:MM or H:MM:SS.
 * @param {number} minutes @param {'h:mm' | 'h:mm:ss' | null} [mode]
 * @returns {string}
 */
function durationFromMinutes(minutes, mode = null) {
  const hmm = (/** @type {number} */ m) => `${Math.trunc(m / 60)}:${String(Math.trunc(((m % 60) + 60) % 60)).padStart(2, '0')}`;
  if (mode === 'h:mm:ss') return `${hmm(Math.floor(minutes))}:${String(Math.trunc(((minutes * 60) % 60 + 60) % 60)).padStart(2, '0')}`;
  if (mode === 'h:mm') return hmm(minutes);
  const day = /** @type {number} */ (current.table.minutes.get('d')) || 1440;
  if (minutes < day) return hmm(minutes);
  const days = Math.floor(minutes / day);
  return `${days}d ${hmm(minutes - days * day)}`;
}

export { parseOrgDuration, parseDurationUnits, applyDurationVariables, durationHmmOnly, durationFromMinutes };
