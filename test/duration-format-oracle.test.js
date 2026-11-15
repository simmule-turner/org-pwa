// org-duration-from-minutes under org-duration-format (src/org-duration.js) against Emacs 29.3: test/fixtures/duration-format-oracle.json, from tools/gen-duration-oracle.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyDurationVariables, durationFromMinutes, parseDurationFormat } from '../src/org-duration.js';

const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/duration-format-oracle.json', import.meta.url), 'utf8'));

test('org-duration-from-minutes matches Emacs for every format', () => {
  const bad = [];
  for (const r of rows) {
    applyDurationVariables({ 'org-duration-format': r.fmt, ...(r.units ? { 'org-duration-units': r.units } : {}) });
    let got;
    try {
      got = durationFromMinutes(r.m, r.explicit ? parseDurationFormat(r.fmt) : undefined, r.canonical);
    } catch {
      got = null;
    }
    const want = r.err ? null : r.res;
    if (got !== want) bad.push({ fmt: r.fmt, m: r.m, units: !!r.units, canonical: r.canonical, want: r.err ?? want, got });
  }
  applyDurationVariables({});
  assert.deepEqual(bad.slice(0, 25), [], `${bad.length} of ${rows.length} differ`);
});
