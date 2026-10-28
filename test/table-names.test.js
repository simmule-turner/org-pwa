import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recalculateTable } from '../src/table-formula.js';

// Emacs 29.3 (tools/gen-table-names-oracle.mjs): a named field as a formula target, and the `%` parameter as the default format.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/table-names.json', import.meta.url), 'utf8'));

const grid = (text) => text.split('\n').filter((l) => l.startsWith('|')).map((l) => (/^\|-/.test(l) ? '---' : l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('|')));

function ours(org) {
  const lines = org.split('\n');
  const tblfm = (lines.find((l) => l.startsWith('#+TBLFM:')) || '').slice(8).trim();
  const rows = lines.filter((l) => l.startsWith('|')).map((l) => (/^\|-/.test(l) ? { type: 'rule' } : { type: 'row', cells: l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) }));
  try {
    const result = recalculateTable({ tblfm, rows });
    return result.map((r) => (r.type === 'rule' ? '---' : r.cells.join('|')));
  } catch (e) {
    return 'ERROR ' + e.message;
  }
}

test('named fields and the % default format give Emacs\'s tables and errors', () => {
  const bad = [];
  for (const c of oracle.cases) {
    const want = c.emacs.startsWith('ERROR') ? c.emacs : grid(c.emacs);
    const got = ours(c.org);
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push({ org: c.org, got, want });
  }
  assert.deepEqual(bad, []);
});
