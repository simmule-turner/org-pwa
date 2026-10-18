// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * A minimal S-expression parser and evaluator for real org-mode's own
 * <%%(sexp)> diary timestamp syntax -- a more general mechanism than
 * this app's own %%(...) body-line triggers (org-contacts-anniversaries,
 * org-anniversary, org-cyclic, diary-float, org-block -- see
 * diary-sexp.js), which each recognize exactly one whole line matching
 * one fixed form. <%%(...)> instead evaluates an arbitrary expression,
 * once per candidate date, wherever it's written as a heading's own
 * timestamp (the same position a plain <2026-01-01> title-timestamp
 * already occupies), and that expression can combine functions
 * together, not just invoke one alone.
 *
 * The expression is evaluated with the candidate date bound (real org
 * calls this variable `date`); a `nil` result means no match that day,
 * a non-nil result means a match, and a STRING result becomes the
 * entry's own displayed text for that occurrence.
 *
 * A small, safe Lisp subset, not Emacs's interpreter: `let`, `let*`, `if`,
 * `unless`, `cond`, `progn`, `when`, `and`, `or`, `not`; arithmetic and
 * comparison; `car`, `cadr`, `cdr`, `nth`, `list`, `memq`, `member`; the
 * `date` variable as (month day year); and a few `calendar-*` helpers. It
 * has no assignment, no function definitions and no I/O, and one day's
 * evaluation stops after MAX_STEPS nodes. Anything unrecognized or wrong
 * (an unknown function, a bad argument type, a malformed expression)
 * evaluates to "no match" rather than throwing, the same
 * tolerant-of-the-unexpected stance every other sexp/timestamp parser in
 * this app already takes.
 *
 * `today-p` is this app's own convenience addition, not a real
 * org/elisp function -- shorthand for real org's own actual
 * `(equal date (calendar-current-date))` idiom (checking whether the
 * date CURRENTLY being evaluated is today's real date), without
 * needing to know that idiom or calendar-current-date's own elisp
 * list-of-(month day year) return shape at all.
 */

import { sexpArgToValue, userSexpResult } from './extensions.js';
import { startOfDay } from './agenda.js';
import { formatWeatherLine, isOrgWeatherLine } from './org-weather.js';
import {
  expandOrgAnniversaryOccurrences,
  expandOrgCyclicOccurrences,
  expandDiaryFloatOccurrences,
  formatSunriseLine,
  formatSunsetLine,
  formatCivilDawnLine,
  formatCivilDuskLine,
  formatNauticalDawnLine,
  formatNauticalDuskLine,
  formatAstronomicalDawnLine,
  formatAstronomicalDuskLine,
  formatDayLengthLine,
} from './diary-sexp.js';

// ---- tokenizing + parsing ---------------------------------------------------

/** Splits `text` into a flat token stream: '(' / ')' as their own
 *  tokens, a double-quoted string as one token (quotes stripped), and
 *  any other whitespace-delimited run of characters as a bare atom
 *  (a symbol like `when` or `org-cyclic`, or a number like `2026` --
 * @param {string} text
 *  parseSexpr below decides which, tokenizing doesn't need to). */
function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== '"') {
        value += text[j];
        j++;
      }
      tokens.push({ type: 'string', value });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < text.length && !/[\s()]/.test(text[j])) j++;
    tokens.push(text.slice(i, j));
    i = j;
  }
  return tokens;
}

/** A leaf node: `{ type: 'number' | 'string' | 'symbol', value }`. A
 *  list (a function call) is a plain JS array of nodes/nested arrays
 *  -- `array` alone is enough to distinguish "this is a call" from "
 *  this is a leaf" throughout evaluateSexpr below, no separate
 * @param {any} [raw]
 *  `{ type: 'list', ... }` wrapper needed. */
function atomNode(raw) {
  if (typeof raw === 'object') return raw; // already a { type: 'string', value } token
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { type: 'number', value: Number(raw) };
  return { type: 'symbol', value: raw };
}

/** Parses `text` (the raw contents between the outermost sexp's own
 *  parentheses, or including them -- both work, see below) into a
 *  single expression tree. Throws on malformed input (an unmatched
 *  paren, or trailing tokens after a complete expression) -- the
 *  caller (parseSexpTimestamp) is expected to catch this and treat a
 *  malformed sexp the same tolerant way every other malformed
 *  Global/Local Variable or diary-sexp form in this app already is:
 * @param {string} text
 *  skipped, not a hard error surfaced to the person. */
function parseSexpr(text) {
  const tokens = tokenize(text);
  let pos = 0;

  /** @returns {any} */ function parseOne() {
    const tok = tokens[pos];
    if (tok === undefined) throw new Error('Unexpected end of expression');
    if (tok === '(') {
      pos++;
      const list = [];
      while (tokens[pos] !== ')') {
        if (pos >= tokens.length) throw new Error('Unmatched (');
        list.push(parseOne());
      }
      pos++; // consume ')'
      return list;
    }
    if (tok === ')') throw new Error('Unexpected )');
    // A leading ' (real Lisp's quote) is transparent here: '(10 11 12) is
    // the list itself, which is how Emacs passes a list to diary-float or
    // org-date, and an unquoted list keeps working too.
    if (typeof tok === 'string' && tok.startsWith("'")) {
      pos++;
      return tok === "'" ? parseOne() : atomNode(tok.slice(1));
    }
    pos++;
    return atomNode(tok);
  }

  const result = parseOne();
  if (pos !== tokens.length) throw new Error('Trailing tokens after expression');
  return result;
}

// ---- evaluation -------------------------------------------------------------

// User-defined functions (see extensions.js). The browser installs the names a script registered and a
// handler that answers for one name, its plain arguments and a day. Without them nothing changes.
let userSexpNames = new Set();
/** @type {any} */
let userSexpHandler = null;

/**
 * Installs (or, with no arguments, removes) the user-defined diary functions.
 * @param {any} [names]
 */
function setUserSexps(names = [], handler = /** @type {any} */ (null)) {
  userSexpNames = new Set(names);
  userSexpHandler = handler;
}

/** True for anything real Lisp/elisp would treat as "non-nil" in a
 *  boolean context -- everything except `false` and the empty string
 *  (a diary function returning `""` is effectively "no match, nothing
 *  to show" the same way `false` is, not a genuine zero-length
 * @param {string | boolean} value
 *  displayed entry). */
function isTruthy(value) {
  return value !== false && value !== '' && !(Array.isArray(value) && value.length === 0);
}

/** Narrows one of diary-sexp.js's own range-expansion functions down
 *  to a single-day yes/no check, by calling it with `date` as BOTH
 *  the start and end of the range and checking whether anything came
 *  back -- reuses the exact same matching logic expandOrgCyclicOccurrences
 *  etc. already have (and are already independently tested against),
 *  rather than a second, potentially-drifting copy of "does this
 * @param {any} [expandFn]
 * @param {any} [date]
 *  specific date match" for each one. */
function occursOn(expandFn, date, /** @type {any[]} */ ...args) {
  return expandFn(...args, date, date).length > 0;
}

// ---- helpers for the standard calendar functions ----------------------------

/**
 * A number node's integer value, else null.
 * @param {any} [node]
 */
function intArg(node) {
  return node && !Array.isArray(node) && node.type === 'number' && Number.isInteger(node.value) ? node.value : null;
}

/** A real Date for year/month/day, or null when it isn't a real calendar
 * @param {number | null} year
 * @param {number | null} month
 * @param {number | null | undefined} day
 *  date (month 13, February 30) rather than letting Date roll it over. */
function realDate(year, month, day) {
  if (year === null || month === null || day === null) return null;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

/** org-date's field rule (the same as diary-date's): an integer, a list
 * @param {any} [node]
 * @param {any} [value]
 *  of integers, or `t` (every value). */
function fieldMatches(node, value) {
  if (Array.isArray(node)) return node.some((n) => intArg(n) === value);
  if (node.type === 'symbol' && node.value === 't') return true;
  return intArg(node) === value;
}

/**
 * ISO 8601 week number (org-class's skip-weeks are ISO weeks).
 * @param {Date} date
 */
function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
}

/** Evaluates one already-parsed expression node against `context`
 *  (`{ candidateDate, today, calendarLatitude, calendarLongitude,
 *  solarAmpm, solarHideLabel }`).
 *  Returns `false` (no match), `true` (a plain match -- the heading's
 *  own title is what should display), or a non-empty string (a
 *  match, AND that string is what should display instead of/
 *  alongside the heading's own title). An unrecognized function
 *  name, or any other malformed/unsupported construct, evaluates to
 * @param {any} [node]
 * @param {any} [context]
 *  `false` rather than throwing -- see parseSexpr's own docs for why. */
/** @returns {any} */ function ev(/** @type {any} */ node, /** @type {any} */ context) {
  const budget = context.budget || (context.budget = { steps: 0 });
  if (++budget.steps > MAX_STEPS) throw new LispError('too many steps');
  if (!Array.isArray(node)) {
    // A bare leaf outside any function call at all -- not a
    // meaningful top-level sexp timestamp on its own (real org
    // expects a function call), so this can't match anything.
    if (node.type === 'number') return node.value;
    if (node.type === 'string') return node.value;
    if (node.type === 'symbol') return lookupSymbol(node.value, context);
    return false;
  }

  const [head, ...args] = node;
  if (!head) return false;
  // A list that starts with a number or string is a literal list, as in '(1 2 3).
  if (head.type === 'number' || head.type === 'string') return node.map((n) => ev(n, context));
  if (head.type !== 'symbol') return false;

  switch (head.value) {
    case 'when': {
      if (args.length < 2) return false;
      const condResult = ev(args[0], context);
      if (!isTruthy(condResult)) return false;
      return progn(args.slice(1), context);
    }

    case 'today-p':
      return startOfDay(context.candidateDate).getTime() === startOfDay(context.today).getTime();

    // Boolean combinators. Like Lisp: `and` yields its last value when
    // every argument is non-nil (so a string result survives), `or` its
    // first non-nil one.
    case 'and': {
      let last = true;
      for (const arg of args) {
        last = ev(arg, context);
        if (!isTruthy(last)) return false;
      }
      return last;
    }
    case 'or': {
      for (const arg of args) {
        /** @type {any} */ const value = ev(arg, context);
        if (isTruthy(value)) return value;
      }
      return false;
    }
    case 'not':
      return args.length === 1 ? !isTruthy(ev(args[0], context)) : false;

    // org-block: every date from the first through the second, inclusive,
    // written year month day (ISO) as org-agenda.el defines it. Either
    // order of the two dates works, as the %%(org-block ...) body-line form
    // has always allowed.
    //
    // There is deliberately NO diary-block / diary-anniversary / diary-cyclic
    // / diary-date here: each has an org-* twin taking ISO (year month day)
    // arguments, whereas the diary-* ones read their arguments in an order
    // that depends on calendar-date-style (month-day-year by default), so
    // the same line would mean different dates depending on a setting this
    // app doesn't have. An unrecognized name matches nothing.
    case 'org-block': {
      if (args.length < 6) return false;
      const n = args.slice(0, 6).map(intArg);
      const start = realDate(n[0], n[1], n[2]);
      const end = realDate(n[3], n[4], n[5]);
      if (!start || !end) return false;
      const [from, to] = start <= end ? [start, end] : [end, start];
      const day = startOfDay(context.candidateDate);
      return day >= from && day <= to;
    }

    // org-date (year month day): each field an integer, a list of
    // integers, or t for every value.
    case 'org-date': {
      if (args.length < 3) return false;
      const c = context.candidateDate;
      return fieldMatches(args[0], c.getFullYear()) && fieldMatches(args[1], c.getMonth() + 1) && fieldMatches(args[2], c.getDate());
    }

    // (org-class Y1 M1 D1 Y2 M2 D2 DAYNAME SKIP-WEEK...): DAYNAME (0 =
    // Sunday) on every week between the two dates, except the ISO weeks
    // listed. Skipping holidays -- the symbol `holidays` or a holiday's
    // name -- needs Emacs's holiday database, which this app doesn't have,
    // so such an expression matches nothing rather than quietly showing
    // the class on a holiday.
    case 'org-class': {
      if (args.length < 7) return false;
      const n = args.slice(0, 7).map(intArg);
      const start = realDate(n[0], n[1], n[2]);
      const end = realDate(n[3], n[4], n[5]);
      const dayname = n[6];
      if (!start || !end || dayname === null || dayname < 0 || dayname > 6) return false;
      const skip = args.slice(7);
      if (skip.some((a) => intArg(a) === null)) return false;
      const day = startOfDay(context.candidateDate);
      if (day < start || day > end || day.getDay() !== dayname) return false;
      const week = isoWeekNumber(day);
      return !skip.some((a) => intArg(a) === week);
    }

    case 'org-cyclic': {
      if (args.length < 4) return false;
      const [n, year, month, day] = args.map((a) => a.value);
      const baseline = new Date(year, month - 1, day);
      return occursOn(expandOrgCyclicOccurrences, context.candidateDate, n, baseline);
    }

    case 'org-anniversary': {
      if (args.length < 3) return false;
      const [year, month, day] = args.map((a) => a.value);
      // Only years after the given one, as in real diary-anniversary.
      return expandOrgAnniversaryOccurrences(month, day, context.candidateDate, context.candidateDate, year).length > 0;
    }

    case 'diary-float': {
      if (args.length < 3) return false;
      const monthSpec = parseMonthArg(args[0]);
      const dayname = args[1].value;
      const n = args[2].value;
      const dayOverride = args[3] ? args[3].value : null;
      const yearFilter = args[4] ? args[4].value : null;
      return occursOn(expandDiaryFloatOccurrences, context.candidateDate, monthSpec, dayname, n, dayOverride, yearFilter);
    }

    case 'diary-sunrise':
      return formatSunriseLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-sunset':
      return formatSunsetLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-civil-dawn':
      return formatCivilDawnLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-civil-dusk':
      return formatCivilDuskLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-nautical-dawn':
      return formatNauticalDawnLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-nautical-dusk':
      return formatNauticalDuskLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-astronomical-dawn':
      return formatAstronomicalDawnLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-astronomical-dusk':
      return formatAstronomicalDuskLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-day-length':
      return formatDayLengthLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, context.solarHideLabel);

    case 'org-weather':
      if (!context.weatherData) return false;
      return formatWeatherLine(context.orgWeatherFormat, context.weatherData, context.orgWeatherTemperatureUnit, context.orgWeatherSpeedUnit, context.today);

    case 'format': {
      if (args.length < 1 || args[0].type !== 'string') return false;
      const fmt = args[0].value;
      const substitutionArgs = args.slice(1);
      /** @param {any} [m] */
      const placeholderCount = (fmt.match(/%[s%]/g) || []).filter((/** @type {any} */ m) => m === '%s').length;
      if (placeholderCount > substitutionArgs.length) return false; // not enough sub-expressions to fill every %s
      let argIndex = 0;
      return fmt.replace(/%[s%]/g, (/** @type {any} */ m) => {
        if (m === '%%') return '%';
        const subResult = ev(substitutionArgs[argIndex], context);
        argIndex++;
        if (typeof subResult === 'string') return subResult;
        if (typeof subResult === 'number') return String(subResult);
        return subResult ? 't' : 'nil'; // real elisp's own printed representation for a non-string, non-nil value in a %s slot
      });
    }

    // ---- general Lisp: bindings, branches, arithmetic, lists, calendar helpers ----
    case 'let':
    case 'let*': {
      if (!args.length || !Array.isArray(args[0])) return false;
      const frame = Object.create(context.env || null);
      const inner = { ...context, env: frame };
      const sequential = head.value === 'let*';
      for (const binding of args[0]) {
        const name = Array.isArray(binding) ? binding[0] : binding;
        if (!name || name.type !== 'symbol') throw new LispError('bad binding');
        const value = Array.isArray(binding) && binding[1] ? ev(binding[1], sequential ? inner : context) : false;
        frame[name.value] = value;
      }
      return progn(args.slice(1), inner);
    }
    case 'progn':
      return progn(args, context);
    case 'if':
      if (args.length < 2) return false;
      return isTruthy(ev(args[0], context)) ? ev(args[1], context) : progn(args.slice(2), context);
    case 'unless':
      if (args.length < 1) return false;
      return isTruthy(ev(args[0], context)) ? false : progn(args.slice(1), context);
    case 'cond': {
      for (const clause of args) {
        if (!Array.isArray(clause) || !clause.length) continue;
        const test = ev(clause[0], context);
        if (isTruthy(test)) return clause.length > 1 ? progn(clause.slice(1), context) : test;
      }
      return false;
    }

    case '+':
    case '*':
    case '-':
    case '/':
    case 'mod':
    case '%':
    case '1+':
    case '1-': {
      const n = args.map((a) => numberOf(ev(a, context)));
      return arithmetic(head.value, n);
    }
    case '=':
    case '/=':
    case '<':
    case '>':
    case '<=':
    case '>=': {
      const n = args.map((a) => numberOf(ev(a, context)));
      if (n.length < 1) throw new LispError('arity');
      if (head.value === '/=') return n.length === 2 && n[0] !== n[1];
      for (let i = 0; i + 1 < n.length; i++) {
        const [a, b] = [n[i], n[i + 1]];
        const ok = head.value === '=' ? a === b : head.value === '<' ? a < b : head.value === '>' ? a > b : head.value === '<=' ? a <= b : a >= b;
        if (!ok) return false;
      }
      return true;
    }
    case 'zerop':
      return args.length === 1 && numberOf(ev(args[0], context)) === 0;
    case 'equal':
    case 'eq':
      return args.length === 2 && JSON.stringify(ev(args[0], context)) === JSON.stringify(ev(args[1], context));

    case 'list':
      return args.map((a) => ev(a, context));
    case 'car':
    case 'cadr':
    case 'cdr':
    case 'nth':
    case 'length':
    case 'memq':
    case 'member': {
      const v = args.map((a) => ev(a, context));
      return listFunction(head.value, v);
    }

    case 'calendar-current-date':
      return dateList(context.today);
    case 'calendar-day-of-week': {
      const [m, d, y] = dateParts(ev(args[0], context));
      return realDate(y, m, d)?.getDay() ?? false;
    }
    case 'calendar-last-day-of-month': {
      const m = numberOf(ev(args[0], context));
      const y = numberOf(ev(args[1], context));
      if (m < 1 || m > 12) throw new LispError('bad month');
      return new Date(y, m, 0).getDate();
    }
    case 'calendar-leap-year-p': {
      const y = numberOf(ev(args[0], context));
      return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    }
    case 'calendar-extract-month':
      return dateParts(ev(args[0], context))[0];
    case 'calendar-extract-day':
      return dateParts(ev(args[0], context))[1];
    case 'calendar-extract-year':
      return dateParts(ev(args[0], context))[2];

    default:
      if (userSexpHandler && userSexpNames.has(head.value)) {
        return userSexpResult(userSexpHandler(head.value, args.map(sexpArgToValue), context.candidateDate));
      }
      return false; // an unrecognized function name -- no match, not an error
  }
}

// ---- the general Lisp layer -------------------------------------------------

const MAX_STEPS = 20000; // one day's evaluation may not run longer than this many nodes

class LispError extends Error {}

/** @param {unknown[]} forms @param {Record<string, unknown>} context */
function progn(forms, context) {
  let last = false;
  for (const f of forms) last = ev(f, context);
  return last;
}

/** A variable's value: a let binding, else `date` (the day being evaluated, as (month day year)), else t / nil. */
function lookupSymbol(/** @type {string} */ name, /** @type {Record<string, any>} */ context) {
  if (context.env && name in context.env) return context.env[name];
  if (name === 't') return true;
  if (name === 'date') return dateList(context.candidateDate);
  return false; // nil, and any unbound symbol
}

function dateList(/** @type {Date} */ d) {
  return [d.getMonth() + 1, d.getDate(), d.getFullYear()];
}

/** (month day year) as three integers, else an error. */
function dateParts(/** @type {unknown} */ v) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => Number.isInteger(n))) throw new LispError('not a date');
  return /** @type {[number, number, number]} */ (v);
}

function numberOf(/** @type {unknown} */ v) {
  if (typeof v !== 'number') throw new LispError('not a number');
  return v;
}

function arithmetic(/** @type {string} */ op, /** @type {number[]} */ n) {
  const allInts = n.every(Number.isInteger);
  const div = (/** @type {number} */ a, /** @type {number} */ b) => {
    if (b === 0) throw new LispError('division by zero');
    return allInts ? Math.trunc(a / b) : a / b;
  };
  switch (op) {
    case '+': return n.reduce((a, b) => a + b, 0);
    case '*': return n.reduce((a, b) => a * b, 1);
    case '-': return n.length === 1 ? -n[0] : n.slice(1).reduce((a, b) => a - b, n[0]);
    case '/': return n.length === 1 ? div(1, n[0]) : n.slice(1).reduce(div, n[0]);
    case '1+': return n[0] + 1;
    case '1-': return n[0] - 1;
    case '%':
    case 'mod': {
      if (n.length !== 2 || n[1] === 0) throw new LispError('bad arguments');
      return op === '%' ? n[0] % n[1] : ((n[0] % n[1]) + n[1]) % n[1];
    }
  }
  throw new LispError('unknown operator');
}

function listFunction(/** @type {string} */ name, /** @type {unknown[]} */ v) {
  const list = (/** @type {unknown} */ x) => (Array.isArray(x) ? x : x === false ? [] : (() => { throw new LispError('not a list'); })());
  switch (name) {
    case 'car': return list(v[0])[0] ?? false;
    case 'cdr': { const r = list(v[0]).slice(1); return r.length ? r : false; }
    case 'cadr': return list(v[0])[1] ?? false;
    case 'nth': return list(v[1])[numberOf(v[0])] ?? false;
    case 'length': return list(v[0]).length;
    case 'memq':
    case 'member': {
      const items = list(v[1]);
      const i = items.findIndex((x) => JSON.stringify(x) === JSON.stringify(v[0]));
      return i < 0 ? false : items.slice(i);
    }
  }
  throw new LispError('unknown function');
}

/** What the rest of the app sees: false (no match), true, or a string (the entry's own text). Any
 *  error -- a wrong argument type, an unbound function, too many steps -- is "no match". */
function evaluateSexpr(/** @type {unknown} */ node, /** @type {Record<string, unknown>} */ context) {
  try {
    if (!Array.isArray(node) && /** @type {{type: string, value: number}} */ (node).type === 'number') return /** @type {{value: number}} */ (node).value !== 0;
    const value = ev(node, context);
    if (typeof value === 'number') return true;
    if (Array.isArray(value)) return value.length > 0;
    return value;
  } catch (e) {
    if (e instanceof LispError) return false;
    throw e;
  }
}

/** `diary-float`'s own MONTH argument, exactly as parseDiaryFloatLine
 *  in diary-sexp.js already accepts it -- a single 1-12 number, the
 *  symbol `t` (every month), or a parenthesized list of numbers
 *  (`(1 4 7 10)` for quarterly) -- except here it arrives as an
 *  already-parsed sexp node (a leaf or a nested array) rather than
 * @param {any} [node]
 *  raw text needing its own regex extraction. */
function parseMonthArg(node) {
  if (Array.isArray(node)) return node.map((n) => n.value);
  if (node.type === 'symbol' && node.value === 't') return 't';
  return node.value;
}

// ---- the <%%(...)> timestamp form itself -----------------------------------

// Matches a <%%(...)> timestamp anywhere in a string -- the "..." itself
// captured via balanced-enough paren counting done separately below
// (a single regex can't correctly balance arbitrarily-nested parens,
// and diary-float's own month-list argument, e.g. "(1 4 7 10)", needs
// at least one level of real nesting to parse at all).
const SEXP_TIMESTAMP_START_RE = /<%%\(/g;

/** Finds every <%%(...)> sexp timestamp written anywhere in `text` --
 *  the sexp-timestamp equivalent of org-timestamp.js's own
 *  findTimestamps, scanning for this genuinely different timestamp
 *  form (an arbitrary expression, not a literal date) in the same
 *  heading-title position a plain timestamp already occupies. Returns
 *  `[{ raw, expr }]` -- `raw` the full matched text including the
 *  surrounding `<%%(...)>`, `expr` the already-parsed expression tree
 *  (or `null` if the sexp itself failed to parse -- malformed input
 * @param {string} text
 *  skipped rather than erroring, matching parseSexpr's own docs). */
function findSexpTimestamps(text) {
  if (!text) return [];
  const results = [];
  SEXP_TIMESTAMP_START_RE.lastIndex = 0;
  let m;
  while ((m = SEXP_TIMESTAMP_START_RE.exec(text))) {
    const openParenIndex = m.index + m[0].length - 1; // the "(" itself
    let depth = 1;
    let i = openParenIndex + 1;
    let inString = false;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (inString) {
        if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
      }
      i++;
    }
    if (depth !== 0) {
      // Unmatched paren -- nothing sensible to extract, stop scanning
      // from here rather than looping on the same unmatched "<%%(".
      SEXP_TIMESTAMP_START_RE.lastIndex = m.index + m[0].length;
      continue;
    }
    // i is now just past the matching ")" -- the next character must
    // be ">" for this to be a real, well-formed <%%(...)> timestamp.
    if (text[i] !== '>') {
      SEXP_TIMESTAMP_START_RE.lastIndex = m.index + m[0].length;
      continue;
    }
    const sexprText = text.slice(openParenIndex, i); // "(...)" including its own parens
    const raw = text.slice(m.index, i + 1); // the full "<%%(...)>"
    let expr;
    try {
      expr = parseSexpr(sexprText);
    } catch {
      expr = null; // malformed -- findSexpTimestamps itself doesn't skip the whole match, evaluateSexpr's own null-handling below does
    }
    results.push({ raw, expr });
    SEXP_TIMESTAMP_START_RE.lastIndex = i + 1;
  }
  return results;
}

/** True if %%(org-weather), in either its standalone-line form or
 *  within a <%%(...)> timestamp, is used anywhere in `doc` -- what
 *  decides whether the "Refresh weather now" action in Settings
 *  (app.js's own renderSettingsView) shows up at all, rather than
 *  cluttering Settings with an action nobody's actual document has
 *  any use for. Lives here, not alongside the rest of org-weather's
 *  own logic in org-weather.js, specifically because it needs
 *  findSexpTimestamps -- which is native to this file -- and this
 *  file already imports from org-weather.js (formatWeatherLine), so
 *  the reverse import direction would create a circular dependency
 * @param {Doc} doc
 *  between the two modules. */
function documentUsesOrgWeather(doc) {
  if (!doc) return false;
  /** @param {Heading} heading */
  const usesIt = (heading) => {
    if (findSexpTimestamps(heading.title).some((ts) => /\borg-weather\b/.test(ts.raw))) return true;
    for (const line of heading.bodyLines || []) {
      if (isOrgWeatherLine(line)) return true;
    }
    return (heading.children || []).some(usesIt);
  };
  return (doc.children || []).some(usesIt);
}

// The heads a "%%(...) text" body line is evaluated by the general evaluator
// for. Every other function a body line can use (org-anniversary, org-cyclic,
// org-block, diary-float, the solar lines, org-weather) has its own dedicated
// form in diary-sexp.js, with its own text handling, and is left to that.
const GENERAL_BODY_LINE_HEADS = new Set(['and', 'or', 'not', 'when', 'unless', 'if', 'cond', 'progn', 'let', 'let*', '=', '/=', '<', '>', '<=', '>=', 'zerop', 'memq', 'member', 'org-class', 'org-date']);

/** Parses a `%%(expr) text` body line whose expression is one the general
 *  evaluator handles -- so `%%(and (org-block ...) (diary-float ...)) Term`
 *  works as a line exactly as it does inside a <%%(...)> timestamp. Returns
 * @param {string} line
 *  `{ expr, text }`, or null for any other line. */
function parseGeneralBodyLine(line) {
  const text = String(line).trim();
  if (!text.startsWith('%%(')) return null;
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let i = 2; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')' && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end === -1) return null;
  let expr;
  try {
    expr = parseSexpr(text.slice(2, end));
  } catch {
    return null;
  }
  const head = Array.isArray(expr) ? expr[0] : null;
  if (!head || head.type !== 'symbol' || !(GENERAL_BODY_LINE_HEADS.has(head.value) || userSexpNames.has(head.value))) return null;
  return { expr, text: text.slice(end).trim() };
}

/** Evaluates one findSexpTimestamps result's own `expr` against
 *  `context` -- a thin wrapper that also handles the "failed to
 *  parse at all" (`expr === null`) case, folding it into the same
 *  "no match" result every other unsupported construct already
 * @param {null} expr
 * @param {any} [context]
 *  produces, so callers don't need their own separate null-check. */
function evaluateSexpTimestamp(expr, context) {
  if (expr === null) return false;
  return evaluateSexpr(expr, context);
}

export { setUserSexps, parseSexpr, evaluateSexpr, findSexpTimestamps, evaluateSexpTimestamp, parseGeneralBodyLine, isTruthy, documentUsesOrgWeather };
