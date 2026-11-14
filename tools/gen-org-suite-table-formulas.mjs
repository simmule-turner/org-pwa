#!/usr/bin/env node
/**
 * Writes test/fixtures/org-suite-table-formulas.json: the table commands that recalculate formulas, as Org's own ERT tests
 * (testing/lisp/test-org-table.el) ran them in Emacs 29.3: the table text before, and the text Emacs left (or an error).
 * The calls come from a tap on the table commands that wrote one JSON object per call (test, fn, args, before, point, after, error).
 *   node tools/gen-org-suite-table-formulas.mjs table.jsonl
 */
import fs from 'node:fs';

const cellsOf = (line) => line.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim());
const grid = (text) => text.split('\n').filter((l) => /^\s*\|/.test(l)).map((l) => (/^\s*\|-/.test(l) ? '---' : cellsOf(l).join('|')));
const calls = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const FORMULA_COMMANDS = ['org-table-recalculate', 'org-table-calc-current-TBLFM', 'org-table-recalculate-buffer-tables', 'org-table-iterate-buffer-tables'];
const out = [];
for (const c of calls) {
  if (!FORMULA_COMMANDS.includes(c.fn) || (c.fn === 'org-table-recalculate' && c.args[0] !== 'all')) continue;
  // several #+TBLFM: lines: the command works on the one the cursor is on, else the first
  const lines = c.before.split('\n');
  let pick = 0;
  let offset = 0;
  let first = -1;
  lines.forEach((line, i) => {
    if (/^\s*#\+TBLFM:/i.test(line)) {
      if (first < 0) first = i;
      if (c.point - 1 >= offset && c.point - 1 <= offset + line.length) pick = i - first;
    }
    offset += line.length + 1;
  });
  out.push({
    test: c.test.replace(/^test-org-table\//, ''),
    before: c.before,
    want: c.error ? 'ERROR' : grid(c.after),
    ...(pick > 0 ? { pick } : {}),
    // org-table-formula-create-columns is nil in Emacs; the test that sets it to t is the one whose result has the column
    ...(c.test.endsWith('field-formula-outside-table') && !c.error ? { createColumns: true } : {}),
  });
}
fs.writeFileSync(new URL('../test/fixtures/org-suite-table-formulas.json', import.meta.url), JSON.stringify({ emacs: 'Emacs 29.3, Org 9.6.15', cases: out }, null, 1) + '\n');
console.log(`wrote ${out.length} calls`);
