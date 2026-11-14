// Every variable the app knows can be set from the Lisp init and from Global Variables. A setting with a control on a Settings page is in
// SETTINGS_FIELDS; every other variable is in VARIABLE_CATALOG and is kept and read as the Lisp text an init file has. Each is in exactly one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_FIELDS } from '../src-browser/settings-fields.js';
import { VARIABLE_CATALOG } from '../src/variable-catalog.js';
import { settingsFromInit } from '../src-browser/lisp-settings.js';
import { parseGlobalVariables, serializeGlobalVariables } from '../src-browser/global-variables-lisp.js';
import { buildVariableIndex } from '../src/variable-index.js';
import {
  getAgendaHideTitleStamps, getAgendaSkipArchivedTrees, getAgendaSkipCommentTrees, getCiteGlobalBibliography, getCiteSeparator, getCiteSortingField,
  getClosedKeepWhenNoTodo, getContactsBirthdayProperty, getDisplayTimeFormat, getExportWithBrokenLinks, getFootnoteAutoAdjust, getFootnoteAutoLabel,
  getFootnoteDefineInline, getFootnoteSection, getOrgTableDurationHourZeroPadding, getOrgTableFormulaCreateColumns, getOrgWeatherFormat, getRefileAllowCreatingParentNodes,
  getUsePropertyInheritance,
} from '../src/local-variables.js';
import { readPriorityRange, startCycleWithDefault } from '../src/priorities.js';

/** The variables of the catalog as Global Variables hold them: the Lisp source after the name, with its quote. */
const vars = (/** @type {string} */ text) => parseGlobalVariables(text);

test('every variable is in exactly one list: a setting with a control, or the catalog', () => {
  const fields = SETTINGS_FIELDS.map((f) => f.key);
  const catalog = VARIABLE_CATALOG.map((c) => c.name);
  assert.equal(new Set(fields).size, fields.length, 'no setting is defined twice');
  assert.equal(new Set(catalog).size, catalog.length, 'no catalog entry is defined twice');
  for (const k of catalog) assert.ok(!fields.includes(k), `${k} is in the catalog and also has a setting`);
});

test('the variables with no control are the ones decided on, and the ones a person uses keep theirs', () => {
  const catalog = new Set(VARIABLE_CATALOG.map((c) => c.name));
  for (const k of [
    'org-tags-exclude-from-inheritance', 'org-agenda-show-inherited-tags', 'org-agenda-use-tag-inheritance', 'org-use-property-inheritance',
    'org-priority-faces', 'org-priority-default', 'org-priority-start-cycle-with-default', 'org-table-duration-hour-zero-padding', 'org-table-formula-create-columns',
    'org-closed-keep-when-no-todo', 'org-refile-allow-creating-parent-nodes', 'org-agenda-skip-archived-trees', 'org-agenda-skip-comment-trees',
    'org-agenda-remove-times-when-in-prefix', 'org-agenda-sorting-strategy', 'org-agenda-custom-commands', 'org-modules', 'org-inlinetask-min-level',
    'org-global-properties', 'org-xx-extra-menu', 'org-xx-menu-aliases', 'diary-list-entries-hook', 'diary-nongregorian-listing-hook',
    'diary-date-forms', 'display-time-format', 'org-contacts-birthday-property', 'org-weather-format', 'large-file-warning-threshold',
    'org-xx-size-limit-org-file', 'org-xx-size-limit-image', 'org-xx-size-limit-attachment', 'org-xx-size-limit-attachment-warn',
    'org-xx-size-limit-bibliography', 'org-xx-size-limit-setupfile', 'org-xx-size-limit-include', 'org-xx-fetch-timeout',
    'org-footnote-section', 'org-footnote-auto-label', 'org-footnote-auto-adjust', 'org-footnote-define-inline',
    'org-clock-into-drawer', 'org-clock-out-switch-to-state', 'org-clock-out-remove-zero-time-clocks',
    'org-cite-global-bibliography', 'org-cite-basic-sorting-field', 'org-cite-basic-author-year-separator',
    'org-export-with-broken-links', 'org-html-doctype', 'org-html-checkbox-type', 'org-icalendar-include-todo', 'org-icalendar-use-scheduled',
    'org-icalendar-use-deadline', 'org-icalendar-with-timestamps', 'org-icalendar-alarm-time',
  ]) assert.ok(catalog.has(k), `${k} has no control`);
  const fields = new Set(SETTINGS_FIELDS.map((f) => f.key));
  for (const k of ['org-xx-lisp-init', 'org-agenda-files', 'org-contacts-files', 'org-agenda-text-search-extra-files', 'diary-file', 'org-refile-targets', 'calendar-date-style', 'org-ascii-text-width', 'org-ascii-charset', 'org-agenda-show-future-repeats', 'org-startup-indented', 'org-xx-indent-tables']) {
    assert.ok(fields.has(k), `${k} keeps its control`);
  }
});

test('the Lisp init sets every variable of the catalog, as the Lisp text its reader takes', () => {
  for (const c of VARIABLE_CATALOG) {
    const { values, errors } = settingsFromInit(`(setq ${c.name} nil)`, {});
    assert.deepEqual(errors, [], c.name);
    assert.equal(values[c.name], ['org-xx-extra-menu', 'org-xx-menu-aliases'].includes(c.name) ? '' : 'nil', `${c.name} from the init`);
  }
  const { values } = settingsFromInit(`(setq org-footnote-section "Notes")\n(setq org-priority-default ?C)\n(setq org-use-property-inheritance t)`, {});
  assert.equal(values['org-footnote-section'], '"Notes"');
  assert.equal(values['org-priority-default'], '67');
  assert.equal(values['org-use-property-inheritance'], 't');
});

test('the init starts from what is saved for a variable with no control, so add-to-list adds to it', () => {
  const { values } = settingsFromInit("(add-to-list 'org-tags-exclude-from-inheritance \"b\")", { 'org-tags-exclude-from-inheritance': '("a")' });
  assert.equal(values['org-tags-exclude-from-inheritance'], '("b" "a")', 'add-to-list puts it first, as Emacs does');
});

test('Global Variables keep a variable with no control exactly as written, and read it back the same', () => {
  const text = [
    '(setq org-agenda-use-tag-inheritance \'(todo search))',
    '(setq org-footnote-section "Notes")',
    '(setq org-priority-default ?C)',
    '(setq org-use-property-inheritance t)',
    '(setq org-xx-size-limit-org-file "4MB")',
  ].join('\n');
  const read = vars(text);
  assert.equal(read['org-footnote-section'], '"Notes"');
  assert.equal(read['org-priority-default'], '?C');
  assert.equal(read['org-agenda-use-tag-inheritance'], "'(todo search)");
  assert.equal(serializeGlobalVariables(read), text.split('\n').sort().join('\n'));
});

test('the readers take the Lisp text of the variables that have no control', () => {
  assert.equal(getFootnoteSection(vars('(setq org-footnote-section "Notes")')), 'Notes');
  assert.equal(getFootnoteSection(vars('(setq org-footnote-section nil)')), null);
  assert.equal(getCiteSeparator(vars('(setq org-cite-basic-author-year-separator "; ")')), '; ');
  assert.equal(getCiteSortingField(vars("(setq org-cite-basic-sorting-field 'year)")), 'year');
  assert.equal(getCiteSortingField(vars('(setq org-cite-basic-sorting-field nil)')), null);
  assert.deepEqual(getCiteGlobalBibliography(vars('(setq org-cite-global-bibliography \'("a.bib" "b.bib"))')), ['a.bib', 'b.bib']);
  assert.equal(getContactsBirthdayProperty(vars('(setq org-contacts-birthday-property "BORN")')), 'BORN');
  assert.equal(getOrgWeatherFormat(vars('(setq org-weather-format "%desc")')), '%desc');
  assert.equal(getDisplayTimeFormat(vars('(setq display-time-format "%b%d %H:%M")')), '%b%d %H:%M');
  assert.equal(getDisplayTimeFormat(vars('(setq display-time-24hr-format t)')), '%H:%M');
  assert.equal(getFootnoteAutoLabel(vars("(setq org-footnote-auto-label 'confirm)")), 'confirm');
  assert.equal(getFootnoteAutoAdjust(vars("(setq org-footnote-auto-adjust 'sort)")), 'sort');
  assert.equal(getRefileAllowCreatingParentNodes(vars("(setq org-refile-allow-creating-parent-nodes 'confirm)")), 'confirm');
  assert.equal(getExportWithBrokenLinks(vars("(setq org-export-with-broken-links 'mark)")), 'mark');
  for (const value of ['t', 'warn', 'prompt', 'nil']) assert.equal(getOrgTableFormulaCreateColumns(vars(`(setq org-table-formula-create-columns ${value === 't' || value === 'nil' ? value : "'" + value})`)), value);
  assert.equal(readPriorityRange(vars('(setq org-priority-default ?C)')).default, 67);
  assert.equal(startCycleWithDefault(vars('(setq org-priority-start-cycle-with-default nil)')), false);
});

test('a variable that is not set reads as its Emacs default, the one the catalog prints', () => {
  const default_ = (/** @type {string} */ name) => /** @type {any} */ (VARIABLE_CATALOG.find((c) => c.name === name)).default;
  const booleans = /** @type {[string, (v: any) => boolean][]} */ ([
    ['org-agenda-skip-archived-trees', getAgendaSkipArchivedTrees],
    ['org-agenda-skip-comment-trees', getAgendaSkipCommentTrees],
    ['org-agenda-remove-times-when-in-prefix', getAgendaHideTitleStamps],
    ['org-closed-keep-when-no-todo', getClosedKeepWhenNoTodo],
    ['org-footnote-define-inline', getFootnoteDefineInline],
    ['org-table-duration-hour-zero-padding', getOrgTableDurationHourZeroPadding],
    ['org-use-property-inheritance', getUsePropertyInheritance],
    ['org-priority-start-cycle-with-default', startCycleWithDefault],
  ]);
  for (const [name, read] of booleans) assert.equal(read({}), default_(name) === 't', name);
  assert.equal(getFootnoteSection({}), JSON.parse(default_('org-footnote-section')));
  assert.equal(getFootnoteAutoLabel({}), default_('org-footnote-auto-label'));
  assert.equal(getFootnoteAutoAdjust({}), default_('org-footnote-auto-adjust'));
  assert.equal(getCiteSeparator({}), JSON.parse(default_('org-cite-basic-author-year-separator')));
  assert.equal(getCiteSortingField({}), default_('org-cite-basic-sorting-field'));
  assert.equal(getContactsBirthdayProperty({}), JSON.parse(default_('org-contacts-birthday-property')));
  assert.equal(getOrgWeatherFormat({}), JSON.parse(default_('org-weather-format')));
  assert.equal(getRefileAllowCreatingParentNodes({}), default_('org-refile-allow-creating-parent-nodes'));
  assert.equal(getExportWithBrokenLinks({}), default_('org-export-with-broken-links'));
  assert.equal(getOrgTableFormulaCreateColumns({}), default_('org-table-formula-create-columns'));
  assert.equal(readPriorityRange({}).default, Number(default_('org-priority-default')));
});

test('the index lists every variable once, and says which have a control and which have none', () => {
  const index = buildVariableIndex(SETTINGS_FIELDS, { 'my-own-var': '1' });
  const names = index.map((e) => e.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, SETTINGS_FIELDS.length + VARIABLE_CATALOG.length + 1);
  const by = Object.fromEntries(index.map((e) => [e.name, e]));
  assert.equal(by['org-agenda-files'].control, 'field');
  assert.equal(by['org-priority-faces'].control, 'none');
  assert.equal(by['org-agenda-span'].control, 'none');
  assert.equal(by['my-own-var'].control, 'none');
});
