// Holds the table commands (insert above, move, rules, sort) to Emacs 29.3: test/fixtures/table-oracle.json, made by tools/gen-table-oracle.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { readFunction, sortFunctions } from '../src/table-sort-lisp.js';
import { insertRowAbove, insertRule, insertRuleAndMove, moveColumn, moveRow, sortRows } from '../src/table-commands.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/table-oracle.json', import.meta.url), 'utf8'));

// After a sort Emacs puts the cursor back at the same text column, which can be another field once the lines have moved; the app keeps the field.
/** Runs a case; returns { text, at } or { error }. */
function ours(c) {
  const doc = parseOrg('* h\n' + c.org);
  const h = doc.children[0];
  const t = h.body.find((b) => b.type === 'table');
  const at = [c.row, c.col || 0];
  let to;
  try {
    if (c.op === 'insert-row-above') to = insertRowAbove(h, t, at);
    else if (c.op === 'move-row-up') to = moveRow(h, t, at, true);
    else if (c.op === 'move-row-down') to = moveRow(h, t, at, false);
    else if (c.op === 'move-col-left') to = moveColumn(h, t, at, true);
    else if (c.op === 'move-col-right') to = moveColumn(h, t, at, false);
    else if (c.op === 'sort-func') {
      const key = readFunction(c.getkey, false);
      const compare = readFunction(c.compare || '', true);
      to = sortRows(h, t, at, c.mode, sortFunctions(key.fn, compare.fn));
    } else if (c.op.startsWith('sort-')) to = sortRows(h, t, at, c.mode);
    else if (c.op === 'hline-below') to = insertRule(h, t, at);
    else if (c.op === 'hline-above') to = insertRule(h, t, at, { above: true });
    else if (c.op === 'hline-and-move') {
      to = insertRuleAndMove(h, t, at);
    }
  } catch (err) {
    return { error: err.message };
  }
  return { text: serializeOrg(doc).replace(/^\* h\n/, '').trimEnd(), at: to };
}

for (const op of ['insert-row-above', 'move-row-up', 'move-row-down', 'move-col-left', 'move-col-right', 'hline-below', 'hline-above', 'hline-and-move', 'sort-alpha', 'sort-alpha-reverse', 'sort-numeric', 'sort-numeric-reverse', 'sort-time', 'sort-func']) {
  test(`${op} leaves the table, and the cursor, where Emacs leaves them`, () => {
    const wrong = [];
    for (const c of oracle.cases.filter((x) => x.op === op && (x.table !== 'loose' || op.startsWith('sort')))) {
      const r = ours(c);
      if (c.emacs.startsWith('ERROR')) {
        const message = /user-error "(.*)"/.exec(c.emacs);
        if (!r.error || (message && r.error !== message[1])) wrong.push({ c: [c.table, c.row, c.col], emacs: c.emacs, ours: r });
      } else if (r.error || r.text !== c.emacs.trimEnd() || (c.at && (r.at[0] !== c.at[0] || (!op.startsWith('sort') && r.at[1] !== c.at[1])))) wrong.push({ c: [c.table, c.row, c.col], emacs: c.emacs, at: c.at, ours: r });
    }
    assert.equal(wrong.length, 0, wrong.length + ' differ, first: ' + JSON.stringify(wrong[0], null, 1));
  });
}

test('a function that does not exist is refused as Emacs refuses it, and an empty compare function means the default', () => {
  assert.equal(readFunction('', false).error, 'Empty input is not valid');
  assert.match(readFunction('no-such-function-here', false).error, /No match/);
  assert.equal(readFunction('', true).fn, null);
  assert.ok(readFunction('length', false).fn);
});
