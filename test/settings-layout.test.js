import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS_CATEGORIES, mergeOrder, moveInList, orderToStore, resolveSettingsLayout } from '../src/settings-layout.js';

test('no saved order gives the default categories and cards', () => {
  const layout = resolveSettingsLayout(null);
  assert.deepEqual(layout.map((c) => c.id), DEFAULT_SETTINGS_CATEGORIES.map((c) => c.id));
  assert.deepEqual(layout[0].cards, DEFAULT_SETTINGS_CATEGORIES[0].cards);
});

test('a saved order wins; unknown ids are dropped and new ones keep their default places', () => {
  assert.deepEqual(mergeOrder(['a', 'b', 'c'], ['c', 'zzz', 'a', 'a']), ['c', 'a', 'b']);
  assert.deepEqual(mergeOrder(['a', 'b'], 'nonsense'), ['a', 'b']);
  assert.deepEqual(mergeOrder(['a', 'b'], [1, null, 'b']), ['b', 'a']);
});

test('categories and the cards inside one are ordered independently', () => {
  const layout = resolveSettingsLayout({ categories: ['sync', 'appearance'], cards: { sync: ['backup', 'github'] } });
  assert.deepEqual(layout.slice(0, 2).map((c) => c.id), ['sync', 'appearance']);
  assert.equal(layout.length, DEFAULT_SETTINGS_CATEGORIES.length);
  assert.deepEqual(layout[0].cards.slice(0, 2), ['backup', 'github']);
  assert.equal(layout[0].cards.length, DEFAULT_SETTINGS_CATEGORIES.find((c) => c.id === 'sync').cards.length);
});

test('garbage in the stored order cannot break the layout', () => {
  for (const bad of [42, 'x', [], { categories: 7, cards: 'no' }, { cards: { sync: 5 } }]) {
    assert.equal(resolveSettingsLayout(bad).length, DEFAULT_SETTINGS_CATEGORIES.length);
  }
});

test('moveInList moves one item and stops at the ends', () => {
  assert.deepEqual(moveInList(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(moveInList(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(moveInList(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);
  assert.deepEqual(moveInList(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
});

test('the order to store is null for the defaults and only holds what differs', () => {
  assert.equal(orderToStore(resolveSettingsLayout(null)), null);
  const moved = resolveSettingsLayout({ categories: ['export'], cards: { sync: ['backup'] } });
  const stored = orderToStore(moved);
  assert.equal(stored.categories[0], 'export');
  assert.deepEqual(Object.keys(stored.cards), ['sync']);
  assert.deepEqual(resolveSettingsLayout(stored).map((c) => c.id), moved.map((c) => c.id));
});

test('every default card appears in exactly one category', () => {
  const all = DEFAULT_SETTINGS_CATEGORIES.flatMap((c) => c.cards);
  assert.equal(new Set(all).size, all.length);
});
