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

test('THE FIX: non-numeric text (a label cell), without the N flag, propagates as NaN rather than being silently read as 0 -- confirmed directly against real Emacs org-mode, which shows an unevaluated symbolic expression there instead; NaN is the closest honest approximation without full symbolic algebra', () => {
  const result = recalculateTable(mkTable('@1$3=$1+$2', [['label', '5', '']]));
  assert.equal(result[0].cells[2], 'nan');
});

test('the N flag restores "non-numeric text reads as 0", matching real org\u2019s own documented N semantics exactly', () => {
  const result = recalculateTable(mkTable('@1$3=$1+$2;N', [['label', '5', '']]));
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

test('THE FIX: a horizontal rule (hline) never gets its own row number -- @N always counts every actual row, INCLUDING the header (confirmed directly against real Emacs org-mode -- see the next test), but never a rule/hline itself', () => {
  // Header row, then first hline (defines the header boundary), then
  // data rows with a SECOND hline mid-data (a group separator, which
  // must NOT reset numbering or count as its own row either).
  const result = recalculateTable(mkTable('@5$1=vsum(@2..@4)', [['H'], null, ['1'], ['2'], null, ['3'], ['']]));
  assert.equal(cellsOf(result)[1], '---', 'the first (header-defining) rule is preserved untouched, at its own original position');
  assert.equal(cellsOf(result)[4], '---', 'the second (mid-data) rule is also preserved untouched');
  assert.equal(result[6].cells[0], '6', '@5 correctly refers to the 5th row overall (the blank one after "3") -- @1 is the header, @2..@4 are 1/2/3, and neither rule consumes a row number of its own');
});

test('THE FIX: the column-formula SHORTHAND ($N=, applied to every row at once) still correctly skips a row before the table\u2019s own first hline -- confirmed directly against real Emacs org-mode: a $3=$2*2 column formula leaves the header row\u2019s own text alone, distinct from (and narrower than) @N numbering itself, which DOES count the header (see the dedicated header-numbering test below) -- these are two separate rules, not one', () => {
  const result = recalculateTable(mkTable('$2=($1-32)*5/9', [['Fahrenheit', 'Celsius'], null, ['32', ''], ['212', '']]));
  assert.deepEqual(cellsOf(result)[0], ['Fahrenheit', 'Celsius'], 'the header row\u2019s own text must be completely untouched, not overwritten with a computed value');
  assert.equal(result[2].cells[1], '0', 'the actual data rows are still correctly computed');
  assert.equal(result[3].cells[1], '100');
});

test('THE FIX: @N numbering counts the header row as @1 -- a real, significant bug found and fixed: the earlier implementation excluded the header from @N numbering entirely (not just from column-formula application), confirmed wrong by actually running real Emacs org-mode\u2019s own org-table-recalculate in batch mode, not by reading the Manual\u2019s own ambiguous prose and stopping there. The user\u2019s own exact reported example: "@7$2=vsum(@2..@6)" on a table with a 3-column header, 5 data rows, then a summary row -- @7 is the summary row (header=@1, the 5 data rows=@2..@6, matching real Emacs\u2019s own actual, directly-verified output exactly)', () => {
  const result = recalculateTable(
    mkTable('@7$2=vsum(@2..@6)', [
      ['ITEM', 'COST', 'PRICE'],
      null,
      ['Bike', '50', '100'],
      ['Sword', '20', '35'],
      ['Drill', '30', '60'],
      ['Cooler', '10', '70'],
      ['TV', '50', '40'],
      null,
      ['', '999', ''],
    ])
  );
  assert.equal(result[8].cells[1], '160', 'matches real Emacs org-mode\u2019s own actual, directly-verified output for this exact formula and table');
});

test('an explicit, deliberately-targeted cell formula (@1$2=...) still freely modifies the header when asked to -- confirmed directly against real Emacs too: only the column-formula SHORTHAND skips the header, not an explicit @N$M= target', () => {
  const result = recalculateTable(mkTable('@1$2=999', [['ITEM', 'COST'], null, ['Bike', '50'], ['Sword', '20']]));
  assert.deepEqual(result[0].cells, ['ITEM', '999']);
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

test('THE FIX: an out-of-range row reference is a runtime error, isolated to that one cell as "#ERROR" rather than aborting the whole recalculation -- matching real Emacs org-mode\u2019s own confirmed behavior', () => {
  const result = recalculateTable(mkTable('@1$1=@5$1', [['1']]));
  assert.equal(result[0].cells[0], '#ERROR');
});

test('an unknown function name throws', () => {
  assert.throws(() => recalculateTable(mkTable('@1$1=frobnicate(@1$1..@1$1)', [['1']])));
});

test('a formula target missing "=" entirely throws', () => {
  assert.throws(() => recalculateTable(mkTable('$1 5', [['']])));
});

test('THE EXACT REQUEST: a valid formula and a failing one in the SAME #+TBLFM: line don\u2019t affect each other -- the valid one\u2019s own result commits normally, the failing one gets "#ERROR", matching the exact scenario confirmed directly against real Emacs org-mode', () => {
  const result = recalculateTable(mkTable('@1$1=$2+$3::@1$2=@99$1', [['1', '2', '3']]));
  assert.equal(result[0].cells[0], '5', 'the valid formula (2+3) still evaluates and commits');
  assert.equal(result[0].cells[1], '#ERROR', 'the failing one (out-of-range @99$1) is isolated to its own cell');
});

test('THE FIX: a range used as a plain value (not inside an aggregate function) is a runtime error, isolated to that one cell as "#ERROR" -- a range is a list, not a single number, but this no longer aborts the whole recalculation', () => {
  const result = recalculateTable(mkTable('@1$1=@1$1..@2$1', [['1'], ['2']]));
  assert.equal(result[0].cells[0], '#ERROR');
  assert.equal(result[1].cells[0], '2', 'the OTHER row\u2019s own cell, untouched by this formula, is unaffected');
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

// ---- THE FIX: hline references (@I, @II, @III, ...) ------------------------

test('THE FIX: @I / @II resolve to hline positions, and a range between them spans every data row strictly between the two hlines -- confirmed directly against real Emacs org-mode (org-table-recalculate in batch mode), matching the user\u2019s own reported "Standard deviation" example exactly', () => {
  const rows = [
    ['INDEX', 'VALUE'],
    null,
    ['1', '1'],
    ['2', '2'],
    ['3', '4'],
    ['4', '2'],
    ['5', '3'],
    ['6', '1'],
    ['7', '4'],
    ['8', '1'],
    ['9', '5'],
    null,
    ['STD DEV', '999999999'],
  ];
  const result = recalculateTable(mkTable('@>$2=vsdev(@I..@II)', rows));
  assert.equal(result[result.length - 1].cells[1], '1.5092309', 'matches real Emacs org-mode\u2019s own directly-verified output exactly');
});

test('THE FIX: @I is repeated-"I"-character notation, NOT Roman numerals -- confirmed directly against real Emacs: @IIII is the 4th hline, not @IV. The user\u2019s own reported "summing sections" example, all four hline-bounded ranges at once, each result matching their own expected values exactly', () => {
  const rows = [
    ['ITEM', 'COST'],
    null,
    ['rum', '20'],
    ['gin', '18'],
    ['beer', '50'],
    null,
    ['coke', '10'],
    ['sprite', '5'],
    null,
    ['chips', '10'],
    ['cookies', '20'],
    ['pizza', '60'],
    null,
    ['plates', '10'],
    ['napkins', '8'],
    ['cups', '12'],
    null,
    ['ALCOHOL', '-1'],
    ['SODA', '-1'],
    ['FOOD', '-1'],
    ['MISC', '-1'],
  ];
  const tblfm = '@13$2=vsum(@I..@II)::@14$2=vsum(@II..@III)::@15$2=vsum(@III..@IIII)::@16$2=vsum(@IIII..@IIIII)';
  const result = recalculateTable(mkTable(tblfm, rows));
  assert.equal(result[17].cells[1], '88', 'ALCOHOL: 20+18+50');
  assert.equal(result[18].cells[1], '15', 'SODA: 10+5');
  assert.equal(result[19].cells[1], '90', 'FOOD: 10+20+60');
  assert.equal(result[20].cells[1], '30', 'MISC: 10+8+12');
});

test('THE FIX: a range reaching past the table\u2019s own last hline still resolves, clamping to the table\u2019s own actual end rather than erroring -- confirmed directly against real Emacs org-mode (re-verified fresh, not assumed): @II, which doesn\u2019t exist in a table with only one hline, clamps to the table\u2019s own last row. Since there\u2019s no hline separating the target row itself from the data being summed, the clamped range correctly includes the target\u2019s own current value too -- confirmed this is real org\u2019s own actual behavior, not a bug: 10+8+12+(-1)=29, not 30', () => {
  const rows = [['ITEM', 'COST'], null, ['a', '10'], ['b', '8'], ['c', '12'], ['MISC', '-1']];
  const result = recalculateTable(mkTable('@5$2=vsum(@I..@II)', rows));
  assert.equal(result[5].cells[1], '29', 'matches real Emacs org-mode\u2019s own directly-verified output exactly');
});

test('an hline reference with a +N/-N offset resolves to a data row that many positions after/before the hline itself', () => {
  const rows = [['A'], null, ['1'], ['2'], ['3'], ['4']];
  const result = recalculateTable(mkTable('@1$1=@I+2', rows));
  assert.equal(result[0].cells[0], '2', '@I+2: the hline\u2019s own start boundary (row 1, "1") plus 2 = row 3, "2"');
});

// ---- THE FIX: a range as the formula\u2019s own target -------------------------

test('THE FIX: a range target applies the formula independently to each cell in that range -- confirmed directly against real Emacs org-mode, matching the user\u2019s own reported "Summing columns" example exactly (four columns summed at once via a single range-target formula)', () => {
  const rows = [
    ['ITEM', 'COST', 'PRICE', 'SHIPPING', 'MILEAGE'],
    null,
    ['Bike', '50', '100', '0', '23'],
    ['Sword', '20', '35', '10', '12'],
    ['Drill', '30', '60', '5', '51'],
    ['Cooler', '10', '70', '0', '32'],
    ['TV', '50', '40', '20', '19'],
    ['Blender', '25', '45', '0', '9'],
    ['Boots', '20', '20', '0', '38'],
    null,
    ['', '', '', '', ''],
  ];
  const result = recalculateTable(mkTable('@>$2..@>$>=vsum(@2..@-1)', rows));
  assert.deepEqual(result[result.length - 1].cells, ['', '205', '370', '35', '184'], 'matches real Emacs org-mode\u2019s own directly-verified output exactly');
});

test('THE FIX: a range target with both endpoints fully explicit (@>$2..@>$3=) -- the user\u2019s own reported "Column totals" example, corrected to valid syntax (see the next test for the literal, invalid version)', () => {
  const rows = [
    ['ITEM', 'COST', 'PRICE'],
    null,
    ['Bike', '50', '100'],
    ['Sword', '20', '35'],
    ['Drill', '30', '60'],
    ['Cooler', '10', '70'],
    ['TV', '50', '40'],
    ['Blender', '25', '45'],
    ['Boots', '20', '20'],
    null,
    ['', '999', '999'],
  ];
  const result = recalculateTable(mkTable('@>$2..@>$3=vsum(@2..@-1)', rows));
  assert.deepEqual(result[result.length - 1].cells, ['', '205', '370']);
});

test('THE FIX: the user\u2019s own literal, reported "Column totals" formula (@>$2..$3=, second endpoint missing its row) throws clearly -- confirmed directly against real Emacs org-mode that this is genuinely invalid there too ("Row descriptor -1 leads outside table"), not a bug in this app to silently make work', () => {
  const rows = [['ITEM', 'COST', 'PRICE'], null, ['Bike', '50', '100'], null, ['', '999', '999']];
  assert.throws(() => recalculateTable(mkTable('@>$2..$3=vsum(@2..@-1)', rows)), /explicit row on both endpoints/);
});

test('a range target can also span multiple ROWS in one column, not just multiple columns in one row', () => {
  const rows = [['1'], ['2'], ['3']];
  const result = recalculateTable(mkTable('@1$1..@3$1=99', rows));
  assert.deepEqual(cellsOf(result), [['99'], ['99'], ['99']]);
});

// ---- THE FIX: duration flags (T/U/t) ----------------------------------------

test('THE EXACT REQUEST: the manual\u2019s own worked example, verified exactly -- T (HH:MM:SS), U (HH:MM), t (fractional hours)', () => {
  const rows = [
    ['Task 1', 'Task 2', 'Total'],
    null,
    ['2:12', '1:47', '999'],
    ['2:12', '1:47', '999'],
    ['3:02:20', '-2:07:00', '999'],
  ];
  const tblfm = '@2$3=$1+$2;T::@3$3=$1+$2;U::@4$3=$1+$2;t';
  const result = recalculateTable(mkTable(tblfm, rows));
  assert.equal(result[2].cells[2], '03:59:00', 'matches real Emacs org-mode\u2019s own directly-verified output exactly');
  assert.equal(result[3].cells[2], '03:59');
  assert.equal(result[4].cells[2], '0.92');
});

test('THE FIX: without any duration flag, "H:MM" text is NOT read as a duration at all -- confirmed directly against real Emacs org-mode, which reads it as a Calc fraction instead (a distinction this engine doesn\u2019t reproduce either way, but the flag-gating itself is confirmed real)', () => {
  const rows = [['2:12', '1:47', '999']];
  const result = recalculateTable(mkTable('@1$3=$1+$2', rows));
  // Neither operand parses as a plain number, so both read as NaN under
  // this engine's own non-numeric-text handling (see the N-flag tests
  // below) -- NOT a duration sum of any kind.
  assert.equal(result[0].cells[2], 'nan');
});

test('a negative duration result is correctly signed', () => {
  const rows = [['1:00', '-3:00', '999']];
  const result = recalculateTable(mkTable('@1$3=$1+$2;T', rows));
  assert.equal(result[0].cells[2], '-02:00:00');
});

test('a plain integer operand under a duration flag is treated as seconds, matching real org\u2019s own "integers are considered as seconds" rule -- confirmed directly against real Emacs', () => {
  const rows = [['2:12', '30', '999']];
  const result = recalculateTable(mkTable('@1$3=$1+$2;T', rows));
  assert.equal(result[0].cells[2], '02:12:30');
});

test('THE FIX: org-table-duration-hour-zero-padding -- true (real org\u2019s own default, confirmed directly against real Emacs) zero-pads the hours field; false leaves it at its own natural width. Minutes/seconds are always 2-digit padded regardless', () => {
  const rows = [['0:05', '0:03', '999']];
  const padded = recalculateTable(mkTable('@1$3=$1+$2;T', rows), { hourZeroPad: true });
  assert.equal(padded[0].cells[2], '00:08:00');
  const unpadded = recalculateTable(mkTable('@1$3=$1+$2;T', rows), { hourZeroPad: false });
  assert.equal(unpadded[0].cells[2], '0:08:00');
});

test('hourZeroPad defaults to true when not specified, matching real org\u2019s own default', () => {
  const rows = [['0:05', '0:03', '999']];
  const result = recalculateTable(mkTable('@1$3=$1+$2;T', rows));
  assert.equal(result[0].cells[2], '00:08:00');
});

// ---- THE FIX: empty-field flags (E/N) ---------------------------------------

test('THE FIX: without E, a blank cell in a range is still omitted from the vector entirely -- the app\u2019s own existing default, unchanged', () => {
  const rows = [['1'], ['2'], ['']];
  const result = recalculateTable(mkTable('@1$2=vmean(@1$1..@3$1)', [['1', '999'], ['2', '999'], ['', '999']]));
  assert.equal(result[0].cells[1], '1.5', 'mean of [1,2] only, blank omitted');
});

test('THE FIX: the E flag keeps a blank cell in the range as NaN instead of omitting it -- confirmed directly against real Emacs org-mode', () => {
  const result = recalculateTable(mkTable('@1$2=vsum(@1$1..@3$1);E', [['1', '999'], ['2', '999'], ['', '999']]));
  assert.equal(result[0].cells[1], 'nan');
});

test('THE FIX: E and N together turn a blank cell into 0, still kept in the range (not omitted) -- confirmed directly against real Emacs org-mode', () => {
  const result = recalculateTable(mkTable('@1$2=vsum(@1$1..@3$1);EN', [['1', '999'], ['2', '999'], ['', '999']]));
  assert.equal(result[0].cells[1], '3');
});

test('THE FIX: E also affects a PLAIN (non-range) reference to a blank cell, not just ranges -- confirmed directly against real Emacs org-mode', () => {
  const result = recalculateTable(mkTable('@1$2=$1+5;E', [['', '999']]));
  assert.equal(result[0].cells[1], 'nan');
});

test('vcount under E counts a blank cell as present in the vector, even though its own value is NaN -- confirmed directly against real Emacs org-mode', () => {
  const result = recalculateTable(mkTable('@1$2=vcount(@1$1..@3$1);E', [['1', '999'], ['2', '999'], ['', '999']]));
  assert.equal(result[0].cells[1], '3');
});

// ---- THE FIX: n/s/e/f display-format flags ----------------------------------

test('THE FIX: fN (fixed, N decimal places) matches real Emacs org-mode\u2019s own output exactly, and is equivalent to the existing %.Nf syntax', () => {
  const result = recalculateTable(mkTable('@1$1=100.56789;f4', [['999']]));
  assert.equal(result[0].cells[0], '100.5679');
});

test('THE FIX: nN (normal, N significant figures) matches real Emacs org-mode\u2019s own output exactly', () => {
  const result = recalculateTable(mkTable('@1$1=3.14159265;n5', [['999']]));
  assert.equal(result[0].cells[0], '3.1416');
});

test('THE FIX: sN (scientific notation, N significant figures) matches real Emacs org-mode\u2019s own output exactly, including no "+" on a positive exponent', () => {
  const result = recalculateTable(mkTable('@1$1=123456.789;s3', [['999']]));
  assert.equal(result[0].cells[0], '1.23e5');
});

test('THE FIX: eN (engineering notation, exponent always a multiple of 3) matches real Emacs org-mode\u2019s own output exactly, and genuinely differs from sN when the natural exponent isn\u2019t already a multiple of 3', () => {
  const result = recalculateTable(mkTable('@1$1=123456.789;e3', [['999']]));
  assert.equal(result[0].cells[0], '123e3');
});

test('pN (precision) is accepted without erroring but has no effect on the displayed result -- confirmed directly against real Emacs org-mode, where p alone doesn\u2019t change the display format either', () => {
  const result = recalculateTable(mkTable('@1$1=1/3;p20', [['999']]));
  assert.equal(result[0].cells[0], '0.33333333', 'still the default 8-significant-figure format, not 20 digits');
});

test('flags can be concatenated with no separator, in either order', () => {
  const rowsNE = [['1', '999'], ['', '999']];
  const resultNE = recalculateTable(mkTable('@1$2=vsum(@1$1..@2$1);NE', rowsNE));
  const rowsEN = [['1', '999'], ['', '999']];
  const resultEN = recalculateTable(mkTable('@1$2=vsum(@1$1..@2$1);EN', rowsEN));
  assert.equal(resultNE[0].cells[1], '1', 'NE and EN both mean "blank -> 0, kept in range" -- order doesn\u2019t matter');
  assert.equal(resultEN[0].cells[1], '1');
});

// ---- date/time arithmetic (date/now/deg) ----------------------------------

test('THE EXACT REQUEST: finding days between two dates -- date($2) - date($1) with neither side ever having a time component gives a plain integer day count', () => {
  const result = recalculateTable(mkTable('$3 = date($2) - date($1)', [['<2026-08-01>', '<2026-08-25>', '']]));
  assert.equal(result[0].cells[2], '24');
});

test('THE EXACT REQUEST: projecting a future deadline -- date($1) + N (a plain integer) advances the date, formatted back as an org timestamp', () => {
  const result = recalculateTable(mkTable('$3 = date($1) + $2', [['<2026-08-25>', '14', '']]));
  assert.equal(result[0].cells[2], '<2026-09-08>');
});

test('date($1) - N recedes the date by that many days', () => {
  const result = recalculateTable(mkTable('$2 = date($1) - $2', [['<2026-08-25>', '10']]));
  assert.equal(result[0].cells[1], '<2026-08-15>');
});

test('THE EXACT REQUEST: raw HMS duration output -- date($2) - date($1) with EITHER side having a time component defaults to Calc\u2019s own actual "H@ M\u2019 S\\"" notation instead of a plain number', () => {
  const result = recalculateTable(mkTable('$3 = date($2) - date($1)', [['<2026-08-25 08:00>', '<2026-08-25 16:30>', '']]));
  assert.equal(result[0].cells[2], `8@ 30' 0"`);
});

test('a negative HMS duration (earlier minus later) shows a leading "-", not a bare negative-looking number', () => {
  const result = recalculateTable(mkTable('$3 = date($2) - date($1)', [['<2026-08-25 16:30>', '<2026-08-25 08:00>', '']]));
  assert.equal(result[0].cells[2], `-8@ 30' 0"`);
});

test('THE EXACT REQUEST: converting HMS to decimal hours -- deg() un-tags the duration back to its own raw (still-in-days) number, and the formula\u2019s own explicit "* 24" reaches decimal hours, with the ;%.2f mode flag still applying normally since deg()\u2019s own result is a plain number again', () => {
  const result = recalculateTable(mkTable('$3 = deg(date($2) - date($1)) * 24;%.2f', [['<2026-08-25 08:00>', '<2026-08-25 16:30>', '']]));
  assert.equal(result[0].cells[2], '8.50');
});

test('THE FEATURE: date(YEAR, MONTH, DAY) constructs a date directly, with no cell reference at all', () => {
  const result = recalculateTable(mkTable('$1 = date(2026, 8, 25)', [['']]));
  assert.equal(result[0].cells[0], '<2026-08-25>');
});

test('date(Y,M,D) + N still works exactly like a cell-derived date -- the value is what matters, not how it was constructed', () => {
  const result = recalculateTable(mkTable('$1 = date(2026, 8, 25) + 5', [['']]));
  assert.equal(result[0].cells[0], '<2026-08-30>');
});

test('THE FEATURE: now() returns the current date/time as a date-tagged value, formatted with a time component since it always has one', () => {
  const result = recalculateTable(mkTable('$1 = now()', [['']]));
  assert.match(result[0].cells[0], /^<\d{4}-\d{2}-\d{2} \d{2}:\d{2}>$/);
});

test('date() accepts a timestamp with no day-name at all (real org syntax always includes one, but a person typing directly into a cell commonly won\u2019t) -- both bracket styles, both with and without a day-name, all parse identically', () => {
  const withDayName = recalculateTable(mkTable('$3 = date($2) - date($1)', [['<2026-08-01 Sat>', '<2026-08-25 Tue>', '']]));
  const withoutDayName = recalculateTable(mkTable('$3 = date($2) - date($1)', [['<2026-08-01>', '<2026-08-25>', '']]));
  const inactiveTimestamps = recalculateTable(mkTable('$3 = date($2) - date($1)', [['[2026-08-01]', '[2026-08-25]', '']]));
  assert.equal(withDayName[0].cells[2], '24');
  assert.equal(withoutDayName[0].cells[2], '24');
  assert.equal(inactiveTimestamps[0].cells[2], '24');
});

test('THE FIX: a cell that doesn\u2019t contain a recognizable timestamp at all produces #ERROR in that specific cell, not a crash, matching this module\u2019s own existing, established per-cell error-isolation convention', () => {
  const result = recalculateTable(mkTable('$2 = date($1)', [['not a date', '']]));
  assert.equal(result[0].cells[1], '#ERROR');
});

test('the column-formula shorthand ($M=, no @) applies date arithmetic to every data row independently, each computing its own result from its own cells', () => {
  const result = recalculateTable(
    mkTable('$3 = date($2) - date($1)', [
      ['<2026-08-01>', '<2026-08-10>', ''],
      ['<2026-01-01>', '<2026-12-31>', ''],
    ])
  );
  assert.equal(result[0].cells[2], '9');
  assert.equal(result[1].cells[2], '364');
});

test('date(date($1)) and date(now()) pass an already-date-tagged value straight through rather than re-parsing its own formatted text', () => {
  const result = recalculateTable(mkTable('$2 = date(date($1))', [['<2026-08-25>', '']]));
  assert.equal(result[0].cells[1], '<2026-08-25>');
});

// ---- conditional logic (if / comparisons / && || ! / string) --------------

test('THE EXACT REQUEST: logical-example -- if($1 >= 50 && $2 >= 50, "Both Pass", "Fail")', () => {
  const result = recalculateTable(
    mkTable('$3 = if($1 >= 50 && $2 >= 50, "Both Pass", "Fail")', [
      ['60', '70', ''],
      ['40', '80', ''],
    ])
  );
  assert.equal(result[0].cells[2], 'Both Pass');
  assert.equal(result[1].cells[2], 'Fail');
});

test('THE EXACT REQUEST: grading-example -- nested if() as an else-if chain', () => {
  const result = recalculateTable(
    mkTable('$2 = if($1 >= 90, "A", if($1 >= 80, "B", "C"))', [
      ['85', ''],
      ['95', ''],
      ['62', ''],
    ])
  );
  assert.equal(result[0].cells[1], 'B');
  assert.equal(result[1].cells[1], 'A');
  assert.equal(result[2].cells[1], 'C');
});

test('THE EXACT REQUEST: string-example -- string() wraps a cell reference so it compares as text, not a numeric coercion', () => {
  const result = recalculateTable(
    mkTable('$2 = if(string($1) == "Sales", 5000, 10000)', [
      ['Sales', ''],
      ['Tech', ''],
    ])
  );
  assert.equal(result[0].cells[1], '5000');
  assert.equal(result[1].cells[1], '10000');
});

test('THE FEATURE: all six comparison operators, both == and = for equality', () => {
  assert.equal(recalculateTable(mkTable('$2 = if($1 == 10, "Yes", "No")', [['10', '']]))[0].cells[1], 'Yes');
  assert.equal(recalculateTable(mkTable('$2 = if($1 = 10, "Yes", "No")', [['10', '']]))[0].cells[1], 'Yes');
  assert.equal(recalculateTable(mkTable('$2 = if($1 != 0, "Yes", "No")', [['5', '']]))[0].cells[1], 'Yes');
  assert.equal(recalculateTable(mkTable('$2 = if($1 < 50, "Fail", "Pass")', [['30', '']]))[0].cells[1], 'Fail');
  assert.equal(recalculateTable(mkTable('$2 = if($1 > 100, "Bonus", "Base")', [['150', '']]))[0].cells[1], 'Bonus');
  assert.equal(recalculateTable(mkTable('$2 = if($1 <= 18, "Minor", "Adult")', [['18', '']]))[0].cells[1], 'Minor');
  assert.equal(recalculateTable(mkTable('$2 = if($1 >= 65, "Senior", "Reg")', [['70', '']]))[0].cells[1], 'Senior');
});

test('THE FEATURE: && and || both as operators and as and()/or() function calls, plus ! and not()', () => {
  assert.equal(recalculateTable(mkTable('$1 = if(1 && 1, "y", "n")', [['']]))[0].cells[0], 'y');
  assert.equal(recalculateTable(mkTable('$1 = if(1 && 0, "y", "n")', [['']]))[0].cells[0], 'n');
  assert.equal(recalculateTable(mkTable('$1 = if(0 || 1, "y", "n")', [['']]))[0].cells[0], 'y');
  assert.equal(recalculateTable(mkTable('$1 = if(0 || 0, "y", "n")', [['']]))[0].cells[0], 'n');
  assert.equal(recalculateTable(mkTable('$1 = if(and(1, 1), "y", "n")', [['']]))[0].cells[0], 'y');
  assert.equal(recalculateTable(mkTable('$1 = if(or(0, 0), "y", "n")', [['']]))[0].cells[0], 'n');
  assert.equal(recalculateTable(mkTable('$1 = if(!0, "y", "n")', [['']]))[0].cells[0], 'y');
  assert.equal(recalculateTable(mkTable('$1 = if(not(1), "y", "n")', [['']]))[0].cells[0], 'n');
});

test('THE FIX: if() is lazy -- the branch NOT taken is never evaluated at all, matching real Calc\u2019s own short-circuiting behavior. Proven with a branch that would throw (not just misbehave) if it were eagerly evaluated', () => {
  const result = recalculateTable(mkTable('$3 = if($1 == 0, date($2), 999)', [['1', 'not a date', '']]));
  assert.equal(result[0].cells[2], '999', 'the date($2) branch, which would throw on this malformed cell, must never run');
});

test('THE EXACT REQUEST: divide-by-zero avoidance -- if($1 != 0, 100 / $1, 0)', () => {
  assert.equal(recalculateTable(mkTable('$2 = if($1 != 0, 100 / $1, 0)', [['0', '']]))[0].cells[1], '0');
  assert.equal(recalculateTable(mkTable('$2 = if($1 != 0, 100 / $1, 0)', [['4', '']]))[0].cells[1], '25');
});

test('&& and || both short-circuit -- the right side is never evaluated once the left side alone determines the result', () => {
  // Same proof technique as the if() lazy test: an operand that would throw if evaluated.
  assert.equal(recalculateTable(mkTable('$3 = if($1 == 1 && date($2) == date($2), "y", "n")', [['0', 'not a date', '']]))[0].cells[2], 'n', '&& short-circuits on a falsy left side');
  assert.equal(recalculateTable(mkTable('$3 = if($1 == 1 || date($2) == date($2), "y", "n")', [['1', 'not a date', '']]))[0].cells[2], 'y', '|| short-circuits on a truthy left side');
});

test('comparisons bind tighter than && and ||, matching standard precedence -- $1 >= 50 && $2 >= 50 parses as ($1 >= 50) && ($2 >= 50), not something nonsensical', () => {
  const result = recalculateTable(mkTable('$3 = if($1 >= 50 && $2 >= 50, 1, 0)', [['50', '50', '']]));
  assert.equal(result[0].cells[2], '1');
});

test('a string literal can be output directly, and can contain an escaped quote', () => {
  assert.equal(recalculateTable(mkTable('$1 = "hello"', [['']]))[0].cells[0], 'hello');
  assert.equal(recalculateTable(mkTable('$1 = "she said \\"hi\\""', [['']]))[0].cells[0], 'she said "hi"');
});

test('string() on a non-ref expression converts whatever value results to its own string form, not just a bare cell reference', () => {
  assert.equal(recalculateTable(mkTable('$1 = string(5+5)', [['']]))[0].cells[0], '10');
});

test('a malformed if() (missing the required third argument) is a parse-time error -- throws entirely, matching this module\u2019s own established convention for malformed formula syntax, rather than producing a per-cell #ERROR (which is reserved for runtime evaluation failures on an otherwise-valid formula)', () => {
  assert.throws(() => recalculateTable(mkTable('$1 = if($1, "only two args")', [['']])));
});
