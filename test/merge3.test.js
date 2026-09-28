import test from 'node:test';
import assert from 'node:assert/strict';
import { merge3, diff2Segments, resolveSegments, planConflict, diffHunksOfLines, MAX_EDIT_DISTANCE } from '../src/merge3.js';

// A small deterministic PRNG so failures reproduce.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function lcsLength(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp[0][0];
}

function applyDiff(a, b, hunks) {
  const out = [];
  let pos = 0;
  for (const h of hunks) {
    for (let p = pos; p < h.aStart; p++) out.push(a[p]);
    for (let p = h.bStart; p < h.bEnd; p++) out.push(b[p]);
    pos = h.aEnd;
  }
  for (let p = pos; p < a.length; p++) out.push(a[p]);
  return out;
}

// ---- the diff itself ----------------------------------------------------

test('diff: identical inputs have no hunks', () => {
  assert.deepEqual(diffHunksOfLines(['a', 'b'], ['a', 'b']), []);
  assert.deepEqual(diffHunksOfLines([], []), []);
});

test('diff: pure insertion, pure deletion, replacement', () => {
  assert.deepEqual(diffHunksOfLines(['a', 'c'], ['a', 'b', 'c']), [{ aStart: 1, aEnd: 1, bStart: 1, bEnd: 2 }]);
  assert.deepEqual(diffHunksOfLines(['a', 'b', 'c'], ['a', 'c']), [{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 1 }]);
  assert.deepEqual(diffHunksOfLines(['a', 'b', 'c'], ['a', 'X', 'c']), [{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 }]);
  assert.deepEqual(diffHunksOfLines([], ['x']), [{ aStart: 0, aEnd: 0, bStart: 0, bEnd: 1 }]);
  assert.deepEqual(diffHunksOfLines(['x'], []), [{ aStart: 0, aEnd: 1, bStart: 0, bEnd: 0 }]);
});

test('diff: on 300 random small inputs, applying the hunks reproduces the target and the edit is MINIMAL (matches a brute-force LCS)', () => {
  const rand = rng(12345);
  for (let round = 0; round < 300; round++) {
    const alphabet = 1 + Math.floor(rand() * 4); // small alphabet => many repeated lines
    const mk = () => Array.from({ length: Math.floor(rand() * 14) }, () => 'l' + Math.floor(rand() * alphabet * 2));
    const a = mk();
    const b = mk();
    const hunks = diffHunksOfLines(a, b);
    assert.deepEqual(applyDiff(a, b, hunks), b, `round ${round}: ${JSON.stringify({ a, b })}`);
    const removed = hunks.reduce((s, h) => s + (h.aEnd - h.aStart), 0);
    const added = hunks.reduce((s, h) => s + (h.bEnd - h.bStart), 0);
    const lcs = lcsLength(a, b);
    assert.equal(removed, a.length - lcs, `round ${round}: not minimal on the a side`);
    assert.equal(added, b.length - lcs, `round ${round}: not minimal on the b side`);
  }
});

test('diff: hunks are in order and never overlap', () => {
  const rand = rng(99);
  for (let round = 0; round < 100; round++) {
    const mk = () => Array.from({ length: 20 }, () => 'l' + Math.floor(rand() * 5));
    const hunks = diffHunksOfLines(mk(), mk());
    for (let k = 1; k < hunks.length; k++) {
      assert.ok(hunks[k].aStart > hunks[k - 1].aEnd || hunks[k].bStart > hunks[k - 1].bEnd);
      assert.ok(hunks[k].aStart >= hunks[k - 1].aEnd && hunks[k].bStart >= hunks[k - 1].bEnd);
    }
  }
});

test('diff: gives up (null) past MAX_EDIT_DISTANCE instead of running away', () => {
  const a = Array.from({ length: MAX_EDIT_DISTANCE + 500 }, (_, i) => 'a' + i);
  const b = Array.from({ length: MAX_EDIT_DISTANCE + 500 }, (_, i) => 'b' + i);
  assert.equal(diffHunksOfLines(a, b), null);
});

// ---- merge3 -------------------------------------------------------------

const BASE = ['* One', 'body 1', '* Two', 'body 2', '* Three', 'body 3', '* Four', 'body 4', '* Five', 'body 5', ''].join('\n');
const edit = (text, line, replacement) => {
  const lines = text.split('\n');
  lines[line] = replacement;
  return lines.join('\n');
};

test('edits in different places merge automatically, keeping both', () => {
  const mine = edit(BASE, 1, 'body 1 -- mine');
  const theirs = edit(BASE, 9, 'body 5 -- theirs');
  const r = merge3(BASE, mine, theirs);
  assert.equal(r.conflictCount, 0);
  assert.equal(r.mergedText, edit(edit(BASE, 1, 'body 1 -- mine'), 9, 'body 5 -- theirs'));
  assert.deepEqual(r.stats, { mineOnly: 1, theirsOnly: 1, identical: 0, conflicts: 0 });
});

test('only one side changed: the merge is exactly that side', () => {
  const mine = edit(BASE, 3, 'body 2 -- mine');
  assert.equal(merge3(BASE, mine, BASE).mergedText, mine);
  assert.equal(merge3(BASE, BASE, mine).mergedText, mine);
  assert.equal(merge3(BASE, BASE, BASE).mergedText, BASE);
});

test('both sides made the identical change: no conflict, applied once', () => {
  const both = edit(BASE, 3, 'body 2 -- same');
  const r = merge3(BASE, both, both);
  assert.equal(r.conflictCount, 0);
  assert.equal(r.mergedText, both);
  assert.equal(r.stats.identical, 1);
});

test('the same line changed two different ways is a conflict, reporting base, mine and theirs', () => {
  const mine = edit(BASE, 3, 'body 2 -- mine');
  const theirs = edit(BASE, 3, 'body 2 -- theirs');
  const r = merge3(BASE, mine, theirs);
  assert.equal(r.conflictCount, 1);
  assert.equal(r.mergedText, undefined);
  const conflict = r.segments.find((s) => s.type === 'conflict');
  assert.deepEqual(conflict.base, ['body 2']);
  assert.deepEqual(conflict.mine, ['body 2 -- mine']);
  assert.deepEqual(conflict.theirs, ['body 2 -- theirs']);
});

test('a conflict does not stop the rest of the file from merging', () => {
  let mine = edit(BASE, 3, 'body 2 -- mine');
  mine = edit(mine, 9, 'body 5 -- mine only');
  const theirs = edit(BASE, 3, 'body 2 -- theirs');
  const r = merge3(BASE, mine, theirs);
  assert.equal(r.conflictCount, 1);
  assert.equal(r.stats.mineOnly, 1);
  const text = resolveSegments(r.segments, ['theirs']);
  assert.equal(text, edit(edit(BASE, 3, 'body 2 -- theirs'), 9, 'body 5 -- mine only'));
});

test('adjacent edits (no unchanged line between them) are treated as a conflict, conservatively', () => {
  const mine = edit(BASE, 3, 'body 2 -- mine');
  const theirs = edit(BASE, 4, '* Three -- theirs');
  assert.equal(merge3(BASE, mine, theirs).conflictCount, 1);
});

test('edits separated by one unchanged line still merge', () => {
  const mine = edit(BASE, 3, 'body 2 -- mine');
  const theirs = edit(BASE, 5, 'body 3 -- theirs');
  const r = merge3(BASE, mine, theirs);
  assert.equal(r.conflictCount, 0);
  assert.equal(r.mergedText, edit(edit(BASE, 3, 'body 2 -- mine'), 5, 'body 3 -- theirs'));
});

test('both sides inserting the same text at the same spot merges to one copy', () => {
  const lines = BASE.split('\n');
  const withInsert = [...lines.slice(0, 4), '** New', ...lines.slice(4)].join('\n');
  const r = merge3(BASE, withInsert, withInsert);
  assert.equal(r.mergedText, withInsert);
});

test('two different insertions at the same spot conflict', () => {
  const lines = BASE.split('\n');
  const mine = [...lines.slice(0, 4), '** From mine', ...lines.slice(4)].join('\n');
  const theirs = [...lines.slice(0, 4), '** From theirs', ...lines.slice(4)].join('\n');
  const r = merge3(BASE, mine, theirs);
  assert.equal(r.conflictCount, 1);
  const c = r.segments.find((s) => s.type === 'conflict');
  assert.deepEqual(c.base, []);
  assert.equal(resolveSegments(r.segments, ['both']).includes('** From mine\n** From theirs'), true);
});

test('one side deleting a block the other edited inside is a conflict', () => {
  const lines = BASE.split('\n');
  const mine = [...lines.slice(0, 2), ...lines.slice(6)].join('\n'); // deletes Two and Three
  const theirs = edit(BASE, 3, 'body 2 -- theirs');
  assert.equal(merge3(BASE, mine, theirs).conflictCount, 1);
});

test('a trailing newline and CRLF line endings survive a merge exactly', () => {
  const crlf = BASE.replace(/\n/g, '\r\n');
  const mine = crlf.replace('body 1', 'body 1 mine');
  const theirs = crlf.replace('body 5', 'body 5 theirs');
  const r = merge3(crlf, mine, theirs);
  assert.equal(r.mergedText, crlf.replace('body 1', 'body 1 mine').replace('body 5', 'body 5 theirs'));
  assert.ok(r.mergedText.endsWith('\r\n'));
});

test('resolveSegments: mine / theirs / both, and it refuses a missing choice', () => {
  const mine = edit(BASE, 3, 'M');
  const theirs = edit(BASE, 3, 'T');
  const r = merge3(BASE, mine, theirs);
  assert.equal(resolveSegments(r.segments, ['mine']), mine);
  assert.equal(resolveSegments(r.segments, ['theirs']), theirs);
  assert.equal(resolveSegments(r.segments, ['both']), edit(BASE, 3, 'M\nT'));
  assert.throws(() => resolveSegments(r.segments, []), /no valid choice/);
  assert.throws(() => resolveSegments(r.segments, ['nonsense']), /no valid choice/);
});

test('property: edits to widely separated lines by each side always merge cleanly into both sets of edits', () => {
  const rand = rng(2024);
  for (let round = 0; round < 60; round++) {
    const n = 20 + Math.floor(rand() * 40);
    const base = Array.from({ length: n }, (_, i) => 'line ' + i);
    const mine = [...base];
    const theirs = [...base];
    const expected = [...base];
    for (let p = 1; p < n - 1; p += 3 + Math.floor(rand() * 3)) {
      const who = rand() < 0.5 ? 'mine' : 'theirs';
      (who === 'mine' ? mine : theirs)[p] = `${who} edit ${p}`;
      expected[p] = `${who} edit ${p}`;
    }
    const r = merge3(base.join('\n'), mine.join('\n'), theirs.join('\n'));
    assert.equal(r.conflictCount, 0, `round ${round}`);
    assert.equal(r.mergedText, expected.join('\n'), `round ${round}`);
  }
});

test('property: merging with base === one side always yields the other side', () => {
  const rand = rng(7);
  for (let round = 0; round < 60; round++) {
    const mk = () => Array.from({ length: 15 }, () => 'l' + Math.floor(rand() * 6)).join('\n');
    const base = mk();
    const other = mk();
    assert.equal(merge3(base, base, other).mergedText, other);
    assert.equal(merge3(base, other, base).mergedText, other);
    assert.equal(merge3(base, other, other).mergedText, other);
  }
});

test('performance: a 20,000-line file with one edit at each end merges quickly and cleanly', () => {
  const base = Array.from({ length: 20000 }, (_, i) => '* Heading ' + i);
  const mine = [...base];
  const theirs = [...base];
  mine[10] = 'mine edit';
  theirs[19990] = 'theirs edit';
  const t0 = Date.now();
  const r = merge3(base.join('\n'), mine.join('\n'), theirs.join('\n'));
  const ms = Date.now() - t0;
  assert.equal(r.conflictCount, 0);
  assert.equal(r.mergedText.split('\n')[10], 'mine edit');
  assert.equal(r.mergedText.split('\n')[19990], 'theirs edit');
  assert.ok(ms < 1500, `took ${ms}ms`);
});

test('merge3 returns null when the versions differ too much to diff, rather than hanging', () => {
  const a = Array.from({ length: 3000 }, (_, i) => 'a' + i).join('\n');
  const b = Array.from({ length: 3000 }, (_, i) => 'b' + i).join('\n');
  assert.equal(merge3(a, b, a), null);
});

// ---- no common ancestor -------------------------------------------------

test('diff2Segments: with no base, each differing region is a conflict with no base lines', () => {
  const mine = edit(BASE, 1, 'mine 1');
  const r = diff2Segments(mine, BASE);
  assert.equal(r.conflictCount, 1);
  const c = r.segments.find((s) => s.type === 'conflict');
  assert.equal(c.base, null);
  assert.deepEqual(c.mine, ['mine 1']);
  assert.deepEqual(c.theirs, ['body 1']);
  assert.equal(resolveSegments(r.segments, ['mine']), mine);
  assert.equal(resolveSegments(r.segments, ['theirs']), BASE);
});

test('diff2Segments: identical texts have no conflicts', () => {
  assert.equal(diff2Segments(BASE, BASE).conflictCount, 0);
});

test('diff2Segments: two files too different to diff become ONE whole-file conflict', () => {
  const a = Array.from({ length: 3000 }, (_, i) => 'a' + i).join('\n');
  const b = Array.from({ length: 3000 }, (_, i) => 'b' + i).join('\n');
  const r = diff2Segments(a, b);
  assert.equal(r.conflictCount, 1);
  assert.equal(resolveSegments(r.segments, ['mine']), a);
  assert.equal(resolveSegments(r.segments, ['theirs']), b);
});

// ---- planConflict -----------------------------------------------------------


test('planConflict: identical mine and theirs need no resolution', () => {
  assert.deepEqual(planConflict(BASE, BASE, null), { kind: 'same' });
  assert.deepEqual(planConflict('x', 'x', 'y'), { kind: 'same' });
});

test('planConflict: a clean merge is automatic, and reports what fit together', () => {
  const mine = edit(BASE, 1, 'body 1 -- mine');
  const theirs = edit(BASE, 9, 'body 5 -- theirs');
  const plan = planConflict(mine, theirs, BASE);
  assert.equal(plan.kind, 'auto');
  assert.equal(plan.keepsMineOnly, false);
  assert.equal(plan.mergedText, edit(edit(BASE, 1, 'body 1 -- mine'), 9, 'body 5 -- theirs'));
  assert.equal(plan.stats.mineOnly, 1);
  assert.equal(plan.stats.theirsOnly, 1);
});

test('planConflict: when the other side never really changed (disk equals the base), the merge is just mine', () => {
  const mine = edit(BASE, 1, 'body 1 -- mine');
  const plan = planConflict(mine, BASE, BASE);
  assert.equal(plan.kind, 'auto');
  assert.equal(plan.keepsMineOnly, true);
  assert.equal(plan.mergedText, mine);
});

test('planConflict: overlapping edits need review, with a base', () => {
  const plan = planConflict(edit(BASE, 3, 'M'), edit(BASE, 3, 'T'), BASE);
  assert.equal(plan.kind, 'review');
  assert.equal(plan.hasBase, true);
  assert.equal(plan.conflictCount, 1);
});

test('planConflict: with no base, every difference needs review', () => {
  const plan = planConflict(edit(BASE, 1, 'M'), edit(BASE, 9, 'T'), null);
  assert.equal(plan.kind, 'review');
  assert.equal(plan.hasBase, false);
  assert.equal(plan.conflictCount, 2);
});

test('planConflict: versions too different to diff fall back to a whole-file review, not a crash', () => {
  const a = Array.from({ length: 3000 }, (_, i) => 'a' + i).join('\n');
  const b = Array.from({ length: 3000 }, (_, i) => 'b' + i).join('\n');
  const plan = planConflict(a, b, a.replace('a1', 'a1x'));
  assert.equal(plan.kind, 'review');
  assert.equal(plan.hasBase, false);
  assert.equal(plan.conflictCount, 1);
});
