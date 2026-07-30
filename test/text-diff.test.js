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
