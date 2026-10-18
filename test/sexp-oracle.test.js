import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSexpr, evaluateSexpr } from '../src/sexp-eval.js';

// Real Emacs 29.3 decided, for each expression, which days from 2026 to 2029 it matches (tools/gen-sexp-oracle.mjs).
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/sexp/general.expected.json', import.meta.url), 'utf8'));
const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Emacs returns the entry text (ENTRY here) where the app returns true; any other string must be identical.
for (const [src, days] of Object.entries(fixture.expected)) {
  test(`matches Emacs: ${src.slice(0, 90)}`, () => {
    const expr = parseSexpr(src);
    /** @type {Record<string, string>} */ const got = {};
    for (let d = new Date(2026, 0, 1); d <= new Date(2029, 11, 31); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const result = evaluateSexpr(expr, { candidateDate: d, today: new Date(2026, 9, 11), entryText: 'ENTRY' });
      if (result) got[iso(d)] = typeof result === 'string' && result !== 'ENTRY' ? result : 't';
    }
    const want = Object.fromEntries(Object.entries(days).map(([d, v]) => [d, v === 'ENTRY' ? 't' : v]));
    assert.deepEqual(got, want);
  });
}

test('a %%(...) body line may start with let*, if or cond, and keeps its text', async () => {
  const { parseGeneralBodyLine } = await import('../src/sexp-eval.js');
  for (const head of ['let* ((x 1)) x', 'if t t', 'cond (t t)', 'unless nil t']) {
    const line = parseGeneralBodyLine(`%%(${head}) Pay day`);
    assert.ok(line, head);
    assert.equal(line.text, 'Pay day');
  }
});

test('runaway or malformed expressions are no match, never an error', () => {
  const ctx = { candidateDate: new Date(2026, 0, 1), today: new Date(2026, 0, 1) };
  for (const src of ['(+ 1 "a")', '(/ 1 0)', '(car 5)', '(let ((1 2)) t)', '(calendar-last-day-of-month 13 2026)', '(nth 2 3)']) {
    assert.equal(evaluateSexpr(parseSexpr(src), ctx), false, src);
  }
  const deep = '(and ' + Array(30000).fill('t').join(' ') + ')';
  assert.equal(evaluateSexpr(parseSexpr(deep), ctx), false);
});
