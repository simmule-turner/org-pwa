// Holds the Org commands at the caret of Emacs mode (src/emacs-org.js through src/emacs-edit.js) to Emacs 29.3: test/fixtures/emacs-org-oracle.json
// was made by tools/gen-emacs-org-oracle.mjs, which runs each command at every caret position of a few Org texts. Where a command says
// it is not available in a place yet, that place is not compared (the ROADMAP lists them).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execute } from '../src/emacs-edit.js';

const { cases } = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-org-oracle.json', import.meta.url), 'utf8'));
/** Emacs's command names, as Emacs mode names them. @type {Record<string, string>} */
const NAMES = {};

test('Org commands at the caret match Emacs 29.3', () => {
  let compared = 0;
  /** @type {Record<string, number>} */ const skipped = {};
  for (const c of cases) {
    const name = NAMES[c.cmd] ?? c.cmd;
    const got = execute({ text: c.text, pos: c.pos, mark: null, kill: [] }, name);
    if (got.error?.includes('not available')) {
      skipped[name] = (skipped[name] ?? 0) + 1;
      continue;
    }
    const want = c.emacs.error === 'null' ? null : c.emacs.error;
    const where = `${name} at ${c.pos} in ${JSON.stringify(c.text)}`;
    assert.equal(got.error ? got.error.replace(/ in buffer.*/, '') : null, want ? want.replace(/ in buffer.*/, '') : null, where);
    assert.equal(got.text, c.emacs.text, where);
    assert.equal(got.pos, c.emacs.pos, where);
    compared += 1;
  }
  assert.ok(compared > 3000, `compared ${compared}, skipped ${JSON.stringify(skipped)}`);
});
