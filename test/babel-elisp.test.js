import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHeaderArgs, parseResultsSpec, placeResults, resolveVars } from '../src/babel.js';
import { formatElispResult, runElisp } from '../src/babel-elisp.js';

// test/fixtures/babel-elisp-oracle.json: what Emacs 29.3 (ob-emacs-lisp, org-babel-execute-src-block) wrote for each block
// (tools/gen-babel-elisp-oracle.mjs).  The block is run here by the interpreter and its value laid out by src/babel-elisp.js.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/babel-elisp-oracle.json', import.meta.url), 'utf8'));

/** The block, run and laid out: result lines, or an error message. @param {{ code: string, header: string }} c */
function ours(c) {
  const args = parseHeaderArgs('emacs-lisp ' + c.header);
  const spec = parseResultsSpec(args.results);
  let code = c.code;
  const vars = resolveVars(args.var, null, { colnames: args.colnames, rownames: args.rownames, hlines: args.hlines });
  const r = runElisp({ code, vars, spec, lexical: args.lexical });
  if (!r.ok) return { spec, error: r.message };
  try {
    return { spec, lines: formatElispResult(r.value, spec, { wrap: args.wrap === undefined ? null : args.wrap }) };
  } catch (e) {
    return { spec, error: /** @type {Error} */ (e).message };
  }
}

const compared = oracle.filter((/** @type {any} */ c) => !c.twice);
const bad = [];
for (const c of compared) {
  const args = parseHeaderArgs('emacs-lisp ' + c.header);
  const spec = parseResultsSpec(args.results);
  if (spec.unsupported || args.post !== undefined) continue; // file output and :post are not supported; the app says so
  const o = ours(c);
  const tail = c.emacs.slice(c.emacs.indexOf('#+end_src\n') + 10);
  const got = 'error' in o ? 'ERROR' : o.spec.silent ? '' : '\n#+RESULTS:\n' + o.lines.join('\n') + (o.lines.length ? '\n' : '');
  const want = c.emacs.startsWith('ERROR') ? 'ERROR' : tail;
  if (got !== want) bad.push({ header: c.header, code: c.code, got, want, message: /** @type {any} */ (o).error });
}

if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(bad));
test('emacs-lisp blocks give the results Emacs writes', () => {
  assert.deepEqual(bad.slice(0, Number(process.env.SHOW || 10)), []);
});

test('emacs-lisp blocks run again over an earlier result', () => {
  for (const c of oracle.filter((/** @type {any} */ c) => c.twice)) {
    const args = parseHeaderArgs('emacs-lisp ' + c.header);
    const spec = parseResultsSpec(args.results);
    const { lines } = /** @type {{ lines: string[] }} */ (ours(c));
    let body = ['#+begin_src emacs-lisp ' + c.header, c.code, '#+end_src'];
    for (let i = 0; i < 2; i++) {
      const { start, removeCount, insert } = placeResults(body, { lineIndex: 0, lineCount: 3 }, lines, { handling: spec.handling });
      body = [...body.slice(0, start), ...insert, ...body.slice(start + removeCount)];
    }
    assert.equal(body.join('\n').replace(/\n+$/, '') + '\n', c.emacs.replace(/\n+$/, '') + '\n', c.header + ' ' + c.code);
  }
});
