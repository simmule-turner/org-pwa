// @ts-check
/**
 * TAB in a table of the Text view (`org-cycle` calling `org-table-next-field`): the table is aligned and the caret goes to the next
 * field; from the last field it goes to the first field of the next row, over rules, and at the end of the table a new row is added.
 * A line that starts with `|-` is a rule and is written in full. Positions are 0-based offsets into the text.
 */
import { layoutTable } from './org-table-layout.js';
import { inBlockAt } from './list-edit.js';

const TABLE_LINE = /^[ \t]*\|/;

/** The cells of a table line, trimmed, or null for a rule. @param {string} line @returns {string[] | null} */
function cellsOf(line) {
  if (/^[ \t]*\|-/.test(line)) return null;
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return body.split('|').map((c) => c.trim());
}

/**
 * @param {string} text @param {number} pos
 * @param {boolean} [alignOnly] `org-table-align` alone: the table is aligned and the caret stays in its field
 * @returns {{ text: string, pos: number } | null} null when the caret is not in a table
 */
export function tableTab(text, pos, alignOnly = false) {
  const lines = text.split('\n');
  let line = 0;
  let start = 0;
  while (line < lines.length - 1 && start + lines[line].length < pos) {
    start += lines[line].length + 1;
    line += 1;
  }
  // `org-table-align` at the first position after a table (a #+TBLFM: line, a blank line, the end of the buffer) aligns that table and keeps the caret in place
  if (alignOnly && pos === start && line > 0 && !TABLE_LINE.test(lines[line]) && TABLE_LINE.test(lines[line - 1]) && !inBlockAt(lines, line - 1)) {
    const above = tableTab(text, start - 1, true);
    return above && { text: above.text, pos: pos + above.text.length - text.length };
  }
  if (!TABLE_LINE.test(lines[line]) || inBlockAt(lines, line)) return null;
  let first = line;
  while (first > 0 && TABLE_LINE.test(lines[first - 1])) first -= 1;
  let last = line;
  while (last + 1 < lines.length && TABLE_LINE.test(lines[last + 1])) last += 1;
  const indent = /^[ \t]*/.exec(lines[first])?.[0] ?? '';
  const rowsOf = (/** @type {number} */ extra) => [...lines.slice(first, last + 1).map(cellsOf), ...Array(extra).fill(0).map(() => /** @type {string[]} */ ([]))];
  const ruleColumns = lines[first].split('+').length; // a table of rules only: Org counts the "+" of its first line
  const aligned = layoutTable(rowsOf(0), undefined, ruleColumns).map((l) => indent + l);
  const row = line - first;
  // where the caret is in the aligned line: after the pipe that starts its field, before the first pipe, or at the end of the line
  const col = pos - start;
  const original = lines[line];
  const pipesBefore = (original.slice(0, col).match(/\|/g) ?? []).length;
  const ruleRow = cellsOf(original) === null;
  const fields = (aligned[row].match(/\|/g) ?? []).length;
  const offsets = aligned.map((_, i) => aligned.slice(0, i).reduce((n, l) => n + l.length + 1, 0));
  const joined = aligned.join('\n');
  let at = offsets[row];
  if (ruleRow) at += aligned[row].length;
  else if (pipesBefore > fields) at += aligned[row].length;
  else if (pipesBefore > 0) at += aligned[row].split('|').slice(0, pipesBefore).join('|').length + 1;
  const rowAt = (/** @type {number} */ p) => offsets.reduce((r, o, i) => (o <= p ? i : r), 0);

  /** The table with an empty row after row `after`, the caret in its first field. @param {number} after */
  const withNewRow = (after) => {
    const rows = lines.slice(first, last + 1).map(cellsOf);
    rows.splice(after + 1, 0, rows.some((r) => r) ? [] : Array(ruleColumns).fill(''));
    const out = layoutTable(rows, undefined, ruleColumns).map((l) => indent + l);
    const caret = out.slice(0, after + 1).reduce((n, l) => n + l.length + 1, 0) + indent.length + 2;
    return finish(out, caret);
  };
  /** @param {string[]} table @param {number} caret offset within the table */
  const finish = (table, caret) => {
    const before = lines.slice(0, first).reduce((n, l) => n + l.length + 1, 0);
    // a row added at the very end of a buffer that has no final newline brings one
    const atEnd = last === lines.length - 1;
    const added = table.length > last - first + 1 && caret >= table.slice(0, -1).reduce((n, l) => n + l.length + 1, 0);
    // and so does aligning a last row that changes (`org-table-align` replaces a changed row with a line that ends in a newline)
    const changed = table.length === last - first + 1 && table[table.length - 1] !== lines[last];
    const tail = atEnd && (added || changed) ? [''] : [];
    return { text: [...lines.slice(0, first), ...table, ...tail, ...lines.slice(last + 1)].join('\n'), pos: before + caret };
  };

  if (alignOnly) {
    // `org-table-save-field`: the caret goes back to the start of its line and then to the start of the field it was in
    const bar = original.indexOf('|');
    let column = 0;
    if (bar !== -1 && bar < col) column = 1 + (original.slice(bar + 1, col).match(ruleRow ? /[+|]/g : /\|/g) ?? []).length;
    const line = aligned[row];
    let at2 = 0;
    if (column > 0) {
      for (let n = column; n > 0; n -= 1) {
        const i = line.indexOf('|', at2);
        if (i === -1) break;
        at2 = i + 1;
      }
      if (line[at2] === ' ') at2 += 1;
    }
    return finish(aligned, offsets[row] + at2);
  }
  const pipe = joined.indexOf('|', at);
  if (pipe === -1) return withNewRow(rowAt(at));
  let point = pipe + 1;
  if (/^[ \t]*(?:\n|$)/.test(joined.slice(point))) {
    const next = joined.indexOf('|', point);
    if (next === -1) return withNewRow(rowAt(point));
    point = next + 1;
  }
  if (joined[point] === '-') {
    // on a rule: over it to the next row that is not one, or a new row above it when it ends the table
    const data = /\n[ \t]*\|[^-]/.exec(joined.slice(point));
    if (!data) return withNewRow(rowAt(point) - 1);
    point += data.index + data[0].length - 1;
  }
  if (joined[point] === ' ') point += 1;
  return finish(aligned, point);
}
