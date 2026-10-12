import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { archiveStamps, describeSubtree, displayName, filterTargets, refileDetails, restoreDestination } from '../src/archive-refile-details.js';

const cand = (documentId, path, level = path.length, children = []) => ({ documentId, outlinePath: path, heading: { level, children } });

test('filterTargets needs every word, in the path or the file name, any case; empty keeps all', () => {
  const all = [cand('a.org', ['Home', 'Garden']), cand('work.org', ['Projects']), cand('a.org', ['Work'])];
  assert.equal(filterTargets(all, '').length, 3);
  assert.deepEqual(filterTargets(all, 'home gar').map((c) => c.outlinePath.join('/')), ['Home/Garden']);
  assert.deepEqual(filterTargets(all, 'WORK').map((c) => c.documentId + ':' + c.outlinePath.join('/')), ['work.org:Projects', 'a.org:Work']);
  assert.equal(filterTargets(all, 'zzz').length, 0);
});

test('describeSubtree counts the heading and what is under it', () => {
  const doc = parseOrg('* A\n** B\n*** C\n** D\n* E\n');
  assert.equal(describeSubtree(doc.children[0]), '4 headings (3 under it)');
  assert.equal(describeSubtree(doc.children[1]), '1 heading');
});

test('archiveStamps lists ARCHIVE_TODO only for a heading with a state', () => {
  assert.deepEqual(archiveStamps({ todo: null }), ['ARCHIVE_TIME', 'ARCHIVE_FILE', 'ARCHIVE_OLPATH', 'ARCHIVE_CATEGORY']);
  assert.ok(archiveStamps({ todo: 'TODO' }).includes('ARCHIVE_TODO'));
});

test('restoreDestination reads ARCHIVE_FILE and ARCHIVE_OLPATH, and says when nothing is recorded', () => {
  const h = (props) => parseOrg(`* X\n:PROPERTIES:\n${props}:END:\n`).children[0];
  assert.deepEqual(restoreDestination(h(''), 'a.org'), { recorded: false, label: 'this file (no original location recorded — the archive tag will just be removed)' });
  assert.equal(restoreDestination(h(':ARCHIVE_FILE: a.org\n:ARCHIVE_OLPATH: Home/Garden\n'), 'a.org').label, 'this file, under "Home / Garden"');
  assert.equal(restoreDestination(h(':ARCHIVE_FILE: b.org\n'), 'a.org').label, '"b.org" (top level)');
});

test('refileDetails says where it lands, the level change, and warns for another file', () => {
  const heading = { level: 3, children: [] };
  const same = refileDetails(heading, cand('a.org', ['Home'], 1), 'a.org');
  assert.equal(same.find((r) => r.label === 'Goes to').value, 'this file, under Home, as its last child');
  assert.equal(same.find((r) => r.label === 'Level').value, '2 (was 3)');
  assert.ok(!same.some((r) => r.label === 'Other file'));
  const other = refileDetails(heading, cand('work.org', ['Projects'], 2), 'a.org');
  assert.ok(other.find((r) => r.label === 'Other file').warn);
  assert.equal(other.find((r) => r.label === 'Level').value, '3 (unchanged)');
});

test('displayName hides the unsaved-document prefix', () => {
  assert.equal(displayName('\u0000unsaved-new-document:abc'), 'this new document');
  assert.equal(displayName('notes.org'), 'notes.org');
});
