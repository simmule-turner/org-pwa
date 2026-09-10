
import test from 'node:test';
import assert from 'node:assert/strict';
import { multiEntryValueToDisplayText, multiEntryDisplayTextToValue } from '../src/multi-entry-format.js';
import { tokenize as tokenizeExtraMenuValue } from '../src/extra-menu.js';
import { tokenizeMenuAliasValue } from '../src/menu-alias.js';

test('multiEntryValueToDisplayText: reformats a flat value into one quoted entry per line with a trailing backslash', () => {
  const flat = '"t;Tracking" "j;Journal"';
  const display = multiEntryValueToDisplayText(flat, tokenizeExtraMenuValue);
  assert.equal(display, '"t;Tracking" \\\n"j;Journal"');
});

test('multiEntryValueToDisplayText: an empty/undefined value produces an empty string, not an error', () => {
  assert.equal(multiEntryValueToDisplayText('', tokenizeExtraMenuValue), '');
  assert.equal(multiEntryValueToDisplayText(undefined, tokenizeExtraMenuValue), '');
});

test('multiEntryValueToDisplayText: a single entry has no trailing backslash at all', () => {
  const display = multiEntryValueToDisplayText('"t;Tracking"', tokenizeExtraMenuValue);
  assert.equal(display, '"t;Tracking"');
});

test('multiEntryDisplayTextToValue: canonicalizes multi-line, backslash-continued text back into one flat, single-line value', () => {
  const display = '"t;Tracking" \\\n"j;Journal"';
  assert.equal(multiEntryDisplayTextToValue(display, tokenizeExtraMenuValue), '"t;Tracking" "j;Journal"');
});

test('multiEntryDisplayTextToValue: also accepts a single run-on line (the trailing backslash was never structurally required)', () => {
  const singleLine = '"t;Tracking" "j;Journal"';
  assert.equal(multiEntryDisplayTextToValue(singleLine, tokenizeExtraMenuValue), '"t;Tracking" "j;Journal"');
});

test('THE FEATURE: round-trips stably -- display-then-canonicalize reproduces the exact same flat value, the actual property that keeps this stable across a reload', () => {
  const flat = '"t;Tracking" "j;Journal" "-----" "c;Checklist"';
  const display = multiEntryValueToDisplayText(flat, tokenizeExtraMenuValue);
  const canonical = multiEntryDisplayTextToValue(display, tokenizeExtraMenuValue);
  assert.equal(canonical, flat);
});

test('THE FEATURE: round-trips correctly even for a bracket-aware OLP entry, whose own token content contains embedded, unescaped double quotes', () => {
  const flat = '"[\\"Journal\\", \\"%<%Y-%m>\\"];\ud83d\udc41 Current" "-----"';
  const display = multiEntryValueToDisplayText(flat, tokenizeExtraMenuValue);
  const canonical = multiEntryDisplayTextToValue(display, tokenizeExtraMenuValue);
  assert.equal(canonical, flat);
});

test('org-xx-menu-aliases (a different tokenizer) round-trips the same way', () => {
  const flat = '"more:Settings;" "more:Capture;\ud83d\udcf8" "view:Org;\ud83d\udcdd"';
  const display = multiEntryValueToDisplayText(flat, tokenizeMenuAliasValue);
  assert.equal(display, '"more:Settings;" \\\n"more:Capture;\ud83d\udcf8" \\\n"view:Org;\ud83d\udcdd"');
  const canonical = multiEntryDisplayTextToValue(display, tokenizeMenuAliasValue);
  assert.equal(canonical, flat);
});

test('multiEntryDisplayTextToValue: editing the entries themselves (not just reformatting) still canonicalizes correctly -- adding an entry', () => {
  const edited = '"t;Tracking" \\\n"j;Journal" \\\n"m;Meeting"'; // a third entry added
  assert.equal(multiEntryDisplayTextToValue(edited, tokenizeExtraMenuValue), '"t;Tracking" "j;Journal" "m;Meeting"');
});

test('multiEntryDisplayTextToValue: removing an entry (deleting its own line) canonicalizes correctly too', () => {
  const edited = '"t;Tracking"'; // the second entry's own line was deleted
  assert.equal(multiEntryDisplayTextToValue(edited, tokenizeExtraMenuValue), '"t;Tracking"');
});

test('multiEntryDisplayTextToValue: empty input canonicalizes to an empty string (caller treats this as "unset")', () => {
  assert.equal(multiEntryDisplayTextToValue('', tokenizeExtraMenuValue), '');
  assert.equal(multiEntryDisplayTextToValue('   \n  ', tokenizeExtraMenuValue), '');
});
