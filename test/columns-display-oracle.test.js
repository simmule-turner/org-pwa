// Holds what column view shows and keeps to Emacs 29.3: test/fixtures/columns-display-oracle.json was made by tools/gen-columns-display-oracle.mjs
// (org-columns: the displayed value of each cell and the width of each column; the text after a column is moved, widened, narrowed, deleted or
// added; the rows around an inline task). The edits are those src-browser/columns-panel.js makes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ColumnView, compileColumnsFormat, storeColumnsFormat, uncompileColumnsFormat } from '../src/org-columns.js';
import { setInlineTaskLevel } from '../src/inline-tasks.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/columns-display-oracle.json', import.meta.url), 'utf8'));

/** @param {any} c @param {string | null} [format] @param {boolean} [update] */
function view(c, doc, format = null, update = true) {
  const v = new ColumnView(doc, { defaultFormat: c.fmt, ellipses: '..' });
  v.prepare({ at: v.entries[0] || null, global: false, format, update });
  return v;
}
/** @param {ColumnView} v the cells as Emacs shows them: value and displayed value, an ITEM with its stars */
const rowsOf = (v) => v.viewEntries().map((e) => v.cells(e).map((cell) => [cell.value, cell.spec.prop === 'ITEM' ? `${'*'.repeat(v.stars(e))} ${cell.displayed}` : cell.displayed]));
const swap = (/** @type {any[]} */ specs, /** @type {number} */ i) => specs.map((s, k) => (k === i ? specs[i + 1] : k === i + 1 ? specs[i] : s));

/** @param {any} c */
function run(c) {
  const doc = parseOrg(c.org);
  setInlineTaskLevel(c.inline ?? null);
  try {
    const v = view(c, doc);
    if (c.kind === 'display') return { rows: rowsOf(v), widths: v.specs.map((_, i) => v.width(i)) };
    const specs = v.specs.map((s) => ({ ...s }));
    let next = specs;
    if (c.kind === 'new') next = [...specs.slice(0, c.col), ...compileColumnsFormat(`%${c.name}`, true), ...specs.slice(c.col)];
    else if (c.op === 'left') next = swap(specs, c.col - 1);
    else if (c.op === 'right') next = swap(specs, c.col);
    else if (c.op === 'widen') next = specs.map((s, k) => (k === c.col ? { ...s, width: v.width(k) + 1 } : s));
    else if (c.op === 'narrow') next = specs.map((s, k) => (k === c.col ? { ...s, width: Math.max(1, v.width(k) - 1) } : s));
    else next = specs.filter((_, k) => k !== c.col);
    const format = uncompileColumnsFormat(next);
    storeColumnsFormat(doc, v.top ? v.top.heading : null, format);
    const after = c.kind === 'new' ? null : rowsOf(view(c, doc, format, false)); // moving, widening, narrowing and deleting write no summaries
    return c.kind === 'new' ? { text: serializeOrg(doc) } : { text: serializeOrg(doc), rows: after };
  } finally {
    setInlineTaskLevel(null);
  }
}

test('column view shows, stores and keeps what Emacs does', () => {
  const wrong = [];
  for (const c of cases) {
    let got;
    try {
      got = run(c);
    } catch (e) {
      got = { error: /** @type {Error} */ (e).message };
    }
    if (JSON.stringify(got) !== JSON.stringify(c.emacs)) wrong.push({ kind: c.kind, org: c.org, fmt: c.fmt, op: c.op ?? c.name, got, want: c.emacs });
  }
  assert.equal(wrong.length, 0, JSON.stringify(wrong.slice(0, 3), null, 1));
});
