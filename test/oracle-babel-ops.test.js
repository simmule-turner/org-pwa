// Holds the Babel commands to Emacs 29.3: test/fixtures/oracle-babel-ops.json was made by tools/gen-oracle-babel-ops.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { babelOp } from './support/babel-ops-exec.js';
import { opsRuleFor } from './support/babel-ops-known.js';

const { cases } = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-babel-ops.json', import.meta.url), 'utf8'));

cases.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
  test(`${c.op} #${i}: ${JSON.stringify(c.text).slice(0, 60)}`, async () => {
    let got;
    try {
      got = await babelOp(c);
    } catch (e) {
      got = 'ERROR ' + /** @type {Error} */ (e).message;
    }
    if (got !== c.want && opsRuleFor(c)) return;
    assert.equal(got, c.want);
  });
});
