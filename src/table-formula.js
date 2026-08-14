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

// ---- reference parsing ------------------------------------------------

/** Parses one row-reference token's text (after the leading "@", not
 *  including it) into { type: 'absolute', n } | { type: 'relative', delta }
 *  | { type: 'first' } | { type: 'last' }. Returns null if it doesn't
 *  match any recognized row-reference shape. */
function parseRowRef(text) {
  if (text === '<') return { type: 'first' };
  if (text === '>') return { type: 'last' };
  const relative = /^([+-])(\d+)$/.exec(text);
  if (relative) return { type: 'relative', delta: (relative[1] === '-' ? -1 : 1) * Number(relative[2]) };
  const absolute = /^(\d+)$/.exec(text);
  if (absolute) return { type: 'absolute', n: Number(absolute[1]) };
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
 *  surface, not something to silently reinterpret. */
function resolveRowRef(ref, currentRow, dataRowCount) {
  let n;
  if (ref.type === 'absolute') n = ref.n;
  else if (ref.type === 'relative') n = currentRow + ref.delta;
  else if (ref.type === 'first') n = 1;
  else n = dataRowCount; // 'last'
  return n >= 1 && n <= dataRowCount ? n : null;
}

function resolveColRef(ref, colCount) {
  const n = ref.type === 'absolute' ? ref.n : ref.type === 'first' ? 1 : colCount;
  return n >= 1 && n <= colCount ? n : null;
}

// ---- expression tokenizing/parsing ------------------------------------

const TOKEN_RE = /\s*(\.\.|@(?:[<>]|[+-]?\d+)(?:\$(?:[<>]|\d+))?|\$(?:[<>]|\d+)|\d+\.?\d*|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/^,])\s*/y;

/** Tokenizes an RHS expression -- numbers, cell/range references
 *  (kept as single tokens, not decomposed further here), function
 *  names, and operators/punctuation. Throws on any character that
 *  doesn't match one of those shapes, rather than silently skipping
 *  it -- a malformed formula should surface as an error, not quietly
 *  evaluate to something the person never actually wrote. */
function tokenize(expr) {
  const tokens = [];
  let pos = 0;
  TOKEN_RE.lastIndex = 0;
  while (pos < expr.length) {
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
const AGGREGATE_FUNCTIONS = {
  vsum: (vals) => vals.reduce((a, b) => a + b, 0),
  vmean: (vals) => (vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length),
  vcount: (vals) => vals.length,
  vmin: (vals) => (vals.length === 0 ? 0 : Math.min(...vals)),
  vmax: (vals) => (vals.length === 0 ? 0 : Math.max(...vals)),
  vmedian: (vals) => {
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
  vvar: (vals) => sampleVariance(vals),
  vpvar: (vals) => populationVariance(vals),
  vsdev: (vals) => Math.sqrt(sampleVariance(vals)),
  vpsdev: (vals) => Math.sqrt(populationVariance(vals)),
};

function populationVariance(vals) {
  if (vals.length === 0) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / vals.length;
}

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
const SCALAR_FUNCTIONS = {
  sqrt: (x) => (x < 0 ? 0 : Math.sqrt(x)), // real Calc returns a complex number for a negative input; this app has no complex-number support at all, so 0 rather than NaN, matching every other "can't produce a real result" case in this module
  floor: (x, digits) => roundToDigits(x, digits, Math.floor),
  ceil: (x, digits) => roundToDigits(x, digits, Math.ceil),
  round: (x, digits) => roundToDigits(x, digits, roundHalfAwayFromZero),
  trunc: (x, digits) => roundToDigits(x, digits, Math.trunc),
};

function roundHalfAwayFromZero(x) {
  // Math.round rounds -0.5 UP to -0 (toward +Infinity); real Calc's
  // own documented convention is "away from zero" for an exact tie
  // (confirmed directly against the manual: "3.5 R produces 4... -3.5
  // R produces -4"), which disagree on the negative case specifically.
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

function roundToDigits(x, digits, roundFn) {
  const d = digits === undefined ? 0 : digits;
  const factor = Math.pow(10, d);
  return roundFn(x * factor) / factor;
}

/** Parses a single reference token (already known to start with "@" or
 *  "$") into a resolvable ref descriptor: { row, col } where each of
 *  row/col is either a parsed ref object (see parseRowRef/parseColRef
 *  above) or null (col is null for a bare "@N" token -- not actually
 *  valid on its own as a real reference, but parseRef doesn't see
 *  that far ahead; row is null for a bare "$N" token, meaning "the
 *  current row", resolved later by the evaluator). */
function parseRef(token) {
  const atMatch = /^@([<>]|[+-]?\d+)(?:\$([<>]|\d+))?$/.exec(token);
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

/** Recursive-descent parser: expr := term (('+'|'-') term)*
 *                             term := power (('*'|'/') power)*
 *                             power := unary ('^' power)?  (right-assoc)
 *                             unary := '-' unary | atom
 *                             atom  := number | ref | range | func '(' args ')' | '(' expr ')'
 *  Builds a plain AST of tagged objects; see evaluateAst for the
 *  actual evaluation. Throws with a position-free but otherwise
 *  descriptive message on any malformed input -- good enough to
 *  surface as a status message, not meant to pinpoint an exact
 *  column the way a real compiler's own diagnostics would. */
function parseExpression(tokens) {
  let pos = 0;
  function peek() {
    return tokens[pos];
  }
  function next() {
    return tokens[pos++];
  }
  function expect(tok) {
    if (next() !== tok) throw new Error(`Expected "${tok}" in formula`);
  }

  function parseExpr() {
    let node = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      node = { type: 'binop', op, left: node, right: parseTerm() };
    }
    return node;
  }
  function parseTerm() {
    let node = parsePower();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      node = { type: 'binop', op, left: node, right: parsePower() };
    }
    return node;
  }
  function parsePower() {
    const node = parseUnary();
    if (peek() === '^') {
      next();
      return { type: 'binop', op: '^', left: node, right: parsePower() }; // right-associative: 2^3^2 = 2^(3^2)
    }
    return node;
  }
  function parseUnary() {
    if (peek() === '-') {
      next();
      return { type: 'neg', operand: parseUnary() };
    }
    return parseAtom();
  }
  function parseAtom() {
    const tok = peek();
    if (tok === undefined) throw new Error('Unexpected end of formula');
    if (tok === '(') {
      next();
      const node = parseExpr();
      expect(')');
      return node;
    }
    if (/^\d/.test(tok)) {
      next();
      return { type: 'number', value: Number(tok) };
    }
    if (/^[A-Za-z_]/.test(tok)) {
      const name = next().toLowerCase();
      const isAggregate = name in AGGREGATE_FUNCTIONS;
      const isScalar = name in SCALAR_FUNCTIONS;
      if (!isAggregate && !isScalar) throw new Error(`Unknown function "${name}" in formula`);
      expect('(');
      if (isAggregate) {
        const arg = parseExpr();
        expect(')');
        return { type: 'call', name, arg };
      }
      // Scalar: 1 or 2 comma-separated plain-expression arguments (value, optional decimal-places).
      const args = [parseExpr()];
      while (peek() === ',') {
        next();
        args.push(parseExpr());
      }
      expect(')');
      if (args.length > 2) throw new Error(`"${name}" takes at most 2 arguments, got ${args.length}`);
      return { type: 'scalarCall', name, args };
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
 *  a file between them silently produces different numbers. */
function isCellBlank(dataRows, row, col) {
  const text = (dataRows[row - 1] && dataRows[row - 1].cells[col - 1]) || '';
  return text.trim() === '';
}

/** Reads one resolved (row, col) cell's own current numeric value for
 *  a PLAIN, direct reference in ordinary arithmetic (not part of a
 *  range -- see isCellBlank above and collectRangeValues below for
 *  that separate case) -- blank cell text is treated as 0, matching
 *  real org's own actual default behavior for this specific case
 *  (confirmed directly against the Org Manual's own wording: "'E' is
 *  required to NOT convert empty fields to 0" -- without E, which
 *  this app never implements, a blank plain reference IS 0 by
 *  default). Non-numeric-but-present text (a stray label cell, say)
 *  is ALSO treated as 0 here -- real org would actually error trying
 *  to add a label to a number; treating it as 0 instead is a
 *  deliberate, documented simplification of this module's own (so a
 *  stray label elsewhere in a table doesn't break every other formula
 *  referencing it), not an attempt at exact real-org error behavior. */
function readCellNumber(dataRows, row, col) {
  const text = (dataRows[row - 1] && dataRows[row - 1].cells[col - 1]) || '';
  const n = Number(text.trim());
  return text.trim() === '' || Number.isNaN(n) ? 0 : n;
}

/** Expands a { row, col } ref descriptor (row and/or col possibly
 *  null, meaning "the current row"/never valid for col) into an
 *  actual resolved (row, col) pair, given the row this evaluation is
 *  currently centered on. Throws if either half can't be resolved
 *  (out of range, or a column-only ref used somewhere a row is
 *  required). */
function resolveRef(ref, currentRow, dataRowCount, colCount) {
  const row = ref.row === null ? currentRow : resolveRowRef(ref.row, currentRow, dataRowCount);
  const col = resolveColRef(ref.col, colCount);
  if (row === null) throw new Error('Row reference out of range in formula');
  if (col === null) throw new Error('Column reference out of range in formula');
  return { row, col };
}

function evaluateAst(node, ctx) {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'neg':
      return -evaluateAst(node.operand, ctx);
    case 'binop': {
      const l = evaluateAst(node.left, ctx);
      const r = evaluateAst(node.right, ctx);
      if (node.op === '+') return l + r;
      if (node.op === '-') return l - r;
      if (node.op === '*') return l * r;
      if (node.op === '/') return r === 0 ? 0 : l / r; // division by zero: 0, not Infinity/NaN -- a spreadsheet-style error value has nowhere to live in a plain org table cell
      if (node.op === '^') return Math.pow(l, r);
      throw new Error(`Unknown operator "${node.op}"`);
    }
    case 'ref': {
      const { row, col } = resolveRef(node.ref, ctx.currentRow, ctx.dataRowCount, ctx.colCount);
      return readCellNumber(ctx.dataRows, row, col);
    }
    case 'range': {
      throw new Error('A range can only be used as an aggregate function\u2019s own argument, not as a plain value');
    }
    case 'call': {
      const fn = AGGREGATE_FUNCTIONS[node.name];
      const values = collectRangeValues(node.arg, ctx);
      return fn(values);
    }
    case 'scalarCall': {
      const fn = SCALAR_FUNCTIONS[node.name];
      const argValues = node.args.map((a) => evaluateAst(a, ctx));
      return fn(...argValues);
    }
    default:
      throw new Error(`Unknown AST node type "${node.type}"`);
  }
}

/** Collects every value a range (or, degenerately, a single ref) spans
 *  -- an aggregate function's own argument, evaluated as a list of
 *  numbers rather than a single one. Iterates in reading order (row
 *  by row, left to right within each row), matching how a person
 *  would naturally read the range they wrote. */
function collectRangeValues(argNode, ctx) {
  if (argNode.type === 'ref') {
    const { row, col } = resolveRef(argNode.ref, ctx.currentRow, ctx.dataRowCount, ctx.colCount);
    return isCellBlank(ctx.dataRows, row, col) ? [] : [readCellNumber(ctx.dataRows, row, col)];
  }
  if (argNode.type !== 'range') {
    // A plain arithmetic expression as an aggregate's own argument (e.g. vsum($1+$2)) --
    // real org supports this too; evaluate it as one single value.
    return [evaluateAst(argNode, ctx)];
  }
  const from = resolveRef(argNode.from, ctx.currentRow, ctx.dataRowCount, ctx.colCount);
  const to = resolveRef(argNode.to, ctx.currentRow, ctx.dataRowCount, ctx.colCount);
  const rowStart = Math.min(from.row, to.row);
  const rowEnd = Math.max(from.row, to.row);
  const colStart = Math.min(from.col, to.col);
  const colEnd = Math.max(from.col, to.col);
  const values = [];
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      if (!isCellBlank(ctx.dataRows, r, c)) values.push(readCellNumber(ctx.dataRows, r, c));
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
 *  Real org's own optional ";%.2f"-style per-formula format specifier
 *  IS now implemented -- see parseFormatSpec/applyFormatSpec below --
 *  this default is only ever used when a formula has no such
 *  specifier of its own. */

const FORMAT_SPEC_RE = /^%0?\.(\d+)f$|^%d$/;

/** Parses a real org "%.Nf" or "%d" format specifier (the part after
 *  the formula's own trailing ";", already split off by
 *  parseFormulaStatement below) into { type: 'fixed', digits } |
 *  { type: 'integer' } | null (anything else -- an unrecognized
 *  specifier, or real org's own other, unimplemented mode letters
 *  like E/N/f-1 -- silently falls through to this module's own
 *  existing default formatting instead, the same tolerant handling
 *  this module already gives an unrecognized aggregate-function name
 *  no chance to opt out of). */
function parseFormatSpec(suffix) {
  const trimmed = suffix.trim();
  const m = FORMAT_SPEC_RE.exec(trimmed);
  if (!m) return null;
  return m[1] !== undefined ? { type: 'fixed', digits: Number(m[1]) } : { type: 'integer' };
}

/** Formats `n` per an explicit, real org format specifier -- "%.Nf"
 *  (fixed N decimal places, confirmed directly against both the Org
 *  Manual's own wording and a real, published org file using this
 *  exact syntax) or "%d" (integer; the exact rounding rule isn't
 *  independently source-confirmed the way "%.Nf" is, so round-to-
 *  nearest is used as the most defensible choice, not a confirmed
 *  match to real Calc's own exact behavior). */
function applyFormatSpec(n, spec) {
  if (spec.type === 'fixed') return n.toFixed(spec.digits);
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

function formatResult(n) {
  if (Number.isInteger(n)) return String(n);
  const SIGNIFICANT_FIGURES = 8;
  const precise = n.toPrecision(SIGNIFICANT_FIGURES);
  // toPrecision always pads to exactly 8 significant figures
  // ("1.5000000"), and switches to exponential notation for an
  // extreme magnitude ("1.234e-7") -- trailing zeros are stripped
  // from the mantissa either way (a plain result and an exponential
  // one both get the same cleanup), for a cleaner, still-equivalent
  // result rather than always showing every padded digit.
  const eIndex = precise.search(/e/i);
  const mantissa = eIndex === -1 ? precise : precise.slice(0, eIndex);
  const suffix = eIndex === -1 ? '' : precise.slice(eIndex);
  const cleanedMantissa = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa;
  return cleanedMantissa + suffix;
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
function parseFormulaStatement(statement) {
  const eq = statement.indexOf('=');
  if (eq === -1) throw new Error(`Malformed formula, no "=": "${statement}"`);
  const lhs = statement.slice(0, eq).trim();
  let rhs = statement.slice(eq + 1).trim();
  const formatSuffix = /;[^;]*$/.exec(rhs);
  let formatSpec = null;
  if (formatSuffix) {
    rhs = rhs.slice(0, formatSuffix.index).trim();
    formatSpec = parseFormatSpec(formatSuffix[0].slice(1)); // slice(1): drop the leading ";" itself
  }

  let target;
  const cellMatch = /^@([<>]|[+-]?\d+)\$([<>]|\d+)$/.exec(lhs);
  const colMatch = /^\$([<>]|\d+)$/.exec(lhs);
  if (cellMatch) {
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

  const expr = parseExpression(tokenize(rhs));
  return { target, expr, formatSpec };
}

/** Splits a full #+TBLFM: value on "::" (real org's own multi-formula
 *  separator) and parses each segment. Throws on the first malformed
 *  segment -- see recalculateTable's own docs for how a caller should
 *  handle that (the whole recalculation is abandoned, not partially
 *  applied). */
function parseTblfm(tblfm) {
  return tblfm
    .split('::')
    .map((s) => s.trim())
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
export function recalculateTable(table) {
  if (!table.tblfm || !table.tblfm.trim()) return null;
  const statements = parseTblfm(table.tblfm);

  // A working copy: same row objects' own shape, but with a fresh
  // `cells` array per row so evaluating one formula can't accidentally
  // mutate a row a caller might still be holding a reference to.
  const workingRows = table.rows.map((row) => (row.type === 'row' ? { ...row, cells: [...row.cells] } : row));
  // Any row before the table's own first hline is a HEADER row, real
  // org's own actual documented convention exactly (confirmed against
  // the Org Manual: "Any lines before the first hline are left alone,
  // assuming that these are part of the table header") -- excluded
  // from @N numbering and column-formula application entirely, the
  // same as body-edit.js's own isTableHeaderRow already treats it for
  // bold-rendering. No hline anywhere at all means no header, and
  // every row counts as data, matching that same convention too.
  const firstRuleIndex = workingRows.findIndex((r) => r.type === 'rule');
  const dataRows = workingRows.filter((r, i) => r.type === 'row' && (firstRuleIndex === -1 || i >= firstRuleIndex));
  const dataRowCount = dataRows.length;
  const colCount = dataRows.reduce((max, r) => Math.max(max, r.cells.length), 0);

  for (const { target, expr, formatSpec } of statements) {
    if (target.type === 'cell') {
      const row = resolveRowRef(target.row, 1, dataRowCount); // currentRow=1 is a placeholder -- an explicit @N$M target is never itself relative
      const col = resolveColRef(target.col, colCount);
      if (row === null || col === null) throw new Error('Formula target is out of range for this table');
      const value = evaluateAst(expr, { dataRows, dataRowCount, colCount, currentRow: row });
      dataRows[row - 1].cells[col - 1] = formatSpec ? applyFormatSpec(value, formatSpec) : formatResult(value);
    } else {
      // Column-formula shorthand: apply to every data row, each computing $M from ITS OWN row.
      const col = resolveColRef(target.col, colCount);
      if (col === null) throw new Error('Formula target column is out of range for this table');
      for (let r = 1; r <= dataRowCount; r++) {
        const value = evaluateAst(expr, { dataRows, dataRowCount, colCount, currentRow: r });
        dataRows[r - 1].cells[col - 1] = formatSpec ? applyFormatSpec(value, formatSpec) : formatResult(value);
      }
    }
  }

  return workingRows;
}
