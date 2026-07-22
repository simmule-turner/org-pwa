import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import {
  countCheckboxes,
  updateHeadingCheckboxCookie,
  updateCheckboxCookiesUpward,
} from '../src/checkbox-cookie.js';

// ---- countCheckboxes -------------------------------------------------

test('countCheckboxes counts a heading\'s own direct checklist', () => {
  const doc = parseOrg(['* Groceries', '- [X] Apples', '- [ ] Bananas', '- [X] Bread'].join('\n'));
  const result = countCheckboxes(doc.children[0]);
  assert.deepEqual(result, { total: 3, checked: 2 });
});

test('countCheckboxes recurses through descendant headings too (real org default: hierarchical)', () => {
  const doc = parseOrg(
    ['* Project', '- [X] top-level task', '** Sub A', '- [X] a1', '- [ ] a2', '** Sub B', '- [X] b1'].join('\n')
  );
  const result = countCheckboxes(doc.children[0]);
  assert.deepEqual(result, { total: 4, checked: 3 });
});

test('countCheckboxes recurses into nested sub-lists within one heading', () => {
  const doc = parseOrg(['* Notes', '- [ ] parent item', '  - [X] nested item'].join('\n'));
  const result = countCheckboxes(doc.children[0]);
  assert.deepEqual(result, { total: 2, checked: 1 });
});

test('countCheckboxes returns zero for a heading with no checkboxes at all', () => {
  const doc = parseOrg(['* Notes', 'Just a paragraph, no checkboxes.'].join('\n'));
  assert.deepEqual(countCheckboxes(doc.children[0]), { total: 0, checked: 0 });
});

// ---- updateHeadingCheckboxCookie ---------------------------------------

test('THE REAL-FILE CASE: a blank-number cookie ([/11], no leading number) gets filled in correctly', () => {
  // Exact shape from the user's actual file: "Grocery list [/11]"
  const lines = ['* Grocery list [/11]'];
  for (let i = 0; i < 11; i++) lines.push('- [ ] item ' + i);
  lines[3] = '- [X] item 2'; // check off item index 2
  lines[7] = '- [X] item 6';
  const doc = parseOrg(lines.join('\n'));
  const heading = doc.children[0];

  const changed = updateHeadingCheckboxCookie(heading);
  assert.equal(changed, true);
  assert.equal(heading.title, 'Grocery list [2/11]');
});

test('updates a fully-blank [/] cookie once computed', () => {
  const doc = parseOrg(['* Tasks [/]', '- [X] a', '- [ ] b'].join('\n'));
  updateHeadingCheckboxCookie(doc.children[0]);
  assert.equal(doc.children[0].title, 'Tasks [1/2]');
});

test('updates a percentage-style cookie, rounding to the nearest whole percent', () => {
  const doc = parseOrg(['* Tasks [0%]', '- [X] a', '- [ ] b', '- [ ] c'].join('\n'));
  updateHeadingCheckboxCookie(doc.children[0]);
  assert.equal(doc.children[0].title, 'Tasks [33%]');
});

test('percentage cookie with zero checkboxes shows 0%, not NaN or a crash', () => {
  const doc = parseOrg(['* Tasks [0%]', 'No checkboxes here.'].join('\n'));
  updateHeadingCheckboxCookie(doc.children[0]);
  assert.equal(doc.children[0].title, 'Tasks [0%]');
});

test('returns false and leaves the title untouched when there is no cookie at all', () => {
  const doc = parseOrg(['* Tasks', '- [X] a'].join('\n'));
  const changed = updateHeadingCheckboxCookie(doc.children[0]);
  assert.equal(changed, false);
  assert.equal(doc.children[0].title, 'Tasks');
});

test('returns false when the cookie is already correct (no unnecessary title churn)', () => {
  const doc = parseOrg(['* Tasks [1/2]', '- [X] a', '- [ ] b'].join('\n'));
  const changed = updateHeadingCheckboxCookie(doc.children[0]);
  assert.equal(changed, false);
});

test('the cookie survives serialize -> reparse correctly', () => {
  const doc = parseOrg(['* Tasks [/2]', '- [X] a', '- [ ] b'].join('\n'));
  updateHeadingCheckboxCookie(doc.children[0]);
  const doc2 = parseOrg(serializeOrg(doc));
  assert.equal(doc2.children[0].title, 'Tasks [1/2]');
});

// ---- updateCheckboxCookiesUpward ---------------------------------------

test('updates the cookie on both the owning heading and an ancestor with its own (recursive) cookie', () => {
  const doc = parseOrg(
    ['* Project [/]', '** Sub A [/]', '- [X] a1', '- [ ] a2', '** Sub B', '- [X] b1'].join('\n')
  );
  const subA = doc.children[0].children[0];
  const changed = updateCheckboxCookiesUpward(doc, subA);

  assert.equal(changed, true);
  assert.equal(subA.title, 'Sub A [1/2]');
  assert.equal(doc.children[0].title, 'Project [2/3]'); // recursive: a1+a2+b1 = 3, checked a1+b1 = 2
});

test('a heading with no cookie anywhere in its ancestor chain is simply a no-op, not an error', () => {
  const doc = parseOrg(['* Project', '** Sub A', '- [X] a1'].join('\n'));
  const subA = doc.children[0].children[0];
  const changed = updateCheckboxCookiesUpward(doc, subA);
  assert.equal(changed, false);
});

test('a top-level heading with a cookie and no ancestors updates correctly', () => {
  const doc = parseOrg(['* Tasks [/]', '- [X] a', '- [X] b'].join('\n'));
  const changed = updateCheckboxCookiesUpward(doc, doc.children[0]);
  assert.equal(changed, true);
  assert.equal(doc.children[0].title, 'Tasks [2/2]');
});
