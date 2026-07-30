/**
 * Line-level text diff, for the undo history's "show what changed"
 * view -- given two versions of a document's text, produces a sequence
 * of same/added/removed line operations a caller can render as a
 * unified diff.
 *
 * Uses the standard longest-common-subsequence (LCS) approach via
 * dynamic programming: O(n*m) in the number of lines on each side.
 * Fine for this app's actual use case (diffing two whole-document
 * snapshots between adjacent or nearby undo steps, not arbitrary huge
 * files) -- not the Myers algorithm real diff tools use for
 * better-than-quadratic performance on large inputs, a deliberate
 * simplification given the input sizes this is actually used on.
 */

/**
 * Computes the line diff between `oldText` and `newText`. Returns an
 * array of { type: 'same' | 'added' | 'removed', line } in document
 * order -- 'same' lines appear once (not duplicated for each side),
 * 'removed' lines are only in oldText, 'added' lines are only in
 * newText, matching a standard unified-diff reading order.
 */
export function diffLines(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const n = oldLines.length;
  const m = newLines.length;

  // dp[i][j] = length of the LCS of oldLines[i:] and newLines[j:]
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'same', line: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'removed', line: oldLines[i] });
      i++;
    } else {
      result.push({ type: 'added', line: newLines[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: 'removed', line: oldLines[i] });
    i++;
  }
  while (j < m) {
    result.push({ type: 'added', line: newLines[j] });
    j++;
  }
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
