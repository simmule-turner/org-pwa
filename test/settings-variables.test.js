// Every variable the app knows can be set from the Lisp init and from Global Variables, with or without a control on a Settings page.
// A setting with a control is in QUICK_SETTINGS_FIELDS; one without is `hidden` in SETTINGS_FIELDS (its type converts the value); a variable
// whose reader takes plain Lisp text is in VARIABLE_CATALOG. Each variable is in exactly one of the three.
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUICK_SETTINGS_FIELDS, SETTINGS_FIELDS } from '../src-browser/settings-fields.js';
import { VARIABLE_CATALOG } from '../src/variable-catalog.js';
import { settingsFromInit } from '../src-browser/lisp-settings.js';
import { parseGlobalVariables, serializeGlobalVariables } from '../src-browser/global-variables-lisp.js';
import { buildVariableIndex } from '../src/variable-index.js';

const NOT_FROM_LISP = new Set(['org-xx-lisp-init', 'org-xx-extensions']);

test('every variable is in exactly one list: a setting with a control, a setting with no control, or the catalog', () => {
  const quick = new Set(QUICK_SETTINGS_FIELDS.map((f) => f.key));
  const hidden = SETTINGS_FIELDS.filter((f) => f.hidden).map((f) => f.key);
  const catalog = VARIABLE_CATALOG.map((c) => c.name);
  assert.equal(new Set(SETTINGS_FIELDS.map((f) => f.key)).size, SETTINGS_FIELDS.length, 'no setting is defined twice');
  assert.equal(quick.size + hidden.length, SETTINGS_FIELDS.length);
  for (const k of hidden) assert.ok(!quick.has(k), `${k} is both shown and hidden`);
  for (const k of catalog) assert.ok(!quick.has(k) && !hidden.includes(k), `${k} is in the catalog and also has a setting`);
  assert.equal(new Set(catalog).size, catalog.length);
});

test('the settings with no control are the ones decided on: the Footnotes, Clocking, Citations and Export groups, Size limits, and the named ones', () => {
  const hidden = new Set(SETTINGS_FIELDS.filter((f) => f.hidden).map((f) => f.key));
  for (const section of ['Footnotes', 'Clocking', 'Citations', 'Size limits', 'Export']) {
    assert.ok(SETTINGS_FIELDS.filter((f) => f.section === section).every((f) => hidden.has(f.key)), `${section} has no control`);
  }
  for (const k of [
    'org-tags-exclude-from-inheritance', 'org-agenda-show-inherited-tags', 'org-agenda-use-tag-inheritance', 'org-use-property-inheritance',
    'org-priority-faces', 'org-priority-default', 'org-priority-start-cycle-with-default', 'org-table-duration-hour-zero-padding',
    'org-closed-keep-when-no-todo', 'org-refile-allow-creating-parent-nodes', 'org-agenda-skip-archived-trees', 'org-agenda-skip-comment-trees',
    'org-agenda-remove-times-when-in-prefix', 'org-agenda-sorting-strategy', 'org-agenda-custom-commands', 'org-modules', 'org-inlinetask-min-level',
    'org-global-properties', 'org-xx-extra-menu', 'org-xx-menu-aliases', 'diary-list-entries-hook', 'diary-nongregorian-listing-hook',
    'diary-date-forms', 'display-time-format', 'org-contacts-birthday-property', 'org-weather-format',
  ]) assert.ok(hidden.has(k), `${k} has no control`);
  for (const k of ['org-xx-lisp-init', 'org-agenda-files', 'org-contacts-files', 'org-agenda-text-search-extra-files', 'diary-file', 'org-refile-targets', 'calendar-date-style', 'org-ascii-text-width', 'org-ascii-charset', 'org-agenda-show-future-repeats']) {
    assert.ok(QUICK_SETTINGS_FIELDS.some((f) => f.key === k), `${k} keeps its control`);
  }
});

test('the Lisp init sets every setting with no control, as the box text its reader expects', () => {
  const sample = (/** @type {any} */ f) => {
    if (f.key === 'large-file-warning-threshold' || /^org-priority-(highest|lowest|default)$/.test(f.key) || f.type === 'longtext') return null;
    if (f.type === 'boolean') return ['t', 't'];
    if (f.type === 'number') return ['7', '7'];
    if (f.type === 'select') return [`'${f.options[0].value}`, f.options[0].value];
    if (f.type === 'text') return ['"hello"', 'hello'];
    return null;
  };
  let checked = 0;
  for (const f of SETTINGS_FIELDS.filter((x) => x.hidden && !NOT_FROM_LISP.has(x.key))) {
    const s = sample(f);
    if (!s) continue;
    const { values, errors } = settingsFromInit(`(setq ${f.key} ${s[0]})`, {});
    assert.deepEqual(errors, [], f.key);
    assert.equal(values[f.key], s[1], `${f.key} from the init`);
    checked++;
  }
  assert.ok(checked >= 30, `only ${checked} settings with no control were checked`);
});

test('the Lisp init sets every variable of the catalog, as Lisp text', () => {
  for (const c of VARIABLE_CATALOG) {
    const { values, errors } = settingsFromInit(`(setq ${c.name} nil)`, {});
    assert.deepEqual(errors, [], c.name);
    assert.equal(values[c.name], 'nil', `${c.name} from the init`);
  }
});

test('Global Variables keep what a setting with no control is set to, as Lisp and back', () => {
  for (const f of SETTINGS_FIELDS.filter((x) => x.hidden && (x.type === 'boolean' || x.type === 'number'))) {
    const box = f.type === 'boolean' ? 'nil' : '7';
    const text = serializeGlobalVariables({ [f.key]: box });
    assert.deepEqual(parseGlobalVariables(text)[f.key], box, `${f.key} through Global Variables`);
  }
  const text = serializeGlobalVariables({ 'org-weather-format': 'Hi %desc', 'display-time-format': '%b%d %H:%M' });
  assert.equal(text, '(setq display-time-format "%b%d %H:%M")\n(setq org-weather-format "Hi %desc")');
  assert.equal(parseGlobalVariables(text)['display-time-format'], '%b%d %H:%M');
});

test('the index lists every variable once, and says which have a control, which have none, and which are only set', () => {
  const index = buildVariableIndex(SETTINGS_FIELDS, { 'my-own-var': '1' });
  const names = index.map((e) => e.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, SETTINGS_FIELDS.length + VARIABLE_CATALOG.length + 1);
  const by = Object.fromEntries(index.map((e) => [e.name, e]));
  assert.equal(by['org-agenda-files'].control, 'field');
  assert.equal(by['org-priority-faces'].control, 'hidden');
  assert.equal(by['org-agenda-span'].control, 'none');
  assert.equal(by['my-own-var'].control, 'none');
});
