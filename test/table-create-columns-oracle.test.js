// org-table-formula-create-columns held to Emacs 29.3: test/fixtures/table-create-columns-oracle.json was made by
// tools/gen-table-create-columns-oracle.mjs. Each case is a table, a value of the variable (nil, t, warn, prompt answered yes or no)
// and what Emacs did: the text or the error, the warnings it showed and the questions it asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recalcGrid, gridOf } from './support/recalc-text.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/table-create-columns-oracle.json', import.meta.url), 'utf8'));
const MODES = /** @type {Record<string, boolean | 'warn' | 'prompt'>} */ ({ nil: false, t: true, warn: 'warn', prompt: 'prompt' });

/** Emacs aligns the table after recalculating, which pads short lines; the app pads a table only where a column was added. @param {string[] | string} grid */
function aligned(grid) {
  if (typeof grid === 'string') return grid;
  const width = Math.max(...grid.filter((l) => l !== '---').map((l) => l.split('|').length));
  return grid.map((l) => (l === '---' ? l : l + '|'.repeat(width - l.split('|').length)));
}

/** @param {{ org: string, value: string, answer: string }} c */
function ours(c) {
  const warnings = /** @type {string[]} */ ([]);
  const prompts = /** @type {string[]} */ ([]);
  try {
    const grid = recalcGrid(c.org, { createColumns: MODES[c.value], warn: (m) => warnings.push(m), confirm: (q) => (prompts.push(q), c.answer === 'yes') });
    return { grid, warnings, prompts };
  } catch (e) {
    return { grid: 'ERROR ' + /** @type {Error} */ (e).message, warnings, prompts };
  }
}

test('a formula for a field past the last column gives what Emacs gives for nil, t, warn and prompt: the text or error, the warnings and the questions', () => {
  const bad = [];
  for (const c of oracle.cases) {
    const got = { ...ours(c), grid: aligned(ours(c).grid) };
    const want = { grid: c.emacs.startsWith('ERROR') ? c.emacs : aligned(gridOf(c.emacs)), warnings: c.warnings, prompts: c.prompts };
    // an error stops the recalculation: Emacs may have changed some fields first, and the app changes none
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push({ org: c.org, value: c.value, answer: c.answer, got, want });
  }
  assert.equal(bad.length, 0, `${bad.length} of ${oracle.cases.length} differ\n` + JSON.stringify(bad.slice(0, 3), null, 1));
});

test('a range target past the last column fills what Emacs fills: the field each line of the range reaches', () => {
  const c = oracle.cases.find((/** @type {{ org: string, value: string }} */ x) => x.org.includes('@1$2..@2$3=7') && x.value === 't');
  assert.deepEqual(gridOf(c.emacs), ['2|7|7', '4||7', '8||']);
  assert.deepEqual(ours(c).grid, ['2|7|7', '4||7', '8||']);
});
