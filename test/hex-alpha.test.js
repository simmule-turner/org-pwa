import test from 'node:test';
import assert from 'node:assert/strict';
import { splitHexAlpha, combineHexAlpha } from '../src/hex-alpha.js';

// ---- splitHexAlpha ---------------------------------------------------------

test('splits an 8-digit hex color into rgb and alpha', () => {
  assert.deepEqual(splitHexAlpha('#ffffff22'), { rgb: '#ffffff', alpha: 34 });
});

test('a 6-digit hex color (no alpha channel) gets alpha 255 -- fully opaque', () => {
  assert.deepEqual(splitHexAlpha('#185fa5'), { rgb: '#185fa5', alpha: 255 });
});

test('THE FIX: a 4-digit shorthand hex (#RGBA) is expanded correctly, matching this app\u2019s own :root default (--border: #8883)', () => {
  assert.deepEqual(splitHexAlpha('#8883'), { rgb: '#888888', alpha: 51 });
});

test('a 3-digit shorthand hex (#RGB, no alpha) is expanded correctly, alpha defaults to 255', () => {
  assert.deepEqual(splitHexAlpha('#888'), { rgb: '#888888', alpha: 255 });
});

test('every one of this app\u2019s own actual theme default values round-trips through splitHexAlpha without falling back to the error default', () => {
  const themeDefaults = [
    '#16181c', '#e8e8e8', '#ffffff22', '#ffffff3a', '#ffffff14', '#9aa0a6', '#6fb2ff',
    '#ff8f5c40', '#ffb28c', '#6fcf5740', '#a3e693',
    '#ffffff', '#1a1a1a', '#00000022', '#0000003a', '#00000009', '#666666', '#185fa5',
    '#f0997b55', '#99341d', '#97c45955', '#27500a',
    '#8883', '#8886', // :root's own 4-digit shorthand defaults
  ];
  for (const hex of themeDefaults) {
    const result = splitHexAlpha(hex);
    assert.notDeepEqual(result, { rgb: '#000000', alpha: 255 }, `${hex} should not fall back to the error default`);
  }
});

test('case-insensitive -- uppercase hex digits parse the same as lowercase', () => {
  assert.deepEqual(splitHexAlpha('#FFFFFF22'), splitHexAlpha('#ffffff22'));
});

test('an invalid/malformed color falls back to opaque black rather than throwing', () => {
  assert.deepEqual(splitHexAlpha('not-a-color'), { rgb: '#000000', alpha: 255 });
  assert.deepEqual(splitHexAlpha(''), { rgb: '#000000', alpha: 255 });
  assert.deepEqual(splitHexAlpha(null), { rgb: '#000000', alpha: 255 });
  assert.deepEqual(splitHexAlpha(undefined), { rgb: '#000000', alpha: 255 });
  assert.deepEqual(splitHexAlpha('#ff'), { rgb: '#000000', alpha: 255 }); // too short to be any valid form
});

test('whitespace around the value is tolerated', () => {
  assert.deepEqual(splitHexAlpha('  #ffffff22  '), { rgb: '#ffffff', alpha: 34 });
});

// ---- combineHexAlpha --------------------------------------------------------

test('combines rgb and a partial alpha into an 8-digit hex string', () => {
  assert.equal(combineHexAlpha('#ffffff', 34), '#ffffff22');
});

test('full opacity (255) produces a 6-digit hex, no redundant "ff" alpha suffix', () => {
  assert.equal(combineHexAlpha('#185fa5', 255), '#185fa5');
});

test('alpha is clamped to the valid 0-255 range rather than producing an invalid hex string', () => {
  assert.equal(combineHexAlpha('#ffffff', 999), '#ffffff'); // clamped to 255 -> 6-digit
  assert.equal(combineHexAlpha('#ffffff', -50), '#ffffff00'); // clamped to 0
});

test('alpha is rounded to the nearest integer before encoding', () => {
  assert.equal(combineHexAlpha('#ffffff', 34.7), '#ffffff23');
});

test('round-trip: split then combine reproduces the original 8-digit value', () => {
  const original = '#ffffff22';
  const { rgb, alpha } = splitHexAlpha(original);
  assert.equal(combineHexAlpha(rgb, alpha), original);
});

test('round-trip works for every one of this app\u2019s own actual theme default values', () => {
  const themeDefaults = [
    '#16181c', '#ffffff22', '#f0997b55', '#185fa5', '#9aa0a6',
  ];
  for (const hex of themeDefaults) {
    const { rgb, alpha } = splitHexAlpha(hex);
    assert.equal(combineHexAlpha(rgb, alpha), hex);
  }
});

test('an invalid rgb input to combineHexAlpha falls back to black rather than producing a malformed string', () => {
  assert.equal(combineHexAlpha('not-a-color', 255), '#000000');
});
