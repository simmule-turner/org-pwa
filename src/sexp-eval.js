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

import { userSexpResult } from './extensions.js';
import { evalSource, toJs, installUserFunctions, reorderDiaryDates, solarTimeString } from './diary-lisp.js';
import { NIL } from './elisp-data.js';
import { isOrgWeatherLine } from './org-weather.js';

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
  if (/^-?\d+(\.\d+)?$/.test(raw)) return raw.includes('.') ? Object.defineProperty({ type: 'number', value: Number(raw) }, 'float', { value: true }) : { type: 'number', value: Number(raw) };
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
  Object.defineProperty(result, 'source', { value: text.trim() });
  return result;
}

// ---- evaluation -------------------------------------------------------------

/** Names of the functions a script registered (extensions.js); parseGeneralBodyLine accepts a line that starts with one. */
let userSexpNames = new Set();

/**
 * Installs (or, with no arguments, removes) the user-defined diary functions. The handler gets one name, its plain arguments
 * and a day, and answers true, a string or false.
 * @param {any} [names]
 */
function setUserSexps(names = [], handler = /** @type {any} */ (null)) {
  userSexpNames = new Set(names);
  installUserFunctions(handler ? names : [], handler ? (n, args, date) => userSexpResult(handler(n, args, date)) : null);
}

/** True for anything the diary treats as a match: not nil, and not an empty string or list. @param {unknown} value */
function isTruthy(value) {
  return value !== false && value !== '' && !(Array.isArray(value) && value.length === 0);
}

/** The Lisp text of a parsed node, for a node that did not come from parseSexpr. @param {any} node @returns {string} */
function nodeSource(node) {
  if (Array.isArray(node)) return '(' + node.map(nodeSource).join(' ') + ')';
  if (node.type === 'string') return JSON.stringify(node.value);
  if (node.type === 'number') return Object.is(node.value, -0) ? '-0' : (node.float && Number.isInteger(node.value) ? node.value + '.0' : String(node.value));
  if (node.type === 'value') return node.value === true ? 't' : node.value === false ? 'nil' : JSON.stringify(node.value);
  return String(node.value);
}

/** The text a node stands for: what it was parsed from, else printed back. @param {any} node */
function sourceOf(node) {
  return typeof node.source === 'string' ? node.source : nodeSource(node);
}

/**
 * Evaluates a parsed expression for the day of `context`, keeping the error when there is one.
 * @param {any} node @param {import('./diary-lisp.js').Context} context
 * @returns {{ value: any, error?: string, kind?: string }}
 */
function evaluateSexpDetailed(node, context) {
  if (!Array.isArray(node) && node.type === 'number') return { value: node.value !== 0 };
  const r = evalSource(sourceOf(node), context);
  if ('error' in r) return { value: false, error: r.error, kind: r.kind };
  return { value: r.value === NIL ? false : toJs(r.value) };
}

/** What the rest of the app sees: false (no match), true, or a string (the entry's own text). An error is "no match". @param {unknown} node @param {import('./diary-lisp.js').Context} context */
function evaluateSexpr(node, context) {
  const { value } = evaluateSexpDetailed(node, context);
  if (typeof value === 'number') return true;
  if (Array.isArray(value)) return value.length > 0;
  return value;
}

/** The value a sexp stands for (a number, string, list or false), for callers that need more than a match. @param {unknown} node @param {import('./diary-lisp.js').Context} context @returns {unknown} */
function evaluateSexprValue(node, context) {
  return evaluateSexpDetailed(node, context).value;
}

/**
 * Rewrites a `%%(diary-anniversary …)`, `diary-cyclic` or `diary-block` body line into its
 * org-* twin (year month day), reading the dates in `style` order. Other lines come back unchanged.
 * @param {string} line
 * @param {string} [style]
 */
function canonicalDiaryLine(line, style) {
  const m = /^%%\((diary-anniversary|diary-cyclic|diary-block)((?:\s+-?\d+)+)\)/.exec(line);
  if (!m) return line;
  const nums = m[2].trim().split(/\s+/).map((n) => ({ type: 'number', value: Number(n) }));
  const out = reorderDiaryDates(m[1], nums, style).map((n) => n.value);
  return '%%(' + m[1].replace('diary-', 'org-') + ' ' + out.join(' ') + ')' + line.slice(m[0].length);
}

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
const GENERAL_BODY_LINE_HEADS = new Set(['diary-remind', 'format', 'diary-sunrise-sunset', 'diary-entry-time', 'solar-sunrise-sunset', 'solar-time-string', 'apply', 'and', 'or', 'not', 'when', 'unless', 'if', 'cond', 'progn', 'let', 'let*', '=', '/=', '<', '>', '<=', '>=', 'zerop', 'memq', 'member', 'org-class', 'org-date', 'diary-date', 'diary-offset', 'diary-ordinal-suffix', 'calendar-nth-named-day', 'diary-day-of-year', 'diary-iso-date', 'diary-julian-date', 'diary-astro-day-number', 'diary-hebrew-date', 'diary-islamic-date', 'diary-bahai-date', 'diary-chinese-date', 'diary-lunar-phases', 'diary-hebrew-birthday', 'diary-hebrew-yahrzeit', 'diary-hebrew-omer', 'diary-hebrew-rosh-hodesh', 'diary-hebrew-parasha', 'diary-hebrew-sabbath-candles']);

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

/**
 * Like evaluateSexpTimestamp, and also says why a program failed: `error` is the message Emacs would print.
 * @param {any} expr @param {import('./diary-lisp.js').Context} context
 * @returns {{ result: any, error?: string }}
 */
function evaluateSexpWithError(expr, context) {
  if (expr === null) return { result: false };
  const { value, error } = evaluateSexpDetailed(expr, context);
  if (error !== undefined) return { result: false, error };
  if (typeof value === 'number') return { result: true };
  if (Array.isArray(value)) return { result: value.length > 0 };
  return { result: value };
}

export { solarTimeString, canonicalDiaryLine, setUserSexps, parseSexpr, evaluateSexpr, evaluateSexpDetailed, evaluateSexprValue, findSexpTimestamps, evaluateSexpTimestamp, evaluateSexpWithError, parseGeneralBodyLine, isTruthy, documentUsesOrgWeather };
