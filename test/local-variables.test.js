import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLocalVariables,
  parseLispBoolean,
  parseLispNumber,
  getAgendaStartOnWeekday,
  getCycleOpenArchivedTrees,
  getAgendaSkipCommentTrees,
  getAgendaSkipArchivedTrees,
  getClosedKeepWhenNoTodo,
  getRefileTargets,
  getExtraMenu,
  getFileMenuAliases,
  getMoreMenuAliases,
  getExportMenuAliases,
  getViewMenuAliases,
  getAsciiTextWidth,
  getUseTagInheritance,
  getUsePropertyInheritance,
  getUseSubSuperscripts,
} from '../src/local-variables.js';

// ---- parseLocalVariables --------------------------------------------------

test('THE EXACT FORMAT FROM THE REQUEST parses correctly', () => {
  const text = [
    '* Some heading',
    'Some content.',
    '',
    '# Local Variables:',
    '# org-agenda-start-on-weekday: 0',
    '# org-cycle-open-archived-trees: t',
    '# End:',
  ].join('\n');
  assert.deepEqual(parseLocalVariables(text), {
    'org-agenda-start-on-weekday': '0',
    'org-cycle-open-archived-trees': 't',
  });
});

test('returns an empty object when there is no Local Variables block at all', () => {
  assert.deepEqual(parseLocalVariables('* A heading\nSome text.'), {});
  assert.deepEqual(parseLocalVariables(''), {});
  assert.deepEqual(parseLocalVariables(null), {});
});

test('returns an empty object for a Local Variables block with no End: line (malformed, not half-applied)', () => {
  const text = ['# Local Variables:', '# org-agenda-start-on-weekday: 0'].join('\n');
  assert.deepEqual(parseLocalVariables(text), {});
});

test('is tolerant of extra whitespace around the markers and values', () => {
  const text = ['#   Local Variables:  ', '#  org-agenda-start-on-weekday:   2  ', '#   End:  '].join('\n');
  assert.deepEqual(parseLocalVariables(text), { 'org-agenda-start-on-weekday': '2' });
});

test('is case-insensitive to the Local Variables: / End: markers themselves', () => {
  const text = ['# local variables:', '# org-agenda-start-on-weekday: 0', '# end:'].join('\n');
  assert.deepEqual(parseLocalVariables(text), { 'org-agenda-start-on-weekday': '0' });
});

test('skips a malformed line inside the block instead of throwing', () => {
  const text = [
    '# Local Variables:',
    '# org-agenda-start-on-weekday: 0',
    '# this line has no colon',
    '# org-cycle-open-archived-trees: t',
    '# End:',
  ].join('\n');
  assert.deepEqual(parseLocalVariables(text), {
    'org-agenda-start-on-weekday': '0',
    'org-cycle-open-archived-trees': 't',
  });
});

test('an arbitrary/future variable name is captured too, not just the two currently acted on', () => {
  const text = ['# Local Variables:', '# some-future-variable: whatever-value', '# End:'].join('\n');
  assert.deepEqual(parseLocalVariables(text), { 'some-future-variable': 'whatever-value' });
});

// ---- parseLispBoolean / parseLispNumber ----------------------------------

test('parseLispBoolean follows Lisp convention (t/nil), not JS truthiness', () => {
  assert.equal(parseLispBoolean('t'), true);
  assert.equal(parseLispBoolean('nil'), false);
  assert.equal(parseLispBoolean('T'), true); // case-insensitive
  assert.equal(parseLispBoolean('true'), false); // NOT a Lisp boolean -- falls back
  assert.equal(parseLispBoolean(undefined, true), true); // missing -> fallback
});

test('parseLispNumber parses a numeric string, falling back on garbage', () => {
  assert.equal(parseLispNumber('0'), 0);
  assert.equal(parseLispNumber('  3  '), 3);
  assert.equal(parseLispNumber('not-a-number', 42), 42);
  assert.equal(parseLispNumber(undefined, 7), 7);
});

// ---- getAgendaStartOnWeekday / getCycleOpenArchivedTrees -----------------

test('getAgendaStartOnWeekday defaults to 1 (Monday), matching real org\'s own default', () => {
  assert.equal(getAgendaStartOnWeekday({}), 1);
});

test('getAgendaStartOnWeekday reads the configured value', () => {
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '0' }), 0);
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '2' }), 2);
});

test('getAgendaStartOnWeekday falls back to Monday for an out-of-range value', () => {
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '9' }), 1);
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '-1' }), 1);
});

test('getCycleOpenArchivedTrees defaults to false (nil/off), matching real org\'s own default', () => {
  assert.equal(getCycleOpenArchivedTrees({}), false);
});

test('getCycleOpenArchivedTrees reads t as true', () => {
  assert.equal(getCycleOpenArchivedTrees({ 'org-cycle-open-archived-trees': 't' }), true);
});

test('both getters are safe to call with undefined/null vars (e.g. before any file is loaded)', () => {
  assert.equal(getAgendaStartOnWeekday(undefined), 1);
  assert.equal(getAgendaStartOnWeekday(null), 1);
  assert.equal(getCycleOpenArchivedTrees(undefined), false);
  assert.equal(getCycleOpenArchivedTrees(null), false);
});

test('getAgendaSkipCommentTrees defaults to true (skip), matching real org\'s own default', () => {
  assert.equal(getAgendaSkipCommentTrees({}), true);
});

test('getAgendaSkipCommentTrees reads nil as false (include commented headings)', () => {
  assert.equal(getAgendaSkipCommentTrees({ 'org-agenda-skip-comment-trees': 'nil' }), false);
});

test('getAgendaSkipArchivedTrees defaults to true (skip), matching real org\'s own default', () => {
  assert.equal(getAgendaSkipArchivedTrees({}), true);
});

test('getAgendaSkipArchivedTrees reads nil as false (include archived headings)', () => {
  assert.equal(getAgendaSkipArchivedTrees({ 'org-agenda-skip-archived-trees': 'nil' }), false);
});

test('both new getters are safe with undefined/null vars', () => {
  assert.equal(getAgendaSkipCommentTrees(undefined), true);
  assert.equal(getAgendaSkipArchivedTrees(undefined), true);
});

// ---- getUseSubSuperscripts -------------------------------------------------

test('getUseSubSuperscripts defaults to t when unset', () => {
  assert.equal(getUseSubSuperscripts({}), 't');
});

test('getUseSubSuperscripts returns nil when explicitly set', () => {
  assert.equal(getUseSubSuperscripts({ 'org-use-sub-superscripts': 'nil' }), 'nil');
});

test("getUseSubSuperscripts returns '{}' when explicitly set", () => {
  assert.equal(getUseSubSuperscripts({ 'org-use-sub-superscripts': '{}' }), '{}');
});

test('getUseSubSuperscripts falls back to t for an unrecognized value', () => {
  assert.equal(getUseSubSuperscripts({ 'org-use-sub-superscripts': 'garbage' }), 't');
});

// ---- getClosedKeepWhenNoTodo --------------------------------------------

test('getClosedKeepWhenNoTodo defaults to false (nil), matching real org', () => {
  assert.equal(getClosedKeepWhenNoTodo({}), false);
});

test('getClosedKeepWhenNoTodo returns true when explicitly set to t', () => {
  assert.equal(getClosedKeepWhenNoTodo({ 'org-closed-keep-when-no-todo': 't' }), true);
});

test('getClosedKeepWhenNoTodo returns false when explicitly set to nil', () => {
  assert.equal(getClosedKeepWhenNoTodo({ 'org-closed-keep-when-no-todo': 'nil' }), false);
});

// ---- getUseTagInheritance / getUsePropertyInheritance ----------------

test('getUseTagInheritance defaults to true, matching real org (tags inherit by default)', () => {
  assert.equal(getUseTagInheritance({}), true);
});

test('getUseTagInheritance can be turned off', () => {
  assert.equal(getUseTagInheritance({ 'org-use-tag-inheritance': 'nil' }), false);
});

test('getUsePropertyInheritance defaults to false, matching real org (properties do NOT inherit by default)', () => {
  assert.equal(getUsePropertyInheritance({}), false);
});

test('getUsePropertyInheritance can be turned on', () => {
  assert.equal(getUsePropertyInheritance({ 'org-use-property-inheritance': 't' }), true);
});

// ---- getRefileTargets ------------------------------------------------------

test('getRefileTargets returns the raw string value unchanged', () => {
  assert.equal(getRefileTargets({ 'org-refile-targets': 'current maxlevel=3' }), 'current maxlevel=3');
});

test('getRefileTargets returns an empty string when unset, not undefined', () => {
  assert.equal(getRefileTargets({}), '');
  assert.equal(getRefileTargets(null), '');
});

// ---- getAsciiTextWidth ------------------------------------------------------

test('getAsciiTextWidth defaults to 72, matching real org\u2019s own default exactly', () => {
  assert.equal(getAsciiTextWidth({}), 72);
  assert.equal(getAsciiTextWidth(null), 72);
});

test('getAsciiTextWidth parses a set numeric value', () => {
  assert.equal(getAsciiTextWidth({ 'org-ascii-text-width': '100' }), 100);
});

test('getAsciiTextWidth falls back to 72 for a non-positive value rather than producing zero/negative-width wrapping', () => {
  assert.equal(getAsciiTextWidth({ 'org-ascii-text-width': '0' }), 72);
  assert.equal(getAsciiTextWidth({ 'org-ascii-text-width': '-10' }), 72);
});

test('getAsciiTextWidth falls back to 72 for an unparseable value', () => {
  assert.equal(getAsciiTextWidth({ 'org-ascii-text-width': 'garbage' }), 72);
});

// ---- line continuation (trailing backslash) --------------------------------

test('a trailing backslash joins the value with the next physical line, stripping that line\u2019s own "# " comment prefix', () => {
  const text = '* H\n# Local Variables:\n# org-extra-menu: "a" \\\n#                 "b"\n# End:\n';
  assert.equal(parseLocalVariables(text)['org-extra-menu'], '"a" "b"');
});

test('joining works across more than two lines', () => {
  const text = '* H\n# Local Variables:\n# org-extra-menu: "a" \\\n#                 "b" \\\n#                 "c"\n# End:\n';
  assert.equal(parseLocalVariables(text)['org-extra-menu'], '"a" "b" "c"');
});

test('a variable with no trailing backslash is completely unaffected, and a following variable parses normally', () => {
  const text = '* H\n# Local Variables:\n# org-extra-menu: "a" \\\n#                 "b"\n# org-agenda-start-on-weekday: 1\n# End:\n';
  const result = parseLocalVariables(text);
  assert.equal(result['org-extra-menu'], '"a" "b"');
  assert.equal(result['org-agenda-start-on-weekday'], '1');
});

test('no double space when the source line has whitespace before the backslash', () => {
  const text = '* H\n# Local Variables:\n# org-extra-menu: "a"   \\\n#                 "b"\n# End:\n';
  assert.equal(parseLocalVariables(text)['org-extra-menu'], '"a" "b"');
});

// ---- getExtraMenu -----------------------------------------------------------

test('getExtraMenu returns the raw string value unchanged', () => {
  assert.equal(getExtraMenu({ 'org-extra-menu': '"t;Tracking"' }), '"t;Tracking"');
});

test('getExtraMenu returns an empty string when unset, not undefined', () => {
  assert.equal(getExtraMenu({}), '');
  assert.equal(getExtraMenu(null), '');
});

// ---- getFileMenuAliases / getMoreMenuAliases / getExportMenuAliases / getViewMenuAliases ----

test('each of the 4 menu-alias accessors returns the raw string value unchanged', () => {
  const vars = {
    'org-xx-file-menu': '"New;\u2795"',
    'org-xx-more-menu': '"Search;\ud83d\udd0d"',
    'org-xx-export-menu': '"Markdown;"',
    'org-xx-view-menu': '"Org;\ud83d\udcdd"',
  };
  assert.equal(getFileMenuAliases(vars), '"New;\u2795"');
  assert.equal(getMoreMenuAliases(vars), '"Search;\ud83d\udd0d"');
  assert.equal(getExportMenuAliases(vars), '"Markdown;"');
  assert.equal(getViewMenuAliases(vars), '"Org;\ud83d\udcdd"');
});

test('each accessor returns an empty string when unset, not undefined', () => {
  assert.equal(getFileMenuAliases({}), '');
  assert.equal(getMoreMenuAliases(null), '');
  assert.equal(getExportMenuAliases({}), '');
  assert.equal(getViewMenuAliases(null), '');
});
