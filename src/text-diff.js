import { diffHunksOfLines } from './merge3.js';

/**
 * Line-level text diff, for the undo history's "show what changed"
 * view -- given two versions of a document's text, produces a sequence
 * of same/added/removed line operations a caller can render as a
 * unified diff.
 *
 * Built on merge3.js's Myers O(ND) diff (D = number of differing lines)
 * after trimming the common prefix and suffix, so a one-line edit to a
 * 20,000-line journal costs almost nothing. This used to be a textbook
 * longest-common-subsequence table, O(n*m) in time AND memory -- fine for
 * a page, but a large file would have needed hundreds of millions of
 * cells, i.e. a frozen tab. Two versions that differ by more than
 * merge3.js's MAX_EDIT_DISTANCE lines (thousands) are shown as one
 * replaced block: still correct, just not minimal.
 */
/**
 * Computes the line diff between `oldText` and `newText`. Returns an
 * array of { type: 'same' | 'added' | 'removed', line } in document
 * order -- 'same' lines appear once (not duplicated for each side),
 * 'removed' lines are only in oldText, 'added' lines are only in
 * newText, matching a standard unified-diff reading order (a change's
 * removed lines come before its added lines).
 */
export function diffLines(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  let hunks = diffHunksOfLines(oldLines, newLines);
  if (hunks === null) {
    // Too different to diff minimally: keep the shared head and tail, and
    // present everything between them as one removed block and one added.
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < oldLines.length - prefix &&
      suffix < newLines.length - prefix &&
      oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
    ) {
      suffix++;
    }
    hunks = [{ aStart: prefix, aEnd: oldLines.length - suffix, bStart: prefix, bEnd: newLines.length - suffix }];
  }

  const result = [];
  let oldIndex = 0;
  for (const h of hunks) {
    for (; oldIndex < h.aStart; oldIndex++) result.push({ type: 'same', line: oldLines[oldIndex] });
    for (let i = h.aStart; i < h.aEnd; i++) result.push({ type: 'removed', line: oldLines[i] });
    for (let j = h.bStart; j < h.bEnd; j++) result.push({ type: 'added', line: newLines[j] });
    oldIndex = h.aEnd;
  }
  for (; oldIndex < oldLines.length; oldIndex++) result.push({ type: 'same', line: oldLines[oldIndex] });
  return result;
}
/**
 * Reduces a full diffLines() result down to just the changed regions,
 * each with up to `context` unchanged lines of surrounding context on
 * either side -- the familiar "unified diff" shape, so a long document
 * with one small change doesn't require scrolling past hundreds of
 * identical lines to find it. Adjacent changed regions whose context
 * windows overlap are merged into one, rather than shown as separate
 * hunks with a redundant sliver of "same" lines between them.
 *
 * Returns an array of hunks, each `{ lines: [...diff ops...] }`. A
 * diff with no changes at all returns an empty array, not one hunk of
 * pure "same" lines.
 */
export function diffHunks(oldText, newText, context = 2) {
  const ops = diffLines(oldText, newText);
  const changedIndexes = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== 'same') changedIndexes.push(k);
  }
  if (changedIndexes.length === 0) return [];

  const ranges = [];
  let start = Math.max(0, changedIndexes[0] - context);
  let end = Math.min(ops.length - 1, changedIndexes[0] + context);
  for (let k = 1; k < changedIndexes.length; k++) {
    const idx = changedIndexes[k];
    const idxStart = Math.max(0, idx - context);
    if (idxStart <= end + 1) {
      end = Math.min(ops.length - 1, idx + context);
    } else {
      ranges.push([start, end]);
      start = idxStart;
      end = Math.min(ops.length - 1, idx + context);
    }
  }
  ranges.push([start, end]);

  return ranges.map(([s, e]) => ({ lines: ops.slice(s, e + 1) }));
}
