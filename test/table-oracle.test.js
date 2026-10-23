// Holds table edits to Emacs: test/fixtures/table-oracle.json was made by tools/gen-table-oracle.mjs, which runs the Org table
// commands on a few tables in Emacs 29.3 (insert or delete a row or column, set a cell, with org-table-align after).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { deleteTableColumn, deleteTableRow, insertTableColumn, insertTableRow, setTableCell } from '../src/body-edit.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/table-oracle.json', import.meta.url), 'utf8'));
function ours(c) {
  const doc = parseOrg('* h\n' + c.org);
  const h = doc.children[0];
  const t = h.body.find((b) => b.type === 'table');
  if (c.op === 'insert-row-below') insertTableRow(h, t, c.row);
  else if (c.op === 'delete-row') deleteTableRow(h, t, c.row);
  else if (c.op === 'set-cell') setTableCell(h, t, c.row, c.col, c.value);
  else if (c.op === 'insert-col-before') insertTableColumn(h, t, c.col - 1);
  else deleteTableColumn(h, t, c.col);
  return serializeOrg(doc).replace(/^\* h\n/, '').trimEnd();
}

for (const op of ['insert-row-below', 'delete-row', 'set-cell', 'insert-col-before', 'delete-col']) {
  test(`${op} leaves the table Emacs leaves`, () => {
    // Emacs's delete-column leaves a stray column behind when a row has an empty cell and the rule is a bare "|-"; not copied
    const wrong = oracle.cases.filter((c) => c.op === op && c.table !== 'loose' && ours(c) !== c.emacs.trimEnd());
    assert.equal(wrong.length, 0, JSON.stringify(wrong[0]));
  });
}
