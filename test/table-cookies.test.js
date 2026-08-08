import test from 'node:test';
import assert from 'node:assert/strict';
import { isWidthCookieRow, parseWidthCookieRow } from '../src/table-cookies.js';

// ---- isWidthCookieRow ---------------------------------------------------

test('a row where every cell is "<N>" is a width-cookie row', () => {
  assert.equal(isWidthCookieRow({ type: 'row', cells: ['<30>', '<10>', '<24>'] }), true);
});

test('a rule row is never a cookie row (different node type entirely)', () => {
  assert.equal(isWidthCookieRow({ type: 'rule' }), false);
});

test('a row with zero cells is not a cookie row', () => {
  assert.equal(isWidthCookieRow({ type: 'row', cells: [] }), false);
});

test('one non-matching cell (even a blank one) disqualifies the whole row -- no partial recognition', () => {
  assert.equal(isWidthCookieRow({ type: 'row', cells: ['<10>', ''] }), false);
  assert.equal(isWidthCookieRow({ type: 'row', cells: ['<10>', 'Age'] }), false);
});

test('an alignment-only or alignment+width cookie ("<c>", "<r10>") is not recognized -- pure numeric "<N>" only', () => {
  assert.equal(isWidthCookieRow({ type: 'row', cells: ['<c>', '<r10>'] }), false);
});

test('internal whitespace inside the brackets ("< 10 >") is not recognized', () => {
  assert.equal(isWidthCookieRow({ type: 'row', cells: ['< 10 >'] }), false);
});

test('surrounding whitespace around a valid cookie IS tolerated (trimmed first)', () => {
  assert.equal(isWidthCookieRow({ type: 'row', cells: ['  <10>  '] }), true);
});

test('ordinary table data (headers, values) is never mistaken for a cookie row', () => {
  assert.equal(isWidthCookieRow({ type: 'row', cells: ['Name', 'Age'] }), false);
  assert.equal(isWidthCookieRow({ type: 'row', cells: ['Al', '9'] }), false);
});

// ---- parseWidthCookieRow ---------------------------------------------------

test('parseWidthCookieRow returns the widths in column order', () => {
  assert.deepEqual(parseWidthCookieRow({ type: 'row', cells: ['<30>', '<10>', '<24>'] }), [30, 10, 24]);
});

test('parseWidthCookieRow returns null for a row that is not actually a cookie row', () => {
  assert.equal(parseWidthCookieRow({ type: 'row', cells: ['Name', 'Age'] }), null);
  assert.equal(parseWidthCookieRow({ type: 'rule' }), null);
});
