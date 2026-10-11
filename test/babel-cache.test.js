import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheHash, sha1Hex } from '../src/babel-cache.js';
import { existingResultsHash, placeResults } from '../src/babel.js';

test('sha1Hex gives the standard digest', async () => {
  assert.equal(await sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
});

test('cacheHash changes with the code, the variables and the result shape, not with replace/silent', async () => {
  const base = { lang: 'js', args: { results: 'table replace' }, vars: { n: 1 }, code: 'return n;' };
  const h = await cacheHash(base);
  assert.equal(h.length, 40);
  assert.equal(await cacheHash({ ...base, args: { results: 'replace table' } }), h);
  assert.equal(await cacheHash({ ...base, args: { results: 'table silent' } }), h);
  assert.notEqual(await cacheHash({ ...base, code: 'return n + 1;' }), h);
  assert.notEqual(await cacheHash({ ...base, vars: { n: 2 } }), h);
  assert.notEqual(await cacheHash({ ...base, args: { results: 'list' } }), h);
});

test('placeResults writes, keeps and drops the hash in the results line', () => {
  const lines = ['#+begin_src js :cache yes', 'return 1;', '#+end_src'];
  const block = { lineIndex: 0, lineCount: 3 };
  const first = placeResults(lines, block, [': 1'], { hash: 'abc' });
  assert.deepEqual(first.insert.slice(0, 2), ['', '#+RESULTS[abc]:']);
  const withResults = [...lines, '', '#+RESULTS[abc]:', ': 1'];
  assert.equal(existingResultsHash(withResults, block), 'abc');
  assert.equal(placeResults(withResults, block, [': 2'], { hash: 'def' }).insert[0], '#+RESULTS[def]:');
  assert.equal(placeResults(withResults, block, [': 2']).insert[0], '#+RESULTS:');
  assert.equal(existingResultsHash([...lines, '', '#+RESULTS:', ': 1'], block), null);
});
