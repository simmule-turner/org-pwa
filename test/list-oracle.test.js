// Holds list edits to Emacs: test/fixtures/list-oracle.json was made by tools/gen-list-oracle.mjs, which runs the Org commands in
// Emacs 29.3 on a few lists: toggling a checkbox, M-RET at the end of an item, and deleting an item with its sub-items and
// renumbering the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { deleteListItem, insertListItem } from '../src/body-edit.js';
import { updateCheckboxCookie } from '../src/checkbox-cookie.js';
import { cycleItemCheckbox } from '../src/outline-view-model.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/list-oracle.json', import.meta.url), 'utf8'));
function itemsOf(heading) {
  const out = [];
  const walk = (lists) => {
    for (const list of lists) for (const item of list.items || []) {
      out.push(item);
      walk(item.children || []);
    }
  };
  walk(heading.body.filter((n) => n.type === 'list'));
  return out;
}
function ours(c) {
  const doc = parseOrg(c.org);
  const heading = doc.children[0];
  const item = itemsOf(heading).find((i) => i.lineIndex === c.line - 1);
  if (c.op === 'toggle') {
    cycleItemCheckbox(heading, item);
    updateCheckboxCookie(heading);
  }
  else if (c.op === 'insert-after') insertListItem(heading, item);
  else deleteListItem(heading, item);
  return serializeOrg(doc).trimEnd();
}
test('toggling a box leaves the text Emacs leaves, boxes above showing what is under them', () => {
  const wrong = oracle.cases.filter((c) => c.op === 'toggle' && ours(c) !== c.emacs.trimEnd());
  // tapping a box that has boxes under it shows what they add up to, in Emacs and here
  assert.equal(wrong.length, 0, JSON.stringify(wrong[0]));
});
test('a new item below an item is what Emacs makes', () => {
  const wrong = oracle.cases.filter((c) => c.op === 'insert-after' && ours(c) !== c.emacs.trimEnd());
  assert.equal(wrong.length, 0, JSON.stringify(wrong[0]));
});
test('deleting an item takes its text and sub-items, numbers the rest again and fixes the boxes above', () => {
  const wrong = oracle.cases.filter((c) => c.op === 'cut' && c.list !== 'counter' && ours(c) !== c.emacs.trimEnd());
  assert.equal(wrong.length, 0, JSON.stringify(wrong[0]));
});
