import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGlobalVariables, serializeGlobalVariables, mergeGlobalAndLocalVariables } from '../src/global-variables.js';

// ---- parseGlobalVariables --------------------------------------------------

test('parses a simple "name: value" line', () => {
  assert.deepEqual(parseGlobalVariables("org-log-done: 'time"), { 'org-log-done': "'time" });
});

test('parses multiple lines into one map', () => {
  const vars = parseGlobalVariables("org-log-done: 'time\norg-agenda-start-on-weekday: 1");
  assert.deepEqual(vars, { 'org-log-done': "'time", 'org-agenda-start-on-weekday': '1' });
});

test('blank lines are skipped', () => {
  const vars = parseGlobalVariables("org-log-done: 'time\n\n\norg-archive-confirm: nil");
  assert.deepEqual(vars, { 'org-log-done': "'time", 'org-archive-confirm': 'nil' });
});

test('leading/trailing whitespace on a line and around the value is trimmed', () => {
  const vars = parseGlobalVariables('   org-log-done:    \'time   ');
  assert.deepEqual(vars, { 'org-log-done': "'time" });
});

test('an empty string produces an empty map', () => {
  assert.deepEqual(parseGlobalVariables(''), {});
});

test('null/undefined input produces an empty map rather than throwing', () => {
  assert.deepEqual(parseGlobalVariables(null), {});
  assert.deepEqual(parseGlobalVariables(undefined), {});
});

test('a malformed line (no colon) is silently skipped, not an error', () => {
  const vars = parseGlobalVariables("this has no colon at all\norg-log-done: 'time");
  assert.deepEqual(vars, { 'org-log-done': "'time" });
});

test('a variable name with hyphens and digits parses correctly', () => {
  const vars = parseGlobalVariables('org-agenda-skip-archived-trees-2: nil');
  assert.deepEqual(vars, { 'org-agenda-skip-archived-trees-2': 'nil' });
});

test('later lines override earlier ones for the same key, matching the last-line-wins convention of a plain key:value text block', () => {
  const vars = parseGlobalVariables('org-log-done: nil\norg-log-done: \'time');
  assert.deepEqual(vars, { 'org-log-done': "'time" });
});

// ---- mergeGlobalAndLocalVariables ------------------------------------------

test('merge: a key only in global variables passes through unchanged', () => {
  const merged = mergeGlobalAndLocalVariables({ 'org-log-done': "'time" }, {});
  assert.equal(merged['org-log-done'], "'time");
});

test('merge: a key only in local variables passes through unchanged', () => {
  const merged = mergeGlobalAndLocalVariables({}, { 'org-log-done': "'note" });
  assert.equal(merged['org-log-done'], "'note");
});

test('merge: a key in BOTH resolves in favor of local variables (the higher-precedence, more file-specific override)', () => {
  const merged = mergeGlobalAndLocalVariables({ 'org-log-done': "'time" }, { 'org-log-done': "'note" });
  assert.equal(merged['org-log-done'], "'note");
});

test('merge: keys present in only one side are all preserved alongside an overridden key', () => {
  const merged = mergeGlobalAndLocalVariables(
    { 'org-log-done': "'time", 'org-archive-confirm': 'nil' },
    { 'org-log-done': "'note", 'org-agenda-start-on-weekday': '0' }
  );
  assert.deepEqual(merged, {
    'org-log-done': "'note", // local wins
    'org-archive-confirm': 'nil', // global-only, preserved
    'org-agenda-start-on-weekday': '0', // local-only, preserved
  });
});

test('merge: null/undefined on either side is treated as an empty map, not an error', () => {
  assert.deepEqual(mergeGlobalAndLocalVariables(null, { a: '1' }), { a: '1' });
  assert.deepEqual(mergeGlobalAndLocalVariables({ a: '1' }, null), { a: '1' });
  assert.deepEqual(mergeGlobalAndLocalVariables(null, null), {});
});

// ---- line continuation (trailing backslash) --------------------------------

test('a trailing backslash joins the value with the next physical line', () => {
  const text = 'org-xx-extra-menu: "a" \\\n"b"';
  assert.deepEqual(parseGlobalVariables(text), { 'org-xx-extra-menu': '"a" "b"' });
});

test('joining works across more than two lines', () => {
  const text = 'org-xx-extra-menu: "a" \\\n"b" \\\n"c"';
  assert.deepEqual(parseGlobalVariables(text), { 'org-xx-extra-menu': '"a" "b" "c"' });
});

test('a variable with no trailing backslash is completely unaffected', () => {
  const text = 'org-log-done: \'time\norg-xx-extra-menu: "a" \\\n"b"\nother: value';
  const result = parseGlobalVariables(text);
  assert.equal(result['org-log-done'], "'time");
  assert.equal(result['org-xx-extra-menu'], '"a" "b"');
  assert.equal(result.other, 'value');
});

test('a trailing backslash on the very last line of the whole text is left as a literal character, not silently swallowed', () => {
  const text = 'org-log-done: \'time \\';
  const result = parseGlobalVariables(text);
  assert.equal(result['org-log-done'], "'time \\");
});

test('trailing whitespace after the backslash is tolerated', () => {
  const text = 'org-xx-extra-menu: "a" \\  \n"b"';
  assert.equal(parseGlobalVariables(text)['org-xx-extra-menu'], '"a" "b"');
});

// ---- serializeGlobalVariables (the new Quick Settings UI's own round-trip) ---

test('serializeGlobalVariables produces one "key: value" line per entry, alphabetically sorted', () => {
  const text = serializeGlobalVariables({ 'org-deadline-warning-days': 7, 'calendar-latitude': 40.1 });
  assert.equal(text, 'calendar-latitude: 40.1\norg-deadline-warning-days: 7');
});

test('serializeGlobalVariables omits null/undefined/empty-string values entirely, rather than an empty line', () => {
  const text = serializeGlobalVariables({ a: '1', b: null, c: undefined, d: '' });
  assert.equal(text, 'a: 1');
});

test('serializeGlobalVariables round-trips correctly through parseGlobalVariables', () => {
  const original = { 'org-agenda-skip-archived-trees': 'nil', 'org-deadline-warning-days': '7' };
  const roundTripped = parseGlobalVariables(serializeGlobalVariables(original));
  assert.deepEqual(roundTripped, original);
});

test('serializeGlobalVariables of an empty object produces an empty string', () => {
  assert.equal(serializeGlobalVariables({}), '');
});
