import test from 'node:test';
import assert from 'node:assert/strict';
import { print, run } from '../src/elisp.js';
import { toRegExp } from '../src/elisp-regex.js';
import { guardFor, guardedSearch } from '../src/regex-guard.js';

// Limits that keep a hostile Emacs Lisp block from freezing or crashing the tab.

const lisp = (src, options = {}) => {
  const r = run(src, options);
  return r.ok ? { ok: true, value: print(r.value) } : { ok: false, error: r.error, kind: r.kind };
};

test('a regexp that backtracks without end stops with Emacs\'s own error, quickly', { timeout: 10_000 }, () => {
  const t0 = Date.now();
  const r = lisp('(string-match "^\\\\(a+\\\\)+$" (concat (make-string 32 ?a) "b"))');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Stack overflow in regexp matcher');
  assert.ok(Date.now() - t0 < 5000);
});

test('an overlapping alternation under a repetition is limited too, and a condition-case can catch it', { timeout: 10_000 }, () => {
  const r = lisp('(condition-case e (string-match "\\\\(a\\\\|aa\\\\)*c" (concat (make-string 40 ?a) "b")) (error (cadr e)))');
  assert.deepEqual(r, { ok: true, value: '"Stack overflow in regexp matcher"' });
});

test('patterns that would be risky still match like the native engine, groups included', () => {
  const patterns = ['\\(a+\\)+$', '\\(a\\|aa\\)*c', '\\(a*\\)*b', '\\(a\\|b\\)+\\(a\\|b\\)', '\\(\\(a\\)\\|b\\)*', '^\\(a*b*\\)*$', '\\([ab]+\\)+\\1', '\\(a+?\\)+b', '\\(a\\{1,3\\}\\)\\{2\\}', '\\(?:a\\|ab\\)\\(?:c\\|bcd\\)*', '\\(x*\\)*y\\|a'];
  const subjects = ['', 'a', 'b', 'ab', 'aab', 'aaab', 'abab', 'baab', 'aabc', 'abcd', 'xxy', 'aaaaaa', 'abba', 'aac', 'abbcd'];
  let guarded = 0;
  for (const re of patterns) {
    const rx = toRegExp(re, false, true);
    const guard = guardFor(rx.source, rx.flags);
    if (!guard) continue;
    guarded++;
    for (const s of subjects) {
      for (let start = 0; start <= s.length; start++) {
        rx.lastIndex = start;
        const want = new RegExp(rx.source, `${rx.flags}d`);
        want.lastIndex = start;
        const m = want.exec(s);
        const got = guardedSearch(guard, s, start);
        assert.equal(got === null, m === null, `${re} on "${s}" from ${start}`);
        if (!m || !got) continue;
        assert.equal(got.index, m.index, `${re} on "${s}" from ${start}`);
        assert.equal(got.end, m.index + m[0].length, `${re} on "${s}" from ${start}`);
        for (let g = 1; g < m.indices.length; g++) {
          const want2 = m.indices[g];
          const from = got.caps[g * 2];
          assert.deepEqual(from >= 0 ? [from, got.caps[g * 2 + 1]] : undefined, want2, `${re} on "${s}" group ${g}`);
        }
      }
    }
  }
  assert.ok(guarded >= 8, 'most of these patterns take the guarded path');
});

test('ordinary patterns keep the native engine', () => {
  for (const re of ['foo\\|bar', '\\(foo\\|bar\\)+', '[a-z]+', '\\(a\\)\\(b\\)', '.*x.*y']) {
    const rx = toRegExp(re, false, true);
    assert.equal(guardFor(rx.source, rx.flags), null, re);
  }
});

test('a huge allocation is refused instead of crashing the tab', () => {
  for (const src of ['(make-list 1000000000 1)', '(make-vector 1000000000 1)', '(make-string 400000000 ?a)', '(number-sequence 1 100000000)', '(string-pad "a" 1000000000)', '(format "%1000000000d" 1)']) {
    assert.deepEqual(lisp(src), { ok: false, error: 'Memory exhausted--use C-x s then exit and restart Emacs', kind: 'error' }, src);
  }
  assert.equal(lisp('(length (make-list 100000 0))').value, '100000');
});

test('a huge power is refused', () => {
  const r = lisp('(expt 123456789123456789123456789 5000000)');
  assert.equal(r.ok, false);
});

test('a long computation that stays inside the step budget still stops on the clock', { timeout: 10_000 }, () => {
  const t0 = Date.now();
  const r = lisp('(let ((s "") (i 0)) (while (< i 400000) (setq s (concat s "x") i (1+ i))) (length s))', { timeLimitMs: 300, budget: 50_000_000 });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'budget');
  assert.ok(Date.now() - t0 < 3000);
});

test('quick programs are not affected by the clock', () => {
  assert.deepEqual(lisp('(let ((s 0) (i 0)) (while (< i 20000) (setq s (+ s i) i (1+ i))) s)'), { ok: true, value: '199990000' });
});

test('a number of more than integer-width bits (65536) is an overflow-error, as in Emacs 29.3', () => {
  // each line was run in GNU Emacs 29.3: the first of each pair is fine, the second signals (overflow-error)
  assert.equal(lisp('(expt 2 65535)').ok, true);
  assert.deepEqual(lisp('(expt 2 65536)'), { ok: false, error: lisp('(expt 2 65536)').error, kind: 'error' });
  assert.match(String(lisp('(expt 2 65536)').error), /Arithmetic overflow error/);
  assert.equal(lisp('(ash 1 65535)').ok, true);
  assert.match(String(lisp('(ash 1 70000)').error), /Arithmetic overflow error/);
  assert.match(String(lisp('(let ((a (expt 2 40000))) (* a a))').error), /Arithmetic overflow error/);
  assert.match(String(lisp('(expt 3 100000)').error), /Arithmetic overflow error/);
});
