/**
 * A minimal S-expression parser and evaluator for real org-mode's own
 * <%%(sexp)> diary timestamp syntax -- a genuinely different, more
 * general mechanism from this app's own existing %%(...) body-line
 * triggers (org-contacts-anniversaries, org-anniversary, org-cyclic,
 * diary-float, org-block, diary-sunrise-sunset -- see diary-sexp.js):
 * those five recognize exactly one whole line matching one of five
 * fixed forms; <%%(...)> instead evaluates an arbitrary expression,
 * once per candidate date, wherever it's written as a heading's own
 * timestamp (the same position a plain <2026-01-01> title-timestamp
 * already occupies) -- and that expression can combine functions
 * together, not just invoke one alone.
 *
 * Confirmed directly against real org-mode's own documented sexp
 * timestamp semantics: the expression is evaluated with the candidate
 * date bound (real org calls this variable `date`); a `nil` result
 * means no match that day, a non-nil result means a match, and
 * specifically a STRING result becomes the entry's own displayed
 * text for that occurrence (real diary-sunrise-sunset's own actual
 * behavior -- it always "matches", and what it matches WITH is the
 * formatted sunrise/sunset text itself, not a fixed heading title).
 *
 * Deliberately NOT a general elisp interpreter -- only `when` (the
 * one control-flow form needed for the requested composability) and
 * a closed set of named functions are recognized; anything else
 * (an unrecognized function name, a malformed expression) evaluates
 * to "no match" rather than throwing, the same tolerant-of-the-
 * unexpected stance every other sexp/timestamp parser in this app
 * already takes.
 *
 * `today-p` is this app's own convenience addition, not a real
 * org/elisp function -- shorthand for real org's own actual
 * `(equal date (calendar-current-date))` idiom (checking whether the
 * date CURRENTLY being evaluated is today's real date), without
 * needing to know that idiom or calendar-current-date's own elisp
 * list-of-(month day year) return shape at all.
 */

import { startOfDay } from './agenda.js';
import {
  expandOrgAnniversaryOccurrences,
  expandOrgCyclicOccurrences,
  expandDiaryFloatOccurrences,
  formatSunriseSunsetLine,
  formatSolarSummaryLine,
  formatSunriseLine,
  formatSunsetLine,
  formatCivilSunriseLine,
  formatCivilSunsetLine,
  formatDayLengthLine,
} from './diary-sexp.js';

// ---- tokenizing + parsing ---------------------------------------------------

/** Splits `text` into a flat token stream: '(' / ')' as their own
 *  tokens, a double-quoted string as one token (quotes stripped), and
 *  any other whitespace-delimited run of characters as a bare atom
 *  (a symbol like `when` or `org-cyclic`, or a number like `2026` --
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
 *  skipped, not a hard error surfaced to the person. */
function parseSexpr(text) {
  const tokens = tokenize(text);
  let pos = 0;

  function parseOne() {
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
    pos++;
    return atomNode(tok);
  }

  const result = parseOne();
  if (pos !== tokens.length) throw new Error('Trailing tokens after expression');
  return result;
}

// ---- evaluation -------------------------------------------------------------

/** True for anything real Lisp/elisp would treat as "non-nil" in a
 *  boolean context -- everything except `false` and the empty string
 *  (a diary function returning `""` is effectively "no match, nothing
 *  to show" the same way `false` is, not a genuine zero-length
 *  displayed entry). */
function isTruthy(value) {
  return value !== false && value !== '';
}

/** Narrows one of diary-sexp.js's own range-expansion functions down
 *  to a single-day yes/no check, by calling it with `date` as BOTH
 *  the start and end of the range and checking whether anything came
 *  back -- reuses the exact same matching logic expandOrgCyclicOccurrences
 *  etc. already have (and are already independently tested against),
 *  rather than a second, potentially-drifting copy of "does this
 *  specific date match" for each one. */
function occursOn(expandFn, date, ...args) {
  return expandFn(...args, date, date).length > 0;
}

/** Evaluates one already-parsed expression node against `context`
 *  (`{ candidateDate, today, calendarLatitude, calendarLongitude,
 *  solarAmpm, solarHideLabel }`).
 *  Returns `false` (no match), `true` (a plain match -- the heading's
 *  own title is what should display), or a non-empty string (a
 *  match, AND that string is what should display instead of/
 *  alongside the heading's own title -- diary-sunrise-sunset's own
 *  actual behavior). An unrecognized function name, or any other
 *  malformed/unsupported construct, evaluates to `false` rather than
 *  throwing -- see parseSexpr's own docs for why. */
function evaluateSexpr(node, context) {
  if (!Array.isArray(node)) {
    // A bare leaf outside any function call at all -- not a
    // meaningful top-level sexp timestamp on its own (real org
    // expects a function call), so this can't match anything.
    if (node.type === 'number') return node.value !== 0;
    if (node.type === 'string') return node.value;
    return false;
  }

  const [head, ...args] = node;
  if (!head || head.type !== 'symbol') return false;

  switch (head.value) {
    case 'when': {
      if (args.length < 2) return false;
      const condResult = evaluateSexpr(args[0], context);
      if (!isTruthy(condResult)) return false;
      return evaluateSexpr(args[1], context);
    }

    case 'today-p':
      return startOfDay(context.candidateDate).getTime() === startOfDay(context.today).getTime();

    case 'org-cyclic': {
      if (args.length < 4) return false;
      const [n, year, month, day] = args.map((a) => a.value);
      const baseline = new Date(year, month - 1, day);
      return occursOn(expandOrgCyclicOccurrences, context.candidateDate, n, baseline);
    }

    case 'org-anniversary': {
      if (args.length < 3) return false;
      const [year, month, day] = args.map((a) => a.value);
      return occursOn(expandOrgAnniversaryOccurrences, context.candidateDate, month, day);
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

    case 'diary-sunrise-sunset':
      return formatSunriseSunsetLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude);

    case 'diary-solar-summary':
      return formatSolarSummaryLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude);

    case 'diary-sunrise':
      return formatSunriseLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-sunset':
      return formatSunsetLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-civil-sunrise':
      return formatCivilSunriseLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-civil-sunset':
      return formatCivilSunsetLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, undefined, context.solarAmpm, context.solarHideLabel);

    case 'diary-day-length':
      return formatDayLengthLine(context.candidateDate, context.calendarLatitude, context.calendarLongitude, context.solarHideLabel);

    default:
      return false; // an unrecognized function name -- no match, not an error
  }
}

/** `diary-float`'s own MONTH argument, exactly as parseDiaryFloatLine
 *  in diary-sexp.js already accepts it -- a single 1-12 number, the
 *  symbol `t` (every month), or a parenthesized list of numbers
 *  (`(1 4 7 10)` for quarterly) -- except here it arrives as an
 *  already-parsed sexp node (a leaf or a nested array) rather than
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
    let expr = null;
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

/** Evaluates one findSexpTimestamps result's own `expr` against
 *  `context` -- a thin wrapper that also handles the "failed to
 *  parse at all" (`expr === null`) case, folding it into the same
 *  "no match" result every other unsupported construct already
 *  produces, so callers don't need their own separate null-check. */
function evaluateSexpTimestamp(expr, context) {
  if (expr === null) return false;
  return evaluateSexpr(expr, context);
}

export { parseSexpr, evaluateSexpr, findSexpTimestamps, evaluateSexpTimestamp, isTruthy };
