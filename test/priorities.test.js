import test from 'node:test';
import assert from 'node:assert/strict';
import { readPriorityRange, priorityRank, priorityCookies, nextPriority, priorityInRange, startCycleWithDefault, prioritiesKeyword, readPriorityFaces } from '../src/priorities.js';
import { parseLocalVariables } from '../src/local-variables.js';

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

test('cycling is org-priority-down: none, the default, each lower one, none', () => {
  const range = readPriorityRange({ 'org-priority-lowest': 'D' });
  assert.equal(nextPriority(null, range), 'B');
  assert.equal(nextPriority('B', range), 'C');
  assert.equal(nextPriority('D', range), null);
  assert.equal(nextPriority('Z', range), 'B');
});

test('org-priority-up steps higher and removes the cookie past the highest', () => {
  const range = readPriorityRange({});
  assert.equal(nextPriority(null, range, 'up'), 'B');
  assert.equal(nextPriority('C', range, 'up'), 'B');
  assert.equal(nextPriority('A', range, 'up'), null);
});

test('org-priority-start-cycle-with-default nil starts one step from the default', () => {
  const range = readPriorityRange({});
  assert.equal(startCycleWithDefault({}), true);
  assert.equal(startCycleWithDefault({ 'org-priority-start-cycle-with-default': 'nil' }), false);
  assert.equal(nextPriority(null, range, 'down', false), 'C');
  assert.equal(nextPriority(null, range, 'up', false), 'A');
});

test('#+PRIORITIES: sets the range of the file, the default being optional', () => {
  assert.deepEqual(prioritiesKeyword('#+TITLE: x\n#+PRIORITIES: A E C\n* H'), { 'org-priority-highest': 'A', 'org-priority-lowest': 'E', 'org-priority-default': 'C' });
  assert.deepEqual(prioritiesKeyword('#+priorities: 1 9'), { 'org-priority-highest': '1', 'org-priority-lowest': '9' });
  assert.deepEqual(prioritiesKeyword('#+PRIORITIES: A'), {});
  assert.deepEqual(prioritiesKeyword('* H'), {});
  const vars = parseLocalVariables('#+PRIORITIES: A E C\n* H');
  assert.deepEqual(priorityCookies(readPriorityRange(vars)), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(readPriorityRange(vars).default, 67);
});

test('org-priority-faces reads colors, the named faces and property lists', () => {
  const faces = readPriorityFaces('\'((?A . error) (?B . "orange") (?C . (:foreground "#00aa00" :weight bold)) (?D . (:inherit warning)))');
  assert.deepEqual(faces.get('A'), { color: '#d32f2f' });
  assert.deepEqual(faces.get('B'), { color: 'orange' });
  assert.deepEqual(faces.get('C'), { color: '#00aa00', bold: true });
  assert.deepEqual(faces.get('D'), { color: '#ef6c00' });
  assert.equal(readPriorityFaces('').size, 0);
});

test('a cookie outside the range is refused for storing', () => {
  const range = readPriorityRange({});
  assert.equal(priorityInRange('B', range), true);
  assert.equal(priorityInRange('E', range), false);
  assert.equal(priorityInRange('1', range), false);
});
