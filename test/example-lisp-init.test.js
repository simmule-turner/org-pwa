// examples/lisp-init.org: the Lisp of each section gives the app the values and messages Emacs 29.3 gave
// (tools/gen-lisp-init-example.mjs), and the file shows them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInit } from '../src/lisp-init.js';
import { print, toArray } from '../src/elisp-data.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/lisp-init-example.json', import.meta.url), 'utf8'));
const file = fs.readFileSync(new URL('../examples/lisp-init.org', import.meta.url), 'utf8');
const plain = (/** @type {string} */ s) => s.replace(/’/g, "'"); // Emacs in a batch locale writes plain quotes

for (const c of oracle.cases) {
  test(`lisp-init.org, "${c.heading}": the app gives Emacs's values and messages`, () => {
    const vars = runInit(`${c.init}\n(setq xx-shown (list ${c.show.join(' ')}))`);
    const shown = toArray(/** @type {import('../src/elisp-data.js').LObj} */ (vars.raw.get('xx-shown'))).map((x) => print(x, true));
    assert.deepEqual(shown, c.emacs.shown);
    assert.deepEqual(vars.errors.map(plain), c.emacs.errors);
    for (const line of c.emacs.shown) assert.ok(file.includes(line), 'the file shows ' + line);
  });
}
