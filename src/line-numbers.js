/**
 * The numbers `display-line-numbers-mode` shows beside lines: `t` counts from the top of the file, `relative` counts file
 * lines from the current line and `visual` counts shown lines from it. In both of those the current line itself keeps its
 * absolute number, as with Emacs's `display-line-numbers-current-absolute`.
 */

/**
 * @param {'absolute' | 'relative' | 'visual'} type
 * @param {number} line  1-based file line of this row
 * @param {number} currentLine  1-based file line of the current row, or 0 when there is none
 * @param {number} shownIndex  position of this row among the shown rows
 * @param {number} currentShownIndex  position of the current row among the shown rows, or -1
 * @returns {number}
 */
export function displayedLineNumber(type, line, currentLine, shownIndex, currentShownIndex) {
  if (type === 'absolute' || currentLine <= 0 || currentShownIndex < 0) return line;
  if (line === currentLine) return line;
  return type === 'relative' ? Math.abs(line - currentLine) : Math.abs(shownIndex - currentShownIndex);
}
