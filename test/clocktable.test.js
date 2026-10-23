import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { computeClocktable, renderClocktable, parseClocktableRange, formatCaptionTimestamp } from '../src/clocktable.js';

// Emacs 29.3 / Org 9.6.15: the block org-update-all-dblocks writes (tools/gen-clocktable-oracle.mjs)
const cases = JSON.parse(readFileSync(new URL('./fixtures/clocktable-oracle.json', import.meta.url), 'utf8'));

test('the clocktable is what Emacs writes, case by case', () => {
  const wrong = [];
  for (const { org, params, emacs } of cases) {
    const maxlevel = Number(/:maxlevel (\d+)/.exec(params)?.[1] ?? 2);
    const tstart = /:tstart "([^"]*)"/.exec(params)?.[1];
    const tend = /:tend "([^"]*)"/.exec(params)?.[1];
    const ours = renderClocktable(computeClocktable(parseOrg(org), tstart, tend, maxlevel), tstart, tend, new Date(2000, 0, 1), maxlevel).replace(/Clock summary at \[[^\]]*\]/, 'Clock summary at [X]');
    if (ours.trimEnd() !== emacs) wrong.push(JSON.stringify({ params, emacs, ours }));
  }
  assert.deepEqual(wrong, []);
});

test(':tend is not included, as in Org, and a time can follow the date', () => {
  const { tstart, tend } = parseClocktableRange('2026-08-01 10:15', '2026-08-07');
  assert.deepEqual([tstart?.getHours(), tstart?.getMinutes(), tend?.getDate(), tend?.getHours()], [10, 15, 7, 0]);
  assert.deepEqual(parseClocktableRange('', null), { tstart: null, tend: null });
});

test('the caption time reads like an inactive timestamp', () => {
  assert.equal(formatCaptionTimestamp(new Date(2026, 7, 7, 12, 11)), '2026-08-07 Fri 12:11');
});
