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

test('vsum() over a range', () => {
  const result = recalculateTable(mkTable('@3$1=vsum(@1$1..@2$1)', [['3'], ['4'], ['']]));
  assert.equal(result[2].cells[0], '7');
});

test('vmean() over a range', () => {
  const result = recalculateTable(mkTable('@4$1=vmean(@1$1..@3$1)', [['2'], ['4'], ['6'], ['']]));
  assert.equal(result[3].cells[0], '4');
});

test('vcount() over a range -- counts cells, not their values', () => {
  const result = recalculateTable(mkTable('@4$1=vcount(@1$1..@3$1)', [['5'], ['5'], ['5'], ['']]));
  assert.equal(result[3].cells[0], '3');
});

test('vmin() and vmax() over a range', () => {
  const result = recalculateTable(mkTable('@4$1=vmin(@1$1..@3$1)::@4$2=vmax(@1$1..@3$1)', [['3', ''], ['1', ''], ['5', ''], ['', '']]));
  assert.equal(result[3].cells[0], '1');
  assert.equal(result[3].cells[1], '5');
});

test('a 2D range (spanning both rows and columns) collects every cell within it, in reading order', () => {
  const result = recalculateTable(mkTable('@3$3=vsum(@1$1..@2$2)', [['1', '2', ''], ['3', '4', ''], ['', '', '']]));
  assert.equal(result[2].cells[2], '10'); // 1+2+3+4
});

test('a plain arithmetic expression as an aggregate\u2019s own argument is evaluated as one single value', () => {
  const result = recalculateTable(mkTable('@1$3=vsum($1+$2)', [['3', '4', '']]));
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
  // Header row, then first hline (defines the header boundary), then
  // data rows with a SECOND hline mid-data (a group separator, which
  // must NOT reset numbering or count as its own row either).
  const result = recalculateTable(mkTable('@4$1=vsum(@1$1..@3$1)', [['H'], null, ['1'], ['2'], null, ['3'], ['']]));
  assert.equal(cellsOf(result)[1], '---', 'the first (header-defining) rule is preserved untouched, at its own original position');
  assert.equal(cellsOf(result)[4], '---', 'the second (mid-data) rule is also preserved untouched');
  assert.equal(result[6].cells[0], '6', '@4 correctly refers to the 4th DATA row (the blank one after "3"), counting only 1/2/3/blank -- not the header, and not either rule');
});

test('THE FIX: a header row (any row before the table\u2019s own first hline) is excluded entirely from @N numbering and column-formula application -- a real, confirmed bug found and fixed: a header row\u2019s own label text was silently getting overwritten with a computed number', () => {
  const result = recalculateTable(mkTable('$2=($1-32)*5/9', [['Fahrenheit', 'Celsius'], null, ['32', ''], ['212', '']]));
  assert.deepEqual(cellsOf(result)[0], ['Fahrenheit', 'Celsius'], 'the header row\u2019s own text must be completely untouched, not overwritten with a computed value');
  assert.equal(result[2].cells[1], '0', 'the actual data rows are still correctly computed');
  assert.equal(result[3].cells[1], '100');
});

test('a table with NO hline anywhere at all has no header row -- every row counts as data, matching real org\u2019s own documented convention exactly', () => {
  const result = recalculateTable(mkTable('$2=$1*2', [['3', ''], ['5', '']]));
  assert.deepEqual(cellsOf(result), [
    ['3', '6'],
    ['5', '10'],
  ]);
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

test('THE FIX: a non-integer result is formatted to 8 significant figures, matching real org\u2019s own actual documented default (Calc\u2019s "(float 8)" mode) -- not an arbitrary decimal-places rule', () => {
  const result = recalculateTable(mkTable('@1$1=$1/$2', [['10', '3', '']]));
  assert.equal(result[0].cells[0], '3.3333333', '8 significant figures: 3,3,3,3,3,3,3 after the leading 3');
});

test('THE FIX: the exact concrete divergence identified in this project\u2019s own portability audit is now fixed -- 370/3 previously wrote "123.333333" (9 significant figures, "6 digits after the decimal point" instead of real org\u2019s own actual rule), a genuinely different rounding RULE from real org\u2019s, not just a different number, that only happened to coincide for results roughly between 1 and 10', () => {
  const result = recalculateTable(mkTable('@1$2=$1/3', [['370.0', '']]));
  assert.equal(result[0].cells[1], '123.33333', 'real org\u2019s own actual default: exactly 8 significant figures');
});

test('THE FIX: exact, character-for-character cross-check against a real, published org-mode example\u2019s own actual output (not just internally self-consistent math) -- sum/mean/median/sample-stddev of [1,2,4,2,3,1,4,1,5]', () => {
  const vals = [1, 2, 4, 2, 3, 1, 4, 1, 5];
  const rows = vals.map((v) => [String(v)]);
  rows.push(['']);
  rows.push(['']);
  rows.push(['']);
  rows.push(['']);
  const result = recalculateTable(
    mkTable('@10$1=vsum(@1$1..@9$1)::@11$1=vmean(@1$1..@9$1)::@12$1=vmedian(@1$1..@9$1)::@13$1=vsdev(@1$1..@9$1)', rows)
  );
  assert.equal(result[9].cells[0], '23', 'SUM, per the real, published example');
  assert.equal(result[10].cells[0], '2.5555556', 'MEAN, per the real, published example -- exact match, not approximate');
  assert.equal(result[11].cells[0], '2', 'MEDIAN, per the real, published example');
  assert.equal(result[12].cells[0], '1.5092309', 'STD DEV (sample, vsdev), per the real, published example -- exact match, not approximate');
});

// ---- THE FIX: format specifiers are now actually applied, not just stripped -----------------

test('THE FIX: a real org ";%.Nf" format specifier is now actually applied, matching printf-style fixed decimal formatting', () => {
  const result = recalculateTable(mkTable('@1$1=$1+$2;%.2f', [['3', '4']]));
  assert.equal(result[0].cells[0], '7.00');
});

test('THE FIX: real, published-example syntax "%0.Nf" (a leading zero flag) is also recognized, not just the bare "%.Nf" form', () => {
  const result = recalculateTable(mkTable('@3$1=vsum(@1$1..@2$1);%0.1f', [['0.5'], ['1.5'], ['']]));
  assert.equal(result[2].cells[0], '2.0', 'exact match to a real, published org file using this exact syntax');
});

test('THE FIX: ";%d" formats a result as an integer', () => {
  const result = recalculateTable(mkTable('@1$1=$1/$2;%d', [['10', '3']]));
  assert.equal(result[0].cells[0], '3');
});

test('THE FIX: ";%d" truncates toward zero, not round-to-nearest -- 4.85 truncates to 4, not 5', () => {
  const result = recalculateTable(mkTable('@1$2=$1;%d', [['4.85', '']]));
  assert.equal(result[0].cells[1], '4');
});

test('THE FIX: ";%d" truncation, negative number -- the case that actually distinguishes truncate from round: -4.85 truncates to -4 (toward zero), NOT -5 (which round-to-nearest would give)', () => {
  const result = recalculateTable(mkTable('@1$2=$1;%d', [['-4.85', '']]));
  assert.equal(result[0].cells[1], '-4');
});

test('THE FIX: explicitly calling round()/ceil()/floor() before ";%d" still produces the expected rounded/ceiling/floor value -- %d itself is then just a no-op truncation on an already-integer result', () => {
  const result = recalculateTable(
    mkTable('@1$1=round($4);%d::@1$2=ceil($4);%d::@1$3=floor($4);%d', [['', '', '', '-4.85']])
  );
  assert.equal(result[0].cells[0], '-5', 'round(-4.85) rounds to nearest, ties away from zero');
  assert.equal(result[0].cells[1], '-4', 'ceil(-4.85) rounds toward +Infinity');
  assert.equal(result[0].cells[2], '-5', 'floor(-4.85) rounds toward -Infinity');
});

test('a formula with NO format specifier at all still uses the default 8-significant-figure formatting, unaffected by this feature', () => {
  const result = recalculateTable(mkTable('@1$1=$1/$2', [['10', '3']]));
  assert.equal(result[0].cells[0], '3.3333333');
});

test('an unrecognized specifier (real org\u2019s own other, unimplemented mode letters) is harmlessly ignored, falling back to the default formatting rather than throwing', () => {
  const result = recalculateTable(mkTable('@1$1=$1+$2;E', [['3', '4']]));
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

// ---- THE FIX: scalar functions (single value in, single value out) -------

test('sqrt() computes a square root', () => {
  const result = recalculateTable(mkTable('@1$2=sqrt($1)', [['16', '']]));
  assert.equal(result[0].cells[1], '4');
});

test('sqrt() of a negative number returns 0, not NaN -- real Calc would return a complex number, which this app has no representation for at all', () => {
  const result = recalculateTable(mkTable('@1$2=sqrt($1)', [['-4', '']]));
  assert.equal(result[0].cells[1], '0');
});

test('floor()/ceil()/round()/trunc() with no second argument, matching real Calc\u2019s own documented single-argument behavior', () => {
  const result = recalculateTable(
    mkTable('@1$1=floor($5)::@1$2=ceil($5)::@1$3=round($5)::@1$4=trunc($5)', [['', '', '', '', '3.6']])
  );
  assert.equal(result[0].cells[0], '3', 'floor(3.6)');
  assert.equal(result[0].cells[1], '4', 'ceil(3.6)');
  assert.equal(result[0].cells[2], '4', 'round(3.6)');
  assert.equal(result[0].cells[3], '3', 'trunc(3.6)');
});

test('floor()/ceil() correctly differ from trunc() for a negative number -- floor toward -Infinity, ceil toward +Infinity, trunc toward zero', () => {
  const result = recalculateTable(mkTable('@1$1=floor($4)::@1$2=ceil($4)::@1$3=trunc($4)', [['', '', '', '-3.6']]));
  assert.equal(result[0].cells[0], '-4', 'floor(-3.6) rounds toward -Infinity');
  assert.equal(result[0].cells[1], '-3', 'ceil(-3.6) rounds toward +Infinity');
  assert.equal(result[0].cells[2], '-3', 'trunc(-3.6) rounds toward zero, same direction as ceil here');
});

test('THE FIX: round() ties round AWAY FROM ZERO, matching real Calc\u2019s own documented convention exactly (not JS\u2019s native Math.round, which rounds -0.5 toward +Infinity instead)', () => {
  const result = recalculateTable(mkTable('@1$2=round($1)', [['-3.5', '']]));
  assert.equal(result[0].cells[1], '-4');
});

test('THE FIX: round()/trunc()/floor()/ceil() accept an optional second argument -- decimal places to keep, confirmed real Calc algebraic-formula behavior', () => {
  const result = recalculateTable(
    mkTable('@1$1=round($5,2)::@1$2=trunc($5,1)::@1$3=floor($5,1)::@1$4=ceil($5,1)', [['', '', '', '', '3.14159']])
  );
  assert.equal(result[0].cells[0], '3.14');
  assert.equal(result[0].cells[1], '3.1');
  assert.equal(result[0].cells[2], '3.1');
  assert.equal(result[0].cells[3], '3.2');
});

test('a scalar function called with more than 2 arguments throws', () => {
  assert.throws(() => recalculateTable(mkTable('@1$1=round($1,2,3)', [['3.14159']])));
});

test('an aggregate function name and a scalar function name never collide -- each is looked up in its own registry', () => {
  const result = recalculateTable(mkTable('@1$1=vsum(@1$2..@1$3)::@1$4=sqrt($5)', [['', '2', '3', '', '9']]));
  assert.equal(result[0].cells[0], '5', 'vsum still works as an aggregate');
  assert.equal(result[0].cells[3], '3', 'sqrt still works as a scalar, in the same formula line');
});

// ---- THE FIX: statistical functions (confirmed real Calc names) -----------

test('vmedian() of an odd-length range', () => {
  const result = recalculateTable(mkTable('@6$1=vmedian(@1$1..@5$1)', [['2'], ['4'], ['4'], ['4'], ['5'], ['']]));
  assert.equal(result[5].cells[0], '4');
});

test('vmedian() of an even-length range averages the two middle values', () => {
  const result = recalculateTable(mkTable('@5$1=vmedian(@1$1..@4$1)', [['1'], ['2'], ['3'], ['4'], ['']]));
  assert.equal(result[4].cells[0], '2.5');
});

test('THE FIX: vvar() (sample variance) and vpvar() (population variance) are genuinely different, both confirmed real Calc names -- independently hand-verified math', () => {
  // [2,4,4,4,5]: mean=3.8, squared deviations sum to 4.8
  const result = recalculateTable(mkTable('@6$1=vvar(@1$1..@5$1)::@6$2=vpvar(@1$1..@5$1)', [['2'], ['4'], ['4'], ['4'], ['5'], ['', '']]));
  assert.equal(result[5].cells[0], '1.2', 'sample variance: 4.8 / (5-1)');
  assert.equal(result[5].cells[1], '0.96', 'population variance: 4.8 / 5');
});

test('THE FIX: vsdev() and vpsdev() are the square roots of vvar()/vpvar() respectively', () => {
  const result = recalculateTable(mkTable('@6$1=vsdev(@1$1..@5$1)::@6$2=vpsdev(@1$1..@5$1)', [['2'], ['4'], ['4'], ['4'], ['5'], ['', '']]));
  assert.equal(result[5].cells[0], '1.0954451', 'sqrt(1.2)');
  assert.equal(result[5].cells[1], '0.9797959', 'sqrt(0.96)');
});

test('vvar()/vsdev() (sample, n-1 divisor) of a single-element range is 0, not a division-by-zero NaN/Infinity', () => {
  const result = recalculateTable(mkTable('@2$1=vvar(@1$1..@1$1)::@2$2=vsdev(@1$1..@1$1)', [['5', ''], ['', '']]));
  assert.equal(result[1].cells[0], '0');
  assert.equal(result[1].cells[1], '0');
});

test('vpvar()/vpsdev() (population, n divisor) of a single-element range is correctly 0 -- mathematically well-defined, not a special-cased fallback', () => {
  const result = recalculateTable(mkTable('@2$1=vpvar(@1$1..@1$1)::@2$2=vpsdev(@1$1..@1$1)', [['5', ''], ['', '']]));
  assert.equal(result[1].cells[0], '0');
  assert.equal(result[1].cells[1], '0');
});

test('there is deliberately no plain "variance"/"stddev" name for either the sample or population variant -- an unqualified name is rejected outright, not silently defaulted to one or the other', () => {
  assert.throws(() => recalculateTable(mkTable('@1$1=variance(@1$1..@1$1)', [['5']])));
  assert.throws(() => recalculateTable(mkTable('@1$1=stddev(@1$1..@1$1)', [['5']])));
});

// ---- THE FIX: blank-cell semantics -- matches real org's own actual, documented default exactly -------

test('THE FIX: a blank cell used as a PLAIN, direct reference is treated as 0 -- confirmed directly against the Org Manual\u2019s own wording ("\'E\' is required to NOT convert empty fields to 0")', () => {
  const result = recalculateTable(mkTable('@1$3=$1+$2', [['3', '', '']]));
  assert.equal(result[0].cells[2], '3');
});

test('THE FIX: a blank cell inside a RANGE is OMITTED entirely, not treated as 0 -- confirmed directly against the Org Manual\u2019s own separate wording ("Without \'E\' empty fields in range references are suppressed")', () => {
  const result = recalculateTable(mkTable('@4$1=vsum(@1$1..@3$1)::@4$2=vmean(@1$1..@3$1)::@4$3=vcount(@1$1..@3$1)', [['3', '', ''], ['', '', ''], ['5', '', ''], ['', '', '']]));
  assert.equal(result[3].cells[0], '8', 'vsum([3, blank, 5]) = 8, same either way for sum specifically');
  assert.equal(result[3].cells[1], '4', 'vmean([3, blank, 5]) = (3+5)/2 = 4, NOT (3+0+5)/3 = 2.666667 -- this is the actual, meaningful difference');
  assert.equal(result[3].cells[2], '2', 'vcount([3, blank, 5]) = 2, NOT 3 -- the blank cell was never counted at all');
});

test('a range that is entirely blank correctly yields 0 for every aggregate function, not a crash or Infinity/-Infinity (vmin/vmax of an empty list)', () => {
  const result = recalculateTable(
    mkTable('@4$1=vsum(@1$1..@3$1)::@4$2=vmean(@1$1..@3$1)::@4$3=vcount(@1$1..@3$1)::@4$4=vmin(@1$1..@3$1)::@4$5=vmax(@1$1..@3$1)::@4$6=vmedian(@1$1..@3$1)', [
      ['', '', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['', '', '', '', '', ''],
    ])
  );
  assert.deepEqual(result[3].cells, ['0', '0', '0', '0', '0', '0']);
});

test('a single bare-ref argument to an aggregate function (not a full range) also correctly omits a blank cell, consistent with the range case', () => {
  const result = recalculateTable(mkTable('@1$2=vcount($1)', [['', '']]));
  assert.equal(result[0].cells[1], '0', 'a single blank cell fed to vcount correctly counts as 0 data values, not 1');
});
