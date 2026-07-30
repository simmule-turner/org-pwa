import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistory,
  pushSnapshot,
  canUndo,
  canRedo,
  undo,
  redo,
  jumpTo,
  currentEntry,
} from '../src/undo-history.js';

const T = (s) => new Date(2026, 0, 1, 12, 0, s);

// ---- createHistory -----------------------------------------------------

test('createHistory starts with a single "Opened" snapshot at index 0', () => {
  const h = createHistory('* A');
  assert.equal(h.entries.length, 1);
  assert.equal(h.index, 0);
  assert.equal(h.entries[0].text, '* A');
  assert.equal(h.entries[0].label, 'Opened');
});

test('createHistory accepts a custom initial label', () => {
  const h = createHistory('* A', 'Custom start');
  assert.equal(h.entries[0].label, 'Custom start');
});

// ---- pushSnapshot ---------------------------------------------------------

test('pushSnapshot adds a new entry and advances the index', () => {
  let h = createHistory('* A', 'Opened', T(0));
  h = pushSnapshot(h, '* B', 'Edited title', T(1));
  assert.equal(h.entries.length, 2);
  assert.equal(h.index, 1);
  assert.equal(h.entries[1].text, '* B');
  assert.equal(h.entries[1].label, 'Edited title');
});

test('pushSnapshot with identical text to the current entry returns the SAME history unchanged', () => {
  let h = createHistory('* A', 'Opened', T(0));
  const h2 = pushSnapshot(h, '* A', 'No-op edit', T(1));
  assert.equal(h2, h, 'must be the exact same object reference, not just equal content -- a true no-op');
  assert.equal(h2.entries.length, 1);
});

test('pushSnapshot after undoing discards the redo future, matching standard editor behavior', () => {
  let h = createHistory('* A', 'Opened', T(0));
  h = pushSnapshot(h, '* B', 'Step 1', T(1));
  h = pushSnapshot(h, '* C', 'Step 2', T(2));
  h = undo(h); // back to '* B'
  h = pushSnapshot(h, '* D', 'New branch', T(3)); // a genuinely new edit from here
  assert.equal(h.entries.length, 3);
  assert.deepEqual(
    h.entries.map((e) => e.text),
    ['* A', '* B', '* D']
  );
  assert.equal(canRedo(h), false, 'the discarded "* C" branch must not be reachable via redo anymore');
});

test('does not mutate the original history object passed in (pure function)', () => {
  const h1 = createHistory('* A');
  const h2 = pushSnapshot(h1, '* B', 'Edit');
  assert.equal(h1.entries.length, 1, 'original history must be untouched');
  assert.equal(h2.entries.length, 2);
});

// ---- canUndo / canRedo --------------------------------------------------

test('canUndo is false at the very start, true after at least one push', () => {
  let h = createHistory('* A');
  assert.equal(canUndo(h), false);
  h = pushSnapshot(h, '* B', 'Edit');
  assert.equal(canUndo(h), true);
});

test('canRedo is false at the tip of history, true after undoing', () => {
  let h = createHistory('* A');
  h = pushSnapshot(h, '* B', 'Edit');
  assert.equal(canRedo(h), false);
  h = undo(h);
  assert.equal(canRedo(h), true);
});

// ---- undo / redo ---------------------------------------------------------

test('undo moves the index back one step without discarding anything', () => {
  let h = createHistory('* A');
  h = pushSnapshot(h, '* B', 'Edit 1');
  h = pushSnapshot(h, '* C', 'Edit 2');
  h = undo(h);
  assert.equal(currentEntry(h).text, '* B');
  assert.equal(h.entries.length, 3, 'nothing is discarded by undo alone');
});

test('undo at index 0 is a no-op, returns the same history unchanged', () => {
  const h = createHistory('* A');
  const h2 = undo(h);
  assert.equal(h2, h);
  assert.equal(h2.index, 0);
});

test('redo moves the index forward one step', () => {
  let h = createHistory('* A');
  h = pushSnapshot(h, '* B', 'Edit');
  h = undo(h);
  h = redo(h);
  assert.equal(currentEntry(h).text, '* B');
});

test('redo at the tip of history is a no-op, returns the same history unchanged', () => {
  let h = createHistory('* A');
  h = pushSnapshot(h, '* B', 'Edit');
  const h2 = redo(h);
  assert.equal(h2, h);
});

test('multiple undo/redo steps navigate correctly back and forth', () => {
  let h = createHistory('* A');
  h = pushSnapshot(h, '* B', '1');
  h = pushSnapshot(h, '* C', '2');
  h = pushSnapshot(h, '* D', '3');
  h = undo(h);
  h = undo(h);
  assert.equal(currentEntry(h).text, '* B');
  h = redo(h);
  assert.equal(currentEntry(h).text, '* C');
  h = undo(h);
  h = undo(h);
  h = undo(h);
  assert.equal(currentEntry(h).text, '* A');
  assert.equal(canUndo(h), false);
});

// ---- jumpTo -----------------------------------------------------------

test('jumpTo moves directly to a specific index', () => {
  let h = createHistory('* A');
  h = pushSnapshot(h, '* B', '1');
  h = pushSnapshot(h, '* C', '2');
  h = jumpTo(h, 0);
  assert.equal(currentEntry(h).text, '* A');
});

test('jumpTo does NOT discard anything, unlike pushSnapshot -- browsing history is not a new edit', () => {
  let h = createHistory('* A');
  h = pushSnapshot(h, '* B', '1');
  h = pushSnapshot(h, '* C', '2');
  h = jumpTo(h, 0);
  assert.equal(h.entries.length, 3, 'jumping backward must not discard the forward entries');
  h = jumpTo(h, 2);
  assert.equal(currentEntry(h).text, '* C', 'jumping back to the tip must still work after a jumpTo');
});

test('jumpTo with an out-of-range index is a no-op, returns the same history unchanged', () => {
  const h = createHistory('* A');
  assert.equal(jumpTo(h, 5), h);
  assert.equal(jumpTo(h, -1), h);
});

// ---- currentEntry -----------------------------------------------------

test('currentEntry reflects the entry at the current index', () => {
  let h = createHistory('* A', 'Opened');
  assert.equal(currentEntry(h).label, 'Opened');
  h = pushSnapshot(h, '* B', 'Archived heading');
  assert.equal(currentEntry(h).label, 'Archived heading');
});

// ---- a realistic end-to-end scenario -----------------------------------

test('a realistic sequence: edit, edit, undo, edit (new branch), undo, undo, redo', () => {
  let h = createHistory('* Inbox', 'Opened', T(0));
  h = pushSnapshot(h, '* Inbox\n** Buy milk', 'Added heading', T(1));
  h = pushSnapshot(h, '* Inbox\n** TODO Buy milk', 'Toggled TODO', T(2));
  assert.equal(currentEntry(h).text, '* Inbox\n** TODO Buy milk');

  h = undo(h); // back to "Added heading"
  assert.equal(currentEntry(h).label, 'Added heading');

  h = pushSnapshot(h, '* Inbox\n** Buy milk :errands:', 'Added tag', T(3)); // new branch, discards "Toggled TODO"
  assert.equal(h.entries.length, 3);
  assert.equal(canRedo(h), false);

  h = undo(h);
  h = undo(h);
  assert.equal(currentEntry(h).text, '* Inbox');
  assert.equal(canUndo(h), false);

  h = redo(h);
  assert.equal(currentEntry(h).label, 'Added heading');
});
