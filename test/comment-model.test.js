import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { isCommentedHeading } from '../src/comment-model.js';

const commented = (line) => isCommentedHeading(parseOrg(line).children[0]);

test('COMMENT after the stars, and after the TODO keyword, marks a commented heading, as in Emacs', () => {
  assert.equal(commented('** COMMENT draft'), true);
  assert.equal(commented('** TODO COMMENT draft'), true);
  assert.equal(commented('** DONE COMMENT find a FOSS filemanager'), true);
  assert.equal(commented('** COMMENT'), true);
});

test('COMMENT before a keyword also comments the heading (the keyword is then part of the title)', () => {
  assert.equal(commented('** COMMENT TODO draft'), true);
});

test('a title starting with "# " is an ordinary heading, as in Emacs (only body lines starting with "# " are comments)', () => {
  assert.equal(commented('** # draft'), false);
  assert.equal(commented('** TODO # something'), false);
  assert.equal(commented('** #'), false);
});

test('COMMENT must be a whole word at the start of the title', () => {
  assert.equal(commented('** COMMENTARY on the draft'), false);
  assert.equal(commented('** Not a COMMENT'), false);
  assert.equal(commented('** comment lowercase'), false);
  assert.equal(commented('** Just a normal heading'), false);
});

test('an empty title is not commented', () => {
  assert.equal(commented('** '), false);
});
