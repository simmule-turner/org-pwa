import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { exportOrgText } from '../src/export-org.js';

// Emacs 29.3 / Org 9.6.15: what ox-org writes (tools/gen-org-export-oracle.mjs)
const cases = JSON.parse(readFileSync(new URL('./fixtures/org-export-oracle.json', import.meta.url), 'utf8'));

test('As-org export gives what Emacs gives, case by case', async () => {
  const wrong = [];
  for (const { org, emacs } of cases) {
    const ours = await exportOrgText(parseOrg(org + '\n'), async () => null, parseOrg, { minlevel: 1 });
    if (ours.trimEnd() !== emacs.trimEnd()) wrong.push(JSON.stringify({ org, emacs, ours }));
  }
  assert.deepEqual(wrong, []);
});
