import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExtraMenu } from '../src/extra-menu.js';

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

test('a function name the parser has never heard of is KEPT: recognizing it is the palette\u2019s job, at the moment the item is tapped, so it can be reported by name instead of the entry silently vanishing', () => {
  assert.deepEqual(parseExtraMenu("\"'org-nonexistent-function;Nope\""), [
    { type: 'function', name: 'org-nonexistent-function', label: 'Nope' },
  ]);
});

test('the parser keeps any well-formed function name, including ones from outside org (Emacs commands the palette also names)', () => {
  assert.deepEqual(parseExtraMenu("\"'isearch-forward;Search\" \"'calendar;Calendar\" \"'org-clock-in-last;Resume\""), [
    { type: 'function', name: 'isearch-forward', label: 'Search' },
    { type: 'function', name: 'calendar', label: 'Calendar' },
    { type: 'function', name: 'org-clock-in-last', label: 'Resume' },
  ]);
});

test('a malformed function symbol (does not start with a letter, or has characters a symbol cannot) is still skipped', () => {
  assert.deepEqual(parseExtraMenu("\"'123abc;Nope\""), []);
  assert.deepEqual(parseExtraMenu("\"'org clock;Nope\""), []);
  assert.deepEqual(parseExtraMenu("\"';Nope\""), []);
});

test('parses org-clock-cancel as a function-reference entry', () => {
  assert.deepEqual(parseExtraMenu("\"'org-clock-cancel;\u274c Cancel clock\""), [
    { type: 'function', name: 'org-clock-cancel', label: '\u274c Cancel clock' },
  ]);
});

test('parses org-org-export-as-org as a function-reference entry', () => {
  assert.deepEqual(parseExtraMenu("\"'org-org-export-as-org;\ud83d\udcc4 Export as org\""), [
    { type: 'function', name: 'org-org-export-as-org', label: '\ud83d\udcc4 Export as org' },
  ]);
});

test('parses org-clock-in-last (real org\u2019s name for resuming the last clock) as a function-reference entry', () => {
  assert.deepEqual(parseExtraMenu("\"'org-clock-in-last;\u25b6\ufe0f Resume last clock\""), [
    { type: 'function', name: 'org-clock-in-last', label: '\u25b6\ufe0f Resume last clock' },
  ]);
});

test('THE FIX: parses org-table-recalculate-buffer-tables as a function-reference entry', () => {
  assert.deepEqual(parseExtraMenu("\"'org-table-recalculate-buffer-tables;\ud83d\udd22 Recalc tables\""), [
    { type: 'function', name: 'org-table-recalculate-buffer-tables', label: '\ud83d\udd22 Recalc tables' },
  ]);
});

test('parses calendar (Emacs\u2019s own command name) as a function-reference entry', () => {
  assert.deepEqual(parseExtraMenu("\"'calendar;\ud83d\udcc5 Calendar\""), [
    { type: 'function', name: 'calendar', label: '\ud83d\udcc5 Calendar' },
  ]);
});

test('parses org-cut-subtree as a function-reference entry', () => {
  assert.deepEqual(parseExtraMenu("\"'org-cut-subtree;\u2702\ufe0f Cut Subtree\""), [
    { type: 'function', name: 'org-cut-subtree', label: '\u2702\ufe0f Cut Subtree' },
  ]);
});

test('parses org-paste-subtree as a function-reference entry', () => {
  assert.deepEqual(parseExtraMenu("\"'org-paste-subtree;\ud83d\udccb Paste Subtree\""), [
    { type: 'function', name: 'org-paste-subtree', label: '\ud83d\udccb Paste Subtree' },
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
