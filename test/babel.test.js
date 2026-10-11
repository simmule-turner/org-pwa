import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockLanguage, findNamedTable, formatError, formatResult, isJsBlock, parseHeaderArgs, parseResultsSpec, placeResults, resolveVars, timeoutMs } from '../src/babel.js';
import { parseBody } from '../src/body-parser.js';
import { getBabelJs } from '../src/local-variables.js';

const fmt = (value, results = '', wrap = '') => formatResult(value, parseResultsSpec(results), { wrap });

test('language and header arguments', () => {
  assert.equal(blockLanguage('JS :results table'), 'js');
  assert.equal(isJsBlock({ name: 'SRC', params: 'javascript' }), true);
  assert.equal(isJsBlock({ name: 'SRC', params: 'python' }), false);
  assert.equal(isJsBlock({ name: 'EXAMPLE', params: 'js' }), false);
  const args = parseHeaderArgs('js :results list :var a=1 :var b="x y" :timeout 3 :wrap quote');
  assert.equal(args.results, 'list');
  assert.deepEqual(args.var, ['a=1', 'b="x y"']);
  assert.equal(args.timeout, '3');
  assert.equal(args.wrap, 'quote');
  assert.deepEqual(parseHeaderArgs('js').var, []);
});

test('results spec and timeout', () => {
  assert.deepEqual(parseResultsSpec('output raw'), { collect: 'output', format: 'raw', silent: false, unsupported: null });
  assert.equal(parseResultsSpec('silent').silent, true);
  assert.equal(parseResultsSpec('file').unsupported, 'file');
  assert.equal(timeoutMs({}), 5000);
  assert.equal(timeoutMs({ timeout: '2' }), 2000);
  assert.equal(timeoutMs({ timeout: '9999' }), 60000);
  assert.equal(timeoutMs({ timeout: 'x' }), 5000);
});

// Expected values below were produced by Emacs 's ob-js (org-babel-execute-buffer) for the same blocks.
test('result formats match Org (ob-js)', () => {
  assert.deepEqual(fmt(42), [': 42']);
  assert.deepEqual(fmt('hello'), [': hello']);
  assert.deepEqual(fmt(null), [': null']);
  assert.deepEqual(fmt(true), [': true']);
  assert.deepEqual(fmt([[1, 2], ['x', 'y']]), ['| 1 | 2 |', '| x | y |']);
  assert.deepEqual(fmt([1, 2, 3]), ['| 1 | 2 | 3 |']);
  assert.deepEqual(fmt([1, 2, 3], 'table'), ['| 1 | 2 | 3 |']);
  assert.deepEqual(fmt(['a', 'b'], 'list'), ['- a', '- b']);
  assert.deepEqual(fmt('one\ntwo', 'output'), [': one', ': two']);
  assert.deepEqual(fmt('q', '', 'quote'), ['#+begin_quote', 'q', '#+end_quote']);
  assert.deepEqual(fmt([3, 's']), ['| 3 | s |']);
});

test('other result shapes', () => {
  assert.deepEqual(fmt('a\n\nb'), [': a', ':', ': b']);
  assert.deepEqual(fmt('*bold*', 'raw'), ['*bold*']);
  assert.deepEqual(fmt({ k: 1 }), [': {"k":1}']);
  assert.deepEqual(fmt([]), [': []']);
  assert.deepEqual(fmt('x', 'table'), ['| x |']);
  assert.deepEqual(fmt([['a|b', null]]), ['| a\\vert{}b |  |']);
  assert.deepEqual(fmt('', 'output'), []);
  assert.deepEqual(fmt(undefined), [': undefined']);
  assert.deepEqual(fmt('x', '', 'SRC js'), ['#+begin_SRC js'.replace('SRC', 'src'), 'x', '#+end_src']);
  assert.deepEqual(formatError('boom', 3), [': Error: boom (line 3)']);
});

test(':var values and named tables', () => {
  const lines = ['#+NAME: sales', '| q | n |', '|---+---|', '| Q1 | 10 |', '| Q2 | 2.5 |', '', 'text'];
  assert.deepEqual(findNamedTable(lines, 'sales'), [['q', 'n'], ['Q1', 10], ['Q2', 2.5]]);
  assert.equal(findNamedTable(lines, 'nope'), null);
  const lookup = (n) => findNamedTable(lines, n);
  assert.deepEqual(resolveVars(['a=1 b="x y"', 'c=sales', 'd=t', "e='s'", 'f=nil'], lookup), {
    a: 1,
    b: 'x y',
    c: [['q', 'n'], ['Q1', 10], ['Q2', 2.5]],
    d: true,
    e: 's',
    f: null,
  });
  assert.throws(() => resolveVars(['x=missing'], lookup), /no table named "missing"/);
  assert.throws(() => resolveVars(['junk'], lookup), /expected name=value/);
});

function blockOf(lines) {
  return parseBody(lines).find((n) => n.type === 'block');
}

test('blocks know their own lines', () => {
  const lines = ['text', '#+BEGIN_SRC js', 'return 1;', '#+END_SRC', 'after'];
  const block = blockOf(lines);
  assert.equal(block.lineIndex, 1);
  assert.equal(block.lineCount, 3);
});

function apply(lines, results) {
  const block = blockOf(lines);
  const { start, removeCount, insert } = placeResults(lines, block, results);
  const out = lines.slice();
  out.splice(start, removeCount, ...insert);
  return out;
}

test('results are added below the block with blank lines, as Org does', () => {
  assert.deepEqual(apply(['#+BEGIN_SRC js', 'return 1;', '#+END_SRC'], [': 1']), ['#+BEGIN_SRC js', 'return 1;', '#+END_SRC', '', '#+RESULTS:', ': 1']);
  assert.deepEqual(apply(['#+BEGIN_SRC js', 'return 1;', '#+END_SRC', 'Following text'], [': 1']), [
    '#+BEGIN_SRC js', 'return 1;', '#+END_SRC', '', '#+RESULTS:', ': 1', '', 'Following text',
  ]);
});

test('existing results are replaced, whatever their shape', () => {
  const head = ['#+BEGIN_SRC js', 'return 1;', '#+END_SRC', ''];
  assert.deepEqual(apply([...head, '#+RESULTS:', ': old', ': older', '', 'keep'], [': 2']), [...head, '#+RESULTS:', ': 2', '', 'keep']);
  assert.deepEqual(apply([...head, '#+RESULTS:', '| a | b |', '| c | d |', 'keep'], ['- x']), [...head, '#+RESULTS:', '- x', 'keep']);
  assert.deepEqual(apply([...head, '#+RESULTS:', '#+begin_quote', 'q', '#+end_quote', 'keep'], [': 3']), [...head, '#+RESULTS:', ': 3', 'keep']);
  assert.deepEqual(apply([...head, '#+RESULTS[abc123]:', ': old'], [': 4']), [...head, '#+RESULTS:', ': 4']); // a run without :cache drops the old hash
});

test('results keep the block indentation', () => {
  assert.deepEqual(apply(['  #+BEGIN_SRC js', '  return 1;', '  #+END_SRC'], [': 1']), ['  #+BEGIN_SRC js', '  return 1;', '  #+END_SRC', '', '  #+RESULTS:', '  : 1']);
});

test('org-xx-babel-js is off unless set to on', () => {
  assert.equal(getBabelJs({}), false);
  assert.equal(getBabelJs(undefined), false);
  assert.equal(getBabelJs({ 'org-xx-babel-js': 'on' }), true);
  assert.equal(getBabelJs({ 'org-xx-babel-js': 'off' }), false);
  assert.equal(getBabelJs({ 'org-xx-babel-js': 'nil' }), false);
});
