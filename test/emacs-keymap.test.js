// Holds src/emacs-keymap.js to real Emacs: test/fixtures/emacs-keymap-oracle.json was made by tools/gen-emacs-keymap-oracle.mjs. Every key
// sequence of the table is bound to the same command in an Emacs 29.3 Org buffer, and runs of prefix-argument keys (C-u, M-digits, ESC
// digits, minus) end with the caret, text size and error Emacs has.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BINDINGS, eventKey, feedKey, newKeyInput } from '../src/emacs-keymap.js';
import { execute } from '../src/emacs-edit.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-keymap-oracle.json', import.meta.url), 'utf8'));

test('every bound key sequence is bound to the same command in Emacs', () => {
  const emacs = new Map(oracle.bindings);
  const bad = Object.entries(BINDINGS).filter(([k, command]) => emacs.get(k) !== command);
  assert.deepEqual(bad, []);
  assert.ok(Object.keys(BINDINGS).length > 40);
});

/** The keys of a run, typed one at a time on a buffer of a hundred x with the caret at 50. @param {string} keys */
function typed(keys) {
  /** @type {any} */ let s = { text: 'x'.repeat(100), pos: 50, mark: null, kill: [] };
  let input = newKeyInput();
  for (const key of keys.split(' ')) {
    const fed = feedKey(input, key);
    input = fed.input;
    const r = fed.result;
    if (r.type === 'error') return s;
    if (r.type === 'run') {
      s = execute(s, r.command, r.char, r.prefix);
      if (s.error) break;
    }
  }
  return s;
}

test('prefix arguments read as Emacs reads them', () => {
  assert.ok(oracle.runs.length > 30);
  const bad = [];
  for (const [keys, point, size, error] of oracle.runs) {
    const s = typed(keys);
    if (s.pos !== point || s.text.length !== size || Boolean(s.error) !== (error !== '')) bad.push({ keys, ours: [s.pos, s.text.length, s.error], emacs: [point, size, error] });
  }
  assert.deepEqual(bad, []);
});

test('browser key events are named as Emacs names them', () => {
  const e = (key, ctrlKey = false, altKey = false) => eventKey({ key, ctrlKey, altKey });
  assert.equal(e('f', true), 'C-f');
  assert.equal(e('f', false, true), 'M-f');
  assert.equal(e('x', true, true), 'C-M-x');
  assert.equal(e(' ', true), 'C-SPC');
  assert.equal(e(' '), ' ');
  assert.equal(e('/', true), 'C-/');
  assert.equal(e('Backspace'), 'DEL');
  assert.equal(e('Backspace', false, true), 'M-DEL');
  assert.equal(e('ArrowLeft'), '<left>');
  assert.equal(e('Control', true), null);
  assert.equal(e('<', false, true), 'M-<');
});
