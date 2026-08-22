import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMenuAliases, resolveMenuOrder } from '../src/menu-alias.js';

const EMPTY = { file: {}, more: {}, export: {}, view: {} };

// ---- basic cases -------------------------------------------------------

test('an unset/empty value returns all four menus as empty objects, not an error', () => {
  assert.deepEqual(parseMenuAliases(''), EMPTY);
  assert.deepEqual(parseMenuAliases(null), EMPTY);
  assert.deepEqual(parseMenuAliases(undefined), EMPTY);
  assert.deepEqual(parseMenuAliases('   '), EMPTY);
});

test('parses a single "menu:Label;alias" entry into the right menu\u2019s own sub-table', () => {
  assert.deepEqual(parseMenuAliases('"file:New;\u2795"'), { ...EMPTY, file: { New: '\u2795' } });
});

test('parses multiple entries for the SAME menu', () => {
  assert.deepEqual(parseMenuAliases('"file:New;\u2795" "file:Open;\ud83d\udcc2"'), {
    ...EMPTY,
    file: { New: '\u2795', Open: '\ud83d\udcc2' },
  });
});

test('parses entries spread across DIFFERENT menus in the same value, each landing in its own sub-table', () => {
  const raw = '"file:New;\u2795" "export:ASCII;\ud83d\udcc4" "view:Org;\ud83d\udcdd" "more:Search;\ud83d\udd0d"';
  assert.deepEqual(parseMenuAliases(raw), {
    file: { New: '\u2795' },
    more: { Search: '\ud83d\udd0d' },
    export: { ASCII: '\ud83d\udcc4' },
    view: { Org: '\ud83d\udcdd' },
  });
});

test('extra whitespace between tokens is tolerated', () => {
  assert.deepEqual(parseMenuAliases('  "file:New;\u2795"    "file:Open;\ud83d\udcc2"  '), {
    ...EMPTY,
    file: { New: '\u2795', Open: '\ud83d\udcc2' },
  });
});

// ---- the exact worked examples, updated for the new namespaced syntax -----

test('THE EXACT file menu example parses completely and correctly', () => {
  const raw = '"file:New;\u2795" "file:Open;\ud83d\udcc2" "file:Save;\ud83d\udcbe"';
  assert.deepEqual(parseMenuAliases(raw), {
    ...EMPTY,
    file: { New: '\u2795', Open: '\ud83d\udcc2', Save: '\ud83d\udcbe' },
  });
});

test('THE EXACT export menu example (omit Markdown) parses correctly', () => {
  assert.deepEqual(parseMenuAliases('"export:Markdown;"'), { ...EMPTY, export: { Markdown: '' } });
});

test('THE EXACT more menu example parses completely and correctly, including single-character labels like "+" and "?"', () => {
  const raw = '"more:Search;\ud83d\udd0d" "more:Capture;\ud83d\udcf8" "more:+;\u2795" "more:?;\u2753"';
  assert.deepEqual(parseMenuAliases(raw), {
    ...EMPTY,
    more: { Search: '\ud83d\udd0d', Capture: '\ud83d\udcf8', '+': '\u2795', '?': '\u2753' },
  });
});

// ---- omission (empty alias) ---------------------------------------------

test('an empty alias ("menu:Label;" with nothing after the semicolon) is stored as an empty string, distinct from "not mentioned at all"', () => {
  const result = parseMenuAliases('"export:Markdown;"');
  assert.equal('Markdown' in result.export, true);
  assert.equal(result.export.Markdown, '');
});

test('a label never mentioned at all has no entry -- distinguishable from an explicit empty-alias omission', () => {
  const result = parseMenuAliases('"file:Open;\ud83d\udcc2"');
  assert.equal('New' in result.file, false);
});

// ---- malformed entries, tolerance ----------------------------------------

test('an entry with no "menu:" prefix at all is skipped, not a hard error', () => {
  assert.deepEqual(parseMenuAliases('"New;\u2795"'), EMPTY);
});

test('an entry naming an unrecognized menu (not file/more/export/view) is skipped', () => {
  assert.deepEqual(parseMenuAliases('"bogus:New;\u2795"'), EMPTY);
});

test('an entry with no semicolon at all (after a valid "menu:" prefix) is skipped', () => {
  assert.deepEqual(parseMenuAliases('"file:NoSemicolonHere"'), EMPTY);
});

test('a bad entry does not affect other, valid entries around it', () => {
  assert.deepEqual(parseMenuAliases('"file:New;\u2795" "file:NoSemicolonHere" "file:Open;\ud83d\udcc2"'), {
    ...EMPTY,
    file: { New: '\u2795', Open: '\ud83d\udcc2' },
  });
});

test('an entry with nothing before the semicolon (no label) is skipped', () => {
  assert.deepEqual(parseMenuAliases('"file:;alias"'), EMPTY);
});

// ---- whitespace handling --------------------------------------------------

test('whitespace around the menu, label, and alias within a token is trimmed', () => {
  assert.deepEqual(parseMenuAliases('" file : New ; \u2795 "'), { ...EMPTY, file: { New: '\u2795' } });
});

test('a semicolon with only whitespace after it is treated as an empty alias (omit)', () => {
  assert.deepEqual(parseMenuAliases('"export:Markdown;   "'), { ...EMPTY, export: { Markdown: '' } });
});

// ---- multi-line values (line-continuation, matching every other multi-entry variable) ----

test('a value spread across multiple lines via a trailing backslash (already joined by the Global/Local Variables line-continuation mechanism before reaching this parser) parses the same as a single line', () => {
  const joined = '"file:New;\u2795" "file:Open;\ud83d\udcc2" "file:Save;\ud83d\udcbe"'; // joinContinuedLines already collapsed the "\" line breaks before this
  assert.deepEqual(parseMenuAliases(joined), {
    ...EMPTY,
    file: { New: '\u2795', Open: '\ud83d\udcc2', Save: '\ud83d\udcbe' },
  });
});

// ---- no aliases configured at all ----------------------------

test('no value at all returns no overrides for any menu -- every button keeps its default label', () => {
  assert.deepEqual(parseMenuAliases(undefined), EMPTY);
});

// ---- resolveMenuOrder ---------------------------------------------------

test('THE EXACT REQUEST: every label mentioned -- the menu is reordered to match', () => {
  assert.deepEqual(resolveMenuOrder({ Capture: '', Search: '', History: '' }, ['Search', 'Capture', 'History']), ['Capture', 'Search', 'History']);
});

test('THE EXACT REQUEST: an empty alias still counts as "mentioned" for ordering purposes -- it just doesn\u2019t change the label', () => {
  assert.deepEqual(resolveMenuOrder({ B: '', A: '\u2795' }, ['A', 'B']), ['B', 'A']);
});

test('a partial listing leaves the default order completely untouched', () => {
  assert.deepEqual(resolveMenuOrder({ Search: '' }, ['Search', 'Capture', 'History']), ['Search', 'Capture', 'History']);
});

test('no aliases at all -- default order', () => {
  assert.deepEqual(resolveMenuOrder({}, ['Search', 'Capture', 'History']), ['Search', 'Capture', 'History']);
});

test('an alias-map key naming a label that doesn\u2019t exist in the menu is silently dropped from the result', () => {
  assert.deepEqual(resolveMenuOrder({ B: '', Typo: '', A: '' }, ['A', 'B']), ['B', 'A']);
});

test('hiding a button (empty alias) still lets it establish its own position -- ordering and visibility are separate concerns', () => {
  // Even though 'B' would be hidden by its own empty alias in the actual rendering, its POSITION in the order is still honored here -- appendMenuButtonsInOrder's own null-btn check is what actually omits it from the DOM.
  assert.deepEqual(resolveMenuOrder({ C: '', B: '', A: '' }, ['A', 'B', 'C']), ['C', 'B', 'A']);
});
