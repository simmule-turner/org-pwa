import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLocalVariables,
  parseLispBoolean,
  parseLispNumber,
  getAgendaStartOnWeekday,
  getCycleOpenArchivedTrees,
  getAgendaSkipCommentTrees,
  getAgendaSkipArchivedTrees,
} from '../src/local-variables.js';

// ---- parseLocalVariables --------------------------------------------------

test('THE EXACT FORMAT FROM THE REQUEST parses correctly', () => {
  const text = [
    '* Some heading',
    'Some content.',
    '',
    '# Local Variables:',
    '# org-agenda-start-on-weekday: 0',
    '# org-cycle-open-archived-trees: t',
    '# End:',
  ].join('\n');
  assert.deepEqual(parseLocalVariables(text), {
    'org-agenda-start-on-weekday': '0',
    'org-cycle-open-archived-trees': 't',
  });
});

test('returns an empty object when there is no Local Variables block at all', () => {
  assert.deepEqual(parseLocalVariables('* A heading\nSome text.'), {});
  assert.deepEqual(parseLocalVariables(''), {});
  assert.deepEqual(parseLocalVariables(null), {});
});

test('returns an empty object for a Local Variables block with no End: line (malformed, not half-applied)', () => {
  const text = ['# Local Variables:', '# org-agenda-start-on-weekday: 0'].join('\n');
  assert.deepEqual(parseLocalVariables(text), {});
});

test('is tolerant of extra whitespace around the markers and values', () => {
  const text = ['#   Local Variables:  ', '#  org-agenda-start-on-weekday:   2  ', '#   End:  '].join('\n');
  assert.deepEqual(parseLocalVariables(text), { 'org-agenda-start-on-weekday': '2' });
});

test('is case-insensitive to the Local Variables: / End: markers themselves', () => {
  const text = ['# local variables:', '# org-agenda-start-on-weekday: 0', '# end:'].join('\n');
  assert.deepEqual(parseLocalVariables(text), { 'org-agenda-start-on-weekday': '0' });
});

test('skips a malformed line inside the block instead of throwing', () => {
  const text = [
    '# Local Variables:',
    '# org-agenda-start-on-weekday: 0',
    '# this line has no colon',
    '# org-cycle-open-archived-trees: t',
    '# End:',
  ].join('\n');
  assert.deepEqual(parseLocalVariables(text), {
    'org-agenda-start-on-weekday': '0',
    'org-cycle-open-archived-trees': 't',
  });
});

test('an arbitrary/future variable name is captured too, not just the two currently acted on', () => {
  const text = ['# Local Variables:', '# some-future-variable: whatever-value', '# End:'].join('\n');
  assert.deepEqual(parseLocalVariables(text), { 'some-future-variable': 'whatever-value' });
});

// ---- parseLispBoolean / parseLispNumber ----------------------------------

test('parseLispBoolean follows Lisp convention (t/nil), not JS truthiness', () => {
  assert.equal(parseLispBoolean('t'), true);
  assert.equal(parseLispBoolean('nil'), false);
  assert.equal(parseLispBoolean('T'), true); // case-insensitive
  assert.equal(parseLispBoolean('true'), false); // NOT a Lisp boolean -- falls back
  assert.equal(parseLispBoolean(undefined, true), true); // missing -> fallback
});

test('parseLispNumber parses a numeric string, falling back on garbage', () => {
  assert.equal(parseLispNumber('0'), 0);
  assert.equal(parseLispNumber('  3  '), 3);
  assert.equal(parseLispNumber('not-a-number', 42), 42);
  assert.equal(parseLispNumber(undefined, 7), 7);
});

// ---- getAgendaStartOnWeekday / getCycleOpenArchivedTrees -----------------

test('getAgendaStartOnWeekday defaults to 1 (Monday), matching real org\'s own default', () => {
  assert.equal(getAgendaStartOnWeekday({}), 1);
});

test('getAgendaStartOnWeekday reads the configured value', () => {
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '0' }), 0);
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '2' }), 2);
});

test('getAgendaStartOnWeekday falls back to Monday for an out-of-range value', () => {
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '9' }), 1);
  assert.equal(getAgendaStartOnWeekday({ 'org-agenda-start-on-weekday': '-1' }), 1);
});

test('getCycleOpenArchivedTrees defaults to false (nil/off), matching real org\'s own default', () => {
  assert.equal(getCycleOpenArchivedTrees({}), false);
});

test('getCycleOpenArchivedTrees reads t as true', () => {
  assert.equal(getCycleOpenArchivedTrees({ 'org-cycle-open-archived-trees': 't' }), true);
});

test('both getters are safe to call with undefined/null vars (e.g. before any file is loaded)', () => {
  assert.equal(getAgendaStartOnWeekday(undefined), 1);
  assert.equal(getAgendaStartOnWeekday(null), 1);
  assert.equal(getCycleOpenArchivedTrees(undefined), false);
  assert.equal(getCycleOpenArchivedTrees(null), false);
});

test('getAgendaSkipCommentTrees defaults to true (skip), matching real org\'s own default', () => {
  assert.equal(getAgendaSkipCommentTrees({}), true);
});

test('getAgendaSkipCommentTrees reads nil as false (include commented headings)', () => {
  assert.equal(getAgendaSkipCommentTrees({ 'org-agenda-skip-comment-trees': 'nil' }), false);
});

test('getAgendaSkipArchivedTrees defaults to true (skip), matching real org\'s own default', () => {
  assert.equal(getAgendaSkipArchivedTrees({}), true);
});

test('getAgendaSkipArchivedTrees reads nil as false (include archived headings)', () => {
  assert.equal(getAgendaSkipArchivedTrees({ 'org-agenda-skip-archived-trees': 'nil' }), false);
});

test('both new getters are safe with undefined/null vars', () => {
  assert.equal(getAgendaSkipCommentTrees(undefined), true);
  assert.equal(getAgendaSkipArchivedTrees(undefined), true);
});
