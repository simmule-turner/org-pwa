// @ts-check
/**
 * What a formula is evaluated against: the table's cells and the active modes. `currentRow`/`currentCol` are filled in per cell.
 * @typedef {{
 *   dataRows: any[], dataRowCount: number, colCount: number, hlinePositions: number[],
 *   complexDomain?: any, numericMode?: any, durationMode?: boolean, emptyMode?: string, forceNumeric?: boolean, angleMode?: string,
 *   constants?: Record<string, any>, userCall?: ((name: string, args: any[]) => any) | undefined, now?: Date,
 *   currentRow?: number, currentCol?: number, probe?: { nonNumeric: boolean },
 * }} FormulaCtx
 */
/** @typedef {import('./types.js').Table} Table */
/** @typedef {{ type: 'absolute', n: number } | { type: 'relative', delta: number } | { type: 'first' } | { type: 'last' } | { type: 'hline', count: number, offset: number }} RowRef */
/** @typedef {{ type: 'absolute', n: number } | { type: 'first' } | { type: 'last' }} ColRef */
/** @typedef {{ asStart: number, asEnd: number }} HlineBoundary */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * #+TBLFM: parsing and evaluation.
 *
 * Real org's own table-formula language, for anything beyond trivial
 * arithmetic, is Emacs Calc -- an entire separate symbolic-math package
 * with its own operator set, number formatting, date/unit arithmetic,
 * and function library. Reproducing that faithfully is a different,
 * much larger feature than this one; what's actually built here is a
 * deliberately narrower, well-scoped subset that covers the common,
 * everyday cases: plain arithmetic (+ - * / ^, parentheses, unary
 * minus) plus five aggregate functions over a cell range (sum, mean,
 * count, min, max -- both the bare names and org/Calc's own
 * "v"-prefixed vector-function names, vsum/vmean/vcount/vmin/vmax,
 * are recognized as synonyms).
 *
 * Reference syntax (real org's own, both as a formula's own LHS target
 * and inside an RHS expression):
 *   $N          column N of the CURRENT row (only valid inside an RHS
 *               expression -- meaningless as a standalone LHS target,
 *               see the column-formula shorthand below for that case)
 *   @N$M        row N, column M -- both explicit
 *   @-N / @+N   row N ABOVE / BELOW the current formula's own target
 *               row (relative, only meaningful inside an RHS
 *               expression -- there is no "current row" for an LHS
 *               target to be relative TO)
 *   @< / @>     the first / last data row
 *   $< / $>     the first / last column
 *   A$B..C$D    a range: every cell from column/row A/B through C/D
 *               inclusive, in reading order -- valid as an aggregate
 *               function's own argument, not as a plain arithmetic
 *               operand (a range is a list of values, not one value)
 *
 * Row numbering counts DATA rows only -- a horizontal rule (hline)
 * never gets its own @N, matching real org's own actual behavior; @3
 * is always the 3rd row of actual data, however many hlines separate
 * it from the top.
 *
 * A formula's own LHS target is either a single cell (@N$M) or, with
 * no @ at all (just $M=...), real org's own "column formula"
 * shorthand: apply this same one formula to every data row in the
 * table, each row computing its own $M from its own other cells.
 * Multiple formulas in one #+TBLFM: line are separated by "::" and
 * evaluated in the order written, each one able to see any earlier
 * formula's already-updated values within the same recalculation pass
 * -- covering the common "chained column" case (e.g. col 3 = col1+col2,
 * then col 4 = col3*2) without needing a full dependency graph.
 */

// This module's first (and so far only) external dependency -- a
// tree-shaken mathjs subset (Unit, BigNumber, Fraction, plus the
// arithmetic/transcendental functions each depends on) vendored
// locally, not fetched from a CDN. See tools/build-mathjs-vendor.sh
// for exactly what's included, how to regenerate it, and the real,
// measured sizes/benchmarks behind the choices below.
import {
  create,
  bignumberDependencies, fractionDependencies, unitDependencies, createUnitDependencies,
  addDependencies, subtractDependencies, multiplyDependencies, divideDependencies, powDependencies,
  sqrtDependencies, absDependencies, unaryMinusDependencies,
  compareDependencies, equalDependencies, largerDependencies, smallerDependencies,
  logDependencies, log10Dependencies, expDependencies,
  sinDependencies, cosDependencies, tanDependencies, asinDependencies, acosDependencies, atanDependencies,
  roundDependencies, floorDependencies, ceilDependencies, fixDependencies,
} from './vendor/mathjs/mathjs-custom.min.js';
import {
  isComplex, isReal, bigDomain, fractionDomain, toReal, realToEngine, makeRect, parseComplexCell,
  cNeg, cConj, cAdd, cSub, cMul, cDiv, cPow, cAbs, cArg, cRe, cIm, cToPolar, cToRect, cSqrt, cExp, cLn, cLog10, cLog,
  cSin, cCos, cTan, cAsin, cAcos, cAtan, cEquals, cAggregate,
} from './calc-complex.js';
import * as Sym from './calc-symbolic.js';
import './calc-simplify.js'; // registers simplify and esimplify with the symbolic engine
import './calc-solve.js'; // registers solve and fsolve with the symbolic engine
import { formatTimeString } from './format-time.js';
import {
  isVector, makeVector, parseVectorCell, flattenVector, vNeg, vBinop, vEquals, vDet, vInv, vTrn, vTrace, vCross, vLength, vAbs, formatCalcValue,
} from './calc-vector.js';

// The full dependency set every instance below is built from, every
// time, rather than a different narrower subset per instance purpose
// -- simpler, and the marginal size cost between subsets was already
// shown to be negligible (see the build script's own measurements).
const MATHJS_DEPENDENCIES = {
  bignumberDependencies, fractionDependencies, unitDependencies, createUnitDependencies,
  addDependencies, subtractDependencies, multiplyDependencies, divideDependencies, powDependencies,
  sqrtDependencies, absDependencies, unaryMinusDependencies,
  compareDependencies, equalDependencies, largerDependencies, smallerDependencies,
  logDependencies, log10Dependencies, expDependencies,
  sinDependencies, cosDependencies, tanDependencies, asinDependencies, acosDependencies, atanDependencies,
  roundDependencies, floorDependencies, ceilDependencies, fixDependencies,
};

// A single, shared instance at mathjs's own default precision -- used
// for uconv() (Unit conversion doesn't need configurable precision at
// all) and as the Fraction-mode instance (Fraction arithmetic is
// exact by definition, so precision doesn't apply to it either; one
// shared instance covers every Fraction-mode formula, no caching
// needed).
const mathjsDefault = create(MATHJS_DEPENDENCIES);

// Real Calc's own tsp/tbsp abbreviations don't exist in mathjs's unit
// table at all (confirmed directly) -- it only has the full words
// teaspoon/tablespoon. Aliased here so uconv() recognizes the name
// real Calc itself uses, without disturbing the original spelling.
mathjsDefault.createUnit('tsp', '1 teaspoon');
mathjsDefault.createUnit('tbsp', '1 tablespoon');

// Real Calc's own pN precision mode needs a genuinely different,
// differently-configured instance per distinct N -- BigNumber
// precision is instance-level config in mathjs, not a per-value
// option. Cached by precision so a repeated pN doesn't pay create()'s
// own real, measured cost more than once per distinct value seen
// (benchmarked directly: ~1.5ms uncached, ~0.01ms once cached --
// effectively free for the handful of distinct precisions any real
// document would realistically use).
const mathjsByPrecision = new Map();
/** @param {number} precision */
function mathjsForPrecision(precision) {
  let instance = mathjsByPrecision.get(precision);
  if (!instance) {
    instance = create(MATHJS_DEPENDENCIES, { precision });
    mathjsByPrecision.set(precision, instance);
  }
  return instance;
}

// ---- reference parsing ------------------------------------------------

/** Parses one row-reference token's text (after the leading "@", not
 *  including it) into { type: 'absolute', n } | { type: 'relative', delta }
 *  | { type: 'first' } | { type: 'last' }. Returns null if it doesn't
 * @param {string} text
 *  match any recognized row-reference shape. */
function parseRowRef(text) {
  if (text === '<') return { type: 'first' };
  if (text === '>') return { type: 'last' };
  const relative = /^([+-])(\d+)$/.exec(text);
  if (relative) return { type: 'relative', delta: (relative[1] === '-' ? -1 : 1) * Number(relative[2]) };
  const absolute = /^(\d+)$/.exec(text);
  if (absolute) return { type: 'absolute', n: Number(absolute[1]) };
  const hline = /^(I+)([+-]\d+)?$/.exec(text);
  if (hline) return { type: 'hline', count: hline[1].length, offset: hline[2] ? Number(hline[2]) : 0 };
  return null;
}

/** Parses one column-reference token's text (after the leading "$", not
 *  including it) into { type: 'absolute', n } | { type: 'first' } |
 *  { type: 'last' }. Returns null if unrecognized. Real org also
 *  supports relative column refs ($-1/$+1); not implemented here --
 *  genuinely rare in practice compared to relative ROW refs (a
 *  formula reaching sideways to a fixed, always-present neighboring
 *  column is far more common than one reaching to a neighboring row,
 *  since columns are normally fixed data fields and rows are the
 * @param {string} text
 *  repeating axis a formula is normally applied down). */
function parseColRef(text) {
  if (text === '<') return { type: 'first' };
  if (text === '>') return { type: 'last' };
  const absolute = /^(\d+)$/.exec(text);
  if (absolute) return { type: 'absolute', n: Number(absolute[1]) };
  return null;
}

/** Resolves a parsed row/col ref into an actual 1-indexed row/column
 *  number, given `currentRow` (the row this formula's own evaluation
 *  is currently targeting -- only consulted for a relative row ref)
 *  and `dataRowCount`/`colCount` (the table's own actual dimensions,
 *  for @>/$> and for bounds-checking). Returns null for an
 *  out-of-range result (e.g. @-5 from row 2) rather than clamping --
 *  a formula reaching past the edge of the table is a real error to
 * @param {RowRef} ref
 * @param {number} currentRow
 * @param {number} dataRowCount
 * @param {HlineBoundary[]} hlinePositions
 * @param {boolean} asRangeStart
 *  surface, not something to silently reinterpret. */
function resolveRowRef(ref, currentRow, dataRowCount, hlinePositions, asRangeStart) {
  let n;
  if (ref.type === 'absolute') n = ref.n;
  else if (ref.type === 'relative') n = currentRow + ref.delta;
  else if (ref.type === 'first') n = 1;
  else if (ref.type === 'hline') {
    const boundary = hlinePositions && hlinePositions[ref.count - 1];
    const base = boundary ? (asRangeStart ? boundary.asStart : boundary.asEnd) : asRangeStart ? dataRowCount + 1 : dataRowCount;
    n = base + ref.offset;
  } else n = dataRowCount; // 'last'
  return n >= 1 && n <= dataRowCount ? n : null;
}

/**
 * @param {ColRef | null} ref
 * @param {number} colCount
 * @param {number} [currentCol]
 * @returns {number | null}
 */
function resolveColRef(ref, colCount, currentCol) {
  if (ref === null) return /** @type {number} */ (currentCol); // no column specified in this ref at all -- real org's own actual convention for a bare row-only reference/range ("@2", "@2..@6"): defaults to the formula's own target column, the same way a bare row-less reference ("$2") already defaults to the current row
  const n = ref.type === 'absolute' ? ref.n : ref.type === 'first' ? 1 : colCount;
  return n >= 1 && n <= colCount ? n : null;
}

/** Pre-computes every hline's own data-row-number boundary, for both
 *  directions a range endpoint might use it in -- confirmed directly
 *  against real Emacs org-mode (running formulas through
 *  org-table-recalculate in batch mode, not inferred): a range like
 *  "@I..@II" spans every actual data row strictly between the two
 *  hlines, so the FIRST hline's own boundary, used as a range START,
 *  is the data-row-number of the first actual row after it; the
 *  SECOND hline's own boundary, used as a range END, is the
 *  data-row-number of the last actual row before it. Indexed by
 *  hline count minus 1 (index 0 is @I). A count beyond how many
 *  hlines the table actually has still resolves rather than erroring
 *  -- also confirmed directly against real Emacs -- clamping to just
 *  past the table's own end (asStart) or the table's own actual last
 * @param {import('./types.js').TableRow[]} workingRows
 *  row (asEnd). */
function computeHlinePositions(workingRows) {
  const positions = [];
  let dataRowsBefore = 0;
  for (const row of workingRows) {
    if (row.type === 'rule') {
      positions.push({ asStart: dataRowsBefore + 1, asEnd: dataRowsBefore });
    } else {
      dataRowsBefore++;
    }
  }
  return { positions, dataRowCount: dataRowsBefore };
}

// ---- expression tokenizing/parsing ------------------------------------

const TOKEN_RE =
  /\s*("(?:[^"\\]|\\.)*"|\.\.|@(?:[<>]|[+-]?\d+|I+(?:[+-]\d+)?)(?:\$(?:[<>]|\d+))?|\$(?:[<>]|\d+|[A-Za-z_][A-Za-z0-9_]*)|\d+\.?\d*(?:[eE][-+]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|==|!=|<=|>=|&&|\|\||[()[\]+\-*/%\\^,<>=!])\s*/y;

/** date-to-time and format-time-string are real Emacs function names
 *  with literal hyphens in them -- TOKEN_RE's own generic identifier
 *  pattern ([A-Za-z_][A-Za-z0-9_]*) doesn't include "-", and its own
 *  single-character "-" operator token would otherwise split these
 *  apart entirely (confirmed directly: "date-to-time($1)" tokenizes
 *  without this as ["date", "-", "to", "-", "time", "(", "$1", ")"],
 *  parsing as subtraction, not a function call). This is a small,
 *  isolated pre-check rather than an edit to TOKEN_RE's own pattern,
 *  specifically to avoid any risk of interacting with that pattern's
 *  other alternatives -- most notably the "I+" hline-reference marker
 *  (@II, @III, ...), which is deliberately uppercase-only; embedding
 *  a case-insensitive match for these two names directly into
 *  TOKEN_RE would risk quietly making that marker accept lowercase
 *  too, a real behavior change nobody asked for. Case-insensitive
 *  here, matching how every other function name in this language
 *  already works (the parser's own later .toLowerCase() step). The
 *  negative lookahead (no further identifier character immediately
 *  after) stops "date-to-time2" or similar from incorrectly matching
 *  the shorter, real name and leaving a stray "2" dangling as its own
 *  separate, out-of-place token. */
const HYPHENATED_FUNCTION_RE = /^(date-to-time|format-time-string|orgtbl-ascii-draw)(?![A-Za-z0-9_-])/i;

/** Tokenizes an RHS expression -- numbers, cell/range references
 *  (kept as single tokens, not decomposed further here), function
 *  names, and operators/punctuation. Throws on any character that
 *  doesn't match one of those shapes, rather than silently skipping
 *  it -- a malformed formula should surface as an error, not quietly
 * @param {string} expr
 *  evaluate to something the person never actually wrote. */
/** @param {string} expr @param {boolean} [fractions] read Calc's `1:2` as one token (only the symbolic engine knows what to do with it) */
function tokenize(expr, fractions = false) {
  const tokens = [];
  let pos = 0;
  TOKEN_RE.lastIndex = 0;
  while (pos < expr.length) {
    const leadingWs = (/^\s*/.exec(expr.slice(pos)) || [''])[0];
    const afterWs = pos + leadingWs.length;
    const fraction = fractions ? /^\d+:\d+/.exec(expr.slice(afterWs)) : null;
    if (fraction) {
      tokens.push(fraction[0]);
      pos = afterWs + fraction[0].length;
      continue;
    }
    const hyphenated = HYPHENATED_FUNCTION_RE.exec(expr.slice(afterWs));
    if (hyphenated) {
      tokens.push(hyphenated[1]);
      pos = afterWs + hyphenated[1].length;
      continue;
    }
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(expr);
    if (!m || m.index !== pos) {
      throw new Error(`Unrecognized character in formula at position ${pos}: "${expr.slice(pos, pos + 1)}"`);
    }
    tokens.push(m[1]);
    pos = TOKEN_RE.lastIndex;
  }
  return tokens;
}

// Every name below is a real, confirmed Emacs Calc function name,
// verified directly against the GNU Emacs Calc Manual (and, for
// vcount, its actual Lisp source) -- not an invented convenience
// alias. This app previously also accepted plain, unprefixed names
// (sum/mean/min/max/count) as synonyms; those were never actually
// real Calc names and have been removed, so this function set is now
// a genuine, verified subset of real org's own table-formula
// language, not an approximation of it.
/** Functions a script registered with org.tableFunction (names only; the answers come through options.userCall). */
let userTableFunctionNames = new Set();
/** @param {string[]} [names] */
export function setUserTableFunctions(names = []) {
  userTableFunctionNames = new Set(names);
}
/** @param {string} name */
export function isBuiltinFormulaName(name) {
  return name in AGGREGATE_FUNCTIONS || name in SCALAR_FUNCTIONS || name === 'string' || name === 'if';
}

const AGGREGATE_FUNCTIONS = {
  vsum: (/** @type {number[]} */ vals) => vals.reduce((a, b) => a + b, 0),
  vmean: (/** @type {number[]} */ vals) => (vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length),
  vcount: (/** @type {number[]} */ vals) => vals.length,
  vprod: (/** @type {number[]} */ vals) => vals.reduce((a, b) => a * b, 1),
  vmin: (/** @type {number[]} */ vals) => (vals.length === 0 ? 0 : Math.min(...vals)),
  vmax: (/** @type {number[]} */ vals) => (vals.length === 0 ? 0 : Math.max(...vals)),
  vmedian: (/** @type {number[]} */ vals) => {
    if (vals.length === 0) return 0;
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  },
  // Population variance/stddev (divide by n) vs sample (divide by
  // n-1) are genuinely different, real Calc functions with different
  // names -- vvar/vsdev (sample) and vpvar/vpsdev (population) --
  // not one function with a mode flag. There's deliberately no plain
  // "variance"/"stddev" name for either pair: which one someone means
  // by an unqualified name is exactly the kind of silent, wrong-answer
  // ambiguity this app would rather force an explicit choice on.
  vvar: (/** @type {number[]} */ vals) => sampleVariance(vals),
  vpvar: (/** @type {number[]} */ vals) => populationVariance(vals),
  vsdev: (/** @type {number[]} */ vals) => Math.sqrt(sampleVariance(vals)),
  vpsdev: (/** @type {number[]} */ vals) => Math.sqrt(populationVariance(vals)),
};

/** @param {number[]} vals */
function populationVariance(vals) {
  if (vals.length === 0) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / vals.length;
}

/** @param {number[]} vals */
function sampleVariance(vals) {
  if (vals.length < 2) return 0; // n-1 divisor is undefined for n=0 or n=1 -- 0 rather than a division-by-zero NaN, matching this module's own existing "can't compute a real result" convention
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / (vals.length - 1);
}

// Single-value functions -- one number in, one number out, unlike
// AGGREGATE_FUNCTIONS above (which reduce a whole range/list to one
// number). All five confirmed directly against the Calc manual's own
// "Integer Truncation" and "Basic Arithmetic" sections. Each of
// floor/ceil/round/trunc optionally takes a SECOND argument -- how
// many digits after the decimal point to keep -- also confirmed
// directly against the manual's own wording for algebraic-formula
// usage (exactly the context table formulas are written in).
// The six trig functions read this app's own D/R angle-mode flag (see
// parseModeString's own angleMode field) -- handled via a second,
// explicit argument passed only to these specific names (see
// evaluateAst's own scalarCall case), rather than appending it to
// every scalar function call uniformly, which would collide with an
// optional second argument a function like log() already has of its
// own (log(x)'s own missing base would otherwise silently receive the
// angle-mode boolean instead).
const TRIG_FUNCTION_NAMES = new Set(['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan']);

const DEG_TO_RAD = Math.PI / 180;

const SCALAR_FUNCTIONS = {
  sqrt: (/** @type {any} */ x) => {
    if (x < 0) throw new Error('sqrt of a negative number has no real result');
    return Math.sqrt(x);
  },
  idiv: (/** @type {number} */ x, /** @type {number} */ y) => {
    if (y === 0) throw new Error('idiv by zero');
    return Math.floor(x / y);
  },
  floor: (/** @type {any} */ x, /** @type {any} */ digits) => roundToDigits(x, digits, Math.floor),
  ceil: (/** @type {any} */ x, /** @type {any} */ digits) => roundToDigits(x, digits, Math.ceil),
  round: (/** @type {any} */ x, /** @type {any} */ digits) => roundToDigits(x, digits, roundHalfAwayFromZero),
  trunc: (/** @type {any} */ x, /** @type {any} */ digits) => roundToDigits(x, digits, Math.trunc),
  deg: (/** @type {any} */ x) => (isTaggedValue(x) ? x.days : x),
  // Complex-aware names (see calc-complex.js); with a real argument these are Calc's plain real answers.
  abs: (/** @type {any} */ x) => Math.abs(x),
  // matrix and vector functions (calc-vector.js); they need a vector or matrix, which vectorScalarCall handles
  det: () => { throw new Error('det needs a square matrix'); },
  inv: () => { throw new Error('inv needs a square matrix'); },
  trn: () => { throw new Error('trn needs a matrix'); },
  tr: () => { throw new Error('tr needs a square matrix'); },
  cross: () => { throw new Error('cross needs two 3-element vectors'); },
  vlen: () => { throw new Error('vlen needs a vector'); },
  re: (/** @type {any} */ x) => x,
  im: () => 0,
  conj: (/** @type {any} */ x) => x,
  arg: (/** @type {any} */ x, /** @type {any} */ isDegrees) => (x < 0 ? (isDegrees ? 180 : Math.PI) : 0),
  polar: (/** @type {any} */ x) => x,
  rect: (/** @type {any} */ x) => x,
  and: (/** @type {any} */ a, /** @type {any} */ b) => (isTruthyValue(a) && isTruthyValue(b) ? 1 : 0),
  or: (/** @type {any} */ a, /** @type {any} */ b) => (isTruthyValue(a) || isTruthyValue(b) ? 1 : 0),
  not: (/** @type {any} */ a) => (isTruthyValue(a) ? 0 : 1),
  // Real Calc's own algebraic names -- confirmed directly against the
  // manual: "the calc-arcsin command or arcsin algebraic function",
  // never "asin". `isDegrees` (this app's own D/R mode flag, degrees
  // being real org's own documented default) converts the input
  // before calling the underlying radians-only Math function, and
  // converts an inverse function's own radians-only result back.
  sin: (/** @type {any} */ x, /** @type {any} */ isDegrees) => Math.sin(isDegrees ? x * DEG_TO_RAD : x),
  cos: (/** @type {any} */ x, /** @type {any} */ isDegrees) => Math.cos(isDegrees ? x * DEG_TO_RAD : x),
  tan: (/** @type {any} */ x, /** @type {any} */ isDegrees) => Math.tan(isDegrees ? x * DEG_TO_RAD : x),
  arcsin: (/** @type {any} */ x, /** @type {any} */ isDegrees) => {
    if (x < -1 || x > 1) throw new Error('arcsin input must be between -1 and 1');
    const radians = Math.asin(x);
    return isDegrees ? radians / DEG_TO_RAD : radians;
  },
  arccos: (/** @type {any} */ x, /** @type {any} */ isDegrees) => {
    if (x < -1 || x > 1) throw new Error('arccos input must be between -1 and 1');
    const radians = Math.acos(x);
    return isDegrees ? radians / DEG_TO_RAD : radians;
  },
  arctan: (/** @type {any} */ x, /** @type {any} */ isDegrees) => {
    const radians = Math.atan(x); // defined for every real x -- no domain restriction to handle
    return isDegrees ? radians / DEG_TO_RAD : radians;
  },
  // Logarithmic/exponential functions -- entirely independent of angle
  // mode. Names and the two-argument log(x, base) form confirmed
  // directly against the Calc manual's own worked example (1024, base
  // 2 -> 10). log(x) with only one argument isn't directly documented
  // for Calc's own algebraic function specifically, but the core
  // Emacs Lisp reference manual's own built-in `log` function --
  // same name, same optional-second-argument shape -- is confirmed
  // directly: "If you don't specify base, the natural base e is
  // used." Defaulting to natural log here matches that closely
  // related, confirmed convention rather than being a pure guess;
  // ln() remains available as an explicit, unambiguous alternative
  // for anyone who wants to be certain which one they're getting.
  ln: (/** @type {any} */ x) => {
    if (x <= 0) throw new Error('ln of a non-positive number has no real result');
    return Math.log(x);
  },
  log10: (/** @type {any} */ x) => {
    if (x <= 0) throw new Error('log10 of a non-positive number has no real result');
    return Math.log10(x);
  },
  exp: (/** @type {any} */ x) => Math.exp(x),
  exp10: (/** @type {any} */ x) => Math.pow(10, x),
  log: (/** @type {any} */ x, /** @type {any} */ base) => {
    if (x <= 0) throw new Error('log of a non-positive number has no real result');
    if (base === undefined) return Math.log(x);
    if (base <= 0 || base === 1) throw new Error('log with an undefined base (must be positive and not 1)');
    return Math.log(x) / Math.log(base);
  },
  // Unit conversion, backed by mathjs's own real Unit system (see this
  // file's own top-of-file import) rather than a hand-rolled lookup
  // table -- covers compound units (m/s, kg/m^3), temperature's own
  // affine conversion (not just a scale factor), and a real, curated
  // unit database. A deliberate, 3-argument form, not real Calc's own
  // 2-argument math-convert-units(value-with-embedded-unit, to-unit):
  // this app's own cells don't carry an embedded unit the way a Calc
  // stack value does, so the source unit is an explicit argument here.
  // Always throws on an incompatible pair (matching every other
  // function in this table -- sqrt, log, arcsin all throw rather than
  // return something misleading) rather than reproducing real Calc's
  // own "leftover remainder units" behavior on a mismatch -- a
  // deliberate scope cut, not an oversight.
  uconv: (/** @type {any} */ value, /** @type {any} */ fromUnit, /** @type {any} */ toUnit) => {
    if (typeof fromUnit !== 'string' || typeof toUnit !== 'string') {
      throw new Error('uconv requires its unit arguments as quoted strings, e.g. uconv($1, "m", "ft")');
    }
    try {
      return mathjsDefault.unit(isMathjsValue(value) ? (value.isFraction ? value.valueOf() : value.toNumber()) : value, fromUnit).toNumber(toUnit);
    } catch (err) {
      throw new Error(`uconv: cannot convert "${fromUnit}" to "${toUnit}" (${err.message})`);
    }
  },
};

/** @param {any} [x] */
function roundHalfAwayFromZero(x) {
  // Math.round rounds -0.5 UP to -0 (toward +Infinity); real Calc's
  // own documented convention is "away from zero" for an exact tie
  // (confirmed directly against the manual: "3.5 R produces 4... -3.5
  // R produces -4"), which disagree on the negative case specifically.
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * @param {any} [x]
 * @param {any} [digits]
 * @param {any} [roundFn]
 */
function roundToDigits(x, digits, roundFn) {
  const d = digits === undefined ? 0 : digits;
  const factor = Math.pow(10, d);
  return roundFn(x * factor) / factor;
}

/** Converts a Y/M/D (+ optional H/Min) into "days since epoch" -- the
 *  internal representation every date-tagged value uses, computed via
 *  Date.UTC to stay independent of the runtime's own local timezone. */
/** Converts a raw string TOKEN (still including its own surrounding
 *  quotes, e.g. `"Both Pass"` or `"She said \"hi\""`) into the actual
 * @param {string} tok
 *  JS string it represents. */
function unescapeStringLiteral(tok) {
  const inner = tok.slice(1, -1);
  return inner.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

/**
 * @param {any} [year]
 * @param {any} [month]
 * @param {any} [day]
 */
function dateToDays(year, month, day, hour = 0, minute = 0) {
  // a month or day past its end rolls over into the next, as Calc's date parser does
  if (hour < 0 || hour > 23) {
    throw new Error(`Invalid date: hour ${hour} is out of range (must be 0-23)`);
  }
  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid date: minute ${minute} is out of range (must be 0-59)`);
  }
  // Calc keeps a time of day as a fraction of a day to six decimals
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000) + Math.round(((hour * 60 + minute) / 1440) * 1e6) / 1e6;
}

/** The inverse of dateToDays -- a date-tagged value's own "days since
 *  epoch" back into its own {year, month, day, hour, minute} fields,
 *  used when formatting a date-tagged result back into an org
 * @param {any} [days]
 *  timestamp string for the cell. */
function daysToDateParts(days) {
  const minutes = Math.floor(days * 1440 + 0.01); // whole minutes, as Calc shows them
  const dayNumber = Math.floor(minutes / 1440);
  const minuteOfDay = minutes - dayNumber * 1440;
  // proleptic Gregorian calendar from day numbers (valid for any year, unlike Date), counting from 1970-01-01
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const month = mp < 10 ? mp + 3 : mp - 9;
  const astronomicalYear = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return {
    year: astronomicalYear <= 0 ? astronomicalYear - 1 : astronomicalYear, // Calc has no year 0: the year before 1 is -1
    month,
    day: doy - Math.floor((153 * mp + 2) / 5) + 1,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    weekday: (((Math.floor(days) + 719163) % 7) + 7) % 7, // Calc day 0 is a Sunday
  };
}

// Deliberately more permissive than real org's own actual timestamp
// syntax: the day-name org normally always writes ("Tue") is here
// fully optional, not just cosmetically ignored -- table cells written
// directly by a person (rather than through this app's own
// timestamp-insertion UI) commonly omit it, and real Calc's own actual
// date parsing accepts both forms too. The day-name group is
// letters-only specifically so it can never accidentally swallow an
// "HH:MM" time token instead (that always contains a colon and
// digits, which [A-Za-z]+ cannot match), letting both be optional
// and correctly disambiguated regardless of which are present.
const CELL_TIMESTAMP_RE = /^[<[]\s*(\d{4})-(\d{2})-(\d{2})(?:\s+[A-Za-z]+)?(?:\s+(\d{1,2}):(\d{2}))?\s*[>\]]$/;

/** Parses `rawText` for a date/time value -- tries this app's own
 *  dedicated org-timestamp parser (parseCellTimestamp) first, since
 *  date-to-time() should reliably handle everything date() already
 *  does (its whole documented purpose is being the MORE flexible of
 *  the two, not a different, non-overlapping one), then falls back to
 *  JS's own built-in Date constructor for the wider variety of
 *  formats real Emacs's own date-to-time (via parse-time-string) is
 *  documented as additionally accepting: ISO 8601, RFC 822/2822 email
 *  headers, common US formats. Trying parseCellTimestamp first isn't
 *  optional -- JS's own Date.parse() cannot be trusted with org's own
 *  bracketed format at all, even as a fallback: it has an
 *  undocumented, non-standard leniency that happens to tolerate stray
 *  characters like "<"/">" around a single, unambiguous date
 *  (confirmed directly: Date.parse("<2026-12-25>") succeeds purely by
 *  that accident), but the exact same leniency breaks completely the
 *  moment a time-of-day is also present in the string
 *  (Date.parse("<2026-09-06 22:47>") is NaN) -- inconsistent,
 *  unintentional behavior, not a real parsing path to rely on.
 *  Returns a date-tagged value ({ type: 'date', days, hasTime: true })
 *  or null if the string isn't parseable at all -- always hasTime:
 *  true regardless of which parser matched, even for a date-only
 *  input, since producing a full time value (not merely a date) is
 * @param {any} [rawText]
 *  this function's whole documented purpose. */
function parseFlexibleDateString(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  const orgTimestamp = parseCellTimestamp(trimmed);
  if (orgTimestamp) return { ...orgTimestamp, hasTime: true };
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  // A string that names its zone (Z, +0100, GMT, UTC) is an absolute instant. One that does not ("01/15/2026", "2026-01-15
  // 10:30") is a wall-clock time, like every org timestamp here, so its fields are kept as written rather than shifted by the
  // machine's zone. (JS reads a bare ISO date as UTC and every other zone-less form as local, hence the two readings.)
  const named = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC|UT|[ECMP][SD]T))\s*$/i.test(trimmed);
  if (named) return { type: 'date', days: ms / 86400000, hasTime: true, absolute: true };
  const when = new Date(ms);
  const dateOnlyIso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const [y, mo, d, h, mi] = dateOnlyIso
    ? [when.getUTCFullYear(), when.getUTCMonth() + 1, when.getUTCDate(), 0, 0]
    : [when.getFullYear(), when.getMonth() + 1, when.getDate(), when.getHours(), when.getMinutes()];
  return { type: 'date', days: dateToDays(y, mo, d, h, mi), hasTime: true };
}

/** Parses `rawText` (a table cell's own raw text) for a recognizable
 *  org timestamp, returning a date-tagged value ({ type: 'date',
 *  days, hasTime }) or null if `rawText` isn't one at all -- this
 *  module's own dedicated parser (see CELL_TIMESTAMP_RE's own docs
 * @param {any} [rawText]
 *  for why a shared one wasn't reused). */
function parseCellTimestamp(rawText) {
  const m = CELL_TIMESTAMP_RE.exec(rawText.trim());
  if (!m) return null;
  const [, y, mo, d, h, min] = m;
  const hasTime = h !== undefined;
  return { type: 'date', days: dateToDays(Number(y), Number(mo), Number(d), hasTime ? Number(h) : 0, hasTime ? Number(min) : 0), hasTime };
}

/** Formats a date-tagged value back into org timestamp text for the
 *  cell -- "<YYYY-MM-DD>" if it never had a time-of-day component
 *  (hasTime false, e.g. from date(Y,M,D) or date()+N on such a
 *  value), "<YYYY-MM-DD HH:MM>" otherwise. Always the active/angle-
 *  bracket form -- there's no way for a formula's own numeric result
 *  to signal "make this inactive" the way the original cell text
 *  might have been, so this is this module's own necessary default,
 * @param {any} [value]
 *  not an attempt to preserve the source cell's own bracket style. */
function formatDateValue(value) {
  const { year, month, day, hour, minute, weekday } = daysToDateParts(value.days);
  // Calc writes years 1 to 99 as +N and other years as they are; Org turns the result into an inactive timestamp only for four-digit years
  const yearText = year > 0 && year < 100 ? `+${year}` : String(year);
  const wide = year >= 1000 && year <= 9999;
  const text = `${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday]}${value.hasTime ? ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : ''}`;
  return wide ? `[${text}]` : `<${text}>`;
}

/** Formats an hms-tagged duration back into Calc's own actual default
 *  HMS notation, "H@ M' S\"" -- confirmed directly against the Calc
 *  manual's own documented format for the HMS type. `value.days` is
 *  the duration's own underlying value (still in DAYS, matching every
 *  other date-tagged value in this module) -- multiplied by 24 here
 *  purely for this specific display, not changing the underlying
 *  value itself (deg() below exposes that raw, still-in-days number
 *  unconverted, which is why the worked timesheet example in this
 *  feature's own request still needs its own explicit "* 24" after
 * @param {any} [value]
 *  deg() to reach decimal HOURS). */
function formatHmsValue(value) {
  const totalHours = value.days * 24;
  const sign = totalHours < 0 ? '-' : '';
  const absHours = Math.abs(totalHours);
  const h = Math.floor(absHours);
  const remainingMinutes = (absHours - h) * 60;
  const m = Math.floor(remainingMinutes);
  const s = Math.round((remainingMinutes - m) * 60);
  return `${sign}${h}@ ${m}' ${s}"`;
}

/** Parses a single reference token (already known to start with "@" or
 *  "$") into a resolvable ref descriptor: { row, col } where each of
 *  row/col is either a parsed ref object (see parseRowRef/parseColRef
 *  above) or null (col is null for a bare "@N" token -- not actually
 *  valid on its own as a real reference, but parseRef doesn't see
 *  that far ahead; row is null for a bare "$N" token, meaning "the
 * @param {string} token
 *  current row", resolved later by the evaluator). */
function parseRef(token) {
  const atMatch = /^@([<>]|[+-]?\d+|I+(?:[+-]\d+)?)(?:\$([<>]|\d+))?$/.exec(token);
  if (atMatch) {
    const row = parseRowRef(atMatch[1]);
    const col = atMatch[2] !== undefined ? parseColRef(atMatch[2]) : null;
    return row ? { row, col } : null;
  }
  const dollarMatch = /^\$([<>]|\d+)$/.exec(token);
  if (dollarMatch) {
    const col = parseColRef(dollarMatch[1]);
    return col ? { row: null, col } : null;
  }
  return null;
}

/** Recursive-descent parser: expr := division (('+'|'-') division)*
 *                             division := term (('/'|'%'|'\\') term)*   (looser than '*', as in Calc)
 *                             term := negation ('*' negation)*
 *                             negation := '-' negation | power   (looser than '^')
 *                             power := unary ('^' negation)?  (right-assoc)
 *                             unary := '!' unary | atom
 *                             atom  := number | ref | range | func '(' args ')' | '(' expr ')'
 *  Builds a plain AST of tagged objects; see evaluateAst for the
 *  actual evaluation. Throws with a position-free but otherwise
 *  descriptive message on any malformed input -- good enough to
 *  surface as a status message, not meant to pinpoint an exact
 * @param {string[]} tokens
 *  column the way a real compiler's own diagnostics would. */
function parseExpression(tokens) {
  let pos = 0;
  function peek() {
    return tokens[pos];
  }
  function next() {
    return tokens[pos++];
  }
  /** @param {string} tok */
  function expect(tok) {
    if (next() !== tok) throw new Error(`Expected "${tok}" in formula`);
  }

  function parseExpr() {
    return parseOr();
  }
  function parseOr() {
    /** @type {any} */ let node = parseAnd();
    while (peek() === '||') {
      next();
      node = { type: 'binop', op: '||', left: node, right: parseAnd() };
    }
    return node;
  }
  function parseAnd() {
    /** @type {any} */ let node = parseComparison();
    while (peek() === '&&') {
      next();
      node = { type: 'binop', op: '&&', left: node, right: parseComparison() };
    }
    return node;
  }
  function parseComparison() {
    /** @type {any} */ let node = parseAdditive();
    let seen = '';
    while (peek() === '==' || peek() === '=' || peek() === '!=' || peek() === '<' || peek() === '>' || peek() === '<=' || peek() === '>=') {
      const op = next();
      // 1 < x < 5 is Calc's interval test, which the symbolic engine reads; a = b = c stays an equation of three sides here
      if (seen && /[<>]/.test(seen + op)) throw new Error('A chain of comparisons is read as Calc algebra');
      seen = op;
      node = { type: 'binop', op: op === '=' ? '==' : op, left: node, right: parseAdditive() };
    }
    return node;
  }
  function parseAdditive() {
    let node = parseDivision();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      node = { type: 'binop', op, left: node, right: parseDivision() };
    }
    return node;
  }
  // As in Calc, "/" and "%" bind more loosely than "*": 14/4*2 is 14/(4*2).
  function parseDivision() {
    let node = parseTerm();
    while (peek() === '/' || peek() === '%' || peek() === '\\') {
      const op = next();
      node = { type: 'binop', op, left: node, right: parseTerm() };
    }
    return node;
  }
  function parseTerm() {
    let node = parseNegation();
    while (peek() === '*') {
      next();
      node = { type: 'binop', op: '*', left: node, right: parseNegation() };
    }
    return node;
  }
  // Unary minus binds more loosely than "^", as in Calc: -2^2 is -4.
  /** @returns {any} */ function parseNegation() {
    if (peek() === '-') {
      next();
      return { type: 'neg', operand: parseNegation() };
    }
    return parsePower();
  }
  /** @returns {any} */ function parsePower() {
    /** @type {any} */ const node = parseUnary();
    if (peek() === '^') {
      next();
      return { type: 'binop', op: '^', left: node, right: parseNegation() }; // right-associative: 2^3^2 = 2^(3^2); 2^-1 is allowed
    }
    return node;
  }
  /** @returns {any} */ function parseUnary() {
    if (peek() === '!') {
      next();
      return { type: 'not', operand: parseUnary() };
    }
    return parseAtom();
  }
  function parseAtom() {
    const tok = peek();
    if (tok === undefined) throw new Error('Unexpected end of formula');
    if (tok === '(') {
      next();
      /** @type {any} */ const node = parseExpr();
      if (peek() === ',') {
        next();
        /** @type {any} */ const imaginary = parseExpr();
        expect(')');
        return { type: 'complexLiteral', re: node, im: imaginary };
      }
      expect(')');
      return node;
    }
    if (tok === '[') {
      next();
      const items = [];
      if (peek() !== ']') {
        items.push(parseExpr());
        while (peek() === ',') {
          next();
          items.push(parseExpr());
        }
      }
      expect(']');
      return { type: 'vectorLiteral', items };
    }
    if (tok.startsWith('"')) {
      next();
      return { type: 'string', value: unescapeStringLiteral(tok) };
    }
    if (/^\d/.test(tok)) {
      next();
      return { type: 'number', value: Number(tok), float: /[.eE]/.test(tok) };
    }
    if (/^[A-Za-z_]/.test(tok)) {
      const rawName = next();
      const name = rawName.toLowerCase();
      if (name === 'pi') return { type: 'number', value: Math.PI, float: true, symbolic: 'pi' };
      if (name === 'e') return { type: 'number', value: Math.E, float: true, symbolic: 'e' };
      if (name === 'i') return { type: 'complexLiteral', re: { type: 'number', value: 0 }, im: { type: 'number', value: 1 } };
      if (name === 'inf') return { type: 'number', value: Infinity };
      if (name === 'date' || name === 'now' || name === 'date-to-time') {
        expect('(');
        const args = [];
        if (peek() !== ')') {
          args.push(parseExpr());
          while (peek() === ',') {
            next();
            args.push(parseExpr());
          }
        }
        expect(')');
        if (name === 'now' && args.length !== 0) throw new Error('"now" takes no arguments');
        if (name === 'date-to-time' && args.length !== 1) throw new Error('"date-to-time" takes exactly one argument');
        if (name === 'date' && args.length !== 1 && args.length !== 3) {
          throw new Error('"date" takes either one cell/timestamp argument or three (year, month, day)');
        }
        return { type: 'dateCall', name, args };
      }
      if (name === 'format-time-string') {
        expect('(');
        /** @type {any} */ const args = [parseExpr()];
        while (peek() === ',') {
          next();
          args.push(parseExpr());
        }
        expect(')');
        if (args.length < 1 || args.length > 3) {
          throw new Error('"format-time-string" takes FORMAT-STRING and up to two optional arguments (TIME, UNIVERSAL)');
        }
        return { type: 'formatTimeCall', args };
      }
      if (name === 'string') {
        expect('(');
        /** @type {any} */ const arg = parseExpr();
        expect(')');
        return { type: 'stringCall', arg };
      }
      if (name === 'if') {
        expect('(');
        /** @type {any} */ const condition = parseExpr();
        expect(',');
        /** @type {any} */ const trueExpr = parseExpr();
        expect(',');
        /** @type {any} */ const falseExpr = parseExpr();
        expect(')');
        return { type: 'ifCall', condition, trueExpr, falseExpr };
      }
      if (userTableFunctionNames.has(name) && !isBuiltinFormulaName(name)) {
        expect('(');
        const userArgs = [];
        if (peek() !== ')') {
          userArgs.push(parseExpr());
          while (peek() === ',') {
            next();
            userArgs.push(parseExpr());
          }
        }
        expect(')');
        if (userArgs.length > 8) throw new Error(`"${name}" takes at most 8 arguments`);
        return { type: 'userCall', name, args: userArgs };
      }
      const isAggregate = name in AGGREGATE_FUNCTIONS;
      const isScalar = name in SCALAR_FUNCTIONS;
      expect('(');
      if (!isAggregate && !isScalar) {
        // Calc leaves a function it does not know as written: `foo(1)` stays `foo(1)`. Only the algebra path can show that.
        const unknownArgs = [];
        if (peek() !== ')') {
          unknownArgs.push(parseExpr());
          while (peek() === ',') {
            next();
            unknownArgs.push(parseExpr());
          }
        }
        expect(')');
        return { type: 'unknownCall', name: rawName, args: unknownArgs };
      }
      if (isAggregate) {
        /** @type {any} */ const arg = parseExpr();
        expect(')');
        return { type: 'call', name, arg };
      }
      // Scalar: most take 1 or 2 comma-separated plain-expression
      // arguments (value, optional decimal-places/base); uconv is the
      // one exception, needing a third (the source unit, since a cell
      // doesn't carry an embedded unit the way a Calc stack value does).
      /** @type {any} */ const args = [parseExpr()];
      while (peek() === ',') {
        next();
        args.push(parseExpr());
      }
      expect(')');
      const maxArgs = name === 'uconv' ? 3 : 2;
      if (args.length > maxArgs) throw new Error(`"${name}" takes at most ${maxArgs} arguments, got ${args.length}`);
      return { type: 'scalarCall', name, args };
    }
    if (tok.startsWith('$')) {
      const constantMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(tok);
      if (constantMatch) {
        next();
        return { type: 'namedConstant', name: constantMatch[1] };
      }
    }
    if (tok.startsWith('@') || tok.startsWith('$')) {
      return parseRangeOrRef();
    }
    throw new Error(`Unexpected token "${tok}" in formula`);
  }
  function parseRangeOrRef() {
    const first = parseRef(next());
    if (!first) throw new Error('Malformed cell reference in formula');
    if (peek() === '..') {
      next();
      const second = parseRef(next());
      if (!second) throw new Error('Malformed cell reference in formula');
      return { type: 'range', from: first, to: second };
    }
    return { type: 'ref', ref: first };
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error('Unexpected trailing content in formula');
  return result;
}

// ---- evaluation ---------------------------------------------------------

/** Reads one resolved (row, col) cell's own current numeric value from
 *  `dataRows` (1-indexed row/col, `dataRows` itself 0-indexed) --
 *  blank/non-numeric cell text is treated as 0, matching real org's
 *  own actual default behavior for arithmetic over non-numeric cells,
 *  rather than propagating NaN through the whole calculation from one
 *  incidental blank or label cell. */
/** True if the resolved (row, col) cell is blank (empty or only
 *  whitespace) -- used by collectRangeValues below to omit blank
 *  cells from a range entirely, matching real org's own actual
 *  default behavior (confirmed directly against the Org Manual:
 *  "Without 'E' empty fields in range references are suppressed so
 *  that the Calc vector... contains only the non-empty fields").
 *  This is genuinely different from readCellNumber's own blank->0
 *  behavior just below -- real org treats a blank cell differently
 *  depending on whether it's a plain, direct reference (0, by
 *  default) or part of a range (omitted, by default). Getting this
 *  distinction right matters beyond just matching the numbers real
 *  Emacs would produce: an org file recalculated in both this app and
 *  real Emacs needs to land on the same result either way, or sharing
 * @param {any} [dataRows]
 * @param {any} [row]
 * @param {any} [col]
 *  a file between them silently produces different numbers. */
function isCellBlank(dataRows, row, col) {
  const text = (dataRows[row - 1] && dataRows[row - 1].cells[col - 1]) || '';
  return text.trim() === '';
}

/** Reads one resolved (row, col) cell's own current numeric value for
 *  a PLAIN, direct reference in ordinary arithmetic (not part of a
 *  range -- see isCellBlank above and collectRangeValues below for
 *  that separate case).
 *
 *  A blank cell's own value depends on `emptyMode` (real org's own E
 *  flag): 'omit' (no flag at all, the default) and 'zero' (E and N
 *  together) both read as 0, matching real org's own documented
 *  default ("'E' is required to NOT convert empty fields to 0");
 *  'nan' (E alone) reads as NaN, confirmed directly against real
 *  Emacs org-mode.
 *
 *  Non-blank text that isn't a valid number depends on `forceNumeric`
 *  (real org's own N flag): 0 when set, matching real org's own
 *  documented "use 0 for non-numbers." Without N, it reads as NaN --
 *  confirmed directly against real Emacs that a non-numeric field is
 *  genuinely NOT silently read as 0 there (real org shows an
 *  unevaluated symbolic expression instead, e.g. "text + 10", which
 *  this app's own narrower engine doesn't reproduce -- but NaN,
 *  unlike a confidently-wrong 0, still visibly propagates into the
 * @param {any} [dataRows]
 * @param {any} [row]
 * @param {any} [col]
 *  result rather than silently misrepresenting the data). */
function readCellNumber(dataRows, row, col, emptyMode = 'omit', forceNumeric = false) {
  const text = (dataRows[row - 1] && dataRows[row - 1].cells[col - 1]) || '';
  const trimmed = text.trim();
  if (trimmed === '') return emptyMode === 'nan' ? NaN : 0;
  const n = Number(trimmed);
  if (!Number.isNaN(n)) return n;
  return forceNumeric ? 0 : NaN;
}

/** Reads one resolved (row, col) cell's own value for use in an
 *  arithmetic expression, duration-aware: under `ctx.durationMode`
 *  (a formula with a T/U/t flag), a cell matching "HH:MM[:SS]" is
 *  read as its own total-seconds value -- confirmed directly against
 *  real Emacs org-mode; anything else (a bare integer, blank, or
 *  non-numeric text) falls through to readCellNumber's own existing
 *  E/N-aware logic, matching real org's own "integers are considered
 *  as seconds in addition and subtraction" rule (a bare integer
 *  already IS the seconds count, no extra conversion needed). Without
 *  durationMode, "HH:MM" isn't recognized as a duration at all --
 *  confirmed directly against real Emacs that the same text is read
 *  as a Calc fraction instead there, a distinction this app's own
 * @param {any} dataRows
 * @param {any} row
 * @param {any} col
 * @param {FormulaCtx} ctx
 *  narrower engine doesn't reproduce either way. */
function readCellValue(dataRows, row, col, ctx) {
  const text = (dataRows[row - 1] && dataRows[row - 1].cells[col - 1]) || '';
  if (ctx.durationMode) {
    const trimmed = text.trim();
    if (trimmed !== '') {
      const seconds = parseDurationSeconds(trimmed);
      if (seconds !== null) return seconds;
    }
  }
  const tagged = parseCellTimestamp(text);
  if (tagged) return tagged;
  if (!ctx.forceNumeric && text.trimStart().startsWith('[')) {
    const vector = parseVectorCell(text, ctx.complexDomain, ctx.angleMode === 'degrees');
    if (vector) return vector;
  }
  if (!ctx.forceNumeric && text.trimStart().startsWith('(')) {
    const complex = parseComplexCell(text, ctx.complexDomain, ctx.angleMode === 'degrees');
    if (complex) return complexResult(complex, ctx);
  }
  const number = readCellNumber(dataRows, row, col, ctx.emptyMode, ctx.forceNumeric);
  if (Number.isNaN(number) && text.trim() !== '' && ctx.probe) ctx.probe.nonNumeric = true; // text that is not a number: Calc reads it as algebra
  return number;
}

/** Expands a { row, col } ref descriptor (row and/or col possibly
 *  null, meaning "the current row"/never valid for col) into an
 *  actual resolved (row, col) pair, given the row this evaluation is
 *  currently centered on. Throws if either half can't be resolved
 *  (out of range, or a column-only ref used somewhere a row is
 * @param {any} [ref]
 * @param {any} [currentRow]
 * @param {any} [dataRowCount]
 * @param {any} [colCount]
 * @param {any} [currentCol]
 * @param {any} [hlinePositions]
 *  required). */
function resolveRef(ref, currentRow, dataRowCount, colCount, currentCol, hlinePositions, asRangeStart = false) {
  const row = ref.row === null ? currentRow : resolveRowRef(ref.row, currentRow, dataRowCount, hlinePositions, asRangeStart);
  const col = resolveColRef(ref.col, colCount, currentCol);
  if (row === null) throw new Error('Row reference out of range in formula');
  if (col === null) throw new Error('Column reference out of range in formula');
  return { row, col };
}

/** True for a mathjs Fraction or BigNumber value -- both instance
 *  types set their own `.isFraction`/`.isBigNumber` tag, the standard
 *  way to type-check a mathjs value without importing its class
 *  constructors just for an instanceof check. Checked first by
 *  isTaggedValue below, since both are otherwise-ordinary objects
 *  that would (wrongly) satisfy its own broader "any non-null
 *  object" test -- every one of isTaggedValue's own 12 call sites
 *  expects date/duration semantics (.days, .type) a mathjs value
 * @param {any} [v]
 *  doesn't have. */
function isMathjsValue(v) {
  return v !== null && typeof v === 'object' && (v.isFraction === true || v.isBigNumber === true);
}

/** True if `v` is a date/hms-tagged value (see this module's own
 * @param {any} [v]
 *  top-level date-arithmetic docs) rather than a plain number. */
function isTaggedValue(v) {
  return v !== null && typeof v === 'object' && !isMathjsValue(v) && v.isComplex !== true && v.isVector !== true;
}

/** Calc's own boolean convention -- a non-zero number is true, zero
 *  is false -- extended here to the two other value types this
 *  module's own formulas can now produce: a non-empty string is
 *  true, empty is false; a date/hms-tagged value is true unless its
 * @param {any} [v]
 *  own underlying day count is exactly zero. */
function isTruthyValue(v) {
  if (isComplex(v) || isVector(v)) return true; // a complex value that survived normalising always has a non-zero part
  if (typeof v === 'string') return v !== '';
  if (isTaggedValue(v)) return v.days !== 0;
  if (isMathjsValue(v)) return (v.isFraction ? v.valueOf() : v.toNumber()) !== 0;
  return v !== 0;
}

/** ==/=/!=/</>/ <=/>= between two already-evaluated values -- a
 *  date/hms-tagged operand is unwrapped to its own raw day count
 *  first, same as this module's own +, -, *, /, and ^ arithmetic already does
 *  (see evaluateDateArithmetic and the plain binop fallback below);
 *  JS's own comparison operators already do the right thing for the
 *  two remaining cases once unwrapped -- numeric comparison between
 *  two numbers, lexicographic between two strings. Always returns 1
 *  or 0 (Calc's own boolean-as-number convention), never a real JS
 *  boolean. */
const COMPARISON_OPS = new Set(['==', '!=', '<', '>', '<=', '>=']);

/**
 * @param {any} l
 * @param {any} r
 * @param {any} op
 * @param {FormulaCtx} ctx
 */
function compareValues(l, r, op, ctx) {
  if (isVector(l) || isVector(r)) {
    if (op !== '==' && op !== '!=') throw new Error('Vectors cannot be ordered');
    const D = ctx.complexDomain;
    const same = vEquals(vectorOperand(l, D), vectorOperand(r, D), D, ctx.angleMode === 'degrees');
    return (op === '==') === same ? 1 : 0;
  }
  if (isComplex(l) || isComplex(r)) {
    if (op !== '==' && op !== '!=') throw new Error('Complex numbers cannot be ordered');
    const D = ctx.complexDomain;
    const same = cEquals(complexOperand(l, D), complexOperand(r, D), D, ctx.angleMode === 'degrees');
    return (op === '==') === same ? 1 : 0;
  }
  if (isMathjsValue(l) || isMathjsValue(r)) {
    const m = ctx.numericMode.instance;
    let result;
    if (op === '==') result = m.equal(l, r);
    else if (op === '!=') result = !m.equal(l, r);
    else if (op === '<') result = m.smaller(l, r);
    else if (op === '>') result = m.larger(l, r);
    else if (op === '<=') result = !m.larger(l, r);
    else if (op === '>=') result = !m.smaller(l, r);
    else throw new Error(`Unknown comparison operator "${op}"`);
    return result ? 1 : 0;
  }
  const lVal = isTaggedValue(l) ? l.days : l;
  const rVal = isTaggedValue(r) ? r.days : r;
  let result;
  if (op === '==') result = lVal === rVal;
  else if (op === '!=') result = lVal !== rVal;
  else if (op === '<') result = lVal < rVal;
  else if (op === '>') result = lVal > rVal;
  else if (op === '<=') result = lVal <= rVal;
  else if (op === '>=') result = lVal >= rVal;
  else throw new Error(`Unknown comparison operator "${op}"`);
  return result ? 1 : 0;
}

/** Handles +/- when at least one operand is a date/hms-tagged value.
 *  date - date: a plain number (days elapsed) if NEITHER side ever
 *  had a time-of-day component, else an hms-tagged duration -- two
 *  moments in time naturally subtract to a SPAN, not another moment,
 *  and whether that span is shown as a bare day count or as an HMS
 *  duration by default depends on whether there was ever a time
 *  component to actually span (see formatFinalValue/formatHmsValue
 *  for where that default display actually happens; deg() is how a
 *  formula un-tags an HMS result back to its own plain, still-in-days
 *  number for further arithmetic). date +/- a plain number, or the
 *  reverse, extends/recedes that date by that many days, staying a
 *  date. Any other tagged/tagged or tagged/plain combination (hms +/-
 *  a plain number, hms +/- hms, date +/- hms) treats the tagged
 *  side's own days as a plain numeric offset, producing whichever
 *  tagged type came from the DATE side if one was involved, else an
 *  hms result -- there's no real Calc precedent for e.g. "hms + hms"
 *  specifically, so this is this module's own reasonable, consistent
 *  extrapolation of the same days-are-the-common-unit model
 * @param {any} [l]
 * @param {any} [r]
 * @param {any} [op]
 *  everything else here uses. */
function evaluateDateArithmetic(l, r, op) {
  const lTagged = isTaggedValue(l);
  const rTagged = isTaggedValue(r);
  if (lTagged && rTagged) {
    if (l.type === 'date' && r.type === 'date' && op === '-') {
      const diff = Math.round((l.days - r.days) * 1e6) / 1e6; // a time of day is kept to 6 decimals
      return diff; // days, a decimal when a time of day is involved
    }
    const combined = op === '+' ? l.days + r.days : l.days - r.days;
    const resultType = l.type === 'date' ? l.type : r.type;
    const hasTime = l.hasTime || r.hasTime;
    return resultType === 'date' ? { type: 'date', days: combined, hasTime } : { type: 'hms', days: combined };
  }
  const tagged = lTagged ? l : r;
  const days = lTagged ? (op === '+' ? tagged.days + r : tagged.days - r) : op === '+' ? l + tagged.days : l - tagged.days;
  return tagged.type === 'date' ? { type: 'date', days, hasTime: tagged.hasTime || !Number.isInteger(days) } : { type: 'hms', days };
}

/** Calc's date(): a date turns into its day number (days since 1 January of year 1, with the time of day as a fraction), and a
 *  day number turns into a date.
 * @param {any} value */
function calcDate(value) {
  const EPOCH_OFFSET = 719163; // 1 Jan 1970 is day 719163 in Calc
  if (isTaggedValue(value) && value.type === 'date') return Number((value.days + EPOCH_OFFSET).toPrecision(12));
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { type: 'date', days: value - EPOCH_OFFSET, hasTime: !Number.isInteger(value) };
  }
  throw new Error('date() needs a date or a day number');
}

/**
 * @param {any} value
 * @param {FormulaCtx} ctx
 */
function wrapNumericLiteral(value, ctx, isFloat = false) {
  if (!ctx.numericMode || typeof value !== 'number' || !Number.isFinite(value)) return value;
  if (ctx.numericMode.kind === 'fraction') return Number.isInteger(value) && !isFloat ? ctx.numericMode.instance.fraction(value) : value; // as in Calc, a number written with decimals stays a float
  const wrapped = ctx.numericMode.instance.bignumber(value);
  return Number.isInteger(value) ? wrapped : wrapped.toSD(ctx.numericMode.instance.config().precision); // Calc reads a number at its working precision
}

const MATHJS_SCALAR_FUNCTION_NAMES = new Set(['sqrt', 'floor', 'ceil', 'round', 'trunc', 'ln', 'log10', 'exp', 'exp10', 'log', 'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan']);

/**
 * @param {string} name
 * @param {any} argValues
 * @param {FormulaCtx} ctx
 */
function evaluateMathjsScalarCall(name, argValues, ctx) {
  const isFractionMode = ctx.numericMode.kind === 'fraction';
  const m = ctx.numericMode.instance;
  // Fraction mode: convert explicitly to BigNumber first (mathjs
  // refuses to implicitly convert Fraction<->BigNumber), compute at
  // mathjsDefault's own default precision (Fraction mode has no
  // configured precision of its own), convert back to a Fraction
  // approximation at the very end -- see this function's own docs
  // above for why this can't be truly exact for most results.
  const x = isFractionMode ? m.bignumber(argValues[0]) : argValues[0];
  const xNum = x.toNumber(); // quick, approximate read for domain/sign checks only
  /** @param {any} [result] */
  const finish = (result) => (isFractionMode ? (result.isInteger() ? m.fraction(result) : result.toNumber()) : result); // a result that is not a whole number is a float, as in Calc

  switch (name) {
    case 'sqrt':
      if (xNum < 0) throw new Error('sqrt of a negative number has no real result');
      return finish(m.sqrt(x));
    case 'ln':
      if (xNum <= 0) throw new Error('ln of a non-positive number has no real result');
      return finish(m.log(x));
    case 'log10':
      if (xNum <= 0) throw new Error('log10 of a non-positive number has no real result');
      return finish(m.log10(x));
    case 'exp':
      return finish(m.exp(x));
    case 'exp10':
      return finish(m.pow(m.bignumber(10), x));
    case 'log': {
      if (xNum <= 0) throw new Error('log of a non-positive number has no real result');
      if (argValues[1] === undefined) return finish(m.log(x));
      const base = isFractionMode ? m.bignumber(argValues[1]) : argValues[1];
      const baseNum = base.toNumber();
      if (baseNum <= 0 || baseNum === 1) throw new Error('log with an undefined base (must be positive and not 1)');
      return finish(m.log(x, base));
    }
    case 'sin':
    case 'cos':
    case 'tan': {
      const isDegrees = ctx.angleMode === 'degrees';
      const radians = isDegrees ? m.divide(m.multiply(x, m.acos(m.bignumber(-1))), 180) : x; // pi at the working precision
      return finish(m[name](radians));
    }
    case 'arcsin':
    case 'arccos': {
      if (xNum < -1 || xNum > 1) throw new Error(`${name} input must be between -1 and 1`);
      const mathjsName = name === 'arcsin' ? 'asin' : 'acos';
      const radians = m[mathjsName](x);
      return finish(ctx.angleMode === 'degrees' ? m.divide(m.multiply(radians, 180), m.acos(m.bignumber(-1))) : radians);
    }
    case 'arctan': {
      const radians = m.atan(x);
      return finish(ctx.angleMode === 'degrees' ? m.divide(m.multiply(radians, 180), m.acos(m.bignumber(-1))) : radians);
    }
    case 'floor':
    case 'ceil':
    case 'round': {
      const digits = isFractionMode && argValues[1] !== undefined ? m.bignumber(argValues[1]) : argValues[1];
      return finish(digits === undefined ? m[name](x) : m[name](x, digits));
    }
    case 'trunc': {
      const digits = isFractionMode && argValues[1] !== undefined ? m.bignumber(argValues[1]) : argValues[1];
      return finish(digits === undefined ? m.fix(x) : m.fix(x, digits));
    }
    default:
      throw new Error(`"${name}" has no mathjs-routed implementation`);
  }
}

// ---- complex support (see calc-complex.js) -----------------------------------------------------------------------

/**
 * @param {any} [v]
 * @param {any} [D]
 */
function complexOperand(v, D) {
  if (isComplex(v)) return v;
  if (typeof v === 'string' || isTaggedValue(v)) throw new Error('A complex operation needs numbers');
  return toReal(v, D);
}

/**
 * A complex module result as the engine's own value: a real becomes a number (or the pN / F value), a complex stays.
 * @param {any} result
 * @param {FormulaCtx} ctx
 */
function complexResult(result, ctx) {
  return isReal(result) ? realToEngine(result, ctx.complexDomain, ctx.numericMode) : result;
}

/** @param {any} [v] */
function realNumberOf(v) {
  if (typeof v === 'number') return v;
  if (isMathjsValue(v)) return v.isFraction ? v.valueOf() : v.toNumber();
  return null;
}

/**
 * @param {any} op
 * @param {any} l
 * @param {any} r
 * @param {FormulaCtx} ctx
 */
function complexBinop(op, l, r, ctx) {
  const D = ctx.complexDomain;
  const degrees = ctx.angleMode === 'degrees';
  const a = complexOperand(l, D);
  const b = complexOperand(r, D);
  if (op === '+') return complexResult(cAdd(a, b, D, degrees), ctx);
  if (op === '-') return complexResult(cSub(a, b, D, degrees), ctx);
  if (op === '*') return complexResult(cMul(a, b, D, degrees), ctx);
  if (op === '/') return complexResult(cDiv(a, b, D, degrees), ctx);
  if (op === '^') return complexResult(cPow(a, b, D, degrees), ctx);
  throw new Error(`Unknown operator "${op}"`);
}

/**
 * @param {any} [v]
 * @param {any} [D]
 */
function vectorOperand(v, D) {
  if (isVector(v) || isComplex(v)) return v;
  if (typeof v === 'string' || isTaggedValue(v)) throw new Error('A vector operation needs numbers');
  return toReal(v, D);
}

/**
 * A vector operation's result: a vector stays, a Real becomes the engine's number, a Complex stays.
 * @param {any} result
 * @param {FormulaCtx} ctx
 */
function vectorResult(result, ctx) {
  return isVector(result) ? result : complexResult(result, ctx);
}

/**
 * @param {any} op
 * @param {any} l
 * @param {any} r
 * @param {FormulaCtx} ctx
 */
function vectorBinop(op, l, r, ctx) {
  const D = ctx.complexDomain;
  return vectorResult(vBinop(op, vectorOperand(l, D), vectorOperand(r, D), D, ctx.angleMode === 'degrees'), ctx);
}

const VECTOR_FUNCTIONS = new Set(['det', 'inv', 'trn', 'tr', 'cross', 'vlen']);

/**
 * det/inv/trn/tr/cross/vlen, and abs of a vector. Returns undefined for anything else.
 * @param {string} name
 * @param {any} argValues
 * @param {FormulaCtx} ctx
 */
function vectorScalarCall(name, argValues, ctx) {
  const anyVector = argValues.some(isVector);
  if (!VECTOR_FUNCTIONS.has(name) && !anyVector) return undefined;
  const D = ctx.complexDomain;
  const degrees = ctx.angleMode === 'degrees';
  const a = argValues[0];
  switch (name) {
    case 'det': return vectorResult(vDet(a, D, degrees), ctx);
    case 'inv': return vectorResult(vInv(a, D, degrees), ctx);
    case 'trn': return vectorResult(vTrn(a), ctx);
    case 'tr': return vectorResult(vTrace(a, D, degrees), ctx);
    case 'cross': return vectorResult(vCross(a, argValues[1], D, degrees), ctx);
    case 'vlen': return vLength(a);
    case 'abs': return vectorResult(vAbs(a, D, degrees), ctx);
    default: throw new Error(`${name} does not take a vector`);
  }
}

/**
 * Expands vectors in a list of engine values into their elements, as engine values.
 * @param {any} values
 * @param {FormulaCtx} ctx
 */
function flattenForAggregate(values, ctx) {
  return values.flatMap((/** @type {any} */ v) => (isVector(v) ? flattenVector(v).map((/** @type {any} */ x) => complexResult(x, ctx)) : [v]));
}

const COMPLEX_ALWAYS = new Set(['re', 'im', 'conj', 'arg', 'polar', 'rect']);

/** A scalar function call that needs the complex route: a complex argument, or a real one outside the real function's
 * @param {string} name
 * @param {any} argValues
 * @param {FormulaCtx} ctx
 *  domain (sqrt of a negative, ln of a negative, arcsin of 2). Returns undefined when the ordinary real code applies. */
function complexScalarCall(name, argValues, ctx) {
  const first = argValues[0];
  const complexArg = isComplex(first);
  let needed = complexArg || COMPLEX_ALWAYS.has(name);
  if (!needed) {
    const x = realNumberOf(first);
    if (x === null) return undefined;
    if (name === 'sqrt' && x < 0) needed = true;
    else if ((name === 'ln' || name === 'log10') && x < 0) needed = true;
    else if (name === 'log' && (x < 0 || (argValues[1] !== undefined && realNumberOf(argValues[1]) < 0))) needed = true;
    else if ((name === 'arcsin' || name === 'arccos') && (x < -1 || x > 1)) needed = true;
  }
  if (!needed) return undefined;
  const D = ctx.complexDomain;
  const degrees = ctx.angleMode === 'degrees';
  const z = complexOperand(first, D);
  let result;
  switch (name) {
    case 'abs': result = cAbs(z, D, degrees); break;
    case 're': result = cRe(z, D, degrees); break;
    case 'im': result = cIm(z, D, degrees); break;
    case 'conj': result = cConj(z, D, degrees); break;
    case 'arg': result = cArg(z, D, degrees); break;
    case 'polar': result = cToPolar(z, D, degrees); break;
    case 'rect': result = cToRect(z, D, degrees); break;
    case 'sqrt': result = cSqrt(z, D, degrees); break;
    case 'exp': result = cExp(z, D, degrees); break;
    case 'ln': result = cLn(z, D, degrees); break;
    case 'log10': result = cLog10(z, D, degrees); break;
    case 'log': result = argValues[1] === undefined ? cLn(z, D, degrees) : cLog(z, complexOperand(argValues[1], D), D, degrees); break;
    case 'sin': result = cSin(z, D, degrees); break;
    case 'cos': result = cCos(z, D, degrees); break;
    case 'tan': result = cTan(z, D, degrees); break;
    case 'arcsin': result = cAsin(z, D, degrees); break;
    case 'arccos': result = cAcos(z, D, degrees); break;
    case 'arctan': result = cAtan(z, D, degrees); break;
    default: throw new Error(`${name} does not take a complex number`);
  }
  return complexResult(result, ctx);
}

/**
 * @param {any} node
 * @param {FormulaCtx} ctx
 */
/** @returns {any} */ function evaluateAst(/** @type {any} */ node, /** @type {any} */ ctx) {
  switch (node.type) {
    case 'number':
      return wrapNumericLiteral(node.value, ctx, node.float === true);
    case 'string':
      return node.value;
    case 'vectorLiteral': {
      const D = ctx.complexDomain;
      return makeVector(node.items.map((/** @type {any} */ item) => vectorOperand(evaluateAst(item, ctx), D)));
    }
    case 'complexLiteral': {
      const D = ctx.complexDomain;
      /** @type {any} */ const re = evaluateAst(node.re, ctx);
      /** @type {any} */ const im = evaluateAst(node.im, ctx);
      if (isComplex(re) || isComplex(im) || typeof re === 'string' || typeof im === 'string') throw new Error('A complex number\u2019s parts must be real numbers');
      return complexResult(makeRect(toReal(re, D), toReal(im, D), D, ctx.angleMode === 'degrees'), ctx);
    }
    case 'neg': {
      /** @type {any} */ const operand = evaluateAst(node.operand, ctx);
      if (isVector(operand)) return vNeg(operand, ctx.complexDomain, ctx.angleMode === 'degrees');
      if (isComplex(operand)) return complexResult(cNeg(operand, ctx.complexDomain, ctx.angleMode === 'degrees'), ctx);
      return isMathjsValue(operand) ? ctx.numericMode.instance.unaryMinus(operand) : -operand;
    }
    case 'not':
      return isTruthyValue(evaluateAst(node.operand, ctx)) ? 0 : 1;
    case 'binop': {
      if (node.op === '&&') {
        const l = evaluateAst(node.left, ctx);
        if (!isTruthyValue(l)) return 0;
        return isTruthyValue(evaluateAst(node.right, ctx)) ? 1 : 0;
      }
      if (node.op === '||') {
        const l = evaluateAst(node.left, ctx);
        if (isTruthyValue(l)) return 1;
        return isTruthyValue(evaluateAst(node.right, ctx)) ? 1 : 0;
      }
      let l = evaluateAst(node.left, ctx);
      let r = evaluateAst(node.right, ctx);
      if (COMPARISON_OPS.has(node.op)) return compareValues(l, r, node.op, ctx);
      if (isVector(l) || isVector(r)) return vectorBinop(node.op, l, r, ctx);
      if (isComplex(l) || isComplex(r)) return complexBinop(node.op, l, r, ctx);
      if (node.op === '^') {
        const base = realNumberOf(l);
        const exponent = realNumberOf(r);
        if (base !== null && exponent !== null && base < 0 && !Number.isInteger(exponent)) return complexBinop('^', l, r, ctx);
      }
      if ((node.op === '+' || node.op === '-') && (isTaggedValue(l) || isTaggedValue(r))) {
        return evaluateDateArithmetic(l, r, node.op);
      }
      if (ctx.numericMode && ctx.numericMode.kind === 'fraction' && (isMathjsValue(l) || isMathjsValue(r)) && ((typeof l === 'number' && !Number.isInteger(l)) || (typeof r === 'number' && !Number.isInteger(r)))) {
        l = isMathjsValue(l) ? l.valueOf() : l; // a float among the fractions makes the result a float
        r = isMathjsValue(r) ? r.valueOf() : r;
      }
      if (isMathjsValue(l) || isMathjsValue(r)) {
        const m = ctx.numericMode.instance;
        if (node.op === '+') return m.add(l, r);
        if (node.op === '-') return m.subtract(l, r);
        if (node.op === '*') return m.multiply(l, r);
        if (node.op === '/') {
          if (m.equal(r, 0)) throw new DivisionByZero(node, l);
          return m.divide(l, r);
        }
        if (node.op === '%') {
          if (m.equal(r, 0)) throw new DivisionByZero(node, l);
          return m.mod(l, r);
        }
        if (node.op === '\\') {
          if (m.equal(r, 0)) throw new DivisionByZero(node, l);
          return m.floor(m.divide(l, r));
        }
        if (node.op === '^') return m.pow(l, r);
        throw new Error(`Unknown operator "${node.op}"`);
      }
      const exact = exactIntegerBinop(node.op, l, r);
      if (exact !== undefined) return exact;
      const lNum = isTaggedValue(l) ? l.days : typeof l === 'bigint' ? Number(l) : l;
      const rNum = isTaggedValue(r) ? r.days : typeof r === 'bigint' ? Number(r) : r;
      // Calc works to 12 digits, so a float result is rounded there: 739631.354167 - 739631 is exactly 0.354167.
      const twelve = (/** @type {number} */ x) => (Number.isFinite(x) && !Number.isInteger(x) ? Number(x.toPrecision(12)) : x);
      // A sum or difference of decimals is exact in Calc, so keep the decimal places of the more precise operand.
      const places = (/** @type {number} */ x) => (Number.isInteger(x) || !Number.isFinite(x) || /e/.test(x.toPrecision(12)) ? 0 : (x.toPrecision(12).split('.')[1] || '').replace(/0+$/, '').length);
      const exactSum = (/** @type {number} */ x) => (Number.isFinite(x) && !Number.isInteger(x) && Math.max(places(lNum), places(rNum)) <= 20 ? Number(x.toFixed(Math.max(places(lNum), places(rNum)))) : x);
      if (node.op === '+') return twelve(exactSum(lNum + rNum));
      if (node.op === '-') return twelve(exactSum(lNum - rNum));
      if (node.op === '*') return twelve(lNum * rNum);
      if (node.op === '/') {
        if (rNum === 0) throw new DivisionByZero(node, lNum);
        return twelve(lNum / rNum);
      }
      if (node.op === '%') {
        if (rNum === 0) throw new DivisionByZero(node, lNum);
        return twelve(lNum - rNum * Math.floor(lNum / rNum)); // Calc's mod takes the sign of the divisor
      }
      if (node.op === '\\') {
        if (rNum === 0) throw new DivisionByZero(node, lNum);
        return Math.floor(lNum / rNum); // Calc's integer division rounds down
      }
      if (node.op === '^') return twelve(Math.pow(lNum, rNum));
      throw new Error(`Unknown operator "${node.op}"`);
    }
    case 'ref': {
      const { row, col } = resolveRef(node.ref, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions);
      return wrapNumericLiteral(readCellValue(ctx.dataRows, row, col, ctx), ctx, cellTextIsFloat(ctx.dataRows, row, col));
    }
    case 'namedConstant': {
      const value = (ctx.constants || {})[node.name];
      if (value === undefined) throw new Error(`Undefined constant "$${node.name}" -- add it to a #+CONSTANTS: line`);
      return value;
    }
    case 'range': {
      // a range is a flat vector of its non-blank cells, in reading order, as in org
      const D = ctx.complexDomain;
      return makeVector(collectRangeValues(node, ctx).map((/** @type {any} */ v) => vectorOperand(v, D)));
    }
    case 'call': {
      const fn = /** @type {any} */ (AGGREGATE_FUNCTIONS)[node.name];
      /** @type {any} */ let values = collectRangeValues(node.arg, ctx);
      values = values.map((/** @type {any} */ v) => (typeof v === 'bigint' ? Number(v) : v));
      if (values.some(isVector)) values = flattenForAggregate(values, ctx);
      if (values.some(isComplex)) return complexResult(cAggregate(node.name, values, ctx.complexDomain, ctx.angleMode === 'degrees'), ctx);
      return fn(values);
    }
    case 'userCall': {
      if (!ctx.userCall) throw new Error(`"${node.name}" is a script function and is not available here`);
      /** @param {any} [v] */
      /** @returns {any} */ const plainArg = (/** @type {any} */ v) => (isVector(v) ? Array.from(v.items || v).map(plainArg) : typeof v === 'string' || typeof v === 'number' ? v : Number(v));
      return ctx.userCall(node.name, node.args.map((/** @type {any} */ a) => plainArg(evaluateAst(a, ctx))));
    }
    case 'scalarCall': {
      const fn = /** @type {any} */ (SCALAR_FUNCTIONS)[node.name];
      const argValues = node.args.map((/** @type {any} */ a) => { const v = evaluateAst(a, ctx); return typeof v === 'bigint' ? Number(v) : v; });
      const vectorOutcome = vectorScalarCall(node.name, argValues, ctx);
      if (vectorOutcome !== undefined) return vectorOutcome;
      const complexOutcome = complexScalarCall(node.name, argValues, ctx);
      if (complexOutcome !== undefined) return complexOutcome;
      if (ctx.numericMode && isMathjsValue(argValues[0]) && MATHJS_SCALAR_FUNCTION_NAMES.has(node.name)) {
        return evaluateMathjsScalarCall(node.name, argValues, ctx);
      }
      if (TRIG_FUNCTION_NAMES.has(node.name)) return fn(argValues[0], ctx.angleMode === 'degrees');
      return fn(...argValues);
    }
    case 'lispCall': {
      const fn = /** @type {any} */ (LISP_CALL_FUNCTIONS)[node.name];
      const argValues = node.args.map((/** @type {any} */ a) => evaluateAst(a, ctx));
      return fn(...argValues);
    }
    case 'dateCall': {
      if (node.name === 'now') {
        const now = ctx.now || new Date();
        return { type: 'date', days: dateToDays(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()), hasTime: true };
      }
      if (node.args.length === 3) {
        /** @type {any} */ const year = evaluateAst(node.args[0], ctx);
        /** @type {any} */ const month = evaluateAst(node.args[1], ctx);
        /** @type {any} */ const day = evaluateAst(node.args[2], ctx);
        if (typeof year !== 'number' || typeof month !== 'number' || typeof day !== 'number' || month < 1 || month > 12 || day < 1) throw new Error(`Invalid date: ${year}-${month}-${day}`); // Calc leaves date() with such arguments unevaluated
        return { type: 'date', days: Date.UTC(year, month - 1, day) / 86400000, hasTime: false }; // as in Calc, a day past the month's end rolls into the next
      }
      const argNode = node.args[0];
      let rawText;
      if (argNode.type === 'ref') {
        const { row, col } = resolveRef(argNode.ref, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions);
        rawText = (ctx.dataRows[row - 1] && ctx.dataRows[row - 1].cells[col - 1]) || '';
      } else {
        /** @type {any} */ const val = evaluateAst(argNode, ctx);
        if (node.name === 'date') return calcDate(val);
        if (isTaggedValue(val) && val.type === 'date') return val;
        rawText = String(val);
      }
      if (node.name === 'date') {
        const stamp = parseCellTimestamp(rawText);
        if (stamp) return calcDate(stamp);
        const number = Number(rawText.trim());
        if (rawText.trim() !== '' && !Number.isNaN(number)) return calcDate(number);
        throw new Error(`date(): "${rawText.trim()}" is not a date or a day number`);
      }
      if (node.name === 'date-to-time') {
        const parsed = parseFlexibleDateString(rawText);
        if (!parsed) throw new Error(`date-to-time(): couldn\u2019t parse "${rawText.trim()}" as a date/time`);
        return parsed;
      }
      const parsed = parseCellTimestamp(rawText);
      if (!parsed) throw new Error(`date(): couldn\u2019t find a recognizable timestamp in "${rawText.trim()}"`);
      return parsed;
    }
    case 'formatTimeCall': {
      /** @type {any} */ const formatVal = evaluateAst(node.args[0], ctx);
      /** @type {any} */ const formatStr = typeof formatVal === 'string' ? formatVal : String(formatVal);

      let instant;
      if (node.args.length < 2) {
        instant = ctx.now || new Date();
      } else {
        /** @type {any} */ const timeVal = evaluateAst(node.args[1], ctx);
        if (isTaggedValue(timeVal) && timeVal.absolute) {
          instant = new Date(timeVal.days * 86400000); // an instant that named its zone
        } else if (isTaggedValue(timeVal)) {
          // A wall-clock time (a cell timestamp, now(), a zone-less string): this machine's own zone applies to it, so the
          // fields printed are the fields written, not shifted by the zone's offset.
          const p = daysToDateParts(timeVal.days);
          instant = new Date(p.year, p.month - 1, p.day, p.hour, p.minute);
        } else {
          // Real Emacs's own documented convention: a plain number here
          // is an integer count of seconds since the Unix epoch, not days.
          instant = new Date(timeVal * 1000);
        }
      }

      /** @type {any} */ const universal = node.args.length >= 3 && isTruthyValue(evaluateAst(node.args[2], ctx));
      return formatTimeString(instant, formatStr, { utc: !!universal });
    }
    case 'stringCall': {
      if (node.arg.type === 'ref') {
        const { row, col } = resolveRef(node.arg.ref, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions);
        const rawText = (ctx.dataRows[row - 1] && ctx.dataRows[row - 1].cells[col - 1]) || '';
        return rawText.trim();
      }
      /** @type {any} */ const val = evaluateAst(node.arg, ctx);
      if (typeof val === 'string') return val;
      if (isTaggedValue(val)) return val.type === 'date' ? formatDateValue(val) : formatHmsValue(val);
      return String(val);
    }
    case 'ifCall':
      return isTruthyValue(evaluateAst(node.condition, ctx)) ? evaluateAst(node.trueExpr, ctx) : evaluateAst(node.falseExpr, ctx);
    default:
      throw new Error(`Unknown AST node type "${node.type}"`);
  }
}

/** Collects every value a range (or, degenerately, a single ref) spans
 *  -- an aggregate function's own argument, evaluated as a list of
 *  numbers rather than a single one. Iterates in reading order (row
 *  by row, left to right within each row), matching how a person
 * @param {any} argNode
 * @param {FormulaCtx} ctx
 *  would naturally read the range they wrote. */
/** @returns {any} */ function collectRangeValues(/** @type {any} */ argNode, /** @type {any} */ ctx) {
  if (argNode.type === 'ref') {
    const { row, col } = resolveRef(argNode.ref, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions);
    if (isCellBlank(ctx.dataRows, row, col) && ctx.emptyMode === 'omit') return [];
    return [readCellValue(ctx.dataRows, row, col, ctx)];
  }
  if (argNode.type !== 'range') {
    // A plain arithmetic expression as an aggregate's own argument (e.g. vsum($1+$2)) --
    // real org supports this too; evaluate it as one single value.
    return [evaluateAst(argNode, ctx)];
  }
  const from = resolveRef(argNode.from, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions, true);
  const to = resolveRef(argNode.to, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions, false);
  const rowStart = Math.min(from.row, to.row);
  const rowEnd = Math.max(from.row, to.row);
  const colStart = Math.min(from.col, to.col);
  const colEnd = Math.max(from.col, to.col);
  const values = [];
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      if (isCellBlank(ctx.dataRows, r, c) && ctx.emptyMode === 'omit') continue;
      values.push(readCellValue(ctx.dataRows, r, c, ctx));
    }
  }
  return values;
}

/** Formats a computed numeric result back into cell text -- an
 *  integer stays a bare integer ("4", not "4.0" or
 *  "4.000000000000000"). A non-integer is formatted to 8 significant
 *  figures, matching real org's own actual, documented default
 *  exactly (confirmed directly against the Org Manual: Calc's own
 *  "(float 8)" display mode -- "the display format... has been
 *  changed to '(float 8)' to keep tables compact"), not an
 *  arbitrarily-chosen precision. Getting this specific number right
 *  matters beyond cosmetics: recalculating the identical formula
 *  against identical data in org-pwa and in real Emacs needs to write
 *  the same text into the cell either way, or a table shared between
 *  the two silently diverges depending on whichever one last touched
 *  it -- confirmed as a real, concrete case this replaces: this
 *  function previously rounded to 6 digits *after the decimal point*
 *  regardless of magnitude (a different rule from "8 significant
 *  figures total", not merely a different number -- the two rules
 *  only happen to coincide for results roughly between 1 and 10),
 *  which wrote "123.333333" for 370/3 where real org's own actual
 *  default writes "123.33333".
 *
 *  Real org's own optional mode string (";%.2f", ";T", ";EN", etc.)
 *  IS now implemented -- see parseModeString/applyFormatSpec below --
 *  this default is only ever used when a formula has no format flag
 *  of its own. */

const MODE_TOKEN_RE = /%0?\.(\d+)f|%d|%\.(\d+)[eg]|%[eg]|p\d+|n(\d+)|s(\d+)|e(\d+)|f(\d+)|[TtUENFSDR]/y;

/** Parses a formula's own trailing mode string (everything after the
 *  ";", already split off by parseFormulaStatement below) into a
 *  single object covering every flag documented for real org table
 *  formulas: { format, duration, emptyMode }.
 *
 *  format: { type: 'fixed'|'integer'|'normal'|'scientific'|'engineering', digits } | null
 *    - %.Nf / fN -> fixed, N decimal places
 *    - %d        -> integer (truncated toward zero)
 *    - nN        -> normal, N significant figures
 *    - sN        -> scientific, N significant figures
 *    - eN        -> engineering, N significant figures
 *  duration: 'T' | 'U' | 't' | null
 *    - T -> HH:MM:SS   U -> HH:MM   t -> fractional hours
 *    - Overrides `format` entirely when present -- a duration result
 *      is never also shown in scientific/fixed/etc notation.
 *  emptyMode: 'omit' (default) | 'nan' (E) | 'zero' (E and N together)
 *  fraction: whether F (Fraction Mode) was present -- overrides
 *    `format`/`duration` entirely when set, same "last flag standing"
 *    precedence duration already has over format above, since a
 *    fraction result is never also shown in scientific/fixed/etc
 *    notation either. Reconstructed from the computed floating-point
 *    result via a continued-fraction approximation (see
 *    formatAsFraction below) -- this app's own arithmetic doesn't
 *    carry true rational values through every operation the way real
 *    Calc's own internal representation does, but for the common case
 *    (an expression that -- mathematically, not just by coincidence
 *    of this app's own rounding -- reduces to a clean fraction) this
 *    recovers the exact same result.
 *  mixedNumber: whether S was ALSO present alongside F, requesting a
 *    mixed-number display (whole number + proper fraction, e.g.
 *    "3 + 1/2") for an improper fraction, real org's own documented
 *    F+S combination. S alone, without F, is recognized and consumed
 *    but has no effect on its own -- this app doesn't implement
 *    Calc's own general Symbolic mode, only this specific, documented
 *    combination with Fraction mode.
 *  angleMode: 'degrees' (default) | 'radians' (R) -- which unit the six
 *    trig functions (sin/cos/tan/arcsin/arccos/arctan) interpret/
 *    produce angles in. Degrees is real Calc's own documented default
 *    for org table formulas specifically (confirmed directly against
 *    the Org Manual, not assumed -- Calc's own general default varies
 *    by context, but org's own is always degrees unless R is given),
 *    so a formula with neither D nor R behaves exactly as it would in
 *    real org-mode. D is recognized and consumed for completeness
 *    (real org accepts it explicitly even though it's already the
 *    default) but has no additional effect beyond confirming degrees.
 *
 *  pN (precision) is recognized and consumed but has no further
 *  effect -- this engine's own numbers already carry more precision
 *  than Calc's own default, and p alone doesn't change the display
 *  format in real org either.
 *
 *  Flags can appear concatenated with no separator (e.g. "EN"), in
 *  any order; an unrecognized remaining character stops parsing
 *  there, falling back to whatever was already parsed rather than
 * @param {string} suffix
 *  discarding the whole mode string. */
function parseModeString(suffix) {
  const mode = /** @type {any} */ ({ format: null, duration: null, emptyMode: 'omit', forceNumeric: false, fraction: false, mixedNumber: false, angleMode: 'degrees', precision: null });
  MODE_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = MODE_TOKEN_RE.exec(suffix))) {
    const token = m[0];
    if (m[1] !== undefined) mode.format = { type: 'fixed', digits: Number(m[1]), printf: true }; // %.Nf
    else if (token.startsWith('%') && /[eg]$/.test(token)) mode.format = { type: 'exponential', printf: true, conversion: token.slice(-1), digits: m[2] === undefined ? undefined : Number(m[2]) }; // %e %g %.Ne %.Ng
    else if (token === '%d') mode.format = { type: 'integer' };
    else if (token.startsWith('p')) mode.precision = Number(token.slice(1));
    else if (m[3] !== undefined) mode.format = { type: 'normal', digits: Number(m[3]) };
    else if (m[4] !== undefined) mode.format = { type: 'scientific', digits: Number(m[4]) };
    else if (m[5] !== undefined) mode.format = { type: 'engineering', digits: Number(m[5]) };
    else if (m[6] !== undefined) mode.format = { type: 'fixed', digits: Number(m[6]) }; // fN
    else if (token === 'T' || token === 't' || token === 'U') mode.duration = token;
    else if (token === 'E') mode.emptyMode = 'nan';
    else if (token === 'N') mode.forceNumeric = true;
    else if (token === 'F') mode.fraction = true;
    else if (token === 'S') mode.mixedNumber = true;
    else if (token === 'R') mode.angleMode = 'radians';
    else if (token === 'D') mode.angleMode = 'degrees'; // already the default -- consumed for completeness, matching real org accepting it explicitly
  }
  if (mode.forceNumeric && mode.emptyMode === 'nan') mode.emptyMode = 'zero'; // E and N together: blank fields are 0, not nan
  return mode;
}

/** Parses "HH:MM[:SS]" (an optional leading "-" for a negative
 *  duration) into total seconds, or null if `text` doesn't match --
 *  real org's own input form for a duration-mode formula (T/U/t).
 *  Only recognized when a formula actually has one of those flags;
 *  without one, the same text isn't treated as a duration at all
 *  (matching real org, where "H:MM" without a duration flag is read
 *  as a Calc fraction instead, a distinction this app doesn't
 * @param {string} text
 *  reproduce -- see readCellValue's own docs). */
function parseDurationSeconds(text) {
  const m = /^(-)?(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(text.trim());
  if (!m) return null;
  const sign = m[1] ? -1 : 1;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  const seconds = m[4] !== undefined ? Number(m[4]) : 0;
  return sign * (hours * 3600 + minutes * 60 + seconds);
}

/** Formats a total-seconds value for a duration-mode formula's own
 *  result, per its `duration` flag -- confirmed directly against real
 *  Emacs org-mode's own org-table-recalculate in batch mode for all
 *  three flags. `hourZeroPad` mirrors org-table-duration-hour-zero-
 *  padding: true (the default) pads the hours field to at least 2
 *  digits; false leaves it at its own natural width. Minutes and
 * @param {any} [totalSeconds]
 * @param {any} [flag]
 * @param {any} [hourZeroPad]
 *  seconds are always 2-digit zero-padded regardless. */
function formatDuration(totalSeconds, flag, hourZeroPad) {
  if (Number.isNaN(totalSeconds)) return 'nan';
  if (!Number.isFinite(totalSeconds)) return totalSeconds > 0 ? 'inf' : '-inf'; // an infinite duration has no sensible HH:MM:SS representation
  const sign = totalSeconds < 0 ? '-' : '';
  const abs = Math.round(Math.abs(totalSeconds));
  if (flag === 't') {
    // org-table-duration-custom-format's own default: fractional hours, 2 decimal places.
    return (totalSeconds / 3600).toFixed(2);
  }
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  const hoursStr = hourZeroPad ? String(hours).padStart(2, '0') : String(hours);
  const minutesStr = String(minutes).padStart(2, '0');
  if (flag === 'U') return `${sign}${hoursStr}:${minutesStr}`;
  const secondsStr = String(seconds).padStart(2, '0');
  return `${sign}${hoursStr}:${minutesStr}:${secondsStr}`;
}

/** A port of Calc's own float formatter (math-format-number in calc.el), so a number shows exactly as it does in Emacs.
 *  `fmt` is 'float' (the n flag), 'fix' (f), 'sci' (s) or 'eng' (e); `figs` is the flag's number; `prec` is Calc's internal
 *  precision (12, or the p flag). Calc keeps a float as an integer mantissa and a power of ten.
 * @param {any} value a number, or a mathjs BigNumber when the p flag asks for more digits than a double holds
 * @param {'float' | 'fix' | 'sci' | 'eng'} fmt
 * @param {number} figs
 * @param {number} [prec]
 * @returns {string} */
function calcFloatString(value, fmt, figs, prec = 12) {
  const big = typeof value !== 'number';
  if (big ? value.isNaN() : Number.isNaN(value)) return 'nan';
  if (big ? !value.isFinite() : !Number.isFinite(value)) return (big ? value.isNegative() : value < 0) ? '-inf' : 'inf';
  if (big ? value.isNegative() && !value.isZero() : value < 0) return `-${calcFloatString(big ? value.abs() : -value, fmt, figs, prec)}`;
  const SCI_HIGH = 0; // calc-display-sci-high
  const SCI_LOW = -3; // calc-display-sci-low
  // Round to the internal precision, then drop trailing zeros, as Calc's float normalization does.
  const [digitText, exponentText] = value.toExponential((big ? prec : Math.min(prec, 17)) - 1).split('e');
  let mant = BigInt(digitText.replace('.', ''));
  let exp = Number(exponentText) - (digitText.length - 2);
  while (mant !== 0n && mant % 10n === 0n) {
    mant /= 10n;
    exp += 1;
  }
  if (mant === 0n) exp = 0;
  /** @param {bigint} m @param {number} k */
  const scaleRounding = (m, k) => {
    if (k >= 0) return m * 10n ** BigInt(k);
    const divisor = 10n ** BigInt(-k);
    return (m + divisor / 2n) / divisor;
  };
  const numdigs = (/** @type {bigint} */ m) => (m === 0n ? 1 : m.toString().length);
  let places = figs;
  if (fmt === 'fix' && (places < 0 || exp + numdigs(mant) > -places)) {
    if (places < 0) places = -places;
    let text = scaleRounding(mant, exp + places).toString();
    if (text.length <= places) text = '0'.repeat(1 + places - text.length) + text;
    return places > 0 ? `${text.slice(0, -places)}.${text.slice(-places)}` : `${text}.`;
  }
  if (places < 0) places = prec + places;
  if (places > 0) {
    const adj = places - numdigs(mant);
    if (adj < 0) {
      mant = scaleRounding(mant, adj);
      exp -= adj;
    }
  }
  let text = mant.toString();
  const len = text.length;
  const dpos = exp + len;
  if (fmt === 'float' && dpos <= prec + SCI_HIGH && dpos >= SCI_LOW + 2) {
    if (dpos === 0) return `0.${text}`;
    if (exp <= 0 && dpos > 0) return `${text.slice(0, dpos)}.${text.slice(dpos)}`;
    if (exp > 0) return `${text}${'0'.repeat(exp)}.`;
    return `0.${'0'.repeat(-dpos)}${text}`;
  }
  const exponentAdjusted = exp + len;
  const scale = fmt === 'eng' ? 1 + (((exponentAdjusted + 300002) % 3 + 3) % 3) : 1;
  if (scale > text.length) text += '0'.repeat(scale - text.length);
  if (scale < text.length) text = `${text.slice(0, scale)}.${text.slice(scale)}`;
  return `${text}e${exponentAdjusted - scale}`;
}

/** Digits of |n| rounded the way C's printf does it: exactly, with a tie going to the even digit.
 * @param {number} n @param {'f' | 'e'} kind @param {number} digits decimals for f, digits after the point for e
 * @returns {{digits: string, exponent: number}} `digits` are the kept significant digits, `exponent` the power of ten of the first one */
function cRound(n, kind, digits) {
  const [text, exponentText] = Math.abs(n).toExponential(100).split('e');
  let all = text.replace('.', '');
  let exponent = Number(exponentText);
  if (/^0+$/.test(all)) return { digits: '0'.repeat(kind === 'e' ? digits + 1 : Math.max(1, digits + 1)), exponent: 0 };
  let keep = kind === 'e' ? digits + 1 : exponent + 1 + digits;
  if (keep < 0) return { digits: '0', exponent: -digits };
  if (keep === 0) {
    all = `0${all}`;
    exponent += 1;
    keep = 1;
  }
  const rest = all.slice(keep);
  const kept = all.slice(0, keep);
  const up = rest[0] > '5' || (rest[0] === '5' && (/[1-9]/.test(rest.slice(1)) || Number(kept.slice(-1)) % 2 === 1));
  let result = (BigInt(kept) + (up ? 1n : 0n)).toString().padStart(keep, '0');
  if (result.length > keep) {
    exponent += 1;
    if (kind === 'e') result = result.slice(0, keep);
  }
  return { digits: result, exponent };
}

/** C's %.Nf.
 * @param {number} n @param {number} decimals */
function printfFixed(n, decimals) {
  const sign = n < 0 || Object.is(n, -0) ? '-' : '';
  const { digits, exponent } = cRound(n, 'f', decimals);
  const intLen = exponent + 1;
  const whole = intLen > 0 ? digits.slice(0, intLen).padEnd(intLen, '0') : '0';
  const fraction = (intLen > 0 ? digits.slice(intLen) : '0'.repeat(-intLen) + digits).padEnd(decimals, '0').slice(0, decimals);
  return `${sign}${whole}${decimals > 0 ? `.${fraction}` : ''}`;
}

/** C-style %e and %g, as Emacs's format does for a printf-type flag.
 * @param {number} n @param {'e' | 'g'} conversion @param {number} [precision] */
function printfExponential(n, conversion, precision = 6) {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'nan' : n > 0 ? 'inf' : '-inf';
  const sign = n < 0 ? '-' : '';
  /** @param {number} p */
  const e = (p) => {
    const { digits, exponent } = n === 0 ? { digits: '0'.repeat(p + 1), exponent: 0 } : cRound(n, 'e', p);
    const mantissa = p > 0 ? `${digits[0]}.${digits.slice(1)}` : digits[0];
    return `${sign}${mantissa}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
  };
  if (conversion === 'e') return e(precision);
  const p = precision === 0 ? 1 : precision;
  const x = n === 0 ? 0 : cRound(n, 'e', p - 1).exponent;
  const trim = (/** @type {string} */ t) => (t.includes('.') ? t.replace(/\.?0+$/, '') : t);
  if (x < -4 || x >= p) return e(p - 1).replace(/(\.\d*?)0*e/, (_, f) => `${f === '.' ? '' : f}e`);
  return trim(printfFixed(n, p - 1 - x));
}

/** Formats `n` per an explicit, real org format specifier -- "%.Nf"
 *  (fixed N decimal places, confirmed directly against both the Org
 *  Manual's own wording and a real, published org file using this
 *  exact syntax) or "%d" (integer; the exact rounding rule isn't
 *  independently source-confirmed the way "%.Nf" is, so round-to-
 *  nearest is used as the most defensible choice, not a confirmed
 * @param {any} [n]
 * @param {any} [spec]
 *  match to real Calc's own exact behavior). */
function applyFormatSpec(n, spec, isFloat = false, prec = 12) {
  if (Number.isNaN(n)) return 'nan';
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-inf'; // real Calc's own actual display convention -- a digit count is meaningless for an infinite value, so no format spec (fixed/normal/scientific/engineering/%d) applies to it at all
  if (spec.printf) {
    // A printf-style flag formats the number Calc has already displayed to its default 8 digits.
    const shown = Number.isInteger(n) && !isFloat ? n : Number(calcFloatString(n, 'float', 8, prec).replace(/\.$/, ''));
    if (spec.type === 'fixed') return printfFixed(shown, spec.digits);
    return printfExponential(shown, spec.conversion, spec.digits);
  }
  const calcFormats = { fixed: 'fix', normal: 'float', scientific: 'sci', engineering: 'eng' };
  if (spec.type in calcFormats) {
    if (Number.isInteger(n) && !isFloat) return String(n); // an integer is not a float, so the float format does not touch it
    return calcFloatString(n, /** @type {'float' | 'fix' | 'sci' | 'eng'} */ (/** @type {any} */ (calcFormats)[spec.type]), spec.digits, prec);
  }
  // Truncates toward zero, not round-to-nearest -- unlike "%.Nf"
  // above (confirmed directly against both the Org Manual's own
  // wording and a real, published org file using that exact syntax),
  // this specific rule for "%d" isn't confirmed against a primary
  // source the same way, despite multiple targeted searches for the
  // actual Calc/Lisp mechanism behind it. Truncation is used on
  // converging, but indirect, evidence instead: real Emacs Lisp's own
  // `format` function is strict about argument types for "%d" (it
  // won't silently accept a float at all), so Calc must explicitly
  // convert to an integer before formatting -- and truncation is the
  // conventional default "convert to int" behavior across the
  // C-derived languages Calc's own format mechanism is explicitly
  // modeled on ("similar to printf," per the Org Manual itself).
  return String(Math.trunc(n));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Calc's unevaluated form. Org pastes the referenced cells into the formula as text and Calc reads the lot as algebra, so a cell
// holding "hello" is a variable and `$1+1` shows as `hello + 1`; `pi` and `e` stay symbols. calc-symbolic.js is the port of that
// algebra. It is tried when the numeric path cannot produce a number, and first when the formula names pi or e.
// ---------------------------------------------------------------------------------------------------------------------------------

/** A parsed-formula node, symbolic form or evaluation context: loose by nature, so named once here.
 * @typedef {any} FormulaNode */
/** @type {FormulaNode} */ let symbolicCtx = null;
Sym.setFloatFormatter((v) => calcFloatString(v, 'float', 8));
Sym.setNumericCall((name, args) => {
  if (!symbolicCtx || !Object.prototype.hasOwnProperty.call(SCALAR_FUNCTIONS, name) || args.length > 2) return null;
  const nodes = [];
  for (const a of args) {
    if (a.t === 'int') nodes.push({ type: 'number', value: Number(a.v) });
    else if (a.t === 'flt') nodes.push({ type: 'number', value: Sym.toNumber(a), float: true });
    else return null;
  }
  try {
    const node = { type: 'scalarCall', name, args: nodes };
    const value = evaluateAst(node, symbolicCtx);
    const n = isMathjsValue(value) ? Number(value.toString()) : typeof value === 'bigint' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return exprIsFloat(node, symbolicCtx) || !Number.isInteger(n) ? Sym.F(n) : Sym.I(n);
  } catch {
    return null;
  }
});

/** @param {FormulaNode} ctx @param {number} row @param {number} col @returns {FormulaNode} */
function symbolicCell(ctx, row, col) {
  const text = String((ctx.dataRows[row - 1] && ctx.dataRows[row - 1].cells[col - 1]) ?? '').trim();
  if (text === '') return ctx.emptyMode === 'nan' ? Sym.V('nan') : Sym.I(0);
  // When this is the main evaluator rather than the fallback, only plain numbers qualify: dates, durations and the like are the numeric path's
  if (ctx.symbolicStrict && !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)) throw new Sym.SymbolicUnsupported(text);
  return Sym.parseExpression(text);
}

/** The formula as Calc reads it. Org pastes each referenced cell into the formula as `(text)`; here a reference becomes a placeholder
 *  variable that is swapped for the cell's parsed form once the rest of the formula has been read, so the precedence is Calc's own.
 * @param {string} source @param {FormulaNode} ctx @returns {FormulaNode} */
function symbolicForm(source, ctx) {
  const tokens = tokenize(source, true);
  /** @type {Map<string, FormulaNode>} */ const bound = new Map();
  /** @type {string[]} */ const out = [];
  const isRef = (/** @type {string} */ t) => /^@|^\$(?:[<>]|\d+)$/.test(t);
  const hold = (/** @type {FormulaNode} */ form) => {
    const name = `zzref${bound.size}zz`;
    bound.set(name, form);
    out.push(`(${name})`);
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (isRef(tok)) {
      if (tokens[i + 1] === '..' && tokens[i + 2] !== undefined && isRef(tokens[i + 2])) {
        hold(symbolicRange(parseExpression([tok, '..', tokens[i + 2]]), ctx));
        i += 2;
      } else {
        const ref = parseExpression([tok]);
        if (ref.type !== 'ref') throw new Sym.SymbolicUnsupported(tok);
        const { row, col } = resolveRef(ref.ref, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions);
        hold(symbolicCell(ctx, row, col));
      }
    } else if (tok.startsWith('$')) {
      const value = (ctx.constants || {})[tok.slice(1)];
      if (typeof value !== 'number') throw new Sym.SymbolicUnsupported(tok);
      hold(Number.isInteger(value) ? Sym.I(value) : Sym.F(value));
    } else if (tok === '..') {
      out.push(tok); // inside an interval, [1 .. 5]
    } else if (tok.startsWith('"')) {
      throw new Sym.SymbolicUnsupported(tok);
    } else {
      out.push(tok);
    }
  }
  const tree = Sym.parseExpression(out.join(' '));
  const form = Sym.substitute(tree, bound);
  if (ctx.symbolicStrict) Sym.assertNumericSymbols(form);
  return form;
}

/** @param {FormulaNode} node a range node @param {FormulaNode} ctx @returns {FormulaNode} */
function symbolicRange(node, ctx) {
  const from = resolveRef(node.from, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions, true);
  const to = resolveRef(node.to, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions, false);
  const items = [];
  for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) {
    for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) {
      if (isCellBlank(ctx.dataRows, r, c) && ctx.emptyMode === 'omit') continue;
      items.push(symbolicCell(ctx, r, c));
    }
  }
  return Sym.VEC(items);
}

/** Does the formula use pi or e, which Calc leaves as symbols? @param {FormulaNode} node @returns {boolean} */
function usesSymbolicConstant(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'number') return !!node.symbolic;
  return Object.values(node).some((v) => (Array.isArray(v) ? v.some(usesSymbolicConstant) : usesSymbolicConstant(v)));
}

/** Is the formula plain algebra over numbers and cell references -- the part Calc's own arithmetic port covers completely?
 * @param {FormulaNode} node @returns {boolean} */
function isPlainAlgebra(node, allowUnknown = false) {
  switch (node.type) {
    case 'number':
    case 'ref':
    case 'range':
      return true;
    case 'vectorLiteral':
      return node.items.every((/** @type {FormulaNode} */ a) => isPlainAlgebra(a, allowUnknown));
    case 'neg':
    case 'not':
      return isPlainAlgebra(node.operand, allowUnknown);
    case 'binop':
      return isPlainAlgebra(node.left, allowUnknown) && isPlainAlgebra(node.right, allowUnknown);
    case 'call':
      return ['vsum', 'vmean', 'vcount', 'vprod', 'vmin', 'vmax', 'vmedian', 'vvar', 'vpvar', 'vsdev', 'vpsdev'].includes(node.name) && isPlainAlgebra(node.arg, allowUnknown);
    case 'scalarCall':
      return node.args.every((/** @type {FormulaNode} */ a) => isPlainAlgebra(a, allowUnknown));
    case 'unknownCall':
      return allowUnknown && node.args.every((/** @type {FormulaNode} */ a) => isPlainAlgebra(a, allowUnknown));
    case 'dateCall':
      return allowUnknown && node.args.every((/** @type {FormulaNode} */ a) => isPlainAlgebra(a, allowUnknown)); // an impossible date stays as written
    case 'complexLiteral':
      return allowUnknown && isPlainAlgebra(node.re, allowUnknown) && isPlainAlgebra(node.im, allowUnknown);
    case 'ifCall':
      return isPlainAlgebra(node.condition, allowUnknown) && isPlainAlgebra(node.trueExpr, allowUnknown) && isPlainAlgebra(node.falseExpr, allowUnknown);
    default:
      return false;
  }
}

/** The formula as Calc would leave it: a number, or text such as `hello + 1`; null when the port does not cover it.
 * `strict` is the main-evaluator mode: anything unusual (a date among the cells, a function it cannot compute) hands back to the numeric engine.
 * @param {string | null} source @param {FormulaNode} ctx @param {boolean} [strict] @returns {{ kind: 'num', value: number | bigint, isFloat: boolean } | { kind: 'text', text: string } | null} */
function symbolicOutcome(source, ctx, strict = false) {
  if (source === null) return null;
  symbolicCtx = { ...ctx, symbolicStrict: strict };
  Sym.setStrictFunctions(strict);
  try {
    const form = Sym.normalize(symbolicForm(source, symbolicCtx));
    if (form.t === 'int') return { kind: 'num', value: form.v > BigInt(Number.MAX_SAFE_INTEGER) || form.v < -BigInt(Number.MAX_SAFE_INTEGER) ? form.v : Number(form.v), isFloat: false };
    if (form.t === 'flt') {
      const value = Sym.toNumber(form);
      return Number.isFinite(value) && (value !== 0 || form.m === 0n) ? { kind: 'num', value, isFloat: true } : { kind: 'text', text: Sym.show(form) };
    }
    return { kind: 'text', text: Sym.show(form) };
  } catch (err) {
    if (err instanceof Sym.SymbolicSyntaxError && (!strict || err.definite)) return { kind: 'text', text: '#ERROR' };
    return null;
  } finally {
    symbolicCtx = null;
  }
}

/** @param {FormulaNode} v */
function isNanValue(v) {
  return (typeof v === 'number' && Number.isNaN(v)) || (isMathjsValue(v) && typeof v.isNaN === 'function' && v.isNaN());
}

/** A division or remainder by zero. Calc leaves such a formula unevaluated; when it is the whole formula, the cell shows it ("5/0"). */
class DivisionByZero extends Error {
  /** @param {FormulaNode} node @param {FormulaNode} numerator */
  constructor(node, numerator) {
    super('Division by zero');
    this.node = node;
    this.numerator = numerator;
  }
}

/** @param {DivisionByZero} err @returns {string | null} */
function unevaluatedDivision(err) {
  const n = err.numerator;
  const value = typeof n === 'bigint' || typeof n === 'number' ? formatResult(n) : isMathjsValue(n) && n.isFraction ? formatAsFraction(n) : null;
  if (value === null) return null;
  if (err.node.op === '%') return `${value} % 0`;
  if (err.node.op === '\\') return `${value} \\ 0`;
  return /^-?\d+(:\d+)?$/.test(value) ? `${value}/0` : `${value} / 0`;
}

/** Whole-number arithmetic that stays exact however large, as Calc's integers do: a BigInt once the result passes 2^53, else a number.
 *  Undefined when an operand isn't a whole number or the operation isn't one this covers (division that leaves a remainder, a negative power).
 * @param {string} op @param {FormulaNode} l @param {FormulaNode} r @returns {number | bigint | undefined} */
function exactIntegerBinop(op, l, r) {
  if (op !== '+' && op !== '-' && op !== '*' && op !== '^' && op !== '%' && op !== '/' && op !== '\\') return undefined;
  /** @param {FormulaNode} v */
  const whole = (v) => typeof v === 'bigint' || (typeof v === 'number' && Number.isInteger(v));
  if (!whole(l) || !whole(r)) return undefined;
  const a = BigInt(l);
  const b = BigInt(r);
  /** @type {bigint} */ let e;
  if (op === '+') e = a + b;
  else if (op === '-') e = a - b;
  else if (op === '*') e = a * b;
  else if (op === '^') {
    if (b < 0n || b > 4096n) return undefined;
    e = a ** b;
  } else if (op === '%') {
    if (b === 0n) return undefined;
    e = a % b;
    if (e !== 0n && e < 0n !== b < 0n) e += b; // the result takes the sign of the divisor
  } else if (op === '\\') {
    if (b === 0n) return undefined;
    e = a / b;
    if (a % b !== 0n && a < 0n !== b < 0n) e -= 1n; // rounds down
  } else {
    if (b === 0n || a % b !== 0n) return undefined;
    e = a / b;
  }
  const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  return e >= -SAFE && e <= SAFE ? Number(e) : e;
}

/** A string in a Calc formula is a vector of character codes: "yes" is [121, 101, 115].
 * @param {string} text */
function charCodeVector(text) {
  return `[${Array.from(text, (ch) => ch.codePointAt(0)).join(', ')}]`;
}

/** Names whose result is a whole number even from a float argument. */
const INTEGER_RESULT_FUNCTIONS = new Set(['floor', 'ceil', 'round', 'trunc', 'idiv', 'ceiling']);

/** Calc keeps a float a float even when it is whole, so 3.0*2 shows 6. and 3*2 shows 6. This asks whether the value
 *  of `node` is a float: a literal or cell holding a decimal point or exponent, or any operation on one.
 * @param {FormulaNode} node
 * @param {FormulaNode} ctx
 * @returns {boolean} */
function exprIsFloat(node, ctx) {
  switch (node.type) {
    case 'number': return node.float === true;
    case 'neg': case 'not': return exprIsFloat(node.operand, ctx);
    case 'binop':
      if (['==', '!=', '<', '>', '<=', '>=', '&&', '||', '\\'].includes(node.op)) return false;
      return exprIsFloat(node.left, ctx) || exprIsFloat(node.right, ctx);
    case 'ifCall': {
      try {
        return exprIsFloat(isTruthyValue(evaluateAst(node.condition, ctx)) ? node.trueExpr : node.falseExpr, ctx);
      } catch {
        return false;
      }
    }
    case 'ref': {
      const { row, col } = resolveRef(node.ref, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions);
      return cellTextIsFloat(ctx.dataRows, row, col);
    }
    case 'dateCall': {
      if (node.name !== 'date' || node.args.length !== 1) return false;
      const arg = node.args[0];
      if (arg.type === 'number') return arg.float === true;
      if (arg.type !== 'ref') return false;
      const { row, col } = resolveRef(arg.ref, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions);
      return /\d:\d/.test(String((ctx.dataRows[row - 1] && ctx.dataRows[row - 1].cells[col - 1]) || '')) || cellTextIsFloat(ctx.dataRows, row, col);
    }
    case 'call': {
      if (node.name === 'vcount') return false;
      const arg = node.arg;
      if (arg.type === 'ref') {
        const { row, col } = resolveRef(arg.ref, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions);
        return cellTextIsFloat(ctx.dataRows, row, col);
      }
      if (arg.type !== 'range') return exprIsFloat(arg, ctx);
      const from = resolveRef(arg.from, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions, true);
      const to = resolveRef(arg.to, ctx.currentRow, ctx.dataRowCount, ctx.colCount, ctx.currentCol, ctx.hlinePositions, false);
      for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) {
        for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) if (cellTextIsFloat(ctx.dataRows, r, c)) return true;
      }
      return false;
    }
    case 'scalarCall':
      return !INTEGER_RESULT_FUNCTIONS.has(node.name) && node.args.some((/** @type {object} */ a) => exprIsFloat(a, ctx));
    default: return false;
  }
}

/** @param {{cells: string[]}[]} dataRows @param {number} row @param {number} col */
function cellTextIsFloat(dataRows, row, col) {
  const text = String((dataRows[row - 1] && dataRows[row - 1].cells[col - 1]) || '').trim();
  return /^[-+]?(\d+\.\d*|\.\d+|\d+(\.\d*)?[eE][-+]?\d+)$/.test(text);
}

/** @param {any} [n] @param {boolean} [isFloat] a whole number that came from a float shows a trailing "." */
function formatResult(n, isFloat = false) {
  if (typeof n === 'bigint') return n.toString();
  if (Number.isNaN(n)) return 'nan';
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-inf'; // Calc's own display of the inf constant
  if (Number.isInteger(n) && !isFloat) return String(n);
  return calcFloatString(n, 'float', 8);
}

// ---- formula-line parsing ------------------------------------------------

/** Parses one "$M=RHS" or "@N$M=RHS" statement (one segment of a
 *  "::"-joined #+TBLFM: line) into { target, expr } -- target is
 *  either { type: 'column', col } (the "$M=" shorthand, no "@" at
 *  all -- apply to every data row) or { type: 'cell', row, col } (an
 *  explicit "@N$M="). expr is the tokenized-and-parsed RHS AST.
 *  Real org's own optional ";format" suffix is recognized and
 *  discarded (parsed off, not left dangling in the expression text
 *  and misparsed as part of it) rather than actually applied -- see
 *  formatResult's own docs for why. */
/** Real Emacs's own orgtbl-ascii-draw (org-table.el) -- draws an ASCII
 *  bar in a table cell. VALUE is the value to plot; MIN is the value
 *  that draws as a fully empty bar; MAX is the value that fills the
 *  whole WIDTH (default 12 characters, matching real Emacs's own
 *  default). A value outside [MIN, MAX] renders as the literal text
 *  "too small" / "too large", matching real Emacs exactly -- not
 *  thrown as an error, since a stray outlier elsewhere in the same
 *  column is a real, expected case a formula needs to keep working
 *  through, not abort the whole recalculation over. The 11-character
 *  gradient (" .:;c!lhVHW", real Emacs's own actual default set)
 *  supplies one fractional "cap" character after however many full
 *  "W" characters the integer part of the scaled value calls for --
 *  verified directly against real Emacs's own actual source (the
 *  original org-table.el patch that introduced this function) and a
 *  real-world example table (Org Plot's own documented "Sede / Max
 *  cites" example, every one of its 6 rows hand-traced and confirmed
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {number} [width]
 *  to match exactly), not derived from the docstring alone. */
function orgtblAsciiDraw(value, min, max, width) {
  const characters = ' .:;c!lhVHW';
  const columns = Math.ceil(width === undefined ? 12 : width);
  const len = characters.length - 1; // 10 -- index of the final, full-block character
  const relative = (value - min) / (max - min);
  const steps = Math.round(relative * columns * len); // as Emacs's own rounding does for a value half way between two steps
  if (steps < 0) return 'too small';
  if (steps > columns * len) return 'too large';
  const whole = Math.floor(steps / len);
  return characters[len].repeat(whole) + characters[steps - whole * len];
}

/** Real functions this app supports through the '(function ...) raw
 *  Lisp-call syntax below -- deliberately narrow, not a general Elisp
 *  interpreter: exactly the one real function actually requested. */
const LISP_CALL_FUNCTIONS = {
  'orgtbl-ascii-draw': orgtblAsciiDraw,
};

/** Parses real org-mode's own '(function-name arg1 arg2 ...) form --
 *  a raw Elisp function call in a #+TBLFM: line, bypassing this app's
 *  own normal infix expression grammar entirely, exactly the way real
 *  org-mode treats a formula starting with a quote as a literal Elisp
 *  form to evaluate directly rather than its own spreadsheet syntax.
 *  `rhs` is already known to start with "'(" and end with ")" by the
 *  time this is called (see parseFormulaStatement's own check).
 *
 *  Tokenizes the whole inner content ONCE (reusing this module's own
 *  existing tokenize, now that orgtbl-ascii-draw is a recognized
 *  hyphenated name too), then walks that single token stream to find
 *  each argument's own boundary: a bare, space-free token (a number
 *  or a $N reference) is one complete argument on its own; a "("
 *  opens a fully parenthesized sub-expression argument, whose own
 *  matching ")" is found by tracking nesting depth (so a compound
 *  argument like "($2 * 2)" is one argument, not three). This matches
 *  real Emacs Lisp's own actual convention exactly -- real Lisp has
 *  no infix operators at all, so a compound argument there is always
 *  explicitly wrapped in its own parentheses; there's no such thing
 *  as an ambiguous, unparenthesized multi-token argument to begin
 *  with. Once inside those parens, the content is parsed with this
 *  app's own existing infix grammar (the same "(expr)" grouping
 *  construct ordinary formulas already support), not real Elisp's own
 *  separate prefix-notation convention -- reusing this app's own,
 *  already-consistent syntax rather than requiring a second one just
 *  for arguments inside a '(...) call. Each argument's own token
 *  slice is handed to this module's own existing parseExpression
 *  unchanged, so a $N reference, arithmetic, or any other construct
 * @param {any} [rhs]
 *  an ordinary formula already supports works identically here. */
function parseLispCall(rhs) {
  const inner = rhs.slice(2, -1).trim();
  const tokens = tokenize(inner);
  if (tokens.length === 0) throw new Error(`Malformed Lisp call: "${rhs}"`);
  const name = tokens[0];
  if (!(name in LISP_CALL_FUNCTIONS)) {
    throw new Error(`Unsupported Lisp function "${name}" in '(...) formula -- only ${Object.keys(LISP_CALL_FUNCTIONS).join(', ')} ${Object.keys(LISP_CALL_FUNCTIONS).length === 1 ? 'is' : 'are'} supported this way`);
  }
  const args = [];
  let i = 1;
  while (i < tokens.length) {
    if (tokens[i] === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < tokens.length && depth > 0) {
        if (tokens[j] === '(') depth++;
        else if (tokens[j] === ')') depth--;
        j++;
      }
      if (depth !== 0) throw new Error(`Unbalanced parentheses in Lisp call: "${rhs}"`);
      args.push(parseExpression(tokens.slice(i + 1, j - 1)));
      i = j;
    } else if (tokens[i] === '-' && i + 1 < tokens.length && tokens[i + 1] !== '(') {
      // A negative literal such as -1 is one argument, as in Lisp.
      args.push(parseExpression([tokens[i], tokens[i + 1]]));
      i += 2;
    } else {
      args.push(parseExpression([tokens[i]]));
      i += 1;
    }
  }
  return { type: 'lispCall', name, args };
}

/** @param {any} [statement] */
function parseFormulaStatement(statement) {
  const eq = statement.indexOf('=');
  if (eq === -1) throw new Error(`Malformed formula, no "=": "${statement}"`);
  const lhs = statement.slice(0, eq).trim();
  let rhs = statement.slice(eq + 1).trim();
  const formatSuffix = /;[^;]*$/.exec(rhs);
  let mode = ({ format: null, duration: null, emptyMode: 'omit', forceNumeric: false, fraction: false, mixedNumber: false, angleMode: 'degrees', precision: null });
  if (formatSuffix) {
    rhs = rhs.slice(0, formatSuffix.index).trim();
    mode = parseModeString(formatSuffix[0].slice(1)); // slice(1): drop the leading ";" itself
  }

  let target;
  const rangeMatch = lhs.includes('..') ? /^(.+)\.\.(.+)$/.exec(lhs) : null;
  const cellMatch = /^@([<>]|[+-]?\d+|I+(?:[+-]\d+)?)\$([<>]|\d+)$/.exec(lhs);
  const colMatch = /^\$([<>]|\d+)$/.exec(lhs);
  if (rangeMatch) {
    const from = parseRef(rangeMatch[1]);
    const to = parseRef(rangeMatch[2]);
    if (!from || !to || from.col === null || to.col === null) throw new Error(`Malformed formula target: "${lhs}"`);
    target = { type: 'range', from, to };
  } else if (cellMatch) {
    const row = parseRowRef(cellMatch[1]);
    const col = parseColRef(cellMatch[2]);
    if (!row || !col) throw new Error(`Malformed formula target: "${lhs}"`);
    target = { type: 'cell', row, col };
  } else if (colMatch) {
    const col = parseColRef(colMatch[1]);
    if (!col) throw new Error(`Malformed formula target: "${lhs}"`);
    target = { type: 'column', col };
  } else {
    throw new Error(`Malformed formula target: "${lhs}"`);
  }

  const isLisp = rhs.startsWith("'(") && rhs.endsWith(')');
  /** @type {FormulaNode} */ let expr;
  try {
    if (!isLisp && /\d:\d/.test(rhs) && readsAsAlgebra(rhs)) throw new Error('Calc fraction'); // 1:2 is Calc's; only the symbolic engine reads it
    expr = isLisp ? parseLispCall(rhs) : parseExpression(tokenize(rhs));
  } catch (err) {
    // Calc algebra the numeric parser has no word for (an interval, a bare name): the symbolic engine reads it when the cells are known
    if (isLisp || !(rhs.includes('..') || /\d:\d/.test(rhs) || /chain of comparisons|^Expected "\("/.test(/** @type {Error} */ (err).message)) || !readsAsAlgebra(rhs)) throw err;
    expr = { type: 'algebra' };
  }
  return { target, expr, mode, source: isLisp ? null : rhs };
}

/** Does Calc's own reader take this formula, cell references standing for numbers? @param {string} rhs @returns {boolean} */
function readsAsAlgebra(rhs) {
  try {
    Sym.parseExpression(tokenize(rhs, true).map((t) => (/^@|^\$(?:[<>]|\d+)$/.test(t) ? '1' : t)).join(' '));
    return true;
  } catch (err) {
    return err instanceof Sym.SymbolicSyntaxError && err.definite; // Calc rejects it outright: the cell shows #ERROR
  }
}

/** Splits a full #+TBLFM: value on "::" (real org's own multi-formula
 *  separator) and parses each segment. Throws on the first malformed
 *  segment -- see recalculateTable's own docs for how a caller should
 *  handle that (the whole recalculation is abandoned, not partially
 * @param {any} [tblfm]
 *  applied). */
function parseTblfm(tblfm) {
  return tblfm
    .split('::')
    .map((/** @type {any} */ s) => s.trim())
    .filter(Boolean)
    .map(parseFormulaStatement);
}

// ---- table-level recalculation -------------------------------------------

/**
 * Recalculates every formula in `table.tblfm` against `table.rows`,
 * returning a NEW rows array with the results applied -- pure, no
 * mutation of the input. Returns null if the table has no #+TBLFM: at
 * all (nothing to do). Throws (with a message suitable for showing
 * directly as a status message) on a malformed formula or an
 * out-of-range reference -- the whole recalculation is abandoned in
 * that case, not partially applied, so a typo in one formula can
 * never leave some cells updated and others stale with no indication
 * which is which.
 *
 * Formulas are evaluated in the order written in #+TBLFM:, each one
 * able to see any earlier formula's own already-updated values within
 * this same pass (covering the common "chained column" case) --
 * working on a running COPY of the row data, not the original
 * `table.rows` reference, so the caller's own input is never mutated
 * regardless of whether this throws partway through.
 */
/** Formats `n` per the F (Fraction Mode) / FS (Fraction + mixed-number)
 *  flags -- confirmed directly against real org's own documented
 *  examples: 3/6;F -> "1/2", 12/9;F -> "4/3", 14/4;FS -> "3 + 1/2".
 *  Without `mixedNumber` (F alone), an improper fraction stays
 *  improper ("5/3", not "1 + 2/3") -- mixed-number display is
 *  specifically the FS combination's own documented behavior, not F's
 *  default. A proper fraction (|numerator| < denominator) has no
 *  whole part to extract regardless of `mixedNumber`, so it's always
 *  shown the same plain way either way. */
const FRACTION_DISPLAY_MAX_DENOMINATOR = 1000000n; // a denominator past this an exact mathjs Fraction is almost certainly the literal representation of a high-precision transcendental result, not a fraction anyone would want to read as-is

/**
 * @param {any} [n]
 * @param {boolean} [mixedNumber]
 */
function formatAsFraction(n, mixedNumber) {
  if (isMathjsValue(n) && n.isFraction && n.d <= FRACTION_DISPLAY_MAX_DENOMINATOR) {
    const denominator = n.d; // BigInt, unsigned
    const signed = n.s * n.n; // BigInt
    return denominator === 1n ? String(signed) : `${signed}:${denominator}`; // Calc writes a fraction with a colon
  }
  if (isMathjsValue(n)) n = n.isFraction ? n.valueOf() : n.toNumber(); // an exact Fraction with an unreasonably large denominator, or a BigNumber: shown as a float
  return formatResult(n); // a float stays a float in Calc's fraction mode
}

/** Formats one formula's own final computed value into cell text --
 *  duration (T/U/t) or fraction (F) formatting take priority when
 *  present, since either one is never ALSO shown in scientific/
 *  fixed/etc notation; otherwise an explicit format spec (fixed/
 *  integer/normal/scientific/engineering); otherwise formatResult's
 * @param {any} [value]
 * @param {any} [mode]
 * @param {any} [hourZeroPad]
 * @param {any} [complexDomain]
 *  own default. */
function formatFinalValue(value, mode, hourZeroPad, complexDomain, isFloat = false) {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') {
    if (!mode.duration && !mode.fraction && !mode.format) return value.toString();
    value = Number(value);
  }
  if (isComplex(value) || isVector(value)) return formatCalcValue(value, complexDomain, { spec: mode.format, applySpec: applyFormatSpec });
  if (isTaggedValue(value)) return value.type === 'date' ? formatDateValue(value) : formatHmsValue(value);
  if (isMathjsValue(value) && value.isBigNumber) {
    if (!mode.duration && !(mode.format && mode.format.printf) && mode.format?.type !== 'integer') {
      const asInteger = value.isInteger() && !isFloat;
      const named = { fixed: 'fix', normal: 'float', scientific: 'sci', engineering: 'eng' };
      const kind = mode.format ? /** @type {any} */ (named)[mode.format.type] : 'float';
      return asInteger ? value.toFixed() : calcFloatString(value, kind, mode.format ? mode.format.digits : 8, mode.precision ?? 12); // Calc still shows 8 digits unless an n/f/s/e flag says otherwise
    }
    value = value.toNumber(); // pN combined with a duration mode or another format spec: an honest, documented precision loss at this specific display step -- see this function's own docs above
  }
  if (mode.duration) return formatDuration(value, mode.duration, hourZeroPad);
  if (mode.fraction) return typeof value === 'number' ? formatResult(value, isFloat) : formatAsFraction(value, mode.mixedNumber);
  if (mode.format) return applyFormatSpec(value, mode.format, isFloat, mode.precision ?? 12);
  return mode.precision !== null && typeof value === 'number' && (isFloat || !Number.isInteger(value)) ? calcFloatString(value, 'float', 8, mode.precision) : formatResult(value, isFloat);
}

/** Extracts and parses every #+CONSTANTS: line in `doc` into a single
 *  {name: value} map for #+TBLFM's own $name references. Confirmed
 *  directly against the real org-table.el source for the #+CONSTANTS:
 *  line syntax itself ("c=299792458 g=9.81"). Multiple #+CONSTANTS:
 *  lines are unioned together (a later line's own value for the same
 *  name wins), matching this app's own established precedent for how
 *  multiple lines of the same document keyword are already treated
 *  elsewhere (#+TODO:'s own union-across-lines behavior in
 *  org-parser.js). A malformed pair (no "=", or a non-numeric value)
 *  is silently skipped rather than blocking the rest of the line or
 *  throwing -- matching this app's own established "a malformed entry
 *  doesn't block the rest of the list" convention for other
 * @param {Doc} doc
 *  multi-entry configuration (org-agenda-files and similar). */
export function parseTableConstants(doc) {
  const constants = {};
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'CONSTANTS') continue;
    for (const pair of kw.value.trim().split(/\s+/)) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq);
      const value = Number(pair.slice(eq + 1));
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || Number.isNaN(value)) continue;
      /** @type {any} */ (constants)[name] = value;
    }
  }
  return constants;
}

const NAME_RE = /^[a-zA-Z][_a-zA-Z0-9]*$/;
const MARKER_ROW_RE = /^[_^!$/]$/;
const MARKED_ROW_RE = /^[!$^_#*]$/;
const RECALC_ROW_RE = /^[#*]$/;

/** The names a table gives itself, as Org's org-table-analyze reads them. The first cell of a row is its marker: a row marked `!`
 *  names the columns (each cell names its own column, the marker column being column 1); a row marked `$` gives parameters as
 *  `name=value` cells; a row marked `_` or `^` names the fields in the row below or above it, each name standing for that field's text.
 * @param {{ type: string, cells?: string[] }[]} rows
 * @returns {{ columns: Map<string, number>, params: Map<string, string> }} */
function tableNames(rows) {
  const data = rows.filter((r) => r.type === 'row').map((r) => ({ cells: r.cells || [] }));
  const columns = new Map();
  const params = new Map();
  const marker = (/** @type {{ cells: string[] }} */ row) => String(row.cells[0] ?? '').trim();
  const named = data.find((r) => marker(r) === '!');
  if (named) {
    named.cells.forEach((/** @type {string} */ cell, /** @type {number} */ i) => {
      const name = String(cell).trim();
      if (i > 0 && NAME_RE.test(name) && !columns.has(name)) columns.set(name, i + 1);
    });
  }
  data.forEach((row, index) => {
    const mark = marker(row);
    if (mark === '$') {
      row.cells.forEach((/** @type {string} */ cell, /** @type {number} */ i) => {
        const m = i > 0 ? /^([a-zA-Z][_a-zA-Z0-9]*)\s*=\s*(.*)$/.exec(String(cell).trim()) : null;
        if (m) params.set(m[1], m[2]);
      });
    } else if (mark === '_' || mark === '^') {
      const target = data[index + (mark === '_' ? 1 : -1)];
      if (!target) return;
      row.cells.forEach((/** @type {string} */ cell, /** @type {number} */ i) => {
        const name = String(cell).trim();
        if (i === 0 || !NAME_RE.test(name) || i >= target.cells.length) return;
        params.set(name, String(target.cells[i]).trim());
      });
    }
  });
  return { columns, params };
}

/** Rewrites a #+TBLFM: line so the table's own names mean what Org makes them mean: `$Price` becomes the column's `$3`, and a parameter or a
 *  named field's text goes in parentheses. What is left (a constant) is read as before.
 * @param {string} tblfm
 * @param {ReturnType<typeof tableNames>} names */
function substituteTableNames(tblfm, names) {
  return tblfm
    .split('::')
    .map((statement) => {
      const eq = statement.indexOf('=');
      if (eq === -1) return statement;
      const lhs = statement.slice(0, eq);
      const rhs = statement.slice(eq + 1);
      const plain = rhs.trimStart().startsWith("'"); // a Lisp formula takes the text as it is
      const replaced = rhs.replace(/"(?:[^"\\]|\\.)*"|\$([a-zA-Z][_a-zA-Z0-9]*)/g, (match, name) => {
        if (name === undefined) return match;
        const col = names.columns.get(name);
        if (col !== undefined) return '$' + col;
        const value = names.params.get(name);
        if (value !== undefined) return plain ? value : '(' + value + ')';
        return match;
      });
      return lhs + '=' + replaced;
    })
    .join('::');
}

/** @param {Table} table */
export function recalculateTable(table, options = {}) {
  if (!table.tblfm || !table.tblfm.trim()) return null;
  const hourZeroPad = /** @type {any} */ (options).hourZeroPad !== undefined ? /** @type {any} */ (options).hourZeroPad : true;
  const names = tableNames(table.rows);
  const hasNames = names.columns.size + names.params.size > 0;
  const statements = parseTblfm(hasNames ? substituteTableNames(table.tblfm, names) : table.tblfm);

  // A working copy: same row objects' own shape, but with a fresh
  // `cells` array per row so evaluating one formula can't accidentally
  // mutate a row a caller might still be holding a reference to.
  const workingRows = table.rows.map((/** @type {any} */ row) => (row.type === 'row' ? { ...row, cells: [...row.cells] } : row));
  // @N numbering counts EVERY data row, including any row before the
  // table's own first hline -- confirmed directly against real Emacs
  // org-mode itself, not just inferred from the Manual's own prose
  // (which reads ambiguously on this specific point): a table with a
  // header row, 5 data rows below a hline, and one more row below a
  // second hline numbers that last row @7 (header=@1, the 5 data
  // rows=@2..@6, the final row=@7) -- verified by actually running
  // "@7$2=vsum(@2..@6)" through real Emacs's own org-table-recalculate
  // in batch mode and confirming it computes correctly, not by reading
  // the manual's own words about it and stopping there.
  const dataRows = workingRows.filter((r) => r.type === 'row');
  const dataRowCount = dataRows.length;
  const colCount = dataRows.reduce((max, r) => Math.max(max, r.cells.length), 0);
  // The header-row exclusion real org DOES have is narrower and
  // different from @N numbering: specifically, the column-formula
  // SHORTHAND ($N=, applied to every row at once) skips any row
  // before the table's own first hline -- also confirmed directly
  // against real Emacs: a $3=$2*2 column formula correctly leaves the
  // header row's own text alone, while an explicit, deliberately-
  // targeted cell formula like @1$2=999 still freely modifies the
  // header when asked to. No hline anywhere at all means nothing is
  // excluded from column formulas either -- every row counts as data.
  const firstRuleIndex = workingRows.findIndex((r) => r.type === 'rule');
  const headerRowCount = firstRuleIndex === -1 ? 0 : workingRows.slice(0, firstRuleIndex).filter((r) => r.type === 'row').length;
  const { positions: hlinePositions } = computeHlinePositions(workingRows);

  for (const { target, expr, mode, source } of statements) {
    const numericMode = mode.fraction
      ? { kind: 'fraction', instance: mathjsDefault }
      : mode.precision !== null
      ? { kind: 'bignumber', instance: mathjsForPrecision(mode.precision) }
      : null;
    const digits = mode.precision !== null ? mode.precision : 12;
    const complexDomain = mode.fraction ? fractionDomain(mathjsDefault, bigDomain(mathjsForPrecision(12), 12, mathjsForPrecision(18))) : bigDomain(mathjsForPrecision(digits), digits, mathjsForPrecision(digits + 6));
    const evalCtx = { complexDomain, dataRows, dataRowCount, colCount, hlinePositions, durationMode: mode.duration !== null, emptyMode: mode.emptyMode, forceNumeric: mode.forceNumeric, angleMode: mode.angleMode, constants: /** @type {any} */ (options).constants || {}, numericMode, userCall: /** @type {any} */ (options).userCall };
    // Evaluates the expression for one specific (row, col) and writes
    // either its formatted result or, if evaluation itself throws,
    // the literal text "#ERROR" into that cell -- confirmed directly
    // against real Emacs org-mode: a malformed or failing formula
    // doesn't abort the table's own recalculation, and a DIFFERENT,
    // valid formula elsewhere in the same #+TBLFM: line still
    // evaluates normally. Isolated per cell, not per statement, so a
    // range/column-formula target with one bad cell doesn't lose the
    // rest of its own siblings either.
    const plainMode = !mode.forceNumeric && !mode.fraction && !mode.duration && mode.precision === null;
    const isPlain = source !== null && isPlainAlgebra(expr);
    const canFallBack = source !== null && isPlainAlgebra(expr, true);
    const symbolicOnly = isPlain && usesSymbolicConstant(expr) && !mode.forceNumeric && !mode.duration && (mode.fraction || mode.precision !== null); // pi and e stay symbols in these modes too
    /**
     * @param {any} [row]
     * @param {any} [col]
     */
    function evalCell(row, col) {
      const probe = { nonNumeric: false };
      const primarySymbolic = plainMode && isPlain;
      const cellCtx = { ...evalCtx, currentRow: row, currentCol: col, probe };
      /** @param {string} text */
      const store = (text) => {
        dataRows[row - 1].cells[col - 1] = text;
      };
      /** @param {any} outcome @returns {boolean} */
      const storeSymbolic = (outcome) => {
        if (!outcome) return false;
        store(outcome.kind === 'text' ? outcome.text : formatFinalValue(outcome.value, mode, hourZeroPad, complexDomain, outcome.isFloat));
        return true;
      };
      try {
        if (expr.type === 'algebra') {
          if (!storeSymbolic(symbolicOutcome(source, cellCtx))) store('#ERROR');
          return;
        }
        if (mode.forceNumeric && isPlain && usesSymbolicConstant(expr)) return void store('#ERROR'); // N wants a number, and Calc keeps pi and e as symbols
        if (primarySymbolic && storeSymbolic(symbolicOutcome(source, cellCtx, true))) return;
        if (symbolicOnly) {
          const outcome = symbolicOutcome(source, cellCtx, true);
          if (outcome && outcome.kind === 'text') return void store(outcome.text);
        }
        const value = evaluateAst(expr, cellCtx);
        if ((probe.nonNumeric || isNanValue(value)) && canFallBack && !mode.forceNumeric && storeSymbolic(symbolicOutcome(source, cellCtx))) return;
        store(typeof value === 'string' && (expr.type === 'string' || expr.type === 'ifCall') ? charCodeVector(value) : formatFinalValue(value, mode, hourZeroPad, complexDomain, (typeof value === 'number' || (isMathjsValue(value) && value.isBigNumber)) && exprIsFloat(expr, cellCtx)));
      } catch (err) {
        const showsExpression = !mode.format && !mode.forceNumeric && !mode.duration;
        if (canFallBack && !mode.forceNumeric && (!(err instanceof DivisionByZero) || showsExpression) && storeSymbolic(symbolicOutcome(source, cellCtx))) return;
        const shown = err instanceof DivisionByZero && err.node === expr && !mode.format && !mode.forceNumeric && !mode.duration ? unevaluatedDivision(err) : null;
        store(shown ?? '#ERROR');
      }
    }
    if (target.type === 'cell') {
      const row = resolveRowRef(target.row, 1, dataRowCount, hlinePositions, false); // currentRow=1 is a placeholder -- an explicit @N$M target is never itself relative
      const col = resolveColRef(target.col, colCount);
      if (row === null || col === null) throw new Error('Formula target is out of range for this table');
      evalCell(row, col);
    } else if (target.type === 'range') {
      if (target.from.row === null || target.to.row === null) {
        throw new Error('A formula target range needs an explicit row on both endpoints');
      }
      const fromRow = resolveRowRef(target.from.row, 1, dataRowCount, hlinePositions, false);
      const toRow = resolveRowRef(target.to.row, 1, dataRowCount, hlinePositions, false);
      const fromCol = resolveColRef(target.from.col, colCount);
      const toCol = resolveColRef(target.to.col, colCount);
      if (fromRow === null || toRow === null || fromCol === null || toCol === null) {
        throw new Error('Formula target is out of range for this table');
      }
      const rowStart = Math.min(fromRow, toRow);
      const rowEnd = Math.max(fromRow, toRow);
      const colStart = Math.min(fromCol, toCol);
      const colEnd = Math.max(fromCol, toCol);
      for (let r = rowStart; r <= rowEnd; r++) {
        for (let c = colStart; c <= colEnd; c++) {
          evalCell(r, c);
        }
      }
    } else {
      // Column-formula shorthand: apply to every data row AFTER the
      // header (see headerRowCount above), each computing $M from ITS
      // OWN row.
      const col = resolveColRef(target.col, colCount);
      if (col === null) throw new Error('Formula target column is out of range for this table');
      // In Org a table with any marked row (`!` `$` `^` `_` `#` `*` in its first cell) recalculates only the rows marked `#` or `*`; one with
      // none recalculates every row after the header. Rows marked `_` `^` `!` `$` `/` are never data.
      const firstCell = (/** @type {number} */ r) => String(dataRows[r - 1].cells[0] ?? '').trim();
      const marked = dataRows.some((_, i) => MARKED_ROW_RE.test(firstCell(i + 1)));
      for (let r = marked ? 1 : headerRowCount + 1; r <= dataRowCount; r++) {
        if (MARKER_ROW_RE.test(firstCell(r))) continue;
        if (marked && !RECALC_ROW_RE.test(firstCell(r))) continue;
        evalCell(r, col);
      }
    }
  }

  return workingRows;
}
