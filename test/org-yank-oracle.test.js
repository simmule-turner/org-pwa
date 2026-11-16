// Holds src/org-yank.js to real Emacs: test/fixtures/org-yank-oracle.json was made by tools/gen-org-yank-oracle.mjs, which runs org-yank in
// an Emacs 29.3 buffer with subtree and plain kills, at every caret position, under the settings of org-yank-adjusted-subtrees and
// org-yank-folded-subtrees.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execute } from '../src/emacs-edit.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/org-yank-oracle.json', import.meta.url), 'utf8'));

test('org-yank matches Emacs 29.3', () => {
  assert.ok(oracle.cases.length > 3000);
  const bad = [];
  for (const c of oracle.cases) {
    const got = execute({ text: c.text, pos: c.pos, mark: null, kill: [c.kill], yank: { adjusted: c.adjusted, folded: c.folded } }, 'org-yank');
    const e = c.emacs;
    if (got.text !== e.text || got.pos !== e.pos || (got.mark ?? -1) !== e.mark || Boolean(got.error) !== (e.error !== '')) {
      bad.push({ text: c.text, pos: c.pos, kill: c.kill, adjusted: c.adjusted, folded: c.folded, got: { text: got.text, pos: got.pos, mark: got.mark }, emacs: e });
    }
  }
  assert.equal(bad.length, 0, `${bad.length} mismatches\n${JSON.stringify(bad.slice(0, 3), null, 1)}`);
});
