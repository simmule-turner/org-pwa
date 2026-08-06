import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExtraMenu, KNOWN_FUNCTIONS } from '../src/extra-menu.js';

// ---- basic cases -------------------------------------------------------

test('an unset/empty value returns an empty array, not an error', () => {
  assert.deepEqual(parseExtraMenu(''), []);
  assert.deepEqual(parseExtraMenu(null), []);
  assert.deepEqual(parseExtraMenu(undefined), []);
  assert.deepEqual(parseExtraMenu('   '), []);
});

test('parses a single capture-key entry', () => {
  assert.deepEqual(parseExtraMenu('"t;\u2b50 Tracking"'), [{ type: 'capture', key: 't', label: '\u2b50 Tracking' }]);
});

test('parses multiple entries', () => {
  const result = parseExtraMenu('"t;Tracking" "j;Journal"');
  assert.deepEqual(result, [
    { type: 'capture', key: 't', label: 'Tracking' },
    { type: 'capture', key: 'j', label: 'Journal' },
  ]);
});

test('extra whitespace between tokens is tolerated', () => {
  const result = parseExtraMenu('  "t;Tracking"    "j;Journal"  ');
  assert.deepEqual(result, [
    { type: 'capture', key: 't', label: 'Tracking' },
    { type: 'capture', key: 'j', label: 'Journal' },
  ]);
});

// ---- separators ----------------------------------------------------------

test('a five-hyphen token is a separator entry', () => {
  assert.deepEqual(parseExtraMenu('"-----"'), [{ type: 'separator' }]);
});

test('separators can appear between and around real entries', () => {
  const result = parseExtraMenu('"t;Tracking" "-----" "j;Journal"');
  assert.deepEqual(result, [
    { type: 'capture', key: 't', label: 'Tracking' },
    { type: 'separator' },
    { type: 'capture', key: 'j', label: 'Journal' },
  ]);
});

// ---- capture-key entries ---------------------------------------------------

test('a capture key can be multiple characters', () => {
  assert.deepEqual(parseExtraMenu('"ab;Multi-char key"'), [{ type: 'capture', key: 'ab', label: 'Multi-char key' }]);
});

test('a capture key can include digits', () => {
  assert.deepEqual(parseExtraMenu('"t1;Numbered"'), [{ type: 'capture', key: 't1', label: 'Numbered' }]);
});

// ---- OLP entries ------------------------------------------------------------

test('parses a bracketed OLP array', () => {
  const result = parseExtraMenu('"["Journal", "%<%Y-%m>"];\ud83d\udc41 Current"');
  assert.deepEqual(result, [{ type: 'olp', headers: ['Journal', '%<%Y-%m>'], label: '\ud83d\udc41 Current' }]);
});

test('an OLP array with a single header', () => {
  const result = parseExtraMenu('"["Inbox"];Inbox"');
  assert.deepEqual(result, [{ type: 'olp', headers: ['Inbox'], label: 'Inbox' }]);
});

test('a malformed OLP array (not valid JSON) is skipped, not a hard error', () => {
  assert.deepEqual(parseExtraMenu('"[not valid json];Broken"'), []);
});

test('an OLP array containing a non-string element is skipped', () => {
  assert.deepEqual(parseExtraMenu('"[1, 2];Broken"'), []);
});

// ---- function-reference entries --------------------------------------------

test('parses a recognized function reference', () => {
  assert.deepEqual(parseExtraMenu("\"'org-clock-out;\u23f9 clock-out\""), [
    { type: 'function', name: 'org-clock-out', label: '\u23f9 clock-out' },
  ]);
});

test('an unrecognized function name is skipped, not a hard error -- forward-compatible tolerance for a name that might be added later', () => {
  assert.deepEqual(parseExtraMenu("\"'org-nonexistent-function;Nope\""), []);
});

test('KNOWN_FUNCTIONS currently contains exactly org-clock-out and org-clock-cancel, matching what\u2019s actually implemented', () => {
  assert.deepEqual([...KNOWN_FUNCTIONS], ['org-clock-out', 'org-clock-cancel']);
});

test('parses org-clock-cancel as a recognized function-reference entry', () => {
  assert.deepEqual(parseExtraMenu("\"'org-clock-cancel;\u274c Cancel clock\""), [
    { type: 'function', name: 'org-clock-cancel', label: '\u274c Cancel clock' },
  ]);
});

// ---- malformed entries, tolerance -------------------------------------------

test('an entry missing its semicolon (no label at all) is skipped', () => {
  assert.deepEqual(parseExtraMenu('"tnolabelhere"'), []);
});

test('an entry with an empty label is skipped', () => {
  assert.deepEqual(parseExtraMenu('"t;"'), []);
});

test('a bad entry is skipped but does not affect the other, valid entries around it', () => {
  const result = parseExtraMenu('"t;Tracking" "[bad json];Broken" "j;Journal"');
  assert.deepEqual(result, [
    { type: 'capture', key: 't', label: 'Tracking' },
    { type: 'capture', key: 'j', label: 'Journal' },
  ]);
});

test('a spec with disallowed characters (not a valid capture key, OLP, or function ref) is skipped', () => {
  assert.deepEqual(parseExtraMenu('"t!@#;Weird"'), []);
});

// ---- the full worked example from the request -------------------------------

test('the full multi-entry example parses completely and correctly', () => {
  const raw =
    '"t;\u2b50 Tracking" "["Journal", "%<%Y-%m>"];\ud83d\udc41 Current" "-----" "j;\ud83d\udcd4 Journal" "c;\u2705 Checklist" "m;\ud83d\udc65 Meeting" "\'org-clock-out;\u23f9 clock-out"';
  const result = parseExtraMenu(raw);
  assert.deepEqual(result, [
    { type: 'capture', key: 't', label: '\u2b50 Tracking' },
    { type: 'olp', headers: ['Journal', '%<%Y-%m>'], label: '\ud83d\udc41 Current' },
    { type: 'separator' },
    { type: 'capture', key: 'j', label: '\ud83d\udcd4 Journal' },
    { type: 'capture', key: 'c', label: '\u2705 Checklist' },
    { type: 'capture', key: 'm', label: '\ud83d\udc65 Meeting' },
    { type: 'function', name: 'org-clock-out', label: '\u23f9 clock-out' },
  ]);
});
