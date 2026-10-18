import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSexpr, evaluateSexpr, canonicalDiaryLine } from '../src/sexp-eval.js';
import { getCalendarDateStyle } from '../src/local-variables.js';

// Emacs 29.3 decided which days each expression matches under each calendar-date-style (tools/gen-datestyle-oracle.mjs).
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/datestyle/expected.json', import.meta.url), 'utf8'));
const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

for (const { style, src, days } of fixture.rows) {
  test(`matches Emacs (${style}): ${src}`, () => {
    const expr = parseSexpr(src);
    const got = [];
    for (let d = new Date(2026, 0, 1); d <= new Date(2029, 11, 31); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      if (evaluateSexpr(expr, { candidateDate: d, today: new Date(2026, 9, 11), entryText: 'ENTRY', calendarDateStyle: style })) got.push(iso(d));
    }
    assert.deepEqual(got, days);
  });
}

test('body lines are rewritten to the org-* twins in the chosen order', () => {
  assert.equal(canonicalDiaryLine('%%(diary-anniversary 10 31 1948) Bob is %d', 'american'), '%%(org-anniversary 1948 10 31) Bob is %d');
  assert.equal(canonicalDiaryLine('%%(diary-anniversary 31 10 1948) Bob', 'european'), '%%(org-anniversary 1948 10 31) Bob');
  assert.equal(canonicalDiaryLine('%%(diary-cyclic 14 1 5 2026) Pay', 'american'), '%%(org-cyclic 14 2026 1 5) Pay');
  assert.equal(canonicalDiaryLine('%%(diary-block 12 20 2026 1 5 2027) Away', 'american'), '%%(org-block 2026 12 20 2027 1 5) Away');
  assert.equal(canonicalDiaryLine('%%(org-block 2026 1 1 2026 1 2) x', 'american'), '%%(org-block 2026 1 1 2026 1 2) x');
});

test('calendar-date-style defaults to american and ignores nonsense', () => {
  assert.equal(getCalendarDateStyle({}), 'american');
  assert.equal(getCalendarDateStyle({ 'calendar-date-style': "'european" }), 'european');
  assert.equal(getCalendarDateStyle({ 'calendar-date-style': 'iso' }), 'iso');
  assert.equal(getCalendarDateStyle({ 'calendar-date-style': 'weird' }), 'american');
});
