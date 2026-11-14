// examples/column-view.org: its tables are what Emacs 29.3 wrote with org-update-all-dblocks, and the app writes them the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { updateAllColumnviewBlocks } from '../src/org-columns.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

test('the column view example is written again as it is', () => {
  const text = fs.readFileSync(new URL('../examples/column-view.org', import.meta.url), 'utf8');
  const doc = parseOrg(text);
  assert.ok(updateAllColumnviewBlocks(doc, { category: 'column-view', now: new Date(2026, 10, 13, 18, 30) }) >= 3);
  assert.equal(serializeOrg(doc), text);
});
