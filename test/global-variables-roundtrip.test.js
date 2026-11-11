// @ts-check
// Every setting the Settings screen has goes through Global Variables text and back. The text must be Lisp that Emacs would run (the Lisp
// init runs it here the same way), must come back as the setting's box text, and must not change when saved again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_FIELDS } from '../src-browser/settings-fields.js';
import { settingsFromInit } from '../src-browser/lisp-settings.js';
import { parseGlobalVariables, serializeGlobalVariables } from '../src-browser/global-variables-lisp.js';

const OWN = new Set(['org-xx-extra-menu', 'org-xx-menu-aliases', 'org-xx-lisp-init', 'org-xx-extensions']); // lists of entries, Lisp text, a switch: tested on their own
const TYPED = {
  string: ['a b', '%b %d: %H:%M, ok', 'say "hi"', 'back\\slash'],
  list: ['org-habit org-id', '("github:a" "github:b")', "'(a b)"],
};

/** The values a box can hold that mean something for the field. */
function values(/** @type {any} */ f) {
  const out = new Set([String(f.default ?? ''), ...(f.options || []).map((/** @type {any} */ o) => String(o.value ?? o))]);
  if (f.type === 'boolean') ['t', 'nil'].forEach((v) => out.add(v));
  if (f.type === 'onezero') ['1', '0'].forEach((v) => out.add(v));
  if (f.type === 'longtext' && f.key !== 'org-inlinetask-min-level' && f.key !== 'diary-file') TYPED.list.forEach((v) => out.add(v));
  if (f.key === 'diary-file') ['github:diary', 'webdav:my diary'].forEach((v) => out.add(v));
  if (/^(display-time-format|org-weather-format|org-contacts-birthday-property|org-footnote-section|org-cite-basic-author-year-separator)$/.test(f.key)) TYPED.string.forEach((v) => out.add(v));
  out.delete('');
  out.delete('false'); // the default of a switch that is off: written as nil
  out.delete('true');
  return [...out];
}

for (const f of SETTINGS_FIELDS) {
  if (OWN.has(f.key)) continue;
  test(`${f.key} goes through Global Variables text as Lisp and back`, () => {
    for (const v of values(f)) {
      const text = serializeGlobalVariables({ [f.key]: v });
      const forms = parseGlobalVariables(text);
      assert.deepEqual(Object.keys(forms), [f.key], `${v}: ${text}`);
      const init = settingsFromInit(text, {});
      assert.deepEqual(init.errors, [], `${JSON.stringify(v)} is written as ${text}, which Lisp does not run`);
      assert.equal(serializeGlobalVariables(forms), text, `${JSON.stringify(v)}: saving it again changes the text`);
      if (init.values[f.key] !== undefined && f.type !== 'longtext' && f.key !== 'large-file-warning-threshold') assert.equal(forms[f.key], init.values[f.key], `${text}: the file and the init read it differently`);
    }
  });
}

test('a setting shown as it is in the box goes to the file as Lisp', () => {
  const text = serializeGlobalVariables({
    'org-startup-folded': 'overview', 'org-agenda-include-diary': 'true', 'display-time-mode': '0', 'org-priority-highest': 'A',
    'org-use-sub-superscripts': '{}', 'org-modules': 'org-habit org-id', 'diary-file': 'github:diary', 'large-file-warning-threshold': '500KB',
    'org-weather-temperature-unit': '°F', 'org-agenda-use-tag-inheritance': '(todo search agenda)', 'org-footnote-section': 'nil', 'org-log-done': 'time',
  });
  assert.equal(text, [
    '(setq diary-file "github:diary")', '(setq display-time-mode nil)', '(setq large-file-warning-threshold 512000)', '(setq org-agenda-include-diary t)',
    "(setq org-agenda-use-tag-inheritance '(todo search agenda))", '(setq org-footnote-section nil)', "(setq org-log-done 'time)", "(setq org-modules '(org-habit org-id))",
    "(setq org-priority-highest ?A)", "(setq org-startup-folded 'overview)", "(setq org-use-sub-superscripts '{})", '(setq org-weather-temperature-unit "°F")',
  ].join('\n'));
  const back = parseGlobalVariables(text);
  assert.equal(back['org-startup-folded'], 'overview');
  assert.equal(back['display-time-mode'], '0');
  assert.equal(back['org-priority-highest'], 'A');
  assert.equal(back['large-file-warning-threshold'], '500KB');
  assert.equal(back['org-use-sub-superscripts'], '{}');
  assert.equal(back['org-modules'], 'org-habit org-id'.replace(/^/, '(').replace(/$/, ')'));
});

test('text written the old way, with bare words, still loads', () => {
  const back = parseGlobalVariables('(setq org-startup-folded overview org-agenda-include-diary false display-time-mode 0)');
  assert.deepEqual(back, { 'org-startup-folded': 'overview', 'org-agenda-include-diary': 'false', 'display-time-mode': '0' });
});
