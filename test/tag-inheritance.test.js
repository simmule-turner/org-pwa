import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { parseLispTagList, parseTagInheritance, effectiveTagsOf } from '../src/tag-inheritance.js';
import { getUseTagInheritance } from '../src/local-variables.js';
import { searchDocument } from '../src/search.js';

const tree = () => {
  const d = parseOrg('* Parent :work:home:proj_x:\n** Child :own:\n*** Grandchild\n');
  const parent = d.children[0];
  const child = parent.children[0];
  return { d, parent, child, grand: child.children[0] };
};

test('tag inheritance: t and nil, with nothing excluded, are plain booleans', () => {
  assert.equal(parseTagInheritance(undefined, undefined), true);
  assert.equal(parseTagInheritance('t', 'nil'), true);
  assert.equal(parseTagInheritance('nil', '("work")'), false);
});

test('tag inheritance: a list lets only those tags through, and a quoted regexp only the tags it matches', () => {
  const { grand, child, parent } = tree();
  assert.deepEqual(effectiveTagsOf(grand, [parent, child], parseTagInheritance('("work")', undefined)), ['work']);
  assert.deepEqual(effectiveTagsOf(grand, [parent, child], parseTagInheritance('"^proj_"', undefined)), ['proj_x']);
});

test('tag inheritance: org-tags-exclude-from-inheritance keeps those tags from passing down, even with t', () => {
  const { child, parent } = tree();
  assert.deepEqual(effectiveTagsOf(child, [parent], parseTagInheritance('t', '("home" proj_x)')), ['own', 'work']);
});

test('tag inheritance: the local variables feed tag: searches (a list, a regexp and an exclusion)', () => {
  const { d } = tree();
  const hits = (vars) => searchDocument(d, 'tag:work', { useTagInheritance: getUseTagInheritance(vars) }).map((r) => r.heading.title);
  assert.deepEqual(hits({}), ['Parent', 'Child', 'Grandchild']);
  assert.deepEqual(hits({ 'org-use-tag-inheritance': 'nil' }), ['Parent']);
  assert.deepEqual(hits({ 'org-use-tag-inheritance': '("home")' }), ['Parent']);
  assert.deepEqual(hits({ 'org-tags-exclude-from-inheritance': '("work")' }), ['Parent']);
});

test('tag inheritance: reads quoted, unquoted and quote-prefixed lists', () => {
  assert.deepEqual(parseLispTagList('("a" "b c")'), ['a', 'b c']);
  assert.deepEqual(parseLispTagList("'(a b)"), ['a', 'b']);
  assert.equal(parseLispTagList('t'), null);
});

test('tag inheritance: the exclude list can be typed as plain words, as in a settings box', () => {
  const { child, parent } = tree();
  assert.deepEqual(effectiveTagsOf(child, [parent], parseTagInheritance('t', 'home, proj_x')), ['own', 'work']);
});

import { buildAncestorIndex, inheritedOnly } from '../src/tag-inheritance.js';

test('tag inheritance: a heading shows only the ancestors\u2019 tags it does not already carry, each once, as the policy allows', () => {
  const d = parseOrg('* P :a:b:\n** C :b:c:\n*** G\n');
  const index = buildAncestorIndex([d]);
  const g = d.children[0].children[0].children[0];
  const c = d.children[0].children[0];
  assert.deepEqual(inheritedOnly(c, index.get(c), true), ['a']);
  assert.deepEqual(inheritedOnly(g, index.get(g), true), ['a', 'b', 'c']);
  assert.deepEqual(inheritedOnly(g, index.get(g), false), []);
  assert.deepEqual(inheritedOnly(g, index.get(g), parseTagInheritance('("c")', undefined)), ['c']);
});
