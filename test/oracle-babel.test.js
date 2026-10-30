// Holds source-block handling to Emacs 29.3 over a wide corpus: test/fixtures/oracle-babel.json was made by tools/gen-oracle-babel.mjs
// (tools/oracle-babel.el) from tools/oracle-babel-cases.mjs.  Each kind of case is one function of Org Babel:
//   blocks  the blocks found in a text, with language, name, body and the header arguments in force (inheritance included)
// A case the app does not match is named by a rule in test/support/oracle-babel-known.js, and fails once it starts to match.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { collectDocumentBlocks, removeIndentation } from '../src/babel-blocks.js';
import { expandNoweb, nowebAllows } from '../src/noweb.js';
import { tangleDocument } from '../src/tangle.js';
import { prepareBabelExport } from '../src/babel-export.js';
import { serializeOrg } from '../src/org-parser.js';
import { runElisp, formatElispResult } from '../src/babel-elisp.js';
import { parseBody } from '../src/body-parser.js';
import { evalAllowed, existingResultsHash, findNamedTable, formatError, parseResultsSpec, placeResults, resolveVars } from '../src/babel.js';
import { createHash } from 'node:crypto';
import { cacheInput } from '../src/babel-cache.js';
import { ruleFor, BABEL_RULES } from './support/oracle-babel-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-babel.json', import.meta.url), 'utf8'));
const cases = oracle.cases;

const words = (/** @type {string} */ s) => String(s).split(/\s+/).filter(Boolean).sort().join(' ');

const sortKeys = (/** @type {Record<string, any>} */ o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

/** What the app finds in a text, in the shape the Emacs side writes. @param {string} text */
function blocksOf(text) {
  return collectDocumentBlocks(parseOrg(text)).map((b) => {
    /** @type {Record<string, any>} */ const params = {};
    for (const [k, v] of Object.entries(b.args)) {
      if (k === 'results' || k === 'exports') params[k] = words(/** @type {string} */ (v));
      else params[k] = v;
    }
    return { lang: b.langText, body: b.emacsBody, name: b.name || '', params: sortKeys(params) };
  });
}

/** The Emacs side in the same shape. @param {any[]} list */
function emacsBlocks(list) {
  return list.map((b) => {
    /** @type {Record<string, any>} */ const params = {};
    for (const [k, v] of Object.entries(b.params)) params[k] = k === 'results' || k === 'exports' ? words(/** @type {string} */ (v)) : v;
    return { lang: b.lang, body: b.body, name: b.name, params: sortKeys(params) };
  });
}

/** The prepared document as text: the keywords the export step consumed (NAME, HEADER, RESULTS) are not put back, header arguments
 * (which the exporters ignore) are cut from the begin line, and a body loses its common indentation, as in Emacs's output.
 * @param {any} doc */
const RESULTS_KEYWORD = /^\s*#\+(?:RESULTS(?:\[[^\]]*\])?|CAPTION|ATTR_\w+):/i; // an exporter ignores the keyword itself, so Emacs's copy of it is left out of the comparison
function exportedText(doc) {
  const strip = (/** @type {any} */ d) => (d.keywords ? { ...d, keywords: d.keywords.filter((/** @type {any} */ k) => !/^(NAME|HEADERS?|RESULTS|CAPTION|ATTR_\w+)$/i.test(k.key)) } : d);
  const lines = serializeOrg(strip(doc)).split('\n').filter((l) => !RESULTS_KEYWORD.test(l));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*#\+begin_src\b[^:]*?)(?:\s+:.*)?$/i.exec(lines[i]);
    if (!m || /:exports (?!code\b|results\b|both\b|none\b)\w/.test(lines[i])) {
      out.push(lines[i]); // (a block with an unknown :exports value is left as it is)
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !/^\s*#\+end_src\s*$/i.test(lines[j])) j++;
    out.push(m[1].trimEnd(), ...removeIndentation(lines.slice(i + 1, j)));
    i = j - 1;
  }
  return out.join('\n').replace(/\n+$/, '');
}

/** What the app's C-c C-c on the INDEXth block leaves in the text: the pipeline of src-browser/babel-flow.js (header arguments, :var,
 * Noweb, run, format, place) without the dialogs and the cache.  @param {string} text @param {number} index */
function executed(text, index) {
  const doc = /** @type {any} */ (parseOrg(text));
  const all = collectDocumentBlocks(doc);
  const info = all[index];
  const heading = info.heading;
  const args = info.args;
  const spec = parseResultsSpec(args.results);
  if (spec.unsupported) return 'ERROR unsupported results';
  if (args.post !== undefined) return 'ERROR :post is not supported'; // Emacs runs the named block on the result; with none found it stops with an error and writes nothing
  if (!evalAllowed(args)) return text;
  const block = { lineIndex: info.beginIndex, lineCount: info.endIndex - info.beginIndex + 1 };
  /** @type {string | null} */ let hash = null;
  const place = (/** @type {string[]} */ lines, handling = 'replace') => {
    const { start, removeCount, insert } = placeResults(heading.bodyLines, block, lines, { hash, handling, name: info.name || '' });
    const bodyLines = heading.bodyLines.slice();
    bodyLines.splice(start, removeCount, ...insert);
    const changed = { ...heading, bodyLines, body: parseBody(bodyLines) };
    return serializeOrg({ ...doc, children: doc.children.map((/** @type {any} */ h) => (h === heading ? changed : h)) });
  };
  let vars;
  try {
    vars = resolveVars(args.var, (/** @type {string} */ name) => findNamedTable(heading.bodyLines || [], name), { colnames: args.colnames, rownames: args.rownames, hlines: args.hlines });
  } catch (err) {
    return place(formatError(/** @type {Error} */ (err).message));
  }
  let code = info.rawLines.map((/** @type {string} */ l) => l.replace(/^(\s*),(?=\*|#\+)/, '$1')).join('\n');
  if (nowebAllows(args, 'eval')) {
    try {
      code = expandNoweb(doc, all, info);
    } catch (err) {
      return place(formatError(/** @type {Error} */ (err).message));
    }
  }
  if (args.cache === 'yes') {
    const body = nowebAllows(args, 'eval') ? code : info.emacsBody;
    hash = createHash('sha1').update(cacheInput({ lang: info.lang, args, vars, code: body })).digest('hex');
    if (existingResultsHash(heading.bodyLines, block) === hash) return text;
  }
  const outcome = runElisp({ code, vars, spec, lexical: args.lexical });
  if (!outcome.ok) return 'ERROR ' + outcome.message; // Emacs stops with the error and writes nothing
  const lines = formatElispResult(/** @type {any} */ (outcome.value), spec, { wrap: args.wrap === undefined ? null : args.wrap, file: args.file === undefined ? null : args.file });
  if (spec.silent) return text;
  return place(lines, spec.handling);
}

/** @param {any} c @returns {{ got: any, want: any }} */
function compare(c) {
  if (c.kind === 'blocks') {
    if (typeof c.emacs === 'string') return { got: 'ERROR', want: 'ERROR' };
    return { got: blocksOf(c.text), want: emacsBlocks(c.emacs) };
  }
  if (c.kind === 'nowebp') return { got: nowebAllows({ noweb: c.value }, c.context), want: c.emacs };
  if (c.kind === 'noweb') {
    const doc = parseOrg(c.text);
    const blocks = collectDocumentBlocks(doc);
    let got;
    try {
      got = expandNoweb(doc, blocks, blocks[c.index], { context: 'eval' });
    } catch (e) {
      got = 'ERROR ' + /** @type {Error} */ (e).message;
    }
    if (typeof c.emacs === 'string' && c.emacs.startsWith('ERROR') && typeof got === 'string' && got.startsWith('ERROR')) return { got: 'ERROR', want: 'ERROR' };
    return { got, want: c.emacs };
  }
  if (c.kind === 'tangle') {
    let got;
    try {
      got = tangleDocument(parseOrg(c.text), { documentName: c.name }).files.filter((f) => f.path !== c.name).map((f) => ({ path: f.path, text: f.text, mode: f.mode == null ? '644' : f.mode.toString(8) }));
      got.sort((a, b) => (a.path < b.path ? -1 : 1));
    } catch (e) {
      got = 'ERROR ' + /** @type {Error} */ (e).message;
    }
    if (typeof c.emacs === 'string' && c.emacs.startsWith('ERROR') && typeof got === 'string') return { got: 'ERROR', want: 'ERROR' };
    return { got, want: c.emacs };
  }
  if (c.kind === 'export') {
    let got;
    try {
      got = exportedText(prepareBabelExport(parseOrg(c.text)));
    } catch (e) {
      got = 'ERROR ' + /** @type {Error} */ (e).message;
    }
    if (typeof c.emacs === 'string' && c.emacs.startsWith('ERROR') && typeof got === 'string' && got.startsWith('ERROR')) return { got: 'ERROR', want: 'ERROR' };
    return { got, want: typeof c.emacs === 'string' ? c.emacs.split('\n').filter((l) => !RESULTS_KEYWORD.test(l)).join('\n').replace(/\n+$/, '') : c.emacs };
  }
  if (c.kind === 'exec') {
    let got;
    try {
      got = executed(c.text, c.index);
    } catch (e) {
      got = 'ERROR ' + /** @type {Error} */ (e).message;
    }
    const trim = (/** @type {any} */ t) => (typeof t === 'string' ? t.replace(/\n+$/, '') : t);
    if (typeof got === 'string' && got.startsWith('ERROR') && typeof c.emacs === 'string' && c.emacs.startsWith('ERROR')) return { got: 'ERROR', want: 'ERROR' };
    return { got: trim(got), want: trim(c.emacs) };
  }
  return { got: null, want: null };
}

function differences() {
  const bad = [];
  for (const c of cases) {
    let got;
    let want;
    try {
      ({ got, want } = compare(c));
    } catch (e) {
      got = 'THROWS ' + /** @type {Error} */ (e).message;
      want = c.emacs;
    }
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push({ ...c, got, want });
  }
  return bad;
}

const bad = differences();
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(bad.filter((b) => !ruleFor(b)).map((b) => ({ kind: b.kind, text: b.text, got: b.got, want: b.want })), null, 1));

test('the cases give what Emacs gives, except for the listed deviations', () => {
  const open = bad.filter((c) => !ruleFor(c));
  assert.equal(open.length, 0, `${open.length} of ${cases.length} differ without a known-deviation rule\n` + JSON.stringify(open.slice(0, 2), null, 1));
});

test('every known-deviation rule still matches a case the app gets wrong', () => {
  for (const r of BABEL_RULES) assert.ok(bad.some((c) => c.kind === r.kind && r.match(c)), `rule "${r.id}" matches no failing case any more`);
});
