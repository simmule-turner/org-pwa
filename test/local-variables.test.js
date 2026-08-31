import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLocalVariables,
  parseLispBoolean,
  parseLispNumber,
  getAgendaStartOnWeekday,
  getDeadlineWarningDays,
  getScheduledDelayDays,
  getCalendarLatitude,
  getCalendarLongitude,
  getSolarAmpm,
  getSolarHideLabel,
  getOrgWeatherFormat,
  getOrgWeatherSpeedUnit,
  getOrgWeatherTemperatureUnit,
  getOrgTableDurationHourZeroPadding,
  getAgendaFilesVar,
  parseAgendaFilesVar,
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
  const vars = { 'org-xx-menu-aliases': '"file:New;\u2795" "export:Markdown;"' };
  assert.equal(getMenuAliases(vars), '"file:New;\u2795" "export:Markdown;"');
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

test('a negative value falls back to the default rather than producing a nonsensical negative window', () => {
  assert.equal(getDeadlineWarningDays({ 'org-deadline-warning-days': '-5' }), 14);
});

test('a non-numeric value falls back to the default', () => {
  assert.equal(getDeadlineWarningDays({ 'org-deadline-warning-days': 'abc' }), 14);
});

// ---- getScheduledDelayDays ---------------------------------------------------

test('getScheduledDelayDays defaults to 0 -- unlike DEADLINE\u2019s own proactive-warning default, a nonzero default here would silently hide every ordinary SCHEDULED item, contradicting the Org manual\u2019s own bare SCHEDULED example', () => {
  assert.equal(getScheduledDelayDays({}), 0);
  assert.equal(getScheduledDelayDays(null), 0);
});

test('getScheduledDelayDays reads an explicit override', () => {
  assert.equal(getScheduledDelayDays({ 'org-scheduled-delay-days': '3' }), 3);
});

test('a negative value falls back to 0 rather than producing a nonsensical negative delay', () => {
  assert.equal(getScheduledDelayDays({ 'org-scheduled-delay-days': '-2' }), 0);
});

test('a non-numeric value falls back to 0', () => {
  assert.equal(getScheduledDelayDays({ 'org-scheduled-delay-days': 'abc' }), 0);
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

test('THE FIX: getSolarAmpm defaults to false (24-hour), matching what was originally requested for the four solar functions', () => {
  assert.equal(getSolarAmpm({}), false);
  assert.equal(getSolarAmpm(undefined), false);
});

test('THE FIX: getSolarAmpm reads t as true (12-hour am/pm)', () => {
  assert.equal(getSolarAmpm({ 'solar-ampm': 't' }), true);
  assert.equal(getSolarAmpm({ 'solar-ampm': 'nil' }), false);
});

test('THE FIX: getSolarHideLabel defaults to false (label shown)', () => {
  assert.equal(getSolarHideLabel({}), false);
  assert.equal(getSolarHideLabel(undefined), false);
});

test('THE FIX: getSolarHideLabel reads t as true (label hidden)', () => {
  assert.equal(getSolarHideLabel({ 'solar-hide-label': 't' }), true);
  assert.equal(getSolarHideLabel({ 'solar-hide-label': 'nil' }), false);
});

test('THE FIX: getOrgWeatherFormat defaults to the exact format given in the original request', () => {
  assert.equal(getOrgWeatherFormat({}), 'Weather: %desc, %tcur(%tmin-%tmax)%tu, %p%pu, %h%hu, %s%su, %a%au');
  assert.equal(getOrgWeatherFormat(undefined), 'Weather: %desc, %tcur(%tmin-%tmax)%tu, %p%pu, %h%hu, %s%su, %a%au');
});

test('getOrgWeatherFormat reads an explicit override', () => {
  assert.equal(getOrgWeatherFormat({ 'org-weather-format': '%icon %tcur%tu' }), '%icon %tcur%tu');
});

test('THE FIX: getOrgWeatherSpeedUnit defaults to mph, matching what this app always fetches in', () => {
  assert.equal(getOrgWeatherSpeedUnit({}), 'mph');
});

test('getOrgWeatherSpeedUnit reads a valid override; an unrecognized value falls back to the default rather than passing a malformed unit through', () => {
  assert.equal(getOrgWeatherSpeedUnit({ 'org-weather-speed-unit': 'km/h' }), 'km/h');
  assert.equal(getOrgWeatherSpeedUnit({ 'org-weather-speed-unit': 'm/s' }), 'm/s');
  assert.equal(getOrgWeatherSpeedUnit({ 'org-weather-speed-unit': 'Knots' }), 'Knots');
  assert.equal(getOrgWeatherSpeedUnit({ 'org-weather-speed-unit': 'bogus' }), 'mph');
});

test('THE FIX: getOrgWeatherTemperatureUnit defaults to \u00b0F, matching what this app always fetches in', () => {
  assert.equal(getOrgWeatherTemperatureUnit({}), '\u00b0F');
});

test('getOrgWeatherTemperatureUnit reads a valid override; an unrecognized value falls back to the default', () => {
  assert.equal(getOrgWeatherTemperatureUnit({ 'org-weather-temperature-unit': '\u00b0C' }), '\u00b0C');
  assert.equal(getOrgWeatherTemperatureUnit({ 'org-weather-temperature-unit': 'bogus' }), '\u00b0F');
});

test('an out-of-range latitude/longitude falls back to the default', () => {
  assert.equal(getCalendarLatitude({ 'calendar-latitude': '95' }), 35.994);
  assert.equal(getCalendarLongitude({ 'calendar-longitude': '200' }), -78.8986);
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

test('parseAgendaFilesVar parses semicolon-separated github:/webdav: entries', () => {
  assert.deepEqual(parseAgendaFilesVar('github:contacts.org;webdav:notes/todo.org'), ['github:contacts.org', 'webdav:notes/todo.org']);
});

test('parseAgendaFilesVar returns an empty array for an empty or unset value', () => {
  assert.deepEqual(parseAgendaFilesVar(''), []);
  assert.deepEqual(parseAgendaFilesVar(null), []);
  assert.deepEqual(parseAgendaFilesVar(undefined), []);
});

test('parseAgendaFilesVar drops an entry with no recognized scheme, keeping the rest', () => {
  assert.deepEqual(parseAgendaFilesVar('github:a.org;not-a-real-scheme:b.org;webdav:c.org'), ['github:a.org', 'webdav:c.org']);
});

test('parseAgendaFilesVar drops an entry with an empty path', () => {
  assert.deepEqual(parseAgendaFilesVar('github:;webdav:c.org'), ['webdav:c.org']);
});

test('parseAgendaFilesVar trims whitespace around each entry', () => {
  assert.deepEqual(parseAgendaFilesVar('  github:a.org ; webdav:b.org  '), ['github:a.org', 'webdav:b.org']);
});

// ---- THE EXACT REQUEST: a file-local org-agenda-files override --------------

test('THE EXACT REQUEST: a document\u2019s own "# Local Variables:" org-agenda-files line takes precedence over the global Settings value once merged, matching real Emacs org-mode\u2019s own confirmed behavior (the agenda command honors a file-local override when run from within that specific buffer)', () => {
  const orgText = [
    '* TODO Something',
    '',
    '# Local Variables:',
    '# org-agenda-files: github:contacts.org;github:journal.org',
    '# End:',
  ].join('\n');
  const rawLocalVars = parseLocalVariables(orgText);
  const globalVariables = { 'org-agenda-files': 'github:old-global-value.org' };
  const merged = mergeGlobalAndLocalVariables(globalVariables, rawLocalVars);
  assert.equal(getAgendaFilesVar(merged), 'github:contacts.org;github:journal.org');
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
