import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGlobalVariables, serializeGlobalVariables, mergeGlobalAndLocalVariables } from '../src/global-variables.js';

// ---- parseGlobalVariables: the (setq NAME VALUE) forms of an init file ----------

test('reads a (setq NAME VALUE) form, the value as its source', () => {
  assert.deepEqual(parseGlobalVariables("(setq org-log-done 'time)"), { 'org-log-done': "'time" });
});

test('one setq may set several variables, and several forms may follow each other', () => {
  const vars = parseGlobalVariables("(setq org-log-done 'time\n      org-agenda-start-on-weekday 1)\n\n\n(setq org-archive-confirm nil)");
  assert.deepEqual(vars, { 'org-log-done': "'time", 'org-agenda-start-on-weekday': '1', 'org-archive-confirm': 'nil' });
});

test('comments, forms that are not a setq, and text outside a form are skipped', () => {
  const vars = parseGlobalVariables(";; my settings\n(message \"hi\")\nthis is not a form\n(setq org-log-done 'time) ; trailing\n(setq org-tags-column -80)");
  assert.deepEqual(vars, { 'org-log-done': "'time", 'org-tags-column': '-80' });
});

test('a value may be a string with line breaks and parentheses, or a quoted list', () => {
  const vars = parseGlobalVariables('(setq org-xx-extra-menu "a\nb (not a paren" org-todo-keywords \'((sequence "TODO(t)" "DONE(d)")))');
  assert.deepEqual(vars, { 'org-xx-extra-menu': '"a\nb (not a paren"', 'org-todo-keywords': `'((sequence "TODO(t)" "DONE(d)"))` });
});

test('an empty string produces an empty map', () => {
  assert.deepEqual(parseGlobalVariables(''), {});
});

test('null/undefined input produces an empty map rather than throwing', () => {
  assert.deepEqual(parseGlobalVariables(null), {});
  assert.deepEqual(parseGlobalVariables(undefined), {});
});

test('a setq with a name and no value, and the old "name: value" lines, set nothing', () => {
  assert.deepEqual(parseGlobalVariables("(setq org-log-done)\norg-log-done: 'time"), {});
});

test('a variable name with hyphens and digits parses correctly', () => {
  assert.deepEqual(parseGlobalVariables('(setq org-agenda-skip-archived-trees-2 nil)'), { 'org-agenda-skip-archived-trees-2': 'nil' });
});

test('later forms override earlier ones for the same variable, as in Emacs', () => {
  assert.deepEqual(parseGlobalVariables("(setq org-log-done nil)\n(setq org-log-done 'time)"), { 'org-log-done': "'time" });
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

// ---- serializeGlobalVariables (the Quick Settings round trip) --------------------

test('serializeGlobalVariables produces one (setq NAME VALUE) per variable, sorted by name', () => {
  const text = serializeGlobalVariables({ 'org-deadline-warning-days': 7, 'calendar-latitude': 40.1 });
  assert.equal(text, '(setq calendar-latitude 40.1)\n(setq org-deadline-warning-days 7)');
});

test('serializeGlobalVariables omits null/undefined/empty-string values entirely, rather than an empty form', () => {
  assert.equal(serializeGlobalVariables({ a: '1', b: null, c: undefined, d: '' }), '(setq a 1)');
});

test('serializeGlobalVariables round-trips correctly through parseGlobalVariables', () => {
  const original = { 'org-agenda-skip-archived-trees': 'nil', 'org-deadline-warning-days': '7', 'org-xx-extra-menu': '"a\nb (c"', 'org-todo-keywords': `'((sequence "TODO" "DONE"))` };
  assert.deepEqual(parseGlobalVariables(serializeGlobalVariables(original)), original);
});

test('serializeGlobalVariables of an empty object produces an empty string', () => {
  assert.equal(serializeGlobalVariables({}), '');
});
