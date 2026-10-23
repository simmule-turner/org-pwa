import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatResult, parseHeaderArgs, parseResultsSpec, placeResults } from '../src/babel.js';
import { formatLog } from '../src/js-inspect.js';

// test/fixtures/babel-results-oracle.json: what Emacs 29.3 (ob-js, org-babel-execute-src-block) wrote for each block
// (tools/gen-babel-results-oracle.mjs).  The block is run here as plain JavaScript and its value laid out by src/babel.js.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/babel-results-oracle.json', import.meta.url), 'utf8'));

/** What the sandbox hands back: plain data. @param {any} v @returns {any} */
function plain(v) {
  if (v === undefined || v === null || ['string', 'number', 'boolean'].includes(typeof v)) return v;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') return Object.fromEntries(Object.keys(v).map((k) => [k, plain(v[k])]));
  return String(v);
}

/** @param {string} code */
function run(code) {
  /** @type {string[]} */ const logs = [];
  const value = new Function('console', code)({ log: (/** @type {any[]} */ ...a) => logs.push(formatLog(a.map(plain))) });
  return { value: plain(value), hasValue: value !== undefined, output: logs.join('\n') };
}

/** The block, run and laid out, as the text Emacs's buffer would hold. @param {{ code: string, header: string }} c */
function ours(c) {
  const args = parseHeaderArgs('js ' + c.header);
  const spec = parseResultsSpec(args.results);
  const o = run(c.code);
  const lines = formatResult(spec.collect === 'output' ? o.output : o.hasValue ? o.value : undefined, spec, { wrap: args.wrap === undefined ? null : args.wrap });
  return { spec, lines };
}

/** Places where ob-js reads a result through the Lisp reader, which cuts a string at its first space, drops backslashes and fails on `''` or `#`: this app keeps the text. */
const READER_QUIRKS = new Set([
  "return ''", "return ' lead'", "return 'a\\nb'", "return 'a\\n\\nb'", 'return \'say "hi"\'', "return [['a|b',null]]", 'return [[]]', 'return [{k:1},{k:2}]',
  "return 'line1\\n* heading'", "return '#+begin_src x'", "return [['a\\nb']]",
]);
/** Emacs puts what a value block prints with console.log in front of its value, and reads output as Lisp for `table`; this app keeps them apart. */
const LOG_MIXING = /console\.log/;
const KEEPS_TEXT = /scalar|verbatim|html|code|pp|raw|org|drawer|output/;

const compared = oracle.filter((/** @type {any} */ c) => !c.twice);
for (const c of compared) {
  const args = parseHeaderArgs('js ' + c.header);
  const spec = parseResultsSpec(args.results);
  if (spec.unsupported || args.post !== undefined) continue; // file output and :post are not supported; the app says so
  test(`js ${c.header} | ${c.code}`, () => {
    const tail = c.emacs.slice(c.emacs.indexOf('#+end_src\n') + 10);
    const { spec: s, lines } = ours(c);
    const got = s.silent ? '' : '\n#+RESULTS:\n' + lines.join('\n') + (lines.length ? '\n' : '');
    const results = args.results || '';
    const readByLisp = !KEEPS_TEXT.test(results) || /table/.test(results);
    if (got !== tail && READER_QUIRKS.has(c.code) && readByLisp) return;
    if (got !== tail && LOG_MIXING.test(c.code) && (!/output/.test(results) || /table/.test(results))) return;
    assert.equal(got, tail);
  });
}

for (const c of oracle.filter((/** @type {any} */ c) => c.twice)) {
  test(`js ${c.header} | ${c.code} (run twice)`, () => {
    const args = parseHeaderArgs('js ' + c.header);
    const spec = parseResultsSpec(args.results);
    const { lines } = ours(c);
    let body = ['#+begin_src js ' + c.header, c.code, '#+end_src'];
    for (let i = 0; i < 2; i++) {
      const { start, removeCount, insert } = placeResults(body, { lineIndex: 0, lineCount: 3 }, lines, { handling: spec.handling });
      body = [...body.slice(0, start), ...insert, ...body.slice(start + removeCount)];
    }
    assert.equal(body.join('\n').replace(/\n+$/, '') + '\n', c.emacs.replace(/\n+$/, '') + '\n');
  });
}
