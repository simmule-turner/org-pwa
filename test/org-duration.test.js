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

test('empty is 0; spaces and tabs around a clock or unit duration are ignored, as in Emacs (a blank string or a padded bare number is not valid)', () => {
  assert.equal(parseOrgDuration(''), 0);
  assert.equal(parseOrgDuration('   '), null);
  assert.equal(parseOrgDuration('  1:30  '), 90);
  assert.equal(parseOrgDuration(' 1h\t'), 60);
  assert.equal(parseOrgDuration(' 30'), null);
});

test('invalid input is null', () => {
  for (const bad of ['abc', '1h30', '1:5', '2x', '3 hours', '-1h', 'h', '1:30 abc', '1d 2', '1::30']) {
    assert.equal(parseOrgDuration(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// org-duration-units, with the answers Emacs 29.3 gives (org-duration-to-minutes after org-duration-set-regexps).
import { applyDurationVariables as applyUnits } from '../src/org-duration.js';
import { parseOrgDuration as parseDur, parseDurationUnits } from '../src/org-duration.js';
import { VariableValueError } from '../src/variable-error.js';

test('org-duration-units: an 8-hour day changes d, w, m and y, as in Emacs', () => {
  applyUnits({ 'org-duration-units': '(("min" . 1) ("h" . 60) ("d" . 480) ("w" . 2400) ("m" . 9600) ("y" . 115200))' });
  try {
    for (const [text, want] of [['1d', 480], ['2d 3h', 1140], ['1w', 2400], ['1m', 9600], ['1y', 115200], ['3d 13:35', 2255], ['2.5d', 1200], ['1d3h5min', 665]]) {
      assert.equal(parseDur(text), want, text);
    }
    assert.equal(parseDur('1D'), null);
  } finally {
    applyUnits({});
  }
  assert.equal(parseDur('1d'), 1440);
});

test('org-duration-units: custom names work and removed ones are invalid, as in Emacs', () => {
  applyUnits({ 'org-duration-units': "'((\"min\" . 1) (\"h\" . 60) (\"d\" . 480) (\"sprint\" . 4800) (\"fortnight\" . 20160))" });
  try {
    assert.equal(parseDur('1sprint'), 4800);
    assert.equal(parseDur('2fortnight'), 40320);
    assert.equal(parseDur('1sprint 2d'), 5760);
    assert.equal(parseDur('1w'), null);
  } finally {
    applyUnits({});
  }
});

test('org-duration-units is used as given, as Emacs 29.3 does (oracle): no "min" needed, nil is no units, a repeated name counts its first row', () => {
  assert.deepEqual(parseDurationUnits('(("h" . 60))'), [['h', 60]]);
  assert.deepEqual(parseDurationUnits('nil'), []);
  assert.deepEqual(parseDurationUnits('(("min" . 1) ("min" . 1))'), [['min', 1]]);
  assert.deepEqual(parseDurationUnits('(("min" . 1) ("h" . 0))'), [['min', 1], ['h', 0]]);
  assert.deepEqual(parseDurationUnits('(("min" . 1) ("h" . -5))'), [['min', 1], ['h', -5]]);
  applyUnits({ 'org-duration-units': '(("h" . 60))' });
  try {
    assert.equal(parseDur('1:30'), 90);
    assert.equal(parseDur('2h'), 120);
    assert.equal(parseDur('1min'), null, 'a unit that is not in the list is an error in Emacs ("Unknown unit")');
    applyUnits({ 'org-duration-units': 'nil' });
    assert.equal(parseDur('2h'), null);
  } finally {
    applyUnits({});
  }
});

test('org-duration-units that is not an alist is an error in Emacs\'s words, and the units stay as they were', () => {
  assert.throws(() => parseDurationUnits('("min" "h")'), /org-duration-units: Wrong type argument: listp, "min"/);
  assert.throws(() => parseDurationUnits('junk'), /Wrong type argument: listp, junk/);
  assert.throws(() => parseDurationUnits('(("min" . 1)'), /End of file during parsing/);
  assert.throws(() => applyUnits({ 'org-duration-units': '(("min" . x))' }), VariableValueError);
  assert.equal(parseDur('1d'), 1440);
});

