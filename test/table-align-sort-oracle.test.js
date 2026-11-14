// Holds table alignment and sorting to Emacs 29.3: test/fixtures/table-align-sort-oracle.json, made by tools/gen-table-align-sort-oracle.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { commitLines, serializeTable } from '../src/body-edit.js';
import { sortRows } from '../src/table-commands.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/table-align-sort-oracle.json', import.meta.url), 'utf8'));

function ours(c) {
  const h = parseOrg('* h\n' + c.org).children[0];
  const t = h.body.find((b) => b.type === 'table');
  if (c.op === 'align') commitLines(h, t.lineIndex, t.lineCount, serializeTable(t, true, h.bodyLines[t.lineIndex]));
  else sortRows(h, t, [c.row, c.col], c.mode, undefined, c.withCase);
  return h.bodyLines.join('\n');
}

for (const [op, label] of [['align', 'org-table-align'], ['sort', 'org-table-sort-lines']]) {
  test(`${label} leaves the table Emacs leaves`, () => {
    const wrong = oracle.cases.filter((c) => c.op === op && ours(c).trimEnd() !== c.emacs.trimEnd());
    assert.equal(wrong.length, 0, wrong.length + ' differ, first: ' + JSON.stringify(wrong[0]) + ' ours: ' + JSON.stringify(wrong[0] && ours(wrong[0])));
  });
}
