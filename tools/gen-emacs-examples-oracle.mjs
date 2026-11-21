#!/usr/bin/env node
/**
 * Writes test/fixtures/emacs-examples-oracle.json: what Emacs 29.3 does for each worked example of examples/emacs-mode.org (the keys typed in an
 * Org buffer holding the "before" block). test/emacs-examples.test.js holds the file and the app to it.
 *
 *   node tools/gen-emacs-examples-oracle.mjs        (needs emacs on the PATH)
 */
import fs from 'node:fs';
import { runEmacs } from './emacs-keys-lib.mjs';
import { readExamples, splitCaret, withCaret } from './emacs-examples-lib.mjs';

const examples = readExamples();
const results = runEmacs(examples.map((x) => ({ ...splitCaret(x.before), keys: x.keys, kill: [] })));
const cases = examples.map((x, i) => {
  if (results[i].error !== 'null') throw new Error(`Emacs reports "${results[i].error}" for the example "${x.title}"`);
  return { keys: x.keys, before: x.before, emacs: withCaret(results[i].text, results[i].pos) };
});
fs.writeFileSync('test/fixtures/emacs-examples-oracle.json', JSON.stringify({ emacs: '29.3', cases }, null, 1) + '\n');
console.log(`${cases.length} examples written`);
