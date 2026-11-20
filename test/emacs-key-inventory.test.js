// Every key Emacs 29.3 binds in an Org buffer is either bound here to the same command or listed as a gap in test/emacs-key-gaps.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BINDINGS } from '../src/emacs-keymap.js';

const read = (/** @type {string} */ p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const { keys } = read('./fixtures/emacs-key-inventory.json');
/** @type {Record<string, string>} */ const gaps = read('./emacs-key-gaps.json');

test('keys bound in Emacs are bound here to the same command, or listed as gaps', () => {
  const different = Object.entries(keys).filter(([k, c]) => k in BINDINGS && BINDINGS[k] !== c).map(([k, c]) => `${k}: Emacs ${c}, here ${BINDINGS[k]}`);
  const unlisted = Object.entries(keys).filter(([k]) => !(k in BINDINGS) && !(k in gaps)).map(([k, c]) => `${k} (${c})`);
  assert.deepEqual(different, [], 'bound to another command than in Emacs');
  assert.deepEqual(unlisted, [], 'bound in Emacs, not here, and not in test/emacs-key-gaps.json');
});

test('the gap list holds only keys that are still unbound here and still bound in Emacs', () => {
  const stale = Object.keys(gaps).filter((k) => k in BINDINGS || !(k in keys));
  assert.deepEqual(stale, []);
});
