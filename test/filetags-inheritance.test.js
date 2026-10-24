import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { searchDocument } from '../src/search.js';
import { buildAncestorIndex, buildFileTagsIndex, inheritedOnly } from '../src/tag-inheritance.js';

const doc = parseOrg('#+FILETAGS: :office:shared:\n* Plan :work:\n** Task one\n* Other :office:\n');

test('the Search panel tag: filter counts #+FILETAGS: tags as inherited', () => {
  const titles = searchDocument(doc, 'tag:office').map((r) => r.heading.title);
  assert.deepEqual(titles, ['Plan', 'Task one', 'Other']);
});

test('the Agenda tag chips see the file tags, after the heading’s own and its ancestors’', () => {
  const ancestors = buildAncestorIndex([doc]);
  const fileTags = buildFileTagsIndex([doc]);
  const task = doc.children[0].children[0];
  const top = ancestors.get(task)[0];
  assert.deepEqual(inheritedOnly(task, ancestors.get(task), true, fileTags.get(top)), ['work', 'office', 'shared']);
  const other = doc.children[1];
  assert.deepEqual(inheritedOnly(other, [], true, fileTags.get(other)), ['shared']);
});
