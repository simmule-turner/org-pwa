// apropos-variable (src/apropos-variable.js), held to Emacs 29.3: (apropos-variable "org-log-done") lists org-log-done and
// org-log-done-with-time, each as `NAME\n  User option: DOC\n  Value: VALUE` under "Type RET on a type label to view its full documentation.";
// (apropos-variable '("org" "log")) matches the names with both words, '("log" "done" "zzz") those with two of the three, and nothing
// matching gives "No apropos matches for `PATTERN'".
import test from 'node:test';
import assert from 'node:assert/strict';
import { aproposVariable, printedValue } from '../src/apropos-variable.js';

const ENTRIES = [
  { name: 'org-log-done', doc: 'Log completing a TODO', value: 'nil' },
  { name: 'org-log-done-with-time', doc: 'Non-nil means the CLOSED time stamp will contain date and time.', value: 't' },
  { name: 'org-startup-truncated', doc: 'Text view: truncate long lines', value: 't' },
  { name: 'org-log-repeat', doc: 'Log a repeat', value: 'time' },
];
const names = (/** @type {string} */ p) => {
  const r = aproposVariable(p, ENTRIES);
  return r.ok ? [...r.text.matchAll(/^(\S+)$/gm)].map((m) => m[1]).filter((n) => n.includes('-')) : [];
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

test('a pattern with regexp characters is a regexp', () => {
  assert.deepEqual(names('^org-log-do'), ['org-log-done', 'org-log-done-with-time']);
  assert.deepEqual(names('truncated$'), ['org-startup-truncated']);
});

test('the buffer lists each name with its description and value, as Emacs does', () => {
  const r = aproposVariable('org-log-done', ENTRIES);
  assert.deepEqual(r, {
    ok: true,
    text: 'Type RET on a type label to view its full documentation.\n\norg-log-done\n  User option: Log completing a TODO\n  Value: nil\norg-log-done-with-time\n  User option: Non-nil means the CLOSED time stamp will contain date\n               and time.\n  Value: t\n',
  });
});

test('nothing matching, and a regexp that does not compile, give a message', () => {
  assert.deepEqual(aproposVariable('zzzqqqxx', ENTRIES), { ok: false, message: "No apropos matches for `zzzqqqxx'" });
  assert.equal(aproposVariable('[', ENTRIES).ok, false);
});

test('a symbol value prints without its quote', () => {
  assert.equal(printedValue("'time"), 'time');
  assert.equal(printedValue('"text"'), '"text"');
});
