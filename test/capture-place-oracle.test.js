// Holds where and how a capture is filed to Emacs: test/fixtures/capture-place-oracle.json was made by
// tools/gen-capture-place-oracle.mjs, which files each template with org-capture in Emacs 29.3.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { fileCapture, plannedTableRow, resolveOlpTarget } from '../src/capture-template.js';
import { recalculateTable } from '../src/table-formula.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/capture-place-oracle.json', import.meta.url), 'utf8'));

// Emacs leaves a stray line break in the list when its repair changes a bullet and a blank line follows a first item.
const EMACS_DEFECT = (c) => c.type === 'item' && c.opts.prepend && c.opts.emptyLines && /^\* Tr\n(\+ a|1\. a)/.test(c.init);

const squeeze = (/** @type {string} */ s) => s.replace(/ +\|/g, '|').replace(/\| +/g, '|'); // table padding is checked below

function file(c) {
  const doc = parseOrg(c.init);
  const target = c.olp.length ? resolveOlpTarget(doc, c.olp, { allowCreate: false }) : doc;
  fileCapture(doc, target, c.type, c.template, !!c.opts.prepend, false, '', '', { ...c.opts, recalculate: (t) => recalculateTable(t, {}) });
  return serializeOrg(doc);
}

test('a capture is filed where Emacs puts it, with the blank lines Emacs leaves', () => {
  const wrong = [];
  for (const c of oracle.cases) {
    if (EMACS_DEFECT(c)) continue;
    let got;
    try {
      got = file(c);
    } catch (e) {
      got = 'ERROR ' + e.message;
    }
    const ok = c.emacs.startsWith('ERROR') ? got.startsWith('ERROR') : squeeze(got) === squeeze(c.emacs);
    if (!ok) wrong.push({ init: c.init, type: c.type, opts: c.opts, template: c.template, got, want: c.emacs });
  }
  assert.equal(wrong.length, 0, JSON.stringify(wrong.slice(0, 5), null, 1));
});

test('a row joins a table aligned as Emacs aligns it', () => {
  const tables = oracle.cases.filter((c) => c.type === 'table-line' && !c.emacs.startsWith('ERROR') && !/TBLFM/.test(c.init));
  assert.ok(tables.length > 20);
  for (const c of tables) assert.equal(file(c), c.emacs, JSON.stringify(c));
});

test('the number a template gets for @# is the row’s line in the table, a header row counted', () => {
  const none = parseOrg('* Tr');
  assert.equal(plannedTableRow(none.children[0]), 2);
  assert.equal(plannedTableRow(none.children[0], false, { tableHeader: false }), 1);
  const some = parseOrg('* Tr\n| h | h |\n|---+---|\n| x | y |\n| z | w |');
  assert.equal(plannedTableRow(some.children[0]), 4);
  assert.equal(plannedTableRow(some.children[0], true), 2);
  assert.equal(plannedTableRow(some.children[0], false, { tableLinePos: 'I-1' }), 2);
});

test('a :table-line-pos that names a rule the table lacks is refused', () => {
  const doc = parseOrg('* Tr\n| x | y |');
  assert.throws(() => fileCapture(doc, doc.children[0], 'table-line', '| a | b |', false, false, '', '', { tableLinePos: 'I+1' }), /Invalid table line specification "I\+1"/);
});
