// @ts-check
// The editing commands of the Text view as pure functions: each takes the text and the selection and returns one replacement
// (`from`..`to` becomes `insert`) and where the selection goes, so the browser applies it as a single undoable edit.

/** @typedef {{ from: number, to: number, insert: string, selStart: number, selEnd: number }} TextEdit */

/** The start of the line holding `pos` and the end of its text (before the newline).
 * @param {string} text @param {number} pos
 * @returns {[number, number]} */
export function lineBounds(text, pos) {
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  const nl = text.indexOf('\n', pos);
  return [start, nl === -1 ? text.length : nl];
}

/** The first and last line start/end covered by the selection; a selection that ends at the start of a line does not take it.
 * @param {string} text @param {number} start @param {number} end
 * @returns {[number, number]} */
function coveredLines(text, start, end) {
  const [from] = lineBounds(text, start);
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const [, to] = lineBounds(text, last);
  return [from, to];
}

/** The 1-based line number of `pos`. @param {string} text @param {number} pos */
export function lineNumberAt(text, pos) {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < pos; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/** The number of lines. @param {string} text */
export function lineCount(text) {
  return text.split('\n').length;
}

/** Where line `n` (1-based, clamped to the file) is.
 * @param {string} text @param {number} n
 * @returns {{ line: number, start: number, end: number }} */
export function lineRange(text, n) {
  const total = lineCount(text);
  const line = Math.max(1, Math.min(total, Math.floor(n) || 1));
  let start = 0;
  for (let i = 1; i < line; i++) start = text.indexOf('\n', start) + 1;
  const nl = text.indexOf('\n', start);
  return { line, start, end: nl === -1 ? text.length : nl };
}

/** What Enter inserts: a newline and the indentation of the line the cursor is on (up to the cursor).
 * @param {string} text @param {number} pos
 * @returns {string} */
export function newlineWithIndent(text, pos) {
  const [start] = lineBounds(text, pos);
  const indent = /^[ \t]*/.exec(text.slice(start, pos))?.[0] ?? '';
  return `\n${indent}`;
}

/** Indents (dir 1) or outdents (dir -1) every line the selection touches by `width` spaces.
 * @param {string} text @param {number} start @param {number} end @param {number} dir @param {number} [width]
 * @returns {TextEdit | null} */
export function indentLines(text, start, end, dir, width = 2) {
  const [from, to] = coveredLines(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const pad = ' '.repeat(width);
  let firstDelta = 0;
  let total = 0;
  const out = lines.map((line, i) => {
    let next;
    if (dir > 0) next = line === '' ? line : pad + line;
    else {
      const m = /^( {1,}|\t)/.exec(line);
      const cut = m ? (m[0] === '\t' ? 1 : Math.min(width, m[0].length)) : 0;
      next = line.slice(cut);
    }
    const delta = next.length - line.length;
    if (i === 0) firstDelta = delta;
    total += delta;
    return next;
  });
  const insert = out.join('\n');
  if (insert === text.slice(from, to)) return null;
  const selStart = Math.max(from, start + firstDelta);
  return { from, to, insert, selStart, selEnd: Math.max(selStart, end + total) };
}

/** Copies the line(s) of the selection below themselves.
 * @param {string} text @param {number} start @param {number} end @returns {TextEdit} */
export function duplicateLines(text, start, end) {
  const [from, to] = coveredLines(text, start, end);
  const block = text.slice(from, to);
  return { from: to, to, insert: `\n${block}`, selStart: to + 1, selEnd: to + 1 + block.length };
}

/** Deletes the line(s) of the selection, newline included.
 * @param {string} text @param {number} start @param {number} end @returns {TextEdit} */
export function deleteLines(text, start, end) {
  const [from, to] = coveredLines(text, start, end);
  if (to < text.length) return { from, to: to + 1, insert: '', selStart: from, selEnd: from };
  if (from > 0) return { from: from - 1, to, insert: '', selStart: from - 1, selEnd: from - 1 };
  return { from, to, insert: '', selStart: from, selEnd: from };
}

/** Moves the line(s) of the selection up (dir -1) or down (dir 1); null at the edge of the file.
 * @param {string} text @param {number} start @param {number} end @param {number} dir @returns {TextEdit | null} */
export function moveLines(text, start, end, dir) {
  const [from, to] = coveredLines(text, start, end);
  const block = text.slice(from, to);
  if (dir < 0) {
    if (from === 0) return null;
    const [prevFrom] = lineBounds(text, from - 1);
    const prev = text.slice(prevFrom, from - 1);
    const shift = from - prevFrom;
    return { from: prevFrom, to, insert: `${block}\n${prev}`, selStart: start - shift, selEnd: end - shift };
  }
  if (to >= text.length) return null;
  const [, nextTo] = lineBounds(text, to + 1);
  const next = text.slice(to + 1, nextTo);
  const shift = next.length + 1;
  return { from, to: nextTo, insert: `${next}\n${block}`, selStart: start + shift, selEnd: end + shift };
}

/** The one insertion that turns `before` into `after` (all of `after`'s extra text is in one place), or null when it is not an insertion.
 * @param {string} before @param {string} after
 * @returns {TextEdit | null} */
export function insertionBetween(before, after) {
  if (after.length < before.length) return null;
  let p = 0;
  while (p < before.length && before[p] === after[p]) p++;
  const extra = after.length - before.length;
  if (after.slice(p + extra) !== before.slice(p)) return null;
  return { from: p, to: p, insert: after.slice(p, p + extra), selStart: p, selEnd: p + extra };
}
