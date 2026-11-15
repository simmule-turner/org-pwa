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
 * @typedef {{ k: 'unit', unit: string, required: boolean } | { k: 'special', value: import('./lisp-read.js').Lisp } | { k: 'compact' } | { k: 'other', shown: string }} FormatEntry
 * @typedef {'h:mm' | 'h:mm:ss' | FormatEntry[] | null} DurationFormat  org-duration-format: a symbol, a list of entries, or nil (an error when used)
 */

/** The cdr of a list form. @param {import('./lisp-read.js').Lisp} f @returns {import('./lisp-read.js').Lisp} */
const cdrOf = (f) => (f.k === 'list' && f.items.length ? (f.items.length > 1 ? { k: 'list', items: f.items.slice(1), ...(f.tail ? { tail: f.tail } : {}) } : (f.tail ?? { k: 'list', items: [] })) : { k: 'list', items: [] });

/**
 * The value of org-duration-format: `h:mm`, `h:mm:ss` or a list such as (("d") ("h" . t) (special . h:mm) compact), as Emacs reads it. What
 * is no entry of the kinds Emacs knows is kept and is an error when a duration is formatted.
 * @param {string} text
 * @returns {DurationFormat}
 */
function parseDurationFormat(text) {
  const source = String(text == null ? '' : text);
  const syntax = lispSyntaxError(source);
  if (syntax) throw new VariableValueError('org-duration-format', source, 'a list', `org-duration-format: ${syntax}`);
  const forms = readLisp(source);
  if (forms.length !== 1) throw new VariableValueError('org-duration-format', source, 'h:mm, h:mm:ss or a list of units', `org-duration-format: Wrong type argument: listp, ${source.trim() || 'nil'}`);
  const data = datum(forms[0]) || forms[0];
  if (data.k === 'sym' && (data.v === 'h:mm' || data.v === 'h:mm:ss')) return data.v;
  const rows = isNil(data) ? null : listItems(data);
  if (!rows) return null;
  return rows.map((row) => {
    if (row.k === 'sym' && row.v === 'compact') return { k: 'compact' };
    const car = row.k === 'list' ? row.items[0] : undefined;
    if (car && car.k === 'sym' && car.v === 'special') return { k: 'special', value: cdrOf(row) };
    const name = car ? stringValue(car) : null;
    if (name !== null) return { k: 'unit', unit: name, required: !isNil(cdrOf(row)) };
    return { k: 'other', shown: shownRow(row) };
  });
}

/** org-duration-format as Emacs ships it. @type {DurationFormat} */
const DEFAULT_FORMAT = [{ k: 'unit', unit: 'd', required: false }, { k: 'special', value: { k: 'sym', v: 'h:mm' } }];
/** The format in force; changed by org-duration-format (applyDurationVariables). */
const format = { current: /** @type {DurationFormat} */ (DEFAULT_FORMAT) };

/**
 * Takes org-duration-units and org-duration-format from the Global Variables; Emacs's default when unset. A value that cannot be used is a
 * VariableValueError and the units stay as they were.
 * @param {Record<string, string> | undefined} vars
 */
function applyDurationVariables(vars) {
  const raw = vars && vars['org-duration-units'];
  current.table = unitTable(raw === undefined || String(raw).trim() === '' ? DEFAULT_UNITS : parseDurationUnits(raw));
  const shape = vars && vars['org-duration-format'];
  format.current = shape === undefined || String(shape).trim() === '' ? DEFAULT_FORMAT : parseDurationFormat(shape);
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

/** org-duration-canonical-units. */
const CANONICAL_UNITS = new Map(DEFAULT_UNITS.slice(0, 3));

/** org-duration--modifier: the minutes of a unit, in org-duration-units or (`canonical`) Org's own units. @param {unknown} unit @param {boolean} [canonical] @returns {number} */
function modifier(unit, canonical = false) {
  const found = typeof unit === 'string' ? (canonical ? CANONICAL_UNITS : current.table.minutes).get(unit) : undefined;
  if (found === undefined) throw new Error(`Unknown unit: ${typeof unit === 'string' ? JSON.stringify(unit) : String(unit)}`);
  return found;
}

/** `%.Nf` of a number: ties round to the even digit, as C's printf does. @param {number} x @param {number} digits */
const printfFixed = (x, digits) => {
  const exact = Math.abs(x).toFixed(Math.min(100, digits + 60)); // the exact decimal expansion
  const cut = exact.length - 60;
  if (/^50*$/.test(exact.slice(cut))) {
    const kept = exact.slice(0, cut).replace(/\.$/, '');
    const last = Number(kept[kept.length - 1]);
    if (last % 2 === 0) return `${x < 0 ? '-' : ''}${kept}`;
  }
  return x.toFixed(digits);
};

/** `%d` of a number. @param {number} n */
const dnum = (n) => String(Math.trunc(n));

/**
 * org-duration-from-minutes: `minutes` as `fmt` (h:mm, h:mm:ss or entries, as org-duration-format has them; the variable when
 * undefined). `canonical` uses Org's own units, not org-duration-units. Errors as Emacs's do.
 * @param {number} minutes @param {DurationFormat | undefined} [fmt] @param {boolean} [canonical]
 * @returns {string}
 */
function durationFromMinutes(minutes, fmt, canonical = false) {
  const shape = fmt === undefined ? format.current : fmt;
  if (shape === 'h:mm') return `${dnum(minutes / 60)}:${String(Math.trunc(((minutes % 60) + 60) % 60)).padStart(2, '0')}`;
  if (shape === 'h:mm:ss') return `${durationFromMinutes(Math.floor(minutes), 'h:mm')}:${String(Math.trunc((((minutes * 60) % 60) + 60) % 60)).padStart(2, '0')}`;
  if (shape === null) throw new Error(`Invalid duration format specification: ${fmt === undefined ? 'nil' : 'nil'}`);
  const special = shape.find((e) => e.k === 'special');
  const mode = special && special.k === 'special' && special.value.k === 'sym' && (special.value.v === 'h:mm' || special.value.v === 'h:mm:ss') ? special.value.v : null;
  if (mode) {
    const truncated = shape.filter((e) => e.k === 'unit' && modifier(e.unit, canonical) > 60);
    const minModifier = truncated.length ? Math.min(...truncated.map((e) => modifier(/** @type {{ unit: string }} */ (e).unit, canonical))) : null;
    if (minModifier === null || minutes < minModifier) return durationFromMinutes(minutes, mode, canonical);
    const unitsPart = minModifier * Math.trunc(Math.floor(minutes) / minModifier);
    const minutesPart = minutes - unitsPart;
    const compact = shape.some((e) => e.k === 'compact');
    return durationFromMinutes(unitsPart, truncated, canonical) + (compact ? '' : ' ') + durationFromMinutes(minutesPart, mode, canonical);
  }
  const digitsEntry = special && special.k === 'special' ? special.value : null;
  let fractional = null;
  if (digitsEntry && !isNil(digitsEntry)) {
    if (digitsEntry.k !== 'num' || !Number.isInteger(digitsEntry.v) || digitsEntry.v < 0) throw new Error(`Unknown formatting directive: ${shownRow(digitsEntry)}`);
    fractional = digitsEntry.v;
  }
  const pairs = shape.filter((e) => e.k !== 'compact' && e.k !== 'special');
  const selected = pairs.map((e) => ({ unit: e.k === 'unit' ? e.unit : null, required: e.k === 'unit' && e.required, shown: e.k === 'other' ? e.shown : '' }));
  for (const e of selected) modifier(e.unit ?? e.shown, canonical);
  selected.sort((a, b) => modifier(b.unit, canonical) - modifier(a.unit, canonical));
  const separator = shape.some((e) => e.k === 'compact') ? '' : ' ';
  if (fractional !== null) {
    const picked = selected.find((e) => e.required || modifier(e.unit, canonical) <= minutes) ?? selected[selected.length - 1];
    const unit = /** @type {string} */ (picked && picked.unit);
    return `${printfFixed(minutes / modifier(unit, canonical), fractional)}${unit}`;
  }
  let left = minutes;
  const built = selected
    .map((e) => {
      const m = modifier(e.unit, canonical);
      if (m <= left) {
        const value = Math.floor(left / m);
        left -= value * m;
        return `${separator}${value}${e.unit}`;
      }
      return e.required ? `${separator}0${e.unit}` : '';
    })
    .join('')
    .replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '');
  if (built !== '') return built;
  const last = selected[selected.length - 1];
  return `0${last ? last.unit : ''}`;
}

export { parseOrgDuration, parseDurationUnits, parseDurationFormat, applyDurationVariables, durationHmmOnly, durationFromMinutes };
