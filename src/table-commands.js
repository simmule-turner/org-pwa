// @ts-check
// The table commands of Org that move things about: insert a row above, move a row or column, insert a rule, sort. Each is what
// Emacs 29.3 does (tools/gen-table-oracle.mjs holds them to it) and returns where the cursor goes, [row, column] (0-based, rules
// count as rows). A refusal is an Error with Emacs's own message.
import { commitLines, dataLineNumber, fixTableFormulas, insertTableRow, serializeTable } from './body-edit.js';
import { width } from './org-table-layout.js';

/** @typedef {import('./types.js').Table} Table */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {[number, number]} Cursor */

/** @param {Table} table */
const columnCount = (table) => Math.max(1, ...table.rows.map((r) => (r.type === 'row' ? r.cells.length : 0)));

/** Every data row as wide as the widest, as Emacs's align makes them. @param {Table} table */
function pad(table) {
  const n = columnCount(table);
  for (const row of table.rows) if (row.type === 'row') while (row.cells.length < n) row.cells.push('');
}

/** @param {Heading} heading @param {Table} table */
function write(heading, table) {
  commitLines(heading, table.lineIndex, table.lineCount, serializeTable(table));
}

/** `M-S-<down>` (org-table-insert-row): a blank row above the cursor's row; the cursor stays on it. @param {Heading} heading @param {Table} table @param {Cursor} at @returns {Cursor} */
export function insertRowAbove(heading, table, [row, col]) {
  insertTableRow(heading, table, row - 1);
  return [row, col];
}

/** Puts `tblfm` back on the table's #+TBLFM: line. @param {Heading} heading @param {Table} table */
function writeFormulas(heading, table) {
  if (table.tblfm !== null) commitLines(heading, table.lineIndex + table.lineCount - 1, 1, ['#+TBLFM: ' + table.tblfm]);
}

/** `M-<up>` and `M-<down>` (org-table-move-row): the row swaps places with the line above or below, a rule included. As in Emacs the lines
 * are moved as they are, without aligning the table again. The cursor follows the row.
 * @param {Heading} heading @param {Table} table @param {Cursor} at @param {boolean} up @returns {Cursor} */
export function moveRow(heading, table, [row, col], up) {
  const to = row + (up ? -1 : 1);
  if (to < 0 || to >= table.rows.length) throw new Error('Cannot move row further');
  const a = table.rows[row];
  const b = table.rows[to];
  if (table.tblfm !== null && a.type === 'row' && b.type === 'row') {
    const d1 = dataLineNumber(table, row);
    const d2 = dataLineNumber(table, to);
    table.tblfm = fixTableFormulas(table.tblfm, '@', { [d1]: String(d2), [d2]: String(d1) }, undefined, 0);
  }
  const lo = Math.min(row, to);
  const first = heading.bodyLines[table.lineIndex + lo];
  const second = heading.bodyLines[table.lineIndex + lo + 1];
  commitLines(heading, table.lineIndex + lo, 2, [second, first]);
  writeFormulas(heading, table);
  return [to, col];
}

/** `M-<left>` and `M-<right>` (org-table-move-column): the column swaps places with its neighbor, and the formulas follow.
 * @param {Heading} heading @param {Table} table @param {Cursor} at @param {boolean} left @returns {Cursor} */
export function moveColumn(heading, table, [row, col], left) {
  const n = columnCount(table);
  const to = col + (left ? -1 : 1);
  if (to < 0) throw new Error('Cannot move column further left');
  if (to >= n) throw new Error('Cannot move column further right');
  pad(table);
  for (const row of table.rows) {
    if (row.type !== 'row') continue;
    const x = row.cells[col];
    row.cells[col] = row.cells[to];
    row.cells[to] = x;
  }
  if (table.tblfm !== null) table.tblfm = fixTableFormulas(table.tblfm, '$', { [col + 1]: String(to + 1), [to + 1]: String(col + 1) }, undefined, 0);
  write(heading, table);
  return [row, to];
}

/** The rule Emacs makes from a table line (org-table-insert-hline): as wide as each of its cells, joined by "+". @param {string} line */
function ruleLike(line) {
  const text = line.trim();
  if (/^\|-/.test(text)) return text;
  const cells = text.replace(/^\|/, '').replace(/\|$/, '').split('|');
  return '|' + cells.map((c) => '-'.repeat(Math.max(1, width(c)))).join('+') + '|';
}

/** `C-c -` (org-table-insert-hline): a rule below the cursor's row, or above it, as wide as that row's cells; the table is not aligned again. The cursor stays.
 * `C-c RET` (org-table-hline-and-move) goes on to the row below the rule.
 * @param {Heading} heading @param {Table} table @param {Cursor} at @param {{ above?: boolean }} [options] @returns {Cursor} */
export function insertRule(heading, table, [row, col], { above = false } = {}) {
  const rule = ruleLike(heading.bodyLines[table.lineIndex + row]);
  commitLines(heading, table.lineIndex + (above ? row : row + 1), 0, [rule]);
  table.lineCount += 1;
  return [above ? row + 1 : row, col];
}

/** `C-c RET` (org-table-hline-and-move): a rule below the cursor's row, then the cursor on the row below it. Where a rule follows, or the
 * table ends, a blank row is made there; as Emacs does, a blank row made before a following rule leaves the formulas as they are.
 * @param {Heading} heading @param {Table} table @param {Cursor} at @returns {Cursor} */
export function insertRuleAndMove(heading, table, [row, col]) {
  const start = table.lineIndex;
  insertRule(heading, table, [row, col]);
  const t = /** @type {Table} */ (heading.body.find((b) => b.type === 'table' && b.lineIndex === start));
  const next = row + 2;
  if (next < t.rows.length && t.rows[next].type === 'rule') {
    t.rows.splice(next, 0, { type: 'row', cells: Array(columnCount(t)).fill('') });
    write(heading, t);
  } else if (next >= t.rows.length) insertTableRow(heading, t, t.rows.length - 1);
  else {
    pad(t);
    write(heading, t);
  }
  return [next, col];
}

/** Emacs's `string-to-number`: the number a string starts with, or 0. @param {string} s */
function stringToNumber(s) {
  const m = /^[ \t]*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(s);
  return m ? Number(m[1]) : 0;
}

const UNIT_MINUTES = /** @type {Record<string, number>} */ ({ min: 1, h: 60, d: 1440, w: 10080, m: 43200, y: 525960 });

/** The minutes of a duration written 1:30, 1:30:00 or 1d 3h 2min (org-duration-to-minutes), or null when it is not one. @param {string} s */
function durationMinutes(s) {
  const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3] || 0) / 60;
  if (/^(?:\d+(?:\.\d*)?[ \t]*(?:min|h|d|w|m|y)[ \t]*)+$/.test(s)) {
    let total = 0;
    for (const m of s.matchAll(/(\d+(?:\.\d*)?)[ \t]*(min|h|d|w|m|y)/g)) total += Number(m[1]) * UNIT_MINUTES[m[2]];
    return total;
  }
  return null;
}

/** The key of the time sort: a timestamp's seconds, a duration's minutes (so any timestamp sorts after any duration), or 0. @param {string} f */
function timeKey(f) {
  const ts = /[<[](\d{4})-(\d{2})-(\d{2})(?:[ \t]+[^\]>\n]*?)?(?:[ \t]+(\d{1,2}):(\d{2}))?[^\]>\n]*[>\]]/.exec(f);
  if (ts) return new Date(Number(ts[1]), Number(ts[2]) - 1, Number(ts[3]), Number(ts[4] || 0), Number(ts[5] || 0)).getTime() / 1000;
  const whole = durationMinutes(f);
  if (whole !== null) return whole;
  const inside = /\b\d+:\d{2}\b/.exec(f);
  return inside ? /** @type {number} */ (durationMinutes(inside[0])) : 0;
}

/** Alphabetic order as Emacs gives it in the C locale with case ignored: by character code. @param {string} a @param {string} b */
function byCharacterCode(a, b) {
  const x = Array.from(a.toLowerCase());
  const y = Array.from(b.toLowerCase());
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = /** @type {number} */ (x[i].codePointAt(0)) - /** @type {number} */ (y[i].codePointAt(0));
    if (d) return d;
  }
  return x.length - y.length;
}

/** `C-c ^` (org-table-sort-lines): the rows between the nearest rules around the cursor's row (the whole table if there are none), by the cursor's column.
 * `type` is Emacs's: a alphabetic (case folded), n numeric, t time; the capital letter reverses. Rows that tie keep their order, and the lines are
 * moved as they are. The cursor stays where it is.
 * `f` and `F` sort by the functions of `by` (see table-sort-lisp.js): the key of a field, and whether one key goes before another.
 * @param {Heading} heading @param {Table} table @param {Cursor} at @param {'a' | 'A' | 'n' | 'N' | 't' | 'T' | 'f' | 'F'} type
 * @param {{ key: (field: string) => unknown, less: (a: never, b: never) => boolean }} [by] @returns {Cursor} */
export function sortRows(heading, table, at, type, by) {
  const [row, col] = at;
  if (!table.rows[row] || table.rows[row].type !== 'row') throw new Error('Not in table data field');
  let start = row;
  while (start > 0 && table.rows[start - 1].type !== 'rule') start--;
  let end = row;
  while (end + 1 < table.rows.length && table.rows[end + 1].type !== 'rule') end++;
  const reverse = type === type.toUpperCase();
  const kind = type.toLowerCase();
  const items = [];
  for (let i = start; i <= end; i++) {
    const r = /** @type {import('./types.js').DataRow} */ (table.rows[i]);
    const text = (r.cells[col] ?? '').trim();
    if (kind === 'f' && !by) throw new Error('Missing key extractor to sort rows');
    items.push({ line: heading.bodyLines[table.lineIndex + i], key: kind === 'n' ? stringToNumber(text) : kind === 't' ? timeKey(text) : kind === 'f' ? /** @type {NonNullable<typeof by>} */ (by).key(text) : text });
  }
  if (kind === 'f') {
    const less = /** @type {NonNullable<typeof by>} */ (by).less;
    const before = (/** @type {never} */ a, /** @type {never} */ b) => (reverse ? less(b, a) : less(a, b));
    items.sort((x, y) => (before(/** @type {never} */ (x.key), /** @type {never} */ (y.key)) ? -1 : before(/** @type {never} */ (y.key), /** @type {never} */ (x.key)) ? 1 : 0)); // stable
    commitLines(heading, table.lineIndex + start, end - start + 1, items.map((x) => x.line));
    return at;
  }
  const compare = (/** @type {{ key: unknown }} */ a, /** @type {{ key: unknown }} */ b) => {
    const order = kind === 'a' ? byCharacterCode(/** @type {string} */ (a.key), /** @type {string} */ (b.key)) : /** @type {number} */ (a.key) - /** @type {number} */ (b.key);
    return reverse ? -order : order;
  };
  items.sort(compare); // stable
  commitLines(heading, table.lineIndex + start, end - start + 1, items.map((x) => x.line));
  return at;
}
