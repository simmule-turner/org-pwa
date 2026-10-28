import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { print, run } from '../src/elisp.js';

// Emacs 29.3 (tools/gen-elisp-oracle.mjs): every expression of tools/elisp-cases.mjs, evaluated in order in one session.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/elisp.json', import.meta.url), 'utf8'));
// Emacs's own driver and `eval` already use this many levels of `max-lisp-eval-depth` when a program starts.
const BASE_DEPTH = 28;

test('the interpreter gives Emacs\'s answer on every expression', () => {
  const bad = [];
  for (const c of oracle) {
    const r = run(c.src, { lexical: c.lexical, budget: 5_000_000, baseDepth: BASE_DEPTH });
    const got = r.ok ? { status: 'ok', value: print(r.value), errdata: '' } : { status: 'error', value: r.error, errdata: r.errorForm ?? '' };
    const want = { status: c.status, value: c.value, errdata: c.errdata };
    const same = got.status === want.status && got.value === want.value && got.errdata === want.errdata && r.output === c.output && r.messages.join('\x04') === c.messages.join('\x04');
    if (!same) bad.push({ src: c.src, got: { ...got, output: r.output, messages: r.messages }, want: { ...want, output: c.output, messages: c.messages } });
  }
  assert.deepEqual(bad, []);
});
