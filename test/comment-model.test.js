import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { isCommentedHeading } from '../src/comment-model.js';

test('THE EXACT REPORTED CASE: a DONE heading whose title starts with "# " is commented', () => {
  const doc = parseOrg('** DONE # find a FOSS filemanager for Android');
  assert.equal(isCommentedHeading(doc.children[0]), true);
});

test('THE OTHER REPORTED CASE: a plain heading whose title starts with "# " is commented', () => {
  const doc = parseOrg('** # [06/20 23:17]- fix documentation for ignore #, archive.');
  assert.equal(isCommentedHeading(doc.children[0]), true);
});

test('a heading whose title does NOT start with "#" is not commented', () => {
  const doc = parseOrg('** Just a normal heading');
  assert.equal(isCommentedHeading(doc.children[0]), false);
});

test('a title starting with "#" but with NO following whitespace is not commented, per the precise org-manual rule', () => {
  const doc = parseOrg('** #hashtag-like-thing not a comment');
  assert.equal(isCommentedHeading(doc.children[0]), false);
});

test('a title that is exactly "#" alone is commented', () => {
  const doc = parseOrg('** #');
  assert.equal(isCommentedHeading(doc.children[0]), true);
});

test('a "#" appearing later in the title (not at the start) does not make it commented', () => {
  const doc = parseOrg('** Fix the issue with # symbols');
  assert.equal(isCommentedHeading(doc.children[0]), false);
});

test('the TODO keyword and priority are already stripped from the title by the parser, so detection works regardless of TODO state', () => {
  const doc = parseOrg('** TODO # something to hide from the agenda');
  assert.equal(isCommentedHeading(doc.children[0]), true);
});

test('an empty title is not commented', () => {
  const doc = parseOrg('** ');
  assert.equal(isCommentedHeading(doc.children[0]), false);
});
