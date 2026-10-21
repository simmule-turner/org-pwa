import test from 'node:test';
import assert from 'node:assert/strict';
import { changedNames, followedSettings, labelForChange, planRestore, pushCapped, snapshotText, MAX_SETTINGS_STEPS } from '../src/settings-history.js';
import { createHistory } from '../src/undo-history.js';

test('logins and navigation state are not followed', () => {
  const s = followedSettings({ theme: 'dark', github: { token: 'x' }, openTabs: [1], connectionProtection: {} });
  assert.deepEqual(Object.keys(s), ['theme']);
});

test('changes are named', () => {
  const a = snapshotText({ theme: 'light', fontSize: 16 });
  const b = snapshotText({ theme: 'dark', fontSize: 18 });
  assert.deepEqual(changedNames(a, b), ['fontSize', 'theme']);
  assert.equal(labelForChange(['theme']), 'Theme');
  assert.equal(labelForChange(['fontSize', 'theme']), 'Font size and 1 more setting');
  assert.equal(labelForChange(['a', 'b', 'c']), 'a and 2 more settings');
});

test('restoring writes only what differs and removes what the step lacks', () => {
  const target = snapshotText({ theme: 'light' });
  const plan = planRestore({ theme: 'dark', fontSize: 18, github: { token: 'x' } }, target);
  assert.deepEqual(plan.set, { theme: 'light' });
  assert.deepEqual(plan.remove, ['fontSize']);
});

test('the history keeps at most 100 steps and the index follows', () => {
  let h = createHistory(snapshotText({ n: 0 }));
  for (let i = 1; i <= 130; i++) h = pushCapped(h, snapshotText({ n: i }), 'n');
  assert.equal(h.entries.length, MAX_SETTINGS_STEPS);
  assert.equal(h.index, MAX_SETTINGS_STEPS - 1);
  assert.equal(JSON.parse(h.entries[h.index].text).n, 130);
});
