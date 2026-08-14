import test from 'node:test';
import assert from 'node:assert/strict';
import { recalculateTable } from '../src/table-formula.js';

function mkTable(tblfm, rowsData) {
  return { tblfm, rows: rowsData.map((r) => (r === null ? { type: 'rule' } : { type: 'row', cells: r })) };
}
function cellsOf(rows) {
  return rows.map((r) => (r.type === 'rule' ? '---' : r.cells));
}

// ---- no-op / basic shape -------------------------------------------------

test('a table with no #+TBLFM: at all returns null -- nothing to do', () => {
  assert.equal(recalculateTable(mkTable('', [['1', '2']])), null);
  assert.equal(recalculateTable(mkTable('   ', [['1', '2']])), null);
  assert.equal(recalculateTable({ rows: [{ type: 'row', cells: ['1'] }] }), null); // tblfm entirely absent, not just blank
});

test('the original table object is never mutated -- a pure function', () => {
  const t = mkTable('@1$3=$1+$2', [['3', '4', '']]);
  const before = JSON.stringify(t.rows);
  recalculateTable(t);
  assert.equal(JSON.stringify(t.rows), before);
});

// ---- basic arithmetic -----------------------------------------------------

test('explicit @N$M target with a plain arithmetic RHS', () => {
  const result = recalculateTable(mkTable('@1$3=$1+$2', [['3', '4', '']]));
  assert.deepEqual(cellsOf(result), [['3', '4', '7']]);
});

test('operator precedence: * before +', () => {
  const result = recalculateTable(mkTable('@1$1=2+3*4', [['']]));
  assert.equal(result[0].cells[0], '14');
});

test('parentheses override precedence', () => {
  const result = recalculateTable(mkTable('@1$1=(2+3)*4', [['']]));
  assert.equal(result[0].cells[0], '20');
});

test('^ is right-associative: 2^3^2 = 2^(3^2) = 512, not (2^3)^2 = 64', () => {
  const result = recalculateTable(mkTable('@1$1=2^3^2', [['']]));
  assert.equal(result[0].cells[0], '512');
});

test('unary minus', () => {
  const result = recalculateTable(mkTable('@1$1=-$1+10', [['3']]));
  assert.equal(result[0].cells[0], '7');
});

test('division by zero yields 0, not Infinity/NaN -- there is nowhere for a spreadsheet-style error value to live in a plain cell', () => {
  const result = recalculateTable(mkTable('@1$1=$2/$3', [['', '5', '0']]));
  assert.equal(result[0].cells[0], '0');
});

// ---- non-numeric / blank cells --------------------------------------------

test('blank cells are treated as 0 in arithmetic, not NaN', () => {
  const result = recalculateTable(mkTable('@1$3=$1+$2', [['', '', '']]));
  assert.equal(result[0].cells[2], '0');
});

test('non-numeric text (a label cell) is treated as 0, not NaN', () => {
  const result = recalculateTable(mkTable('@1$3=$1+$2', [['label', '5', '']]));
  assert.equal(result[0].cells[2], '5');
});

// ---- column-formula shorthand ---------------------------------------------

test('THE column-formula shorthand ("$M=", no "@" at all) applies to every data row', () => {
  const result = recalculateTable(mkTable('$3=$1+$2', [['3', '4', ''], ['5', '6', ''], ['1', '1', '']]));
  assert.deepEqual(
    cellsOf(result),
    [
      ['3', '4', '7'],
      ['5', '6', '11'],
      ['1', '1', '2'],
    ]
  );
});

// ---- aggregate functions ---------------------------------------------------

test('sum() over a range', () => {
  const result = recalculateTable(mkTable('@3$1=sum(@1$1..@2$1)', [['3'], ['4'], ['']]));
  assert.equal(result[2].cells[0], '7');
});

test('vsum is a recognized synonym for sum (real org/Calc\u2019s own vector-function naming)', () => {
  const result = recalculateTable(mkTable('@3$1=vsum(@1$1..@2$1)', [['3'], ['4'], ['']]));
  assert.equal(result[2].cells[0], '7');
});

test('mean()/vmean() over a range', () => {
  const result = recalculateTable(mkTable('@4$1=mean(@1$1..@3$1)', [['2'], ['4'], ['6'], ['']]));
  assert.equal(result[3].cells[0], '4');
});

test('count()/vcount() over a range -- counts cells, not their values', () => {
  const result = recalculateTable(mkTable('@4$1=count(@1$1..@3$1)', [['5'], ['5'], ['5'], ['']]));
  assert.equal(result[3].cells[0], '3');
});

test('min() and max() over a range', () => {
  const result = recalculateTable(mkTable('@4$1=min(@1$1..@3$1)::@4$2=max(@1$1..@3$1)', [['3', ''], ['1', ''], ['5', ''], ['', '']]));
  assert.equal(result[3].cells[0], '1');
  assert.equal(result[3].cells[1], '5');
});

test('a 2D range (spanning both rows and columns) collects every cell within it, in reading order', () => {
  const result = recalculateTable(mkTable('@3$3=sum(@1$1..@2$2)', [['1', '2', ''], ['3', '4', ''], ['', '', '']]));
  assert.equal(result[2].cells[2], '10'); // 1+2+3+4
});

test('a plain arithmetic expression as an aggregate\u2019s own argument is evaluated as one single value', () => {
  const result = recalculateTable(mkTable('@1$3=sum($1+$2)', [['3', '4', '']]));
  assert.equal(result[0].cells[2], '7');
});

// ---- references: relative, edge --------------------------------------------

test('relative row reference @-1 (one row above the current formula\u2019s own target)', () => {
  const result = recalculateTable(mkTable('@2$2=@-1$2+10', [['', '5'], ['', '']]));
  assert.equal(result[1].cells[1], '15');
});

test('relative row reference @+1 (one row below)', () => {
  const result = recalculateTable(mkTable('@1$2=@+1$2+10', [['', ''], ['', '5']]));
  assert.equal(result[0].cells[1], '15');
});

test('edge references @< @> $< $>', () => {
  const result = recalculateTable(mkTable('@>$>=@<$<+1', [['10', '20'], ['', '']]));
  assert.equal(result[1].cells[1], '11');
});

test('a bare "$N" inside an expression (no "@") means the CURRENT row, applied per-row via the column-formula shorthand', () => {
  const result = recalculateTable(mkTable('$2=$1*2', [['3', ''], ['5', '']]));
  assert.deepEqual(cellsOf(result), [
    ['3', '6'],
    ['5', '10'],
  ]);
});

// ---- hlines / row numbering -------------------------------------------------

test('THE FIX: a horizontal rule (hline) never gets its own row number -- @N always counts DATA rows only, matching real org', () => {
  const result = recalculateTable(mkTable('@4$1=sum(@1$1..@3$1)', [['1'], ['2'], null, ['3'], ['']]));
  assert.equal(cellsOf(result)[2], '---', 'the rule itself is preserved untouched, at its own original position');
  assert.equal(result[4].cells[0], '6', '@4 correctly refers to the 4th DATA row (the blank one after "3"), not the 4th array position');
});

// ---- multiple formulas / chaining --------------------------------------------

test('multiple formulas in one #+TBLFM: line, separated by "::", are all applied', () => {
  const result = recalculateTable(mkTable('@1$1=1+1::@1$2=2+2', [['', '']]));
  assert.deepEqual(cellsOf(result), [['2', '4']]);
});

test('THE FIX: formulas are evaluated in written order, and a later formula sees an earlier one\u2019s already-updated value within the same pass', () => {
  const result = recalculateTable(mkTable('$2=$1*2::$3=$2+1', [['5', '', '']]));
  assert.deepEqual(cellsOf(result), [['5', '10', '11']]);
});

// ---- number formatting -------------------------------------------------------

test('an integer result stays a bare integer, not "4.0" or floating-point noise', () => {
  const result = recalculateTable(mkTable('@1$1=2+2', [['']]));
  assert.equal(result[0].cells[0], '4');
});

test('a non-integer result rounds to a reasonable, readable precision rather than showing raw floating-point noise', () => {
  const result = recalculateTable(mkTable('@1$1=$1/$2', [['10', '3', '']]));
  assert.equal(result[0].cells[0], '3.333333');
});

// ---- the ";format" suffix is parsed off, not left dangling -----------------

test('a real org ";format" specifier is recognized and stripped rather than breaking the expression parse -- not actually applied (a documented scope cut), but harmless either way', () => {
  const result = recalculateTable(mkTable('@1$1=$1+$2;%.2f', [['3', '4']]));
  assert.equal(result[0].cells[0], '7');
});

// ---- error handling -----------------------------------------------------------

test('a malformed formula (trailing operator, no right-hand operand) throws rather than silently producing garbage', () => {
  assert.throws(() => recalculateTable(mkTable('$1=1+', [['']])));
});

test('an out-of-range row reference throws', () => {
  assert.throws(() => recalculateTable(mkTable('@1$1=@5$1', [['1']])));
});

test('an unknown function name throws', () => {
  assert.throws(() => recalculateTable(mkTable('@1$1=frobnicate(@1$1..@1$1)', [['1']])));
});

test('a formula target missing "=" entirely throws', () => {
  assert.throws(() => recalculateTable(mkTable('$1 5', [['']])));
});

test('a range used as a plain value (not inside an aggregate function) throws -- a range is a list, not a single number', () => {
  assert.throws(() => recalculateTable(mkTable('@1$1=@1$1..@2$1', [['1'], ['2']])));
});

test('an unrecognized character in a formula throws', () => {
  assert.throws(() => recalculateTable(mkTable('@1$1=$1 & $2', [['1', '2']])));
});
