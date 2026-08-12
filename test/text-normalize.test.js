import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSmartQuotes } from '../src/text-normalize.js';

test('normalizes curly double quotes (iOS-style left/right pair) to straight ASCII quotes', () => {
  assert.equal(normalizeSmartQuotes('\u201chello\u201d'), '"hello"');
});

test('normalizes curly single quotes (iOS-style left/right pair) to a straight ASCII apostrophe', () => {
  assert.equal(normalizeSmartQuotes('\u2018hello\u2019'), "'hello'");
});

test('normalizes the single-high-reversed-9 and double-high-reversed-9 variants too', () => {
  assert.equal(normalizeSmartQuotes('\u201Bhello\u201F'), "'hello\"");
});

test('leaves already-straight ASCII quotes untouched', () => {
  assert.equal(normalizeSmartQuotes('"hello" and \'world\''), '"hello" and \'world\'');
});

test('leaves text with no quote characters at all unchanged', () => {
  assert.equal(normalizeSmartQuotes('no quotes here'), 'no quotes here');
});

test('handles null/undefined gracefully, returning them as-is rather than throwing', () => {
  assert.equal(normalizeSmartQuotes(null), null);
  assert.equal(normalizeSmartQuotes(undefined), undefined);
});

test('handles an empty string', () => {
  assert.equal(normalizeSmartQuotes(''), '');
});

// ---- the exact real-world scenarios this bug actually affects -------------

test('THE REAL BUG: an org-xx-extra-menu double-quoted token typed on iOS, with curly quotes instead of straight ones, normalizes back to something the real parser recognizes', () => {
  const iosTyped = '\u201Ct;\u2b50 Tracking\u201D \u201Cj;\ud83d\udcd4 Journal\u201D';
  assert.equal(normalizeSmartQuotes(iosTyped), '"t;\u2b50 Tracking" "j;\ud83d\udcd4 Journal"');
});

test('THE REAL BUG: a function-reference entry\u2019s own leading SINGLE quote sigil, converted to a curly one by autocorrect, normalizes back correctly', () => {
  assert.equal(normalizeSmartQuotes('\u2018org-clock-out;\u23f9 clock-out'), "'org-clock-out;\u23f9 clock-out");
});

test('THE REAL BUG: an OLP header array (which JSON.parse would otherwise throw on outright with curly quotes) normalizes to valid JSON', () => {
  const iosTyped = '\u201cJournal\u201d, \u201c%<%Y-%m>\u201d';
  const normalized = normalizeSmartQuotes(`[${iosTyped}]`);
  assert.doesNotThrow(() => JSON.parse(normalized));
  assert.deepEqual(JSON.parse(normalized), ['Journal', '%<%Y-%m>']);
});

test('THE REAL BUG: an org-xx-menu-aliases token typed with curly quotes normalizes correctly', () => {
  const iosTyped = '\u201cfile:New;\u2795\u201d';
  assert.equal(normalizeSmartQuotes(iosTyped), '"file:New;\u2795"');
});

test('mixed straight and curly quotes in the same string are all normalized consistently', () => {
  const mixed = '"straight" and \u201ccurly\u201d together';
  assert.equal(normalizeSmartQuotes(mixed), '"straight" and "curly" together');
});
