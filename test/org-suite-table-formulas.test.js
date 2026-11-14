// Org's own table tests (testing/lisp/test-org-table.el), replayed against the formula engine: each case is a table before a
// recalculation and the text Emacs 29.3 left, as recorded by tools/gen-org-suite-table-formulas.mjs. What the app does differently
// on purpose is listed in test/support/oracle-tables-known.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recalcGrid } from './support/recalc-text.js';
import { ruleFor } from './support/oracle-tables-known.js';

const suite = JSON.parse(fs.readFileSync(new URL('./fixtures/org-suite-table-formulas.json', import.meta.url), 'utf8'));

/** @param {{ before: string, pick?: number, createColumns?: boolean }} c */
function ours(c) {
  try {
    return recalcGrid(c.before, { pick: c.pick, createColumns: c.createColumns });
  } catch {
    return 'ERROR';
  }
}

test('Org test suite: table formulas give what Emacs gave', () => {
  const bad = suite.cases.filter((c) => JSON.stringify(ours(c)) !== JSON.stringify(c.want) && !ruleFor({ org: c.before }));
  assert.equal(bad.length, 0, `${bad.length} of ${suite.cases.length} differ\n` + JSON.stringify(bad.slice(0, 3).map((c) => ({ test: c.test, want: c.want, got: ours(c) })), null, 1));
});

test('Org test suite: the tests that use string(), typeof, subvec, vlen, $PROP_, Lisp references and indirect remote references are in it', () => {
  const names = new Set(suite.cases.map((c) => c.test));
  for (const name of ['compare', 'copy-field', 'empty-field', 'duration', 'lisp-return-value', 'org-lookup-all', 'remote-reference-indirect', 'field-formula-outside-table']) assert.ok(names.has(name), name);
});
