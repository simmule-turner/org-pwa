
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

test('parses a basic heading with TODO, priority, and tags', () => {
  const doc = parseOrg('*** TODO [#A] Write report :work:urgent:');
  const h = doc.children[0];
  assert.equal(h.level, 3);
  assert.equal(h.todo, 'TODO');
  assert.equal(h.priority, 'A');
  assert.equal(h.title, 'Write report');
  assert.deepEqual(h.tags, ['work', 'urgent']);
});

test('parses nested headings into a tree', () => {
  const text = [
    '* Top',
    '** Child A',
    '** Child B',
    '*** Grandchild',
  ].join('\n');
  const doc = parseOrg(text);
  assert.equal(doc.children.length, 1);
  const top = doc.children[0];
  assert.equal(top.children.length, 2);
  assert.equal(top.children[1].children[0].title, 'Grandchild');
});

test('parses planning line and property drawer', () => {
  const text = [
    '* TODO Ship it',
    'SCHEDULED: <2026-07-21 Tue>',
    ':PROPERTIES:',
    ':ID: abc-123',
    ':EFFORT: 2h',
    ':END:',
    'Some body text.',
  ].join('\n');
  const doc = parseOrg(text);
  const h = doc.children[0];
  assert.equal(h.planning.scheduled, '<2026-07-21 Tue>');
  assert.equal(h.properties.ID, 'abc-123');
  assert.equal(h.properties.EFFORT, '2h');
  assert.deepEqual(h.propertyOrder, ['ID', 'EFFORT']);
  assert.deepEqual(h.bodyLines, ['Some body text.']);
});

test('honors a #+TODO: line for custom keyword sequences', () => {
  const text = [
    '#+TODO: NEXT WAITING | DONE CANCELLED',
    '* WAITING On review',
    '* CANCELLED Nope',
  ].join('\n');
  const doc = parseOrg(text);
  assert.equal(doc.children[0].todo, 'WAITING');
  assert.equal(doc.children[1].todo, 'CANCELLED');
});

test('document keywords are captured', () => {
  const text = ['#+title: The glories of Org', '#+author: A. Org Writer', '* Heading'].join('\n');
  const doc = parseOrg(text);
  assert.deepEqual(doc.keywords, [
    { key: 'title', value: 'The glories of Org' },
    { key: 'author', value: 'A. Org Writer' },
  ]);
});

test('round-trips structure through parse -> serialize -> parse', () => {
  const text = [
    '#+title: Test doc',
    '* TODO [#A] Write report :work:urgent:',
    'SCHEDULED: <2026-07-21 Tue>',
    ':PROPERTIES:',
    ':ID: abc-123',
    ':END:',
    'Body paragraph one.',
    '** DONE Sub item :done:',
    'CLOSED: <2026-07-19 Sun>',
    'Some notes here.',
  ].join('\n');

  const doc1 = parseOrg(text);
  const text2 = serializeOrg(doc1);
  const doc2 = parseOrg(text2);

  assert.deepEqual(doc1, doc2);
});

test('attaches parsed body content (list) under a heading', () => {
  const text = ['* Shopping', '- Milk', '- Eggs'].join('\n');
  const doc = parseOrg(text);
  const heading = doc.children[0];
  assert.equal(heading.body.length, 1);
  assert.equal(heading.body[0].type, 'list');
  assert.equal(heading.body[0].items[0].text, 'Milk');
});

test('body content before the first heading attaches to the document node', () => {
  const text = ['#+title: Doc', '', 'Intro paragraph.', '', '* First heading'].join('\n');
  const doc = parseOrg(text);
  assert.equal(doc.body.length, 1);
  assert.equal(doc.body[0].type, 'paragraph');
  assert.deepEqual(doc.body[0].lines, ['Intro paragraph.']);
});

test('round-trip still holds with list/table/block content in the body', () => {
  const text = [
    '* Notes',
    '- one',
    '- two',
    '',
    '| a | b |',
    '|---+---|',
    '| 1 | 2 |',
    '',
    '#+begin_src js',
    'console.log(1)',
    '#+end_src',
  ].join('\n');
  const doc1 = parseOrg(text);
  const doc2 = parseOrg(serializeOrg(doc1));
  assert.deepEqual(doc1, doc2);
});

test('regression: content before the first heading round-trips (was silently dropped on serialize)', () => {
  const text = ['#+title: Doc', '', 'Some preamble text.', '', '* First heading'].join('\n');
  const doc1 = parseOrg(text);
  const text2 = serializeOrg(doc1);
  assert.match(text2, /Some preamble text\./);
  const doc2 = parseOrg(text2);
  assert.deepEqual(doc1, doc2);
});

test('parses the example doc from the org-mode primer without throwing', () => {
  const text = [
    '#+title: The glories of Org',
    '#+author: A. Org Writer',
    '* Welcome to Org-mode',
    '** Sub-heading',
    'Each extra ~*~ increases the depth by one level.',
    '* TODO Promulgate Org to the world',
    '** TODO Create a quickstart guide',
  ].join('\n');
  const doc = parseOrg(text);
  assert.equal(doc.children.length, 2);
  assert.equal(doc.children[0].children[0].title, 'Sub-heading');
  assert.equal(doc.children[1].todo, 'TODO');
});
