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

// ---- :COOKIE_DATA: property (checkbox/todo mode selection, recursive) ----

test('no :COOKIE_DATA: at all -- existing checkbox-only behavior is completely unchanged, even with a TODO child present', () => {
  const doc = parseOrg(['* Unchanged [/]', '- [X] a', '- [ ] b', '** TODO ignored (no COOKIE_DATA todo mode)'].join('\n'));
  updateHeadingCheckboxCookie(doc.children[0]);
  assert.equal(doc.children[0].title, 'Unchanged [1/2]');
});

test('THE FIX: :COOKIE_DATA: "checkbox" explicitly counts only checkboxes, ignoring TODO children -- resolves the "ambiguous" case the Org manual itself describes', () => {
  const doc = parseOrg(
    ['* Mixed [/]', ':PROPERTIES:', ':COOKIE_DATA: checkbox', ':END:', '- [X] item 1', '- [ ] item 2', '** TODO Should be ignored'].join(
      '\n'
    )
  );
  updateHeadingCheckboxCookie(doc.children[0], ['DONE']);
  assert.equal(doc.children[0].title, 'Mixed [1/2]');
});

test('THE FIX: :COOKIE_DATA: "todo" counts only TODO-keyword children, ignoring checkboxes', () => {
  const doc = parseOrg(
    ['* Mixed [/]', ':PROPERTIES:', ':COOKIE_DATA: todo', ':END:', '- [X] checkbox (ignored)', '** TODO A', '** DONE B'].join('\n')
  );
  updateHeadingCheckboxCookie(doc.children[0], ['DONE']);
  assert.equal(doc.children[0].title, 'Mixed [1/2]');
});

test('THE FIX: real org\u2019s own exact manual example -- "todo recursive" counts TODO-keyword headings at any depth, not just direct children', () => {
  const doc = parseOrg(
    [
      '* Parent capturing statistics [/]',
      ':PROPERTIES:',
      ':COOKIE_DATA: todo recursive',
      ':END:',
      '** TODO A',
      '** DONE B',
      '** Sub',
      '*** TODO C',
      '*** DONE D',
    ].join('\n')
  );
  updateHeadingCheckboxCookie(doc.children[0], ['DONE']);
  assert.equal(doc.children[0].title, 'Parent capturing statistics [2/4]');
});

test('THE FIX: "todo" WITHOUT "recursive" only counts direct children -- the Org manual\u2019s own literal baseline before "recursive" is added', () => {
  const doc = parseOrg(
    ['* Direct only [/]', ':PROPERTIES:', ':COOKIE_DATA: todo', ':END:', '** TODO A', '** Sub', '*** TODO nested'].join('\n')
  );
  updateHeadingCheckboxCookie(doc.children[0], ['DONE']);
  assert.equal(doc.children[0].title, 'Direct only [0/1]', 'the nested TODO under Sub must not count without "recursive"');
});

test('THE FIX: "checkbox todo" together count BOTH kinds combined into one total, rather than picking just one', () => {
  const doc = parseOrg(
    ['* Combined [/]', ':PROPERTIES:', ':COOKIE_DATA: checkbox todo', ':END:', '- [X] item', '** TODO A', '** DONE B'].join('\n')
  );
  updateHeadingCheckboxCookie(doc.children[0], ['DONE']);
  assert.equal(doc.children[0].title, 'Combined [2/3]', '1 checked checkbox + 1 done TODO out of 1+2 total');
});

test('an ordinary heading with no TODO keyword at all is never counted in "todo" mode -- this is a TODO-item count, not a generic child-heading count', () => {
  const doc = parseOrg(
    ['* Only todos count [/]', ':PROPERTIES:', ':COOKIE_DATA: todo', ':END:', '** TODO A', '** Just a plain heading, no keyword'].join(
      '\n'
    )
  );
  updateHeadingCheckboxCookie(doc.children[0], ['DONE']);
  assert.equal(doc.children[0].title, 'Only todos count [0/1]');
});

test('THE FIX: a TODO-state transition on a descendant updates an ancestor\u2019s "todo"-mode cookie via updateCheckboxCookiesUpward, the same way a checkbox toggle already does', () => {
  const doc = parseOrg(
    ['* Project [/]', ':PROPERTIES:', ':COOKIE_DATA: todo', ':END:', '** TODO A', '** TODO B'].join('\n')
  );
  const childA = doc.children[0].children[0];
  childA.todo = 'DONE'; // simulating what applyTodoTransition's own performChange() already did
  const changed = updateCheckboxCookiesUpward(doc, childA, ['DONE']);
  assert.equal(changed, true);
  assert.equal(doc.children[0].title, 'Project [1/2]');
});

test('each heading in an ancestor chain can have its own, independently different :COOKIE_DATA: override', () => {
  const doc = parseOrg(
    [
      '* Grandparent [/]',
      ':PROPERTIES:',
      ':COOKIE_DATA: todo recursive',
      ':END:',
      '** Parent [/]',
      ':PROPERTIES:',
      ':COOKIE_DATA: checkbox',
      ':END:',
      '- [X] a checkbox here',
      '*** TODO Child',
    ].join('\n')
  );
  const child = doc.children[0].children[0].children[0];
  updateCheckboxCookiesUpward(doc, child, ['DONE']);
  assert.equal(doc.children[0].children[0].title, 'Parent [1/1]', 'Parent counts only its own checkbox (checkbox mode)');
  assert.equal(doc.children[0].title, 'Grandparent [0/1]', 'Grandparent counts the TODO child recursively (todo recursive mode)');
});
