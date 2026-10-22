import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parseSexpr, evaluateSexpr } from '../src/sexp-eval.js';

// Real Emacs 29.3 listed the days of every year from 1900 to 2100 on which each Hebrew diary function applies (tools/gen-hebrew-diary-oracle.mjs);
// the fixture keeps a SHA-1 of each year's "date text" lines.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/calendar/hebrew-diary.json', import.meta.url), 'utf8'));
const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');

for (const [src, digests] of Object.entries(fixture.expected)) {
  test(`Hebrew diary function matches Emacs 1900-2100: ${src}`, () => {
    const expr = parseSexpr(src);
    const bad = [];
    for (let year = fixture.first; year <= fixture.last; year++) {
      const lines = [];
      for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = new Date(year, d.getMonth(), d.getDate() + 1)) {
        const result = evaluateSexpr(expr, { candidateDate: d, today: new Date(2026, 9, 11), entryText: 'ENTRY' });
        if (result) lines.push(`${year}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${typeof result === 'string' ? result : 't'}`);
      }
      if (createHash('sha1').update(lines.join('\n')).digest('hex') !== digests[year - fixture.first]) bad.push(year);
    }
    assert.deepEqual(bad, [], 'years that differ');
  });
}
