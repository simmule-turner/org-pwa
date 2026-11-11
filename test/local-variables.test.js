import test from 'node:test';
import assert from 'node:assert/strict';
import { VariableValueError } from '../src/variable-error.js';
import {
  BLOCK_PROBLEM,
  variableProblems,
  parseLocalVariables,
  getIndentTables,
  getSearchExtraFilesVar,
  parseLispBoolean,
  parseLispNumber,
  getAgendaStartOnWeekday,
  getDeadlineWarningDays,
  getScheduledDelayDays,
  getCalendarLatitude,
  getCalendarLongitude,
  getTimeDisplayForm,
  isTimeDisplay24,
  DEFAULT_TIME_DISPLAY_FORM,
  TIME_DISPLAY_FORM_24,
  getOrgWeatherFormat,
  getOrgWeatherSpeedUnit,
  getOrgWeatherTemperatureUnit,
  getOrgTableDurationHourZeroPadding,
  getAgendaFilesVar,
  parseAgendaFilesVar,
  fileListProblem,
  findDuplicateAgendaFiles,
  getCycleOpenArchivedTrees,
  getAgendaShowAllDates,
  getAgendaSkipCommentTrees,
  getAgendaSkipArchivedTrees,
  getClosedKeepWhenNoTodo,
  getRefileTargets,
  getExtraMenu,
  getMenuAliases,
  getAsciiTextWidth,
  getUseTagInheritance,
  getUsePropertyInheritance,
  getBufferReadOnly,
  getGodModeButton,
  getUseSubSuperscripts,
} from '../src/local-variables.js';
import { mergeGlobalAndLocalVariables } from '../src/global-variables.js';

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

test('a Local Variables block with no End: line gives no variables and Emacs\'s message (not half-applied)', () => {
  const text = ['# Local Variables:', '# org-agenda-start-on-weekday: 0'].join('\n');
  const vars = parseLocalVariables(text);
  assert.deepEqual(vars, { [BLOCK_PROBLEM]: 'Local variables list is not properly terminated' });
  assert.deepEqual(variableProblems(vars), ['Local variables list is not properly terminated']);
});

test('is tolerant of extra whitespace around the values and the End: marker (every line carries the text before "Local Variables:", as Emacs needs)', () => {
  const text = ['#   Local Variables:', '#   org-agenda-start-on-weekday:   2  ', '#   End:  '].join('\n');
  assert.deepEqual(parseLocalVariables(text), { 'org-agenda-start-on-weekday': '2' });
});

test('is case-insensitive to the Local Variables: / End: markers themselves', () => {
  const text = ['# local variables:', '# org-agenda-start-on-weekday: 0', '# end:'].join('\n');
  assert.deepEqual(parseLocalVariables(text), { 'org-agenda-start-on-weekday': '0' });
});

test('a malformed line makes Emacs ignore the whole block (oracle-org-settings.test.js); it never throws', () => {
  const text = [
    '# Local Variables:',
    '# org-agenda-start-on-weekday: 0',
    '# this line has no colon',
    '# org-cycle-open-archived-trees: t',
    '# End:',
  ].join('\n');
  const vars = parseLocalVariables(text);
  assert.deepEqual(vars, { [BLOCK_PROBLEM]: 'File mode specification error: (user-error Malformed local variable line: "this line has no colon")' });
  assert.deepEqual(variableProblems(vars), [vars[BLOCK_PROBLEM]]);
});

test('Emacs\'s other block errors: a line without the prefix, an unreadable value', () => {
  assert.deepEqual(variableProblems(parseLocalVariables(['# Local Variables:', 'no prefix: 1', '# End:'].join('\n'))), ['File mode specification error: (user-error Local variables entry is missing the prefix)']);
  assert.deepEqual(variableProblems(parseLocalVariables(['# Local Variables:', '# fill-column: (1 2', '# End:'].join('\n'))), ['File mode specification error: (end-of-file)']);
});

test('skipped Extras and menu-alias entries and unavailable diary hook functions are reported by name', () => {
  assert.deepEqual(variableProblems({ 'org-xx-extra-menu': '"x"', 'org-xx-menu-aliases': '"nomenu" "bogus:A;B"', 'diary-list-entries-hook': "'(diary-sort-entries no-such-fn)" }), [
    'org-xx-extra-menu: "x" has no label',
    'org-xx-menu-aliases: "nomenu" has no "menu:" before the label',
    'org-xx-menu-aliases: "bogus:A;B" names the menu "bogus", which does not exist',
    'diary-list-entries-hook: no-such-fn is not available here; only diary-include-other-diary-files and diary-sort-entries run',
  ]);
});

test('an arbitrary/future variable name is captured too, not just the two currently acted on', () => {
  const text = ['# Local Variables:', '# some-future-variable: whatever-value', '# End:'].join('\n');
  assert.deepEqual(parseLocalVariables(text), { 'some-future-variable': 'whatever-value' });
});

// ---- parseLispBoolean / parseLispNumber ----------------------------------

test('parseLispBoolean follows Emacs: nil is false, any other value is true, unset keeps the default', () => {
  assert.equal(parseLispBoolean('t'), true);
  assert.equal(parseLispBoolean('nil'), false);
  assert.equal(parseLispBoolean('()'), false);
  assert.equal(parseLispBoolean('true'), true); // a symbol: non-nil
  assert.equal(parseLispBoolean('1'), true);
  assert.equal(parseLispBoolean(undefined, true), true);
  assert.equal(parseLispBoolean(undefined), false);
});

test('parseLispNumber reads a number, keeps the default when unset, and names the variable and value when it is not a number', () => {
  assert.equal(parseLispNumber('0'), 0);
  assert.equal(parseLispNumber('  3  '), 3);
  assert.equal(parseLispNumber(undefined, 7), 7);
  assert.throws(() => parseLispNumber('not-a-number', 42, 'org-x'), (e) => e instanceof VariableValueError && e.variable === 'org-x' && e.value === 'not-a-number' && /org-x is "not-a-number", which is not a number/.test(e.message));
});

test('variableProblems lists each variable that cannot be used, and nothing for unset ones', () => {
  assert.deepEqual(variableProblems({}), []);
  const found = variableProblems({ 'org-deadline-warning-days': 'abc', 'org-xx-size-limit-image': 'big', 'org-priority-lowest': 'zz' });
  assert.equal(found.length, 3);
  assert.ok(found.some((m) => /org-deadline-warning-days is "abc"/.test(m)));
  assert.ok(found.some((m) => /org-xx-size-limit-image is "big"/.test(m)));
  assert.ok(found.some((m) => /org-priority-lowest is "zz"/.test(m)));
});

// ---- getAgendaStartOnWeekday / getCycleOpenArchivedTrees -----------------

test('getAgendaStartOnWeekday defaults to 1 (Monday), matching real org\'s own default', () => {
  assert.equal(getAgendaStartOnWeekday({}), 1);
});

test('getAgendaStartOnWeekday reads the configured value', () => {
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '0' }), 0);
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '2' }), 2);
});

test('getAgendaStartOnWeekday counts modulo 7 as Emacs does (oracle: 9 starts the week on Tuesday, -2 on Friday)', () => {
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '9' }), 2);
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '-2' }), 5);
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '-1' }), 6);
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

test('getAgendaShowAllDates defaults to true (show every day), matching real org\'s own default', () => {
  assert.equal(getAgendaShowAllDates({}), true);
});

test('getAgendaShowAllDates reads nil as false (hide empty days)', () => {
  assert.equal(getAgendaShowAllDates({ 'org-agenda-show-all-dates': 'nil' }), false);
});

test('getAgendaShowAllDates is safe with undefined/null vars', () => {
  assert.equal(getAgendaShowAllDates(undefined), true);
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
  assert.equal(getRefileTargets({ 'org-refile-targets': '((nil :maxlevel . 3))' }), '((nil :maxlevel . 3))');
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

test('getAsciiTextWidth is used as given, even 0 or less (Emacs 29.3 then puts every word on its own line)', () => {
  assert.equal(getAsciiTextWidth({ 'org-ascii-text-width': '0' }), 0);
  assert.equal(getAsciiTextWidth({ 'org-ascii-text-width': '-10' }), -10);
});

test('getAsciiTextWidth reports a value that is not a number', () => {
  assert.throws(() => getAsciiTextWidth({ 'org-ascii-text-width': 'garbage' }), VariableValueError);
});

// ---- line continuation (trailing backslash) --------------------------------

test('a trailing backslash joins the value with the next physical line, stripping that line\u2019s own "# " comment prefix', () => {
  const text = '* H\n# Local Variables:\n# org-xx-extra-menu: "a" \\\n#                 "b"\n# End:\n';
  assert.equal(parseLocalVariables(text)['org-xx-extra-menu'], '"a" "b"');
});

test('joining works across more than two lines', () => {
  const text = '* H\n# Local Variables:\n# org-xx-extra-menu: "a" \\\n#                 "b" \\\n#                 "c"\n# End:\n';
  assert.equal(parseLocalVariables(text)['org-xx-extra-menu'], '"a" "b" "c"');
});

test('a variable with no trailing backslash is completely unaffected, and a following variable parses normally', () => {
  const text = '* H\n# Local Variables:\n# org-xx-extra-menu: "a" \\\n#                 "b"\n# org-agenda-start-on-weekday: 1\n# End:\n';
  const result = parseLocalVariables(text);
  assert.equal(result['org-xx-extra-menu'], '"a" "b"');
  assert.equal(result['org-agenda-start-on-weekday'], '1');
});

test('no double space when the source line has whitespace before the backslash', () => {
  const text = '* H\n# Local Variables:\n# org-xx-extra-menu: "a"   \\\n#                 "b"\n# End:\n';
  assert.equal(parseLocalVariables(text)['org-xx-extra-menu'], '"a" "b"');
});

// ---- getExtraMenu -----------------------------------------------------------

test('getExtraMenu returns the raw string value unchanged', () => {
  assert.equal(getExtraMenu({ 'org-xx-extra-menu': '"t;Tracking"' }), '"t;Tracking"');
});

test('getExtraMenu returns an empty string when unset, not undefined', () => {
  assert.equal(getExtraMenu({}), '');
  assert.equal(getExtraMenu(null), '');
});

// ---- getMenuAliases ----

test('getMenuAliases returns the raw string value unchanged', () => {
  const vars = { 'org-xx-menu-aliases': '"file:New;\u2795" "export:HTML;"' };
  assert.equal(getMenuAliases(vars), '"file:New;\u2795" "export:HTML;"');
});

test('getMenuAliases returns an empty string when unset, not undefined', () => {
  assert.equal(getMenuAliases({}), '');
  assert.equal(getMenuAliases(null), '');
});

// ---- getDeadlineWarningDays -------------------------------------------------

test('THE FIX: getDeadlineWarningDays defaults to 14, matching real org\u2019s own confirmed default (not 0)', () => {
  assert.equal(getDeadlineWarningDays({}), 14);
  assert.equal(getDeadlineWarningDays(null), 14);
});

test('getDeadlineWarningDays reads an explicit override', () => {
  assert.equal(getDeadlineWarningDays({ 'org-deadline-warning-days': '7' }), 7);
});

test('getDeadlineWarningDays allows 0 explicitly (no early warning at all) -- distinct from "unset"', () => {
  assert.equal(getDeadlineWarningDays({ 'org-deadline-warning-days': '0' }), 0);
});

test('a negative value is kept: Emacs (org-get-wdays) uses its opposite as the window (test/oracle-agenda.test.js, "setting warn -3")', () => {
  assert.equal(getDeadlineWarningDays({ 'org-deadline-warning-days': '-5' }), -5);
});

test('a non-numeric value is an error naming the variable', () => {
  assert.throws(() => getDeadlineWarningDays({ 'org-deadline-warning-days': 'abc' }), /org-deadline-warning-days is "abc"/);
});

// ---- getScheduledDelayDays ---------------------------------------------------

test('getScheduledDelayDays defaults to 0 -- unlike DEADLINE\u2019s own proactive-warning default, a nonzero default here would silently hide every ordinary SCHEDULED item, contradicting the Org manual\u2019s own bare SCHEDULED example', () => {
  assert.equal(getScheduledDelayDays({}), 0);
  assert.equal(getScheduledDelayDays(null), 0);
});

test('getScheduledDelayDays reads an explicit override', () => {
  assert.equal(getScheduledDelayDays({ 'org-scheduled-delay-days': '3' }), 3);
});

test('a negative value is kept: Emacs (org-get-wdays) uses its opposite as the delay (test/oracle-agenda.test.js, "setting delay -2")', () => {
  assert.equal(getScheduledDelayDays({ 'org-scheduled-delay-days': '-2' }), -2);
});

test('a non-numeric value is an error naming the variable', () => {
  assert.throws(() => getScheduledDelayDays({ 'org-scheduled-delay-days': 'abc' }), /org-scheduled-delay-days is "abc"/);
});

// ---- calendar-latitude / calendar-longitude -----------------------------

test('getCalendarLatitude/Longitude default to Durham, NC, as requested', () => {
  assert.equal(getCalendarLatitude({}), 35.994);
  assert.equal(getCalendarLongitude({}), -78.8986);
});

test('getCalendarLatitude/Longitude read an explicit override', () => {
  assert.equal(getCalendarLatitude({ 'calendar-latitude': '40.1' }), 40.1);
  assert.equal(getCalendarLongitude({ 'calendar-longitude': '-88.2' }), -88.2);
});

test('getTimeDisplayForm is Emacs\u2019s default unless calendar-time-display-form is set', () => {
  assert.equal(getTimeDisplayForm({}), '(12-hours ":" minutes am-pm (if time-zone " (") time-zone (if time-zone ")"))');
  assert.equal(getTimeDisplayForm(undefined), DEFAULT_TIME_DISPLAY_FORM);
  assert.equal(getTimeDisplayForm({ 'calendar-time-display-form': '(24-hours ":" minutes)' }), '(24-hours ":" minutes)');
});

test('isTimeDisplay24: only a form that names 24-hours and not 12-hours', () => {
  assert.equal(isTimeDisplay24({}), false);
  assert.equal(isTimeDisplay24({ 'calendar-time-display-form': TIME_DISPLAY_FORM_24 }), true);
  assert.equal(isTimeDisplay24({ 'calendar-time-display-form': '(12-hours ":" minutes am-pm)' }), false);
  assert.equal(isTimeDisplay24({ 'calendar-time-display-form': '(24-hours ":" minutes " " time-zone)' }), true);
});

test('THE FIX: getOrgWeatherFormat defaults to the exact format given in the original request', () => {
  assert.equal(getOrgWeatherFormat({}), 'Weather: %desc, %tcur(%tmin-%tmax)%tu, %p%pu, %h%hu, %s%su, %a%au');
  assert.equal(getOrgWeatherFormat(undefined), 'Weather: %desc, %tcur(%tmin-%tmax)%tu, %p%pu, %h%hu, %s%su, %a%au');
});

test('getOrgWeatherFormat reads an explicit override', () => {
  assert.equal(getOrgWeatherFormat({ 'org-weather-format': '"%icon %tcur%tu"' }), '%icon %tcur%tu');
});

test('THE FIX: getOrgWeatherSpeedUnit defaults to mph, matching what this app always fetches in', () => {
  assert.equal(getOrgWeatherSpeedUnit({}), 'mph');
});

test('getOrgWeatherSpeedUnit reads a valid override; an unrecognized value is an error that names the variable', () => {
  assert.equal(getOrgWeatherSpeedUnit({ 'org-weather-speed-unit': 'km/h' }), 'km/h');
  assert.equal(getOrgWeatherSpeedUnit({ 'org-weather-speed-unit': 'm/s' }), 'm/s');
  assert.equal(getOrgWeatherSpeedUnit({ 'org-weather-speed-unit': 'Knots' }), 'Knots');
  assert.equal(getOrgWeatherSpeedUnit({}), 'mph');
  assert.throws(() => getOrgWeatherSpeedUnit({ 'org-weather-speed-unit': 'bogus' }), /org-weather-speed-unit is "bogus", which is not one of km\/h, m\/s, mph, Knots/);
});

test('THE FIX: getOrgWeatherTemperatureUnit defaults to \u00b0F, matching what this app always fetches in', () => {
  assert.equal(getOrgWeatherTemperatureUnit({}), '\u00b0F');
});

test('getOrgWeatherTemperatureUnit reads a valid override; an unrecognized value is an error that names the variable', () => {
  assert.equal(getOrgWeatherTemperatureUnit({ 'org-weather-temperature-unit': '\u00b0C' }), '\u00b0C');
  assert.equal(getOrgWeatherTemperatureUnit({}), '\u00b0F');
  assert.throws(() => getOrgWeatherTemperatureUnit({ 'org-weather-temperature-unit': 'bogus' }), /org-weather-temperature-unit is "bogus"/);
});

test('latitude and longitude are used as given, in or out of the usual range (Emacs 29.3 computes with them)', () => {
  assert.equal(getCalendarLatitude({ 'calendar-latitude': '95' }), 95);
  assert.equal(getCalendarLongitude({ 'calendar-longitude': '200' }), 200);
});

test('a variable holding Lisp with unbalanced parentheses is reported with Emacs\'s words', () => {
  assert.deepEqual(variableProblems({ 'org-refile-targets': '((nil :maxlevel . 3)' }), ['org-refile-targets: End of file during parsing']);
  assert.deepEqual(variableProblems({ 'org-refile-targets': '(a))' }), ['org-refile-targets: Invalid read syntax: ")"']);
  assert.deepEqual(variableProblems({ 'org-refile-targets': '((nil :maxlevel . 3))', 'org-x': '"(not a list"' }), []);
});

// ---- getAgendaFilesVar -------------------------------------------------------

test('getAgendaFilesVar defaults to an empty string when unset', () => {
  assert.equal(getAgendaFilesVar({}), '');
  assert.equal(getAgendaFilesVar(null), '');
});

test('getAgendaFilesVar returns the raw semicolon-separated string as-is', () => {
  assert.equal(getAgendaFilesVar({ 'org-agenda-files': 'github:journal.org;webdav:notes/todo.org' }), 'github:journal.org;webdav:notes/todo.org');
});

// ---- parseAgendaFilesVar -------------------------------------------------------

test('parseAgendaFilesVar reads the Emacs list of github:/webdav: names, with or without the quote', () => {
  assert.deepEqual(parseAgendaFilesVar('("github:contacts.org" "webdav:notes/todo.org")'), ['github:contacts.org', 'webdav:notes/todo.org']);
  assert.deepEqual(parseAgendaFilesVar("'(\"github:a.org\")"), ['github:a.org']);
});

test('parseAgendaFilesVar returns an empty array for an empty or unset value, and for nil', () => {
  assert.deepEqual(parseAgendaFilesVar(''), []);
  assert.deepEqual(parseAgendaFilesVar(null), []);
  assert.deepEqual(parseAgendaFilesVar(undefined), []);
  assert.deepEqual(parseAgendaFilesVar('nil'), []);
  assert.deepEqual(parseAgendaFilesVar('()'), []);
});

test('parseAgendaFilesVar drops an entry with no recognized scheme, keeping the rest', () => {
  assert.deepEqual(parseAgendaFilesVar('("github:a.org" "not-a-real-scheme:b.org" "webdav:c.org")'), ['github:a.org', 'webdav:c.org']);
});

test('parseAgendaFilesVar drops an entry with an empty path', () => {
  assert.deepEqual(parseAgendaFilesVar('("github:" "webdav:c.org")'), ['webdav:c.org']);
});

test('the old semicolon text is not a list: it reads as nothing, and fileListProblem says why', () => {
  assert.deepEqual(parseAgendaFilesVar('github:a.org;webdav:b.org'), []);
  assert.match(fileListProblem('github:a.org;webdav:b.org') || '', /must be a list of file names/);
  assert.equal(fileListProblem('("github:a.org")'), null);
  assert.equal(fileListProblem(''), null);
  assert.equal(fileListProblem('nil'), null);
  assert.match(fileListProblem('("github:a.org" "x.org")') || '', /not a file name starting with/);
});

// ---- THE EXACT REQUEST: a file-local org-agenda-files override --------------

test('THE EXACT REQUEST: a document\u2019s own "# Local Variables:" org-agenda-files line takes precedence over the global Settings value once merged, matching real Emacs org-mode\u2019s own confirmed behavior (the agenda command honors a file-local override when run from within that specific buffer)', () => {
  const orgText = [
    '* TODO Something',
    '',
    '# Local Variables:',
    '# org-agenda-files: ("github:contacts.org" "github:journal.org")',
    '# End:',
  ].join('\n');
  const rawLocalVars = parseLocalVariables(orgText);
  const globalVariables = { 'org-agenda-files': 'github:old-global-value.org' };
  const merged = mergeGlobalAndLocalVariables(globalVariables, rawLocalVars);
  assert.equal(getAgendaFilesVar(merged), '("github:contacts.org" "github:journal.org")');
  assert.deepEqual(parseAgendaFilesVar(getAgendaFilesVar(merged)), ['github:contacts.org', 'github:journal.org']);
});

test('with NO file-local override, the merged value correctly falls back to the global one', () => {
  const rawLocalVars = parseLocalVariables('* A heading\nNo local variables block here.\n');
  const globalVariables = { 'org-agenda-files': 'github:only-global.org' };
  const merged = mergeGlobalAndLocalVariables(globalVariables, rawLocalVars);
  assert.equal(getAgendaFilesVar(merged), 'github:only-global.org');
});

test('THE FIX: getOrgTableDurationHourZeroPadding defaults to true, matching real org\u2019s own confirmed default (a duration formula\u2019s own hours field is zero-padded by default)', () => {
  assert.equal(getOrgTableDurationHourZeroPadding({}), true);
  assert.equal(getOrgTableDurationHourZeroPadding(undefined), true);
});

test('getOrgTableDurationHourZeroPadding reads an explicit override', () => {
  assert.equal(getOrgTableDurationHourZeroPadding({ 'org-table-duration-hour-zero-padding': 'nil' }), false);
  assert.equal(getOrgTableDurationHourZeroPadding({ 'org-table-duration-hour-zero-padding': 't' }), true);
});

// ---- THE FEATURE: the first-line "-*- ... -*-" cookie -------------------

test('THE FEATURE: parseLocalVariables reads a first-line "-*- var: val; -*-" cookie, real Emacs\u2019s own other local-variables mechanism', () => {
  const vars = parseLocalVariables('# -*- buffer-read-only: t; -*-\n* Heading\n');
  assert.equal(vars['buffer-read-only'], 't');
});

test('the cookie supports multiple semicolon-separated entries on one line', () => {
  const vars = parseLocalVariables('# -*- buffer-read-only: t; org-use-tag-inheritance: nil; -*-\n* Heading\n');
  assert.equal(vars['buffer-read-only'], 't');
  assert.equal(vars['org-use-tag-inheritance'], 'nil');
});

test('a document with no cookie and no Local Variables block returns an empty object, unaffected', () => {
  assert.deepEqual(parseLocalVariables('* Heading\nBody text.\n'), {});
});

test('THE FEATURE: when both the cookie and the end-of-file block set the SAME variable, the block wins -- confirmed directly against real Emacs\u2019s own documented precedence (\u201cprocesses everything in the -*- line first, and everything in the local variables list afterward\u201d) before implementing this, not assumed', () => {
  const doc = '# -*- buffer-read-only: t; -*-\n* Heading\n# Local Variables:\n# buffer-read-only: nil\n# End:\n';
  const vars = parseLocalVariables(doc);
  assert.equal(vars['buffer-read-only'], 'nil');
});

test('the cookie and the block can set DIFFERENT variables at once, both taking effect together', () => {
  const doc = '# -*- buffer-read-only: t; -*-\n* Heading\n# Local Variables:\n# org-cycle-open-archived-trees: t\n# End:\n';
  const vars = parseLocalVariables(doc);
  assert.equal(vars['buffer-read-only'], 't');
  assert.equal(vars['org-cycle-open-archived-trees'], 't');
});

test('a malformed/absent cookie (no closing "-*-") is silently ignored, not an error', () => {
  assert.deepEqual(parseLocalVariables('# -*- buffer-read-only: t;\n* Heading\n'), {});
});

// ---- getBufferReadOnly ----------------------------------------------------

test('getBufferReadOnly defaults to false, real Emacs\u2019s own actual default (read-write unless marked otherwise)', () => {
  assert.equal(getBufferReadOnly({}), false);
  assert.equal(getBufferReadOnly(undefined), false);
});

test('getBufferReadOnly reads t/nil the same Lisp-boolean way every other variable here does', () => {
  assert.equal(getBufferReadOnly({ 'buffer-read-only': 't' }), true);
  assert.equal(getBufferReadOnly({ 'buffer-read-only': 'nil' }), false);
});

test('getIndentTables: tables are indented with the text unless org-xx-indent-tables is nil', () => {
  assert.equal(getIndentTables({}), true);
  assert.equal(getIndentTables({ 'org-xx-indent-tables': 't' }), true);
  assert.equal(getIndentTables({ 'org-xx-indent-tables': 'nil' }), false);
});

// ---- getGodModeButton -----------------------------------------------------

test('getGodModeButton defaults to on: the [g] button is shown unless someone turns it off', () => {
  assert.equal(getGodModeButton({}), true);
  assert.equal(getGodModeButton(undefined), true);
});

test('getGodModeButton reads t/nil the same Lisp-boolean way every other variable here does, and ignores anything else', () => {
  assert.equal(getGodModeButton({ 'org-xx-god-mode-button': 't' }), true);
  assert.equal(getGodModeButton({ 'org-xx-god-mode-button': 'nil' }), false);
  assert.equal(getGodModeButton({ 'org-xx-god-mode-button': 'maybe' }), true);
});

test('getGodModeButton: a document\u2019s own Local Variables line overrides the global setting, like every other variable', () => {
  const merged = mergeGlobalAndLocalVariables({ 'org-xx-god-mode-button': 'nil' }, { 'org-xx-god-mode-button': 't' });
  assert.equal(getGodModeButton(merged), true);
  assert.equal(getGodModeButton(mergeGlobalAndLocalVariables({ 'org-xx-god-mode-button': 'nil' }, {})), false);
});

test('parseAgendaFilesVar accepts local: entries (a file opened on this device) next to github: and webdav:', () => {
  assert.deepEqual(parseAgendaFilesVar('("github:a.org" "local:notes.org" "webdav:b/c.org")'), ['github:a.org', 'local:notes.org', 'webdav:b/c.org']);
});

test('parseAgendaFilesVar still drops a local: entry with no name, and any other scheme', () => {
  assert.deepEqual(parseAgendaFilesVar('("local:" "file:x.org" "ftp:y.org" "local:ok.org")'), ['local:ok.org']);
});

// ---- findDuplicateAgendaFiles ---------------------------------------------------

test('the same file name under two schemes is a duplicate, and the first entry is the one that is used', () => {
  assert.deepEqual([...findDuplicateAgendaFiles(['github:notes.org', 'local:notes.org'])], [['local:notes.org', 'github:notes.org']]);
  assert.deepEqual([...findDuplicateAgendaFiles(['webdav:a/x.org', 'github:a/x.org', 'local:a/x.org'])], [['github:a/x.org', 'webdav:a/x.org'], ['local:a/x.org', 'webdav:a/x.org']]);
});

test('different paths are not duplicates, even with the same file name in different folders', () => {
  assert.equal(findDuplicateAgendaFiles(['github:work/notes.org', 'webdav:home/notes.org', 'local:notes.org']).size, 0);
});

test('the same entry written twice is not a conflict, and an empty list has none', () => {
  assert.equal(findDuplicateAgendaFiles(['github:a.org', 'github:a.org']).size, 0);
  assert.equal(findDuplicateAgendaFiles([]).size, 0);
});

test('org-agenda-text-search-extra-files is read like the other file lists, and parses the same way', () => {
  assert.equal(getSearchExtraFilesVar({}), '');
  assert.equal(getSearchExtraFilesVar(undefined), '');
  const raw = getSearchExtraFilesVar({ 'org-agenda-text-search-extra-files': '("github:notes/ref.org" "webdav:archive/2024.org" "local:scratch.org")' });
  assert.deepEqual(parseAgendaFilesVar(raw), ['github:notes/ref.org', 'webdav:archive/2024.org', 'local:scratch.org']);
  assert.equal(getAgendaFilesVar({ 'org-agenda-text-search-extra-files': 'github:a.org' }), '', 'it is a variable of its own: it does not add to the agenda files');
});


test('getDragHandle: right by default, left or off when set, anything else is an error', async () => {
  const { getDragHandle } = await import('../src/local-variables.js');
  assert.equal(getDragHandle({}), 'right');
  assert.equal(getDragHandle({ 'org-xx-drag-handle': 'left' }), 'left');
  assert.equal(getDragHandle({ 'org-xx-drag-handle': 'Off' }), 'off');
  assert.equal(getDragHandle({ 'org-xx-drag-handle': 'nil' }), 'off');
  assert.throws(() => getDragHandle({ 'org-xx-drag-handle': 'sideways' }), /org-xx-drag-handle is "sideways", which is not one of right, left, off/);
});
