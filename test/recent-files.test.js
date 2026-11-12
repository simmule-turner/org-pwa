// Holds the recently opened list to Emacs 29.3's recentf: test/fixtures/recentf-oracle.json was made by tools/gen-recentf-oracle.mjs
// (find-file, save-buffer and kill-buffer runs with recentf-mode on, for several recentf-max-saved-items including 0, negative and nil,
// after recentf-save-list). The app does what recentf does: closing a file leaves the list as it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RECENTF_MAX_SAVED_ITEMS, droppedRecent, pushRecent, recentKey, recentMaxOf, recentRows, removeRecent, savedCopyTime } from '../src/recent-files.js';
import { VariableValueError } from '../src/variable-error.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/recentf-oracle.json', import.meta.url), 'utf8'));

/** Replays a run as the app does: opening a file that is already open only switches to it (recentf's find-file hook runs when a file is first read), saving puts it first, closing leaves the list alone. */
function replay(ops, limit) {
  const max = recentMaxOf({ 'recentf-max-saved-items': limit === null ? 'nil' : limit });
  let list = [];
  const open = new Set();
  let now = 1;
  for (const [op, name] of ops) {
    const file = { documentId: name, storageKind: 'github' };
    now++;
    if (op === 'open') {
      if (open.has(name)) continue;
      open.add(name);
      list = pushRecent(list, file, max, now);
    } else if (op === 'save') {
      if (!open.has(name)) {
        open.add(name); // find-file-noselect in the oracle reads it first
        list = pushRecent(list, file, max, now);
      }
      list = pushRecent(list, file, max, now);
    } else open.delete(name);
  }
  return list.map((f) => f.documentId);
}

test('the list after finds, saves and closes is the list Emacs recentf keeps (all of the oracle runs)', () => {
  assert.ok(oracle.length >= 40);
  for (const c of oracle) assert.deepEqual(replay(c.ops, c.max), c.list, `max ${c.max}: ${JSON.stringify(c.ops)}`);
});

test('closing a file leaves the list as it is', () => {
  assert.deepEqual(replay([['open', 'a.org'], ['open', 'b.org'], ['close', 'a.org']], 20), ['b.org', 'a.org']);
  assert.deepEqual(replay([['open', 'a.org'], ['open', 'b.org'], ['close', 'b.org'], ['close', 'a.org']], 20), ['b.org', 'a.org']);
});

test('recentf-max-saved-items: 20 when unset, a whole number when set, anything else names the variable', () => {
  assert.equal(RECENTF_MAX_SAVED_ITEMS, 20);
  assert.equal(recentMaxOf({}), 20);
  assert.equal(recentMaxOf({ 'recentf-max-saved-items': '50' }), 50);
  assert.equal(recentMaxOf({ 'recentf-max-saved-items': 'nil' }), null); // the whole list, as nil does in Emacs
  assert.equal(recentMaxOf({ 'recentf-max-saved-items': -3 }), null); // so do 0 and negative numbers (recentf cuts only for a positive limit)
  assert.equal(recentMaxOf({ 'recentf-max-saved-items': 0 }), null);
  assert.throws(() => recentMaxOf({ 'recentf-max-saved-items': 'many' }), (e) => e instanceof VariableValueError && /recentf-max-saved-items/.test(e.message));
});

test('an entry keeps the time its saved text matched the file when it is only viewed, and takes the time of an open or a save', () => {
  const file = { documentId: 'a.org', storageKind: 'github' };
  let list = pushRecent([], file, 20, 100);
  list = pushRecent(list, file, 20, 500, false);
  assert.equal(list[0].openedAt, 500);
  assert.equal(list[0].textAt, 100);
  list = pushRecent(list, file, 20, 900, true);
  assert.equal(list[0].textAt, 900);
});

test('removing and the limit say which entries left the list', () => {
  const a = { documentId: 'a.org', storageKind: 'github' };
  const b = { documentId: 'b.org', storageKind: 'webdav' };
  const both = pushRecent(pushRecent([], a, 20, 1), b, 20, 2);
  assert.deepEqual(droppedRecent(both, removeRecent(both, a)).map((f) => f.documentId), ['a.org']);
  assert.deepEqual(droppedRecent(both, pushRecent(both, { documentId: 'c.org', storageKind: 'github' }, 2, 3)).map((f) => f.documentId), ['a.org']);
  assert.notEqual(recentKey(a), recentKey({ documentId: 'a.org', storageKind: 'webdav' }));
});

test('each row is the current file, another open one, or a closed one', () => {
  const list = ['a.org', 'b.org', 'c.org'].map((documentId, i) => ({ documentId, storageKind: 'github', openedAt: i }));
  const key = (n) => recentKey({ documentId: n, storageKind: 'github' });
  const rows = recentRows(list, new Set([key('a.org'), key('b.org')]), key('a.org'));
  assert.deepEqual(rows.map((r) => r.state), ['current', 'open', 'closed']);
});

test('a saved copy dates from the time today, the day and time another day', () => {
  const noon = new Date(2026, 10, 12, 12, 0).getTime();
  assert.equal(savedCopyTime(new Date(2026, 10, 12, 10, 42).getTime(), noon, 'en-US'), '10:42 AM');
  assert.equal(savedCopyTime(new Date(2026, 10, 10, 9, 5).getTime(), noon, 'en-US'), 'Nov 10, 9:05 AM');
});
