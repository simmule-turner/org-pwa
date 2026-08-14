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

const AGGREGATE_FUNCTIONS = {
  sum: (vals) => vals.reduce((a, b) => a + b, 0),
  vsum: (vals) => vals.reduce((a, b) => a + b, 0),
  mean: (vals) => (vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length),
  vmean: (vals) => (vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length),
  count: (vals) => vals.length,
  vcount: (vals) => vals.length,
  min: (vals) => Math.min(...vals),
  vmin: (vals) => Math.min(...vals),
  max: (vals) => Math.max(...vals),
  vmax: (vals) => Math.max(...vals),
};

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
      if (!(name in AGGREGATE_FUNCTIONS)) throw new Error(`Unknown function "${name}" in formula`);
      expect('(');
      const arg = parseExpr();
      expect(')');
      return { type: 'call', name, arg };
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
    return [readCellNumber(ctx.dataRows, row, col)];
  }
  if (argNode.type !== 'range') {
    // A plain arithmetic expression as an aggregate's own argument (e.g. sum($1+$2)) --
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
      values.push(readCellNumber(ctx.dataRows, r, c));
    }
  }
  return values;
}

/** Formats a computed numeric result back into cell text -- an
 *  integer stays a bare integer ("4", not "4.0" or "4.000000000001"
 *  from ordinary floating-point division noise), a non-integer
 *  rounds to a reasonable, readable precision. Real org's own
 *  optional ";%.2f"-style per-formula format specifier isn't
 *  implemented here -- a deliberate, documented scope cut, not an
 *  oversight; this fixed, reasonable default covers the common case
 *  without it. */
function formatResult(n) {
  if (Number.isInteger(n)) return String(n);
  // 6 significant decimal places, then strip trailing zeros -- enough
  // to make ordinary division (e.g. 10/3) readable without an
  // unbounded string of floating-point noise digits.
  return String(Math.round(n * 1e6) / 1e6);
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
  if (formatSuffix) rhs = rhs.slice(0, formatSuffix.index).trim();

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
  return { target, expr };
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
  const dataRows = workingRows.filter((r) => r.type === 'row');
  const dataRowCount = dataRows.length;
  const colCount = dataRows.reduce((max, r) => Math.max(max, r.cells.length), 0);

  for (const { target, expr } of statements) {
    if (target.type === 'cell') {
      const row = resolveRowRef(target.row, 1, dataRowCount); // currentRow=1 is a placeholder -- an explicit @N$M target is never itself relative
      const col = resolveColRef(target.col, colCount);
      if (row === null || col === null) throw new Error('Formula target is out of range for this table');
      const value = evaluateAst(expr, { dataRows, dataRowCount, colCount, currentRow: row });
      dataRows[row - 1].cells[col - 1] = formatResult(value);
    } else {
      // Column-formula shorthand: apply to every data row, each computing $M from ITS OWN row.
      const col = resolveColRef(target.col, colCount);
      if (col === null) throw new Error('Formula target column is out of range for this table');
      for (let r = 1; r <= dataRowCount; r++) {
        const value = evaluateAst(expr, { dataRows, dataRowCount, colCount, currentRow: r });
        dataRows[r - 1].cells[col - 1] = formatResult(value);
      }
    }
  }

  return workingRows;
}
