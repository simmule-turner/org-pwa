import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMenuAliases } from '../src/menu-alias.js';

// ---- basic cases -------------------------------------------------------

test('an unset/empty value returns an empty object, not an error', () => {
  assert.deepEqual(parseMenuAliases(''), {});
  assert.deepEqual(parseMenuAliases(null), {});
  assert.deepEqual(parseMenuAliases(undefined), {});
  assert.deepEqual(parseMenuAliases('   '), {});
});

test('parses a single "Label;alias" entry', () => {
  assert.deepEqual(parseMenuAliases('"New;\u2795"'), { New: '\u2795' });
});

test('parses multiple entries', () => {
  assert.deepEqual(parseMenuAliases('"New;\u2795" "Open;\ud83d\udcc2"'), { New: '\u2795', Open: '\ud83d\udcc2' });
});

test('extra whitespace between tokens is tolerated', () => {
  assert.deepEqual(parseMenuAliases('  "New;\u2795"    "Open;\ud83d\udcc2"  '), { New: '\u2795', Open: '\ud83d\udcc2' });
});

// ---- the exact worked examples from the request -----------------------

test('THE EXACT org-xx-file-menu EXAMPLE parses completely and correctly', () => {
  const raw = '"New;\u2795" "Open;\ud83d\udcc2" "Save;\ud83d\udcbe" "Save As;\ud83d\udcbe\u2795" "Export;\u2197\ufe0f"';
  assert.deepEqual(parseMenuAliases(raw), {
    New: '\u2795',
    Open: '\ud83d\udcc2',
    Save: '\ud83d\udcbe',
    'Save As': '\ud83d\udcbe\u2795',
    Export: '\u2197\ufe0f',
  });
});

test('THE EXACT org-xx-export-menu EXAMPLE (omit Markdown) parses correctly', () => {
  assert.deepEqual(parseMenuAliases('"Markdown;"'), { Markdown: '' });
});

test('THE EXACT org-xx-more-menu EXAMPLE parses completely and correctly, including single-character labels like "+" and "?"', () => {
  const raw = '"Search;\ud83d\udd0d" "Capture;\ud83d\udcf8" "History;\ud83d\udd04" "+;\u2795" "?;\u2753"';
  assert.deepEqual(parseMenuAliases(raw), {
    Search: '\ud83d\udd0d',
    Capture: '\ud83d\udcf8',
    History: '\ud83d\udd04',
    '+': '\u2795',
    '?': '\u2753',
  });
});

// ---- omission (empty alias) ---------------------------------------------

test('an empty alias ("Label;" with nothing after the semicolon) is stored as an empty string, distinct from "not mentioned at all"', () => {
  const result = parseMenuAliases('"Markdown;"');
  assert.equal('Markdown' in result, true);
  assert.equal(result.Markdown, '');
});

test('a label never mentioned at all has no entry -- distinguishable from an explicit empty-alias omission', () => {
  const result = parseMenuAliases('"Open;\ud83d\udcc2"');
  assert.equal('New' in result, false);
});

// ---- malformed entries, tolerance ----------------------------------------

test('an entry with no semicolon at all is skipped, not a hard error', () => {
  assert.deepEqual(parseMenuAliases('"NoSemicolonHere"'), {});
});

test('a bad entry does not affect other, valid entries around it', () => {
  assert.deepEqual(parseMenuAliases('"New;\u2795" "NoSemicolonHere" "Open;\ud83d\udcc2"'), { New: '\u2795', Open: '\ud83d\udcc2' });
});

test('an entry with nothing before the semicolon (no label) is skipped', () => {
  assert.deepEqual(parseMenuAliases('";alias"'), {});
});

// ---- whitespace handling --------------------------------------------------

test('whitespace around the label and alias within a token is trimmed', () => {
  assert.deepEqual(parseMenuAliases('" New ; \u2795 "'), { New: '\u2795' });
});

test('a semicolon with only whitespace after it is treated as an empty alias (omit)', () => {
  assert.deepEqual(parseMenuAliases('"Markdown;   "'), { Markdown: '' });
});

// ---- multi-line values (line-continuation, matching every other multi-entry variable) ----

test('a value spread across multiple lines via a trailing backslash (already joined by the Global/Local Variables line-continuation mechanism before reaching this parser) parses the same as a single line', () => {
  const joined = '"New;\u2795" "Open;\ud83d\udcc2" "Save;\ud83d\udcbe"'; // joinContinuedLines already collapsed the "\" line breaks before this
  assert.deepEqual(parseMenuAliases(joined), { New: '\u2795', Open: '\ud83d\udcc2', Save: '\ud83d\udcbe' });
});

// ---- view menu: no aliases configured at all ----------------------------

test('org-xx-view-menu with no value at all (the example given) returns no overrides -- every button keeps its default label', () => {
  assert.deepEqual(parseMenuAliases(undefined), {});
});
