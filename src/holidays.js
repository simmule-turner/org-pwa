// @ts-check
/**
 * The holidays `org-class` skips for the symbol `holidays`, and `calendar-check-holidays` lists: Emacs's `calendar-holidays`, the
 * general (US), Christian, Hebrew, Islamic and Bahá'í groups, each a variable (`holiday-general-holidays` ...) an init text can
 * replace or set to nil (see calendar-holidays.js).
 */

import { holidayList, DEFAULT_LISTS, HOLIDAY_GROUPS } from './calendar-holidays.js';
import { runInit, listItems } from './lisp-read.js';
import { lispStringValue } from './export-defaults.js';
import { evaluateSexprValue, parseSexpr } from './sexp-eval.js';

/** @typedef {import('./lisp-read.js').Lisp} Lisp */

/** @type {Map<string, Lisp> | null} */
let defaults = null;
/** @type {Map<string, Lisp> | null} */
let vars = null;
/** @type {Lisp[] | null} */
let forms = null;
/** @type {string[]} */
let problems = [];
/** @type {Map<string, string[]>} */
let cache = new Map();

/** Sets the init text (`holiday-*` variables) the holidays follow; empty for Emacs's defaults.
 * @param {string | undefined} init @returns {string[]} what in it could not be used */
export function setHolidayConfig(init) {
  if (!defaults) defaults = runInit(DEFAULT_LISTS);
  vars = init && init.trim() ? runInit(init, defaults) : defaults;
  problems = [];
  const explicit = vars.get('calendar-holidays');
  const groups = explicit ? [explicit] : HOLIDAY_GROUPS.map((g) => /** @type {Lisp} */ (vars && vars.get(g))).filter(Boolean);
  forms = groups.flatMap((g) => listItems(g) || []);
  cache = new Map();
  return problems;
}

/** Follows the Lisp init text kept in `org-xx-lisp-init` (Settings → Advanced). @param {Record<string, string> | null | undefined} vars */
export function applyHolidayVariables(vars) {
  const raw = (vars || {})['org-xx-lisp-init'];
  setHolidayConfig(lispStringValue(raw) || raw || '');
}

/** The days in the window around a month hold these names; computed once per month. @param {number} year @param {number} month */
function monthHolidays(year, month) {
  const key = `${year}-${month}`;
  let hit = cache.get(key);
  if (hit) return hit;
  if (!forms || !vars) setHolidayConfig('');
  const list = holidayList(forms || [], { month, year, vars: vars || new Map(), sexp: holidaySexp }, (m) => { if (!problems.includes(m)) problems.push(m); });
  hit = list.filter((h) => h.date[0] === month && h.date[2] === year).map((h) => `${h.date[1]}\t${h.name}`);
  cache.set(key, hit);
  return hit;
}

/** `holiday-sexp`: the expression with `year` bound; its value is a date list (month day year) or nil.
 * @param {Lisp} expr @param {number} year @returns {[number, number, number] | null} */
function holidaySexp(expr, year) {
  const node = parseSexpr(printLisp(expr));
  const value = evaluateSexprValue(node, { env: { year }, candidateDate: new Date(year, 0, 1), today: new Date() });
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === 'number')) return null;
  return /** @type {[number, number, number]} */ (value);
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
