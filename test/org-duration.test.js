import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrgDuration } from '../src/org-duration.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('H:MM and H:MM:SS', () => {
  assert.equal(parseOrgDuration('3:12'), 192);
  assert.equal(parseOrgDuration('0:45'), 45);
  assert.ok(close(parseOrgDuration('1:23:45'), 83 + 45 / 60));
});

test('unit sequences, with or without spaces, in any order', () => {
  assert.equal(parseOrgDuration('1y 3d 3h 4min'), 525960 + 3 * 1440 + 180 + 4);
  assert.equal(parseOrgDuration('1d3h5min'), 1440 + 180 + 5);
  assert.equal(parseOrgDuration('4min 2h'), 124);
  assert.equal(parseOrgDuration('2 h 30 min'), 150);
});

test('units followed by an H:MM part', () => {
  assert.equal(parseOrgDuration('3d 13:35'), 3 * 1440 + 13 * 60 + 35);
});

test('decimals and bare numbers', () => {
  assert.ok(close(parseOrgDuration('2.35h'), 141));
  assert.equal(parseOrgDuration('30'), 30);
  assert.equal(parseOrgDuration('1.5'), 1.5);
});

test('every default unit converts as Emacs defines it', () => {
  assert.equal(parseOrgDuration('1min'), 1);
  assert.equal(parseOrgDuration('1h'), 60);
  assert.equal(parseOrgDuration('1d'), 1440);
  assert.equal(parseOrgDuration('1w'), 10080);
  assert.equal(parseOrgDuration('1y'), 525960);
});

test('"m" is a MONTH (30 days), not minutes -- "min" is minutes', () => {
  assert.equal(parseOrgDuration('2m'), 2 * 43200);
  assert.equal(parseOrgDuration('2min'), 2);
});

test('empty is 0; surrounding whitespace is ignored', () => {
  assert.equal(parseOrgDuration(''), 0);
  assert.equal(parseOrgDuration('   '), 0);
  assert.equal(parseOrgDuration('  1:30  '), 90);
});

test('invalid input is null', () => {
  for (const bad of ['abc', '1h30', '1:5', '2x', '3 hours', '-1h', 'h', '1:30 abc', '1d 2', '1::30']) {
    assert.equal(parseOrgDuration(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});
