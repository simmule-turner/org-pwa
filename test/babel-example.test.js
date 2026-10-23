// examples/babel-js.org holds the #+RESULTS: Emacs 29.3 wrote for its blocks (checked by running them in Emacs); the app must write the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findNamedTable, formatResult, headerText, parseHeaderArgs, parseResultsSpec, resolveVars } from '../src/babel.js';
import { formatLog } from '../src/js-inspect.js';

const lines = readFileSync(new URL('../examples/babel-js.org', import.meta.url), 'utf8').split('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

for (let i = 0; i < lines.length; i++) {
  const begin = /^#\+begin_src js\s*(.*)$/.exec(lines[i]);
  if (!begin) continue;
  const end = lines.indexOf('#+end_src', i);
  const code = lines.slice(i + 1, end).join('\n');
  const results = [];
  for (let j = end + 3; j < lines.length && lines[j] !== ''; j++) results.push(lines[j]);
  test(`babel-js.org line ${i + 1}: ${code.split('\n')[0]}`, async () => {
    assert.equal(lines[end + 2], '#+RESULTS:');
    const args = parseHeaderArgs('js ' + begin[1]);
    const spec = parseResultsSpec(args.results);
    const vars = resolveVars(args.var, (n) => findNamedTable(lines, n), { colnames: args.colnames, rownames: args.rownames, hlines: args.hlines });
    const logs = [];
    const body = [args.prologue === undefined ? '' : headerText(args.prologue), code, args.epilogue === undefined ? '' : headerText(args.epilogue)].join('\n');
    const value = await new AsyncFunction('console', ...Object.keys(vars), body)({ log: (...a) => logs.push(formatLog(a)) }, ...Object.values(vars));
    const shown = spec.collect === 'output' ? logs.join('\n') : value;
    assert.deepEqual(formatResult(shown, spec, { wrap: args.wrap === undefined ? null : args.wrap }), results);
  });
}
