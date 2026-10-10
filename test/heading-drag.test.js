import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { dropClimbLimit, moveHeadingTo } from '../src/heading-edit.js';

const SRC = '* A\n** A1\n** A2\n* B\n** B1\n* C\n';
const find = (doc, title) => {
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.title === title) return n;
      const f = walk(n.children);
      if (f) return f;
    }
    return null;
  };
  return walk(doc.children);
};
const tidy = (t) => t.split('\n').filter((l) => l !== '').join('\n') + '\n';
const run = (title, target, position, climb) => {
  const doc = parseOrg(SRC);
  const ok = moveHeadingTo(doc, find(doc, title), find(doc, target), position, climb);
  return { ok, text: tidy(serializeOrg(doc)) };
};

test('drop before and after a sibling reorders with the subtree', () => {
  assert.equal(run('C', 'A', 'before').text, '* C\n* A\n** A1\n** A2\n* B\n** B1\n');
  assert.equal(run('A', 'B', 'after').text, '* B\n** B1\n* A\n** A1\n** A2\n* C\n');
});

test('drop into a heading makes it the last or first child and shifts the subtree levels', () => {
  assert.equal(run('B', 'A', 'lastChild').text, '* A\n** A1\n** A2\n** B\n*** B1\n* C\n');
  assert.equal(run('C', 'A', 'firstChild').text, '* A\n** C\n** A1\n** A2\n* B\n** B1\n');
});

test('a child lands at the target level when dropped beside a deeper heading', () => {
  assert.equal(run('C', 'A1', 'after').text, '* A\n** A1\n** C\n** A2\n* B\n** B1\n');
});

test('climbing after the last child lands after the ancestor, at its level', () => {
  const doc = parseOrg(SRC);
  assert.equal(dropClimbLimit(doc, find(doc, 'A2')), 1);
  assert.equal(dropClimbLimit(doc, find(doc, 'A1')), 0);
  assert.equal(run('C', 'A2', 'after', 1).text, '* A\n** A1\n** A2\n* C\n* B\n** B1\n');
  assert.equal(run('C', 'A1', 'after', 1).ok, false);
});

test('a heading cannot be dropped into its own subtree, or where it already is', () => {
  assert.equal(run('A', 'A1', 'lastChild').ok, false);
  assert.equal(run('A', 'A', 'after').ok, false);
  assert.equal(run('A', 'B', 'before').ok, false);
  assert.equal(run('B', 'A', 'after').ok, false);
  assert.equal(run('A', 'A1', 'lastChild').text, SRC);
});

test('a collapsed target opens when it receives a child', () => {
  const doc = parseOrg(SRC);
  const a = find(doc, 'A');
  a.collapsed = true;
  assert.equal(moveHeadingTo(doc, find(doc, 'C'), a, 'lastChild'), true);
  assert.equal(a.collapsed, false);
});

test('climbing ignores the heading being moved when it is the one that follows', () => {
  const doc = parseOrg('* A\n** A1\n** A2\n** X\n* B\n');
  const x = find(doc, 'X');
  assert.equal(dropClimbLimit(doc, find(doc, 'A2')), 0);
  assert.equal(dropClimbLimit(doc, find(doc, 'A2'), x), 1);
  assert.equal(moveHeadingTo(doc, x, find(doc, 'A2'), 'after', 1), true);
  assert.equal(tidy(serializeOrg(doc)), '* A\n** A1\n** A2\n* X\n* B\n');
});
