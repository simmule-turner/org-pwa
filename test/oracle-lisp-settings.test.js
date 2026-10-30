import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { print, run } from '../src/elisp.js';
import { KNOWN } from './support/oracle-lisp-settings-known.js';

// Emacs 29.3 (tools/gen-oracle-lisp-settings.mjs): every expression of tools/oracle-lisp-settings-cases.mjs (numbers, strings, lists, sequences,
// hash tables, regexps, printing and reading, errors, macros), each evaluated on its own.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-lisp-settings.json', import.meta.url), 'utf8'));
const BASE_DEPTH = 28;
// Emacs reads the expressions from a file, and names it in a few reader errors; the interpreter has no file.
const noFile = (/** @type {string} */ t) => t.replace(/: \/tmp\/oracle-lisp-settings-\d+\.el/g, '').replace(/ "\/tmp\/oracle-lisp-settings-\d+\.el"/g, '');

// The corpus wraps many expressions in a `condition-case` that turns an error into data; the known deviations are written for the bare expression.
const bare = (/** @type {string} */ src) => /^\(condition-case err (.*) \(error \(list 'err \(error-message-string err\)\)\)\)$/s.exec(src)?.[1] ?? src;

/** @param {typeof oracle[number]} c */
function deviates(c) {
  let r;
  try {
    r = run(c.src, { lexical: c.lexical, budget: 5_000_000, baseDepth: BASE_DEPTH });
  } catch (e) {
    return { src: c.src, got: `crash: ${/** @type {Error} */ (e).message}` };
  }
  const got = r.ok ? { status: 'ok', value: print(r.value), errdata: '' } : { status: 'error', value: r.error, errdata: r.errorForm ?? '' };
  const want = { status: c.status, value: noFile(c.value), errdata: noFile(c.errdata) };
  const same = got.status === want.status && got.value === want.value && got.errdata === want.errdata && r.output === c.output
    && r.messages.join('') === c.messages.map(noFile).join('');
  return same ? null : { src: c.src, got: { ...got, output: r.output, messages: r.messages }, want: { ...want, output: c.output, messages: c.messages } };
}

test('the interpreter gives Emacs\'s answer on every expression, except the known deviations', () => {
  const bad = [];
  for (const c of oracle) {
    const d = deviates(c);
    const rule = KNOWN.find((k) => k.match.test(bare(c.src)));
    if (rule) {
      continue;
    }
    if (d) bad.push(d);
  }
  assert.deepEqual(bad.slice(0, 20), []);
  assert.equal(bad.length, 0);
});

test('every known deviation still covers something', () => {
  for (const k of KNOWN) assert.ok(oracle.some((c) => k.match.test(bare(c.src)) && deviates(c)), k.reason);
});
