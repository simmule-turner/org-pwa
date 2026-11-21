// Dumps what Emacs 29.3 binds in an Org buffer (every key sequence of the keymaps the buffer reads, found by walking them) to
// test/fixtures/emacs-key-inventory.json, and lists the keys Emacs binds that Emacs mode does not in test/emacs-key-gaps.json
// (only when that file is missing: the gaps are then curated by hand, and the test fails on a key that is neither bound nor listed).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { BINDINGS } from '../src/emacs-keymap.js';

const out = '/tmp/emacs-key-inventory.txt';
execFileSync('emacs', ['--batch', '-Q', '-l', new URL('./emacs-key-inventory.el', import.meta.url).pathname], { env: { ...process.env, INVENTORY_OUT: out } });
const keys = Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split('\t')));
fs.writeFileSync('test/fixtures/emacs-key-inventory.json', JSON.stringify({ emacs: '29.3', keys }, null, 1) + '\n');
if (!fs.existsSync('test/emacs-key-gaps.json')) {
  const gaps = Object.fromEntries(Object.entries(keys).filter(([k]) => !(k in BINDINGS)));
  fs.writeFileSync('test/emacs-key-gaps.json', JSON.stringify(gaps, null, 1) + '\n');
}
console.log(`${Object.keys(keys).length} keys bound in Emacs`);
