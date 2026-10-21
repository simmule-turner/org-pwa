import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { applyStartupVisibility, captureFolds, restoreFolds } from '../src/fold-state.js';

const open = (text) => {
  const doc = parseOrg(text);
  applyStartupVisibility(doc, { visibility: 'overview' }, 'archived');
  return doc;
};

test('folds follow headings by title path after the text is re-read', () => {
  const doc = open('* A\n** A1\n* B\n** B1\n** B1\n');
  doc.children[1].collapsed = false; // B opened
  doc.children[1].children[1].collapsed = false; // the second B1
  const folds = captureFolds(doc);
  const again = open('* A\n** A1 \n* B\n** B1\n** B1\n* New\n');
  restoreFolds(again, folds);
  assert.equal(again.children[1].collapsed, false);
  assert.equal(again.children[1].children[0].collapsed, true);
  assert.equal(again.children[1].children[1].collapsed, false);
  assert.equal(again.children[2].collapsed, true); // a new heading keeps the startup state
});

test('a renamed heading falls back to the startup visibility', () => {
  const doc = open('* A\n** A1\n');
  doc.children[0].collapsed = false;
  const again = open('* Renamed\n** A1\n');
  restoreFolds(again, captureFolds(doc));
  assert.equal(again.children[0].collapsed, true);
});
