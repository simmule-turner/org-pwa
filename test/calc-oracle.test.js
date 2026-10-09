import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recalculateTable } from '../src/table-formula.js';

// Each case was run through real Emacs (org-table-recalculate); see tools/gen-calc-oracle.mjs.
const cases = JSON.parse(readFileSync(new URL('./fixtures/calc-oracle.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`Calc agrees: ${JSON.stringify(c.cells)} ${c.formula}`, () => {
    const table = { tblfm: c.formula.slice(c.formula.startsWith('#+TBLFM:') ? 8 : 0), rows: [{ type: 'row', cells: [...c.cells, ''] }] };
    const rows = recalculateTable(table);
    const out = `| ${rows[0].cells.join(' | ')} |`.replace(/ +/g, ' ');
    assert.equal(out, c.expect);
  });
}
