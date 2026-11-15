// Formula cases found by differential runs against Emacs 29.3 (Org 9.6.15): typeof of values that stay symbolic, timestamps written in a formula,
// the maximum of nothing but nan, and the special properties of $PROP_name. The expected cells are what Emacs left.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recalcGrid } from './support/recalc-text.js';

/** @param {string} tblfm @param {string} [row] */
const cell = (tblfm, row = '| x |   |') => recalcGrid(`${row}\n#+TBLFM: ${tblfm}\n`)[0].split('|').pop();
const HEAD = '#+CATEGORY: cat\n* TODO [#B] Title text :a:b:\nDEADLINE: <2026-10-10 Sat> SCHEDULED: <2026-10-09 Fri>\n:PROPERTIES:\n:foo: 7\n:END:\n| 2 |   |\n#+TBLFM: $2=$PROP_';

test('typeof of a fraction, an infinity and a date', () => {
  assert.equal(cell('$2=typeof(1:2)'), '2');
  assert.equal(cell('$2=typeof(3:4+1)'), '2');
  assert.equal(cell('$2=typeof(uinf)'), '12');
  assert.equal(cell('$2=typeof(<2024-03-15>)'), '10');
  assert.equal(cell('$2=typeof(<2024-03-15 10:00>)'), '11');
  assert.equal(cell('$2=typeof($1)', '| 1:2 |   |'), '2');
});

test('a timestamp in a formula is a date', () => {
  assert.equal(cell('$2=<2024-03-15>'), '[2024-03-15 Fri]');
  assert.equal(cell('$2=$1-<2024-03-15>', '| <2024-03-20> |   |'), '5');
});

test('the maximum or minimum of nothing but nan is nan, with or without the E flag', () => {
  assert.equal(cell('$3=vmax($1..$2);E', '| nan | nan |   |'), 'nan');
  assert.equal(cell('$3=vmax($1..$2)', '| nan | nan |   |'), 'nan');
  assert.equal(cell('$3=vmin($1..$2);E', '| nan | nan |   |'), 'nan');
});

test('$PROP_ names the special properties of the entry', () => {
  const at = (/** @type {string} */ name) => recalcGrid(HEAD + name + '\n')[0].split('|').pop();
  assert.equal(at('ITEM'), 'Title text');
  assert.equal(at('TODO'), 'TODO');
  assert.equal(at('PRIORITY'), 'B');
  assert.equal(at('DEADLINE'), '[2026-10-10 Sat]');
  assert.equal(at('SCHEDULED'), '[2026-10-09 Fri]');
  assert.equal(at('CATEGORY'), 'cat');
  assert.equal(at('foo'), '7');
});

test('#+CONSTANTS: lines are read from the whole buffer, a later line overriding an earlier one', () => {
  const at = (/** @type {string} */ org) => recalcGrid(org)[0].split('|').pop();
  const table = '| 2 |   |\n#+TBLFM: $2=$1*$k\n';
  assert.equal(at('* H\n#+CONSTANTS: k=3\n' + table), '6');
  assert.equal(at(table + '* H\n#+CONSTANTS: k=3\n'), '6');
  assert.equal(at('#+CONSTANTS: k=3\n* H\n#+CONSTANTS: k=5\n' + table), '10');
  assert.equal(at('* H\n#+CONSTANTS: k=3\n* G\n' + table + '* I\n#+CONSTANTS: k=9\n'), '18');
});
