// @ts-check
// The arithmetic behind row windowing (src-browser/windowing.js): which rows of a long list to draw for a scroll position, when row
// heights differ and most are only estimated. Pure functions, no DOM.

/** The height of a row nobody has measured yet.
 * @param {number} average  the running average of measured rows of that kind (0 or less when none was measured)
 * @param {number} [lines]  the row's line count when it is more than one line
 * @param {number} [fallback] what to assume before anything is measured
 */
export function estimateHeight(average, lines = 1, fallback = 44) {
  const base = average > 0 ? average : fallback;
  return base * Math.max(1, lines);
}

/**
 * Prefix sums of `heights`: offsets[i] is the top of row i, offsets[n] the total height.
 * @param {ArrayLike<number>} heights
 * @returns {Float64Array}
 */
export function buildOffsets(heights) {
  const n = heights.length;
  const offsets = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) offsets[i + 1] = offsets[i] + heights[i];
  return offsets;
}

/**
 * The row that contains vertical position `y` (clamped to the first and last row). `offsets` is from buildOffsets.
 * @param {ArrayLike<number>} offsets
 * @param {number} y
 */
export function indexAtOffset(offsets, y) {
  const n = offsets.length - 1;
  if (n <= 0) return 0;
  if (y <= 0) return 0;
  if (y >= offsets[n]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The index ranges to draw, as sorted, non-overlapping, non-touching [start, end) pairs: the rows between `top` and `bottom`
 * (list coordinates) widened by `overscan` on each side, plus every forced row.
 * @param {{ offsets: ArrayLike<number>, top: number, bottom: number, overscan: number, forced?: Iterable<number> }} args
 * @returns {[number, number][]}
 */
export function windowRanges({ offsets, top, bottom, overscan, forced = [] }) {
  const n = offsets.length - 1;
  if (n <= 0) return [];
  const first = indexAtOffset(offsets, top - overscan);
  const last = indexAtOffset(offsets, bottom + overscan);
  /** @type {[number, number][]} */
  const ranges = [[first, last + 1]];
  for (const i of forced) if (Number.isInteger(i) && i >= 0 && i < n) ranges.push([i, i + 1]);
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  /** @type {[number, number][]} */
  const merged = [];
  for (const [s, e] of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && s <= prev[1]) prev[1] = Math.max(prev[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/**
 * The spacer heights that go before each range, and after the last: spacers[k] is the gap above ranges[k], spacers[ranges.length]
 * the gap below the last. Together with the drawn rows they add up to the full list height.
 * @param {ArrayLike<number>} offsets
 * @param {[number, number][]} ranges
 */
export function spacerHeights(offsets, ranges) {
  const n = offsets.length - 1;
  if (ranges.length === 0) return [offsets[n] || 0];
  /** @type {number[]} */
  const out = [];
  let at = 0;
  for (const [s, e] of ranges) {
    out.push(offsets[s] - offsets[at]);
    at = e;
  }
  out.push(offsets[n] - offsets[at]);
  return out;
}

/**
 * How far to move the scroll position so the row that was on screen stays where it was, after the heights above it changed.
 * @param {ArrayLike<number>} before  offsets before the heights changed
 * @param {ArrayLike<number>} after   offsets after
 * @param {number} anchor  index of a row that stays in view
 */
export function anchorShift(before, after, anchor) {
  return (after[anchor] || 0) - (before[anchor] || 0);
}

/** True when two range lists draw the same rows.
 * @param {[number, number][]} a
 * @param {[number, number][]} b */
export function sameRanges(a, b) {
  return a.length === b.length && a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1]);
}
