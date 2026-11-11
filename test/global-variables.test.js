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

// ---- the menu variables: a quoted list of Lisp strings, as an init file has them --------------------

test('org-xx-extra-menu and org-xx-menu-aliases are quoted lists of strings, read to the entries the menus take', () => {
  const vars = parseGlobalVariables(`(setq org-xx-extra-menu
      '("a;📅 Appointment"
        "-----"
        "[\\"🛍️ Bag - lists and notes\\", \\"%<%Y-%m>\\"];👁 Current"
        "'calendar;🗓️ Calendar")
      org-xx-menu-aliases '("more:Commands;💲Commands" "more:Settings;⚙️ Settings"))`);
  assert.equal(vars['org-xx-extra-menu'], `"a;📅 Appointment" "-----" "["🛍️ Bag - lists and notes", "%<%Y-%m>"];👁 Current" "'calendar;🗓️ Calendar"`);
  assert.equal(vars['org-xx-menu-aliases'], '"more:Commands;💲Commands" "more:Settings;⚙️ Settings"');
});

test('the menu variables are written as a quoted list, quotes inside an entry escaped, and read back the same', () => {
  const vars = { 'org-xx-extra-menu': '"a;A" "["Bag", "%<%Y>"];Now"', 'org-xx-menu-aliases': '"more:Export;E"' };
  const text = serializeGlobalVariables(vars);
  assert.equal(text, `(setq org-xx-extra-menu '("a;A"\n    "[\\"Bag\\", \\"%<%Y>\\"];Now"))\n(setq org-xx-menu-aliases '("more:Export;E"))`);
  assert.deepEqual(parseGlobalVariables(text), vars);
});
import { parseGlobalVariables as parseLisp, serializeGlobalVariables as serializeLisp } from '../src-browser/global-variables-lisp.js';

test('a string setting with spaces is written as a Lisp string and read back as its text', () => {
  const vars = { 'diary-file': 'webdav:my diary', 'org-deadline-warning-days': '14' };
  const text = serializeLisp(vars);
  assert.equal(text, '(setq diary-file "webdav:my diary")\n(setq org-deadline-warning-days 14)');
  assert.deepEqual(parseLisp(text), vars);
});

test('a list is saved as a quoted list, and a variable with no control stays as it is written', () => {
  const text = serializeLisp({ 'org-contacts-files': '("github:c" "github:d")', 'org-footnote-section': 'nil', 'org-modules': "'(org-habit org-id)" });
  assert.equal(text, '(setq org-contacts-files \'("github:c" "github:d"))\n(setq org-footnote-section nil)\n(setq org-modules \'(org-habit org-id))');
  const back = parseLisp(text);
  assert.equal(back['org-modules'], "'(org-habit org-id)");
  assert.equal(back['org-footnote-section'], 'nil');
});
