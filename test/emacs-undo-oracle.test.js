// Holds src/emacs-undo.js and the commands of src/emacs-edit.js to real Emacs: test/fixtures/emacs-undo-oracle.json was made by
// tools/gen-emacs-undo-oracle.mjs, which feeds runs of editing commands and undo to a keyboard macro in an Emacs 29.3 org-mode buffer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execute } from '../src/emacs-edit.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-undo-oracle.json', import.meta.url), 'utf8'));

/** @param {any} c */
export function run(c) {
  /** @type {any} */ let s = { text: c.text, pos: c.pos, mark: c.mark, kill: [c.kill ?? 'KILL'], yank: { adjusted: c.adjusted === 1, folded: true } };
  for (const cmd of c.cmds) {
    if (s.error) break;
    s = cmd.startsWith('self:') ? execute(s, 'self-insert-command', cmd.slice(5)) : execute(s, cmd);
  }
  return s;
}

test('editing commands and undo match Emacs 29.3', () => {
  assert.ok(oracle.cases.length > 1500);
  const bad = [];
  for (const c of oracle.cases) {
    const got = run(c);
    const e = c.emacs;
    if (got.text !== e.text || got.pos !== e.pos || (got.mark ?? -1) !== e.mark || Boolean(got.active) !== Boolean(e.active) || Boolean(got.error) !== (e.error !== '')) {
      bad.push({ text: c.text, pos: c.pos, mark: c.mark, cmds: c.cmds.join(' '), got: { text: got.text, pos: got.pos, mark: got.mark, active: got.active, error: got.error }, emacs: e });
    }
  }
  /** @type {Record<string, number>} */ const by = {};
  for (const b of bad) by[b.cmds] = (by[b.cmds] ?? 0) + 1;
  assert.equal(bad.length, 0, `${bad.length} mismatches\n${JSON.stringify(by)}\n${JSON.stringify(bad.slice(0, 2), null, 1)}`);
});
