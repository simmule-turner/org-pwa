// Holds examples/emacs-mode.org to Emacs 29.3: test/fixtures/emacs-examples-oracle.json was made by tools/gen-emacs-examples-oracle.mjs, which
// types the keys of each example in an Org buffer. Each "becomes" block of the file must be what Emacs gave, and what the app gives.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { typeKeys } from '../tools/emacs-keys-lib.mjs';
import { readExamples, splitCaret, withCaret } from '../tools/emacs-examples-lib.mjs';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-examples-oracle.json', import.meta.url), 'utf8'));
const examples = readExamples();

test('every example of examples/emacs-mode.org was checked in Emacs', () => {
  assert.ok(examples.length > 20);
  assert.deepEqual(oracle.cases.map((/** @type {any} */ c) => [c.keys, c.before]), examples.map((x) => [x.keys, x.before]),
    'examples/emacs-mode.org changed: run node tools/gen-emacs-examples-oracle.mjs');
});

test('the result of every example is what Emacs gave', () => {
  const bad = examples.filter((x, i) => oracle.cases[i].emacs !== x.after).map((x) => x.title);
  assert.deepEqual(bad, []);
});

test('the app gives the result of every example', () => {
  const bad = examples.filter((x) => {
    const got = typeKeys({ ...splitCaret(x.before), keys: x.keys, kill: [] });
    return withCaret(got.text, got.pos) !== x.after;
  }).map((x) => x.title);
  assert.deepEqual(bad, []);
});
