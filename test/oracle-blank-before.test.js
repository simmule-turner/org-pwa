// Holds the empty line before a new heading and the blank lines between list items to Emacs 29.3 under each value of
// org-blank-before-new-entry. test/fixtures/oracle-blank-before.json was made by tools/gen-oracle-blank-before.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { insertHeadingAfter } from '../src/heading-edit.js';
import { separatingBlankLines } from '../src/list-edit.js';
import { setBlankBeforeNewEntry, blankBeforeNewEntryOf } from '../src/blank-before-entry.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-blank-before.json', import.meta.url), 'utf8'));

/** @param {string} setting */
const use = (setting) => setBlankBeforeNewEntry({ heading: /** @type {'auto' | 't' | 'nil'} */ (setting), item: /** @type {'auto' | 't' | 'nil'} */ (setting) });

test('a new heading gets the empty line Emacs gives it under each org-blank-before-new-entry', () => {
  for (const c of oracle.headings) {
    use(c.setting);
    const doc = parseOrg(c.text);
    const all = [];
    const walk = (/** @type {import('../src/types.js').Heading[]} */ list) => { for (const h of list) { all.push(h); walk(h.children); } };
    walk(doc.children);
    insertHeadingAfter(doc, all[c.index], {});
    assert.equal(serializeOrg(doc).replace(/\n$/, ''), c.want.replace(/\n$/, '').replace(/^(\*+) ?$/m, '$1 '), `${JSON.stringify(c.text)} ${c.setting} #${c.index}`);
  }
  use('auto');
});

test('list items are separated by the blank lines Emacs counts under each org-blank-before-new-entry', () => {
  for (const c of oracle.lists) {
    use(c.setting);
    assert.equal(separatingBlankLines(c.text.split('\n'), c.line), c.want, `${JSON.stringify(c.text)} ${c.setting} line ${c.line}`);
  }
  use('auto');
});

test('the alist is read from the variable: a missing entry is nil, none at all is auto', () => {
  assert.deepEqual(blankBeforeNewEntryOf({}), { heading: 'auto', item: 'auto' });
  assert.deepEqual(blankBeforeNewEntryOf({ 'org-blank-before-new-entry': '((heading . t) (plain-list-item . auto))' }), { heading: 't', item: 'auto' });
  assert.deepEqual(blankBeforeNewEntryOf({ 'org-blank-before-new-entry': '((heading . nil))' }), { heading: 'nil', item: 'nil' });
});
