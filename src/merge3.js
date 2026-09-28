/**
 * Line-based three-way merge, for resolving a sync conflict: `base` is
 * the text as of the last successful sync, `mine` the local edit, and
 * `theirs` what's on disk/GitHub/WebDAV now. Changes made in different
 * places merge automatically; changes that touch the same lines are
 * reported as conflicts for a person to decide, never guessed at.
 *
 * Diff: Myers' O(ND) algorithm (D = number of differing lines), after
 * trimming the common prefix and suffix, so two edits far apart in a
 * long file stay cheap -- unlike text-diff.js's O(n*m) table, which is
 * fine for comparing two undo snapshots but not for a large journal.
 * When two versions differ by more than MAX_EDIT_DISTANCE lines the
 * diff gives up (returns null) and callers fall back to a whole-file
 * choice, rather than spending unbounded time/memory.
 *
 * Merge: each side's changes are turned into hunks over `base`, then
 * grouped. A group touched by only one side is applied as-is. A group
 * touched by both sides is a conflict unless both sides made the
 * identical change. Hunks that merely TOUCH (no unchanged base line
 * between them) count as the same group -- deliberately conservative,
 * like git and GNU diff3: adjacent edits are more often related than
 * not, and a false conflict is cheap where a wrong silent merge isn't.
 *
 * Lines are split on "\n" only, so a trailing newline (a final empty
 * element) and any "\r" survive a merge exactly.
 */

const MAX_EDIT_DISTANCE = 2500;

function splitLines(text) {
  return String(text).split('\n');
}

/** Myers diff over two line arrays. Returns hunks
 *  `{ aStart, aEnd, bStart, bEnd }` (half-open ranges: a[aStart..aEnd)
 *  became b[bStart..bEnd)), in order, or null if the inputs differ by
 *  more than MAX_EDIT_DISTANCE lines. */
function diffHunksOfLines(a, b) {
  const n = a.length;
  const m = b.length;

  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

  const aMid = a.slice(prefix, n - suffix);
  const bMid = b.slice(prefix, m - suffix);
  if (aMid.length === 0 && bMid.length === 0) return [];

  const matches = myersMatches(aMid, bMid);
  if (matches === null) return null;

  // Turn the matched pairs (a-index, b-index, both relative to the
  // trimmed middle) into hunks over the whole arrays.
  const hunks = [];
  let ai = 0;
  let bi = 0;
  const emit = (aEnd, bEnd) => {
    if (aEnd > ai || bEnd > bi) {
      hunks.push({ aStart: prefix + ai, aEnd: prefix + aEnd, bStart: prefix + bi, bEnd: prefix + bEnd });
    }
  };
  for (const [i, j] of matches) {
    emit(i, j);
    ai = i + 1;
    bi = j + 1;
  }
  emit(aMid.length, bMid.length);
  return hunks;
}

/** Matched (a-index, b-index) pairs of a shortest edit script, in
 *  ascending order, or null past MAX_EDIT_DISTANCE. */
function myersMatches(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];

  // Compare small integers instead of strings.
  const ids = new Map();
  const toIds = (arr) =>
    arr.map((line) => {
      let id = ids.get(line);
      if (id === undefined) {
        id = ids.size;
        ids.set(line, id);
      }
      return id;
    });
  const A = toIds(a);
  const B = toIds(b);

  const maxD = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = maxD + 1;
  const v = new Int32Array(2 * maxD + 3);
  v[offset + 1] = 0;
  // trace[d] is v's relevant slice (k = -d-1 .. d+1) at the START of round d.
  const trace = [];

  let foundD = -1;
  for (let d = 0; d <= maxD; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        foundD = d;
        break;
      }
    }
    if (foundD !== -1) break;
  }
  if (foundD === -1) return null;

  const matches = [];
  let x = n;
  let y = m;
  for (let d = foundD; d >= 0; d--) {
    const slice = trace[d];
    const at = (k) => slice[k + d + 1];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && at(k - 1) < at(k + 1))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      matches.push([x - 1, y - 1]);
      x--;
      y--;
    }
    x = prevX;
    y = prevY;
  }
  return matches.reverse();
}

/** `base` lines [start, end) with the given hunks applied. Each hunk's
 *  `lines` are its replacement text; hunks must be in order and lie
 *  within [start, end] (an insertion sitting exactly at `end` counts). */
function applyHunks(base, hunks, start, end) {
  const out = [];
  let cursor = start;
  for (const h of hunks) {
    for (let p = cursor; p < h.aStart; p++) out.push(base[p]);
    for (const line of h.lines) out.push(line);
    cursor = h.aEnd;
  }
  for (let p = cursor; p < end; p++) out.push(base[p]);
  return out;
}

function sameLines(x, y) {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

function withLines(hunks, sideLines) {
  return hunks.map((h) => ({ ...h, lines: sideLines.slice(h.bStart, h.bEnd) }));
}

/**
 * Merges `mineText` and `theirsText` against their common ancestor
 * `baseText`. Returns null if a diff was too large to compute (see
 * MAX_EDIT_DISTANCE); otherwise
 *
 *   {
 *     segments: [ { type: 'stable', lines } | { type: 'conflict', base, mine, theirs } ],
 *     conflictCount,
 *     mergedText,   // only when conflictCount === 0
 *     stats: { mineOnly, theirsOnly, identical, conflicts }
 *   }
 *
 * `stats` counts change groups: made only by mine, only by theirs, by
 * both identically, or by both differently (the conflicts).
 */
function merge3(baseText, mineText, theirsText) {
  const base = splitLines(baseText);
  const mine = splitLines(mineText);
  const theirs = splitLines(theirsText);

  const hm = diffHunksOfLines(base, mine);
  const ht = diffHunksOfLines(base, theirs);
  if (hm === null || ht === null) return null;
  const A = withLines(hm, mine);
  const B = withLines(ht, theirs);

  const segments = [];
  const stats = { mineOnly: 0, theirsOnly: 0, identical: 0, conflicts: 0 };
  let stable = [];
  const flushStable = () => {
    if (stable.length) {
      segments.push({ type: 'stable', lines: stable });
      stable = [];
    }
  };

  let pos = 0;
  let i = 0;
  let j = 0;
  while (i < A.length || j < B.length) {
    const takeA = j >= B.length || (i < A.length && A[i].aStart <= B[j].aStart);
    const clusterA = [];
    const clusterB = [];
    let start;
    let end;
    if (takeA) {
      start = A[i].aStart;
      end = A[i].aEnd;
      clusterA.push(A[i++]);
    } else {
      start = B[j].aStart;
      end = B[j].aEnd;
      clusterB.push(B[j++]);
    }
    for (let grew = true; grew; ) {
      grew = false;
      if (i < A.length && A[i].aStart <= end) {
        end = Math.max(end, A[i].aEnd);
        clusterA.push(A[i++]);
        grew = true;
      }
      if (j < B.length && B[j].aStart <= end) {
        end = Math.max(end, B[j].aEnd);
        clusterB.push(B[j++]);
        grew = true;
      }
    }

    for (let p = pos; p < start; p++) stable.push(base[p]);
    pos = end;

    if (clusterA.length && clusterB.length) {
      const mineRegion = applyHunks(base, clusterA, start, end);
      const theirsRegion = applyHunks(base, clusterB, start, end);
      if (sameLines(mineRegion, theirsRegion)) {
        stats.identical++;
        for (const line of mineRegion) stable.push(line);
      } else {
        stats.conflicts++;
        flushStable();
        segments.push({ type: 'conflict', base: base.slice(start, end), mine: mineRegion, theirs: theirsRegion });
      }
    } else if (clusterA.length) {
      stats.mineOnly++;
      for (const line of applyHunks(base, clusterA, start, end)) stable.push(line);
    } else {
      stats.theirsOnly++;
      for (const line of applyHunks(base, clusterB, start, end)) stable.push(line);
    }
  }
  for (let p = pos; p < base.length; p++) stable.push(base[p]);
  flushStable();

  const result = { segments, conflictCount: stats.conflicts, stats };
  if (stats.conflicts === 0) result.mergedText = segments.flatMap((s) => s.lines).join('\n');
  return result;
}

/**
 * The same segment shape for when there is NO common ancestor (a file
 * synced before this app began keeping one): every differing region
 * between `mineText` and `theirsText` becomes a conflict with no `base`.
 * Falls back to one whole-file conflict if the two differ too much to
 * diff.
 */
function diff2Segments(mineText, theirsText) {
  const mine = splitLines(mineText);
  const theirs = splitLines(theirsText);
  const hunks = diffHunksOfLines(mine, theirs);
  if (hunks === null) {
    return { segments: [{ type: 'conflict', base: null, mine, theirs }], conflictCount: 1 };
  }
  const segments = [];
  let pos = 0;
  for (const h of hunks) {
    if (h.aStart > pos) segments.push({ type: 'stable', lines: mine.slice(pos, h.aStart) });
    segments.push({ type: 'conflict', base: null, mine: mine.slice(h.aStart, h.aEnd), theirs: theirs.slice(h.bStart, h.bEnd) });
    pos = h.aEnd;
  }
  if (pos < mine.length) segments.push({ type: 'stable', lines: mine.slice(pos) });
  return { segments, conflictCount: hunks.length };
}

/**
 * Builds the final text from `segments`, taking `choices[k]` for the
 * k-th conflict: 'mine', 'theirs', or 'both' (mine's lines, then
 * theirs'). Throws if a conflict has no valid choice, so a half-resolved
 * merge can never be written by accident.
 */
function resolveSegments(segments, choices) {
  const out = [];
  let k = 0;
  for (const seg of segments) {
    if (seg.type === 'stable') {
      for (const line of seg.lines) out.push(line);
      continue;
    }
    const choice = choices[k++];
    if (choice === 'mine') out.push(...seg.mine);
    else if (choice === 'theirs') out.push(...seg.theirs);
    else if (choice === 'both') out.push(...seg.mine, ...seg.theirs);
    else throw new Error(`resolveSegments: no valid choice for conflict ${k - 1}`);
  }
  return out.join('\n');
}

/**
 * Decides how a sync conflict should be handled, without any UI:
 *
 *   { kind: 'same' }
 *       mine and theirs are already identical -- nothing to resolve.
 *   { kind: 'auto', mergedText, stats, keepsMineOnly }
 *       a clean three-way merge: every change fit together. When
 *       `keepsMineOnly` is true the other side had no real change at all
 *       (the merged text IS mine -- e.g. a server ETag that changed with
 *       identical content), so nothing was actually merged.
 *   { kind: 'review', segments, conflictCount, hasBase, stats? }
 *       some region needs a person's decision. `hasBase` is false when no
 *       common ancestor was available, in which case every difference is
 *       shown (see diff2Segments).
 */
function planConflict(mine, theirs, base) {
  if (mine === theirs) return { kind: 'same' };
  if (typeof base === 'string') {
    const r = merge3(base, mine, theirs);
    if (r) {
      if (r.conflictCount === 0) {
        return { kind: 'auto', mergedText: r.mergedText, stats: r.stats, keepsMineOnly: r.mergedText === mine };
      }
      return { kind: 'review', segments: r.segments, conflictCount: r.conflictCount, hasBase: true, stats: r.stats };
    }
  }
  const d = diff2Segments(mine, theirs);
  return { kind: 'review', segments: d.segments, conflictCount: d.conflictCount, hasBase: false };
}

export { merge3, diff2Segments, resolveSegments, planConflict, diffHunksOfLines, MAX_EDIT_DISTANCE };
