import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVariableIndex } from '../src/variable-index.js';
import { parseElispLink } from '../src/elisp-link.js';
import { VARIABLE_CATALOG } from '../src/variable-catalog.js';
import { getDisplayTimeFormat } from '../src/local-variables.js';
import { QUICK_SETTINGS_FIELDS, SETTINGS_FIELDS } from '../src-browser/settings-fields.js';

const FIELDS = [
  { key: 'org-log-done', label: 'Log completing a TODO', section: 'Progress logging', default: undefined },
  { key: 'org-agenda-show-future-repeats', label: 'Show repeats', section: 'Agenda', default: true },
  { key: 'org-priority-faces', label: 'Priority colors', section: 'Editing', hidden: true },
];

test('the index holds the fields (shown and hidden), the catalog, and any variable that is only set', () => {
  const index = buildVariableIndex(FIELDS, { 'org-log-done': "'time", 'my-own-var': '42' });
  const by = Object.fromEntries(index.map((e) => [e.name, e]));
  assert.equal(by['org-log-done'].control, 'field');
  assert.equal(by['org-log-done'].value, 'time', 'the value set wins, printed without its quote');
  assert.equal(by['org-agenda-show-future-repeats'].value, 't', 'a boolean default prints as t');
  assert.equal(by['org-priority-faces'].control, 'hidden');
  assert.equal(by['org-priority-faces'].value, 'nil');
  assert.equal(by['org-agenda-span'].control, 'none');
  assert.equal(by['org-agenda-span'].value, 'week', "Emacs's default");
  assert.equal(by['my-own-var'].control, 'none');
  assert.deepEqual(index.map((e) => e.name), index.map((e) => e.name).slice().sort());
});

test('the catalog holds the variables with no control, each with an Emacs default and a description, and none of them has a field', () => {
  const fields = new Set(SETTINGS_FIELDS.map((f) => f.key));
  assert.ok(VARIABLE_CATALOG.length >= 55);
  for (const c of VARIABLE_CATALOG) {
    assert.ok(c.doc && c.default !== '?', `${c.name} has Emacs's description and default`);
    assert.ok(!fields.has(c.name), `${c.name} has a field, so it should not be in the catalog`);
  }
});

test('the elisp: link runs only customize-variable of a known variable', () => {
  const known = (/** @type {string} */ n) => n === 'org-tags-column';
  assert.deepEqual(parseElispLink("elisp:(customize-variable 'org-tags-column)", known), { ok: true, name: 'org-tags-column' });
  assert.deepEqual(parseElispLink('elisp:(customize-variable (quote org-tags-column))', known), { ok: true, name: 'org-tags-column' });
  assert.equal(parseElispLink("elisp:(customize-variable 'nope)", known).ok, false);
  assert.equal(parseElispLink('elisp:(delete-file "x")', known).ok, false);
  assert.equal(parseElispLink("elisp:(progn (customize-variable 'org-tags-column) (kill-emacs))", known).ok, false);
});

test('a setting with no control is not on a Settings page but is still defined; the settings a person uses stay shown', () => {
  const by = Object.fromEntries(SETTINGS_FIELDS.map((f) => [f.key, f]));
  for (const k of ['org-priority-faces', 'org-tags-exclude-from-inheritance', 'org-agenda-sorting-strategy', 'org-weather-format', 'display-time-format']) assert.equal(by[k].hidden, true, k);
  for (const k of ['org-xx-lisp-init', 'org-agenda-files', 'org-contacts-files', 'org-agenda-text-search-extra-files', 'diary-file', 'org-refile-targets', 'calendar-date-style', 'org-agenda-show-future-repeats', 'org-ascii-text-width']) assert.ok(by[k] && !by[k].hidden, k);
  assert.equal(SETTINGS_FIELDS.filter((f) => f.section === 'Size limits').every((f) => f.hidden), true);
  assert.equal(QUICK_SETTINGS_FIELDS.some((f) => f.hidden), false, 'a Settings page shows no setting that has no control');
});

test('the modeline clock follows Emacs: nil is 2:05PM, display-time-24hr-format t makes it 14:05, a format set is used as it is', () => {
  assert.equal(getDisplayTimeFormat({}), '%-I:%M%p');
  assert.equal(getDisplayTimeFormat({ 'display-time-format': 'nil' }), '%-I:%M%p');
  assert.equal(getDisplayTimeFormat({ 'display-time-24hr-format': 't' }), '%H:%M');
  assert.equal(getDisplayTimeFormat({ 'display-time-24hr-format': 'nil' }), '%-I:%M%p');
  assert.equal(getDisplayTimeFormat({ 'display-time-format': '%b%d %H:%M' }), '%b%d %H:%M');
});
