import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import {
  countCheckboxes,
  updateAllStatisticsCookies,
  updateCheckboxCookie,
  updateTodoCookiesUpward,
} from '../src/checkbox-cookie.js';

// Real Emacs (org-update-statistics-cookies on the whole buffer) is the reference:
// tools/gen-cookie-oracle.mjs wrote the expected texts.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/cookie-oracle.json', import.meta.url), 'utf8'));
for (const [i, c] of oracle.entries()) {
  test(`update all cookies matches Emacs: case ${i} (${JSON.stringify(c.org.slice(0, 40))})`, () => {
    const doc = parseOrg(c.org);
    updateAllStatisticsCookies(doc, ['DONE', 'CANCELED']);
    assert.equal(serializeOrg(doc), c.emacs);
  });
}

test('countCheckboxes counts the top-level items of the section, not child headings or nested items', () => {
  const doc = parseOrg(['* P', '- [X] a', '  - [ ] n', '** Sub', '- [ ] s'].join('\n'));
  assert.deepEqual(countCheckboxes(doc.children[0]), { total: 1, checked: 1 });
  assert.deepEqual(countCheckboxes(doc.children[0], true), { total: 2, checked: 1 });
});

test('toggling a checkbox updates only its own heading, percentages round down, blank numbers are filled in', () => {
  const doc = parseOrg(['* A [/] [%]', '- [X] a', '- [ ] b', '- [ ] c', '** B [/]', '- [ ] x'].join('\n'));
  assert.equal(updateCheckboxCookie(doc.children[0]), true);
  assert.equal(doc.children[0].title, 'A [1/3] [33%]');
  assert.equal(doc.children[0].children[0].title, 'B [/]');
});

test('a TODO change updates the parent’s cookie from its TODO children', () => {
  const doc = parseOrg(['* P [/]', '** DONE a', '** TODO b', '** plain'].join('\n'));
  assert.equal(updateTodoCookiesUpward(doc, doc.children[0].children[0], ['DONE']), true);
  assert.equal(doc.children[0].title, 'P [1/2]');
});
