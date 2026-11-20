// RET in an Org buffer: `org-return`. A table row goes to the next row, a heading is split without breaking its keyword, priority or tags,
// a list item keeps its text in the item, and anywhere else it is `newline` with Emacs's electric indentation.

import { todoSequences } from './emacs-org.js';

/** @typedef {{ text: string, pos: number, error?: string }} Change */

const lineStartOf = (/** @type {string} */ text, /** @type {number} */ pos) => text.lastIndexOf('\n', pos - 1) + 1;
const lineEndOf = (/** @type {string} */ text, /** @type {number} */ pos) => {
  const at = text.indexOf('\n', pos);
  return at < 0 ? text.length : at;
};
const indentOf = (/** @type {string} */ line) => /^[ \t]*/.exec(line)?.[0].length ?? 0;
const BULLET = /^([ \t]*)([-+]|\d+[.)]|\*)([ \t]+)/;
const TABLE_ROW = /^[ \t]*\|/;

/** The list item the caret's line belongs to, as its line number and the column its text starts at; null outside a list.
 *  @param {string[]} lines @param {number} row */
function itemAround(lines, row) {
  const here = lines[row];
  for (let i = row; i >= 0; i--) {
    const m = BULLET.exec(lines[i]);
    if (m && !(m[2] === '*' && m[1].length === 0)) {
      const indent = m[1].length;
      const inside = i === row || (indentOf(here) > indent && here.trim() !== '') || (here.trim() === '' && row === lines.length - 1);
      let ok = inside;
      for (let j = i + 1; ok && j < row; j++) if (lines[j].trim() !== '' && indentOf(lines[j]) <= indent) ok = false;
      if (ok) return { row: i, content: indent + m[2].length + 1 };
    }
    if (i < row && lines[i].trim() !== '' && indentOf(lines[i]) === 0 && !m) return null;
  }
  return null;
}

/** The text of a heading split at its parts: stars, keyword, priority, title and tags, with where each starts.
 *  @param {string} line @param {string[]} keywords */
function headingParts(line, keywords) {
  const m = /^(\*+)(?:[ \t]+(.*?))?(?:[ \t]+(:[\p{L}\p{N}_@#%:]+:))?[ \t]*$/u.exec(line);
  if (!m || !/^\*+[ \t]/.test(line)) return null;
  let at = m[1].length;
  const after = (/** @type {RegExp} */ re) => {
    const found = re.exec(line.slice(at));
    return found;
  };
  /** @type {[number, number] | null} */ let todo = null;
  const word = after(/^[ \t]+(\S+)(?=[ \t]|$)/);
  if (word && keywords.includes(word[1])) {
    todo = [at + word[0].length - word[1].length, at + word[0].length];
    at += word[0].length;
  }
  /** @type {[number, number] | null} */ let priority = null;
  const cookie = after(/^[ \t]+(\[#[A-Z0-9]\])(?=[ \t]|$)/);
  if (cookie) {
    priority = [at + cookie[0].length - cookie[1].length, at + cookie[0].length];
    at += cookie[0].length;
  }
  const rest = line.slice(at);
  const tags = m[3] ? line.lastIndexOf(m[3]) : -1;
  const titleStart = at + (/^[ \t]*/.exec(rest)?.[0].length ?? 0);
  const titleEnd = tags >= 0 ? line.slice(0, tags).trimEnd().length : line.trimEnd().length;
  return { todo, priority, title: /** @type {[number, number]} */ ([titleStart, Math.max(titleStart, titleEnd)]), tags: tags >= 0 ? [tags, line.length] : null };
}

/** The width of leading whitespace, a tab going to the next multiple of 8. @param {string} white */
const columnOf = (white) => [...white].reduce((c, ch) => (ch === '\t' ? c + 8 - (c % 8) : c + 1), 0);
/** Indentation as Emacs writes it with `indent-tabs-mode`: tabs for each 8 columns, then spaces. @param {number} columns */
export const indentString = (columns) => '\t'.repeat(Math.floor(columns / 8)) + ' '.repeat(columns % 8);

/** `org-table-next-row`: the same field of the next row, a new row at the end of the table or before a rule.
 *  @param {string} text @param {number} pos @returns {Change | null} */
function tableNextRow(text, pos) {
  const lines = text.split('\n');
  const starts = lines.map((_, i) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0));
  let row = starts.findIndex((s, i) => pos >= s && pos <= s + lines[i].length);
  if (row < 0 || !TABLE_ROW.test(lines[row])) return null;
  const line = lines[row];
  const col = Math.max(1, (line.slice(0, pos - starts[row]).match(/\|/g) ?? []).length);
  let out = lines;
  if (row + 1 >= lines.length || !TABLE_ROW.test(lines[row + 1]) || /^[ \t]*\|[-+]*\|?[ \t]*$/.test(lines[row + 1])) {
    out = [...lines.slice(0, row + 1), line.replace(/[^|]/g, ' '), ...lines.slice(row + 1)];
  }
  row += 1;
  const target = out[row];
  let at = -1;
  for (let k = 0; k < col; k++) at = target.indexOf('|', at + 1);
  if (at < 0) at = target.length;
  const offset = out.slice(0, row).reduce((n, l) => n + l.length + 1, 0);
  const into = at + 1 < target.length && target[at + 1] === ' ' ? at + 2 : at + 1;
  return { text: out.join('\n'), pos: offset + Math.min(into, target.length) };
}

/**
 * `org-return` (RET).
 * @param {string} text @param {number} pos @param {number} n the prefix: how many newlines (a table row ignores it)
 * @returns {Change}
 */
export function orgReturn(text, pos, n) {
  const lines = text.split('\n');
  const start = lineStartOf(text, pos);
  const end = lineEndOf(text, pos);
  const row = text.slice(0, start).split('\n').length - 1;
  const line = text.slice(start, end);
  const col = pos - start;

  const inTable = TABLE_ROW.test(line) || (line.trim() === '' && row > 0 && TABLE_ROW.test(lines[row - 1]));
  if (inTable) n = 1; // a table row takes no count
  else if (n < 0) return { text, pos, error: 'Repetition argument has to be non-negative' };
  if (inTable && TABLE_ROW.test(line)) {
    const blankBefore = line.slice(0, col).trim() === '';
    const blankAfter = line.slice(col).trim() === '';
    if (!(blankBefore || blankAfter)) {
      const moved = tableNextRow(text, pos);
      if (moved) return moved;
    }
  }

  // a heading: the title after the caret goes to the line below, and the keyword, priority and tags stay where they are
  if (col > 0 && /^\*+[ \t]/.test(line)) {
    const parts = headingParts(line, todoSequences(text).flat());
    if (parts) {
      const inTitle = col >= parts.title[0] && col <= parts.title[1];
      const moved = inTitle ? line.slice(col, parts.title[1]).trim() : '';
      const head = inTitle ? (n === 1 ? line.slice(0, col).trimEnd() : line.slice(0, col)) + line.slice(parts.title[1]) : line;
      if (!(moved !== '' && parts.tags)) {
        const newline = '\n'.repeat(Math.max(n, 1));
        const rebuilt = text.slice(0, start) + head + newline + moved + text.slice(end);
        const place = start + head.length + newline.length;
        return { text: rebuilt, pos: place };
      }
    }
  }

  // a list item keeps its text in the item; anywhere else the new line is indented like the nearest line above that has text
  const onBullet = BULLET.test(line) && !/^\*+[ \t]/.test(line);
  const found = itemAround(lines, row);
  const item = found && n === 1 && !(found.row === row && col < found.content) ? found : null;
  const before = n === 1 ? text.slice(0, pos).replace(/[ \t]+$/, '') : text.slice(0, pos);
  const above = before.split('\n').reverse().find((l) => l.trim() !== '');
  const columns = item ? item.content : above === undefined ? 0 : columnOf(/^[ \t]*/.exec(above)?.[0] ?? '');
  const rest = found || onBullet ? text.slice(pos, end) : text.slice(pos, end).replace(/^[ \t]+/, '');
  const inserted = '\n'.repeat(Math.max(n, 1)) + indentString(columns);
  return { text: before + inserted + rest + text.slice(end), pos: before.length + inserted.length };
}
