// @ts-check
/**
 * Emacs mode and tables: the keys that work on the table at the caret (`C-o`, `M-up`, `M-down`, `M-left`, `M-right`) in the text of the buffer.
 * What each does to the table is src/table-commands.js, which tools/gen-table-oracle.mjs holds to Emacs 29.3; this file finds the table the caret
 * is in, hands it over and puts the caret where Emacs does (test/emacs-keys-oracle.test.js).
 */
import { flatBodyNodes, parseBody } from './body-parser.js';
import { insertRowAbove, moveCell, moveColumn, moveRow } from './table-commands.js';
import { width } from './org-table-layout.js';

/** @typedef {{ text: string, pos: number, error?: string }} TableChange */

/** The table whose row the caret is on, with the buffer as the lines of a body to edit.
 * @param {string} text @param {number} pos */
function tableAt(text, pos) {
  const lines = text.split('\n');
  const line = text.slice(0, pos).split('\n').length - 1;
  const heading = /** @type {import('./types.js').Heading} */ (/** @type {unknown} */ ({ bodyLines: lines, body: parseBody(lines) })); // a buffer as the body of one heading
  const table = /** @type {import('./types.js').Table | undefined} */ (flatBodyNodes(heading.body).find((n) => n.type === 'table' && n.lineIndex <= line && line < n.lineIndex + n.rows.length));
  if (!table) return null;
  return { heading, table, line, row: line - table.lineIndex, column: pos - (text.lastIndexOf('\n', pos - 1) + 1) };
}

/** The text of `lines`; a table that ends the buffer ends with a newline once Org has aligned it (`atEnd`). @param {string[]} lines @param {boolean} newline */
const joined = (lines, newline) => lines.join('\n') + (newline ? '\n' : '');

/** Where line `index` of `lines` starts in the text they make. @param {string[]} lines @param {number} index */
const startOf = (lines, index) => lines.slice(0, index).reduce((n, l) => n + l.length + 1, 0);

/** `org-move-to-column`: the place in `line` that is `col` columns from its start, or its end when it is shorter. @param {string} line @param {number} col */
function moveToColumn(line, col) {
  let i = 0;
  while (i < line.length && width(line.slice(0, i)) < col) i++;
  return i;
}

/** `org-table-goto-column`: after the bar that starts field `n` (1-based) and the space that follows it. @param {string} line @param {number} n */
function startOfField(line, n) {
  let at = -1;
  for (let k = 0; k < n; k++) {
    at = line.indexOf('|', at + 1);
    if (at < 0) return line.length;
  }
  return line[at + 1] === ' ' ? at + 2 : at + 1;
}

/**
 * `org-metaup`, `org-metadown`, `org-metaleft`, `org-metaright` and `org-open-line` where the caret is in a table; null where it is not.
 * @param {string} text @param {number} pos @param {'row-up' | 'row-down' | 'column-left' | 'column-right' | 'insert-row' | 'cell-up' | 'cell-down' | 'cell-left' | 'cell-right'} what @param {boolean} [underTable] whether the empty last line under a table counts as being on it (`M-up` does; the same move after a prefix does not)
 * @returns {TableChange | null}
 */
export function tableEdit(text, pos, what, underTable = true) {
  const at = tableAt(text, pos);
  // M-up on the empty last line just under a table moves the table's last row (Emacs treats the caret as on it, at the start)
  if (!at && underTable && what === 'row-up' && pos === text.length && pos > 0 && text.endsWith('\n')) {
    const moved = tableEdit(text, text.lastIndexOf('\n', pos - 2) + 1, what);
    if (!moved || moved.error) return moved;
    const lines = moved.text.split('\n');
    const row = moved.text.slice(0, moved.pos).split('\n').length - 1;
    return { text: moved.text, pos: startOf(lines, row + 1) }; // and the caret ends on the row that was displaced
  }
  if (!at) return null;
  const { heading, table, row, line, column } = at;
  const current = heading.bodyLines[line];
  try {
    if (what === 'insert-row') {
      if (pos === 0) return null; // the first character of the buffer: `open-line`
      const eob = pos === text.length;
      const source = eob ? text + '\n' : text; // at the end of the buffer a newline is added first
      const again = eob ? tableAt(source, pos) : at;
      if (!again) return null;
      const atEnd = again.table.lineIndex + again.table.lineCount >= again.heading.bodyLines.length; // the table ends the buffer
      const lastBefore = again.heading.bodyLines[again.heading.bodyLines.length - 1];
      insertRowAbove(again.heading, again.table, [again.row, 0]);
      const lines = again.heading.bodyLines;
      const start = startOf(lines, again.line);
      // Org's alignment replaces the rows it changes, and replacing the last row of a table that ends the buffer adds the newline after it
      return { text: joined(lines, !source.endsWith('\n') && atEnd && lines[lines.length - 1] !== lastBefore), pos: start + startOfField(lines[again.line], 1) };
    }
    if (what === 'row-up' || what === 'row-down') {
      const [to] = moveRow(heading, table, [row, 0], what === 'row-up');
      const lines = heading.bodyLines;
      const index = table.lineIndex + to;
      const last = lines.length - 1;
      return { text: joined(lines, !text.endsWith('\n') && (line === last || index === last)), pos: startOf(lines, index) + moveToColumn(lines[index], width(current.slice(0, column))) };
    }
    if (what.startsWith('cell-')) { // S-up, S-down, S-left and S-right: the cell swaps with its neighbor
      if (/^[ \t]*\|-/.test(current) || current.slice(0, column).trim() === '' || current.slice(column).trim() === '') return { text, pos, error: 'Not in table data field' };
      const field = Math.max(1, current.slice(0, column).split('|').length - 1);
      const [to, toCol] = moveCell(heading, table, [row, field - 1], /** @type {'up' | 'down' | 'left' | 'right'} */ (what.slice(5)));
      const rows = heading.bodyLines;
      const index = table.lineIndex + to;
      return { text: joined(rows, !text.endsWith('\n') && table.lineIndex + table.lineCount >= rows.length), pos: startOf(rows, index) + startOfField(rows[index], toCol + 1) };
    }
    // org-table-find-dataline: on a rule, the next data line, at the same column; no data line below is an error
    const left = what === 'column-left';
    const lines = heading.bodyLines;
    const col = width(current.slice(0, column));
    let index = line;
    if (/^[ \t]*\|-/.test(current)) {
      const end = table.lineIndex + table.rows.length;
      index = line + 1;
      while (index < end && /^[ \t]*\|-/.test(lines[index])) index++;
      if (index >= end) return { text, pos: Math.min(text.length, startOf(lines, end)), error: 'Cannot find data row for column operation' };
    }
    const inLine = moveToColumn(lines[index], col);
    const here = startOf(lines, index) + inLine;
    const rowLine = lines[index];
    // org-table-check-inside-data-field: something but blanks before the caret and after it
    if (rowLine.slice(0, inLine).trim() === '' || rowLine.slice(inLine).trim() === '') return { text, pos: here, error: 'Not in table data field' };
    const field = Math.max(1, rowLine.slice(0, inLine).split('|').length - 1); // org-table-current-column, 1-based
    if (left && field === 1) return { text, pos: here, error: 'Cannot move column further left' };
    if (!left && /^[^|]*\|[^|]*$/.test(rowLine.slice(inLine))) return { text, pos: here, error: 'Cannot move column further right' }; // the last field of the line
    const [, to] = moveColumn(heading, table, [index - table.lineIndex, field - 1], left);
    return { text: joined(lines, !text.endsWith('\n') && table.lineIndex + table.lineCount >= lines.length), pos: startOf(lines, index) + startOfField(lines[index], to + 1) };
  } catch (e) {
    return { text, pos, error: /** @type {Error} */ (e).message };
  }
}
