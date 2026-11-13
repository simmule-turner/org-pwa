import test from 'node:test';
import assert from 'node:assert/strict';
import { tagsOfTagAlist } from '../src/tag-alist.js';
import { suggestTags } from '../src/completion.js';

// The expected lists were taken from Emacs 29.3: the string names of org-tag-alist's entries, entries with a fast-selection key included,
// syntax words (:startgroup, (:startgroup), :newline) left out, each name once.
test('the tags of an org-tag-alist, as Emacs 29.3 reads it', () => {
  assert.deepEqual(tagsOfTagAlist('(("work" . ?w) "home" (:startgroup) "a" ("b" . ?b) (:endgroup) :newline "c")'), ['work', 'home', 'a', 'b', 'c']);
  assert.deepEqual(tagsOfTagAlist("'((\"x\" . ?x) \"y\" \"x\")"), ['x', 'y']);
  assert.deepEqual(tagsOfTagAlist('()'), []);
  assert.deepEqual(tagsOfTagAlist(undefined), []);
});

test('tags listed in org-tag-alist are offered even when no heading uses them', () => {
  assert.deepEqual(suggestTags({ docs: [], listed: ['home', 'work'] }), ['home', 'work']);
  assert.deepEqual(suggestTags({ docs: [], listed: ['home', 'work'], applied: ['home'], query: 'w' }), ['work']);
});
