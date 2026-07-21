
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import {
  resolveTodoSequence,
  cycleTodoState,
  setTodoState,
  isDoneKeyword,
  DEFAULT_SEQUENCE,
} from '../src/todo-cycle.js';

test('resolveTodoSequence falls back to the built-in TODO/DONE pair when nothing else is given', () => {
  const doc = parseOrg('* No keyword line here');
  const seq = resolveTodoSequence(doc);
  assert.deepEqual(seq, DEFAULT_SEQUENCE);
});

test('resolveTodoSequence uses a supplied global default when the file has no #+TODO: line', () => {
  const doc = parseOrg('* No keyword line here');
  const global = { todoKeywords: ['NEXT'], doneKeywords: ['SHIPPED'] };
  const seq = resolveTodoSequence(doc, global);
  assert.deepEqual(seq, global);
});

test('a file-level #+TODO: line wins even when a global default is supplied', () => {
  const doc = parseOrg(['#+TODO: NEXT WAITING | DONE CANCELLED', '* Something'].join('\n'));
  const global = { todoKeywords: ['NEXT'], doneKeywords: ['SHIPPED'] };
  const seq = resolveTodoSequence(doc, global);
  assert.deepEqual(seq, { todoKeywords: ['NEXT', 'WAITING'], doneKeywords: ['DONE', 'CANCELLED'] });
});

test('cycleTodoState walks null -> TODO -> DONE -> null with the default sequence', () => {
  const heading = { todo: null };
  const seq = DEFAULT_SEQUENCE;
  assert.equal(cycleTodoState(heading, seq), 'TODO');
  assert.equal(cycleTodoState(heading, seq), 'DONE');
  assert.equal(cycleTodoState(heading, seq), null);
});

test('cycleTodoState walks a custom multi-keyword sequence in order', () => {
  const heading = { todo: null };
  const seq = { todoKeywords: ['NEXT', 'WAITING'], doneKeywords: ['DONE', 'CANCELLED'] };
  const order = [];
  for (let i = 0; i < 5; i++) order.push(cycleTodoState(heading, seq));
  assert.deepEqual(order, ['NEXT', 'WAITING', 'DONE', 'CANCELLED', null]);
});

test('cycleTodoState can go backward', () => {
  const heading = { todo: 'TODO' };
  const seq = DEFAULT_SEQUENCE;
  assert.equal(cycleTodoState(heading, seq, { direction: 'backward' }), null);
});

test('cycleTodoState treats an out-of-sequence current state as the start of the cycle rather than throwing', () => {
  const heading = { todo: 'SOME_OLD_KEYWORD' };
  const seq = DEFAULT_SEQUENCE;
  assert.equal(cycleTodoState(heading, seq), 'TODO');
});

test('setTodoState sets an explicit keyword from the resolved sequence', () => {
  const heading = { todo: null };
  const seq = { todoKeywords: ['NEXT', 'WAITING'], doneKeywords: ['DONE'] };
  setTodoState(heading, 'WAITING', seq);
  assert.equal(heading.todo, 'WAITING');
});

test('setTodoState throws on a keyword outside the resolved sequence', () => {
  const heading = { todo: null };
  const seq = DEFAULT_SEQUENCE;
  assert.throws(() => setTodoState(heading, 'BOGUS', seq));
});

test('isDoneKeyword distinguishes TODO-type from DONE-type keywords', () => {
  const seq = { todoKeywords: ['NEXT', 'WAITING'], doneKeywords: ['DONE', 'CANCELLED'] };
  assert.equal(isDoneKeyword('WAITING', seq), false);
  assert.equal(isDoneKeyword('CANCELLED', seq), true);
});
