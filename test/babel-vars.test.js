import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findNamedTable, parseHeaderArgs, resolveVars } from '../src/babel.js';

// test/fixtures/babel-vars-oracle.json: the value Emacs 29.3 (ob-js) gave a block for `:var x=TABLE` under each :colnames /
// :rownames / :hlines header (tools/gen-babel-vars-oracle.mjs).  Where a rule reaches the block (`:hlines yes`), ob-js writes
// the bare symbol `hline` into the script and Node fails with a ReferenceError; this app gives the block the string "hline".
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/babel-vars-oracle.json', import.meta.url), 'utf8'));

for (const c of oracle) {
  const args = parseHeaderArgs('js :var x=t' + (c.ref || '') + ' ' + c.header);
  test(`:var x=table${c.ref || ''} ${c.header || '(no headers)'} | ${c.table.replace(/\n/g, ' / ')}`, () => {
    const lines = ('#+NAME: t\n' + c.table).split('\n');
    const vars = resolveVars(args.var, (name) => findNamedTable(lines, name), { colnames: args.colnames, rownames: args.rownames, hlines: args.hlines });
    if (c.emacs.startsWith('#+NAME')) {
      // Emacs failed: a rule was handed to the script as a bare `hline`
      assert.ok(JSON.stringify(vars.x).includes('"hline"'));
      return;
    }
    assert.equal(JSON.stringify(vars.x), c.emacs);
  });
}
