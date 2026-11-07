import test from 'node:test';
import assert from 'node:assert/strict';
import { print, run } from '../src/elisp.js';
import { toRegExp } from '../src/elisp-regex.js';
import { guardFor, guardedSearch } from '../src/regex-guard.js';

// A pattern with two unbounded repetitions side by side (`.*.*.*x`) takes polynomial time to fail; on a long input the native
// engine cannot be interrupted, so such a pattern runs in the step-limited matcher once the input is long.

const lisp = (src) => {
  const r = run(src);
  return r.ok ? { ok: true, value: print(r.value) } : { ok: false, error: r.error };
};

test('.*.*.*x against 50,000 characters stops with Emacs\'s error in under a second', { timeout: 10_000 }, () => {
  const t0 = Date.now();
  const r = lisp('(string-match ".*.*.*x" (make-string 50000 ?a))');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Stack overflow in regexp matcher');
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});

test('a condition-case can catch the error, and other classes of overlapping repetitions are limited too', { timeout: 10_000 }, () => {
  for (const re of ['[a-z]*[a-z]*[a-z]*$', '\\\\s-*\\\\s-*\\\\s-*x', 'a*a*a*b']) {
    const filler = re.startsWith('\\\\s-') ? '32' : '?a';
    const r = lisp(`(condition-case e (string-match "${re}" (concat (make-string 40000 ${filler}) "!")) (error (cadr e)))`);
    assert.deepEqual(r, { ok: true, value: '"Stack overflow in regexp matcher"' }, re);
  }
});

test('a short input keeps the native engine, so nothing changes for ordinary use', () => {
  assert.deepEqual(lisp('(string-match ".*.*.*x" "abcx")'), { ok: true, value: '0' });
  assert.equal(guardFor(toRegExp('.*.*.*x', false, true).source, 'mu', 100), null);
  assert.ok(guardFor(toRegExp('.*.*.*x', false, true).source, 'mu', 5000));
});

test('patterns that are only linear or quadratic with a separator are never guarded', () => {
  for (const re of ['.*a.*b', 'a*b*', '[a-z]*[0-9]*', 'x*y*z*', '\\(foo\\)*bar*']) {
    const rx = toRegExp(re, false, true);
    assert.equal(guardFor(rx.source, rx.flags, 100_000), null, re);
  }
});

test('a guarded polynomial pattern gives the native answer, groups included', () => {
  const cases = [['.*.*x', 'abxcdx'], ['\\(a*\\)a*b', 'aaab'], ['[a-z]*[a-z]*!', 'abc!d'], ['.*.*y', 'abc'], ['\\(.*\\).*;', 'k=v;w;']];
  for (const [re, s] of cases) {
    const rx = toRegExp(re, false, true);
    const guard = guardFor(rx.source, rx.flags, 100_000);
    assert.ok(guard, re);
    const want = new RegExp(rx.source, `${rx.flags.replace('g', '')}d`).exec(s);
    const got = guardedSearch(guard, s, 0);
    assert.equal(got ? got.index : null, want ? want.index : null, re);
    if (want) {
      assert.equal(got.end, want.index + want[0].length, re);
      for (let g = 1; g < want.length; g++) assert.deepEqual([got.caps[g * 2], got.caps[g * 2 + 1]], want.indices[g] ?? [-1, -1], `${re} group ${g}`);
    }
  }
});
