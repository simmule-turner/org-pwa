import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { parseEffortValues, parseGlobalProperties, getAllowedEffortValues, DEFAULT_EFFORT_FILTER_VALUES } from '../src/effort-values.js';

test('parseEffortValues: whitespace-separated, in order, de-duplicated', () => {
  assert.deepEqual(parseEffortValues('0 0:10 0:30  1:00\n2:00 0:10'), ['0', '0:10', '0:30', '1:00', '2:00']);
});

test('parseEffortValues: any org-duration form is fine; anything else is skipped so every offered value is usable', () => {
  assert.deepEqual(parseEffortValues('30min 2h 1d bogus 1:30 soon'), ['30min', '2h', '1d', '1:30']);
  assert.deepEqual(parseEffortValues(''), []);
  assert.deepEqual(parseEffortValues(null), []);
});

test('parseGlobalProperties: NAME: value entries, case-insensitive names, first one wins', () => {
  const p = parseGlobalProperties('Effort_ALL: 0:10 0:30; OTHER: x y ; effort_all: 9:00');
  assert.equal(p.effort_all, '0:10 0:30');
  assert.equal(p.other, 'x y');
  assert.deepEqual(parseGlobalProperties(''), {});
  assert.deepEqual(parseGlobalProperties('no colon here'), {});
});

const doc = (text) => parseOrg(text);

test('nothing defined -> no list at all (the prompt stays plain free text)', () => {
  const d = doc('* A\n');
  assert.deepEqual(getAllowedEffortValues({ doc: d, heading: d.children[0] }), []);
});

test('the file-wide #+PROPERTY: Effort_ALL line', () => {
  const d = doc('#+PROPERTY: Effort_ALL 0:15 0:30 1:00\n* A\n');
  assert.deepEqual(getAllowedEffortValues({ doc: d, heading: d.children[0] }), ['0:15', '0:30', '1:00']);
  assert.deepEqual(getAllowedEffortValues({ doc: d }), ['0:15', '0:30', '1:00'], 'and with no heading at all');
});

test('the property name is matched case-insensitively, and other #+PROPERTY lines are ignored', () => {
  const d = doc('#+PROPERTY: Other x\n#+PROPERTY: effort_all 1:00 2:00\n* A\n');
  assert.deepEqual(getAllowedEffortValues({ doc: d }), ['1:00', '2:00']);
});

test('the global setting applies when nothing more specific does', () => {
  const d = doc('* A\n');
  assert.deepEqual(getAllowedEffortValues({ doc: d, heading: d.children[0], globalProperties: 'Effort_ALL: 0:10 1:00' }), ['0:10', '1:00']);
});

test('precedence: heading > ancestor > file > global', () => {
  const d = doc(
    ['#+PROPERTY: Effort_ALL 1:00', '* Parent', ':PROPERTIES:', ':Effort_ALL: 2:00 3:00', ':END:', '** Child', '*** Own', ':PROPERTIES:', ':Effort_ALL: 9:00', ':END:', '** Plain', ''].join('\n')
  );
  const parent = d.children[0];
  const [child, plain] = parent.children;
  const own = child.children[0];
  const g = 'Effort_ALL: 5:00';
  assert.deepEqual(getAllowedEffortValues({ doc: d, heading: own, globalProperties: g }), ['9:00'], "the heading's own");
  assert.deepEqual(getAllowedEffortValues({ doc: d, heading: child, globalProperties: g }), ['2:00', '3:00'], "inherited from the parent");
  assert.deepEqual(getAllowedEffortValues({ doc: d, heading: plain, globalProperties: g }), ['2:00', '3:00']);
  const noProps = doc('#+PROPERTY: Effort_ALL 1:00\n* A\n');
  assert.deepEqual(getAllowedEffortValues({ doc: noProps, heading: noProps.children[0], globalProperties: g }), ['1:00'], 'file beats global');
});

test('the NEAREST ancestor wins', () => {
  const d = doc(['* Top', ':PROPERTIES:', ':Effort_ALL: 8:00', ':END:', '** Mid', ':PROPERTIES:', ':Effort_ALL: 4:00', ':END:', '*** Leaf', ''].join('\n'));
  assert.deepEqual(getAllowedEffortValues({ doc: d, heading: d.children[0].children[0].children[0] }), ['4:00']);
});

test('a source with no usable value falls through to the next rather than hiding it', () => {
  const d = doc(['#+PROPERTY: Effort_ALL 1:00', '* A', ':PROPERTIES:', ':Effort_ALL: nonsense words', ':END:', ''].join('\n'));
  assert.deepEqual(getAllowedEffortValues({ doc: d, heading: d.children[0] }), ['1:00']);
});

test('the agenda filter default is the set org-agenda-filter-by-effort itself uses', () => {
  assert.deepEqual(DEFAULT_EFFORT_FILTER_VALUES, ['0', '0:10', '0:30', '1:00', '2:00', '3:00', '4:00', '5:00', '6:00', '7:00']);
});
