// Holds src/emacs-complete.js to Emacs 29.3's try-completion and all-completions (test/fixtures/emacs-complete-oracle.json,
// made by tools/gen-emacs-complete-oracle.mjs), with completion-ignore-case on and off.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allCompletions, tryCompletion } from '../src/emacs-complete.js';

const { cases } = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-complete-oracle.json', import.meta.url), 'utf8'));

test('try-completion and all-completions match Emacs 29.3', () => {
  for (const c of cases) {
    const where = JSON.stringify(c);
    const got = tryCompletion(c.i, c.c, c.fold);
    assert.equal(got === null ? false : got, c.emacs.try === false ? false : c.emacs.try, where);
    assert.deepEqual(allCompletions(c.i, c.c, c.fold), c.emacs.all, where);
  }
});
