// A change made outside the commands (the device keyboard, a paste) joins the undo list as one change, so `C-/` takes it back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, syncExternal } from '../src/emacs-edit.js';

test('an outside change is one undo step, and the mark moves with the text', () => {
  /** @type {any} */ let s = { text: 'foo bar', pos: 3, mark: 6, kill: [], active: true };
  s = syncExternal(s, 'foo XYZ bar', 7);
  assert.equal(s.text, 'foo XYZ bar');
  assert.equal(s.pos, 7);
  assert.equal(s.mark, 10);
  assert.equal(s.active, false);
  s = execute(s, 'undo');
  assert.equal(s.text, 'foo bar');
  assert.equal(s.pos, 3);
  s = execute(s, 'undo');
  assert.equal(s.error, 'No further undo information');
});

test('the same text only moves the caret', () => {
  /** @type {any} */ const s = syncExternal({ text: 'ab', pos: 0, mark: null, kill: [] }, 'ab', 2);
  assert.equal(s.pos, 2);
  assert.equal(s.undo, undefined);
});

test('an outside deletion after typing is its own step', () => {
  /** @type {any} */ let s = { text: 'ab', pos: 2, mark: null, kill: [] };
  s = execute(s, 'self-insert-command', 'x');
  s = syncExternal(s, 'abx!', 4);
  s = syncExternal(s, 'ab', 2);
  s = execute(s, 'undo');
  assert.equal(s.text, 'abx!');
  s = execute(s, 'undo');
  assert.equal(s.text, 'abx');
});
