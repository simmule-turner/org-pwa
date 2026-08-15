
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import {
  resolveTodoSequence,
  resolveTodoSequences,
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
  assert.deepEqual(seq, { ...global, keySpecs: {}, logSpecs: {} });
});

test('a file-level #+TODO: line wins even when a global default is supplied', () => {
  const doc = parseOrg(['#+TODO: NEXT WAITING | DONE CANCELLED', '* Something'].join('\n'));
  const global = { todoKeywords: ['NEXT'], doneKeywords: ['SHIPPED'] };
  const seq = resolveTodoSequence(doc, global);
  assert.deepEqual(seq, { todoKeywords: ['NEXT', 'WAITING'], doneKeywords: ['DONE', 'CANCELLED'], keySpecs: {}, logSpecs: {} });
});

test('THE FIX: a #+TODO: line with NO "|" separator at all treats the LAST keyword as the sole done state -- confirmed directly against the Org Mode Compact Guide\u2019s own wording: "If you do not provide the separator bar, the last state is used as the \u2018DONE\u2019 state." Previously, this app left doneKeywords empty in this case, meaning the file\u2019s own final keyword (here, "FIXED") was never recognized as done at all -- checkbox counting, agenda completion logic, and CLOSED-timestamp insertion would all have been silently wrong for a real file using this common, valid syntax.', () => {
  const doc = parseOrg(['#+TODO: TODO NEXT FIXED', '* Something'].join('\n'));
  const seq = resolveTodoSequence(doc, { todoKeywords: ['TODO'], doneKeywords: ['DONE'] });
  assert.deepEqual(seq.todoKeywords, ['TODO', 'NEXT']);
  assert.deepEqual(seq.doneKeywords, ['FIXED']);
});

test('THE FIX: the no-separator fallback still correctly carries fast-select keys and logging specs for the keyword it moves into doneKeywords', () => {
  const doc = parseOrg(['#+TODO: TODO(t) NEXT(n) FIXED(f!)', '* Something'].join('\n'));
  const seq = resolveTodoSequence(doc, { todoKeywords: ['TODO'], doneKeywords: ['DONE'] });
  assert.deepEqual(seq.doneKeywords, ['FIXED']);
  assert.equal(seq.keySpecs.FIXED, 'f');
  assert.equal(seq.logSpecs.FIXED, '!');
});

test('a single bare keyword with no "|" at all becomes the done state; the (separate, intentional) "don\u2019t overwrite with empty" behavior in resolveTodoSequence -- needed for the legitimate multi-line #+TODO: case, see the test above -- means the global default\u2019s own todoKeywords stays in effect here rather than clearing to [], since this one #+TODO: line has none of its own to contribute', () => {
  const doc = parseOrg(['#+TODO: ONLYSTATE', '* Something'].join('\n'));
  const seq = resolveTodoSequence(doc, { todoKeywords: ['TODO'], doneKeywords: ['DONE'] });
  assert.deepEqual(seq.todoKeywords, ['TODO'], 'the global default carries through, unaffected -- this file\u2019s own line contributed no todo keywords of its own');
  assert.deepEqual(seq.doneKeywords, ['ONLYSTATE'], 'the fix itself: this file\u2019s own single keyword is correctly recognized as the done state');
});

test('a "|" that IS present, even with nothing after it, is a genuinely different case (explicitly "no done states at all") and must NOT trigger the no-separator fallback', () => {
  const doc = parseOrg(['#+TODO: TODO NEXT |', '* Something'].join('\n'));
  const seq = resolveTodoSequence(doc, { todoKeywords: ['TODO'], doneKeywords: ['DONE'] });
  assert.deepEqual(seq.todoKeywords, ['TODO', 'NEXT'], 'both keywords stay as TODO-type, neither gets silently reassigned to done');
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

test('THE FIX (deeper than the earlier "last line wins" pass): the parser AND resolveTodoSequence now correctly agree that multiple #+TODO: lines are SEPARATE, PARALLEL sequences, per real org\u2019s own actual documented model -- not one line progressively overriding the previous one. A heading using an EARLIER line\u2019s own keyword is correctly recognized, at parse time, not just by resolveTodoSequence', () => {
  const doc = parseOrg(
    ['#+TODO: TODO WAIT | DONE KILL', '#+TODO: TODO | DONE', '* WAIT Something'].join('\n')
  );
  // Previously null: the parser's own OLD, separate copy of the same
  // last-line-wins bug meant "WAIT" was never recognized as a keyword at
  // all, so it fell through as literal heading title text instead.
  assert.equal(doc.children[0].todo, 'WAIT', 'the parser itself now correctly recognizes a keyword from an EARLIER #+TODO: line');
  const seq = resolveTodoSequence(doc);
  assert.deepEqual(seq.todoKeywords, ['TODO', 'WAIT']);
  assert.deepEqual(seq.doneKeywords, ['DONE', 'KILL']);
});

test('two #+TODO: lines with genuinely different sequences (a real multi-workflow file) are both correctly recognized together -- neither line\u2019s own keywords are dropped', () => {
  const doc = parseOrg(['#+TODO: TODO WAIT REVIEW | DONE', '#+TODO: REPORT BUG | FIXED'].join('\n'));
  const seq = resolveTodoSequence(doc);
  assert.deepEqual(seq.todoKeywords, ['TODO', 'WAIT', 'REVIEW', 'REPORT', 'BUG']);
  assert.deepEqual(seq.doneKeywords, ['DONE', 'FIXED']);
});

test('resolveTodoSequences (plural) correctly keeps two #+TODO: lines as two SEPARATE sequences, each with only its own keywords -- the actual data multi-workflow selection needs, distinct from resolveTodoSequence\u2019s own flattened union', () => {
  const doc = parseOrg(['#+TODO: TODO WAIT REVIEW | DONE', '#+TODO: REPORT BUG | FIXED'].join('\n'));
  const sequences = resolveTodoSequences(doc);
  assert.equal(sequences.length, 2);
  assert.deepEqual(sequences[0].todoKeywords, ['TODO', 'WAIT', 'REVIEW']);
  assert.deepEqual(sequences[0].doneKeywords, ['DONE']);
  assert.deepEqual(sequences[1].todoKeywords, ['REPORT', 'BUG']);
  assert.deepEqual(sequences[1].doneKeywords, ['FIXED']);
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
  assert.deepEqual(seq, { todoKeywords: ['TODO', 'WAIT'], doneKeywords: ['DONE', 'KILL'], keySpecs: {}, logSpecs: {} });
  assert.equal(doc.children[0].todo, 'WAIT');
});

// ---- resolveTodoSequence: keySpecs / logSpecs -----------------------

test('resolveTodoSequence exposes keySpecs and logSpecs parsed from the file\u2019s own #+TODO: line', () => {
  const doc = parseOrg('#+TODO: TODO(t) WAIT(w@/!) | DONE(d!) KILL(k@)\n* Something\n');
  const seq = resolveTodoSequence(doc);
  assert.deepEqual(seq.keySpecs, { TODO: 't', WAIT: 'w', DONE: 'd', KILL: 'k' });
  assert.deepEqual(seq.logSpecs, { WAIT: '@/!', DONE: '!', KILL: '@' });
});

test('keySpecs/logSpecs merge across multiple #+TODO: lines the same keyword-by-keyword way todoKeywords/doneKeywords already do', () => {
  const doc = parseOrg('#+TODO: TODO(t) | DONE(d!)\n#+TODO: TODO(t) WAIT(w@) | DONE(d!)\n* Something\n');
  const seq = resolveTodoSequence(doc);
  // The second line's non-empty todo-part DOES replace the first line's (real org semantics -- a later line's
  // non-empty part wins outright, it isn't merged item-by-item), so WAIT is now part of the sequence too
  assert.deepEqual(seq.todoKeywords, ['TODO', 'WAIT']);
  assert.deepEqual(seq.keySpecs, { TODO: 't', WAIT: 'w', DONE: 'd' });
  assert.deepEqual(seq.logSpecs, { DONE: '!', WAIT: '@' });
});

test('a keyword\u2019s spec from an EARLIER line survives when a later line doesn\u2019t redefine that same keyword at all', () => {
  const doc = parseOrg('#+TODO: TODO(t) | DONE(d!)\n#+TODO: TODO(x) | DONE(d)\n* Something\n');
  const seq = resolveTodoSequence(doc);
  assert.equal(seq.keySpecs.TODO, 'x'); // later line's own spec for TODO wins
  // The later line's "DONE(d)" token has no logSpec of its own to override with -- the earlier
  // line's "!" for DONE is correctly preserved, not silently cleared just because DONE was
  // mentioned again on a later line without its own logSpec.
  assert.equal(seq.logSpecs.DONE, '!');
});

test('the default global fallback sequence has empty keySpecs/logSpecs', () => {
  assert.deepEqual(DEFAULT_SEQUENCE.keySpecs, {});
  assert.deepEqual(DEFAULT_SEQUENCE.logSpecs, {});
});
