
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

// ---- multiple #+TODO: lines (the real bug) -------------------------------

test('THE BUG THIS FIXES: with two #+TODO: lines, resolveTodoSequence used to read only the FIRST one -- the opposite of what the parser itself does when setting heading.todo (last line wins, per-part)', () => {
  const doc = parseOrg(
    ['#+TODO: TODO WAIT | DONE KILL', '#+TODO: TODO | DONE', '* WAIT Something'].join('\n')
  );
  // The parser itself, using its own last-wins-per-part algorithm, does NOT
  // recognize WAIT here (the second line's non-empty TODO part replaced
  // the first line's), so heading.todo is null -- this is correct,
  // expected parser behavior, not a bug on its own.
  assert.equal(doc.children[0].todo, null);
  // The bug: resolveTodoSequence used to disagree with the parser about
  // this, reporting WAIT as a valid keyword anyway (it read only the
  // first line). Now it must agree with the parser exactly.
  const seq = resolveTodoSequence(doc);
  assert.deepEqual(seq.todoKeywords, ['TODO']);
  assert.deepEqual(seq.doneKeywords, ['DONE']);
});

test('a later #+TODO: line with a non-empty TODO part replaces the earlier one entirely (not merged)', () => {
  const doc = parseOrg(['#+TODO: TODO WAIT REVIEW | DONE', '#+TODO: TODO | DONE CANCELLED'].join('\n'));
  const seq = resolveTodoSequence(doc);
  assert.deepEqual(seq.todoKeywords, ['TODO']); // WAIT, REVIEW from line 1 are gone
  assert.deepEqual(seq.doneKeywords, ['DONE', 'CANCELLED']); // line 2's done part used, since it's non-empty
});

test('a later #+TODO: line with an EMPTY todo part does not blank out an earlier lines todo keywords', () => {
  const doc = parseOrg(['#+TODO: TODO WAIT | DONE', '#+TODO: | KILLED'].join('\n'));
  const seq = resolveTodoSequence(doc);
  assert.deepEqual(seq.todoKeywords, ['TODO', 'WAIT']); // kept from line 1, since line 2's part was empty
  assert.deepEqual(seq.doneKeywords, ['KILLED']); // line 2's non-empty done part used
});

test('resolveTodoSequence with multiple lines matches heading.todo exactly for a keyword that DOES survive to the final sequence', () => {
  const doc = parseOrg(
    ['#+TODO: TODO WAIT | DONE KILL', '#+TODO: TODO WAIT | DONE', '* WAIT Something still valid'].join('\n')
  );
  assert.equal(doc.children[0].todo, 'WAIT'); // both lines agree WAIT is valid
  const seq = resolveTodoSequence(doc);
  assert.ok(seq.todoKeywords.includes('WAIT'));
});

test('a single #+TODO: line (the common case) is completely unaffected by this fix', () => {
  const doc = parseOrg('#+TODO: TODO WAIT | DONE KILL\n* WAIT Something');
  const seq = resolveTodoSequence(doc);
  assert.deepEqual(seq, { todoKeywords: ['TODO', 'WAIT'], doneKeywords: ['DONE', 'KILL'] });
  assert.equal(doc.children[0].todo, 'WAIT');
});
