import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { sortEntries } from '../src/outline-sort.js';

// Emacs 29.3: (org-sort-entries nil ?k) and ?K over the children of "Top", where the clock sum counts each entry's subtree and ties keep their order.
const SOURCE = [
  '* Top', '** B', '   :LOGBOOK:', '   CLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 10:30] =>  1:30', '   :END:',
  '** A', '   :LOGBOOK:', '   CLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 09:10] =>  0:10', '   :END:',
  '*** sub', '    :LOGBOOK:', '    CLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 09:20] =>  0:20', '    :END:',
  '** C', '** D', '   :LOGBOOK:', '   CLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 09:30] =>  0:30', '   :END:', '',
].join('\n');

/** @param {string} type */
const order = (type) => {
  const doc = parseOrg(SOURCE);
  sortEntries(doc, doc.children[0], type);
  return doc.children[0].children.map((/** @type {{title: string}} */ h) => h.title).join(' ');
};

test('sort type k orders entries by the clock sum of their subtree, as Emacs does', () => {
  assert.equal(order('k'), 'C A D B');
  assert.equal(order('K'), 'B A D C');
});
