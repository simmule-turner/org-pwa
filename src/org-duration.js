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
import { datum, listItems, readLisp, stringValue } from './lisp-read.js';

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
  const names = units.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((x, y) => y.length - x.length);
  return { minutes: new Map(units), re: new RegExp(`\\s*(\\d+(?:\\.\\d*)?)\\s*(${names.join('|')})`, 'y') };
}

/** The units in force; changed by org-duration-units (applyDurationVariables). */
const current = { table: unitTable(DEFAULT_UNITS) };

/**
 * The value of org-duration-units: an alist such as (("min" . 1) ("h" . 60) ("d" . 480)). Null when it is not a usable one
 * (not an alist of names and positive numbers, or "min" missing), so Emacs's default stays.
 * @param {string} text
 * @returns {[string, number][] | null}
 */
function parseDurationUnits(text) {
  const source = String(text == null ? '' : text);
  const bare = source.replace(/"(?:[^"\\]|\\.)*"/g, '');
  if (bare.split('(').length !== bare.split(')').length) return null; // the reader stops quietly at an unbalanced tail
  const forms = readLisp(source);
  if (forms.length !== 1) return null;
  const data = datum(forms[0]) || forms[0];
  const rows = listItems(data);
  if (!rows || rows.length === 0) return null;
  /** @type {[string, number][]} */ const units = [];
  for (const row of rows) {
    if (row.k !== 'list' || row.items.length !== 1 || !row.tail || row.tail.k !== 'num') return null;
    const name = stringValue(row.items[0]);
    const minutes = row.tail.v;
    if (!name || !/^[^\s\d.]+$/.test(name) || !(minutes > 0) || units.some(([n]) => n === name)) return null;
    units.push([name, minutes]);
  }
  return units.some(([n, m]) => n === 'min' && m === 1) ? units : null;
}

/**
 * Takes org-duration-units from the Global Variables, or Emacs's default when it is unset or not usable.
 * @param {Record<string, string> | undefined} vars
 */
function applyDurationVariables(vars) {
  const raw = vars && vars['org-duration-units'];
  current.table = unitTable((raw && parseDurationUnits(raw)) || DEFAULT_UNITS);
}

const BARE_NUMBER_RE = /^\d+(?:\.\d*)?$/;
const TRAILING_HMS_RE = /(?:^|\s)(\d+):(\d{2})(?::(\d{2}))?$/;

/** @param {string} text */
function parseOrgDuration(text) {
  const s = String(text == null ? '' : text).trim();
  if (s === '') return 0;
  if (BARE_NUMBER_RE.test(s)) return Number(s);

  let total = 0;
  let rest = s;

  const hms = TRAILING_HMS_RE.exec(rest);
  if (hms) {
    total += Number(hms[1]) * 60 + Number(hms[2]) + (hms[3] ? Number(hms[3]) / 60 : 0);
    rest = rest.slice(0, hms.index).trim();
  }

  const { re, minutes } = current.table;
  let pos = 0;
  while (pos < rest.length) {
    re.lastIndex = pos;
    const m = re.exec(rest);
    if (!m) return null;
    total += Number(m[1]) * /** @type {number} */ (minutes.get(m[2]));
    pos = re.lastIndex;
  }
  return total;
}

export { parseOrgDuration, parseDurationUnits, applyDurationVariables };
