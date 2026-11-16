// TAB in a table of the Text view (org-cycle, org-table-next-field), held to Emacs 29.3 (Org 9.6.15) at every caret position of
// several tables: test/fixtures/table-tab-oracle.json was made by tools/gen-table-tab-oracle.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tableTab } from '../src/table-tab.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/table-tab-oracle.json', import.meta.url), 'utf8'));

test('TAB aligns the table and goes where Emacs goes, adding a row at the end', () => {
  const wrong = [];
  let compared = 0;
  let inTable = 0;
  for (const c of oracle) {
    const got = tableTab(c.text, c.pos);
    compared++;
    if (c.result.table) {
      inTable++;
      if (!got || got.text !== c.result.text || got.pos !== c.result.pos) wrong.push({ text: c.text, pos: c.pos, got, want: c.result });
    } else if (got !== null) wrong.push({ text: c.text, pos: c.pos, got, want: null });
  }
  assert.ok(compared > 350 && inTable > 300);
  assert.deepEqual(wrong.slice(0, 3), []);
});

test('outside a table there is nothing for TAB to do', () => {
  assert.equal(tableTab('plain text\n', 3), null);
  assert.equal(tableTab('#+BEGIN_SRC sh\n| a | b |\n#+END_SRC\n', 18), null);
});
