// @ts-check
/**
 * The line numbers of `display-line-numbers-mode` in the outline. While the outline is drawn, each renderer asks for a
 * mark for every file line it shows (`nextMark`) and puts it at the start of that line; lines it does not draw are skipped
 * (`skipMarks`), so the numbers jump over them like folded text. The marks are zero-width, so a wrapped line keeps one
 * number, and `finalizeMarks` writes the numbers once every mark is known (relative and visual need the current line).
 */
import { displayedLineNumber } from '../src/line-numbers.js';

/** @type {{ current: { line: number, marks: { el: HTMLElement, line: number }[] } | null }} */
const box = { current: null };

export function startMarks() {
  box.current = { line: 0, marks: [] };
}

/** Is the outline being drawn with line numbers? */
export function marksOn() {
  return box.current !== null;
}

/** The next row starts at this 1-based file line. @param {number} line */
export function beginRowMarks(line) {
  if (box.current) box.current.line = line;
}

/** The mark for the next file line, or null when numbers are off or the row's line is unknown. @returns {HTMLElement | null} */
export function nextMark() {
  const ctx = box.current;
  if (!ctx || ctx.line <= 0) return null;
  const el = document.createElement('span');
  el.className = 'ln-mark';
  el.setAttribute('aria-hidden', 'true');
  ctx.marks.push({ el, line: ctx.line });
  ctx.line++;
  return el;
}

/** Lines that are not drawn. @param {number} [count] */
export function skipMarks(count = 1) {
  if (box.current) box.current.line += count;
}

/**
 * Writes the numbers and stops collecting.
 * @param {{ type: 'absolute' | 'relative' | 'visual', currentLine: number, offset: number }} options
 *   `offset` is the number of file lines above the first line shown (a narrowed outline counts from 1)
 * @returns {number} the width, in digits, of the widest number
 */
export function finalizeMarks({ type, currentLine, offset }) {
  const marks = box.current ? box.current.marks : [];
  box.current = null;
  const currentIndex = marks.findIndex((m) => m.line === currentLine);
  let digits = 1;
  marks.forEach((m, i) => {
    const text = String(displayedLineNumber(type, m.line - offset, currentLine - offset, i, currentIndex));
    m.el.dataset.n = text;
    digits = Math.max(digits, text.length);
  });
  for (const m of marks) m.el.style.width = `${digits}ch`;
  return digits;
}
