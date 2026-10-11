// Holds the repeater shift on DONE to real Emacs: test/fixtures/repeat-oracle.json was made by tools/gen-repeat-oracle.mjs, which
// completes a repeating SCHEDULED or DEADLINE with org-todo in Emacs 29.3 and records the line it leaves. New York time, as the oracle ran.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shiftTimestampString } from '../src/repeater-shift.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/repeat-oracle.json', import.meta.url), 'utf8'));

test(`repeater shift on DONE matches Emacs for ${oracle.cases.length} cases`, () => {
  const savedTz = process.env.TZ;
  process.env.TZ = oracle.tz;
  try {
    const wrong = [];
    for (const c of oracle.cases) {
      const now = new Date(c.now.replace(' ', 'T'));
      const want = c.expected.replace(/^(SCHEDULED|DEADLINE): /, '');
      const got = shiftTimestampString(c.ts, now);
      if (got !== want) wrong.push(`${c.ts} completed ${c.now}: ours ${got}, Emacs ${want}`);
    }
    assert.deepEqual(wrong.slice(0, 15), [], `${wrong.length} of ${oracle.cases.length} differ`);
  } finally {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  }
});
