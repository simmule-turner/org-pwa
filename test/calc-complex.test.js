import test from 'node:test';
import assert from 'node:assert/strict';
import { recalculateTable } from '../src/table-formula.js';

const run = (tblfm, cells) => recalculateTable({ tblfm, rows: [{ type: 'row', cells: [...cells] }] })[0].cells;

// Where org leaves an expression unevaluated (it can't be reduced), the cell here is #ERROR.
test('things Calc leaves symbolic are #ERROR here', () => {
  assert.equal(run('@1$3=$1+$2', ['[1, 2, 3]', '[4, 5]', ''])[2], '#ERROR', 'vectors of different sizes');
  assert.equal(run('@1$2=inv($1)', ['[[1, 2], [2, 4]]', ''])[1], '#ERROR', 'a singular matrix has no inverse');
  assert.equal(run('@1$2=det($1)', ['[[1, 2, 3], [4, 5, 6]]', ''])[1], '#ERROR', 'det needs a square matrix');
  assert.equal(run('@1$2=sqrt($1)', ['[1, 2, 3]', ''])[1], '#ERROR', 'sqrt is not applied elementwise');
  assert.equal(run('@1$2=(1,2) > 0', ['', ''])[1], '#ERROR', 'complex numbers have no order');
  assert.equal(run('@1$2=cross([1,2],[3,4])', ['', ''])[1], '#ERROR');
  assert.equal(run('@1$2=ln(0)', ['', ''])[1], '#ERROR');
});

test('i is the number (0, 1), unlike Calc, which leaves it a symbol', () => {
  assert.equal(run('@1$1=i*i', [''])[0], '-1');
  assert.equal(run('@1$1=2+3*i', [''])[0], '(2, 3)');
  assert.equal(run('@1$1=exp(i*pi)+1;p15', [''])[0].startsWith('(0') || run('@1$1=exp(i*pi)+1;p15', [''])[0] === '0', true);
});

test('a complex result flows into the next formula in the same line', () => {
  assert.deepEqual(run('@1$2=sqrt($1)::@1$3=$2*$2', ['-9', '', '']), ['-9', '(0, 3)', '-9']);
});

test('a column formula works with complex cells', () => {
  const rows = recalculateTable({
    tblfm: '$2=$1*(0,1)',
    rows: [{ type: 'row', cells: ['(1, 2)', ''] }, { type: 'row', cells: ['3', ''] }],
  });
  assert.deepEqual([rows[0].cells[1], rows[1].cells[1]], ['(-2, 1)', '(0, 3)']);
});

test('pN limits the digits: sqrt(-2) at p3 is (0., 1.41)', () => {
  assert.equal(run('@1$1=sqrt(-2);p3', [''])[0], '(0., 1.41)');
});
