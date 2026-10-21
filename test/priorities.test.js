import test from 'node:test';
import assert from 'node:assert/strict';
import { readPriorityRange, priorityRank, priorityCookies, nextPriority, priorityInRange } from '../src/priorities.js';

// [highest, lowest, default, cookie or null, org-get-priority from Emacs 29.3]
const ORACLE = [
  ['A', 'C', 'B', null, 1000], ['A', 'C', 'B', 'A', 2000], ['A', 'C', 'B', 'B', 1000], ['A', 'C', 'B', 'C', 0],
  ['A', 'E', 'C', null, 2000], ['A', 'E', 'C', 'A', 4000], ['A', 'E', 'C', 'B', 3000], ['A', 'E', 'C', 'E', 0],
  ['1', '9', '5', null, 4000], ['1', '9', '5', '1', 8000], ['1', '9', '5', '5', 4000], ['1', '9', '5', '9', 0],
  ['A', 'C', 'A', null, 2000],
];

test('priorityRank agrees with org-get-priority', () => {
  for (const [hi, lo, def, cookie, want] of ORACLE) {
    const range = readPriorityRange({ 'org-priority-highest': hi, 'org-priority-lowest': lo, 'org-priority-default': def });
    assert.equal(priorityRank(cookie, range), want, `${hi}-${lo} default ${def} cookie ${cookie}`);
  }
});

test('the range reads ?A, letters and numbers, and falls back to A, C, B', () => {
  assert.deepEqual(priorityCookies(readPriorityRange({})), ['A', 'B', 'C']);
  assert.deepEqual(priorityCookies(readPriorityRange({ 'org-priority-highest': '?A', 'org-priority-lowest': '?E' })), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(priorityCookies(readPriorityRange({ 'org-priority-highest': '1', 'org-priority-lowest': '4', 'org-priority-default': '2' })), ['1', '2', '3', '4']);
  assert.deepEqual(priorityCookies(readPriorityRange({ 'org-priority-highest': 'E', 'org-priority-lowest': 'A' })), ['A', 'B', 'C']); // reversed
  assert.deepEqual(priorityCookies(readPriorityRange({ 'org-priority-highest': 'A', 'org-priority-lowest': '5' })), ['A', 'B', 'C']); // mixed
});

test('cycling goes none, highest to lowest, none', () => {
  const range = readPriorityRange({ 'org-priority-lowest': 'D' });
  assert.equal(nextPriority(null, range), 'A');
  assert.equal(nextPriority('A', range), 'B');
  assert.equal(nextPriority('D', range), null);
  assert.equal(nextPriority('Z', range), 'A');
});

test('a cookie outside the range is refused for storing', () => {
  const range = readPriorityRange({});
  assert.equal(priorityInRange('B', range), true);
  assert.equal(priorityInRange('E', range), false);
  assert.equal(priorityInRange('1', range), false);
});
