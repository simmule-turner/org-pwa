import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShowInheritedTags, parseAgendaUseTagInheritance, showsInheritedTags, knowsInheritedTags } from '../src/tag-inheritance.js';

// [show, use, view, shown] -- each row evaluated by Emacs 29.3 with org-agenda.el's test at the row builders
const ORACLE = [
  ['t', 't', 'agenda', true],
  ['t', 't', 'todo', true],
  ['t', 't', 'search', true],
  ['t', 'nil', 'agenda', false],
  ['t', 'nil', 'todo', false],
  ['t', 'nil', 'search', false],
  ['t', '(todo)', 'agenda', false],
  ['t', '(todo)', 'todo', true],
  ['t', '(todo)', 'search', false],
  ['t', '(agenda)', 'agenda', true],
  ['t', '(agenda)', 'todo', false],
  ['t', '(agenda)', 'search', false],
  ['t', '(todo search agenda)', 'agenda', true],
  ['t', '(todo search agenda)', 'todo', true],
  ['t', '(todo search agenda)', 'search', true],
  ['nil', 't', 'agenda', false],
  ['nil', 't', 'todo', false],
  ['nil', 't', 'search', false],
  ['nil', 'nil', 'agenda', false],
  ['nil', 'nil', 'todo', false],
  ['nil', 'nil', 'search', false],
  ['nil', '(todo)', 'agenda', false],
  ['nil', '(todo)', 'todo', false],
  ['nil', '(todo)', 'search', false],
  ['nil', '(agenda)', 'agenda', false],
  ['nil', '(agenda)', 'todo', false],
  ['nil', '(agenda)', 'search', false],
  ['nil', '(todo search agenda)', 'agenda', false],
  ['nil', '(todo search agenda)', 'todo', false],
  ['nil', '(todo search agenda)', 'search', false],
  ['always', 't', 'agenda', true],
  ['always', 't', 'todo', true],
  ['always', 't', 'search', true],
  ['always', 'nil', 'agenda', true],
  ['always', 'nil', 'todo', true],
  ['always', 'nil', 'search', true],
  ['always', '(todo)', 'agenda', true],
  ['always', '(todo)', 'todo', true],
  ['always', '(todo)', 'search', true],
  ['always', '(agenda)', 'agenda', true],
  ['always', '(agenda)', 'todo', true],
  ['always', '(agenda)', 'search', true],
  ['always', '(todo search agenda)', 'agenda', true],
  ['always', '(todo search agenda)', 'todo', true],
  ['always', '(todo search agenda)', 'search', true],
  ['(todo)', 't', 'agenda', false],
  ['(todo)', 't', 'todo', true],
  ['(todo)', 't', 'search', false],
  ['(todo)', 'nil', 'agenda', false],
  ['(todo)', 'nil', 'todo', true],
  ['(todo)', 'nil', 'search', false],
  ['(todo)', '(todo)', 'agenda', false],
  ['(todo)', '(todo)', 'todo', true],
  ['(todo)', '(todo)', 'search', false],
  ['(todo)', '(agenda)', 'agenda', false],
  ['(todo)', '(agenda)', 'todo', true],
  ['(todo)', '(agenda)', 'search', false],
  ['(todo)', '(todo search agenda)', 'agenda', false],
  ['(todo)', '(todo search agenda)', 'todo', true],
  ['(todo)', '(todo search agenda)', 'search', false],
  ['(agenda search)', 't', 'agenda', true],
  ['(agenda search)', 't', 'todo', false],
  ['(agenda search)', 't', 'search', true],
  ['(agenda search)', 'nil', 'agenda', true],
  ['(agenda search)', 'nil', 'todo', false],
  ['(agenda search)', 'nil', 'search', true],
  ['(agenda search)', '(todo)', 'agenda', true],
  ['(agenda search)', '(todo)', 'todo', false],
  ['(agenda search)', '(todo)', 'search', true],
  ['(agenda search)', '(agenda)', 'agenda', true],
  ['(agenda search)', '(agenda)', 'todo', false],
  ['(agenda search)', '(agenda)', 'search', true],
  ['(agenda search)', '(todo search agenda)', 'agenda', true],
  ['(agenda search)', '(todo search agenda)', 'todo', false],
  ['(agenda search)', '(todo search agenda)', 'search', true],
];

test('showsInheritedTags agrees with Emacs for every show/use/view combination', () => {
  for (const [show, use, view, shown] of ORACLE) {
    const got = showsInheritedTags(/** @type {any} */ (view), parseShowInheritedTags(show), parseAgendaUseTagInheritance(use));
    assert.equal(got, shown, `show=${show} use=${use} view=${view}`);
  }
});

test('the filter sees inherited tags when always, or when the use variable covers the view', () => {
  const use = parseAgendaUseTagInheritance('(todo)');
  assert.equal(knowsInheritedTags('todo', parseShowInheritedTags('t'), use), true);
  assert.equal(knowsInheritedTags('agenda', parseShowInheritedTags('t'), use), false);
  assert.equal(knowsInheritedTags('agenda', parseShowInheritedTags('always'), use), true);
});

test('values Org would not understand read as the default', () => {
  assert.equal(parseShowInheritedTags('maybe').kind, 't');
  assert.equal(parseShowInheritedTags("'(todo . agenda)").kind, 't');
  assert.deepEqual([...parseShowInheritedTags("'(todo bogus)").views], ['todo']);
  assert.equal(parseAgendaUseTagInheritance(undefined).views.size, 3);
});
