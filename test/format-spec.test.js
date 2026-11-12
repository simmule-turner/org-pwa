// @ts-check
// format-spec as Emacs 29.3 does it (test/fixtures/format-spec-oracle.json: tools/gen-format-spec-oracle.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatSpec } from '../src/format-spec.js';

const oracle = JSON.parse(readFileSync(new URL('./fixtures/format-spec-oracle.json', import.meta.url), 'utf8'));

for (const c of oracle.cases) {
  test(`format-spec ${JSON.stringify(c.format)} gives what Emacs gives`, () => {
    if (c.kind === 'error') assert.throws(() => formatSpec(c.format, oracle.spec), (e) => e instanceof Error && e.message === c.result);
    else assert.equal(formatSpec(c.format, oracle.spec), c.result);
  });
}
