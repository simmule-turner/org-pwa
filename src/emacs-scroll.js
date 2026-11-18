// C-v / M-v the way Emacs does them: the window's first line moves, and the cursor moves only when it
// would fall out of view. Checked against Emacs run in a terminal (test/fixtures/emacs-scroll.json).

/**
 * @param {{ lines: number, start: number, point: number, height: number, count?: number | null, forward: boolean }} a
 *   lines: number of lines in the text; start/point: 0-based line of the window's first line and of the cursor;
 *   height: lines the window shows; count: a numeric prefix (negative scrolls the other way); null for a page
 * @returns {{ error: string | null, start: number, point: number, bol: boolean }} bol: the cursor went to the start of its line
 */
export function scrollWindow({ lines, start, point, height, count = null, forward }) {
  let amount = count == null ? height - 2 : count; // next-screen-context-lines is 2
  let down = forward;
  if (amount < 0) {
    amount = -amount;
    down = !down;
  }
  if (down) {
    const s = start + amount;
    if (s > lines - 1) return { error: 'End of buffer', start, point, bol: false };
    return point < s ? { error: null, start: s, point: s, bol: true } : { error: null, start: s, point, bol: false };
  }
  if (start === 0) return { error: 'Beginning of buffer', start, point, bol: false };
  const s = Math.max(0, start - amount);
  const last = s + height - 1;
  return point > last ? { error: null, start: s, point: last, bol: true } : { error: null, start: s, point, bol: false };
}
