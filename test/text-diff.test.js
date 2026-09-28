import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, diffHunks } from '../src/text-diff.js';

// ---- diffLines ---------------------------------------------------------

test('identical text produces all "same" lines', () => {
  const result = diffLines('a\nb\nc', 'a\nb\nc');
  assert.deepEqual(
    result.map((r) => r.type),
    ['same', 'same', 'same']
  );
});

test('a single line changed in the middle produces removed+added around unchanged context', () => {
  const result = diffLines('a\nb\nc', 'a\nx\nc');
  assert.deepEqual(result, [
    { type: 'same', line: 'a' },
    { type: 'removed', line: 'b' },
    { type: 'added', line: 'x' },
    { type: 'same', line: 'c' },
  ]);
});

test('a line appended at the end produces one "added" entry, nothing else changed', () => {
  const result = diffLines('a\nb', 'a\nb\nc');
  assert.deepEqual(result, [
    { type: 'same', line: 'a' },
    { type: 'same', line: 'b' },
    { type: 'added', line: 'c' },
  ]);
});

test('a line removed from the end produces one "removed" entry', () => {
  const result = diffLines('a\nb\nc', 'a\nb');
  assert.deepEqual(result, [
    { type: 'same', line: 'a' },
    { type: 'same', line: 'b' },
    { type: 'removed', line: 'c' },
  ]);
});

test('a line inserted at the very start', () => {
  const result = diffLines('b\nc', 'a\nb\nc');
  assert.deepEqual(result, [
    { type: 'added', line: 'a' },
    { type: 'same', line: 'b' },
    { type: 'same', line: 'c' },
  ]);
});

test('completely different text produces all removed then all added (no accidental matches)', () => {
  const result = diffLines('a\nb', 'x\ny');
  assert.equal(result.every((r) => r.type !== 'same'), true);
  assert.deepEqual(
    result.map((r) => r.line),
    ['a', 'b', 'x', 'y']
  );
});

test('empty old text against non-empty new text is entirely "added"', () => {
  const result = diffLines('', 'a\nb');
  // splitting '' on '\n' yields [''] -- one empty old line
  assert.ok(result.some((r) => r.type === 'added' && r.line === 'a'));
  assert.ok(result.some((r) => r.type === 'added' && r.line === 'b'));
});

test('two identical empty strings produce a single same (empty) line, no spurious diff', () => {
  const result = diffLines('', '');
  assert.deepEqual(result, [{ type: 'same', line: '' }]);
});

test('a realistic org-heading-level change: TODO toggled on', () => {
  const before = '* Buy milk\nSome notes.';
  const after = '* TODO Buy milk\nSome notes.';
  const result = diffLines(before, after);
  assert.deepEqual(result, [
    { type: 'removed', line: '* Buy milk' },
    { type: 'added', line: '* TODO Buy milk' },
    { type: 'same', line: 'Some notes.' },
  ]);
});

// ---- diffHunks ----------------------------------------------------------

test('no changes at all produces zero hunks', () => {
  assert.deepEqual(diffHunks('a\nb\nc', 'a\nb\nc'), []);
});

test('a single change produces one hunk with context lines around it', () => {
  const hunks = diffHunks('1\n2\n3\n4\n5', '1\n2\nX\n4\n5', 1);
  assert.equal(hunks.length, 1);
  assert.deepEqual(
    hunks[0].lines.map((l) => l.line),
    ['2', '3', 'X', '4']
  );
});

test('two far-apart changes produce two separate hunks', () => {
  const oldText = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
  const lines = oldText.split('\n');
  lines[2] = 'CHANGED_A';
  lines[17] = 'CHANGED_B';
  const newText = lines.join('\n');
  const hunks = diffHunks(oldText, newText, 1);
  assert.equal(hunks.length, 2);
});

test('two nearby changes whose context windows overlap merge into one hunk', () => {
  const oldText = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n');
  const lines = oldText.split('\n');
  lines[3] = 'CHANGED_A';
  lines[5] = 'CHANGED_B';
  const newText = lines.join('\n');
  const hunks = diffHunks(oldText, newText, 2); // context windows (1-5) and (3-7) overlap
  assert.equal(hunks.length, 1);
});

test('a change at the very start does not request negative context (no out-of-range slice)', () => {
  const hunks = diffHunks('a\nb\nc', 'X\nb\nc', 3);
  assert.equal(hunks.length, 1);
  assert.deepEqual(
    hunks[0].lines.map((l) => l.line),
    ['a', 'X', 'b', 'c']
  );
});

test('a change at the very end does not request out-of-range context past the last line', () => {
  const hunks = diffHunks('a\nb\nc', 'a\nb\nX', 3);
  assert.equal(hunks.length, 1);
  assert.deepEqual(
    hunks[0].lines.map((l) => l.line),
    ['a', 'b', 'c', 'X']
  );
});

// ---- large inputs and the too-different fallback ----------------------------

function rebuild(ops, side) {
  return ops.filter((o) => o.type === 'same' || o.type === side).map((o) => o.line).join('\n');
}

test('a 20,000-line file with one changed line diffs instantly (the old n*m table would have needed ~400 million cells)', () => {
  const lines = Array.from({ length: 20000 }, (_, i) => '* Heading ' + i);
  const edited = [...lines];
  edited[12345] = '* Heading 12345 (edited)';
  const t0 = Date.now();
  const ops = diffLines(lines.join('\n'), edited.join('\n'));
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, `took ${ms}ms`);
  assert.equal(ops.filter((o) => o.type === 'removed').length, 1);
  assert.equal(ops.filter((o) => o.type === 'added').length, 1);
  assert.equal(ops.length, 20001);
});

test('diffHunks on that large file gives one small hunk, not a wall of unchanged lines', () => {
  const lines = Array.from({ length: 20000 }, (_, i) => 'line ' + i);
  const edited = [...lines];
  edited[100] = 'changed';
  const hunks = diffHunks(lines.join('\n'), edited.join('\n'), 2);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].lines.length, 6); // 2 before, removed, added, 2 after
});

test('two texts far too different to diff minimally still give a CORRECT diff (one replaced block)', () => {
  const a = ['keep top', ...Array.from({ length: 3000 }, (_, i) => 'a' + i), 'keep bottom'].join('\n');
  const b = ['keep top', ...Array.from({ length: 3000 }, (_, i) => 'b' + i), 'keep bottom'].join('\n');
  const ops = diffLines(a, b);
  assert.equal(rebuild(ops, 'removed'), a);
  assert.equal(rebuild(ops, 'added'), b);
  assert.equal(ops[0].type, 'same');
  assert.equal(ops[ops.length - 1].type, 'same');
  assert.equal(ops.filter((o) => o.type === 'same').length, 2, 'the shared head and tail are still recognised');
});

test('on random small inputs the diff reproduces both sides exactly and is minimal', () => {
  let seed = 4242;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
  const lcs = (a, b) => {
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    return dp[0][0];
  };
  for (let round = 0; round < 200; round++) {
    const mk = () => Array.from({ length: Math.floor(rand() * 12) }, () => 'l' + Math.floor(rand() * 4));
    const a = mk();
    const b = mk();
    const ops = diffLines(a.join('\n'), b.join('\n'));
    assert.equal(rebuild(ops, 'removed'), a.join('\n'), `round ${round} old side`);
    assert.equal(rebuild(ops, 'added'), b.join('\n'), `round ${round} new side`);
    const sameCount = ops.filter((o) => o.type === 'same').length;
    // '' splits to [''] so compare against the split arrays the function itself uses
    assert.equal(sameCount, lcs(a.join('\n').split('\n'), b.join('\n').split('\n')), `round ${round} minimal`);
  }
});
