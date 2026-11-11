// apropos-variable (src/apropos-variable.js): the pattern follows Emacs's apropos (a word is a substring of the name, a list of words
// matches the names that hold at least two of them, a pattern with regexp characters is an Emacs regexp, case does not matter; nothing
// matching gives "No apropos matches for `PATTERN'"). The result is an Org document with a heading per variable, so the app's search works on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aproposVariable, entryText, printedValue } from '../src/apropos-variable.js';
import { parseOrg } from '../src/org-parser.js';

const ENTRIES = [
  { name: 'org-log-done', doc: 'Log completing a TODO', value: 'nil', control: 'field' },
  { name: 'org-log-done-with-time', doc: 'Non-nil means the CLOSED time stamp will contain date and time.', value: 't', control: 'none' },
  { name: 'org-startup-truncated', doc: 'Text view: truncate long lines', value: 't', control: 'field' },
  { name: 'org-log-repeat', doc: 'Log a repeat', value: 'time', control: 'hidden' },
];
const names = (/** @type {string} */ p) => {
  const r = aproposVariable(p, /** @type {any} */ (ENTRIES));
  return r.ok ? [...r.text.matchAll(/^\* (\S+)$/gm)].map((m) => m[1]) : [];
};

test('a word matches as a substring of the name, whatever its case', () => {
  assert.deepEqual(names('org-log-done'), ['org-log-done', 'org-log-done-with-time']);
  assert.deepEqual(names('ORG-LOG-DONE'), ['org-log-done', 'org-log-done-with-time']);
});

test('a list of words matches the names that hold at least two of them', () => {
  assert.deepEqual(names('org log'), ['org-log-done', 'org-log-done-with-time', 'org-log-repeat']);
  assert.deepEqual(names('log done zzz'), ['org-log-done', 'org-log-done-with-time']);
  assert.deepEqual(names('zzz log'), []);
  assert.deepEqual(names('startup truncated'), ['org-startup-truncated']);
});

test('a pattern with regexp characters is an Emacs regexp: \\( \\| \\) group and alternate, a bare ( or | is text', () => {
  assert.deepEqual(names('^org-log-do'), ['org-log-done', 'org-log-done-with-time']);
  assert.deepEqual(names('truncated$'), ['org-startup-truncated']);
  assert.deepEqual(names('^org-\\(startup\\|log-repeat\\)'), ['org-log-repeat', 'org-startup-truncated']);
  assert.deepEqual(names('^org-(startup|log-repeat)'), []);
});

test('the result is an Org document: a heading per variable, its description and value, and the elisp: link to its setting', () => {
  const r = aproposVariable('org-log-repeat', /** @type {any} */ (ENTRIES));
  assert.equal(r.ok, true);
  const text = r.ok ? r.text : '';
  assert.ok(text.startsWith("* org-log-repeat\nUser option: Log a repeat\nValue: time\n[[elisp:(customize-variable 'org-log-repeat)][Set in Global Variables]]\n"), text);
  assert.ok(text.includes('# buffer-read-only: t'), 'the buffer is read-only');
  assert.equal(parseOrg(text).children.filter((c) => c.type === 'heading').length, 1);
  assert.ok(entryText(/** @type {any} */ (ENTRIES[0])).includes('[Open in Settings]'));
});

test('nothing matching, and a regexp Emacs refuses, give a message', () => {
  assert.deepEqual(aproposVariable('zzzqqqxx', /** @type {any} */ (ENTRIES)), { ok: false, message: "No apropos matches for `zzzqqqxx'" });
  assert.equal(aproposVariable('\\(', /** @type {any} */ (ENTRIES)).ok, false);
});

test('a symbol value prints without its quote', () => {
  assert.equal(printedValue("'time"), 'time');
  assert.equal(printedValue('"text"'), '"text"');
});
