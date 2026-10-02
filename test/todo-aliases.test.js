import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg, isTodoSequenceKey } from '../src/org-parser.js';
import { resolveTodoSequences } from '../src/todo-cycle.js';

test('#+SEQ_TODO: and #+TYP_TODO: are read like #+TODO:, so their keywords are recognized on headings', () => {
  const text = '#+SEQ_TODO: NEXT(n) WAIT(w) | DONE(d)\n#+TYP_TODO: Alice Bob | Done\n* NEXT Write it\n* Alice Review\n* WAIT Reply\n* Plain\n';
  const doc = parseOrg(text);
  assert.deepEqual(doc.children.map((h) => [h.todo, h.title]), [['NEXT', 'Write it'], ['Alice', 'Review'], ['WAIT', 'Reply'], [null, 'Plain']]);
  assert.equal(serializeOrg(doc), text, 'and the lines round-trip untouched');
});

test('the cycling code sees the same sequences, one per line', () => {
  const doc = parseOrg('#+SEQ_TODO: NEXT WAIT | DONE\n#+TYP_TODO: Alice Bob | Done\n#+TODO: A | B\n* x\n');
  assert.deepEqual(resolveTodoSequences(doc).map((s) => [s.todoKeywords, s.doneKeywords]), [[['NEXT', 'WAIT'], ['DONE']], [['Alice', 'Bob'], ['Done']], [['A'], ['B']]]);
});

test('the keyword match is case-insensitive and exact: other keywords and look-alikes are not sequences', () => {
  for (const key of ['TODO', 'todo', 'SEQ_TODO', 'seq_todo', 'TYP_TODO', 'Typ_Todo']) assert.equal(isTodoSequenceKey(key), true, key);
  for (const key of ['TODOS', 'MY_TODO', 'TODO_X', 'TITLE', 'SEQ', 'STARTUP']) assert.equal(isTodoSequenceKey(key), false, key);
});
