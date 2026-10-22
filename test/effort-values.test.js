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

// Effort_ALL+ -- every expected list below is what Emacs 29.3's org-property-get-allowed-values answered for the same text.
const allowed = (text, title, globalProperties = '') => {
  const d = doc(text);
  const find = (nodes) => {
    for (const n of nodes) {
      if (n.title === title) return n;
      const f = find(n.children || []);
      if (f) return f;
    }
    return null;
  };
  return getAllowedEffortValues({ doc: d, heading: find(d.children), globalProperties });
};
const P = (name, value) => `:PROPERTIES:\n:${name}: ${value}\n:END:\n`;

test('Effort_ALL+ appends to the Effort_ALL of an outer level, outer first', () => {
  const text = `* A\n${P('Effort_ALL', '1:00 2:00')}** B\n${P('Effort_ALL+', '3:00')}*** C\n${P('Effort_ALL+', '4:00 5:00')}`;
  assert.deepEqual(allowed(text, 'A'), ['1:00', '2:00']);
  assert.deepEqual(allowed(text, 'B'), ['1:00', '2:00', '3:00']);
  assert.deepEqual(allowed(text, 'C'), ['1:00', '2:00', '3:00', '4:00', '5:00']);
});

test('the file’s #+PROPERTY lines are one level: Effort_ALL and Effort_ALL+ together, then the headings’ +', () => {
  const text = `#+PROPERTY: Effort_ALL 0 0:10\n#+PROPERTY: Effort_ALL+ 0:20\n* D\n${P('Effort_ALL+', '9:00')}** E\n`;
  assert.deepEqual(allowed(text, 'D'), ['0', '0:10', '0:20', '9:00']);
  assert.deepEqual(allowed(text, 'E'), ['0', '0:10', '0:20', '9:00']);
});

test('a nearer Effort_ALL drops what lies outside it, including the + values there', () => {
  assert.deepEqual(allowed(`* A\n${P('Effort_ALL+', '7:00')}** B\n${P('Effort_ALL', '1:00')}*** C\n`, 'C'), ['1:00']);
  const text = `* A\n:PROPERTIES:\n:Effort_ALL: 1:00\n:Effort_ALL+: 7:00\n:END:\n** B\n${P('Effort_ALL', '2:00')}*** C\n${P('Effort_ALL+', '3:00')}`;
  assert.deepEqual(allowed(text, 'A'), ['1:00', '7:00']);
  assert.deepEqual(allowed(text, 'B'), ['2:00']);
  assert.deepEqual(allowed(text, 'C'), ['2:00', '3:00']);
});

test('Effort_ALL+ alone is a list, and at one level the + follows the base whichever line comes first', () => {
  assert.deepEqual(allowed(`* A\n${P('Effort_ALL+', '7:00')}`, 'A'), ['7:00']);
  assert.deepEqual(allowed('* A\n:PROPERTIES:\n:Effort_ALL+: 2:00\n:Effort_ALL: 1:00\n:END:\n', 'A'), ['1:00', '2:00']);
});

test('the global setting is the base only when the file says nothing about Effort_ALL', () => {
  const global = 'Effort_ALL: 0:05 0:15';
  assert.deepEqual(allowed(`* A\n${P('Effort_ALL+', '9:00')}`, 'A', global), ['0:05', '0:15', '9:00']);
  assert.deepEqual(allowed('#+PROPERTY: Effort_ALL+ 0:20\n* A\n', 'A', global), ['0:20']);
});
