// Holds table formulas to Emacs 29.3: test/fixtures/oracle-tables.json was made by tools/gen-oracle-tables.mjs, which runs
// org-table-recalculate-buffer-tables on every table of tools/oracle-tables-cases.mjs. The comparison is exact (cell text, trimmed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recalculateTable, parseTableConstants, parseNamedTables } from '../src/table-formula.js';
import { parseOrg } from '../src/org-parser.js';
import { TABLE_RULES, ruleFor } from './support/oracle-tables-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-tables.json', import.meta.url), 'utf8'));


const cellsOf = (line) => line.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim());
const gridOf = (text) => text.split('\n').filter((l) => /^\s*\|/.test(l)).map((l) => (/^\s*\|-/.test(l) ? '---' : cellsOf(l).join('|')));

/** The app's result: every table of the text recalculated with its first #+TBLFM line, like Emacs's recalculate-buffer-tables. */
function ours(org) {
  const lines = org.split('\n');
  const parsedDoc = parseOrg(org); const constants = parseTableConstants(parsedDoc); const tables = parseNamedTables(parsedDoc);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*\|/.test(lines[i])) { i++; continue; }
    const start = i;
    while (i < lines.length && /^\s*\|/.test(lines[i])) i++;
    const rows = lines.slice(start, i).map((l) => (/^\s*\|-/.test(l) ? { type: 'rule' } : { type: 'row', cells: cellsOf(l) }));
    let j = i;
    while (j < lines.length && /^\s*#\+(NAME|CAPTION|ATTR)/i.test(lines[j])) j++;
    let t = i;
    while (t < lines.length && lines[t].trim() === '') t++; // Emacs finds the formulas after blank lines too
    const m = /^\s*#\+TBLFM:(.*)$/i.exec(lines[t] || '');
    if (m) i = t + 1;
    if (!m) { out.push(...lines.slice(start, i).map((l, k) => (rows[k].type === 'rule' ? '---' : rows[k].cells.join('|')))); continue; }
    try {
      const res = recalculateTable({ tblfm: m[1].trim(), rows }, { constants, tables });
      const rs = res || rows;
      out.push(...rs.map((r) => (r.type === 'rule' ? '---' : r.cells.join('|').split('|').map((c) => c.trim()).join('|'))));
    } catch (e) {
      return 'ERROR ' + e.message;
    }
  }
  return out;
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
