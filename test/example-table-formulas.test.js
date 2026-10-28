// The sections of examples/table-formulas.org that Emacs 29.3 fills in (tools/gen-table-formulas-example.mjs): the app must give
// the same tables from the same input, and the file must hold what Emacs wrote.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recalculateTable } from '../src/table-formula.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/table-formulas-example.json', import.meta.url), 'utf8'));
const file = fs.readFileSync(new URL('../examples/table-formulas.org', import.meta.url), 'utf8');

const grid = (/** @type {string} */ text) => text.split('\n').filter((l) => l.startsWith('|')).map((l) => (/^\|-/.test(l) ? '---' : l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('|')));

function ours(/** @type {string} */ org) {
  const lines = org.split('\n');
  const tblfm = (lines.find((l) => l.startsWith('#+TBLFM:')) || '').slice(8).trim();
  const rows = lines.filter((l) => l.startsWith('|')).map((l) => (/^\|-/.test(l) ? { type: /** @type {const} */ ('rule') } : { type: /** @type {const} */ ('row'), cells: l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) }));
  return recalculateTable({ tblfm, rows }).map((r) => (r.type === 'rule' ? '---' : r.cells.join('|')));
}

for (const c of oracle.cases) {
  test(`table-formulas.org, "${c.heading}": the app gives Emacs's table, and the file shows it`, () => {
    assert.deepEqual(ours(c.input), grid(c.emacs));
    assert.ok(file.includes(c.emacs), 'the section holds the table Emacs wrote');
  });
}
