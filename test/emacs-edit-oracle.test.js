// Holds src/emacs-edit.js to real Emacs: test/fixtures/emacs-edit-oracle.json was made by tools/gen-emacs-edit-oracle.mjs, which runs the
// editing commands of Emacs mode in an Emacs 29.3 org-mode buffer, singly at every caret position and in short sequences.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execute } from '../src/emacs-edit.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-edit-oracle.json', import.meta.url), 'utf8'));

/** @param {any} c */
function ours(c) {
  let s = { text: c.text, pos: c.pos, mark: c.mark ?? null, kill: [...c.kill], last: undefined, goal: null };
  const prefix = c.prefix === undefined ? undefined : c.prefix === 'u' ? { n: 4, universal: true } : { n: c.prefix, universal: false };
  for (const cmd of c.cmds) {
    if (s.error) break;
    s = execute(s, cmd, 'q', prefix);
  }
  return s;
}

test('Emacs-mode editing commands match Emacs 29.3', () => {
  assert.ok(oracle.cases.length > 6000);
  assert.ok(oracle.cases.filter((c) => c.prefix !== undefined).length > 5000);
  const bad = [];
  for (const c of oracle.cases) {
    const got = ours(c);
    const e = c.emacs;
    const same = got.text === e.text && got.pos === e.pos && (got.mark ?? 'null') === e.mark
      && JSON.stringify(got.kill) === JSON.stringify(e.kill) && Boolean(got.error) === (e.error !== 'null');
    if (!same) bad.push({ text: c.text, pos: c.pos, mark: c.mark, cmds: c.cmds, got: { text: got.text, pos: got.pos, mark: got.mark, kill: got.kill, error: got.error }, emacs: e });
  }
  const byCmd = {};
  for (const b of bad) byCmd[b.cmds.join(' ')] = (byCmd[b.cmds.join(' ')] ?? 0) + 1;
  assert.equal(bad.length, 0, `${bad.length} mismatches\n${JSON.stringify(byCmd)}\n${JSON.stringify(bad.slice(0, 3), null, 1)}`);
});
