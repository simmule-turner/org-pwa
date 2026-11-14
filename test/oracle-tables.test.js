// Holds table formulas to Emacs 29.3: test/fixtures/oracle-tables.json was made by tools/gen-oracle-tables.mjs, which runs
// org-table-recalculate-buffer-tables on every table of tools/oracle-tables-cases.mjs. The comparison is exact (cell text, trimmed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recalcGrid, gridOf } from './support/recalc-text.js';
import { TABLE_RULES, ruleFor } from './support/oracle-tables-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-tables.json', import.meta.url), 'utf8'));

/** The app's result: every table of the text recalculated with its first #+TBLFM line, like Emacs's recalculate-buffer-tables; an error is 'ERROR'. @param {string} org */
function ours(org) {
  try {
    return recalcGrid(org);
  } catch {
    return 'ERROR';
  }
}

/** Every case the app gets different from Emacs, with the rule that explains it (test/support/oracle-tables-known.js). */
function differences() {
  const bad = [];
  for (const c of oracle.cases) {
    if (c.emacs === 'ERROR TIMEOUT') continue;
    const want = c.emacs.startsWith('ERROR') ? 'ERROR' : gridOf(c.emacs);
    let got = ours(c.org);
    if (typeof got === 'string') got = 'ERROR';
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push({ org: c.org, got, want });
  }
  return bad;
}

test('formulas give the tables and errors Emacs gives, except for the listed deviations', () => {
  const bad = differences().filter((c) => !ruleFor(c));
  assert.equal(bad.length, 0, `${bad.length} of ${oracle.cases.length} differ without a known-deviation rule\n` + JSON.stringify(bad.slice(0, 3), null, 1));
});

test('every known-deviation rule still matches a case the app gets wrong', () => {
  const bad = differences();
  for (const r of TABLE_RULES) assert.ok(bad.some((c) => ruleFor(c) === r), `rule "${r.id}" no longer matches a differing case: remove it`);
});
