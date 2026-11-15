import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { sendTable, exportTable, gatherSendDefs } from '../src/orgtbl-send.js';
import { setTagsColumn } from '../src/tags-column.js';

setTagsColumn(0);

// The text between the receiver lines is what Emacs 29.3 (Org 9.6.15) installs for this document with `orgtbl-send-table`
// (the case of test-org-table/send-region: a table sent to two receivers of one name).
const SOURCE = `
# BEGIN RECEIVE ORGTBL table
old
# END RECEIVE ORGTBL table
#+ORGTBL: SEND table orgtbl-to-latex :splice nil
| a | b |
|---+---|
| 1 | 2 |

# BEGIN RECEIVE ORGTBL table
# END RECEIVE ORGTBL table
`;
const LATEX = ['\\begin{tabular}{rr}', 'a & b\\\\[0pt]', '\\hline', '1 & 2\\\\[0pt]', '\\end{tabular}'];

/** The table of a document and the body that holds it. @param {string} text */
function load(text) {
  const doc = parseOrg(text);
  const table = /** @type {any} */ (doc.body).find((/** @type {any} */ n) => n.type === 'table');
  return { doc, table };
}

test('a table with #+ORGTBL: SEND fills every receiver of that name, as Emacs does', () => {
  const { doc, table } = load(SOURCE);
  assert.equal(sendTable(doc, doc, table), 1);
  assert.deepEqual(doc.bodyLines.slice(0, 8), ['', '# BEGIN RECEIVE ORGTBL table', ...LATEX, '# END RECEIVE ORGTBL table']);
  assert.deepEqual(doc.bodyLines.slice(-8, -1), ['# BEGIN RECEIVE ORGTBL table', ...LATEX, '# END RECEIVE ORGTBL table']);
  assert.ok(doc.keywords.some((k) => k.key === 'ORGTBL'), 'the SEND line stays');
});

test('the receiver may stand under a heading, and several SEND lines send to several places', () => {
  const { doc, table } = load('#+ORGTBL: SEND one orgtbl-to-csv\n#+ORGTBL: SEND two orgtbl-to-tsv\n| a | b |\n\n* H\n# BEGIN RECEIVE ORGTBL one\n# END RECEIVE ORGTBL one\n# BEGIN RECEIVE ORGTBL two\nx\n# END RECEIVE ORGTBL two\n');
  assert.equal(sendTable(doc, doc, table), 2);
  assert.deepEqual(doc.children[0].bodyLines.slice(0, 6), ['# BEGIN RECEIVE ORGTBL one', 'a,b', '# END RECEIVE ORGTBL one', '# BEGIN RECEIVE ORGTBL two', 'a\tb', '# END RECEIVE ORGTBL two']);
});

test('errors are Emacs\'s', () => {
  let { doc, table } = load('| a |\n');
  assert.throws(() => sendTable(doc, doc, table), /Don't know how to transform this table/);
  assert.equal(sendTable(doc, doc, table, true), 0);
  ({ doc, table } = load('#+ORGTBL: SEND table nonexistent-function\n| a |\n'));
  assert.throws(() => sendTable(doc, doc, table), /No such transformation function nonexistent-function/);
  ({ doc, table } = load('#+ORGTBL: SEND table orgtbl-to-csv\n| a |\n'));
  assert.throws(() => sendTable(doc, doc, table), /No valid receiver location found in the buffer/);
});

test('a heading\'s SEND lines are the ones directly above its table', () => {
  const { doc } = load('* H\n#+ORGTBL: SEND t orgtbl-to-csv :sep ";"\n| a | b |\n');
  const h = doc.children[0];
  assert.deepEqual(gatherSendDefs(h, 1), [{ name: 't', transform: 'orgtbl-to-csv', params: ' :sep ";"' }]);
});

test('org-table-export: TSV by default, the property or the file extension picks the format', () => {
  let { doc, table } = load('| a | b |\n|---+---|\n| 1 | 2 |\n');
  assert.deepEqual(exportTable(doc, doc, table), { fileName: 'table.tsv', text: 'a\tb\n1\t2\n' });
  assert.equal(exportTable(doc, doc, table, { file: 'x.csv' }).text, 'a,b\n1,2\n');
  assert.equal(exportTable(doc, doc, table, { file: 'x.html' }).fileName, 'x.html');
  assert.equal(exportTable(doc, doc, table, { defaultFormat: 'orgtbl-to-csv' }).fileName, 'table.csv');
  ({ doc } = load('* H\n:PROPERTIES:\n:TABLE_EXPORT_FILE: out.tex\n:TABLE_EXPORT_FORMAT: orgtbl-to-latex :splice t\n:END:\n| a |\n'));
  const h = doc.children[0];
  const t = /** @type {any} */ (h.body).find((/** @type {any} */ n) => n.type === 'table');
  assert.deepEqual(exportTable(doc, h, t), { fileName: 'out.tex', text: 'a\\\\[0pt]\n' });
});
