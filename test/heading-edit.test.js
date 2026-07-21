import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import {
  createHeading,
  renameHeading,
  insertTopLevelHeading,
  insertChildHeading,
  removeHeading,
} from '../src/heading-edit.js';

test('createHeading builds a complete, valid heading with sane defaults', () => {
  const h = createHeading({ level: 2, title: 'Hello' });
  assert.equal(h.type, 'heading');
  assert.equal(h.level, 2);
  assert.equal(h.title, 'Hello');
  assert.equal(h.todo, null);
  assert.equal(h.priority, null);
  assert.deepEqual(h.tags, []);
  assert.deepEqual(h.planning, { scheduled: null, deadline: null, closed: null });
  assert.deepEqual(h.properties, {});
  assert.deepEqual(h.propertyOrder, []);
  assert.deepEqual(h.bodyLines, []);
  assert.deepEqual(h.body, []);
  assert.equal(h.collapsed, false);
  assert.deepEqual(h.children, []);
});

test('createHeading throws on an invalid level', () => {
  assert.throws(() => createHeading({ level: 0 }));
  assert.throws(() => createHeading({ level: 1.5 }));
});

test('a freshly created heading round-trips through serialize/parse', () => {
  const doc = parseOrg('');
  const h = insertTopLevelHeading(doc, { title: 'Buy milk', todo: 'TODO' });
  const text = serializeOrg(doc);
  assert.match(text, /^\* TODO Buy milk$/m);
  const doc2 = parseOrg(text);
  assert.equal(doc2.children[0].title, 'Buy milk');
  assert.equal(doc2.children[0].todo, 'TODO');
});

test('renameHeading strips newlines and trims whitespace', () => {
  const h = createHeading({ level: 1, title: 'old' });
  const result = renameHeading(h, '  New title\nwith a newline  ');
  assert.equal(result, 'New title with a newline');
  assert.equal(h.title, 'New title with a newline');
});

test('insertTopLevelHeading appends at level 1', () => {
  const doc = parseOrg('* Existing');
  const h = insertTopLevelHeading(doc, { title: 'New one' });
  assert.equal(doc.children.length, 2);
  assert.equal(doc.children[1], h);
  assert.equal(h.level, 1);
});

test('insertChildHeading is one level deeper and un-collapses the parent', () => {
  const doc = parseOrg('* Parent');
  const parent = doc.children[0];
  parent.collapsed = true;

  const child = insertChildHeading(parent, { title: 'Child' });
  assert.equal(child.level, 2);
  assert.equal(parent.children[0], child);
  assert.equal(parent.collapsed, false);
});

test('removeHeading removes a top-level heading', () => {
  const doc = parseOrg('* A\n* B');
  const b = doc.children[1];
  const removed = removeHeading(doc, b);
  assert.equal(removed, true);
  assert.equal(doc.children.length, 1);
  assert.equal(doc.children[0].title, 'A');
});

test('removeHeading removes a nested heading', () => {
  const doc = parseOrg('* Parent\n** Child');
  const child = doc.children[0].children[0];
  removeHeading(doc, child);
  assert.equal(doc.children[0].children.length, 0);
});

test('removeHeading returns false for a heading not in the doc', () => {
  const doc = parseOrg('* A');
  const orphan = createHeading({ level: 1, title: 'Not in doc' });
  assert.equal(removeHeading(doc, orphan), false);
});

test('a newly inserted-then-removed heading leaves no trace after serialize', () => {
  const doc = parseOrg('* Existing');
  const h = insertTopLevelHeading(doc, { title: 'Oops' });
  removeHeading(doc, h);
  const text = serializeOrg(doc);
  assert.equal(text, '* Existing');
});
